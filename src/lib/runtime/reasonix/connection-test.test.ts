import { readdir, stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntime,
  PromptRequest,
  PromptResult,
  Session,
} from "../../../types/runtime";
import { UnsupportedCapabilityError } from "../../../types/runtime";
import type { RuntimeProfile } from "../../../types/runtime-settings";
import type { AcpRuntimeOptions } from "../acp/runtime";
import {
  CONNECTION_TEST_PROMPT,
  DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
  runReasonixConnectionTest,
} from "./connection-test";

const PROFILE: RuntimeProfile = {
  id: "profile-1",
  label: "DeepSeek flash",
  adapterId: "reasonix",
  providerName: "deepseek",
  model: "deepseek-flash",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  credentialRef: {
    kind: "reasonix-env",
    providerName: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
};

interface Harness {
  readonly calls: AcpRuntimeOptions[];
  readonly prompts: string[];
  readonly workspaceModes: number[];
  readonly workspaceEntries: string[][];
  readonly sessionWorkspaces: string[];
  runtimeCloses: number;
  sessionCloses: number;
}

interface RuntimeHandlers {
  createSession?: (workspaceRoot: string) => Promise<Session>;
  prompt?: (request: PromptRequest) => Promise<PromptResult>;
  close?: () => Promise<void>;
}

function createHarness(handlers: RuntimeHandlers = {}): {
  runtime: AgentRuntime;
  state: Harness;
} {
  const state: Harness = {
    calls: [],
    prompts: [],
    workspaceModes: [],
    workspaceEntries: [],
    sessionWorkspaces: [],
    runtimeCloses: 0,
    sessionCloses: 0,
  };
  const session: Session = {
    id: "session-1",
    async prompt(request: PromptRequest): Promise<PromptResult> {
      state.prompts.push(request.text);

      if (handlers.prompt !== undefined) {
        return handlers.prompt(request);
      }

      return { text: "OK", stopReason: "completed" };
    },
    async steer(): Promise<void> {},
    cancel(): void {},
    async close(): Promise<void> {
      state.sessionCloses += 1;
    },
  };
  const runtime: AgentRuntime = {
    capabilities: {
      protocolVersion: 1,
      agent: { name: "fake", version: "1.0.0" },
      loadSession: false,
      sessions: { list: false, resume: false, close: true },
      steering: false,
    },
    async listSessions() {
      return [];
    },
    async createSession(request) {
      state.sessionWorkspaces.push(request.workspaceRoot);

      if (handlers.createSession !== undefined) {
        return handlers.createSession(request.workspaceRoot);
      }

      return session;
    },
    async resumeSession() {
      throw new UnsupportedCapabilityError("sessions.resume");
    },
    async loadSession() {
      throw new UnsupportedCapabilityError("loadSession");
    },
    async close() {
      state.runtimeCloses += 1;
      await handlers.close?.();
    },
  };

  return { runtime, state };
}

function factoryFor(runtime: AgentRuntime, state: Harness) {
  return async (options: AcpRuntimeOptions): Promise<AgentRuntime> => {
    state.calls.push(options);
    const info = await stat(options.cwd as string);
    state.workspaceModes.push(info.mode & 0o777);
    state.workspaceEntries.push(await readdir(options.cwd as string));
    return runtime;
  };
}

async function expectRemoved(path: string | undefined): Promise<void> {
  expect(path).toBeDefined();
  await expect(stat(path as string)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("runReasonixConnectionTest", () => {
  it("runs one read-only prompt in an empty workspace", async () => {
    const { runtime, state } = createHarness();

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({ outcome: "succeeded" });
    expect(state.calls).toHaveLength(1);

    const call = state.calls[0];

    expect(call.command).toBe("reasonix");
    expect(call.args).toEqual([
      "acp",
      "--model",
      "deepseek/deepseek-flash",
      "--permission-mode",
      "read-only",
    ]);
    expect(call.env?.REASONIX_HOME).toBe("/tmp/domino-reasonix-home");
    expect(call.requestTimeoutMs).toBe(DEFAULT_CONNECTION_TEST_TIMEOUT_MS);
    expect(call.cwd).toBeDefined();
    expect(state.workspaceModes[0]).toBe(0o500);
    expect(state.workspaceEntries[0]).toEqual([]);
    expect(state.sessionWorkspaces[0]).toBe(call.cwd);
    expect(state.prompts).toEqual([CONNECTION_TEST_PROMPT]);
    expect(state.sessionCloses).toBe(1);
    expect(state.runtimeCloses).toBe(1);
    await expectRemoved(call.cwd);
  });

  it("maps a workspace failure without starting a runtime", async () => {
    const { runtime, state } = createHarness();

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createWorkspace: async () => {
        throw new Error("no temporary directory");
      },
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({
      outcome: "failed",
      code: "workspace_unavailable",
    });
    expect(state.calls).toHaveLength(0);
  });

  it("maps runtime start failures and removes the workspace", async () => {
    let workspace: string | undefined;

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createRuntime: async (options) => {
        workspace = options.cwd;
        throw new Error("spawn failed");
      },
    });

    expect(result).toEqual({
      outcome: "failed",
      code: "runtime_unavailable",
    });
    await expectRemoved(workspace);
  });

  it("maps session failures, closes the runtime, and removes the workspace", async () => {
    const { runtime, state } = createHarness({
      createSession: async () => {
        throw new Error("session rejected");
      },
    });

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({ outcome: "failed", code: "session_failed" });
    expect(state.runtimeCloses).toBe(1);
    await expectRemoved(state.calls[0]?.cwd);
  });

  it("maps prompt failures, closes both, and removes the workspace", async () => {
    const { runtime, state } = createHarness({
      prompt: async () => {
        throw new Error("provider rejected the request");
      },
    });

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({ outcome: "failed", code: "prompt_failed" });
    expect(state.sessionCloses).toBe(1);
    expect(state.runtimeCloses).toBe(1);
    await expectRemoved(state.calls[0]?.cwd);
  });

  it("treats a non-completed stop reason as cancelled", async () => {
    const { runtime, state } = createHarness({
      prompt: async () => ({ text: "", stopReason: "cancelled" }),
    });

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({ outcome: "failed", code: "cancelled" });
    expect(state.runtimeCloses).toBe(1);
    await expectRemoved(state.calls[0]?.cwd);
  });

  it("times out, closes the runtime, and removes the workspace", async () => {
    const { runtime, state } = createHarness({
      prompt: () => new Promise<PromptResult>(() => {}),
    });

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      timeoutMs: 20,
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({ outcome: "failed", code: "timeout" });
    expect(state.runtimeCloses).toBeGreaterThanOrEqual(1);
    await expectRemoved(state.calls[0]?.cwd);
  });

  it("closes a runtime that resolves after the deadline", async () => {
    const { runtime, state } = createHarness();
    let resolveRuntime: ((value: AgentRuntime) => void) | undefined;

    const result = await runReasonixConnectionTest({
      profile: PROFILE,
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      timeoutMs: 20,
      createRuntime: () =>
        new Promise<AgentRuntime>((resolve) => {
          resolveRuntime = resolve;
        }),
    });

    expect(result).toEqual({ outcome: "failed", code: "timeout" });
    resolveRuntime?.(runtime);
    await vi.waitFor(() => {
      expect(state.runtimeCloses).toBeGreaterThanOrEqual(1);
    });
  });

  it("rejects a persisted profile that no longer validates", async () => {
    const { runtime, state } = createHarness();

    const result = await runReasonixConnectionTest({
      profile: { ...PROFILE, apiKeyEnv: "not a variable" },
      reasonixBin: "reasonix",
      reasonixHome: "/tmp/domino-reasonix-home",
      createRuntime: factoryFor(runtime, state),
    });

    expect(result).toEqual({ outcome: "failed", code: "invalid_profile" });
    expect(state.calls).toHaveLength(0);
  });
});
