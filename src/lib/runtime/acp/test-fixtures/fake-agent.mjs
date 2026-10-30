import process from "node:process";
import fs from "node:fs";

// Deterministic stand-in for the agent CLI: no model calls, no network.

const mode = process.env.FAKE_AGENT_MODE ?? "default";

if (process.env.FAKE_AGENT_PID_FILE) {
  fs.writeFileSync(process.env.FAKE_AGENT_PID_FILE, String(process.pid));
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const logFile = process.env.FAKE_AGENT_LOG_FILE;

function logMessage(message) {
  if (logFile) {
    fs.appendFileSync(logFile, `${JSON.stringify(message)}\n`);
  }
}

const clientRequests = new Map();
const pendingPrompts = new Map();

let flooded = null;
let nextSessionId = 1;
let closeAttempts = 0;

function initializeResult() {
  const sessionCapabilities = {
    ...(mode === "no-list-capability" ? {} : { list: {} }),
    ...(mode === "no-resume-capability" ? {} : { resume: {} }),
    ...(mode === "no-close-capability" ? {} : { close: {} }),
    delete: {},
    additionalDirectories: {},
  };

  return {
    protocolVersion: mode === "protocol-2" ? 2 : 1,
    agentCapabilities: {
      loadSession: mode !== "no-load-capability",
      sessionCapabilities,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: { http: true, sse: false },
      _meta: {
        "reasonix.io":
          mode === "no-steer-capability"
            ? {}
            : {
                sessionSteer: {
                  method:
                    mode === "steer-malformed"
                      ? ""
                      : "_reasonix.io/session/steer",
                },
              },
      },
    },
    agentInfo: { name: "fake-agent", version: "1.0.0" },
    authMethods: [{ id: "fake-setup", type: "terminal", args: ["setup"] }],
  };
}

function floodStderr() {
  if (!flooded) {
    flooded = new Promise((resolve) => {
      process.stderr.write("x".repeat(200_000), resolve);
    });
  }

  return flooded;
}

async function handleMessage(message) {
  logMessage(message);

  if (typeof message.method !== "string") {
    const resolve = clientRequests.get(message.id);

    if (resolve) {
      clientRequests.delete(message.id);
      resolve(message);
    }

    return;
  }

  const { id, method, params } = message;

  if (method === "session/cancel") {
    const pending = pendingPrompts.get(params?.sessionId);

    if (mode === "prompt-cancel" && pending) {
      pendingPrompts.delete(params.sessionId);
      send({
        jsonrpc: "2.0",
        id: pending.id,
        result: { stopReason: "cancelled" },
      });
    }

    return;
  }

  if (id === undefined) {
    return;
  }

  if (mode === "stderr-flood") {
    await floodStderr();
  }

  switch (method) {
    case "initialize":
      if (mode === "initialize-error") {
        send({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: "scripted initialize failure",
            data: { detail: "nope" },
          },
        });
        return;
      }

      send({ jsonrpc: "2.0", id, result: initializeResult() });
      return;
    case "session/list": {
      if (mode === "list-malformed") {
        send({
          jsonrpc: "2.0",
          id,
          result: { sessions: "not-an-array" },
        });
        return;
      }

      send({
        jsonrpc: "2.0",
        id,
        result: {
          sessions:
            mode === "list-empty"
              ? []
              : [
                  {
                    sessionId: "fake-listed-session-1",
                    cwd: "/tmp/domino-fake-workspace",
                    title: "First listed session",
                    updatedAt: "2026-10-30T01:02:03Z",
                  },
                  {
                    sessionId: "fake-listed-session-2",
                    cwd: "/tmp/other-workspace",
                    title: "",
                    updatedAt: "2026-10-29T04:05:06Z",
                  },
                ],
        },
      });
      return;
    }
    case "session/new": {
      const result =
        mode === "malformed-session-new"
          ? { sessionId: "" }
          : { sessionId: `fake-acp-session-${nextSessionId}` };

      nextSessionId += 1;

      const respond = () => send({ jsonrpc: "2.0", id, result });

      if (mode === "slow-session-new") {
        setTimeout(respond, 200);
      } else {
        respond();
      }

      return;
    }
    case "session/load": {
      const sessionId = params?.sessionId;
      const streamText = (text, targetSessionId = sessionId) =>
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: targetSessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            },
          },
        });
      const streamUpdate = (update, targetSessionId = sessionId) =>
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: targetSessionId, update },
        });

      if (mode === "load-error") {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "scripted load failure" },
        });
        return;
      }

      if (mode !== "load-empty") {
        streamText("earlier ");
        streamUpdate({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "user asked" },
        });
        streamText("foreign", "fake-foreign-session");
        streamUpdate({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thinking" },
        });
        streamUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "image", data: "ignored" },
        });
        streamText("answer");
      }

      send({ jsonrpc: "2.0", id, result: {} });

      if (mode === "load-late-update") {
        setTimeout(() => streamText("late"), 50);
      }

      return;
    }
    case "session/resume": {
      if (mode === "resume-error") {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "scripted resume failure" },
        });
        return;
      }

      if (mode === "resume-decoy") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: params?.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "resume decoy" },
            },
          },
        });
      }

      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    case "session/close":
      closeAttempts += 1;

      if (mode === "close-fails-once" && closeAttempts === 1) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "scripted close failure" },
        });
        return;
      }

      send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "_reasonix.io/session/steer": {
      if (mode === "steer-error") {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "scripted steer failure" },
        });
        return;
      }

      const pending = pendingPrompts.get(params?.sessionId);

      if (mode === "prompt-await-steer" && pending) {
        pendingPrompts.delete(params.sessionId);
        send({ jsonrpc: "2.0", id, result: {} });
        send({
          jsonrpc: "2.0",
          id: pending.id,
          result: { stopReason: "end_turn" },
        });
        return;
      }

      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    case "session/prompt": {
      const sessionId = params?.sessionId;

      const stream = (text, targetSessionId = sessionId) =>
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: targetSessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            },
          },
        });

      const respond = (result) => send({ jsonrpc: "2.0", id, result });

      if (mode === "prompt-await-steer") {
        pendingPrompts.set(sessionId, { id });
        stream("first");
        return;
      }

      if (mode === "prompt-cancel") {
        pendingPrompts.set(sessionId, { id });
        stream("partial");
        return;
      }

      if (mode === "prompt-cancel-ignored") {
        stream("partial");
        setTimeout(() => respond({ stopReason: "end_turn" }), 50);
        return;
      }

      if (mode === "prompt-silent") {
        return;
      }

      if (mode === "prompt-late-after-timeout") {
        stream("early");
        setTimeout(() => stream("late"), 700);
        return;
      }

      if (mode === "prompt-crash") {
        stream("partial");
        setTimeout(() => process.exit(1), 10);
        return;
      }

      if (mode === "prompt-eof") {
        stream("partial");
        process.stdout.end();
        setInterval(() => {}, 1_000);
        return;
      }

      if (mode === "prompt-error") {
        send({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: "scripted prompt failure",
            data: { detail: "nope" },
          },
        });
        return;
      }

      if (mode === "prompt-empty") {
        respond({ stopReason: "end_turn" });
        return;
      }

      if (mode === "prompt-noise") {
        stream("foreign", "fake-acp-session-999");
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "thinking" },
            },
          },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "image", data: "ignored" },
            },
          },
        });
        stream("kept");
        respond({ stopReason: "end_turn" });
        return;
      }

      if (mode === "prompt-late-update") {
        stream("early");
        respond({ stopReason: "end_turn" });
        setTimeout(() => stream("late"), 50);
        return;
      }

      if (mode === "prompt-slow") {
        stream("slow");
        setTimeout(() => respond({ stopReason: "end_turn" }), 100);
        return;
      }

      stream("Hello");
      stream(" world");
      respond({
        stopReason:
          mode === "prompt-cancelled"
            ? "cancelled"
            : mode === "prompt-unknown-stop"
              ? "max_tokens"
              : "end_turn",
      });
      return;
    }
    case "echo":
      send({ jsonrpc: "2.0", id, result: { params } });
      return;
    case "fail":
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: "scripted failure",
          data: { detail: "nope" },
        },
      });
      return;
    case "silent":
      return;
    case "late-echo":
      setTimeout(() => send({ jsonrpc: "2.0", id, result: { params } }), 100);
      return;
    case "notify":
      send({ jsonrpc: "2.0", method: "custom/first", params: { index: 1 } });
      send({ jsonrpc: "2.0", method: "custom/second", params: { index: 2 } });
      send({ jsonrpc: "2.0", id, result: null });
      return;
    case "ask-client": {
      const questionId = 900;
      send({
        jsonrpc: "2.0",
        id: questionId,
        method: "fake/question",
        params: { question: "answer me" },
      });
      clientRequests.set(questionId, (response) => {
        send({ jsonrpc: "2.0", id, result: { answer: response } });
      });
      return;
    }
    case "crash":
      process.exit(1);
      return;
    case "malformed-output":
      process.stdout.write("{not json}\n");
      return;
    case "close-stdout":
      process.stdout.end();
      setInterval(() => {}, 1_000);
      return;
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
}

process.stdin.setEncoding("utf8");

let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;

  let newline = buffer.indexOf("\n");

  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);

    if (line) {
      void handleMessage(JSON.parse(line));
    }

    newline = buffer.indexOf("\n");
  }
});

if (mode === "ignore-shutdown") {
  process.stdin.on("end", () => {});
  setInterval(() => {}, 1_000);
}
