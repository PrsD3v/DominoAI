import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  StepRun,
  StepRunStatus,
  WorkflowExecutionPersistence,
  WorkflowRun,
  WorkflowRunStatus,
} from "../../types/workflow";
import { createInMemoryWorkflowPersistence } from "./in-memory-persistence";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "./sqlite/sqlite-store";
import { reconcileInterruptedRuns } from "./startup-reconciliation";

const CLOCK = "2026-10-30T12:00:00.000Z";

const ACTIVE_STATUSES: readonly WorkflowRunStatus[] = [
  "pending",
  "running",
  "paused",
  "waiting_approval",
];

const TERMINAL_STATUSES: readonly WorkflowRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

const directories: string[] = [];
const stores: SqliteWorkflowStore[] = [];

async function createSqliteStore(): Promise<SqliteWorkflowStore> {
  const directory = await mkdtemp(join(tmpdir(), "domino-reconciliation-"));
  directories.push(directory);
  const store = openSqliteWorkflowStore({
    path: join(directory, "domino.db"),
  });
  stores.push(store);
  return store;
}

function baseRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflowId: "workflow-1",
    workflowVersion: 2,
    plan: {
      workflowId: "workflow-1",
      workflowVersion: 2,
      steps: [{ key: "step-1", prompt: "Do the work" }],
    },
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

function baseStep(
  id: string,
  runId: string,
  status: StepRunStatus,
): StepRun {
  return {
    id,
    runId,
    stepKey: id,
    stepIndex: 0,
    status,
    attempts: 0,
    maxAttempts: 1,
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  };
}

const IMPLEMENTATIONS: ReadonlyArray<
  readonly [string, () => Promise<WorkflowExecutionPersistence>]
> = [
  ["in-memory persistence", async () => createInMemoryWorkflowPersistence()],
  ["SQLite persistence", createSqliteStore],
];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const [name, createStore] of IMPLEMENTATIONS) {
  describe(`reconcileInterruptedRuns over ${name}`, () => {
    it("marks every active status interrupted and clears request flags", async () => {
      const persistence = await createStore();

      for (const [index, status] of ACTIVE_STATUSES.entries()) {
        await persistence.createRun(
          baseRun({
            id: `run-${index}`,
            status,
            pauseRequested: true,
            cancelRequested: true,
          }),
        );
      }

      const interrupted = await reconcileInterruptedRuns({
        persistence,
        now: () => CLOCK,
      });

      expect(interrupted.map((run) => run.id)).toEqual([
        "run-0",
        "run-1",
        "run-2",
        "run-3",
      ]);

      for (const run of await persistence.listRuns()) {
        expect(run.status).toBe("interrupted");
        expect(run.finishedAt).toBe(CLOCK);
        expect(run.updatedAt).toBe(CLOCK);
        expect(run.pauseRequested).toBe(false);
        expect(run.cancelRequested).toBe(false);
      }
    });

    it("leaves terminal runs untouched", async () => {
      const persistence = await createStore();

      for (const [index, status] of TERMINAL_STATUSES.entries()) {
        await persistence.createRun(baseRun({ id: `run-${index}`, status }));
      }

      const interrupted = await reconcileInterruptedRuns({
        persistence,
        now: () => CLOCK,
      });

      expect(interrupted).toEqual([]);

      for (const [index, status] of TERMINAL_STATUSES.entries()) {
        expect(await persistence.getRun(`run-${index}`)).toEqual(
          baseRun({ id: `run-${index}`, status }),
        );
      }

      for (const [index] of TERMINAL_STATUSES.entries()) {
        expect(await persistence.listHistory(`run-${index}`)).toEqual([]);
      }
    });

    it("preserves step states and history while adding one entry", async () => {
      const persistence = await createStore();

      await persistence.createRun(baseRun({ id: "run-1", status: "running" }));
      await persistence.createStepRun(baseStep("step-1", "run-1", "running"));
      await persistence.createStepRun(baseStep("step-2", "run-1", "completed"));
      await persistence.appendHistory({
        id: "history-1",
        runId: "run-1",
        kind: "run_started",
        message: "Run started",
        createdAt: "2026-10-30T00:00:00.000Z",
      });

      await reconcileInterruptedRuns({ persistence, now: () => CLOCK });

      const steps = await persistence.listStepRuns("run-1");
      expect(steps.map((step) => step.status)).toEqual([
        "running",
        "completed",
      ]);

      const history = await persistence.listHistory("run-1");
      expect(history.map((entry) => entry.id)).toEqual([
        "history-1",
        "run-1:interrupted",
      ]);
      expect(history[1]).toMatchObject({
        kind: "run_interrupted",
        createdAt: CLOCK,
      });
      expect(history[1]?.stepRunId).toBeUndefined();
    });

    it("writes nothing on a second call", async () => {
      const persistence = await createStore();

      await persistence.createRun(baseRun({ id: "run-1", status: "paused" }));

      const first = await reconcileInterruptedRuns({
        persistence,
        now: () => CLOCK,
      });
      const second = await reconcileInterruptedRuns({
        persistence,
        now: () => CLOCK,
      });

      expect(first).toHaveLength(1);
      expect(second).toEqual([]);
      expect(await persistence.listHistory("run-1")).toHaveLength(1);
      expect((await persistence.getRun("run-1"))?.status).toBe("interrupted");
    });

    it("takes each finish time from the injected clock", async () => {
      const persistence = await createStore();
      let tick = 0;
      const now = (): string =>
        new Date(Date.UTC(2026, 9, 30, 0, 0, tick++)).toISOString();

      await persistence.createRun(baseRun({ id: "run-a", status: "running" }));
      await persistence.createRun(baseRun({ id: "run-b", status: "running" }));

      await reconcileInterruptedRuns({ persistence, now });

      expect((await persistence.getRun("run-a"))?.finishedAt).toBe(
        "2026-10-30T00:00:00.000Z",
      );
      expect((await persistence.getRun("run-b"))?.finishedAt).toBe(
        "2026-10-30T00:00:01.000Z",
      );
    });
  });
}
