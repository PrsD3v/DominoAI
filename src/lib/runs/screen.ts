import type { Project } from "../../types/persistence";
import type {
  ApprovalRequest,
  RuntimeEventRecord,
  StepRun,
  WorkflowHistoryEntry,
  WorkflowRunStatus,
} from "../../types/workflow";
import type {
  RunDetail,
  RunErrorCode,
  RunFieldError,
  RunListResponse,
  RunState,
  RunSummary,
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import { RUN_ERROR_CODES, isSkillVersionSummary } from "../../types/run-api";
import type { RuntimeProfile } from "../../types/runtime-settings";
import type {
  WorkflowDefinition,
  WorkflowVersion,
} from "../../types/workflow-definition";
import {
  isSkillDefinition,
  isWorkflowDefinition,
  isWorkflowVersion,
} from "../../types/workflow-definition";

/** A run-service failure plus the two client-only outcomes. */
export type RunFailureCode = RunErrorCode | "network" | "unexpected";

export type RunStreamFrame =
  | { readonly kind: "snapshot"; readonly detail: RunDetail }
  | { readonly kind: "state"; readonly state: RunState }
  | { readonly kind: "event"; readonly record: RuntimeEventRecord }
  | { readonly kind: "ignored" };

const RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "pending",
  "running",
  "paused",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

const STEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;

const HISTORY_KINDS = [
  "run_started",
  "run_paused",
  "run_continued",
  "run_cancelled",
  "run_completed",
  "run_failed",
  "run_interrupted",
  "step_started",
  "step_attempt_failed",
  "step_completed",
  "step_failed",
  "step_cancelled",
  "session_close_failed",
  "containment_refused",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "approval_cancelled",
] as const;

const RUN_ERROR_CODE_SET = new Set<string>(RUN_ERROR_CODES);
const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const STEP_STATUS_SET = new Set<string>(STEP_STATUSES);
const APPROVAL_STATUS_SET = new Set<string>(APPROVAL_STATUSES);
const HISTORY_KIND_SET = new Set<string>(HISTORY_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || isTimestamp(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isMembership<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): value is T {
  return typeof value === "string" && allowed.has(value);
}

export function isRunStatus(value: unknown): value is WorkflowRunStatus {
  return isMembership<WorkflowRunStatus>(value, RUN_STATUS_SET);
}

/** Parse the stable error code from a run-service failure response. */
export function parseRunFailure(
  status: number,
  body: unknown,
): RunFailureCode {
  if (status === 0) {
    return "network";
  }

  if (
    isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === "string" &&
    RUN_ERROR_CODE_SET.has(body.error.code)
  ) {
    return body.error.code as RunErrorCode;
  }

  return "unexpected";
}

/** Read the field-level errors from a run-service failure body. */
export function parseRunFieldErrors(body: unknown): readonly RunFieldError[] {
  if (
    !isRecord(body) ||
    !isRecord(body.error) ||
    !Array.isArray(body.error.fields)
  ) {
    return [];
  }

  const fields: RunFieldError[] = [];

  for (const entry of body.error.fields) {
    if (
      isRecord(entry) &&
      typeof entry.field === "string" &&
      typeof entry.message === "string"
    ) {
      fields.push({ field: entry.field, message: entry.message });
    }
  }

  return fields;
}

export function isProject(value: unknown): value is Project {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.workspaceRoot) &&
    isRecord(value.configuration) &&
    (value.defaultRuntimeProfileId === undefined ||
      isNonEmptyString(value.defaultRuntimeProfileId)) &&
    isStringArray(value.workflowVersionIds) &&
    isStringArray(value.skillVersionIds) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

export function isRunSummary(value: unknown): value is RunSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    (value.projectId === undefined || isNonEmptyString(value.projectId)) &&
    (value.projectName === undefined ||
      typeof value.projectName === "string") &&
    isNonEmptyString(value.workflowId) &&
    isInteger(value.workflowVersion) &&
    value.workflowVersion >= 1 &&
    (value.workflowVersionId === undefined ||
      isNonEmptyString(value.workflowVersionId)) &&
    isRunStatus(value.status) &&
    isNonEmptyString(value.workspaceRoot) &&
    isNonEmptyString(value.runtimeProfileId) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    isOptionalTimestamp(value.startedAt) &&
    isOptionalTimestamp(value.finishedAt) &&
    isOptionalString(value.error) &&
    typeof value.pauseRequested === "boolean" &&
    typeof value.cancelRequested === "boolean"
  );
}

export function isStepRun(value: unknown): value is StepRun {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.runId) &&
    isNonEmptyString(value.stepKey) &&
    isInteger(value.stepIndex) &&
    value.stepIndex >= 0 &&
    isMembership<StepRun["status"]>(value.status, STEP_STATUS_SET) &&
    isInteger(value.attempts) &&
    value.attempts >= 0 &&
    isInteger(value.maxAttempts) &&
    value.maxAttempts >= 1 &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    isOptionalTimestamp(value.startedAt) &&
    isOptionalTimestamp(value.finishedAt) &&
    isOptionalString(value.resultText) &&
    isOptionalString(value.error)
  );
}

export function isApprovalRequest(value: unknown): value is ApprovalRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.runId) &&
    isNonEmptyString(value.stepRunId) &&
    isMembership<ApprovalRequest["status"]>(
      value.status,
      APPROVAL_STATUS_SET,
    ) &&
    typeof value.message === "string" &&
    isTimestamp(value.requestedAt) &&
    isOptionalTimestamp(value.resolvedAt) &&
    isOptionalString(value.response)
  );
}

export function isWorkflowHistoryEntry(
  value: unknown,
): value is WorkflowHistoryEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.runId) &&
    (value.stepRunId === undefined || isNonEmptyString(value.stepRunId)) &&
    isMembership<WorkflowHistoryEntry["kind"]>(value.kind, HISTORY_KIND_SET) &&
    typeof value.message === "string" &&
    isTimestamp(value.createdAt)
  );
}

export function isRuntimeEventRecord(
  value: unknown,
): value is RuntimeEventRecord {
  if (!isRecord(value) || !isRecord(value.event)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.runId) &&
    isNonEmptyString(value.stepRunId) &&
    value.event.type === "assistant_text_delta" &&
    typeof value.event.text === "string" &&
    isTimestamp(value.recordedAt)
  );
}

function narrowArray<T>(
  value: unknown,
  predicate: (entry: unknown) => entry is T,
): readonly T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries: T[] = [];

  for (const entry of value) {
    if (!predicate(entry)) {
      return null;
    }

    entries.push(entry);
  }

  return entries;
}

export function narrowRunState(value: unknown): RunState | null {
  if (!isRecord(value) || !isRunSummary(value.run)) {
    return null;
  }

  const steps = narrowArray(value.steps, isStepRun);
  const approvals = narrowArray(value.approvals, isApprovalRequest);
  const history = narrowArray(value.history, isWorkflowHistoryEntry);

  if (steps === null || approvals === null || history === null) {
    return null;
  }

  return { run: value.run, steps, approvals, history };
}

export function narrowRunDetail(value: unknown): RunDetail | null {
  const state = narrowRunState(value);

  if (state === null || !isRecord(value)) {
    return null;
  }

  const events = narrowArray(value.events, isRuntimeEventRecord);

  return events === null ? null : { ...state, events };
}

export function narrowRunResponse(value: unknown): RunDetail | null {
  return isRecord(value) ? narrowRunDetail(value.run) : null;
}

export function narrowRunListResponse(value: unknown): RunListResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const runs = narrowArray(value.runs, isRunSummary);

  return runs === null ? null : { runs };
}

export function narrowProjectListResponse(value: unknown): readonly Project[] | null {
  if (!isRecord(value)) {
    return null;
  }

  return narrowArray(value.projects, isProject);
}

export function narrowProjectResponse(value: unknown): Project | null {
  return isRecord(value) && isProject(value.project) ? value.project : null;
}

export function narrowWorkflowCatalogResponse(
  value: unknown,
): WorkflowCatalogResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const definitions = narrowArray(value.definitions, isWorkflowDefinition);
  const versions = narrowArray(value.versions, isWorkflowVersion);

  if (definitions === null || versions === null) {
    return null;
  }

  return { definitions, versions };
}

export function narrowSkillCatalogResponse(
  value: unknown,
): SkillCatalogResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const definitions = narrowArray(value.definitions, isSkillDefinition);
  const versions = narrowArray(value.versions, isSkillVersionSummary);

  if (definitions === null || versions === null) {
    return null;
  }

  return { definitions, versions };
}

/** Interpret one named SSE frame. Malformed or unknown frames are ignored. */
export function parseRunStreamFrame(
  eventName: string,
  data: string,
): RunStreamFrame {
  let value: unknown;

  try {
    value = JSON.parse(data);
  } catch {
    return { kind: "ignored" };
  }

  if (eventName === "snapshot") {
    const detail = narrowRunDetail(value);
    return detail === null ? { kind: "ignored" } : { kind: "snapshot", detail };
  }

  if (eventName === "state") {
    const state = narrowRunState(value);
    return state === null ? { kind: "ignored" } : { kind: "state", state };
  }

  if (eventName === "event") {
    return isRuntimeEventRecord(value)
      ? { kind: "event", record: value }
      : { kind: "ignored" };
  }

  return { kind: "ignored" };
}

export function isTerminalRunStatus(status: WorkflowRunStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

export function canPause(status: WorkflowRunStatus): boolean {
  return status === "running";
}

export function canContinue(status: WorkflowRunStatus): boolean {
  return status === "paused";
}

export function canCancel(status: WorkflowRunStatus): boolean {
  return (
    status === "running" ||
    status === "paused" ||
    status === "waiting_approval"
  );
}

export function canAnswerApproval(status: WorkflowRunStatus): boolean {
  return status === "waiting_approval";
}

export function pendingApprovals(
  approvals: readonly ApprovalRequest[],
): readonly ApprovalRequest[] {
  return approvals.filter((approval) => approval.status === "pending");
}

export function stepKeyFor(
  steps: readonly StepRun[],
  stepRunId: string,
): string | null {
  return steps.find((step) => step.id === stepRunId)?.stepKey ?? null;
}

export function stepKeyForApproval(
  steps: readonly StepRun[],
  approval: ApprovalRequest,
): string {
  return stepKeyFor(steps, approval.stepRunId) ?? approval.stepRunId;
}

export function workflowVersionsForProject(
  project: Project,
  catalog: WorkflowCatalogResponse,
): readonly WorkflowVersion[] {
  const byId = new Map(catalog.versions.map((version) => [version.id, version]));

  return project.workflowVersionIds.flatMap((id) => {
    const version = byId.get(id);
    return version === undefined ? [] : [version];
  });
}

export function initialWorkflowVersionId(
  project: Project,
  catalog: WorkflowCatalogResponse,
): string | null {
  return workflowVersionsForProject(project, catalog)[0]?.id ?? null;
}

export function runWorkflowLabel(
  run: RunSummary,
  catalog: WorkflowCatalogResponse,
): string {
  return workflowLabel(
    catalog,
    run.workflowVersionId ?? "",
    `${run.workflowId} v${run.workflowVersion}`,
  );
}

export function runDurationMs(run: RunSummary, now: number): number | null {
  return elapsedMs(run.startedAt ?? run.createdAt, run.finishedAt, now);
}

export function workflowDefinitionFor(
  catalog: WorkflowCatalogResponse,
  workflowId: string,
): WorkflowDefinition | null {
  return (
    catalog.definitions.find((definition) => definition.id === workflowId) ??
    null
  );
}

export function workflowVersionFor(
  catalog: WorkflowCatalogResponse,
  versionId: string,
): WorkflowVersion | null {
  return catalog.versions.find((version) => version.id === versionId) ?? null;
}

export function workflowLabel(
  catalog: WorkflowCatalogResponse,
  versionId: string,
  fallbackId: string,
): string {
  const version = workflowVersionFor(catalog, versionId);

  if (version === null) {
    return fallbackId;
  }

  const definition = workflowDefinitionFor(catalog, version.definitionId);
  const name = definition?.name ?? version.definitionId;

  return `${name} v${version.version}`;
}

export function profileLabel(
  profiles: readonly RuntimeProfile[],
  profileId: string | undefined,
): string | null {
  if (profileId === undefined) {
    return null;
  }

  return profiles.find((profile) => profile.id === profileId)?.label ?? null;
}

/** Newest first; equal timestamps fall back to descending ids for stability. */
export function sortRunsNewestFirst(
  runs: readonly RunSummary[],
): readonly RunSummary[] {
  return [...runs].sort((left, right) => {
    const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);

    return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
  });
}

export function lastRunByWorkflow(
  runs: readonly RunSummary[],
  workflowId: string,
): RunSummary | null {
  const sorted = sortRunsNewestFirst(
    runs.filter((run) => run.workflowId === workflowId),
  );

  return sorted[0] ?? null;
}

/** Preserve the current event feed while applying a newer state frame. */
export function mergeRunState(detail: RunDetail, state: RunState): RunDetail {
  return {
    run: state.run,
    steps: state.steps,
    approvals: state.approvals,
    history: state.history,
    events: detail.events,
  };
}

/** Append events once, preserving order and ignoring repeated ids. */
export function appendRunEvents(
  detail: RunDetail,
  records: readonly RuntimeEventRecord[],
): RunDetail {
  const seen = new Set(detail.events.map((record) => record.id));
  const events = [...detail.events];

  for (const record of records) {
    if (!seen.has(record.id)) {
      seen.add(record.id);
      events.push(record);
    }
  }

  return events.length === detail.events.length
    ? detail
    : { ...detail, events };
}

export function elapsedMs(
  startedAt: string | undefined,
  finishedAt: string | undefined,
  now: number,
): number | null {
  if (startedAt === undefined) {
    return null;
  }

  const start = Date.parse(startedAt);

  if (!Number.isFinite(start)) {
    return null;
  }

  const end = finishedAt === undefined ? now : Date.parse(finishedAt);

  if (!Number.isFinite(end)) {
    return null;
  }

  return Math.max(0, end - start);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Render a neutral H:MM:SS or M:SS duration without localized words. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export function formatTimestamp(locale: string, iso: string): string {
  const value = Date.parse(iso);

  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function shortRunId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

export function apiRunPath(id: string): string {
  return `/api/runs/${encodeURIComponent(id)}`;
}

export function apiRunActionPath(
  id: string,
  action: "pause" | "continue" | "cancel",
): string {
  return `${apiRunPath(id)}/${action}`;
}

export function apiApprovalPath(runId: string, approvalId: string): string {
  return `${apiRunPath(runId)}/approvals/${encodeURIComponent(approvalId)}`;
}

export function pageRunPath(locale: string, id: string): string {
  return `/${locale}/runs/${encodeURIComponent(id)}`;
}
