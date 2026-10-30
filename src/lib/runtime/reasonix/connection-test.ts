import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, Session } from "../../../types/runtime";
import {
  validateRuntimeProfile,
  type ConnectionTestFailureCode,
  type ConnectionTestResult,
  type RuntimeProfile,
} from "../../../types/runtime-settings";
import {
  createAcpRuntime,
  type AcpRuntimeOptions,
} from "../acp/runtime";

/** The one prompt a connection test sends. It asks for no tools or file access. */
export const CONNECTION_TEST_PROMPT =
  "Reply with exactly: OK. Do not call tools, read files, or change anything.";

/** Overall connection-test deadline. */
export const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 60_000;

const WORKSPACE_PREFIX = "domino-connection-test-";
const READ_ONLY_MODE = 0o500;
const OWNER_MODE = 0o700;

export interface ReasonixConnectionTestOptions {
  readonly profile: RuntimeProfile;
  readonly reasonixBin: string;
  readonly reasonixHome: string;
  readonly timeoutMs?: number;
  /** Test seam. Defaults to the ACP runtime factory. */
  readonly createRuntime?: (
    options: AcpRuntimeOptions,
  ) => Promise<AgentRuntime>;
  /** Test seam. Defaults to a private empty directory under the OS temp dir. */
  readonly createWorkspace?: () => Promise<string>;
}

function failed(code: ConnectionTestFailureCode): ConnectionTestResult {
  return { outcome: "failed", code };
}

async function prepareWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), WORKSPACE_PREFIX));

  try {
    await chmod(workspace, READ_ONLY_MODE);
  } catch (error) {
    await removeWorkspace(workspace);
    throw error;
  }

  return workspace;
}

async function removeWorkspace(workspace: string): Promise<void> {
  try {
    await chmod(workspace, OWNER_MODE);
  } catch {
    // The directory may already be gone or partly removed.
  }

  try {
    await rm(workspace, { recursive: true, force: true });
  } catch {
    // Cleanup failure must not replace an already typed result.
  }
}

async function closeQuietly(
  target: { close(): Promise<void> } | null,
): Promise<void> {
  try {
    await target?.close();
  } catch {
    // A failed close is already reflected by the step that needed it.
  }
}

async function execute(
  options: ReasonixConnectionTestOptions,
  workspace: string,
): Promise<ConnectionTestResult> {
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_CONNECTION_TEST_TIMEOUT_MS;
  const createRuntime = options.createRuntime ?? createAcpRuntime;
  let runtime: AgentRuntime | null = null;
  let runtimePromise: Promise<AgentRuntime> | null = null;
  let session: Session | null = null;
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<ConnectionTestResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(failed("timeout"));
    }, timeoutMs);
  });

  const work = (async (): Promise<ConnectionTestResult> => {
    try {
      runtimePromise = createRuntime({
        command: options.reasonixBin,
        args: [
          "acp",
          "--model",
          `${options.profile.providerName}/${options.profile.model}`,
          "--permission-mode",
          "read-only",
        ],
        cwd: workspace,
        env: { ...process.env, REASONIX_HOME: options.reasonixHome },
        requestTimeoutMs: timeoutMs,
      });
      runtime = await runtimePromise;
    } catch {
      return failed("runtime_unavailable");
    }

    try {
      session = await runtime.createSession({ workspaceRoot: workspace });
    } catch {
      return failed("session_failed");
    }

    let result;

    try {
      result = await session.prompt({
        text: CONNECTION_TEST_PROMPT,
        onEvent: () => {},
      });
    } catch {
      return failed("prompt_failed");
    }

    return result.stopReason === "completed"
      ? { outcome: "succeeded" }
      : failed("cancelled");
  })();

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (timedOut) {
      if (runtime !== null) {
        await closeQuietly(runtime);
      } else {
        const pendingRuntime = runtimePromise as Promise<AgentRuntime> | null;

        if (pendingRuntime !== null) {
          // The deadline can win before startup resolves. Close the late
          // runtime instead of leaving its child process behind.
          void pendingRuntime
            .then((lateRuntime) => closeQuietly(lateRuntime))
            .catch(() => {});
        }
      }
    }

    await closeQuietly(session);
    await closeQuietly(runtime);
  }
}

/**
 * Run one ACP prompt against the selected profile in an empty read-only
 * workspace. Expected failures become typed results; nothing from the runtime
 * error crosses this boundary.
 */
export async function runReasonixConnectionTest(
  options: ReasonixConnectionTestOptions,
): Promise<ConnectionTestResult> {
  if (validateRuntimeProfile(options.profile).length > 0) {
    return failed("invalid_profile");
  }

  let workspace: string;

  try {
    workspace =
      options.createWorkspace === undefined
        ? await prepareWorkspace()
        : await options.createWorkspace();
  } catch {
    return failed("workspace_unavailable");
  }

  try {
    // The injected workspace seam is also expected to be private and empty.
    return await execute(options, workspace);
  } finally {
    await removeWorkspace(workspace);
  }
}
