import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { JsonRpcParseError } from "./json-rpc";
import {
  JsonRpcError,
  startTransport,
  TransportClosedError,
  TransportTimeoutError,
  type Transport,
  type TransportOptions,
} from "./transport";

const FIXTURE = fileURLToPath(
  new URL("./test-fixtures/fake-agent.mjs", import.meta.url),
);

const active: Transport[] = [];

async function start(
  options: Partial<TransportOptions> & { mode?: string; pidFile?: string } = {},
): Promise<Transport> {
  const { mode = "default", pidFile, ...rest } = options;

  const transport = await startTransport({
    command: process.execPath,
    args: [FIXTURE],
    env: {
      ...process.env,
      FAKE_AGENT_MODE: mode,
      ...(pidFile ? { FAKE_AGENT_PID_FILE: pidFile } : {}),
    },
    shutdownGraceMs: 100,
    ...rest,
  });

  active.push(transport);
  return transport;
}

afterEach(async () => {
  await Promise.all(active.map((transport) => transport.close()));
  active.length = 0;
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

describe("startTransport", () => {
  it("starts the child and settles a local close", async () => {
    const transport = await start();

    await transport.close();

    await expect(transport.closed).resolves.toEqual({ kind: "shutdown" });
  });

  it("tolerates a repeated close", async () => {
    const transport = await start();

    await Promise.all([transport.close(), transport.close()]);

    await expect(transport.closed).resolves.toEqual({ kind: "shutdown" });
  });

  it("rejects when the command cannot start", async () => {
    await expect(
      startTransport({ command: "/nonexistent/domino-agent" }),
    ).rejects.toThrow();
  });

  it("kills a child that ignores shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domino-transport-"));
    const pidFile = join(directory, "agent.pid");

    try {
      const transport = await start({ mode: "ignore-shutdown", pidFile });
      const pid = await waitForPidFile(pidFile);

      await transport.close();

      expect(() => process.kill(pid, 0)).toThrow();
      await expect(transport.closed).resolves.toEqual({ kind: "shutdown" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Transport.request", () => {
  it("round-trips params and result", async () => {
    const transport = await start();

    await expect(
      transport.request("echo", { value: 42 }),
    ).resolves.toEqual({ params: { value: 42 } });
  });

  it("sends a request without params", async () => {
    const transport = await start();

    await expect(transport.request("echo")).resolves.toEqual({});
  });

  it("resolves concurrent requests to their own results", async () => {
    const transport = await start();

    const results = await Promise.all([
      transport.request("echo", { n: 1 }),
      transport.request("echo", { n: 2 }),
      transport.request("echo", { n: 3 }),
    ]);

    expect(results).toEqual([
      { params: { n: 1 } },
      { params: { n: 2 } },
      { params: { n: 3 } },
    ]);
  });

  it("rejects with the agent error code, message, and data", async () => {
    const transport = await start();

    const error = await transport.request("fail").catch((reason) => reason);

    expect(error).toBeInstanceOf(JsonRpcError);
    expect(error).toMatchObject({
      name: "JsonRpcError",
      method: "fail",
      code: -32000,
      message: "scripted failure",
      data: { detail: "nope" },
    });
  });

  it("times out and leaves the connection usable", async () => {
    const transport = await start();

    const error = await transport
      .request("silent", undefined, { timeoutMs: 20 })
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(TransportTimeoutError);
    expect(error).toMatchObject({ method: "silent", timeoutMs: 20 });

    await expect(
      transport.request("echo", { value: "still open" }),
    ).resolves.toEqual({ params: { value: "still open" } });
  });

  it("drops a response that arrives after its timeout", async () => {
    const transport = await start();

    await expect(
      transport.request("late-echo", { n: 1 }, { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(TransportTimeoutError);

    await new Promise((resolve) => setTimeout(resolve, 150));

    await expect(transport.request("echo", { n: 2 })).resolves.toEqual({
      params: { n: 2 },
    });
  });

  it("rejects after close", async () => {
    const transport = await start();

    await transport.close();

    const error = await transport.request("echo").catch((reason) => reason);

    expect(error).toBeInstanceOf(TransportClosedError);
    expect(error).toMatchObject({
      method: "echo",
      close: { kind: "shutdown" },
    });
  });

  it("rejects a non-positive timeout", async () => {
    const transport = await start();

    await expect(
      transport.request("echo", undefined, { timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("Transport notifications", () => {
  it("delivers to every listener and stops after unsubscribe", async () => {
    const transport = await start();
    const first: string[] = [];
    const second: string[] = [];

    const unsubscribeFirst = transport.onNotification((method) =>
      first.push(method),
    );
    transport.onNotification((method) => second.push(method));

    await transport.request("notify");

    expect(first).toEqual(["custom/first", "custom/second"]);
    expect(second).toEqual(["custom/first", "custom/second"]);

    unsubscribeFirst();
    await transport.request("notify");

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(4);
  });

  it("keeps other listeners and the connection alive when one throws", async () => {
    const transport = await start();
    const received: Array<{ method: string; params: unknown }> = [];

    transport.onNotification(() => {
      throw new Error("listener boom");
    });
    transport.onNotification((method, params) =>
      received.push({ method, params }),
    );

    await transport.request("notify");
    await transport.request("echo", { ok: true });

    expect(received).toEqual([
      { method: "custom/first", params: { index: 1 } },
      { method: "custom/second", params: { index: 2 } },
    ]);
  });

  it("throws when notifying after close", async () => {
    const transport = await start();

    await transport.close();

    expect(() => transport.notify("custom/ping")).toThrow(
      TransportClosedError,
    );
  });
});

describe("Transport agent requests", () => {
  it("answers an incoming request with the handler result", async () => {
    const transport = await start();
    const seen: Array<{ method: string; params: unknown }> = [];

    transport.onRequest((method, params) => {
      seen.push({ method, params });
      return { accepted: true };
    });

    await expect(transport.request("ask-client")).resolves.toEqual({
      answer: { jsonrpc: "2.0", id: 900, result: { accepted: true } },
    });
    expect(seen).toEqual([
      { method: "fake/question", params: { question: "answer me" } },
    ]);
  });

  it("answers null when the handler returns nothing", async () => {
    const transport = await start();

    transport.onRequest(() => {});

    await expect(transport.request("ask-client")).resolves.toEqual({
      answer: { jsonrpc: "2.0", id: 900, result: null },
    });
  });

  it("answers with a method-not-found error when no handler is registered", async () => {
    const transport = await start();

    await expect(transport.request("ask-client")).resolves.toEqual({
      answer: {
        jsonrpc: "2.0",
        id: 900,
        error: { code: -32601, message: "Method not found" },
      },
    });
  });

  it("answers with an internal error when the handler throws", async () => {
    const transport = await start();

    transport.onRequest(() => {
      throw new Error("secret detail");
    });

    const result = await transport.request<{
      answer: { error: { code: number; message: string } };
    }>("ask-client");

    expect(result.answer.error).toEqual({
      code: -32603,
      message: "Internal error",
    });
  });

  it("keeps a single handler and allows a replacement after unsubscribe", async () => {
    const transport = await start();
    const unsubscribe = transport.onRequest(() => ({ first: true }));

    expect(() => transport.onRequest(() => ({ second: true }))).toThrow(
      "already registered",
    );

    unsubscribe();
    transport.onRequest(() => ({ second: true }));

    await expect(transport.request("ask-client")).resolves.toEqual({
      answer: { jsonrpc: "2.0", id: 900, result: { second: true } },
    });
  });
});

describe("Transport failure safety", () => {
  it("rejects pending work when the child crashes", async () => {
    const transport = await start();

    await expect(transport.request("crash")).rejects.toBeInstanceOf(
      TransportClosedError,
    );

    await expect(transport.closed).resolves.toEqual({
      kind: "exit",
      code: 1,
      signal: null,
    });
    await expect(transport.request("echo")).rejects.toBeInstanceOf(
      TransportClosedError,
    );
  });

  it("closes on a malformed line and terminates the child", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domino-transport-"));
    const pidFile = join(directory, "agent.pid");

    try {
      const transport = await start({ pidFile });
      const pid = await waitForPidFile(pidFile);

      const error = await transport
        .request("malformed-output")
        .catch((reason) => reason);

      expect(error).toBeInstanceOf(TransportClosedError);

      const close = (error as TransportClosedError).close;
      expect(close.kind).toBe("protocol");
      if (close.kind === "protocol") {
        expect(close.error).toBeInstanceOf(JsonRpcParseError);
      }

      await transport.close();

      expect(() => process.kill(pid, 0)).toThrow();
      await expect(transport.closed).resolves.toMatchObject({
        kind: "protocol",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("answers while the child floods stderr", async () => {
    const transport = await start({ mode: "stderr-flood" });

    await expect(transport.request("echo", { n: 1 })).resolves.toEqual({
      params: { n: 1 },
    });
  });

  it("ends pending work when the child closes its output", async () => {
    const transport = await start();

    await expect(transport.request("close-stdout")).rejects.toBeInstanceOf(
      TransportClosedError,
    );

    await expect(transport.closed).resolves.toMatchObject({ kind: "exit" });
  });
});
