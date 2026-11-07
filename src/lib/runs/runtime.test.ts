import { describe, expect, it } from "vitest";
import type { AcpRuntimeOptions } from "../runtime/acp/runtime";
import type { RuntimeProfile } from "../../types/runtime-settings";
import { createFakeRuntime } from "../runtime/fake-runtime";
import {
  DEFAULT_RUN_REQUEST_TIMEOUT_MS,
  createReasonixRunRuntime,
} from "./runtime";

const PROFILE: RuntimeProfile = {
  id: "profile-1",
  label: "Local",
  adapterId: "reasonix",
  providerName: "deepseek",
  model: "deepseek-flash",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  credentialRef: {
    kind: "reasonix-env",
    providerName: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
};

describe("createReasonixRunRuntime", () => {
  it("launches Reasonix in the narrowest editing posture", async () => {
    const calls: AcpRuntimeOptions[] = [];
    const runtime = createFakeRuntime();

    const created = await createReasonixRunRuntime({
      profile: PROFILE,
      workspaceRoot: "/workspace/project",
      reasonixBin: "/usr/local/bin/reasonix",
      reasonixHome: "/home/operator/.reasonix",
      createRuntime: async (options) => {
        calls.push(options);
        return runtime;
      },
    });

    expect(created).toBe(runtime);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: "/usr/local/bin/reasonix",
      args: [
        "acp",
        "--model",
        "deepseek/deepseek-flash",
        "--permission-mode",
        "acceptEdits",
        "--workspace-only",
      ],
      cwd: "/workspace/project",
      env: expect.objectContaining({
        REASONIX_HOME: "/home/operator/.reasonix",
      }),
      requestTimeoutMs: DEFAULT_RUN_REQUEST_TIMEOUT_MS,
    });
    expect(DEFAULT_RUN_REQUEST_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("uses an injected request timeout", async () => {
    const calls: AcpRuntimeOptions[] = [];

    await createReasonixRunRuntime({
      profile: PROFILE,
      workspaceRoot: "/workspace/project",
      reasonixBin: "reasonix",
      reasonixHome: "/home/operator/.reasonix",
      requestTimeoutMs: 1234,
      createRuntime: async (options) => {
        calls.push(options);
        return createFakeRuntime();
      },
    });

    expect(calls[0]?.requestTimeoutMs).toBe(1234);
  });
});
