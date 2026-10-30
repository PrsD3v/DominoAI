import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntime, RuntimeEvent } from "@/types/runtime";
import { UnsupportedCapabilityError } from "../../../types/runtime";
import {
  AcpProtocolError,
  AcpUnsupportedProtocolError,
  AcpUnsupportedStopReasonError,
} from "./protocol";
import { createAcpRuntime } from "./runtime";
import {
  JsonRpcError,
  TransportClosedError,
  TransportTimeoutError,
} from "./transport";

const FIXTURE = fileURLToPath(
  new URL("./test-fixtures/fake-agent.mjs", import.meta.url),
);
const WORKSPACE = "/tmp/domino-fake-workspace";

interface LoggedMessage {
  method?: string;
  params?: unknown;
}

const active: AgentRuntime[] = [];
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-acp-runtime-"));
  tempDirs.push(directory);
  return directory;
}

interface StartOptions {
  mode?: string;
  pidFile?: string;
  logFile?: string;
  requestTimeoutMs?: number;
}

async function start(options: StartOptions = {}): Promise<AgentRuntime> {
  const runtime = await createAcpRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: {
      ...process.env,
      ...(options.mode ? { FAKE_AGENT_MODE: options.mode } : {}),
      ...(options.pidFile ? { FAKE_AGENT_PID_FILE: options.pidFile } : {}),
      ...(options.logFile ? { FAKE_AGENT_LOG_FILE: options.logFile } : {}),
    },
    shutdownGraceMs: 100,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  active.push(runtime);
  return runtime;
}

afterEach(async () => {
  await Promise.all(active.map((runtime) => runtime.close()));
  active.length = 0;
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, "utf8");
      if (content.length > 0) {
        return Number(content);
      }
    } catch {
      // The child has not written the file yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("fake agent did not report its pid");
}

async function readLog(path: string): Promise<LoggedMessage[]> {
  const content = await readFile(path, "utf8");

  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LoggedMessage);
}

function methods(log: LoggedMessage[], method: string): LoggedMessage[] {
  return log.filter((message) => message.method === method);
}

describe("createAcpRuntime handshake", () => {
  it("records the reported capabilities and sends initialized", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ logFile });

    expect(runtime.capabilities).toEqual({
      protocolVersion: 1,
      agent: { name: "fake-agent", version: "1.0.0" },
      loadSession: true,
      sessions: { list: true, resume: true, close: true },
    });

    const log = await readLog(logFile);

    expect(methods(log, "initialize")[0]?.params).toEqual({
      protocolVersion: 1,
      clientInfo: { name: "domino", version: "0.1.0" },
      clientCapabilities: {},
    });
    expect(methods(log, "initialized")).toHaveLength(1);
  });

  it("surfaces an initialize error and shuts the process down", async () => {
    const directory = await makeTempDir();
    const pidFile = join(directory, "agent.pid");

    const error = await start({ mode: "initialize-error", pidFile }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(JsonRpcError);
    expect(error).toMatchObject({
      method: "initialize",
      code: -32000,
      message: "scripted initialize failure",
    });

    const pid = await waitForPidFile(pidFile);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("rejects an unsupported protocol version and shuts the process down", async () => {
    const directory = await makeTempDir();
    const pidFile = join(directory, "agent.pid");

    const error = await start({ mode: "protocol-2", pidFile }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(AcpUnsupportedProtocolError);
    expect(error).toMatchObject({
      reportedVersion: 2,
      supportedVersion: 1,
    });

    const pid = await waitForPidFile(pidFile);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("runtime shutdown", () => {
  it("settles concurrent closes with one shutdown and the process gone", async () => {
    const directory = await makeTempDir();
    const pidFile = join(directory, "agent.pid");
    const runtime = await start({ pidFile });
    const pid = await waitForPidFile(pidFile);

    await Promise.all([runtime.close(), runtime.close()]);
    await expect(runtime.close()).resolves.toBeUndefined();

    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("rejects new sessions without sending them after shutdown starts", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ logFile });

    await runtime.close();

    const error = await runtime
      .createSession({ workspaceRoot: WORKSPACE })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(error).toMatchObject({
      method: "session/new",
      close: { kind: "shutdown" },
    });

    expect(methods(await readLog(logFile), "session/new")).toHaveLength(0);
  });

  it("rejects a pending session/new when shutdown starts", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ mode: "slow-session-new", logFile });

    const pending = runtime.createSession({ workspaceRoot: WORKSPACE });
    const shutdown = runtime.close();

    const error = await pending.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(error).toMatchObject({
      method: "session/new",
      close: { kind: "shutdown" },
    });

    await shutdown;

    expect(methods(await readLog(logFile), "session/new")).toHaveLength(1);
  });
});

describe("session lifecycle", () => {
  it("sends the workspace root and closes the reported session", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ logFile });

    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    expect(session.id).toBe("fake-acp-session-1");

    await session.close();

    const log = await readLog(logFile);

    expect(methods(log, "session/new")[0]?.params).toEqual({
      cwd: WORKSPACE,
      mcpServers: [],
    });
    expect(methods(log, "session/close")[0]?.params).toEqual({
      sessionId: "fake-acp-session-1",
    });
  });

  it("returns distinct ids for separate sessions", async () => {
    const runtime = await start();

    const first = await runtime.createSession({ workspaceRoot: WORKSPACE });
    const second = await runtime.createSession({ workspaceRoot: WORKSPACE });

    expect([first.id, second.id]).toEqual([
      "fake-acp-session-1",
      "fake-acp-session-2",
    ]);
  });

  it("sends one close request for repeated and concurrent closes", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    await session.close();
    await session.close();
    await Promise.all([session.close(), session.close()]);

    expect(methods(await readLog(logFile), "session/close")).toHaveLength(1);
  });

  it("shares a close failure with concurrent waiters and allows a retry", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ mode: "close-fails-once", logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const results = await Promise.allSettled([
      session.close(),
      session.close(),
    ]);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toBe(rejected[1].reason);
    expect(rejected[0].reason).toBeInstanceOf(JsonRpcError);
    expect(methods(await readLog(logFile), "session/close")).toHaveLength(1);

    await expect(session.close()).resolves.toBeUndefined();
    expect(methods(await readLog(logFile), "session/close")).toHaveLength(2);

    await expect(session.close()).resolves.toBeUndefined();
    expect(methods(await readLog(logFile), "session/close")).toHaveLength(2);
  });

  it("does not retry a failed close once the runtime is closing", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ mode: "close-fails-once", logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    await expect(session.close()).rejects.toBeInstanceOf(JsonRpcError);
    await runtime.close();

    const error = await session.close().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(methods(await readLog(logFile), "session/close")).toHaveLength(1);
  });

  it("refuses to close when the runtime did not advertise the capability", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ mode: "no-close-capability", logFile });

    expect(runtime.capabilities.sessions.close).toBe(false);

    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });
    const error = await session.close().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UnsupportedCapabilityError);
    expect(error).toMatchObject({
      name: "UnsupportedCapabilityError",
      capability: "sessions.close",
    });
    expect(methods(await readLog(logFile), "session/close")).toHaveLength(0);
  });

  it("rejects a malformed session/new result", async () => {
    const runtime = await start({ mode: "malformed-session-new" });

    await expect(
      runtime.createSession({ workspaceRoot: WORKSPACE }),
    ).rejects.toBeInstanceOf(AcpProtocolError);
  });
});

describe("session prompt", () => {
  async function startSession(
    mode?: string,
    logFile?: string,
    requestTimeoutMs?: number,
  ) {
    const runtime = await start({ mode, logFile, requestTimeoutMs });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    return { runtime, session };
  }

  it("sends the exact params and streams ordered text deltas", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession(undefined, logFile);
    const events: RuntimeEvent[] = [];

    const result = await session.prompt({
      text: "hello",
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ text: "Hello world", stopReason: "completed" });
    expect(events).toEqual([
      { type: "assistant_text_delta", text: "Hello" },
      { type: "assistant_text_delta", text: " world" },
    ]);

    const prompts = methods(await readLog(logFile), "session/prompt");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.params).toEqual({
      sessionId: session.id,
      prompt: [{ type: "text", text: "hello" }],
    });
  });

  it("maps the cancelled stop reason", async () => {
    const { session } = await startSession("prompt-cancelled");

    const result = await session.prompt({ text: "stop", onEvent: () => {} });

    expect(result).toEqual({ text: "Hello world", stopReason: "cancelled" });
  });

  it("rejects an unproven stop reason with the reported value", async () => {
    const { session } = await startSession("prompt-unknown-stop");

    const error = await session
      .prompt({ text: "hello", onEvent: () => {} })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AcpUnsupportedStopReasonError);
    expect(error).toMatchObject({ reportedStopReason: "max_tokens" });
  });

  it("propagates a prompt error", async () => {
    const { session } = await startSession("prompt-error");

    const error = await session
      .prompt({ text: "hello", onEvent: () => {} })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(JsonRpcError);
    expect(error).toMatchObject({
      method: "session/prompt",
      code: -32000,
      message: "scripted prompt failure",
    });
  });

  it("returns empty text when the turn has no chunks", async () => {
    const { session } = await startSession("prompt-empty");
    const events: RuntimeEvent[] = [];

    const result = await session.prompt({
      text: "hello",
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ text: "", stopReason: "completed" });
    expect(events).toEqual([]);
  });

  it("ignores foreign sessions, other update kinds, and non-text content", async () => {
    const { session } = await startSession("prompt-noise");
    const events: RuntimeEvent[] = [];

    const result = await session.prompt({
      text: "hello",
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ text: "kept", stopReason: "completed" });
    expect(events).toEqual([{ type: "assistant_text_delta", text: "kept" }]);
  });

  it("rejects a second prompt while one is active", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession("prompt-slow", logFile);

    const first = session.prompt({ text: "first", onEvent: () => {} });

    await expect(
      session.prompt({ text: "second", onEvent: () => {} }),
    ).rejects.toThrow("active prompt");

    await expect(first).resolves.toEqual({
      text: "slow",
      stopReason: "completed",
    });
    expect(methods(await readLog(logFile), "session/prompt")).toHaveLength(1);
  });

  it("rejects a prompt after session close without a wire call", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession(undefined, logFile);

    await session.close();

    await expect(
      session.prompt({ text: "hello", onEvent: () => {} }),
    ).rejects.toThrow("session is closed");
    expect(methods(await readLog(logFile), "session/prompt")).toHaveLength(0);
  });

  it("rejects a prompt after runtime shutdown without a wire call", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { runtime, session } = await startSession(undefined, logFile);

    await runtime.close();

    const error = await session
      .prompt({ text: "hello", onEvent: () => {} })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(error).toMatchObject({
      method: "session/prompt",
      close: { kind: "shutdown" },
    });
    expect(methods(await readLog(logFile), "session/prompt")).toHaveLength(0);
  });

  it("emits no event after the prompt settles", async () => {
    const { session } = await startSession("prompt-late-update");
    const events: RuntimeEvent[] = [];

    const result = await session.prompt({
      text: "hello",
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ text: "early", stopReason: "completed" });

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(events).toEqual([{ type: "assistant_text_delta", text: "early" }]);
  });

  it("keeps accumulated text when the event callback throws", async () => {
    const { session } = await startSession();

    const result = await session.prompt({
      text: "hello",
      onEvent: () => {
        throw new Error("callback boom");
      },
    });

    expect(result).toEqual({ text: "Hello world", stopReason: "completed" });
  });
});

describe("session cancel", () => {
  async function startSession(mode?: string, logFile?: string) {
    const runtime = await start({ mode, logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    return { runtime, session };
  }

  it("sends one cancel notification and reports the cancelled result", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession("prompt-cancel", logFile);
    const events: RuntimeEvent[] = [];

    const pending = session.prompt({
      text: "stop",
      onEvent: (event) => events.push(event),
    });

    session.cancel();

    await expect(pending).resolves.toEqual({
      text: "partial",
      stopReason: "cancelled",
    });
    expect(events).toEqual([{ type: "assistant_text_delta", text: "partial" }]);

    const cancels = methods(await readLog(logFile), "session/cancel");

    expect(cancels).toHaveLength(1);
    expect(cancels[0]).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: session.id },
    });
  });

  it("sends at most one cancel notification per active prompt", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession("prompt-cancel", logFile);

    const pending = session.prompt({ text: "stop", onEvent: () => {} });

    session.cancel();
    session.cancel();

    await expect(pending).resolves.toMatchObject({ stopReason: "cancelled" });
    expect(methods(await readLog(logFile), "session/cancel")).toHaveLength(1);
  });

  it("keeps the real result when the agent ignores the cancel", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession("prompt-cancel-ignored", logFile);

    const pending = session.prompt({ text: "stop", onEvent: () => {} });

    session.cancel();

    await expect(pending).resolves.toEqual({
      text: "partial",
      stopReason: "completed",
    });
    expect(methods(await readLog(logFile), "session/cancel")).toHaveLength(1);
  });

  it("does nothing when no prompt is active", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const { session } = await startSession(undefined, logFile);

    expect(() => session.cancel()).not.toThrow();

    await session.prompt({ text: "hello", onEvent: () => {} });
    session.cancel();

    await session.close();
    expect(() => session.cancel()).not.toThrow();

    expect(methods(await readLog(logFile), "session/cancel")).toHaveLength(0);
  });
});

describe("prompt failure safety", () => {
  it("rejects a timed-out prompt and clears the active-prompt guard", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({
      mode: "prompt-silent",
      logFile,
      requestTimeoutMs: 500,
    });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const started = Date.now();

    await expect(
      session.prompt({ text: "wait", onEvent: () => {} }),
    ).rejects.toBeInstanceOf(TransportTimeoutError);
    await expect(
      session.prompt({ text: "again", onEvent: () => {} }),
    ).rejects.toBeInstanceOf(TransportTimeoutError);

    expect(Date.now() - started).toBeLessThan(2_000);

    await expect(session.close()).resolves.toBeUndefined();
    expect(methods(await readLog(logFile), "session/close")).toHaveLength(1);
  });

  it("emits no event after a timed-out prompt settles", async () => {
    const runtime = await start({
      mode: "prompt-late-after-timeout",
      requestTimeoutMs: 500,
    });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });
    const events: RuntimeEvent[] = [];

    await expect(
      session.prompt({
        text: "wait",
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toBeInstanceOf(TransportTimeoutError);

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(events).toEqual([{ type: "assistant_text_delta", text: "early" }]);
  });

  it("rejects an active prompt when the child crashes", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ mode: "prompt-crash", logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const error = await session
      .prompt({ text: "die", onEvent: () => {} })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(error).toMatchObject({
      method: "session/prompt",
      close: { kind: "exit", code: 1, signal: null },
    });

    await expect(
      session.prompt({ text: "again", onEvent: () => {} }),
    ).rejects.toBeInstanceOf(TransportClosedError);
  });

  it("rejects an active prompt when the child ends stdout", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ mode: "prompt-eof", logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const error = await session
      .prompt({ text: "gone", onEvent: () => {} })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect((error as TransportClosedError).close.kind).toBe("exit");

    await expect(
      runtime.createSession({ workspaceRoot: WORKSPACE }),
    ).rejects.toBeInstanceOf(TransportClosedError);
  });

  it("rejects an active prompt when the runtime closes", async () => {
    const runtime = await start({ mode: "prompt-silent" });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const pending = session.prompt({ text: "wait", onEvent: () => {} });
    const closing = runtime.close();

    const error = await pending.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(error).toMatchObject({
      method: "session/prompt",
      close: { kind: "shutdown" },
    });

    await closing;
  });
});
