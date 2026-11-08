import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcpRuntimeOptions } from "../runtime/acp/runtime";
import type { RuntimeProfile } from "../../types/runtime-settings";
import { createFakeRuntime } from "../runtime/fake-runtime";
import {
  DEFAULT_RUN_REQUEST_TIMEOUT_MS,
  createReasonixRunRuntime,
  createRunServiceFromEnvironment,
} from "./runtime";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-run-runtime-"));
  directories.push(directory);
  return directory;
}

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

describe("createRunServiceFromEnvironment", () => {
  it("seeds the MVP definition once on an empty database", async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, "domino.db");
    const homeDir = join(directory, "home");
    await mkdir(homeDir, { recursive: true });
    const env = { DOMINO_DB_PATH: databasePath };

    const first = await createRunServiceFromEnvironment(env, homeDir, directory);
    const firstCatalog = await first.listWorkflows();

    expect(firstCatalog.definitions).toEqual([
      { id: "mvp-workflow", name: "MVP three-step workflow" },
    ]);
    expect(firstCatalog.versions).toHaveLength(1);
    expect(firstCatalog.versions[0]?.id).toBe("mvp-workflow-v1");

    const second = await createRunServiceFromEnvironment(
      env,
      homeDir,
      directory,
    );

    await expect(second.listWorkflows()).resolves.toEqual(firstCatalog);
  });
});
