import type {
  ApprovalRequest,
  RuntimeEventRecord,
  RuntimeSessionRef,
  StepRun,
  WorkflowExecutionPersistence,
  WorkflowHistoryEntry,
  WorkflowRun,
} from "../../types/workflow";
import { WorkflowRecordError } from "./persistence-errors";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function insert<T extends { id: string }>(
  store: Map<string, T>,
  recordKind: string,
  record: T,
): void {
  if (store.has(record.id)) {
    throw new WorkflowRecordError("create", recordKind, record.id);
  }

  store.set(record.id, copy(record));
}

function read<T extends { id: string }>(
  store: Map<string, T>,
  id: string,
): T | null {
  const record = store.get(id);
  return record === undefined ? null : copy(record);
}

function replace<T extends { id: string }>(
  store: Map<string, T>,
  recordKind: string,
  record: T,
): void {
  if (!store.has(record.id)) {
    throw new WorkflowRecordError("update", recordKind, record.id);
  }

  store.set(record.id, copy(record));
}

function list<T extends { id: string }>(store: Map<string, T>): T[] {
  return [...store.values()].map(copy);
}

function listByRun<T extends { id: string; runId: string }>(
  store: Map<string, T>,
  runId: string,
): T[] {
  return [...store.values()]
    .filter((record) => record.runId === runId)
    .map(copy);
}

class InMemoryWorkflowPersistence implements WorkflowExecutionPersistence {
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly stepRuns = new Map<string, StepRun>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly sessionRefs = new Map<string, RuntimeSessionRef>();
  private readonly events = new Map<string, RuntimeEventRecord>();
  private readonly history = new Map<string, WorkflowHistoryEntry>();

  async createRun(run: WorkflowRun): Promise<void> {
    insert(this.runs, "workflow run", run);
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    return read(this.runs, runId);
  }

  async updateRun(run: WorkflowRun): Promise<void> {
    replace(this.runs, "workflow run", run);
  }

  async listRuns(): Promise<readonly WorkflowRun[]> {
    return list(this.runs);
  }

  async createStepRun(stepRun: StepRun): Promise<void> {
    insert(this.stepRuns, "step run", stepRun);
  }

  async getStepRun(stepRunId: string): Promise<StepRun | null> {
    return read(this.stepRuns, stepRunId);
  }

  async updateStepRun(stepRun: StepRun): Promise<void> {
    replace(this.stepRuns, "step run", stepRun);
  }

  async listStepRuns(runId: string): Promise<readonly StepRun[]> {
    return listByRun(this.stepRuns, runId);
  }

  async createApproval(approval: ApprovalRequest): Promise<void> {
    insert(this.approvals, "approval request", approval);
  }

  async getApproval(approvalId: string): Promise<ApprovalRequest | null> {
    return read(this.approvals, approvalId);
  }

  async updateApproval(approval: ApprovalRequest): Promise<void> {
    replace(this.approvals, "approval request", approval);
  }

  async listApprovals(runId: string): Promise<readonly ApprovalRequest[]> {
    return listByRun(this.approvals, runId);
  }

  async createRuntimeSessionRef(ref: RuntimeSessionRef): Promise<void> {
    insert(this.sessionRefs, "runtime session reference", ref);
  }

  async getRuntimeSessionRef(
    refId: string,
  ): Promise<RuntimeSessionRef | null> {
    return read(this.sessionRefs, refId);
  }

  async updateRuntimeSessionRef(ref: RuntimeSessionRef): Promise<void> {
    replace(this.sessionRefs, "runtime session reference", ref);
  }

  async listRuntimeSessionRefs(
    runId: string,
  ): Promise<readonly RuntimeSessionRef[]> {
    return listByRun(this.sessionRefs, runId);
  }

  async appendRuntimeEvent(record: RuntimeEventRecord): Promise<void> {
    insert(this.events, "runtime event", record);
  }

  async listRuntimeEvents(
    runId: string,
  ): Promise<readonly RuntimeEventRecord[]> {
    return listByRun(this.events, runId);
  }

  async appendHistory(entry: WorkflowHistoryEntry): Promise<void> {
    insert(this.history, "history entry", entry);
  }

  async listHistory(runId: string): Promise<readonly WorkflowHistoryEntry[]> {
    return listByRun(this.history, runId);
  }
}

/** Create an isolated in-memory execution store. */
export function createInMemoryWorkflowPersistence(): WorkflowExecutionPersistence {
  return new InMemoryWorkflowPersistence();
}
