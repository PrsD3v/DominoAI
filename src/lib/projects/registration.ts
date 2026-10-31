import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type {
  Project,
  ProjectPersistence,
  PublishedDefinitionPersistence,
  RuntimeProfilePersistence,
} from "@/types/persistence";

/** Why a project could not be registered. */
export type ProjectRegistrationErrorReason =
  | "invalid-name"
  | "invalid-configuration"
  | "invalid-profile-id"
  | "unknown-profile-id"
  | "root-missing"
  | "root-not-directory"
  | "root-inaccessible"
  | "duplicate-root"
  | "duplicate-selection"
  | "unknown-workflow-version"
  | "unknown-skill-version";

/** Optional context for a registration failure. */
export interface ProjectRegistrationErrorDetails {
  readonly workspaceRoot?: string;
  readonly versionId?: string;
  readonly profileId?: string;
}

/** Raised when registration input cannot become a stored project. */
export class ProjectRegistrationError extends Error {
  readonly reason: ProjectRegistrationErrorReason;
  readonly workspaceRoot?: string;
  readonly versionId?: string;
  readonly profileId?: string;

  constructor(
    reason: ProjectRegistrationErrorReason,
    details: ProjectRegistrationErrorDetails = {},
  ) {
    super(describe(reason, details));
    this.name = "ProjectRegistrationError";
    this.reason = reason;

    if (details.workspaceRoot !== undefined) {
      this.workspaceRoot = details.workspaceRoot;
    }

    if (details.versionId !== undefined) {
      this.versionId = details.versionId;
    }

    if (details.profileId !== undefined) {
      this.profileId = details.profileId;
    }
  }
}

function describe(
  reason: ProjectRegistrationErrorReason,
  details: ProjectRegistrationErrorDetails,
): string {
  const workspaceRoot = details.workspaceRoot ?? "";
  const versionId = details.versionId ?? "";

  switch (reason) {
    case "invalid-name":
      return "The project name must not be empty";
    case "invalid-configuration":
      return "The project configuration must be a JSON-serializable object";
    case "invalid-profile-id":
      return "The default runtime profile id must be a non-empty string";
    case "unknown-profile-id":
      return `Runtime profile "${details.profileId ?? ""}" is not persisted`;
    case "root-missing":
      return `Workspace root "${workspaceRoot}" does not exist`;
    case "root-not-directory":
      return `Workspace root "${workspaceRoot}" is not a directory`;
    case "root-inaccessible":
      return `Workspace root "${workspaceRoot}" cannot be accessed`;
    case "duplicate-root":
      return `A project is already registered for workspace root "${workspaceRoot}"`;
    case "duplicate-selection":
      return `Version id "${versionId}" is selected more than once`;
    case "unknown-workflow-version":
      return `Workflow version "${versionId}" is not published`;
    case "unknown-skill-version":
      return `Skill version "${versionId}" is not published`;
  }
}

/** Everything needed to register one workspace as a project. */
export interface ProjectRegistrationInput {
  readonly name: string;
  readonly workspaceRoot: string;
  readonly configuration?: Record<string, unknown>;
  readonly defaultRuntimeProfileId?: string;
  readonly workflowVersionIds?: readonly string[];
  readonly skillVersionIds?: readonly string[];
}

/** Persistence a registration needs. */
export interface ProjectRegistrationStore
  extends ProjectPersistence,
    PublishedDefinitionPersistence,
    RuntimeProfilePersistence {}

/** Inputs for one registration. */
export interface RegisterProjectOptions extends ProjectRegistrationInput {
  readonly store: ProjectRegistrationStore;
}

/**
 * Validate and store a workspace as a project.
 *
 * All validation runs before `createProject`, so a rejected registration
 * writes nothing. The returned record is read back from persistence.
 */
export async function registerProject(
  options: RegisterProjectOptions,
): Promise<Project> {
  const { store, name } = options;
  const configuration = options.configuration ?? {};

  validateName(name);
  validateConfiguration(configuration);
  const defaultRuntimeProfileId = validateProfileId(
    options.defaultRuntimeProfileId,
  );
  await verifyProfileReference(store, defaultRuntimeProfileId);
  const workspaceRoot = await resolveWorkspaceRoot(options.workspaceRoot);
  await rejectDuplicateRoot(store, workspaceRoot);

  const workflowVersionIds = [...(options.workflowVersionIds ?? [])];
  const skillVersionIds = [...(options.skillVersionIds ?? [])];
  await verifySelections(store, workflowVersionIds, skillVersionIds);

  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name,
    workspaceRoot,
    configuration,
    ...(defaultRuntimeProfileId === undefined
      ? {}
      : { defaultRuntimeProfileId }),
    workflowVersionIds,
    skillVersionIds,
    createdAt: now,
    updatedAt: now,
  };

  await store.createProject(project);

  const stored = await store.getProject(project.id);

  if (stored === null) {
    throw new Error(`Project "${project.id}" was not found after creation`);
  }

  return stored;
}

function validateName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ProjectRegistrationError("invalid-name");
  }
}

function validateConfiguration(
  configuration: unknown,
): asserts configuration is Record<string, unknown> {
  if (!isRecord(configuration)) {
    throw new ProjectRegistrationError("invalid-configuration");
  }

  try {
    JSON.stringify(configuration);
  } catch {
    throw new ProjectRegistrationError("invalid-configuration");
  }
}

function validateProfileId(
  defaultRuntimeProfileId: unknown,
): string | undefined {
  if (defaultRuntimeProfileId === undefined) {
    return undefined;
  }

  if (
    typeof defaultRuntimeProfileId !== "string" ||
    defaultRuntimeProfileId.length === 0
  ) {
    throw new ProjectRegistrationError("invalid-profile-id");
  }

  return defaultRuntimeProfileId;
}

async function verifyProfileReference(
  store: ProjectRegistrationStore,
  profileId: string | undefined,
): Promise<void> {
  if (profileId === undefined) {
    return;
  }

  if ((await store.getRuntimeProfile(profileId)) === null) {
    throw new ProjectRegistrationError("unknown-profile-id", { profileId });
  }
}

async function resolveWorkspaceRoot(workspaceRoot: unknown): Promise<string> {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    throw new ProjectRegistrationError("root-missing", {
      workspaceRoot: typeof workspaceRoot === "string" ? workspaceRoot : "",
    });
  }

  const resolved = await resolveExistingPath(workspaceRoot);
  let info: Stats;

  try {
    info = await stat(resolved);
  } catch (error) {
    throw mapRootError(error, resolved);
  }

  if (!info.isDirectory()) {
    throw new ProjectRegistrationError("root-not-directory", {
      workspaceRoot: resolved,
    });
  }

  return resolved;
}

async function resolveExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw mapRootError(error, path);
  }
}

function mapRootError(error: unknown, workspaceRoot: string): unknown {
  const code = isNodeError(error) ? error.code : undefined;

  if (code === "ENOENT") {
    return new ProjectRegistrationError("root-missing", { workspaceRoot });
  }

  if (code === "EACCES" || code === "EPERM") {
    return new ProjectRegistrationError("root-inaccessible", { workspaceRoot });
  }

  return error;
}

async function rejectDuplicateRoot(
  store: ProjectRegistrationStore,
  workspaceRoot: string,
): Promise<void> {
  const existing = await store.listProjects();

  if (existing.some((project) => project.workspaceRoot === workspaceRoot)) {
    throw new ProjectRegistrationError("duplicate-root", { workspaceRoot });
  }
}

async function verifySelections(
  store: ProjectRegistrationStore,
  workflowVersionIds: readonly string[],
  skillVersionIds: readonly string[],
): Promise<void> {
  rejectDuplicateSelections(workflowVersionIds);
  rejectDuplicateSelections(skillVersionIds);

  for (const versionId of workflowVersionIds) {
    if ((await store.getWorkflowVersion(versionId)) === null) {
      throw new ProjectRegistrationError("unknown-workflow-version", {
        versionId,
      });
    }
  }

  for (const versionId of skillVersionIds) {
    if ((await store.getSkillVersion(versionId)) === null) {
      throw new ProjectRegistrationError("unknown-skill-version", {
        versionId,
      });
    }
  }
}

function rejectDuplicateSelections(versionIds: readonly string[]): void {
  const seen = new Set<string>();

  for (const versionId of versionIds) {
    if (seen.has(versionId)) {
      throw new ProjectRegistrationError("duplicate-selection", { versionId });
    }

    seen.add(versionId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  );
}
