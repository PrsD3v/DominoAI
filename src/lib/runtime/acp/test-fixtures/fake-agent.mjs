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

const clientRequests = new Map();

let flooded = null;

function floodStderr() {
  if (!flooded) {
    flooded = new Promise((resolve) => {
      process.stderr.write("x".repeat(200_000), resolve);
    });
  }

  return flooded;
}

async function handleMessage(message) {
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
