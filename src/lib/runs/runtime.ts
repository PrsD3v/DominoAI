import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type { AgentRuntime } from "../../types/runtime";
import type { RuntimeProfile } from "../../types/runtime-settings";
import {
  createAcpRuntime,
  type AcpRuntimeOptions,
} from "../runtime/acp/runtime";
import { ReasonixEnvFileStore } from "../runtime/reasonix/env-file-store";
import {
  resolveSettingsPaths,
  type SettingsEnvironment,
} from "../settings/runtime";
import { createWorkflowEngine } from "../workflow/engine";
import { openSqliteWorkflowStore } from "../workflow/sqlite/sqlite-store";
import { reconcileInterruptedRuns } from "../workflow/startup-reconciliation";
import { createRunService, type RunService } from "./service";

/** Workflow steps may run much longer than the transport's 30-second default. */
export const DEFAULT_RUN_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

const RUN_PERMISSION_MODE = "acceptEdits";

export interface ReasonixRunRuntimeOptions {
  readonly profile: RuntimeProfile;
  readonly workspaceRoot: string;
  readonly reasonixBin: string;
  readonly reasonixHome: string;
  readonly requestTimeoutMs?: number;
  /** Test seam. Defaults to the ACP runtime factory. */
  readonly createRuntime?: (
    options: AcpRuntimeOptions,
  ) => Promise<AgentRuntime>;
}

/**
 * Launch one Reasonix ACP runtime for a workflow run. The narrowest installed
 * editing posture lets the agent change files, while `--workspace-only` keeps
 * writes inside the session cwd. This is a launch contract, not live proof.
 */
export function createReasonixRunRuntime(
  options: ReasonixRunRuntimeOptions,
): Promise<AgentRuntime> {
  const createRuntime = options.createRuntime ?? createAcpRuntime;

  return createRuntime({
    command: options.reasonixBin,
    args: [
      "acp",
      "--model",
      `${options.profile.providerName}/${options.profile.model}`,
      "--permission-mode",
      RUN_PERMISSION_MODE,
      "--workspace-only",
    ],
    cwd: options.workspaceRoot,
    env: { ...process.env, REASONIX_HOME: options.reasonixHome },
    requestTimeoutMs:
      options.requestTimeoutMs ?? DEFAULT_RUN_REQUEST_TIMEOUT_MS,
  });
}

/**
 * Build the process-wide run service: one local store, startup reconciliation,
 * and a Reasonix runtime per run. No credential value is read.
 */
export async function createRunServiceFromEnvironment(
  env: SettingsEnvironment = process.env,
  homeDir: string = homedir(),
  cwd: string = process.cwd(),
): Promise<RunService> {
  const paths = resolveSettingsPaths(env, homeDir, cwd);

  mkdirSync(dirname(paths.databasePath), { recursive: true, mode: 0o700 });

  const store = openSqliteWorkflowStore({ path: paths.databasePath });
  const credentials = new ReasonixEnvFileStore({
    homeDir: paths.reasonixHome,
  });
  const now = (): string => new Date().toISOString();
  const engine = createWorkflowEngine({
    persistence: store,
    idFactory: () => randomUUID(),
    now,
  });
  const service = createRunService({
    persistence: store,
    credentials,
    engine,
    createRuntime: (request) =>
      createReasonixRunRuntime({
        profile: request.profile,
        workspaceRoot: request.workspaceRoot,
        reasonixBin: paths.reasonixBin,
        reasonixHome: paths.reasonixHome,
      }),
  });

  await reconcileInterruptedRuns({ persistence: store, now });

  return service;
}

const globalForRuns = globalThis as typeof globalThis & {
  __dominoRunService?: Promise<RunService>;
};

/** Return the single process-wide run service, opening it on first use. */
export function getRunService(): Promise<RunService> {
  if (globalForRuns.__dominoRunService === undefined) {
    globalForRuns.__dominoRunService = createRunServiceFromEnvironment().catch(
      (error: unknown) => {
        globalForRuns.__dominoRunService = undefined;
        throw error;
      },
    );
  }

  return globalForRuns.__dominoRunService;
}
