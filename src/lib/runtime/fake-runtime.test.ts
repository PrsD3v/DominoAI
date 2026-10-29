import { describe, expect, it } from "vitest";
import type { AgentRuntime, RuntimeEvent } from "@/types/runtime";
import { createFakeRuntime } from "./fake-runtime";

const WORKSPACE = "/tmp/domino-fake-workspace";

describe("createFakeRuntime", () => {
  it("creates distinct stable session ids", async () => {
    const runtime: AgentRuntime = createFakeRuntime();

    const first = await runtime.createSession({ workspaceRoot: WORKSPACE });
    const second = await runtime.createSession({ workspaceRoot: WORKSPACE });

    expect(first.id).toBe("fake-session-1");
    expect(second.id).toBe("fake-session-2");
  });

  it("streams scripted deltas in order and assembles the result", async () => {
    const runtime = createFakeRuntime([{ deltas: ["Hello, ", "world"] }]);
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });
    const events: RuntimeEvent[] = [];

    const result = await session.prompt({
      text: "Say hello",
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      { type: "assistant_text_delta", text: "Hello, " },
      { type: "assistant_text_delta", text: "world" },
    ]);
    expect(result).toEqual({ text: "Hello, world", stopReason: "completed" });
  });

  it("uses a scripted cancelled stop reason", async () => {
    const runtime = createFakeRuntime([
      { deltas: ["Partial"], stopReason: "cancelled" },
    ]);
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const result = await session.prompt({ text: "Long task", onEvent: () => {} });

    expect(result).toEqual({ text: "Partial", stopReason: "cancelled" });
  });

  it("consumes one scripted turn per prompt", async () => {
    const runtime = createFakeRuntime([
      { deltas: ["first"] },
      { deltas: ["second"] },
    ]);
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    const first = await session.prompt({ text: "One", onEvent: () => {} });
    const second = await session.prompt({ text: "Two", onEvent: () => {} });

    expect(first.text).toBe("first");
    expect(second.text).toBe("second");
  });

  it("rejects a prompt after the script is exhausted", async () => {
    const runtime = createFakeRuntime([{ deltas: ["only"] }]);
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    await session.prompt({ text: "One", onEvent: () => {} });

    await expect(
      session.prompt({ text: "Two", onEvent: () => {} }),
    ).rejects.toThrow("fake runtime has no scripted turn");
  });

  it("reports a stable capability snapshot", () => {
    const runtime = createFakeRuntime();

    expect(runtime.capabilities).toEqual({
      protocolVersion: 1,
      agent: { name: "fake", version: "1.0.0" },
      loadSession: false,
      sessions: { list: false, resume: false, close: true },
    });
  });

  it("closes sessions and the runtime idempotently", async () => {
    const runtime = createFakeRuntime();
    const session = await runtime.createSession({ workspaceRoot: WORKSPACE });

    await expect(session.close()).resolves.toBeUndefined();
    await expect(session.close()).resolves.toBeUndefined();
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(runtime.close()).resolves.toBeUndefined();
  });
});
