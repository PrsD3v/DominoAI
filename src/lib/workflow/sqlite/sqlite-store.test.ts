import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type {
  ApprovalRequest,
  RuntimeEventRecord,
  RuntimeSessionRef,
  StepRun,
  WorkflowExecutionPersistence,
  WorkflowExecutionPlan,
  WorkflowHistoryEntry,
  WorkflowRun,
} from "../../../types/workflow";
import type { Project } from "../../../types/persistence";
import { createFakeRuntime } from "../../runtime/fake-runtime";
import { createWorkflowEngine } from "../engine";
import {
  WorkflowPersistenceError,
  WorkflowRecordError,
} from "../persistence-errors";
import type {
  SkillVersion,
  WorkflowVersion,
} from "../../../types/workflow-definition";
import { openSqliteDatabase } from "./migrations";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "./sqlite-store";

const PLAN: WorkflowExecutionPlan = {
  workflowId: "workflow-1",
  workflowVersion: 2,
  steps: [{ key: "step-1", prompt: "Do the work" }],
};

const directories: string[] = [];
const stores: SqliteWorkflowStore[] = [];

async function makePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-sqlite-store-"));
  directories.push(directory);
  return join(directory, "domino.db");
}

function openStore(path = ":memory:"): SqliteWorkflowStore {
  const store = openSqliteWorkflowStore({ path });
  stores.push(store);
  return store;
}

async function makeWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-sqlite-workspace-"));
  directories.push(directory);
  const workspaceRoot = join(directory, "workspace");
  await mkdir(workspaceRoot);
  return workspaceRoot;
}

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

function baseEvent(
  overrides: Partial<RuntimeEventRecord> = {},
): RuntimeEventRecord {
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

async function seed(store: SqliteWorkflowStore): Promise<void> {
  await store.createRun(baseRun());
  await store.createStepRun(baseStep());
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("openSqliteWorkflowStore", () => {
  it("stores and reads every execution record", async () => {
    const store = openStore();

    await seed(store);
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

  it("round-trips a run without optional fields", async () => {
    const store = openStore();
    const run = baseRun({
      status: "pending",
      startedAt: undefined,
      finishedAt: undefined,
      error: undefined,
    });

    await store.createRun(run);

    expect(await store.getRun("run-1")).toEqual(run);
  });

  it("returns null for missing records", async () => {
    const store = openStore();

    expect(await store.getRun("missing")).toBeNull();
    expect(await store.getStepRun("missing")).toBeNull();
    expect(await store.getApproval("missing")).toBeNull();
    expect(await store.getRuntimeSessionRef("missing")).toBeNull();
    expect(await store.listRuntimeEvents("missing")).toEqual([]);
    expect(await store.listHistory("missing")).toEqual([]);
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const store = openStore();
    const run = baseRun();

    await seed(store);
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

  it("rejects duplicate ids with the shared record error", async () => {
    const store = openStore();

    await store.createRun(baseRun());

    await expect(store.createRun(baseRun())).rejects.toThrow(
      WorkflowRecordError,
    );
    await expect(store.createRun(baseRun())).rejects.toThrow(
      'A workflow run with id "run-1" already exists',
    );
  });

  it("rejects updating a missing record", async () => {
    const store = openStore();

    await expect(store.updateRun(baseRun())).rejects.toThrow(
      'No workflow run with id "run-1" exists',
    );
    await expect(store.updateStepRun(baseStep())).rejects.toThrow(
      'No step run with id "step-run-1" exists',
    );
  });

  it("preserves insertion order and filters lists by run", async () => {
    const store = openStore();

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
    const store = openStore();

    await seed(store);
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

  it("appends every event and history entry without pruning", async () => {
    const store = openStore();

    await seed(store);

    for (let index = 0; index < 20; index += 1) {
      await store.appendRuntimeEvent(
        baseEvent({ id: `event-${index}`, event: { type: "assistant_text_delta", text: `chunk-${index}` } }),
      );
      await store.appendHistory(
        baseHistory({ id: `history-${index}`, kind: "step_attempt_failed" }),
      );
    }

    expect(await store.listRuntimeEvents("run-1")).toHaveLength(20);
    expect(await store.listHistory("run-1")).toHaveLength(20);
    expect((await store.listRuntimeEvents("run-1"))[19]?.id).toBe("event-19");
  });

  it("isolates two stores", async () => {
    const first = openStore();
    const second = openStore();

    await first.createRun(baseRun());

    expect(await first.getRun("run-1")).not.toBeNull();
    expect(await second.getRun("run-1")).toBeNull();
  });

  it("rejects a step run whose run does not exist", async () => {
    const store = openStore();

    try {
      await store.createStepRun(baseStep({ runId: "missing-run" }));
      throw new Error("expected the insert to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowPersistenceError);
      expect((error as WorkflowPersistenceError).code).toBe("reference");
    }
  });

  it("rejects a corrupted stored plan", async () => {
    const path = await makePath();
    const store = openStore(path);

    await store.createRun(baseRun());

    const raw = openSqliteDatabase({ path });
    raw.db
      .prepare("UPDATE workflow_runs SET plan_json = ? WHERE id = ?")
      .run("not json", "run-1");
    raw.close();

    await expect(store.getRun("run-1")).rejects.toMatchObject({
      name: "WorkflowPersistenceError",
      code: "decode",
    });
  });

  it("rejects a corrupted stored event", async () => {
    const path = await makePath();
    const store = openStore(path);

    await store.createRun(baseRun());
    await store.createStepRun(baseStep());
    await store.appendRuntimeEvent(baseEvent());

    const raw = openSqliteDatabase({ path });
    raw.db
      .prepare("UPDATE runtime_events SET event_json = ? WHERE id = ?")
      .run(JSON.stringify({ type: "other" }), "event-1");
    raw.close();

    await expect(store.listRuntimeEvents("run-1")).rejects.toMatchObject({
      name: "WorkflowPersistenceError",
      code: "decode",
    });
  });

  it("rejects an unknown stored run status", async () => {
    const path = await makePath();
    const store = openStore(path);

    await store.createRun(baseRun());

    const raw = openSqliteDatabase({ path });
    raw.db
      .prepare("UPDATE workflow_runs SET status = ? WHERE id = ?")
      .run("teleported", "run-1");
    raw.close();

    await expect(store.getRun("run-1")).rejects.toThrow(
      'Stored workflow_runs record "run-1" has an unknown status "teleported"',
    );
  });

  it("rejects an unknown stored history kind", async () => {
    const path = await makePath();
    const store = openStore(path);

    await store.createRun(baseRun());
    await store.createStepRun(baseStep());
    await store.appendHistory(baseHistory());

    const raw = openSqliteDatabase({ path });
    raw.db
      .prepare("UPDATE workflow_history SET kind = ? WHERE id = ?")
      .run("run_teleported", "history-1");
    raw.close();

    await expect(store.listHistory("run-1")).rejects.toMatchObject({
      name: "WorkflowPersistenceError",
      code: "decode",
    });
  });

  it("survives a close and reopen", async () => {
    const path = await makePath();
    const store = openStore(path);

    await seed(store);
    await store.createApproval(baseApproval());
    await store.createRuntimeSessionRef(baseSessionRef());
    await store.appendRuntimeEvent(baseEvent());
    await store.appendRuntimeEvent(
      baseEvent({ id: "event-2", event: { type: "assistant_text_delta", text: "bye" } }),
    );
    await store.appendHistory(baseHistory());
    await store.appendHistory(baseHistory({ id: "history-2", kind: "step_completed" }));

    store.close();

    const reopened = openStore(path);

    expect(await reopened.getRun("run-1")).toEqual(baseRun());
    expect(await reopened.getStepRun("step-run-1")).toEqual(baseStep());
    expect(await reopened.getApproval("approval-1")).toEqual(baseApproval());
    expect(await reopened.getRuntimeSessionRef("session-ref-1")).toEqual(
      baseSessionRef(),
    );
    expect(await reopened.listRuntimeEvents("run-1")).toEqual([
      baseEvent(),
      baseEvent({ id: "event-2", event: { type: "assistant_text_delta", text: "bye" } }),
    ]);
    expect(await reopened.listHistory("run-1")).toEqual([
      baseHistory(),
      baseHistory({ id: "history-2", kind: "step_completed" }),
    ]);
  });

  it("runs the workflow engine over SQLite and records the finished state", async () => {
    const path = await makePath();
    const workspaceRoot = await makeWorkspace();
    const store = openStore(path);
    let id = 0;
    let tick = 0;
    const engine = createWorkflowEngine({
      persistence: store,
      runtime: createFakeRuntime([{ deltas: ["one"] }, { deltas: ["two"] }]),
      idFactory: () => `id-${++id}`,
      now: () => new Date(Date.UTC(2026, 9, 30, 0, 0, tick++)).toISOString(),
    });

    const handle = await engine.startRun(
      {
        workflowId: "workflow-1",
        workflowVersion: 2,
        steps: [
          { key: "step-1", prompt: "First" },
          { key: "step-2", prompt: "Second" },
        ],
      },
      { workspaceRoot, runtimeProfileId: "profile-opaque" },
    );

    const finished = await handle.completion;
    expect(finished.status).toBe("completed");

    store.close();

    const reopened = openStore(path);

    expect((await reopened.getRun(handle.runId))?.status).toBe("completed");

    const steps = await reopened.listStepRuns(handle.runId);
    expect(steps.map((step) => step.status)).toEqual(["completed", "completed"]);

    const history = await reopened.listHistory(handle.runId);
    expect(history.map((entry) => entry.kind)).toEqual([
      "run_started",
      "step_started",
      "step_completed",
      "step_started",
      "step_completed",
      "run_completed",
    ]);

    const sessions = await reopened.listRuntimeSessionRefs(handle.runId);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.closedAt !== undefined)).toBe(
      true,
    );

    const events = await reopened.listRuntimeEvents(handle.runId);
    expect(events.map((event) => event.event.text)).toEqual(["one", "two"]);
  });
});

function baseWorkflowVersion(
  overrides: Partial<WorkflowVersion> = {},
): WorkflowVersion {
  return {
    id: "workflow-version-1",
    definitionId: "workflow-definition-1",
    version: 1,
    steps: [
      {
        key: "step-1",
        skillVersionIds: ["skill-version-1"],
        approvalPointKey: "approve",
        errorPolicy: "fail-run",
        workingDirectory: "sub",
        retry: { maxAttempts: 2 },
      },
    ],
    approvalPoints: [{ key: "approve", message: "Ship it?" }],
    errorPolicy: "fail-run",
    publishedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

function baseSkillVersion(overrides: Partial<SkillVersion> = {}): SkillVersion {
  return {
    id: "skill-version-1",
    skillDefinitionId: "skill-definition-1",
    version: 1,
    content: "# Review\n\nCheck the diff.",
    publishedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("openSqliteWorkflowStore published definitions", () => {
  it("round-trips definition containers and renames them", async () => {
    const store = openStore();

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });
    await store.createSkillDefinition({
      id: "skill-definition-1",
      name: "Review",
    });

    expect(await store.getWorkflowDefinition("workflow-definition-1")).toEqual({
      id: "workflow-definition-1",
      name: "Release",
    });
    expect(await store.getSkillDefinition("skill-definition-1")).toEqual({
      id: "skill-definition-1",
      name: "Review",
    });

    await store.updateWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release v2",
    });

    expect(await store.listWorkflowDefinitions()).toEqual([
      { id: "workflow-definition-1", name: "Release v2" },
    ]);
    expect(await store.listSkillDefinitions()).toEqual([
      { id: "skill-definition-1", name: "Review" },
    ]);
  });

  it("rejects duplicate and missing definition containers", async () => {
    const store = openStore();

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });

    await expect(
      store.createWorkflowDefinition({
        id: "workflow-definition-1",
        name: "Release",
      }),
    ).rejects.toThrow(
      'A workflow definition with id "workflow-definition-1" already exists',
    );
    await expect(
      store.updateWorkflowDefinition({
        id: "workflow-definition-9",
        name: "Missing",
      }),
    ).rejects.toThrow(
      'No workflow definition with id "workflow-definition-9" exists',
    );
  });

  it("round-trips a workflow version unchanged", async () => {
    const store = openStore();

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });
    await store.createWorkflowVersion(baseWorkflowVersion());

    expect(await store.getWorkflowVersion("workflow-version-1")).toEqual(
      baseWorkflowVersion(),
    );

    await store.createWorkflowVersion(
      baseWorkflowVersion({ id: "workflow-version-2", version: 2 }),
    );

    expect(
      (await store.listWorkflowVersions("workflow-definition-1")).map(
        (version) => version.id,
      ),
    ).toEqual(["workflow-version-1", "workflow-version-2"]);
  });

  it("round-trips a skill version with its markdown", async () => {
    const store = openStore();

    await store.createSkillDefinition({
      id: "skill-definition-1",
      name: "Review",
    });
    await store.createSkillVersion(baseSkillVersion());

    expect(await store.getSkillVersion("skill-version-1")).toEqual(
      baseSkillVersion(),
    );
    expect(
      (await store.listSkillVersions("skill-definition-1"))[0]?.content,
    ).toContain("Check the diff.");
  });

  it("rejects a duplicate version id", async () => {
    const store = openStore();

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });
    await store.createWorkflowVersion(baseWorkflowVersion());

    await expect(
      store.createWorkflowVersion(
        baseWorkflowVersion({ version: 2, definitionId: "workflow-definition-1" }),
      ),
    ).rejects.toThrow(
      'A workflow version with id "workflow-version-1" already exists',
    );
  });

  it("rejects a repeated definition and version pair", async () => {
    const store = openStore();

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });
    await store.createWorkflowVersion(baseWorkflowVersion());

    try {
      await store.createWorkflowVersion(
        baseWorkflowVersion({ id: "workflow-version-2" }),
      );
      throw new Error("expected the insert to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowPersistenceError);
      expect((error as WorkflowPersistenceError).code).toBe("conflict");
    }
  });

  it("rejects an invalid version with the invalid code", async () => {
    const store = openStore();

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });

    try {
      await store.createWorkflowVersion(baseWorkflowVersion({ steps: [] }));
      throw new Error("expected the insert to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowPersistenceError);
      expect((error as WorkflowPersistenceError).code).toBe("invalid");
    }
  });

  it("rejects a version whose definition does not exist", async () => {
    const store = openStore();

    try {
      await store.createWorkflowVersion(
        baseWorkflowVersion({ definitionId: "missing-definition" }),
      );
      throw new Error("expected the insert to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowPersistenceError);
      expect((error as WorkflowPersistenceError).code).toBe("reference");
    }
  });

  it("exposes no update method for published versions", () => {
    const store = openStore();

    expect("updateWorkflowVersion" in store).toBe(false);
    expect("updateSkillVersion" in store).toBe(false);
  });

  it("rejects corrupted stored workflow version steps", async () => {
    const path = await makePath();
    const store = openStore(path);

    await store.createWorkflowDefinition({
      id: "workflow-definition-1",
      name: "Release",
    });
    await store.createWorkflowVersion(baseWorkflowVersion());

    const raw = openSqliteDatabase({ path });
    raw.db
      .prepare("UPDATE workflow_versions SET steps_json = ? WHERE id = ?")
      .run(JSON.stringify([{ key: "step-1" }]), "workflow-version-1");
    raw.close();

    await expect(store.getWorkflowVersion("workflow-version-1")).rejects.toMatchObject(
      {
        name: "WorkflowPersistenceError",
        code: "decode",
      },
    );
  });
});

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Domino",
    workspaceRoot: "/workspace/domino",
    configuration: { locale: "en", retries: 2 },
    workflowVersionIds: ["workflow-version-1"],
    skillVersionIds: ["skill-version-1"],
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  };
}

async function seedVersions(store: SqliteWorkflowStore): Promise<void> {
  await store.createWorkflowDefinition({
    id: "workflow-definition-1",
    name: "Release",
  });
  await store.createWorkflowVersion(baseWorkflowVersion());
  await store.createSkillDefinition({
    id: "skill-definition-1",
    name: "Review",
  });
  await store.createSkillVersion(baseSkillVersion());
}

describe("openSqliteWorkflowStore projects", () => {
  it("round-trips a project with configuration and selections", async () => {
    const store = openStore();

    await seedVersions(store);
    await store.createProject(baseProject());

    const project = await store.getProject("project-1");

    expect(project).toEqual(baseProject());
    expect(project?.defaultRuntimeProfileId).toBeUndefined();
    expect(await store.listProjects()).toEqual([baseProject()]);
  });

  it("round-trips an opaque default runtime profile", async () => {
    const store = openStore();

    await seedVersions(store);
    await store.createProject(
      baseProject({ defaultRuntimeProfileId: "profile-opaque" }),
    );

    expect((await store.getProject("project-1"))?.defaultRuntimeProfileId).toBe(
      "profile-opaque",
    );
  });

  it("rejects a duplicate project id", async () => {
    const store = openStore();

    await seedVersions(store);
    await store.createProject(baseProject());

    await expect(store.createProject(baseProject())).rejects.toThrow(
      'A project with id "project-1" already exists',
    );
  });

  it("rejects updating a missing project", async () => {
    const store = openStore();

    await expect(store.updateProject(baseProject())).rejects.toThrow(
      'No project with id "project-1" exists',
    );
  });

  it("replaces the selected versions on update", async () => {
    const store = openStore();

    await seedVersions(store);
    await store.createWorkflowVersion(
      baseWorkflowVersion({ id: "workflow-version-2", version: 2 }),
    );
    await store.createSkillVersion(
      baseSkillVersion({ id: "skill-version-2", version: 2 }),
    );
    await store.createProject(baseProject());

    await store.updateProject(
      baseProject({
        name: "DominoAI",
        workflowVersionIds: ["workflow-version-2", "workflow-version-1"],
        skillVersionIds: ["skill-version-2"],
      }),
    );

    const project = await store.getProject("project-1");

    expect(project?.name).toBe("DominoAI");
    expect(project?.workflowVersionIds).toEqual([
      "workflow-version-2",
      "workflow-version-1",
    ]);
    expect(project?.skillVersionIds).toEqual(["skill-version-2"]);
  });

  it("rejects an unknown selected version and rolls the insert back", async () => {
    const store = openStore();

    await seedVersions(store);

    try {
      await store.createProject(
        baseProject({ workflowVersionIds: ["missing-version"] }),
      );
      throw new Error("expected the insert to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowPersistenceError);
      expect((error as WorkflowPersistenceError).code).toBe("reference");
    }

    expect(await store.getProject("project-1")).toBeNull();
  });

  it("keeps project records outside the execution persistence contract", () => {
    expectTypeOf<WorkflowExecutionPersistence>().not.toHaveProperty(
      "createProject",
    );
    expectTypeOf<SqliteWorkflowStore>().toMatchTypeOf<WorkflowExecutionPersistence>();
  });

  it("rejects a corrupted stored configuration", async () => {
    const path = await makePath();
    const store = openStore(path);

    await seedVersions(store);
    await store.createProject(baseProject());

    const raw = openSqliteDatabase({ path });
    raw.db
      .prepare("UPDATE projects SET configuration_json = ? WHERE id = ?")
      .run(JSON.stringify(["not", "a", "record"]), "project-1");
    raw.close();

    await expect(store.getProject("project-1")).rejects.toMatchObject({
      name: "WorkflowPersistenceError",
      code: "decode",
    });
  });
});
