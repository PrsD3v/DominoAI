import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntime } from "@/types/runtime";
import { UnsupportedCapabilityError } from "../../../types/runtime";
import { AcpProtocolError, AcpUnsupportedProtocolError } from "./protocol";
import { createAcpRuntime } from "./runtime";
import { JsonRpcError, TransportClosedError } from "./transport";

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

  it("leaves prompt unimplemented without a wire call", async () => {
    const directory = await makeTempDir();
    const logFile = join(directory, "agent.log");
    const runtime = await start({ logFile });
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    await expect(
      session.prompt({ text: "hello", onEvent: () => {} }),
    ).rejects.toThrow("feature 4");

    expect(methods(await readLog(logFile), "session/prompt")).toHaveLength(0);
  });
});
