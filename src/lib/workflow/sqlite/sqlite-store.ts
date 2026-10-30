import type { DatabaseSync } from "node:sqlite";
import type {
  Project,
  ProjectPersistence,
  PublishedDefinitionPersistence,
  RuntimeProfilePersistence,
} from "../../../types/persistence";
import type { RuntimeEvent } from "../../../types/runtime";
import {
  isRuntimeProfile,
  type RuntimeProfile,
  type RuntimeProfileId,
} from "../../../types/runtime-settings";
import type {
  ApprovalRequest,
  ApprovalRequestStatus,
  RuntimeEventRecord,
  RuntimeSessionRef,
  StepRun,
  StepRunStatus,
  WorkflowExecutionPersistence,
  WorkflowExecutionPlan,
  WorkflowHistoryEntry,
  WorkflowHistoryKind,
  WorkflowRun,
  WorkflowRunStatus,
} from "../../../types/workflow";
import {
  isSkillDefinition,
  isSkillVersion,
  isWorkflowDefinition,
  isWorkflowVersion,
  type SkillDefinition,
  type SkillVersion,
  type WorkflowDefinition,
  type WorkflowVersion,
} from "../../../types/workflow-definition";
import {
  WorkflowPersistenceError,
  WorkflowRecordError,
} from "../persistence-errors";
import { openSqliteDatabase, type SqliteDatabase } from "./migrations";

type Row = Record<string, unknown>;
type Parameter = string | number | null;

const RUN_STATUSES = new Set<WorkflowRunStatus>([
  "pending",
  "running",
  "paused",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const STEP_STATUSES = new Set<StepRunStatus>([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

const APPROVAL_STATUSES = new Set<ApprovalRequestStatus>([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

const HISTORY_KINDS = new Set<WorkflowHistoryKind>([
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
]);

function decodeFailure(
  table: string,
  id: string,
  detail: string,
): WorkflowPersistenceError {
  return new WorkflowPersistenceError(
    "decode",
    `Stored ${table} record "${id}" ${detail}`,
  );
}

function readString(row: Row, table: string, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw decodeFailure(table, String(row.id), `has an unreadable ${column}`);
  }

  return value;
}

function readOptionalString(
  row: Row,
  table: string,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw decodeFailure(table, String(row.id), `has an unreadable ${column}`);
  }

  return value;
}

function readInteger(row: Row, table: string, column: string): number {
  const value = row[column];

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw decodeFailure(table, String(row.id), `has an unreadable ${column}`);
  }

  return value;
}

function readBoolean(row: Row, table: string, column: string): boolean {
  const value = row[column];

  if (value !== 0 && value !== 1) {
    throw decodeFailure(table, String(row.id), `has an unreadable ${column}`);
  }

  return value === 1;
}

function readJson(row: Row, table: string, column: string): unknown {
  const raw = readString(row, table, column);

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw decodeFailure(table, String(row.id), `has unreadable ${column} JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodePlan(value: unknown, id: string): WorkflowExecutionPlan {
  if (!isRecord(value)) {
    throw decodeFailure("workflow_runs", id, "has an unreadable plan");
  }

  const { workflowId, workflowVersion, steps } = value;

  if (
    typeof workflowId !== "string" ||
    typeof workflowVersion !== "number" ||
    !Number.isInteger(workflowVersion) ||
    !Array.isArray(steps) ||
    steps.length === 0
  ) {
    throw decodeFailure("workflow_runs", id, "has an unreadable plan");
  }

  for (const step of steps) {
    if (!isRecord(step) || typeof step.key !== "string" || typeof step.prompt !== "string") {
      throw decodeFailure("workflow_runs", id, "has an unreadable plan step");
    }
  }

  return value as unknown as WorkflowExecutionPlan;
}

function decodeEvent(value: unknown, id: string): RuntimeEvent {
  if (
    !isRecord(value) ||
    value.type !== "assistant_text_delta" ||
    typeof value.text !== "string"
  ) {
    throw decodeFailure("runtime_events", id, "has an unreadable event");
  }

  return { type: "assistant_text_delta", text: value.text };
}

function readStatus<T extends string>(
  row: Row,
  table: string,
  allowed: ReadonlySet<T>,
): T {
  const value = readString(row, table, "status");

  if (!allowed.has(value as T)) {
    throw decodeFailure(table, String(row.id), `has an unknown status "${value}"`);
  }

  return value as T;
}

function isUniqueViolation(error: unknown): boolean {
  const errcode = (error as { errcode?: unknown }).errcode;
  return errcode === 2067 || errcode === 1555;
}

function isReferenceViolation(error: unknown): boolean {
  return (error as { errcode?: unknown }).errcode === 787;
}

function mapWriteError(
  error: unknown,
  recordKind: string,
  id: string,
  conflict: "record" | "version",
): Error {
  if (isUniqueViolation(error)) {
    const message = error instanceof Error ? error.message : "";

    if (conflict === "version" && !/\.id(,|$)/.test(message)) {
      return new WorkflowPersistenceError(
        "conflict",
        `A ${recordKind} record with id "${id}" already uses that definition and version number`,
      );
    }

    return new WorkflowRecordError("create", recordKind, id);
  }

  if (isReferenceViolation(error)) {
    return new WorkflowPersistenceError(
      "reference",
      `A ${recordKind} with id "${id}" references a record that does not exist`,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function insertRow(
  db: DatabaseSync,
  sql: string,
  parameters: readonly Parameter[],
  recordKind: string,
  id: string,
  conflict: "record" | "version" = "record",
): void {
  try {
    db.prepare(sql).run(...parameters);
  } catch (error) {
    throw mapWriteError(error, recordKind, id, conflict);
  }
}

function requireUpdated(
  changes: number,
  recordKind: string,
  id: string,
): void {
  if (changes === 0) {
    throw new WorkflowRecordError("update", recordKind, id);
  }
}

function requireValidDefinition(
  valid: boolean,
  recordKind: string,
  id: string,
): void {
  if (!valid) {
    throw new WorkflowPersistenceError(
      "invalid",
      `The ${recordKind} with id "${id}" is not valid`,
    );
  }
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function runParameters(run: WorkflowRun): Parameter[] {
  return [
    run.id,
    run.workflowId,
    run.workflowVersion,
    JSON.stringify(run.plan),
    run.runtimeProfileId,
    run.workspaceRoot,
    run.status,
    run.createdAt,
    run.updatedAt,
    run.startedAt ?? null,
    run.finishedAt ?? null,
    run.pauseRequested ? 1 : 0,
    run.cancelRequested ? 1 : 0,
    run.error ?? null,
  ];
}

function runtimeProfileParameters(profile: RuntimeProfile): Parameter[] {
  return [
    profile.id,
    profile.label,
    profile.adapterId,
    profile.providerName,
    profile.model,
    profile.apiKeyEnv,
    profile.credentialRef.kind,
    profile.createdAt,
    profile.updatedAt,
  ];
}

function decodeRun(row: Row): WorkflowRun {
  const id = readString(row, "workflow_runs", "id");
  const startedAt = readOptionalString(row, "workflow_runs", "started_at");
  const finishedAt = readOptionalString(row, "workflow_runs", "finished_at");
  const error = readOptionalString(row, "workflow_runs", "error");

  return {
    id,
    workflowId: readString(row, "workflow_runs", "workflow_id"),
    workflowVersion: readInteger(row, "workflow_runs", "workflow_version"),
    plan: decodePlan(readJson(row, "workflow_runs", "plan_json"), id),
    runtimeProfileId: readString(row, "workflow_runs", "runtime_profile_id"),
    workspaceRoot: readString(row, "workflow_runs", "workspace_root"),
    status: readStatus(row, "workflow_runs", RUN_STATUSES),
    createdAt: readString(row, "workflow_runs", "created_at"),
    updatedAt: readString(row, "workflow_runs", "updated_at"),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    pauseRequested: readBoolean(row, "workflow_runs", "pause_requested"),
    cancelRequested: readBoolean(row, "workflow_runs", "cancel_requested"),
    ...(error === undefined ? {} : { error }),
  };
}

function decodeStepRun(row: Row): StepRun {
  const startedAt = readOptionalString(row, "step_runs", "started_at");
  const finishedAt = readOptionalString(row, "step_runs", "finished_at");
  const resultText = readOptionalString(row, "step_runs", "result_text");
  const error = readOptionalString(row, "step_runs", "error");

  return {
    id: readString(row, "step_runs", "id"),
    runId: readString(row, "step_runs", "run_id"),
    stepKey: readString(row, "step_runs", "step_key"),
    stepIndex: readInteger(row, "step_runs", "step_index"),
    status: readStatus(row, "step_runs", STEP_STATUSES),
    attempts: readInteger(row, "step_runs", "attempts"),
    maxAttempts: readInteger(row, "step_runs", "max_attempts"),
    createdAt: readString(row, "step_runs", "created_at"),
    updatedAt: readString(row, "step_runs", "updated_at"),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(resultText === undefined ? {} : { resultText }),
    ...(error === undefined ? {} : { error }),
  };
}

function decodeApproval(row: Row): ApprovalRequest {
  const resolvedAt = readOptionalString(row, "approvals", "resolved_at");
  const response = readOptionalString(row, "approvals", "response");

  return {
    id: readString(row, "approvals", "id"),
    runId: readString(row, "approvals", "run_id"),
    stepRunId: readString(row, "approvals", "step_run_id"),
    status: readStatus(row, "approvals", APPROVAL_STATUSES),
    message: readString(row, "approvals", "message"),
    requestedAt: readString(row, "approvals", "requested_at"),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    ...(response === undefined ? {} : { response }),
  };
}

function decodeSessionRef(row: Row): RuntimeSessionRef {
  const agentName = readOptionalString(row, "runtime_session_refs", "agent_name");
  const closedAt = readOptionalString(row, "runtime_session_refs", "closed_at");
  const closeError = readOptionalString(
    row,
    "runtime_session_refs",
    "close_error",
  );

  return {
    id: readString(row, "runtime_session_refs", "id"),
    runId: readString(row, "runtime_session_refs", "run_id"),
    stepRunId: readString(row, "runtime_session_refs", "step_run_id"),
    runtimeSessionId: readString(
      row,
      "runtime_session_refs",
      "runtime_session_id",
    ),
    agentName: agentName ?? null,
    createdAt: readString(row, "runtime_session_refs", "created_at"),
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(closeError === undefined ? {} : { closeError }),
  };
}

function decodeEventRecord(row: Row): RuntimeEventRecord {
  const id = readString(row, "runtime_events", "id");

  return {
    id,
    runId: readString(row, "runtime_events", "run_id"),
    stepRunId: readString(row, "runtime_events", "step_run_id"),
    event: decodeEvent(readJson(row, "runtime_events", "event_json"), id),
    recordedAt: readString(row, "runtime_events", "recorded_at"),
  };
}

function decodeHistory(row: Row): WorkflowHistoryEntry {  const stepRunId = readOptionalString(row, "workflow_history", "step_run_id");
  const value = readString(row, "workflow_history", "kind");

  if (!HISTORY_KINDS.has(value as WorkflowHistoryKind)) {
    throw decodeFailure(
      "workflow_history",
      String(row.id),
      `has an unknown kind "${value}"`,
    );
  }

  return {
    id: readString(row, "workflow_history", "id"),
    runId: readString(row, "workflow_history", "run_id"),
    ...(stepRunId === undefined ? {} : { stepRunId }),
    kind: value as WorkflowHistoryKind,
    message: readString(row, "workflow_history", "message"),
    createdAt: readString(row, "workflow_history", "created_at"),
  };
}

function decodeWorkflowDefinition(row: Row): WorkflowDefinition {
  const id = readString(row, "workflow_definitions", "id");
  const definition = {
    id,
    name: readString(row, "workflow_definitions", "name"),
  };

  if (!isWorkflowDefinition(definition)) {
    throw decodeFailure("workflow_definitions", id, "is not a valid definition");
  }

  return definition;
}

function decodeSkillDefinition(row: Row): SkillDefinition {
  const id = readString(row, "skill_definitions", "id");
  const definition = {
    id,
    name: readString(row, "skill_definitions", "name"),
  };

  if (!isSkillDefinition(definition)) {
    throw decodeFailure("skill_definitions", id, "is not a valid definition");
  }

  return definition;
}

function decodeWorkflowVersion(row: Row): WorkflowVersion {
  const id = readString(row, "workflow_versions", "id");
  const version = {
    id,
    definitionId: readString(row, "workflow_versions", "definition_id"),
    version: readInteger(row, "workflow_versions", "version"),
    steps: readJson(row, "workflow_versions", "steps_json"),
    approvalPoints: readJson(row, "workflow_versions", "approval_points_json"),
    errorPolicy: readString(row, "workflow_versions", "error_policy"),
    publishedAt: readString(row, "workflow_versions", "published_at"),
  };

  if (!isWorkflowVersion(version)) {
    throw decodeFailure("workflow_versions", id, "is not a valid workflow version");
  }

  return version;
}

function decodeSkillVersion(row: Row): SkillVersion {
  const id = readString(row, "skill_versions", "id");
  const version = {
    id,
    skillDefinitionId: readString(row, "skill_versions", "skill_definition_id"),
    version: readInteger(row, "skill_versions", "version"),
    content: readString(row, "skill_versions", "content"),
    publishedAt: readString(row, "skill_versions", "published_at"),
  };

  if (!isSkillVersion(version)) {
    throw decodeFailure("skill_versions", id, "is not a valid skill version");
  }

  return version;
}

function decodeRuntimeProfile(row: Row): RuntimeProfile {
  const id = readString(row, "runtime_profiles", "id");
  const providerName = readString(row, "runtime_profiles", "provider_name");
  const apiKeyEnv = readString(row, "runtime_profiles", "api_key_env");
  const profile = {
    id,
    label: readString(row, "runtime_profiles", "label"),
    adapterId: readString(row, "runtime_profiles", "adapter_id"),
    providerName,
    model: readString(row, "runtime_profiles", "model"),
    apiKeyEnv,
    credentialRef: {
      kind: readString(row, "runtime_profiles", "credential_kind"),
      providerName,
      apiKeyEnv,
    },
    createdAt: readString(row, "runtime_profiles", "created_at"),
    updatedAt: readString(row, "runtime_profiles", "updated_at"),
  };

  if (!isRuntimeProfile(profile)) {
    throw decodeFailure("runtime_profiles", id, "is not a valid profile");
  }

  return profile;
}

/** SQLite-backed execution persistence for the workflow engine. */
export interface SqliteWorkflowStore
  extends WorkflowExecutionPersistence,
    PublishedDefinitionPersistence,
    ProjectPersistence,
    RuntimeProfilePersistence {
  close(): void;
}

/** Where to open the store. `:memory:` is supported for tests. */
export interface OpenSqliteWorkflowStoreOptions {
  readonly path: string;
}

class SqliteWorkflowStoreImpl implements SqliteWorkflowStore {
  constructor(private readonly database: SqliteDatabase) {}

  private get db(): DatabaseSync {
    return this.database.db;
  }

  close(): void {
    this.database.close();
  }

  async createRun(run: WorkflowRun): Promise<void> {
    insertRow(
      this.db,
      `INSERT INTO workflow_runs (
        id, workflow_id, workflow_version, plan_json, runtime_profile_id,
        workspace_root, status, created_at, updated_at, started_at, finished_at,
        pause_requested, cancel_requested, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runParameters(run),
      "workflow run",
      run.id,
    );
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const row = this.db
      .prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(runId);

    return row === undefined ? null : decodeRun(row);
  }

  async updateRun(run: WorkflowRun): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE workflow_runs SET
          workflow_id = ?, workflow_version = ?, plan_json = ?,
          runtime_profile_id = ?, workspace_root = ?, status = ?,
          created_at = ?, updated_at = ?, started_at = ?, finished_at = ?,
          pause_requested = ?, cancel_requested = ?, error = ?
        WHERE id = ?`,
      )
      .run(...runParameters(run).slice(1), run.id);

    requireUpdated(Number(result.changes), "workflow run", run.id);
  }

  async listRuns(): Promise<readonly WorkflowRun[]> {
    return this.db
      .prepare("SELECT * FROM workflow_runs ORDER BY seq")
      .all()
      .map(decodeRun);
  }

  async createStepRun(stepRun: StepRun): Promise<void> {
    insertRow(
      this.db,
      `INSERT INTO step_runs (
        id, run_id, step_key, step_index, status, attempts, max_attempts,
        created_at, updated_at, started_at, finished_at, result_text, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stepRun.id,
        stepRun.runId,
        stepRun.stepKey,
        stepRun.stepIndex,
        stepRun.status,
        stepRun.attempts,
        stepRun.maxAttempts,
        stepRun.createdAt,
        stepRun.updatedAt,
        stepRun.startedAt ?? null,
        stepRun.finishedAt ?? null,
        stepRun.resultText ?? null,
        stepRun.error ?? null,
      ],
      "step run",
      stepRun.id,
    );
  }

  async getStepRun(stepRunId: string): Promise<StepRun | null> {
    const row = this.db
      .prepare("SELECT * FROM step_runs WHERE id = ?")
      .get(stepRunId);

    return row === undefined ? null : decodeStepRun(row);
  }

  async updateStepRun(stepRun: StepRun): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE step_runs SET
          run_id = ?, step_key = ?, step_index = ?, status = ?, attempts = ?,
          max_attempts = ?, created_at = ?, updated_at = ?, started_at = ?,
          finished_at = ?, result_text = ?, error = ?
        WHERE id = ?`,
      )
      .run(
        stepRun.runId,
        stepRun.stepKey,
        stepRun.stepIndex,
        stepRun.status,
        stepRun.attempts,
        stepRun.maxAttempts,
        stepRun.createdAt,
        stepRun.updatedAt,
        stepRun.startedAt ?? null,
        stepRun.finishedAt ?? null,
        stepRun.resultText ?? null,
        stepRun.error ?? null,
        stepRun.id,
      );

    requireUpdated(Number(result.changes), "step run", stepRun.id);
  }

  async listStepRuns(runId: string): Promise<readonly StepRun[]> {
    return this.db
      .prepare("SELECT * FROM step_runs WHERE run_id = ? ORDER BY seq")
      .all(runId)
      .map(decodeStepRun);
  }

  async createApproval(approval: ApprovalRequest): Promise<void> {
    insertRow(
      this.db,
      `INSERT INTO approvals (
        id, run_id, step_run_id, status, message, requested_at, resolved_at,
        response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        approval.id,
        approval.runId,
        approval.stepRunId,
        approval.status,
        approval.message,
        approval.requestedAt,
        approval.resolvedAt ?? null,
        approval.response ?? null,
      ],
      "approval request",
      approval.id,
    );
  }

  async getApproval(approvalId: string): Promise<ApprovalRequest | null> {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(approvalId);

    return row === undefined ? null : decodeApproval(row);
  }

  async updateApproval(approval: ApprovalRequest): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE approvals SET
          run_id = ?, step_run_id = ?, status = ?, message = ?,
          requested_at = ?, resolved_at = ?, response = ?
        WHERE id = ?`,
      )
      .run(
        approval.runId,
        approval.stepRunId,
        approval.status,
        approval.message,
        approval.requestedAt,
        approval.resolvedAt ?? null,
        approval.response ?? null,
        approval.id,
      );

    requireUpdated(Number(result.changes), "approval request", approval.id);
  }

  async listApprovals(runId: string): Promise<readonly ApprovalRequest[]> {
    return this.db
      .prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY seq")
      .all(runId)
      .map(decodeApproval);
  }

  async createRuntimeSessionRef(ref: RuntimeSessionRef): Promise<void> {
    insertRow(
      this.db,
      `INSERT INTO runtime_session_refs (
        id, run_id, step_run_id, runtime_session_id, agent_name, created_at,
        closed_at, close_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.id,
        ref.runId,
        ref.stepRunId,
        ref.runtimeSessionId,
        ref.agentName,
        ref.createdAt,
        ref.closedAt ?? null,
        ref.closeError ?? null,
      ],
      "runtime session reference",
      ref.id,
    );
  }

  async getRuntimeSessionRef(
    refId: string,
  ): Promise<RuntimeSessionRef | null> {
    const row = this.db
      .prepare("SELECT * FROM runtime_session_refs WHERE id = ?")
      .get(refId);

    return row === undefined ? null : decodeSessionRef(row);
  }

  async updateRuntimeSessionRef(ref: RuntimeSessionRef): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE runtime_session_refs SET
          run_id = ?, step_run_id = ?, runtime_session_id = ?, agent_name = ?,
          created_at = ?, closed_at = ?, close_error = ?
        WHERE id = ?`,
      )
      .run(
        ref.runId,
        ref.stepRunId,
        ref.runtimeSessionId,
        ref.agentName,
        ref.createdAt,
        ref.closedAt ?? null,
        ref.closeError ?? null,
        ref.id,
      );

    requireUpdated(
      Number(result.changes),
      "runtime session reference",
      ref.id,
    );
  }

  async listRuntimeSessionRefs(
    runId: string,
  ): Promise<readonly RuntimeSessionRef[]> {
    return this.db
      .prepare("SELECT * FROM runtime_session_refs WHERE run_id = ? ORDER BY seq")
      .all(runId)
      .map(decodeSessionRef);
  }

  async appendRuntimeEvent(record: RuntimeEventRecord): Promise<void> {
    insertRow(
      this.db,
      `INSERT INTO runtime_events (
        id, run_id, step_run_id, event_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        record.id,
        record.runId,
        record.stepRunId,
        JSON.stringify(record.event),
        record.recordedAt,
      ],
      "runtime event",
      record.id,
    );
  }

  async listRuntimeEvents(
    runId: string,
  ): Promise<readonly RuntimeEventRecord[]> {
    return this.db
      .prepare("SELECT * FROM runtime_events WHERE run_id = ? ORDER BY seq")
      .all(runId)
      .map(decodeEventRecord);
  }

  async appendHistory(entry: WorkflowHistoryEntry): Promise<void> {
    insertRow(
      this.db,
      `INSERT INTO workflow_history (
        id, run_id, step_run_id, kind, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.runId,
        entry.stepRunId ?? null,
        entry.kind,
        entry.message,
        entry.createdAt,
      ],
      "history entry",
      entry.id,
    );
  }

  async listHistory(runId: string): Promise<readonly WorkflowHistoryEntry[]> {
    return this.db
      .prepare("SELECT * FROM workflow_history WHERE run_id = ? ORDER BY seq")
      .all(runId)
      .map(decodeHistory);
  }

  async createWorkflowDefinition(
    definition: WorkflowDefinition,
  ): Promise<void> {
    requireValidDefinition(isWorkflowDefinition(definition), "workflow", definition.id);

    insertRow(
      this.db,
      "INSERT INTO workflow_definitions (id, name) VALUES (?, ?)",
      [definition.id, definition.name],
      "workflow definition",
      definition.id,
    );
  }

  async getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null> {
    const row = this.db
      .prepare("SELECT * FROM workflow_definitions WHERE id = ?")
      .get(id);

    return row === undefined ? null : decodeWorkflowDefinition(row);
  }

  async updateWorkflowDefinition(
    definition: WorkflowDefinition,
  ): Promise<void> {
    requireValidDefinition(isWorkflowDefinition(definition), "workflow", definition.id);

    const result = this.db
      .prepare("UPDATE workflow_definitions SET name = ? WHERE id = ?")
      .run(definition.name, definition.id);

    requireUpdated(Number(result.changes), "workflow definition", definition.id);
  }

  async listWorkflowDefinitions(): Promise<readonly WorkflowDefinition[]> {
    return this.db
      .prepare("SELECT * FROM workflow_definitions ORDER BY rowid")
      .all()
      .map(decodeWorkflowDefinition);
  }

  async createSkillDefinition(definition: SkillDefinition): Promise<void> {
    requireValidDefinition(isSkillDefinition(definition), "skill", definition.id);

    insertRow(
      this.db,
      "INSERT INTO skill_definitions (id, name) VALUES (?, ?)",
      [definition.id, definition.name],
      "skill definition",
      definition.id,
    );
  }

  async getSkillDefinition(id: string): Promise<SkillDefinition | null> {
    const row = this.db
      .prepare("SELECT * FROM skill_definitions WHERE id = ?")
      .get(id);

    return row === undefined ? null : decodeSkillDefinition(row);
  }

  async updateSkillDefinition(definition: SkillDefinition): Promise<void> {
    requireValidDefinition(isSkillDefinition(definition), "skill", definition.id);

    const result = this.db
      .prepare("UPDATE skill_definitions SET name = ? WHERE id = ?")
      .run(definition.name, definition.id);

    requireUpdated(Number(result.changes), "skill definition", definition.id);
  }

  async listSkillDefinitions(): Promise<readonly SkillDefinition[]> {
    return this.db
      .prepare("SELECT * FROM skill_definitions ORDER BY rowid")
      .all()
      .map(decodeSkillDefinition);
  }

  async createWorkflowVersion(version: WorkflowVersion): Promise<void> {
    requireValidDefinition(
      isWorkflowVersion(version),
      "workflow version",
      version.id,
    );

    insertRow(
      this.db,
      `INSERT INTO workflow_versions (
        id, definition_id, version, steps_json, approval_points_json,
        error_policy, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        version.id,
        version.definitionId,
        version.version,
        JSON.stringify(version.steps),
        JSON.stringify(version.approvalPoints),
        version.errorPolicy,
        version.publishedAt,
      ],
      "workflow version",
      version.id,
      "version",
    );
  }

  async getWorkflowVersion(id: string): Promise<WorkflowVersion | null> {
    const row = this.db
      .prepare("SELECT * FROM workflow_versions WHERE id = ?")
      .get(id);

    return row === undefined ? null : decodeWorkflowVersion(row);
  }

  async listWorkflowVersions(
    definitionId: string,
  ): Promise<readonly WorkflowVersion[]> {
    return this.db
      .prepare("SELECT * FROM workflow_versions WHERE definition_id = ? ORDER BY seq")
      .all(definitionId)
      .map(decodeWorkflowVersion);
  }

  async createSkillVersion(version: SkillVersion): Promise<void> {
    requireValidDefinition(isSkillVersion(version), "skill version", version.id);

    insertRow(
      this.db,
      `INSERT INTO skill_versions (
        id, skill_definition_id, version, content, published_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        version.id,
        version.skillDefinitionId,
        version.version,
        version.content,
        version.publishedAt,
      ],
      "skill version",
      version.id,
      "version",
    );
  }

  async getSkillVersion(id: string): Promise<SkillVersion | null> {
    const row = this.db
      .prepare("SELECT * FROM skill_versions WHERE id = ?")
      .get(id);

    return row === undefined ? null : decodeSkillVersion(row);
  }

  async listSkillVersions(
    skillDefinitionId: string,
  ): Promise<readonly SkillVersion[]> {
    return this.db
      .prepare("SELECT * FROM skill_versions WHERE skill_definition_id = ? ORDER BY seq")
      .all(skillDefinitionId)
      .map(decodeSkillVersion);
  }

  async createProject(project: Project): Promise<void> {
    inTransaction(this.db, () => {
      insertRow(
        this.db,
        `INSERT INTO projects (
          id, name, workspace_root, configuration_json,
          default_runtime_profile_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          project.name,
          project.workspaceRoot,
          JSON.stringify(project.configuration),
          project.defaultRuntimeProfileId ?? null,
          project.createdAt,
          project.updatedAt,
        ],
        "project",
        project.id,
      );
      this.replaceSelections(project);
    });
  }

  async getProject(id: string): Promise<Project | null> {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);

    return row === undefined ? null : this.decodeProject(row);
  }

  async updateProject(project: Project): Promise<void> {
    inTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `UPDATE projects SET
            name = ?, workspace_root = ?, configuration_json = ?,
            default_runtime_profile_id = ?, created_at = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(
          project.name,
          project.workspaceRoot,
          JSON.stringify(project.configuration),
          project.defaultRuntimeProfileId ?? null,
          project.createdAt,
          project.updatedAt,
          project.id,
        );

      requireUpdated(Number(result.changes), "project", project.id);
      this.replaceSelections(project);
    });
  }

  async listProjects(): Promise<readonly Project[]> {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY seq")
      .all()
      .map((row) => this.decodeProject(row));
  }

  async createRuntimeProfile(profile: RuntimeProfile): Promise<void> {
    requireValidDefinition(
      isRuntimeProfile(profile),
      "runtime profile",
      profile.id,
    );

    insertRow(
      this.db,
      `INSERT INTO runtime_profiles (
        id, label, adapter_id, provider_name, model, api_key_env,
        credential_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runtimeProfileParameters(profile),
      "runtime profile",
      profile.id,
    );
  }

  async getRuntimeProfile(id: RuntimeProfileId): Promise<RuntimeProfile | null> {
    const row = this.db
      .prepare("SELECT * FROM runtime_profiles WHERE id = ?")
      .get(id);

    return row === undefined ? null : decodeRuntimeProfile(row);
  }

  async updateRuntimeProfile(profile: RuntimeProfile): Promise<void> {
    requireValidDefinition(
      isRuntimeProfile(profile),
      "runtime profile",
      profile.id,
    );

    const result = this.db
      .prepare(
        `UPDATE runtime_profiles SET
          label = ?, adapter_id = ?, provider_name = ?, model = ?,
          api_key_env = ?, credential_kind = ?, created_at = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(...runtimeProfileParameters(profile).slice(1), profile.id);

    requireUpdated(Number(result.changes), "runtime profile", profile.id);
  }

  private replaceSelections(project: Project): void {
    this.db
      .prepare("DELETE FROM project_workflow_versions WHERE project_id = ?")
      .run(project.id);
    this.db
      .prepare("DELETE FROM project_skill_versions WHERE project_id = ?")
      .run(project.id);

    project.workflowVersionIds.forEach((versionId, position) => {
      insertRow(
        this.db,
        `INSERT INTO project_workflow_versions (
          project_id, workflow_version_id, position
        ) VALUES (?, ?, ?)`,
        [project.id, versionId, position],
        "project workflow version selection",
        `${project.id}/${versionId}`,
      );
    });

    project.skillVersionIds.forEach((versionId, position) => {
      insertRow(
        this.db,
        `INSERT INTO project_skill_versions (
          project_id, skill_version_id, position
        ) VALUES (?, ?, ?)`,
        [project.id, versionId, position],
        "project skill version selection",
        `${project.id}/${versionId}`,
      );
    });
  }

  private decodeProject(row: Row): Project {
    const id = readString(row, "projects", "id");
    const configuration = readJson(row, "projects", "configuration_json");

    if (!isRecord(configuration)) {
      throw decodeFailure("projects", id, "has an unreadable configuration");
    }

    const defaultRuntimeProfileId = readOptionalString(
      row,
      "projects",
      "default_runtime_profile_id",
    );
    const workflowVersionIds = this.db
      .prepare(
        "SELECT workflow_version_id FROM project_workflow_versions WHERE project_id = ? ORDER BY position",
      )
      .all(id)
      .map((selection) => String(selection.workflow_version_id));
    const skillVersionIds = this.db
      .prepare(
        "SELECT skill_version_id FROM project_skill_versions WHERE project_id = ? ORDER BY position",
      )
      .all(id)
      .map((selection) => String(selection.skill_version_id));

    return {
      id,
      name: readString(row, "projects", "name"),
      workspaceRoot: readString(row, "projects", "workspace_root"),
      configuration,
      ...(defaultRuntimeProfileId === undefined
        ? {}
        : { defaultRuntimeProfileId }),
      workflowVersionIds,
      skillVersionIds,
      createdAt: readString(row, "projects", "created_at"),
      updatedAt: readString(row, "projects", "updated_at"),
    };
  }
}

/** Open a local SQLite store that implements the execution persistence contract. */
export function openSqliteWorkflowStore(
  options: OpenSqliteWorkflowStoreOptions,
): SqliteWorkflowStore {
  return new SqliteWorkflowStoreImpl(openSqliteDatabase(options));
}
