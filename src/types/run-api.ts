import type { Project } from "./persistence";
import type { RuntimeEventRecord, ApprovalRequest, StepRun, WorkflowHistoryEntry, WorkflowRunStatus } from "./workflow";
import type { SkillDefinition, SkillVersion, WorkflowDefinition, WorkflowVersion } from "./workflow-definition";

/** Stable, non-secret error codes shared by the run service and its HTTP routes. */
export const RUN_ERROR_CODES = [
  "invalid_request",
  "invalid_json",
  "unsupported_media_type",
  "origin_not_allowed",
  "project_not_found",
  "workflow_version_not_found",
  "skill_version_not_found",
  "workspace_root_invalid",
  "workspace_root_registered",
  "runtime_profile_not_found",
  "runtime_profile_required",
  "runtime_profile_invalid",
  "credential_missing",
  "workflow_version_not_selected",
  "workflow_version_invalid",
  "skill_version_missing",
  "run_not_found",
  "run_busy",
  "run_state_conflict",
  "approval_not_found",
  "approval_already_resolved",
  "persistence_error",
  "runtime_unavailable",
] as const;

export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

/** One field-level validation problem. It never describes a credential. */
export interface RunFieldError {
  readonly field: string;
  readonly message: string;
}

/** List-facing view of a run. It contains no credential or prompt text. */
export interface RunSummary {
  readonly id: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly workflowVersionId?: string;
  readonly status: WorkflowRunStatus;
  readonly workspaceRoot: string;
  readonly runtimeProfileId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: string;
  readonly pauseRequested: boolean;
  readonly cancelRequested: boolean;
}

/** Run state shared by the detail response and the SSE state frame. */
export interface RunState {
  readonly run: RunSummary;
  readonly steps: readonly StepRun[];
  readonly approvals: readonly ApprovalRequest[];
  readonly history: readonly WorkflowHistoryEntry[];
}

/** Full run detail, including every retained runtime event. */
export interface RunDetail extends RunState {
  readonly events: readonly RuntimeEventRecord[];
}

/** Metadata for a published skill version; markdown content is excluded. */
export interface SkillVersionSummary {
  readonly id: string;
  readonly skillDefinitionId: string;
  readonly version: number;
  readonly publishedAt: string;
}

export interface RunListResponse {
  readonly runs: readonly RunSummary[];
}

export interface RunResponse {
  readonly run: RunDetail;
}

export interface ProjectListResponse {
  readonly projects: readonly Project[];
}

export interface ProjectResponse {
  readonly project: Project;
}

export interface WorkflowCatalogResponse {
  readonly definitions: readonly WorkflowDefinition[];
  readonly versions: readonly WorkflowVersion[];
}

export interface SkillCatalogResponse {
  readonly definitions: readonly SkillDefinition[];
  readonly versions: readonly SkillVersionSummary[];
}

export interface RunErrorBody {
  readonly error: {
    readonly code: RunErrorCode;
    readonly message: string;
    readonly fields?: readonly RunFieldError[];
  };
}

/** Narrow a parsed JSON value to a skill version summary without content. */
export function isSkillVersionSummary(
  value: unknown,
): value is SkillVersionSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.skillDefinitionId === "string" &&
    typeof record.version === "number" &&
    Number.isInteger(record.version) &&
    typeof record.publishedAt === "string" &&
    !("content" in record)
  );
}

/** Build a content-free skill version summary for the read API. */
export function skillVersionSummary(version: SkillVersion): SkillVersionSummary {
  return {
    id: version.id,
    skillDefinitionId: version.skillDefinitionId,
    version: version.version,
    publishedAt: version.publishedAt,
  };
}

export type { RuntimeEventRecord };
