import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "../../types/persistence";
import type { AgentRuntime } from "../../types/runtime";
import type {
  CredentialStatus,
  CredentialStore,
  RuntimeProfile,
} from "../../types/runtime-settings";
import type { WorkflowVersion } from "../../types/workflow-definition";
import { createFakeRuntime, type FakeTurn } from "../runtime/fake-runtime";
import { createWorkflowEngine } from "../workflow/engine";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "../workflow/sqlite/sqlite-store";
import {
  createRunService,
  RunServiceError,
  type RunRuntimeRequest,
  type RunService,
} from "./service";

const AT = "2026-11-07T00:00:00.000Z";
const SECRET = "super-secret-value";

const PROFILE: RuntimeProfile = {
  id: "profile-1",
  label: "Local",
  adapterId: "reasonix",
  providerName: "deepseek",
  model: "deepseek-flash",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  credentialRef: {
    kind: "reasonix-env",
    providerName: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  createdAt: AT,
  updatedAt: AT,
};

const stores: SqliteWorkflowStore[] = [];
const directories: string[] = [];

function openStore(): SqliteWorkflowStore {
  const store = openSqliteWorkflowStore({ path: ":memory:" });
  stores.push(store);
  return store;
}

async function makeWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-run-workspace-"));
  directories.push(directory);
  return directory;
}

function makeCredentials(
  status: CredentialStatus | (() => Promise<CredentialStatus>) = "present",
): CredentialStore {
  return {
    async status() {
      return typeof status === "function" ? status() : status;
    },
    async set() {
      // The service never writes a credential.
    },
    async remove() {
      // The service never removes a credential.
    },
  };
}

interface RuntimeFactory {
  readonly createRuntime: (
    request: RunRuntimeRequest,
  ) => Promise<AgentRuntime>;
  readonly requests: RunRuntimeRequest[];
  readonly sessions: () => number;
  readonly closes: () => number;
}

function runtimeFactory(turns: FakeTurn[] = []): RuntimeFactory {
  const requests: RunRuntimeRequest[] = [];
  let sessions = 0;
  let closes = 0;

  return {
    requests,
    sessions: () => sessions,
    closes: () => closes,
    async createRuntime(request) {
      requests.push(request);
      const base = createFakeRuntime(turns);

      return {
        ...base,
        async createSession(sessionRequest) {
          sessions += 1;
          return base.createSession(sessionRequest);
        },
        async close() {
          closes += 1;
          await base.close();
        },
      };
    },
  };
}

interface SeedOptions {
  readonly steps?: WorkflowVersion["steps"];
  readonly approvalPoints?: WorkflowVersion["approvalPoints"];
  readonly project?: Partial<Project>;
  readonly withProfile?: boolean;
}

async function seedStore(
  store: SqliteWorkflowStore,
  options: SeedOptions = {},
): Promise<{ readonly project: Project; readonly version: WorkflowVersion }> {
  await store.createWorkflowDefinition({ id: "workflow-1", name: "Release" });
  await store.createSkillDefinition({ id: "skill-1", name: "Skill" });
  await store.createSkillVersion({
    id: "skill-version-1",
    skillDefinitionId: "skill-1",
    version: 1,
    content: "Do the work.",
    publishedAt: AT,
  });

  const version: WorkflowVersion = {
    id: "workflow-version-1",
    definitionId: "workflow-1",
    version: 1,
    steps: options.steps ?? [
      { key: "step-1", skillVersionIds: ["skill-version-1"] },
    ],
    approvalPoints: options.approvalPoints ?? [],
    errorPolicy: "fail-run",
    publishedAt: AT,
  };
  await store.createWorkflowVersion(version);

  const withProfile = options.withProfile ?? true;

  if (withProfile) {
    await store.createRuntimeProfile(PROFILE);
  }

  const project: Project = {
    id: "project-1",
    name: "Demo",
    workspaceRoot: await makeWorkspace(),
    configuration: {},
    ...(withProfile ? { defaultRuntimeProfileId: PROFILE.id } : {}),
    workflowVersionIds: [version.id],
    skillVersionIds: ["skill-version-1"],
    createdAt: AT,
    updatedAt: AT,
    ...options.project,
  };
  await store.createProject(project);

  return { project, version };
}

function gatedOptions(): SeedOptions {
  return {
    steps: [
      {
        key: "step-1",
        skillVersionIds: ["skill-version-1"],
        approvalPointKey: "gate",
      },
    ],
    approvalPoints: [{ key: "gate", message: "Approve the release?" }],
  };
}

function createService(
  store: SqliteWorkflowStore,
  factory: RuntimeFactory,
  options: {
    readonly credentials?: CredentialStore;
    readonly persistence?: typeof store;
  } = {},
): RunService {
  let id = 0;
  let tick = 0;
  const engine = createWorkflowEngine({
    persistence: store,
    idFactory: () => `id-${++id}`,
    now: () =>
      new Date(Date.UTC(2026, 10, 7, 0, 0, tick++)).toISOString(),
  });

  return createRunService({
    persistence: options.persistence ?? store,
    credentials: options.credentials ?? makeCredentials(),
    engine,
    createRuntime: factory.createRuntime,
  });
}

async function waitForRun(
  service: RunService,
  runId: string,
  predicate: (state: Awaited<ReturnType<RunService["getState"]>>) => boolean,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await service.getState(runId);

    if (predicate(state)) {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("run condition was not reached");
}

async function waitForValue(read: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (read()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("value condition was not reached");
}

async function expectation(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error);
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("run service startRun", () => {
  it("starts a gated run and completes it after approval", async () => {
    const store = openStore();
    const { project } = await seedStore(store, gatedOptions());
    const factory = runtimeFactory([{ deltas: ["finished"] }]);
    const service = createService(store, factory);

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });

    expect(started.run.projectId).toBe(project.id);
    expect(started.run.workflowVersionId).toBe("workflow-version-1");
    expect(started.run.status).toBe("running");
    expect(factory.requests).toEqual([
      { profile: PROFILE, workspaceRoot: project.workspaceRoot },
    ]);

    const waiting = await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "waiting_approval",
    );
    expect(waiting.approvals).toHaveLength(1);
    expect(factory.sessions()).toBe(0);

    const approvalId = waiting.approvals[0]?.id;
    expect(approvalId).toBeDefined();
    await service.answerApproval(started.run.id, approvalId!, {
      decision: "approve",
    });

    const completed = await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "completed",
    );
    expect(completed.steps[0]?.resultText).toBe("finished");
    expect(factory.sessions()).toBe(1);
    await waitForValue(() => factory.closes() === 1);

    const detail = await service.getRun(started.run.id);
    expect(detail.events.map((record) => record.event.text)).toEqual([
      "finished",
    ]);

    const runs = await service.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.projectName).toBe("Demo");
    expect(JSON.stringify(detail)).not.toContain(SECRET);
  });

  it("redacts secret-shaped values in run detail and summaries", async () => {
    const store = openStore();
    const { project } = await seedStore(store, {
      steps: [{ key: "step-1", skillVersionIds: ["skill-version-1"] }],
    });
    const factory = runtimeFactory([{ deltas: ["sk-test-secret-value"] }]);
    const service = createService(store, factory);

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "completed",
    );

    const detail = await service.getRun(started.run.id);
    expect(detail.events[0]?.event.text).toBe("[redacted]");
    expect(detail.steps[0]?.resultText).toBe("[redacted]");

    const raw = await store.getRun(started.run.id);
    expect(raw).not.toBeNull();
    await store.updateRun({
      ...raw!,
      status: "failed",
      error: "api_key=abcd1234",
    });

    const state = await service.getState(started.run.id);
    expect(state.run.error).toBe("api_key=[redacted]");

    const runs = await service.listRuns();
    expect(runs[0]?.error).toBe("api_key=[redacted]");
  });

  it("refuses a second run and closes the rejected runtime", async () => {
    const store = openStore();
    const { project } = await seedStore(store, gatedOptions());
    const factory = runtimeFactory([{ deltas: ["finished"] }]);
    const service = createService(store, factory);

    const first = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    await waitForRun(
      service,
      first.run.id,
      (state) => state.run.status === "waiting_approval",
    );

    const error = await expectation(
      service.startRun({
        projectId: project.id,
        workflowVersionId: "workflow-version-1",
      }),
    );

    expect(error).toBeInstanceOf(RunServiceError);
    expect((error as RunServiceError).code).toBe("run_busy");
    expect(factory.requests).toHaveLength(2);
    expect(factory.closes()).toBe(1);

    await service.cancelRun(first.run.id);
    await waitForRun(
      service,
      first.run.id,
      (state) => state.run.status === "cancelled",
    );
    await waitForValue(() => factory.closes() === 2);
  });

  it("rejects an invalid start request", async () => {
    const store = openStore();
    await seedStore(store);
    const service = createService(store, runtimeFactory());

    const error = await expectation(service.startRun({ projectId: "project-1" }));

    expect(error).toBeInstanceOf(RunServiceError);
    expect((error as RunServiceError).code).toBe("invalid_request");
    expect((error as RunServiceError).fields).toEqual(
      expect.arrayContaining([
        { field: "workflowVersionId", message: "must be a non-empty string" },
      ]),
    );
  });

  it("rejects unknown and unselected projects and versions", async () => {
    const store = openStore();
    const { project } = await seedStore(store);
    const service = createService(store, runtimeFactory());

    await expect(
      service.startRun({
        projectId: "missing-project",
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "project_not_found" });

    await expect(
      service.startRun({
        projectId: project.id,
        workflowVersionId: "other-version",
      }),
    ).rejects.toMatchObject({ code: "workflow_version_not_selected" });

    const missingVersionPersistence = Object.assign(
      Object.create(store),
      {
        async getWorkflowVersion() {
          return null;
        },
      },
    ) as SqliteWorkflowStore;
    const missingVersionService = createService(store, runtimeFactory(), {
      persistence: missingVersionPersistence,
    });

    await expect(
      missingVersionService.startRun({
        projectId: project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "workflow_version_not_found" });
  });

  it("requires a valid default runtime profile", async () => {
    const missingProfileStore = openStore();
    const missingProfile = await seedStore(missingProfileStore, {
      withProfile: false,
    });
    const missingProfileService = createService(
      missingProfileStore,
      runtimeFactory(),
    );

    await expect(
      missingProfileService.startRun({
        projectId: missingProfile.project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "runtime_profile_required" });

    const unknownProfileStore = openStore();
    const unknownProfile = await seedStore(unknownProfileStore, {
      project: { defaultRuntimeProfileId: "missing-profile" },
    });
    const unknownProfileService = createService(
      unknownProfileStore,
      runtimeFactory(),
    );

    await expect(
      unknownProfileService.startRun({
        projectId: unknownProfile.project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "runtime_profile_not_found" });

    const invalidProfileStore = openStore();
    const invalidProfile = await seedStore(invalidProfileStore);
    const persistence = Object.assign(Object.create(invalidProfileStore), {
      async getRuntimeProfile() {
        return { ...PROFILE, model: "" };
      },
    }) as SqliteWorkflowStore;
    const invalidProfileService = createService(
      invalidProfileStore,
      runtimeFactory(),
      { persistence },
    );

    await expect(
      invalidProfileService.startRun({
        projectId: invalidProfile.project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "runtime_profile_invalid" });
  });

  it("requires a stored credential and creates no run", async () => {
    const store = openStore();
    const { project } = await seedStore(store);
    const service = createService(store, runtimeFactory(), {
      credentials: makeCredentials("missing"),
    });

    await expect(
      service.startRun({
        projectId: project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "credential_missing" });

    expect(await store.listRuns()).toEqual([]);
  });

  it("reports a missing skill version before creating a runtime", async () => {
    const store = openStore();
    const { project } = await seedStore(store, {
      steps: [{ key: "step-1", skillVersionIds: ["missing-skill"] }],
    });
    const factory = runtimeFactory();
    const service = createService(store, factory);

    await expect(
      service.startRun({
        projectId: project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "skill_version_missing" });

    expect(factory.requests).toEqual([]);
    expect(await store.listRuns()).toEqual([]);
  });

  it("reports an unavailable runtime without creating a run", async () => {
    const store = openStore();
    const { project } = await seedStore(store);
    const service = createRunService({
      persistence: store,
      credentials: makeCredentials(),
      engine: createWorkflowEngine({
        persistence: store,
        idFactory: () => "id-1",
        now: () => AT,
      }),
      createRuntime: async () => {
        throw new Error("no binary");
      },
    });

    await expect(
      service.startRun({
        projectId: project.id,
        workflowVersionId: "workflow-version-1",
      }),
    ).rejects.toMatchObject({ code: "runtime_unavailable" });

    expect(await store.listRuns()).toEqual([]);
  });
});

describe("run service controls", () => {
  it("refuses pause and continue while waiting and cancels the approval", async () => {
    const store = openStore();
    const { project } = await seedStore(store, gatedOptions());
    const factory = runtimeFactory([{ deltas: ["finished"] }]);
    const service = createService(store, factory);

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    const waiting = await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "waiting_approval",
    );

    await expect(service.pauseRun(started.run.id)).rejects.toMatchObject({
      code: "run_state_conflict",
    });
    await expect(service.continueRun(started.run.id)).rejects.toMatchObject({
      code: "run_state_conflict",
    });

    const cancelled = await service.cancelRun(started.run.id);

    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.approvals[0]?.id).toBe(waiting.approvals[0]?.id);
    expect(cancelled.approvals[0]?.status).toBe("cancelled");
    expect(factory.sessions()).toBe(0);
    await waitForValue(() => factory.closes() === 1);
  });

  it("rejects an approval and cancels the run", async () => {
    const store = openStore();
    const { project } = await seedStore(store, gatedOptions());
    const factory = runtimeFactory([{ deltas: ["finished"] }]);
    const service = createService(store, factory);

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    const waiting = await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "waiting_approval",
    );
    const approvalId = waiting.approvals[0]?.id;

    const cancelled = await service.answerApproval(
      started.run.id,
      approvalId!,
      { decision: "reject" },
    );

    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.approvals[0]?.status).toBe("rejected");
    expect(cancelled.steps[0]?.status).toBe("pending");
    expect(factory.sessions()).toBe(0);
    await waitForValue(() => factory.closes() === 1);
  });

  it("answers an approval only once and only for the waiting run", async () => {
    const store = openStore();
    const { project } = await seedStore(store, {
      steps: [
        {
          key: "step-1",
          skillVersionIds: ["skill-version-1"],
          approvalPointKey: "gate-1",
        },
        {
          key: "step-2",
          skillVersionIds: ["skill-version-1"],
          approvalPointKey: "gate-2",
        },
      ],
      approvalPoints: [
        { key: "gate-1", message: "Approve one?" },
        { key: "gate-2", message: "Approve two?" },
      ],
    });
    const factory = runtimeFactory([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const service = createService(store, factory);

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    const first = await waitForRun(
      service,
      started.run.id,
      (state) =>
        state.approvals.some((approval) => approval.status === "pending"),
    );
    const firstApprovalId = first.approvals.find(
      (approval) => approval.status === "pending",
    )?.id;

    await expect(
      service.answerApproval(started.run.id, "missing-approval", {
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "approval_not_found" });

    await expect(
      service.answerApproval(started.run.id, firstApprovalId!, {
        decision: "maybe",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    await service.answerApproval(started.run.id, firstApprovalId!, {
      decision: "approve",
    });

    const second = await waitForRun(
      service,
      started.run.id,
      (state) =>
        state.approvals.some(
          (approval) =>
            approval.status === "pending" &&
            approval.id !== firstApprovalId,
        ),
    );
    const secondApprovalId = second.approvals.find(
      (approval) =>
        approval.status === "pending" && approval.id !== firstApprovalId,
    )?.id;

    await expect(
      service.answerApproval(started.run.id, firstApprovalId!, {
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "approval_already_resolved" });

    await service.answerApproval(started.run.id, secondApprovalId!, {
      decision: "approve",
    });
    await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "completed",
    );

    expect(factory.sessions()).toBe(2);
  });

  it("binds an approval to its run and step", async () => {
    const store = openStore();
    const { project } = await seedStore(store, {
      steps: [
        {
          key: "step-1",
          skillVersionIds: ["skill-version-1"],
          approvalPointKey: "gate-1",
        },
        {
          key: "step-2",
          skillVersionIds: ["skill-version-1"],
          approvalPointKey: "gate-2",
        },
      ],
      approvalPoints: [
        { key: "gate-1", message: "Approve one?" },
        { key: "gate-2", message: "Approve two?" },
      ],
    });
    const factory = runtimeFactory([
      { deltas: ["one"] },
      { deltas: ["two"] },
    ]);
    const foreignApproval = {
      id: "foreign-approval",
      runId: "another-run",
      stepRunId: "another-step",
      status: "pending" as const,
      message: "Other",
      requestedAt: AT,
    };
    const persistence = new Proxy(store, {
      get(target, property) {
        if (property === "getApproval") {
          return async (approvalId: string) =>
            approvalId === foreignApproval.id
              ? foreignApproval
              : target.getApproval(approvalId);
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as SqliteWorkflowStore;
    const service = createService(store, factory, { persistence });

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    const waiting = await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "waiting_approval",
    );
    const approval = waiting.approvals[0];

    expect(approval).toBeDefined();

    await expect(
      service.answerApproval(started.run.id, foreignApproval.id, {
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "approval_not_found" });

    const stepRuns = await store.listStepRuns(started.run.id);
    const otherStep = stepRuns.find(
      (step) => step.id !== approval!.stepRunId,
    );

    expect(otherStep).toBeDefined();
    await store.updateApproval({
      ...approval!,
      stepRunId: otherStep!.id,
    });

    await expect(
      service.answerApproval(started.run.id, approval!.id, {
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "run_state_conflict" });
  });

  it("rejects an unknown approval even when the run is not waiting", async () => {
    const store = openStore();
    const { project } = await seedStore(store);
    const service = createService(store, runtimeFactory([{ deltas: ["done"] }]));

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "completed",
    );

    await expect(
      service.answerApproval(started.run.id, "any-approval", {
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "approval_not_found" });
  });
});

describe("run service reads", () => {
  it("returns empty run lists", async () => {
    const service = createService(openStore(), runtimeFactory());

    expect(await service.listRuns()).toEqual([]);
  });

  it("reports missing runs and maps store failures", async () => {
    const store = openStore();
    const service = createService(store, runtimeFactory());

    await expect(service.getRun("missing-run")).rejects.toMatchObject({
      code: "run_not_found",
    });
    await expect(
      service.listRuntimeEvents("missing-run", 0),
    ).rejects.toMatchObject({ code: "run_not_found" });

    const broken = Object.assign(Object.create(store), {
      async getRun() {
        throw new Error("store unavailable");
      },
    }) as SqliteWorkflowStore;
    const brokenService = createService(store, runtimeFactory(), {
      persistence: broken,
    });

    await expect(brokenService.getRun("run-1")).rejects.toMatchObject({
      code: "persistence_error",
    });
  });

  it("returns only events after the requested index", async () => {
    const store = openStore();
    const { project } = await seedStore(store);
    const service = createService(
      store,
      runtimeFactory([{ deltas: ["one", "two"] }]),
    );

    const started = await service.startRun({
      projectId: project.id,
      workflowVersionId: "workflow-version-1",
    });
    await waitForRun(
      service,
      started.run.id,
      (state) => state.run.status === "completed",
    );

    expect(
      (await service.listRuntimeEvents(started.run.id, 0)).map(
        (record) => record.event.text,
      ),
    ).toEqual(["one", "two"]);
    expect(
      (await service.listRuntimeEvents(started.run.id, 1)).map(
        (record) => record.event.text,
      ),
    ).toEqual(["two"]);
    expect(await service.listRuntimeEvents(started.run.id, 2)).toEqual([]);

    const state = await service.getState(started.run.id);
    expect(state).not.toHaveProperty("events");
  });
});

describe("run service catalogs and registration", () => {
  it("lists projects, workflows, and content-free skills", async () => {
    const store = openStore();
    const { project, version } = await seedStore(store);
    const service = createService(store, runtimeFactory());

    expect(await service.listProjects()).toEqual([project]);

    const workflows = await service.listWorkflows();
    expect(workflows.definitions).toEqual([
      { id: "workflow-1", name: "Release" },
    ]);
    expect(workflows.versions).toEqual([version]);

    const skills = await service.listSkills();
    expect(skills.definitions).toEqual([{ id: "skill-1", name: "Skill" }]);
    expect(skills.versions).toEqual([
      {
        id: "skill-version-1",
        skillDefinitionId: "skill-1",
        version: 1,
        publishedAt: AT,
      },
    ]);
    expect(JSON.stringify(skills)).not.toContain("Do the work.");
  });

  it("registers a project and maps registration failures", async () => {
    const store = openStore();
    await seedStore(store);
    const service = createService(store, runtimeFactory());
    const workspaceRoot = await makeWorkspace();
    const input = {
      name: "Second",
      workspaceRoot,
      workflowVersionIds: ["workflow-version-1"],
      skillVersionIds: ["skill-version-1"],
    };

    const project = await service.registerProject(input);
    expect(project.name).toBe("Second");
    expect(project.workspaceRoot).toBe(await realpath(workspaceRoot));
    expect(await service.listProjects()).toHaveLength(2);

    await expect(service.registerProject(input)).rejects.toMatchObject({
      code: "workspace_root_registered",
    });

    await expect(
      service.registerProject({ ...input, extra: true }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      fields: expect.arrayContaining([
        { field: "extra", message: "is not allowed" },
      ]),
    });

    await expect(
      service.registerProject({ workspaceRoot }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      fields: expect.arrayContaining([
        { field: "name", message: "must be a non-empty string" },
      ]),
    });

    await expect(
      service.registerProject({
        name: "Third",
        workspaceRoot: await makeWorkspace(),
        configuration: [] as unknown as Record<string, unknown>,
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      fields: expect.arrayContaining([
        { field: "configuration", message: "must be an object" },
      ]),
    });

    await expect(
      service.registerProject({
        name: "Third",
        workspaceRoot: await makeWorkspace(),
        defaultRuntimeProfileId: "missing-profile",
      }),
    ).rejects.toMatchObject({ code: "runtime_profile_not_found" });

    await expect(
      service.registerProject({
        name: "Third",
        workspaceRoot: await makeWorkspace(),
        workflowVersionIds: ["missing-version"],
      }),
    ).rejects.toMatchObject({ code: "workflow_version_not_found" });

    await expect(
      service.registerProject({
        name: "Third",
        workspaceRoot: await makeWorkspace(),
        skillVersionIds: ["missing-skill"],
      }),
    ).rejects.toMatchObject({ code: "skill_version_not_found" });
  });
});
