import type { AgentRuntime, PromptResult, Session } from "../../types/runtime";
import type {
  RuntimeEventRecord,
  RuntimeSessionRef,
  StepRun,
  WorkflowExecutionPersistence,
  WorkflowExecutionPlan,
  WorkflowHistoryKind,
  WorkflowRun,
  WorkflowRunStatus,
} from "../../types/workflow";
import { resolveContainedStepPath } from "./containment";
import { validateExecutionPlan } from "./execution-plan";

/** Dependencies required to create an engine. */
export interface CreateWorkflowEngineOptions {
  readonly persistence: WorkflowExecutionPersistence;
  readonly runtime: AgentRuntime;
  readonly idFactory: () => string;
  readonly now: () => string;
}

/** Per-run workspace and opaque runtime profile binding. */
export interface StartWorkflowRunOptions {
  readonly workspaceRoot: string;
  readonly runtimeProfileId: string;
}

/** A started run handle. The completion promise never rejects for a step failure. */
export interface WorkflowRunHandle {
  readonly runId: string;
  readonly completion: Promise<WorkflowRun>;
}

/** Workflow engine operations exposed to the application. */
export interface WorkflowEngine {
  startRun(
    plan: WorkflowExecutionPlan,
    options: StartWorkflowRunOptions,
  ): Promise<WorkflowRunHandle>;
  pauseRun(runId: string): Promise<void>;
  continueRun(runId: string): Promise<WorkflowRun>;
  cancelRun(runId: string): Promise<void>;
}

/** Run operation named by a state error. */
export type WorkflowRunOperation = "start" | "pause" | "continue" | "cancel";

/** Raised when a run operation is not valid for the current engine state. */
export class WorkflowRunStateError extends Error {
  readonly operation: WorkflowRunOperation;
  readonly runId: string | null;
  readonly status: WorkflowRunStatus | "unknown";

  constructor(
    operation: WorkflowRunOperation,
    runId: string | null,
    status: WorkflowRunStatus | "unknown",
  ) {
    const target = runId === null ? "a new run" : `run "${runId}"`;

    super(`Cannot ${operation} ${target} while it is ${status}`);
    this.name = "WorkflowRunStateError";
    this.operation = operation;
    this.runId = runId;
    this.status = status;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface ActiveRun {
  readonly runId: string;
  status: WorkflowRunStatus;
  pauseRequested: boolean;
  cancelRequested: boolean;
  completion: Promise<WorkflowRun>;
  resolveCompletion: (run: WorkflowRun) => void;
  readonly pauseWaiters: Array<() => void>;
  readonly cancelWaiters: Array<() => void>;
}

type StepOutcome =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "cancelled" };

interface AttemptResult {
  readonly result: PromptResult | null;
  readonly error: unknown | null;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveWaiters(waiters: Array<() => void>): void {
  for (const resolve of waiters) {
    resolve();
  }

  waiters.length = 0;
}

class WorkflowEngineImpl implements WorkflowEngine {
  private active: ActiveRun | null = null;
  private starting = false;

  constructor(private readonly options: CreateWorkflowEngineOptions) {}

  async startRun(
    plan: WorkflowExecutionPlan,
    options: StartWorkflowRunOptions,
  ): Promise<WorkflowRunHandle> {
    validateExecutionPlan(plan);

    if (this.active !== null || this.starting) {
      throw new WorkflowRunStateError(
        "start",
        this.active?.runId ?? null,
        this.active?.status ?? "running",
      );
    }

    this.starting = true;

    try {
      const workspaceRoot = await resolveContainedStepPath({
        workspaceRoot: options.workspaceRoot,
      });
      const timestamp = this.options.now();
      const runId = this.options.idFactory();
      const run: WorkflowRun = {
        id: runId,
        workflowId: plan.workflowId,
        workflowVersion: plan.workflowVersion,
        plan: structuredClone(plan),
        runtimeProfileId: options.runtimeProfileId,
        workspaceRoot,
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        pauseRequested: false,
        cancelRequested: false,
      };

      await this.options.persistence.createRun(run);

      for (let index = 0; index < plan.steps.length; index += 1) {
        const step = plan.steps[index];
        const stepRun: StepRun = {
          id: this.options.idFactory(),
          runId,
          stepKey: step.key,
          stepIndex: index,
          status: "pending",
          attempts: 0,
          maxAttempts: step.retry?.maxAttempts ?? 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await this.options.persistence.createStepRun(stepRun);
      }

      await this.appendHistory(runId, "run_started", "Run started");

      const completion = deferred<WorkflowRun>();
      const active: ActiveRun = {
        runId,
        status: "running",
        pauseRequested: false,
        cancelRequested: false,
        completion: completion.promise,
        resolveCompletion: completion.resolve,
        pauseWaiters: [],
        cancelWaiters: [],
      };

      this.active = active;
      void this.run(active);

      return { runId, completion: completion.promise };
    } finally {
      this.starting = false;
    }
  }

  async pauseRun(runId: string): Promise<void> {
    const active = this.requireActive(runId, "pause");
    const run = await this.requireRun(runId);

    if (run.status !== "running") {
      throw new WorkflowRunStateError("pause", runId, run.status);
    }

    active.pauseRequested = true;
    const waiter = new Promise<void>((resolve) => {
      active.pauseWaiters.push(resolve);
    });

    await this.options.persistence.updateRun({
      ...run,
      pauseRequested: true,
      updatedAt: this.options.now(),
    });

    return waiter;
  }

  async continueRun(runId: string): Promise<WorkflowRun> {
    const active = this.requireActive(runId, "continue");
    const run = await this.requireRun(runId);

    if (run.status !== "paused") {
      throw new WorkflowRunStateError("continue", runId, run.status);
    }

    await this.options.persistence.updateRun({
      ...run,
      status: "running",
      pauseRequested: false,
      cancelRequested: false,
      updatedAt: this.options.now(),
    });
    await this.appendHistory(runId, "run_continued", "Run continued");

    active.status = "running";
    active.pauseRequested = false;
    active.cancelRequested = false;

    const completion = deferred<WorkflowRun>();
    active.completion = completion.promise;
    active.resolveCompletion = completion.resolve;
    void this.run(active);

    return completion.promise;
  }

  async cancelRun(runId: string): Promise<void> {
    const active = this.requireActive(runId, "cancel");
    const run = await this.requireRun(runId);

    if (run.status !== "running" && run.status !== "paused") {
      throw new WorkflowRunStateError("cancel", runId, run.status);
    }

    active.cancelRequested = true;
    const waiter = new Promise<void>((resolve) => {
      active.cancelWaiters.push(resolve);
    });
    const updated: WorkflowRun = {
      ...run,
      cancelRequested: true,
      updatedAt: this.options.now(),
    };

    await this.options.persistence.updateRun(updated);

    if (run.status === "paused") {
      await this.cancel(active, updated);
    }

    return waiter;
  }

  private async run(active: ActiveRun): Promise<void> {
    try {
      await this.execute(active);
    } catch (error) {
      await this.failRun(active, error);
    }
  }

  private async execute(active: ActiveRun): Promise<void> {
    const run = await this.requireRun(active.runId);
    const stepRuns = await this.options.persistence.listStepRuns(active.runId);

    for (const stepRun of stepRuns) {
      if (stepRun.status === "completed" || stepRun.status === "cancelled") {
        continue;
      }

      if (stepRun.status === "failed") {
        await this.failRun(
          active,
          new Error(stepRun.error ?? "Step failed before resume"),
        );
        return;
      }

      if (active.cancelRequested) {
        await this.cancel(active, await this.requireRun(active.runId));
        return;
      }

      if (active.pauseRequested) {
        await this.pause(active, await this.requireRun(active.runId));
        return;
      }

      const step = run.plan.steps[stepRun.stepIndex];

      if (step === undefined) {
        await this.failRun(
          active,
          new Error(`No workflow step exists at index ${stepRun.stepIndex}`),
        );
        return;
      }

      const outcome = await this.executeStep(run, stepRun, step);

      if (outcome.status === "failed") {
        await this.failRun(active, new Error(outcome.error));
        return;
      }

      if (outcome.status === "cancelled") {
        await this.cancel(active, await this.requireRun(active.runId));
        return;
      }

      const currentRun = await this.requireRun(active.runId);

      if (active.cancelRequested) {
        await this.cancel(active, currentRun);
        return;
      }

      if (
        active.pauseRequested &&
        (await this.hasPendingSteps(active.runId))
      ) {
        await this.pause(active, currentRun);
        return;
      }
    }

    await this.complete(active, await this.requireRun(active.runId));
  }

  private async executeStep(
    run: WorkflowRun,
    stepRun: StepRun,
    step: WorkflowExecutionPlan["steps"][number],
  ): Promise<StepOutcome> {
    let current = stepRun;

    if (current.attempts === 0) {
      const startedAt = this.options.now();
      current = {
        ...current,
        status: "running",
        startedAt,
        updatedAt: startedAt,
      };
      await this.options.persistence.updateStepRun(current);
      await this.appendHistory(
        run.id,
        "step_started",
        `Step ${step.key} started`,
        current.id,
      );
    } else {
      current = {
        ...current,
        status: "running",
        updatedAt: this.options.now(),
      };
      await this.options.persistence.updateStepRun(current);
    }

    while (current.attempts < current.maxAttempts) {
      try {
        await resolveContainedStepPath({
          workspaceRoot: run.workspaceRoot,
          workingDirectory: step.workingDirectory,
        });
      } catch (error) {
        const message = describeError(error);
        const failedAt = this.options.now();
        current = {
          ...current,
          status: "failed",
          error: message,
          finishedAt: failedAt,
          updatedAt: failedAt,
        };
        await this.options.persistence.updateStepRun(current);
        await this.appendHistory(
          run.id,
          "containment_refused",
          message,
          current.id,
        );
        return { status: "failed", error: message };
      }

      const attempt = current.attempts + 1;
      const attemptStartedAt = this.options.now();
      current = {
        ...current,
        status: "running",
        attempts: attempt,
        startedAt: current.startedAt ?? attemptStartedAt,
        updatedAt: attemptStartedAt,
      };
      await this.options.persistence.updateStepRun(current);

      const attemptResult = await this.runAttempt(run, current, step);

      if (attemptResult.error !== null) {
        const message = describeError(attemptResult.error);

        if (attempt < current.maxAttempts) {
          await this.appendHistory(
            run.id,
            "step_attempt_failed",
            `Step ${step.key} attempt ${attempt} failed: ${message}`,
            current.id,
          );
          current = {
            ...current,
            status: "running",
            error: message,
            updatedAt: this.options.now(),
          };
          await this.options.persistence.updateStepRun(current);
          continue;
        }

        const failedAt = this.options.now();
        current = {
          ...current,
          status: "failed",
          error: message,
          finishedAt: failedAt,
          updatedAt: failedAt,
        };
        await this.options.persistence.updateStepRun(current);
        await this.appendHistory(
          run.id,
          "step_failed",
          `Step ${step.key} failed: ${message}`,
          current.id,
        );
        return { status: "failed", error: message };
      }

      const result = attemptResult.result;

      if (result === null) {
        const message = "Runtime attempt returned no result";
        const failedAt = this.options.now();
        current = {
          ...current,
          status: "failed",
          error: message,
          finishedAt: failedAt,
          updatedAt: failedAt,
        };
        await this.options.persistence.updateStepRun(current);
        await this.appendHistory(
          run.id,
          "step_failed",
          `Step ${step.key} failed: ${message}`,
          current.id,
        );
        return { status: "failed", error: message };
      }

      if (result.stopReason === "cancelled") {
        const finishedAt = this.options.now();
        current = {
          ...current,
          status: "cancelled",
          resultText: result.text,
          finishedAt,
          updatedAt: finishedAt,
        };
        await this.options.persistence.updateStepRun(current);
        await this.appendHistory(
          run.id,
          "step_cancelled",
          `Step ${step.key} cancelled`,
          current.id,
        );
        return { status: "cancelled" };
      }

      const finishedAt = this.options.now();
      current = {
        ...current,
        status: "completed",
        resultText: result.text,
        error: undefined,
        finishedAt,
        updatedAt: finishedAt,
      };
      await this.options.persistence.updateStepRun(current);
      await this.appendHistory(
        run.id,
        "step_completed",
        `Step ${step.key} completed`,
        current.id,
      );
      return { status: "completed" };
    }

    const message = `Step ${step.key} has no remaining attempts`;
    const failedAt = this.options.now();
    current = {
      ...current,
      status: "failed",
      error: message,
      finishedAt: failedAt,
      updatedAt: failedAt,
    };
    await this.options.persistence.updateStepRun(current);
    await this.appendHistory(run.id, "step_failed", message, current.id);

    return { status: "failed", error: message };
  }

  private async runAttempt(
    run: WorkflowRun,
    stepRun: StepRun,
    step: WorkflowExecutionPlan["steps"][number],
  ): Promise<AttemptResult> {
    const events: RuntimeEventRecord[] = [];
    let session: Session | null = null;
    let sessionRef: RuntimeSessionRef | null = null;
    let sessionRefPersisted = false;
    let result: PromptResult | null = null;
    let error: unknown | null = null;

    try {
      session = await this.options.runtime.createSession({
        workspaceRoot: run.workspaceRoot,
      });
      sessionRef = {
        id: this.options.idFactory(),
        runId: run.id,
        stepRunId: stepRun.id,
        runtimeSessionId: session.id,
        agentName: this.options.runtime.capabilities.agent?.name ?? null,
        createdAt: this.options.now(),
      };
      await this.options.persistence.createRuntimeSessionRef(sessionRef);
      sessionRefPersisted = true;
      result = await session.prompt({
        text: step.prompt,
        onEvent: (event) => {
          events.push({
            id: this.options.idFactory(),
            runId: run.id,
            stepRunId: stepRun.id,
            event,
            recordedAt: this.options.now(),
          });
        },
      });
    } catch (caught) {
      error = caught;
    } finally {
      try {
        for (const event of events) {
          await this.options.persistence.appendRuntimeEvent(event);
        }
      } finally {
        if (session !== null) {
          await this.closeSession(
            run.id,
            stepRun.id,
            session,
            sessionRefPersisted ? sessionRef : null,
          );
        }
      }
    }

    return { result, error };
  }

  private async closeSession(
    runId: string,
    stepRunId: string,
    session: Session,
    sessionRef: RuntimeSessionRef | null,
  ): Promise<void> {
    try {
      await session.close();

      if (sessionRef !== null) {
        await this.options.persistence.updateRuntimeSessionRef({
          ...sessionRef,
          closedAt: this.options.now(),
        });
      }
    } catch (error) {
      const message = describeError(error);

      if (sessionRef !== null) {
        await this.options.persistence.updateRuntimeSessionRef({
          ...sessionRef,
          closedAt: this.options.now(),
          closeError: message,
        });
      }

      await this.appendHistory(
        runId,
        "session_close_failed",
        `Session close failed: ${message}`,
        stepRunId,
      );
    }
  }

  private async pause(active: ActiveRun, run: WorkflowRun): Promise<void> {
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return;
    }

    const pausedAt = this.options.now();
    const paused: WorkflowRun = {
      ...run,
      status: "paused",
      pauseRequested: false,
      updatedAt: pausedAt,
    };

    await this.options.persistence.updateRun(paused);
    await this.appendHistory(run.id, "run_paused", "Run paused");

    active.status = "paused";
    active.pauseRequested = false;
    resolveWaiters(active.pauseWaiters);
    active.resolveCompletion(paused);
  }

  private async cancel(active: ActiveRun, run: WorkflowRun): Promise<void> {
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return;
    }

    const cancelledAt = this.options.now();
    const cancelled: WorkflowRun = {
      ...run,
      status: "cancelled",
      pauseRequested: false,
      cancelRequested: false,
      finishedAt: cancelledAt,
      updatedAt: cancelledAt,
    };

    await this.options.persistence.updateRun(cancelled);
    await this.appendHistory(run.id, "run_cancelled", "Run cancelled");

    active.status = "cancelled";
    resolveWaiters(active.pauseWaiters);
    resolveWaiters(active.cancelWaiters);
    active.resolveCompletion(cancelled);
    this.active = null;
  }

  private async complete(active: ActiveRun, run: WorkflowRun): Promise<void> {
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return;
    }

    const completedAt = this.options.now();
    const completed: WorkflowRun = {
      ...run,
      status: "completed",
      pauseRequested: false,
      cancelRequested: false,
      finishedAt: completedAt,
      updatedAt: completedAt,
    };

    await this.options.persistence.updateRun(completed);
    await this.appendHistory(run.id, "run_completed", "Run completed");

    active.status = "completed";
    resolveWaiters(active.pauseWaiters);
    resolveWaiters(active.cancelWaiters);
    active.resolveCompletion(completed);
    this.active = null;
  }

  private async failRun(active: ActiveRun, error: unknown): Promise<void> {
    const run = await this.requireRun(active.runId);

    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return;
    }

    const message = describeError(error);
    const failedAt = this.options.now();
    const stepRuns = await this.options.persistence.listStepRuns(run.id);
    const runningStep = stepRuns.find((step) => step.status === "running");

    if (runningStep !== undefined) {
      await this.options.persistence.updateStepRun({
        ...runningStep,
        status: "failed",
        error: message,
        finishedAt: failedAt,
        updatedAt: failedAt,
      });
      await this.appendHistory(
        run.id,
        "step_failed",
        `Step ${runningStep.stepKey} failed: ${message}`,
        runningStep.id,
      );
    }

    const failed: WorkflowRun = {
      ...run,
      status: "failed",
      error: message,
      pauseRequested: false,
      cancelRequested: false,
      finishedAt: failedAt,
      updatedAt: failedAt,
    };

    await this.options.persistence.updateRun(failed);
    await this.appendHistory(run.id, "run_failed", message);

    active.status = "failed";
    resolveWaiters(active.pauseWaiters);
    resolveWaiters(active.cancelWaiters);
    active.resolveCompletion(failed);
    this.active = null;
  }

  private async hasPendingSteps(runId: string): Promise<boolean> {
    const stepRuns = await this.options.persistence.listStepRuns(runId);
    return stepRuns.some(
      (step) => step.status === "pending" || step.status === "running",
    );
  }

  private async appendHistory(
    runId: string,
    kind: WorkflowHistoryKind,
    message: string,
    stepRunId?: string,
  ): Promise<void> {
    await this.options.persistence.appendHistory({
      id: this.options.idFactory(),
      runId,
      ...(stepRunId === undefined ? {} : { stepRunId }),
      kind,
      message,
      createdAt: this.options.now(),
    });
  }

  private async requireRun(runId: string): Promise<WorkflowRun> {
    const run = await this.options.persistence.getRun(runId);

    if (run === null) {
      throw new Error(`Workflow run "${runId}" does not exist`);
    }

    return run;
  }

  private requireActive(
    runId: string,
    operation: WorkflowRunOperation,
  ): ActiveRun {
    if (this.active === null || this.active.runId !== runId) {
      throw new WorkflowRunStateError(operation, runId, "unknown");
    }

    return this.active;
  }
}

/** Create a sequential workflow engine over application-owned persistence. */
export function createWorkflowEngine(
  options: CreateWorkflowEngineOptions,
): WorkflowEngine {
  return new WorkflowEngineImpl(options);
}
