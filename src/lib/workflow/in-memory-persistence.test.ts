import { describe, expect, it } from "vitest";
import type {
  ApprovalRequest,
  RuntimeEventRecord,
  RuntimeSessionRef,
  StepRun,
  WorkflowExecutionPlan,
  WorkflowHistoryEntry,
  WorkflowRun,
} from "../../types/workflow";
import {
  createInMemoryWorkflowPersistence,
  WorkflowRecordError,
} from "./in-memory-persistence";

const PLAN: WorkflowExecutionPlan = {
  workflowId: "workflow-1",
  workflowVersion: 2,
  steps: [{ key: "step-1", prompt: "Do the work" }],
};

function baseRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflowId: "workflow-1",
    workflowVersion: 2,
    plan: PLAN,
    runtimeProfileId: "profile-opaque",
    workspaceRoot: "/workspace",
    status: "running",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    startedAt: "2026-10-30T00:00:00.000Z",
    pauseRequested: false,
    cancelRequested: false,
    ...overrides,
  };
}

function baseStep(overrides: Partial<StepRun> = {}): StepRun {
  return {
    id: "step-run-1",
    runId: "run-1",
    stepKey: "step-1",
    stepIndex: 0,
    status: "pending",
    attempts: 0,
    maxAttempts: 1,
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    status: "pending",
    message: "Continue?",
    requestedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseSessionRef(
  overrides: Partial<RuntimeSessionRef> = {},
): RuntimeSessionRef {
  return {
    id: "session-ref-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    runtimeSessionId: "fake-session-1",
    agentName: "fake",
    createdAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseEvent(overrides: Partial<RuntimeEventRecord> = {}): RuntimeEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    event: { type: "assistant_text_delta", text: "hello" },
    recordedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseHistory(
  overrides: Partial<WorkflowHistoryEntry> = {},
): WorkflowHistoryEntry {
  return {
    id: "history-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    kind: "step_started",
    message: "Step started",
    createdAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("createInMemoryWorkflowPersistence", () => {
  it("stores and reads every execution record", async () => {
    const store = createInMemoryWorkflowPersistence();

    await store.createRun(baseRun());
    await store.createStepRun(baseStep());
    await store.createApproval(baseApproval());
    await store.createRuntimeSessionRef(baseSessionRef());
    await store.appendRuntimeEvent(baseEvent());
    await store.appendHistory(baseHistory());

    expect(await store.getRun("run-1")).toEqual(baseRun());
    expect(await store.getStepRun("step-run-1")).toEqual(baseStep());
    expect(await store.getApproval("approval-1")).toEqual(baseApproval());
    expect(await store.getRuntimeSessionRef("session-ref-1")).toEqual(
      baseSessionRef(),
    );
    expect(await store.listRuntimeEvents("run-1")).toEqual([baseEvent()]);
    expect(await store.listHistory("run-1")).toEqual([baseHistory()]);
  });

  it("returns null for missing records", async () => {
    const store = createInMemoryWorkflowPersistence();

    expect(await store.getRun("missing")).toBeNull();
    expect(await store.getStepRun("missing")).toBeNull();
    expect(await store.getApproval("missing")).toBeNull();
    expect(await store.getRuntimeSessionRef("missing")).toBeNull();
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const store = createInMemoryWorkflowPersistence();
    const run = baseRun();

    await store.createRun(run);
    await store.createStepRun(baseStep());
    await store.appendRuntimeEvent(baseEvent());

    (run as unknown as { status: string }).status = "completed";

    const readRun = await store.getRun("run-1");
    (readRun as unknown as { status: string }).status = "failed";

    const readStep = await store.getStepRun("step-run-1");
    (readStep as unknown as { attempts: number }).attempts = 99;

    const readEvent = (await store.listRuntimeEvents("run-1"))[0];
    (readEvent as unknown as { event: { text: string } }).event.text = "changed";

    expect((await store.getRun("run-1"))?.status).toBe("running");
    expect((await store.getStepRun("step-run-1"))?.attempts).toBe(0);
    expect((await store.listRuntimeEvents("run-1"))[0]?.event).toEqual({
      type: "assistant_text_delta",
      text: "hello",
    });
  });

  it("rejects duplicate ids", async () => {
    const store = createInMemoryWorkflowPersistence();

    await store.createRun(baseRun());

    await expect(store.createRun(baseRun())).rejects.toThrow(
      WorkflowRecordError,
    );
    await expect(store.createRun(baseRun())).rejects.toThrow(
      'A workflow run with id "run-1" already exists',
    );
  });

  it("rejects updating a missing record", async () => {
    const store = createInMemoryWorkflowPersistence();

    await expect(store.updateRun(baseRun())).rejects.toThrow(
      'No workflow run with id "run-1" exists',
    );
  });

  it("preserves insertion order and filters lists by run", async () => {
    const store = createInMemoryWorkflowPersistence();

    await store.createRun(baseRun({ id: "run-a" }));
    await store.createRun(baseRun({ id: "run-b" }));
    await store.createStepRun(baseStep({ id: "step-a1", runId: "run-a" }));
    await store.createStepRun(baseStep({ id: "step-b1", runId: "run-b" }));
    await store.createStepRun(
      baseStep({ id: "step-a2", runId: "run-a", stepIndex: 1 }),
    );

    expect((await store.listRuns()).map((run) => run.id)).toEqual([
      "run-a",
      "run-b",
    ]);
    expect((await store.listStepRuns("run-a")).map((step) => step.id)).toEqual([
      "step-a1",
      "step-a2",
    ]);

    await store.updateStepRun(
      baseStep({ id: "step-a1", runId: "run-a", status: "completed" }),
    );

    expect((await store.listStepRuns("run-a")).map((step) => step.id)).toEqual([
      "step-a1",
      "step-a2",
    ]);
  });

  it("round-trips approvals and session references", async () => {
    const store = createInMemoryWorkflowPersistence();

    await store.createRun(baseRun());
    await store.createApproval(baseApproval());
    await store.createRuntimeSessionRef(baseSessionRef());

    await store.updateApproval(
      baseApproval({ status: "approved", response: "yes" }),
    );
    await store.updateRuntimeSessionRef(
      baseSessionRef({ closedAt: "2026-10-30T00:01:00.000Z" }),
    );

    expect(await store.listApprovals("run-1")).toEqual([
      baseApproval({ status: "approved", response: "yes" }),
    ]);
    expect(await store.listRuntimeSessionRefs("run-1")).toEqual([
      baseSessionRef({ closedAt: "2026-10-30T00:01:00.000Z" }),
    ]);
  });

  it("appends events and history in order", async () => {
    const store = createInMemoryWorkflowPersistence();

    await store.appendRuntimeEvent(baseEvent());
    await store.appendRuntimeEvent(
      baseEvent({ id: "event-2", event: { type: "assistant_text_delta", text: "bye" } }),
    );
    await store.appendHistory(baseHistory());
    await store.appendHistory(
      baseHistory({ id: "history-2", kind: "step_completed" }),
    );

    expect((await store.listRuntimeEvents("run-1")).map((event) => event.id)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect((await store.listHistory("run-1")).map((entry) => entry.id)).toEqual([
      "history-1",
      "history-2",
    ]);
  });

  it("isolates two store instances", async () => {
    const first = createInMemoryWorkflowPersistence();
    const second = createInMemoryWorkflowPersistence();

    await first.createRun(baseRun());

    expect(await first.getRun("run-1")).not.toBeNull();
    expect(await second.getRun("run-1")).toBeNull();
  });
});
