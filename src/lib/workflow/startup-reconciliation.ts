import type {
  WorkflowExecutionPersistence,
  WorkflowRun,
  WorkflowRunStatus,
} from "../../types/workflow";

/** Run statuses that mean the run was still active when the process stopped. */
const ACTIVE_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "pending",
  "running",
  "paused",
  "waiting_approval",
]);

/** Dependencies for reconciling runs left active by a stopped process. */
export interface ReconcileInterruptedRunsOptions {
  readonly persistence: WorkflowExecutionPersistence;
  readonly now: () => string;
}

/**
 * Mark every run that was active when the process stopped as `interrupted`.
 * Step states and existing history are preserved, nothing is resumed or retried,
 * and a second call writes nothing because no active run remains.
 */
export async function reconcileInterruptedRuns(
  options: ReconcileInterruptedRunsOptions,
): Promise<readonly WorkflowRun[]> {
  const runs = await options.persistence.listRuns();
  const interrupted: WorkflowRun[] = [];

  for (const run of runs) {
    if (!ACTIVE_STATUSES.has(run.status)) {
      continue;
    }

    const timestamp = options.now();
    const approvals = await options.persistence.listApprovals(run.id);

    for (const approval of approvals) {
      if (approval.status !== "pending") {
        continue;
      }

      await options.persistence.updateApproval({
        ...approval,
        status: "cancelled",
        resolvedAt: timestamp,
      });
      await options.persistence.appendHistory({
        id: `${run.id}:approval-cancelled:${approval.id}`,
        runId: run.id,
        stepRunId: approval.stepRunId,
        kind: "approval_cancelled",
        message: `Approval "${approval.message}" cancelled`,
        createdAt: timestamp,
      });
    }

    const updated: WorkflowRun = {
      ...run,
      status: "interrupted",
      pauseRequested: false,
      cancelRequested: false,
      finishedAt: timestamp,
      updatedAt: timestamp,
    };

    await options.persistence.updateRun(updated);
    await options.persistence.appendHistory({
      id: `${run.id}:interrupted`,
      runId: run.id,
      kind: "run_interrupted",
      message: "Run interrupted when the Domino process stopped",
      createdAt: timestamp,
    });

    interrupted.push(updated);
  }

  return interrupted;
}
