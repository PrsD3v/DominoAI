import { describe, expect, it } from "vitest";
import type {
  ApprovalRequest,
  RuntimeEventRecord,
  RuntimeSessionRef,
  StepRun,
  StepRunStatus,
  WorkflowExecutionPlan,
  WorkflowHistoryEntry,
  WorkflowRun,
  WorkflowRunStatus,
} from "./workflow";

describe("workflow execution contracts", () => {
  it("exposes the run status vocabulary", () => {
    const statuses: WorkflowRunStatus[] = [
      "pending",
      "running",
      "paused",
      "waiting_approval",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ];

    expect(statuses).toHaveLength(8);
  });

  it("exposes the step status vocabulary", () => {
    const statuses: StepRunStatus[] = [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
    ];

    expect(statuses).toHaveLength(5);
  });

  it("supports a complete execution record without provider or credential data", () => {
    const plan: WorkflowExecutionPlan = {
      workflowId: "workflow-1",
      workflowVersion: 3,
      steps: [
        {
          key: "step-1",
          prompt: "Do the work",
          retry: { maxAttempts: 2 },
        },
      ],
    };
    const run: WorkflowRun = {
      id: "run-1",
      workflowId: plan.workflowId,
      workflowVersion: plan.workflowVersion,
      plan,
      runtimeProfileId: "profile-opaque",
      workspaceRoot: "/workspace",
      status: "pending",
      createdAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
      pauseRequested: false,
      cancelRequested: false,
    };
    const step: StepRun = {
      id: "step-run-1",
      runId: run.id,
      stepKey: "step-1",
      stepIndex: 0,
      status: "pending",
      attempts: 0,
      maxAttempts: 2,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
    const approval: ApprovalRequest = {
      id: "approval-1",
      runId: run.id,
      stepRunId: step.id,
      status: "pending",
      message: "Continue?",
      requestedAt: run.createdAt,
    };
    const session: RuntimeSessionRef = {
      id: "session-ref-1",
      runId: run.id,
      stepRunId: step.id,
      runtimeSessionId: "runtime-session-1",
      agentName: "fake",
      createdAt: run.createdAt,
    };
    const event: RuntimeEventRecord = {
      id: "event-1",
      runId: run.id,
      stepRunId: step.id,
      event: { type: "assistant_text_delta", text: "hello" },
      recordedAt: run.createdAt,
    };
    const history: WorkflowHistoryEntry = {
      id: "history-1",
      runId: run.id,
      stepRunId: step.id,
      kind: "step_started",
      message: "Step started",
      createdAt: run.createdAt,
    };

    expect(run.plan).toBe(plan);
    expect(run.runtimeProfileId).toBe("profile-opaque");
    expect(step.maxAttempts).toBe(2);
    expect(approval.status).toBe("pending");
    expect(session.agentName).toBe("fake");
    expect(event.event).toEqual({
      type: "assistant_text_delta",
      text: "hello",
    });
    expect(history.kind).toBe("step_started");
  });
});
