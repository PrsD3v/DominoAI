import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleCreateProject } from "../../app/api/projects/route";
import { handleStartRun } from "../../app/api/runs/route";
import { handleGetRun } from "../../app/api/runs/[id]/route";
import { handleAnswerApproval } from "../../app/api/runs/[id]/approvals/[approvalId]/route";
import type { CredentialStore, RuntimeProfile } from "../../types/runtime-settings";
import type { RunDetail } from "../../types/run-api";
import { createFakeRuntime, type FakeTurn } from "../runtime/fake-runtime";
import { createWorkflowEngine } from "../workflow/engine";
import {
  MVP_APPROVAL_MESSAGE,
  MVP_SKILL_CONTENTS,
  MVP_SKILL_VERSION_IDS,
  MVP_WORKFLOW_VERSION_ID,
  seedMvpDefinition,
} from "../workflow/mvp-definition";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "../workflow/sqlite/sqlite-store";
import { createRunService, type RunService } from "./service";
import { createRunEventStream } from "./stream";

const AT = "2026-11-07T00:00:00.000Z";

const PROFILE: RuntimeProfile = {
  id: "mvp-profile",
  label: "MVP profile",
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

const TURNS: readonly FakeTurn[] = [
  { deltas: ["inspect done"] },
  { deltas: ["apply done"] },
  { deltas: ["verify done"] },
];

const RESULTS = ["inspect done", "apply done", "verify done"];

const credentialWrites = { set: 0, remove: 0 };

const CREDENTIALS: CredentialStore = {
  async status() {
    return "present";
  },
  async set() {
    credentialWrites.set += 1;
  },
  async remove() {
    credentialWrites.remove += 1;
  },
};

const stores: SqliteWorkflowStore[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  credentialWrites.set = 0;
  credentialWrites.remove = 0;

  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

interface Stack {
  readonly store: SqliteWorkflowStore;
  readonly service: RunService;
}

/** Open the real store and service on one database file. */
function createStack(databasePath: string, turns?: readonly FakeTurn[]): Stack {
  const store = openSqliteWorkflowStore({ path: databasePath });
  stores.push(store);
  const engine = createWorkflowEngine({
    persistence: store,
    idFactory: () => randomUUID(),
    now: () => new Date().toISOString(),
  });
  const service = createRunService({
    persistence: store,
    credentials: CREDENTIALS,
    engine,
    createRuntime: async () => {
      if (turns === undefined) {
        throw new Error("this stack only reads persisted state");
      }

      return createFakeRuntime([...turns]);
    },
  });

  return { store, service };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 5000;

  for (;;) {
    const value = await read();

    if (done(value)) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the run state");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("the local end-to-end MVP slice", () => {
  it("runs the seeded workflow across an approval pause and two reloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "domino-mvp-slice-"));
    directories.push(directory);
    const workspaceRoot = join(directory, "workspace");
    await mkdir(workspaceRoot);
    const databasePath = join(directory, "domino.db");

    const { store, service } = createStack(databasePath, TURNS);
    await seedMvpDefinition(store);
    await store.createRuntimeProfile(PROFILE);

    const projectResponse = await handleCreateProject(
      jsonRequest({
        name: "MVP workspace",
        workspaceRoot,
        defaultRuntimeProfileId: PROFILE.id,
        workflowVersionIds: [MVP_WORKFLOW_VERSION_ID],
        skillVersionIds: [...MVP_SKILL_VERSION_IDS],
      }),
      service,
    );

    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as {
      project: { id: string };
    };

    const startResponse = await handleStartRun(
      jsonRequest({
        projectId: project.project.id,
        workflowVersionId: MVP_WORKFLOW_VERSION_ID,
      }),
      service,
    );

    expect(startResponse.status).toBe(201);
    const started = (await startResponse.json()) as { run: RunDetail };
    const runId = started.run.run.id;

    const paused = await waitFor(
      async () => service.getState(runId),
      (state) => state.run.status === "waiting_approval",
    );

    expect(paused.steps.map((step) => step.status)).toEqual([
      "completed",
      "pending",
      "pending",
    ]);

    const pending = paused.approvals.filter(
      (approval) => approval.status === "pending",
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]?.runId).toBe(runId);
    expect(pending[0]?.stepRunId).toBe(paused.steps[1]?.id);
    expect(pending[0]?.message).toBe(MVP_APPROVAL_MESSAGE);
    expect(credentialWrites).toEqual({ set: 0, remove: 0 });

    // First reload: a separate store and service on the same database.
    const firstReload = createStack(databasePath);
    const detailResponse = await handleGetRun(runId, firstReload.service);

    expect(detailResponse.status).toBe(200);
    const reloaded = ((await detailResponse.json()) as { run: RunDetail }).run;

    expect(reloaded.run.status).toBe("waiting_approval");
    expect(
      reloaded.steps.filter((step) => step.status === "completed"),
    ).toHaveLength(1);
    expect(
      reloaded.approvals.filter((approval) => approval.status === "pending"),
    ).toHaveLength(1);
    expect(reloaded.history.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["step_completed", "approval_requested"]),
    );

    const frames = await createRunEventStream({
      service: firstReload.service,
      runId,
    }).start();
    const snapshot = frames.find((frame) =>
      frame.includes("event: snapshot"),
    );

    expect(snapshot).toBeDefined();
    expect(snapshot).toContain('"status":"waiting_approval"');
    expect(snapshot).toContain(MVP_APPROVAL_MESSAGE);

    const approvalResponse = await handleAnswerApproval(
      runId,
      pending[0]!.id,
      jsonRequest({ decision: "approve" }),
      service,
    );

    expect(approvalResponse.status).toBe(200);

    const completed = await waitFor(
      async () => service.getState(runId),
      (state) => state.run.status === "completed",
    );

    expect(completed.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(completed.steps.map((step) => step.resultText)).toEqual(RESULTS);
    expect(completed.history.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        "approval_requested",
        "approval_approved",
        "run_completed",
      ]),
    );

    const persisted = await firstReload.store.getRun(runId);

    expect(persisted).not.toBeNull();
    expect(persisted?.plan.steps.map((step) => step.prompt)).toEqual([
      ...MVP_SKILL_CONTENTS,
    ]);

    // Second reload: the final result is read from the database again.
    const secondReload = createStack(databasePath);
    const finalResponse = await handleGetRun(runId, secondReload.service);

    expect(finalResponse.status).toBe(200);
    const finalDetail = ((await finalResponse.json()) as { run: RunDetail })
      .run;

    expect(finalDetail.run.status).toBe("completed");
    expect(finalDetail.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(finalDetail.steps.map((step) => step.resultText)).toEqual(RESULTS);
    expect(finalDetail.history.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["approval_approved", "run_completed"]),
    );
    expect(credentialWrites).toEqual({ set: 0, remove: 0 });
  });
});
