import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Why a requested step path was refused. */
export type WorkspaceContainmentReason =
  | "absolute"
  | "missing"
  | "not-directory"
  | "outside";

/** Raised when a step path cannot be used inside the workspace root. */
export class WorkspaceContainmentError extends Error {
  readonly reason: WorkspaceContainmentReason;
  readonly workspaceRoot: string;
  readonly requestedPath: string;

  constructor(
    reason: WorkspaceContainmentReason,
    workspaceRoot: string,
    requestedPath: string,
  ) {
    const label = requestedPath.length === 0 ? "." : requestedPath;

    super(`Step path "${label}" is not a usable workspace path (${reason})`);
    this.name = "WorkspaceContainmentError";
    this.reason = reason;
    this.workspaceRoot = workspaceRoot;
    this.requestedPath = requestedPath;
  }
}

/** Inputs for one per-step containment check. */
export interface ResolveContainedStepPathOptions {
  readonly workspaceRoot: string;
  readonly workingDirectory?: string;
}

/**
 * Resolve the workspace root and the requested step path, including symlink
 * targets, and return the target only when it is a directory inside the root.
 */
export async function resolveContainedStepPath(
  options: ResolveContainedStepPathOptions,
): Promise<string> {
  const { workspaceRoot, workingDirectory } = options;
  const requestedPath = workingDirectory ?? "";

  if (workingDirectory !== undefined && isAbsolute(workingDirectory)) {
    throw new WorkspaceContainmentError(
      "absolute",
      workspaceRoot,
      requestedPath,
    );
  }

  const canonicalRoot = await canonicalDirectory(workspaceRoot, requestedPath);
  const target =
    workingDirectory === undefined || workingDirectory.length === 0
      ? canonicalRoot
      : resolve(canonicalRoot, workingDirectory);
  const canonicalTarget = await canonicalDirectory(target, requestedPath);
  const relativePath = relative(canonicalRoot, canonicalTarget);

  if (relativePath.length === 0) {
    return canonicalTarget;
  }

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new WorkspaceContainmentError("outside", workspaceRoot, requestedPath);
  }

  return canonicalTarget;
}

async function canonicalDirectory(
  pathToResolve: string,
  requestedPath: string,
): Promise<string> {
  let resolved: string;

  try {
    resolved = await realpath(pathToResolve);
  } catch {
    throw new WorkspaceContainmentError(
      "missing",
      pathToResolve,
      requestedPath,
    );
  }

  let stats;

  try {
    stats = await stat(resolved);
  } catch {
    throw new WorkspaceContainmentError(
      "missing",
      pathToResolve,
      requestedPath,
    );
  }

  if (!stats.isDirectory()) {
    throw new WorkspaceContainmentError(
      "not-directory",
      pathToResolve,
      requestedPath,
    );
  }

  return resolved;
}
