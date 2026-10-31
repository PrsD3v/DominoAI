import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Project,
  ProjectPersistence,
  RuntimeProfilePersistence,
} from "@/types/persistence";
import type { RuntimeProfile } from "@/types/runtime-settings";
import { openSqliteDatabase } from "../workflow/sqlite/migrations";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "../workflow/sqlite/sqlite-store";
import {
  ProjectRegistrationError,
  registerProject,
  type ProjectRegistrationStore,
  type RegisterProjectOptions,
} from "./registration";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PROFILE_AT = "2026-10-30T00:00:00.000Z";

function profileRecord(id: string): RuntimeProfile {
  return {
    id,
    label: id,
    adapterId: "reasonix",
    providerName: "deepseek",
    model: "deepseek-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    credentialRef: {
      kind: "reasonix-env",
      providerName: "deepseek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
    createdAt: PROFILE_AT,
    updatedAt: PROFILE_AT,
  };
}

class FakeProjectStore
  implements ProjectPersistence, RuntimeProfilePersistence
{
  readonly projects = new Map<string, Project>();
  readonly profiles = new Map<string, RuntimeProfile>();

  async createProject(project: Project): Promise<void> {
    if (this.projects.has(project.id)) {
      throw new Error(`Project "${project.id}" already exists`);
    }

    this.projects.set(project.id, structuredClone(project));
  }

  async getProject(id: string): Promise<Project | null> {
    const project = this.projects.get(id);
    return project === undefined ? null : structuredClone(project);
  }

  async updateProject(project: Project): Promise<void> {
    this.projects.set(project.id, structuredClone(project));
  }

  async listProjects(): Promise<readonly Project[]> {
    return [...this.projects.values()].map((project) =>
      structuredClone(project),
    );
  }

  async createRuntimeProfile(profile: RuntimeProfile): Promise<void> {
    this.profiles.set(profile.id, structuredClone(profile));
  }

  async getRuntimeProfile(id: string): Promise<RuntimeProfile | null> {
    const profile = this.profiles.get(id);
    return profile === undefined ? null : structuredClone(profile);
  }

  async updateRuntimeProfile(profile: RuntimeProfile): Promise<void> {
    this.profiles.set(profile.id, structuredClone(profile));
  }

  async listRuntimeProfiles(): Promise<readonly RuntimeProfile[]> {
    return [...this.profiles.values()].map((profile) =>
      structuredClone(profile),
    );
  }
}

const directories: string[] = [];
const stores: SqliteWorkflowStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-registration-"));
  directories.push(directory);
  return directory;
}

async function makeWorkspace(): Promise<string> {
  const workspaceRoot = join(await makeDirectory(), "workspace");
  await mkdir(workspaceRoot);
  return workspaceRoot;
}

/**
 * The step 1 fake implements project persistence only; selection checks are
 * exercised against the SQLite store, which implements the full contract.
 */
function options(
  store: ProjectPersistence,
  workspaceRoot: string,
  overrides: Partial<RegisterProjectOptions> = {},
): RegisterProjectOptions {
  return {
    store: store as ProjectRegistrationStore,
    name: "Domino",
    workspaceRoot,
    ...overrides,
  };
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("registerProject", () => {
  it("stores a workspace with defaults and a stable id", async () => {
    const store = new FakeProjectStore();
    const workspaceRoot = await makeWorkspace();

    const project = await registerProject(options(store, workspaceRoot));

    expect(project.id).toMatch(UUID_PATTERN);
    expect(project.name).toBe("Domino");
    expect(project.workspaceRoot).toBe(await realpath(workspaceRoot));
    expect(project.configuration).toEqual({});
    expect(project.workflowVersionIds).toEqual([]);
    expect(project.skillVersionIds).toEqual([]);
    expect(project).not.toHaveProperty("defaultRuntimeProfileId");
    expect(project.createdAt).toBe(project.updatedAt);
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
    expect(store.projects.get(project.id)).toEqual(project);
  });

  it("stores the configuration and the opaque profile id", async () => {
    const store = new FakeProjectStore();
    store.profiles.set("profile-opaque-1", profileRecord("profile-opaque-1"));
    const workspaceRoot = await makeWorkspace();

    const project = await registerProject(
      options(store, workspaceRoot, {
        configuration: { theme: "dark", nested: { retries: 2 } },
        defaultRuntimeProfileId: "profile-opaque-1",
      }),
    );

    expect(project.configuration).toEqual({
      theme: "dark",
      nested: { retries: 2 },
    });
    expect(project.defaultRuntimeProfileId).toBe("profile-opaque-1");
  });

  it("rejects an unknown default runtime profile id without storing anything", async () => {
    const store = new FakeProjectStore();
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(
        options(store, workspaceRoot, {
          defaultRuntimeProfileId: "missing-profile",
        }),
      ),
    ).rejects.toMatchObject({
      name: "ProjectRegistrationError",
      reason: "unknown-profile-id",
      profileId: "missing-profile",
    });

    expect(store.projects.size).toBe(0);
  });

  it("stores the canonical target of a symlinked workspace root", async () => {
    const store = new FakeProjectStore();
    const directory = await makeDirectory();
    const target = join(directory, "target");
    const link = join(directory, "link");
    await mkdir(target);
    await symlink(target, link);

    const project = await registerProject(options(store, link));

    expect(project.workspaceRoot).toBe(await realpath(target));
  });

  it("rejects a broken symlink as a missing workspace root", async () => {
    const store = new FakeProjectStore();
    const directory = await makeDirectory();
    const link = join(directory, "broken");
    await symlink(join(directory, "missing-target"), link);

    await expect(
      registerProject(options(store, link)),
    ).rejects.toMatchObject({ reason: "root-missing" });
    expect(store.projects.size).toBe(0);
  });

  it("rejects a whitespace-only name", async () => {
    const store = new FakeProjectStore();
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(options(store, workspaceRoot, { name: "   " })),
    ).rejects.toMatchObject({
      name: "ProjectRegistrationError",
      reason: "invalid-name",
    });
    expect(store.projects.size).toBe(0);
  });

  it("rejects a non-object configuration", async () => {
    const store = new FakeProjectStore();
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(
        options(store, workspaceRoot, {
          configuration: [] as unknown as Record<string, unknown>,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-configuration" });
    expect(store.projects.size).toBe(0);
  });

  it("rejects a configuration that cannot be serialized", async () => {
    const store = new FakeProjectStore();
    const workspaceRoot = await makeWorkspace();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      registerProject(
        options(store, workspaceRoot, { configuration: circular }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-configuration" });
    expect(store.projects.size).toBe(0);
  });

  it("rejects an empty or non-string profile id", async () => {
    const store = new FakeProjectStore();
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(
        options(store, workspaceRoot, { defaultRuntimeProfileId: "" }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-profile-id" });

    await expect(
      registerProject(
        options(store, workspaceRoot, {
          defaultRuntimeProfileId: 42 as unknown as string,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-profile-id" });
    expect(store.projects.size).toBe(0);
  });

  it("rejects an empty workspace root", async () => {
    const store = new FakeProjectStore();

    for (const workspaceRoot of ["", "   "]) {
      await expect(
        registerProject(options(store, workspaceRoot)),
      ).rejects.toMatchObject({ reason: "root-missing" });
    }

    expect(store.projects.size).toBe(0);
  });

  it("rejects a missing workspace root", async () => {
    const store = new FakeProjectStore();
    const directory = await makeDirectory();

    await expect(
      registerProject(options(store, join(directory, "missing"))),
    ).rejects.toMatchObject({ reason: "root-missing" });
    expect(store.projects.size).toBe(0);
  });

  it("rejects a file used as the workspace root", async () => {
    const store = new FakeProjectStore();
    const directory = await makeDirectory();
    const file = join(directory, "file.txt");
    await writeFile(file, "not a directory");

    await expect(
      registerProject(options(store, file)),
    ).rejects.toMatchObject({ reason: "root-not-directory" });
    expect(store.projects.size).toBe(0);
  });

  it("rejects a second project for the same canonical root", async () => {
    const store = new FakeProjectStore();
    const directory = await makeDirectory();
    const workspaceRoot = join(directory, "workspace");
    const link = join(directory, "link");
    await mkdir(workspaceRoot);
    await symlink(workspaceRoot, link);

    await registerProject(options(store, workspaceRoot));

    await expect(
      registerProject(options(store, link, { name: "Second" })),
    ).rejects.toMatchObject({
      name: "ProjectRegistrationError",
      reason: "duplicate-root",
    });
    expect(store.projects.size).toBe(1);
  });

  it("propagates unexpected filesystem errors unchanged", async () => {
    const store = new FakeProjectStore();
    const directory = await makeDirectory();

    const error = await catchError(
      registerProject(options(store, join(directory, "\u0000invalid"))),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ProjectRegistrationError);
    expect(store.projects.size).toBe(0);
  });
});

async function makeStorePath(): Promise<string> {
  return join(await makeDirectory(), "domino.db");
}

function openStore(path: string): SqliteWorkflowStore {
  const store = openSqliteWorkflowStore({ path });
  stores.push(store);
  return store;
}

const PUBLISHED_AT = "2026-10-30T00:00:00.000Z";

async function seedDefinitions(store: SqliteWorkflowStore): Promise<void> {
  await store.createWorkflowDefinition({ id: "workflow-1", name: "Release" });
  await store.createSkillDefinition({ id: "skill-1", name: "Guide" });
  await store.createSkillVersion({
    id: "skill-version-1",
    skillDefinitionId: "skill-1",
    version: 1,
    content: "# Guide",
    publishedAt: PUBLISHED_AT,
  });
  await store.createWorkflowVersion({
    id: "workflow-version-1",
    definitionId: "workflow-1",
    version: 1,
    steps: [{ key: "step-1", skillVersionIds: ["skill-version-1"] }],
    approvalPoints: [],
    errorPolicy: "fail-run",
    publishedAt: PUBLISHED_AT,
  });
  await store.createWorkflowVersion({
    id: "workflow-version-2",
    definitionId: "workflow-1",
    version: 2,
    steps: [{ key: "step-2", skillVersionIds: ["skill-version-1"] }],
    approvalPoints: [],
    errorPolicy: "fail-run",
    publishedAt: PUBLISHED_AT,
  });
}

function countRows(path: string, table: string): number {
  const raw = openSqliteDatabase({ path });

  try {
    const row = raw.db
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  } finally {
    raw.close();
  }
}

async function expectNothingStored(
  store: SqliteWorkflowStore,
  path: string,
): Promise<void> {
  expect(await store.listProjects()).toEqual([]);
  store.close();
  expect(countRows(path, "projects")).toBe(0);
  expect(countRows(path, "project_workflow_versions")).toBe(0);
  expect(countRows(path, "project_skill_versions")).toBe(0);
}

describe("registerProject with SQLite persistence", () => {
  it("persists the project and its ordered selections across a reopen", async () => {
    const path = await makeStorePath();
    const store = openStore(path);
    await seedDefinitions(store);
    await store.createRuntimeProfile(profileRecord("profile-1"));
    const workspaceRoot = await makeWorkspace();

    const registered = await registerProject(
      options(store, workspaceRoot, {
        configuration: { language: "en", nested: { theme: "dark" } },
        defaultRuntimeProfileId: "profile-1",
        workflowVersionIds: ["workflow-version-2", "workflow-version-1"],
        skillVersionIds: ["skill-version-1"],
      }),
    );
    store.close();

    const reopened = openStore(path);
    const stored = await reopened.getProject(registered.id);

    expect(stored).toEqual(registered);
    expect(stored?.workspaceRoot).toBe(await realpath(workspaceRoot));
    expect(stored?.defaultRuntimeProfileId).toBe("profile-1");
    expect(stored?.configuration).toEqual({
      language: "en",
      nested: { theme: "dark" },
    });
    expect(stored?.workflowVersionIds).toEqual([
      "workflow-version-2",
      "workflow-version-1",
    ]);
    expect(stored?.skillVersionIds).toEqual(["skill-version-1"]);
    expect(stored?.createdAt).toBe(stored?.updatedAt);
  });

  it("rejects an unknown workflow version without storing anything", async () => {
    const path = await makeStorePath();
    const store = openStore(path);
    await seedDefinitions(store);
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(
        options(store, workspaceRoot, {
          workflowVersionIds: ["missing-workflow"],
        }),
      ),
    ).rejects.toMatchObject({
      name: "ProjectRegistrationError",
      reason: "unknown-workflow-version",
      versionId: "missing-workflow",
    });

    await expectNothingStored(store, path);
  });

  it("rejects an unknown skill version without storing anything", async () => {
    const path = await makeStorePath();
    const store = openStore(path);
    await seedDefinitions(store);
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(
        options(store, workspaceRoot, { skillVersionIds: ["missing-skill"] }),
      ),
    ).rejects.toMatchObject({
      reason: "unknown-skill-version",
      versionId: "missing-skill",
    });

    await expectNothingStored(store, path);
  });

  it("rejects a duplicate selection without storing anything", async () => {
    const path = await makeStorePath();
    const store = openStore(path);
    await seedDefinitions(store);
    const workspaceRoot = await makeWorkspace();

    await expect(
      registerProject(
        options(store, workspaceRoot, {
          workflowVersionIds: ["workflow-version-1", "workflow-version-1"],
        }),
      ),
    ).rejects.toMatchObject({
      reason: "duplicate-selection",
      versionId: "workflow-version-1",
    });

    await expectNothingStored(store, path);
  });

  it("lets a second project select the same workflow version unchanged", async () => {
    const path = await makeStorePath();
    const store = openStore(path);
    await seedDefinitions(store);
    const firstRoot = await makeWorkspace();
    const secondRoot = await makeWorkspace();

    const first = await registerProject(
      options(store, firstRoot, { workflowVersionIds: ["workflow-version-1"] }),
    );
    const before = await store.getWorkflowVersion("workflow-version-1");
    const second = await registerProject(
      options(store, secondRoot, { workflowVersionIds: ["workflow-version-1"] }),
    );

    expect(second.id).not.toBe(first.id);
    expect(first.workflowVersionIds).toEqual(["workflow-version-1"]);
    expect(second.workflowVersionIds).toEqual(["workflow-version-1"]);
    expect(await store.getWorkflowVersion("workflow-version-1")).toEqual(before);
    expect(await store.listWorkflowVersions("workflow-1")).toHaveLength(2);
  });
});
