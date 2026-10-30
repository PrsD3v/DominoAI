import type { RuntimeEvent } from "@/types/runtime";

/** Lifecycle of a workflow run. Feature 9 produces only running, paused, completed, failed, and cancelled. */
export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

/** Lifecycle of one step inside a workflow run. */
export type StepRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Lifecycle of an approval request recorded against a run and step. */
export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

/** Transitions and diagnostic events recorded in workflow history. */
export type WorkflowHistoryKind =
  | "run_started"
  | "run_paused"
  | "run_continued"
  | "run_cancelled"
  | "run_completed"
  | "run_failed"
  | "run_interrupted"
  | "step_started"
  | "step_attempt_failed"
  | "step_completed"
  | "step_failed"
  | "step_cancelled"
  | "session_close_failed"
  | "containment_refused";

/** Attempt policy for one executable step. */
export interface ExecutionRetryPolicy {
  readonly maxAttempts: number;
}

/** Minimal step shape the engine can execute. The prompt is already resolved. */
export interface ExecutionStep {
  readonly key: string;
  readonly prompt: string;
  readonly workingDirectory?: string;
  readonly retry?: ExecutionRetryPolicy;
}

/** Execution-facing projection of a published workflow. */
export interface WorkflowExecutionPlan {
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly steps: readonly ExecutionStep[];
}

/**
 * One execution of an execution plan, pinned to the workflow version it projected.
 * Timestamps are ISO 8601 strings produced by the injected clock.
 */
export interface WorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly plan: WorkflowExecutionPlan;
  readonly runtimeProfileId: string;
  readonly workspaceRoot: string;
  readonly status: WorkflowRunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly pauseRequested: boolean;
  readonly cancelRequested: boolean;
  readonly error?: string;
}

/** State and result of one step attempt inside a run. */
export interface StepRun {
  readonly id: string;
  readonly runId: string;
  readonly stepKey: string;
  readonly stepIndex: number;
  readonly status: StepRunStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly resultText?: string;
  readonly error?: string;
}

/** Execution record for an approval raised against a run and step. */
export interface ApprovalRequest {
  readonly id: string;
  readonly runId: string;
  readonly stepRunId: string;
  readonly status: ApprovalRequestStatus;
  readonly message: string;
  readonly requestedAt: string;
  readonly resolvedAt?: string;
  readonly response?: string;
}

/** Runtime session linked to one step attempt, without provider or credential data. */
export interface RuntimeSessionRef {
  readonly id: string;
  readonly runId: string;
  readonly stepRunId: string;
  readonly runtimeSessionId: string;
  readonly agentName: string | null;
  readonly createdAt: string;
  readonly closedAt?: string;
  readonly closeError?: string;
}

/** Normalized runtime event retained for workflow history. */
export interface RuntimeEventRecord {
  readonly id: string;
  readonly runId: string;
  readonly stepRunId: string;
  readonly event: RuntimeEvent;
  readonly recordedAt: string;
}

/** One recorded history entry explaining a run or step transition. */
export interface WorkflowHistoryEntry {
  readonly id: string;
  readonly runId: string;
  readonly stepRunId?: string;
  readonly kind: WorkflowHistoryKind;
  readonly message: string;
  readonly createdAt: string;
}

/**
 * Application-owned persistence contract used by the workflow engine.
 * List methods return records in insertion order. Implementations must not
 * expose published workflow, skill, or project records through this interface.
 */
export interface WorkflowExecutionPersistence {
  createRun(run: WorkflowRun): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | null>;
  updateRun(run: WorkflowRun): Promise<void>;
  listRuns(): Promise<readonly WorkflowRun[]>;

  createStepRun(stepRun: StepRun): Promise<void>;
  getStepRun(stepRunId: string): Promise<StepRun | null>;
  updateStepRun(stepRun: StepRun): Promise<void>;
  listStepRuns(runId: string): Promise<readonly StepRun[]>;

  createApproval(approval: ApprovalRequest): Promise<void>;
  getApproval(approvalId: string): Promise<ApprovalRequest | null>;
  updateApproval(approval: ApprovalRequest): Promise<void>;
  listApprovals(runId: string): Promise<readonly ApprovalRequest[]>;

  createRuntimeSessionRef(ref: RuntimeSessionRef): Promise<void>;
  getRuntimeSessionRef(refId: string): Promise<RuntimeSessionRef | null>;
  updateRuntimeSessionRef(ref: RuntimeSessionRef): Promise<void>;
  listRuntimeSessionRefs(runId: string): Promise<readonly RuntimeSessionRef[]>;

  appendRuntimeEvent(record: RuntimeEventRecord): Promise<void>;
  listRuntimeEvents(runId: string): Promise<readonly RuntimeEventRecord[]>;

  appendHistory(entry: WorkflowHistoryEntry): Promise<void>;
  listHistory(runId: string): Promise<readonly WorkflowHistoryEntry[]>;
}
