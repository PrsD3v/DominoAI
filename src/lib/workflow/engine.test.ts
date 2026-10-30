import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRuntime,
  CreateSessionRequest,
  Session,
} from "../../types/runtime";
import type { WorkflowExecutionPlan } from "../../types/workflow";
import { createFakeRuntime, type FakeTurn } from "../runtime/fake-runtime";
import { WorkspaceContainmentError } from "./containment";
import { createWorkflowEngine, WorkflowRunStateError } from "./engine";
import { InvalidExecutionPlanError } from "./execution-plan";
import { createInMemoryWorkflowPersistence } from "./in-memory-persistence";

interface TestRuntime {
  readonly runtime: AgentRuntime;
  readonly createSessionRequests: CreateSessionRequest[];
  readonly promptStarted: Promise<void>;
  readonly closeStarted: Promise<void>;
  readonly counters: {
    close: number;
    cancel: number;
    resume: number;
    load: number;
    list: number;
    runtimeClose: number;
  };
  setPromptGate(gate: Promise<void>): void;
  setCloseGate(gate: Promise<void>): void;
  failNextPrompt(error: Error): void;
  failNextClose(error: Error): void;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

function createTestRuntime(turns: FakeTurn[] = []): TestRuntime {
  const base = createFakeRuntime(turns);
  const createSessionRequests: CreateSessionRequest[] = [];
  const promptErrors: Error[] = [];
  const closeErrors: Error[] = [];
  const counters = {
    close: 0,
    cancel: 0,
    resume: 0,
    load: 0,
    list: 0,
    runtimeClose: 0,
  };
  let promptGate: Promise<void> | null = null;
  let closeGate: Promise<void> | null = null;
  let resolvePromptStarted: (() => void) | null = null;
  let resolveCloseStarted: (() => void) | null = null;
  const promptStarted = new Promise<void>((resolve) => {
    resolvePromptStarted = resolve;
  });
  const closeStarted = new Promise<void>((resolve) => {
    resolveCloseStarted = resolve;
  });

  const runtime: AgentRuntime = {
    capabilities: base.capabilities,
    async createSession(request: CreateSessionRequest): Promise<Session> {
      createSessionRequests.push(request);
      const session = await base.createSession(request);

      return {
        get id() {
          return session.id;
        },
        async prompt(promptRequest) {
          resolvePromptStarted?.();
          resolvePromptStarted = null;

          if (promptGate !== null) {
            const gate = promptGate;
            promptGate = null;
            await gate;
          }

          const error = promptErrors.shift();

          if (error !== undefined) {
            throw error;
          }

          return session.prompt(promptRequest);
        },
        async steer(text: string): Promise<void> {
          return session.steer(text);
        },
        cancel(): void {
          counters.cancel += 1;
          session.cancel();
        },
        async close(): Promise<void> {
          counters.close += 1;
          resolveCloseStarted?.();
          resolveCloseStarted = null;

          if (closeGate !== null) {
            const gate = closeGate;
            closeGate = null;
            await gate;
          }

          const error = closeErrors.shift();

          if (error !== undefined) {
            throw error;
          }

          return session.close();
        },
      };
    },
    async listSessions() {
      counters.list += 1;
      return base.listSessions();
    },
    async resumeSession(request) {
      counters.resume += 1;
      return base.resumeSession(request);
    },
    async loadSession(request) {
      counters.load += 1;
      return base.loadSession(request);
    },
    async close(): Promise<void> {
      counters.runtimeClose += 1;
      return base.close();
    },
  };

  return {
    runtime,
    createSessionRequests,
    promptStarted,
    closeStarted,
    counters,
    setPromptGate(gate: Promise<void>): void {
      promptGate = gate;
    },
    setCloseGate(gate: Promise<void>): void {
      closeGate = gate;
    },
    failNextPrompt(error: Error): void {
      promptErrors.push(error);
    },
    failNextClose(error: Error): void {
      closeErrors.push(error);
    },
  };
}

function createEngine(runtime: AgentRuntime) {
  const persistence = createInMemoryWorkflowPersistence();
  let id = 0;
  let tick = 0;
  const engine = createWorkflowEngine({
    persistence,
    runtime,
    idFactory: () => `id-${++id}`,
    now: () =>
      new Date(Date.UTC(2026, 9, 30, 0, 0, 0, tick++)).toISOString(),
  });

  return { engine, persistence };
}

function workflowPlan(
  steps: WorkflowExecutionPlan["steps"],
): WorkflowExecutionPlan {
  return { workflowId: "workflow-1", workflowVersion: 2, steps };
}

let base: string;
let workspaceRoot: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "domino-engine-"));
  workspaceRoot = join(base, "workspace");
  outside = join(base, "outside");
  await mkdir(workspaceRoot);
  await mkdir(join(workspaceRoot, "sub"));
  await mkdir(outside);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function runOptions() {
  return { workspaceRoot, runtimeProfileId: "profile-opaque" };
}

describe("workflow engine runner", () => {
  it("executes three steps in order and records state", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one"] },
      { deltas: ["two"] },
      { deltas: ["three"] },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const plan = workflowPlan([
      { key: "one", prompt: "Do one" },
      { key: "two", prompt: "Do two", workingDirectory: "sub" },
      { key: "three", prompt: "Do three", retry: { maxAttempts: 2 } },
    ]);

    const { runId, completion } = await engine.startRun(plan, runOptions());
    const run = await completion;

    expect(run.status).toBe("completed");
    expect(run.workflowId).toBe("workflow-1");
    expect(run.workflowVersion).toBe(2);
    expect(run.runtimeProfileId).toBe("profile-opaque");
    expect(run.workspaceRoot).toBe(await realpath(workspaceRoot));
    expect(run.plan).toEqual(plan);
    expect(run.plan).not.toBe(plan);
    expect(run.finishedAt).toBeDefined();

    const steps = await persistence.listStepRuns(runId);
    expect(steps.map((step) => step.stepKey)).toEqual(["one", "two", "three"]);
    expect(steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(steps.map((step) => step.attempts)).toEqual([1, 1, 1]);
    expect(steps.map((step) => step.maxAttempts)).toEqual([1, 1, 2]);
    expect(steps.map((step) => step.resultText)).toEqual([
      "one",
      "two",
      "three",
    ]);

    expect(testRuntime.createSessionRequests).toHaveLength(3);
    expect(
      testRuntime.createSessionRequests.map((request) => request.workspaceRoot),
    ).toEqual([
      await realpath(workspaceRoot),
      await realpath(workspaceRoot),
      await realpath(workspaceRoot),
    ]);

    const sessionRefs = await persistence.listRuntimeSessionRefs(runId);
    expect(sessionRefs).toHaveLength(3);
    expect(sessionRefs.map((ref) => ref.runtimeSessionId)).toEqual([
      "fake-session-1",
      "fake-session-2",
      "fake-session-3",
    ]);
    expect(sessionRefs.every((ref) => ref.agentName === "fake")).toBe(true);
    expect(sessionRefs.every((ref) => ref.closedAt !== undefined)).toBe(true);

    const events = await persistence.listRuntimeEvents(runId);
    expect(events.map((event) => event.event.text)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(events.every((event) => event.runId === runId)).toBe(true);

    const history = await persistence.listHistory(runId);
    expect(history.map((entry) => entry.kind)).toEqual([
      "run_started",
      "step_started",
      "step_completed",
      "step_started",
      "step_completed",
      "step_started",
      "step_completed",
      "run_completed",
    ]);
    expect(await persistence.listApprovals(runId)).toEqual([]);
    expect(testRuntime.counters.cancel).toBe(0);
    expect(testRuntime.counters.resume).toBe(0);
    expect(testRuntime.counters.load).toBe(0);
    expect(testRuntime.counters.runtimeClose).toBe(0);
  });

  it("rejects an invalid plan before creating a run", async () => {
    const testRuntime = createTestRuntime();
    const { engine, persistence } = createEngine(testRuntime.runtime);

    await expect(
      engine.startRun(workflowPlan([]), runOptions()),
    ).rejects.toBeInstanceOf(InvalidExecutionPlanError);
    expect(await persistence.listRuns()).toEqual([]);
    expect(testRuntime.createSessionRequests).toEqual([]);
  });

  it("rejects a missing or non-directory workspace root", async () => {
    const testRuntime = createTestRuntime();
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const plan = workflowPlan([{ key: "one", prompt: "Do one" }]);
    const fileRoot = join(base, "file-root");

    await writeFile(fileRoot, "not a directory");

    await expect(
      engine.startRun(plan, {
        workspaceRoot: join(base, "missing-root"),
        runtimeProfileId: "profile-opaque",
      }),
    ).rejects.toBeInstanceOf(WorkspaceContainmentError);
    await expect(
      engine.startRun(plan, {
        workspaceRoot: fileRoot,
        runtimeProfileId: "profile-opaque",
      }),
    ).rejects.toBeInstanceOf(WorkspaceContainmentError);

    expect(await persistence.listRuns()).toEqual([]);
    expect(testRuntime.createSessionRequests).toEqual([]);
  });

  it("refuses a second run while the first is current", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["first"] },
      { deltas: ["second"] },
    ]);
    const { engine } = createEngine(testRuntime.runtime);
    const gate = deferred();
    testRuntime.setPromptGate(gate.promise);

    const first = await engine.startRun(
      workflowPlan([{ key: "one", prompt: "Do one" }]),
      runOptions(),
    );
    await testRuntime.promptStarted;

    await expect(
      engine.startRun(
        workflowPlan([{ key: "two", prompt: "Do two" }]),
        runOptions(),
      ),
    ).rejects.toBeInstanceOf(WorkflowRunStateError);

    gate.resolve();
    await first.completion;

    const second = await engine.startRun(
      workflowPlan([{ key: "two", prompt: "Do two" }]),
      runOptions(),
    );
    await expect(second.completion).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("workflow engine attempt policy", () => {
  it("retries a thrown attempt and completes", async () => {
    const testRuntime = createTestRuntime([{ deltas: ["ok"] }]);
    testRuntime.failNextPrompt(new Error("first failure"));
    const { engine, persistence } = createEngine(testRuntime.runtime);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one", retry: { maxAttempts: 2 } },
      ]),
      runOptions(),
    );
    const run = await completion;

    expect(run.status).toBe("completed");

    const [step] = await persistence.listStepRuns(runId);
    expect(step.status).toBe("completed");
    expect(step.attempts).toBe(2);
    expect(step.resultText).toBe("ok");
    expect(step.error).toBeUndefined();

    const refs = await persistence.listRuntimeSessionRefs(runId);
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => ref.closedAt !== undefined)).toBe(true);

    const history = await persistence.listHistory(runId);
    expect(history.map((entry) => entry.kind)).toContain(
      "step_attempt_failed",
    );
    expect(history.map((entry) => entry.kind)).toContain("step_completed");
    expect(testRuntime.counters.close).toBe(2);
  });

  it("exhausts attempts and stops before the next step", async () => {
    const testRuntime = createTestRuntime();
    testRuntime.failNextPrompt(new Error("first"));
    testRuntime.failNextPrompt(new Error("second"));
    const { engine, persistence } = createEngine(testRuntime.runtime);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one", retry: { maxAttempts: 2 } },
        { key: "two", prompt: "Do two" },
      ]),
      runOptions(),
    );
    const run = await completion;

    expect(run.status).toBe("failed");
    expect(run.error).toBe("second");

    const steps = await persistence.listStepRuns(runId);
    expect(steps[0].status).toBe("failed");
    expect(steps[0].attempts).toBe(2);
    expect(steps[0].error).toBe("second");
    expect(steps[1].status).toBe("pending");
    expect(testRuntime.createSessionRequests).toHaveLength(2);

    const history = await persistence.listHistory(runId);
    const kinds = history.map((entry) => entry.kind);
    expect(kinds).toContain("step_attempt_failed");
    expect(kinds).toContain("step_failed");
    expect(kinds).toContain("run_failed");

    const started = history.filter((entry) => entry.kind === "step_started");
    expect(started).toHaveLength(1);
    expect(started[0].stepRunId).toBe(steps[0].id);
  });

  it("does not retry when maxAttempts is one", async () => {
    const testRuntime = createTestRuntime();
    testRuntime.failNextPrompt(new Error("once"));
    const { engine, persistence } = createEngine(testRuntime.runtime);

    const { runId, completion } = await engine.startRun(
      workflowPlan([{ key: "one", prompt: "Do one" }]),
      runOptions(),
    );
    const run = await completion;

    expect(run.status).toBe("failed");
    expect(run.error).toBe("once");

    const [step] = await persistence.listStepRuns(runId);
    expect(step.status).toBe("failed");
    expect(step.attempts).toBe(1);
    expect(testRuntime.createSessionRequests).toHaveLength(1);
    expect(
      (await persistence.listHistory(runId)).map((entry) => entry.kind),
    ).not.toContain("step_attempt_failed");
  });

  it("does not retry a cancelled prompt result", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["partial"], stopReason: "cancelled" },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one", retry: { maxAttempts: 3 } },
      ]),
      runOptions(),
    );
    const run = await completion;

    expect(run.status).toBe("cancelled");

    const [step] = await persistence.listStepRuns(runId);
    expect(step.status).toBe("cancelled");
    expect(step.attempts).toBe(1);
    expect(step.resultText).toBe("partial");
    expect(testRuntime.createSessionRequests).toHaveLength(1);

    const kinds = (await persistence.listHistory(runId)).map(
      (entry) => entry.kind,
    );
    expect(kinds).toContain("step_cancelled");
    expect(kinds).toContain("run_cancelled");
    expect(kinds).not.toContain("step_attempt_failed");
  });

  it("records a close failure after success without failing the step", async () => {
    const testRuntime = createTestRuntime([{ deltas: ["ok"] }]);
    testRuntime.failNextClose(new Error("close failed"));
    const { engine, persistence } = createEngine(testRuntime.runtime);

    const { runId, completion } = await engine.startRun(
      workflowPlan([{ key: "one", prompt: "Do one" }]),
      runOptions(),
    );
    const run = await completion;

    expect(run.status).toBe("completed");

    const [step] = await persistence.listStepRuns(runId);
    expect(step.status).toBe("completed");
    expect(step.resultText).toBe("ok");

    const [ref] = await persistence.listRuntimeSessionRefs(runId);
    expect(ref.closeError).toBe("close failed");
    expect(ref.closedAt).toBeDefined();

    expect(
      (await persistence.listHistory(runId)).map((entry) => entry.kind),
    ).toContain("session_close_failed");
  });

  it("records a close failure after prompt failure without masking it", async () => {
    const testRuntime = createTestRuntime();
    testRuntime.failNextPrompt(new Error("prompt failed"));
    testRuntime.failNextClose(new Error("close failed"));
    const { engine, persistence } = createEngine(testRuntime.runtime);

    const { runId, completion } = await engine.startRun(
      workflowPlan([{ key: "one", prompt: "Do one" }]),
      runOptions(),
    );
    const run = await completion;

    expect(run.status).toBe("failed");
    expect(run.error).toBe("prompt failed");

    const [step] = await persistence.listStepRuns(runId);
    expect(step.status).toBe("failed");
    expect(step.error).toBe("prompt failed");

    const [ref] = await persistence.listRuntimeSessionRefs(runId);
    expect(ref.closeError).toBe("close failed");

    const kinds = (await persistence.listHistory(runId)).map(
      (entry) => entry.kind,
    );
    expect(kinds).toContain("session_close_failed");
    expect(kinds).toContain("step_failed");
  });

  it("retries without a timer", async () => {
    vi.useFakeTimers();

    try {
      const testRuntime = createTestRuntime([{ deltas: ["ok"] }]);
      testRuntime.failNextPrompt(new Error("first failure"));
      const { engine } = createEngine(testRuntime.runtime);

      const { completion } = await engine.startRun(
        workflowPlan([
          { key: "one", prompt: "Do one", retry: { maxAttempts: 2 } },
        ]),
        runOptions(),
      );
      const run = await completion;

      expect(run.status).toBe("completed");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("workflow engine pause, continue, and cancel", () => {
  it("pauses during a step, keeps the next step pending, and continues", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const gate = deferred();
    testRuntime.setPromptGate(gate.promise);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one" },
        { key: "two", prompt: "Do two" },
      ]),
      runOptions(),
    );
    await testRuntime.promptStarted;

    const pausePromise = engine.pauseRun(runId);
    gate.resolve();
    await pausePromise;

    const paused = await completion;
    expect(paused.status).toBe("paused");

    await expect(
      engine.startRun(
        workflowPlan([{ key: "blocked", prompt: "Blocked" }]),
        runOptions(),
      ),
    ).rejects.toBeInstanceOf(WorkflowRunStateError);

    let steps = await persistence.listStepRuns(runId);
    expect(steps.map((step) => step.status)).toEqual(["completed", "pending"]);
    expect(testRuntime.createSessionRequests).toHaveLength(1);
    expect(
      (await persistence.listHistory(runId)).map((entry) => entry.kind),
    ).toContain("run_paused");
    expect(await persistence.listApprovals(runId)).toEqual([]);

    await expect(engine.pauseRun(runId)).rejects.toBeInstanceOf(
      WorkflowRunStateError,
    );

    const continued = await engine.continueRun(runId);
    expect(continued.status).toBe("completed");

    steps = await persistence.listStepRuns(runId);
    expect(steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(testRuntime.createSessionRequests).toHaveLength(2);

    const finalKinds = (await persistence.listHistory(runId)).map(
      (entry) => entry.kind,
    );
    expect(finalKinds).toContain("run_continued");
    expect(finalKinds).toContain("run_completed");
    expect(testRuntime.counters.cancel).toBe(0);
    expect(testRuntime.counters.resume).toBe(0);
    expect(testRuntime.counters.load).toBe(0);
  });

  it("pauses before the next step while the step is closing", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const closeGate = deferred();
    testRuntime.setCloseGate(closeGate.promise);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one" },
        { key: "two", prompt: "Do two" },
      ]),
      runOptions(),
    );
    await testRuntime.closeStarted;

    const pausePromise = engine.pauseRun(runId);
    closeGate.resolve();
    await pausePromise;

    const paused = await completion;
    expect(paused.status).toBe("paused");

    const steps = await persistence.listStepRuns(runId);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("pending");
    expect(testRuntime.createSessionRequests).toHaveLength(1);
  });

  it("cancels during a step and does not start the next step", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const gate = deferred();
    testRuntime.setPromptGate(gate.promise);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one" },
        { key: "two", prompt: "Do two" },
      ]),
      runOptions(),
    );
    await testRuntime.promptStarted;

    const cancelPromise = engine.cancelRun(runId);
    gate.resolve();
    await cancelPromise;

    const cancelled = await completion;
    expect(cancelled.status).toBe("cancelled");

    const steps = await persistence.listStepRuns(runId);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("pending");
    expect(testRuntime.createSessionRequests).toHaveLength(1);
    expect(
      (await persistence.listHistory(runId)).map((entry) => entry.kind),
    ).toContain("run_cancelled");

    await expect(engine.continueRun(runId)).rejects.toBeInstanceOf(
      WorkflowRunStateError,
    );
  });

  it("cancels between steps while the step is closing", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const closeGate = deferred();
    testRuntime.setCloseGate(closeGate.promise);

    const { runId, completion } = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one" },
        { key: "two", prompt: "Do two" },
      ]),
      runOptions(),
    );
    await testRuntime.closeStarted;

    const cancelPromise = engine.cancelRun(runId);
    closeGate.resolve();
    await cancelPromise;

    const cancelled = await completion;
    expect(cancelled.status).toBe("cancelled");

    const steps = await persistence.listStepRuns(runId);
    expect(steps[0].status).toBe("completed");
    expect(steps[1].status).toBe("pending");
    expect(testRuntime.createSessionRequests).toHaveLength(1);
  });

  it("cancels a paused run and allows a new run", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const gate = deferred();
    testRuntime.setPromptGate(gate.promise);

    const first = await engine.startRun(
      workflowPlan([
        { key: "one", prompt: "Do one" },
        { key: "two", prompt: "Do two" },
      ]),
      runOptions(),
    );
    await testRuntime.promptStarted;

    const pausePromise = engine.pauseRun(first.runId);
    gate.resolve();
    await pausePromise;
    await first.completion;

    await engine.cancelRun(first.runId);

    const cancelled = await persistence.getRun(first.runId);
    expect(cancelled?.status).toBe("cancelled");

    const next = await engine.startRun(
      workflowPlan([{ key: "next", prompt: "Do next" }]),
      runOptions(),
    );
    await expect(next.completion).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("rejects invalid transitions", async () => {
    const testRuntime = createTestRuntime([{ deltas: ["one"] }]);
    const { engine } = createEngine(testRuntime.runtime);
    const gate = deferred();
    testRuntime.setPromptGate(gate.promise);

    const { runId, completion } = await engine.startRun(
      workflowPlan([{ key: "one", prompt: "Do one" }]),
      runOptions(),
    );
    await testRuntime.promptStarted;

    await expect(engine.continueRun(runId)).rejects.toBeInstanceOf(
      WorkflowRunStateError,
    );

    gate.resolve();
    await completion;

    await expect(engine.pauseRun(runId)).rejects.toBeInstanceOf(
      WorkflowRunStateError,
    );
    await expect(engine.continueRun(runId)).rejects.toBeInstanceOf(
      WorkflowRunStateError,
    );
    await expect(engine.cancelRun(runId)).rejects.toBeInstanceOf(
      WorkflowRunStateError,
    );
  });
});

describe("workflow engine end-to-end", () => {
  it("combines retry, pause and continue, and containment refusal", async () => {
    const testRuntime = createTestRuntime([
      { deltas: ["one-ok"] },
      { deltas: ["two-ok"] },
    ]);
    testRuntime.failNextPrompt(new Error("first attempt failed"));
    const { engine, persistence } = createEngine(testRuntime.runtime);
    const gate = deferred();
    testRuntime.setPromptGate(gate.promise);

    const plan = workflowPlan([
      { key: "one", prompt: "Do one", retry: { maxAttempts: 2 } },
      { key: "two", prompt: "Do two" },
      {
        key: "three",
        prompt: "Do three",
        workingDirectory: "../outside",
      },
    ]);

    const { runId, completion } = await engine.startRun(plan, runOptions());
    await testRuntime.promptStarted;

    const pausePromise = engine.pauseRun(runId);
    gate.resolve();
    await pausePromise;

    const paused = await completion;
    expect(paused.status).toBe("paused");
    expect(paused.workspaceRoot).toBe(await realpath(workspaceRoot));
    expect(paused.runtimeProfileId).toBe("profile-opaque");

    let steps = await persistence.listStepRuns(runId);
    expect(steps.map((step) => step.status)).toEqual([
      "completed",
      "pending",
      "pending",
    ]);
    expect(steps.map((step) => step.attempts)).toEqual([2, 0, 0]);
    expect(testRuntime.createSessionRequests).toHaveLength(2);

    const pauseKinds = (await persistence.listHistory(runId)).map(
      (entry) => entry.kind,
    );
    expect(pauseKinds).toContain("step_attempt_failed");
    expect(pauseKinds).toContain("run_paused");

    const failed = await engine.continueRun(runId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("outside");

    steps = await persistence.listStepRuns(runId);
    expect(steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "failed",
    ]);
    expect(steps.map((step) => step.attempts)).toEqual([2, 1, 0]);
    expect(steps[1].resultText).toBe("two-ok");
    expect(steps[2].error).toContain("outside");
    expect(steps[2].finishedAt).toBeDefined();
    expect(testRuntime.createSessionRequests).toHaveLength(3);

    const sessionRefs = await persistence.listRuntimeSessionRefs(runId);
    expect(sessionRefs).toHaveLength(3);
    expect(
      sessionRefs.some((ref) => ref.stepRunId === steps[2].id),
    ).toBe(false);

    const events = await persistence.listRuntimeEvents(runId);
    expect(events.map((event) => event.event.text)).toEqual([
      "one-ok",
      "two-ok",
    ]);

    const history = await persistence.listHistory(runId);
    const kinds = history.map((entry) => entry.kind);
    expect(kinds).toContain("run_paused");
    expect(kinds).toContain("run_continued");
    expect(kinds).toContain("containment_refused");
    expect(kinds).toContain("run_failed");
    expect(
      history
        .filter((entry) => entry.stepRunId === steps[2].id)
        .map((entry) => entry.kind),
    ).toEqual(["step_started", "containment_refused"]);

    expect(await persistence.listApprovals(runId)).toEqual([]);
    expect(testRuntime.counters.cancel).toBe(0);
    expect(testRuntime.counters.resume).toBe(0);
    expect(testRuntime.counters.load).toBe(0);
    expect(testRuntime.counters.runtimeClose).toBe(0);
  });
});



