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

let flooded = null;
let nextSessionId = 1;
let closeAttempts = 0;

function initializeResult() {
  const sessionCapabilities = {
    list: {},
    resume: {},
    ...(mode === "no-close-capability" ? {} : { close: {} }),
    delete: {},
    additionalDirectories: {},
  };

  return {
    protocolVersion: mode === "protocol-2" ? 2 : 1,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: { http: true, sse: false },
      _meta: {
        "reasonix.io": {
          sessionSteer: { method: "_reasonix.io/session/steer" },
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
