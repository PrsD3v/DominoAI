import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRuntime,
  CreateSessionRequest,
  PromptRequest,
} from "../../types/runtime";
import type {
  SkillVersion,
  WorkflowVersion,
} from "../../types/workflow-definition";
import { createFakeRuntime, type FakeTurn } from "../runtime/fake-runtime";
import { publishSkillVersion, publishWorkflowVersion } from "./definition";
import { createWorkflowEngine } from "./engine";
import {
  composeSkillPrompt,
  projectWorkflowVersionWithSkills,
  resolveSkillVersions,
  SkillDeliveryError,
  type SkillVersionLookup,
} from "./skill-delivery";
import {
  openSqliteWorkflowStore,
  type SqliteWorkflowStore,
} from "./sqlite/sqlite-store";

const AT = "2026-11-07T00:00:00.000Z";

function skillVersion(overrides: Partial<SkillVersion> = {}): SkillVersion {
  return {
    id: "skill-version-a",
    skillDefinitionId: "skill-a",
    version: 1,
    content: "# Skill A\n\nFollow A.",
    publishedAt: AT,
    ...overrides,
  };
}

function lookupOf(...versions: SkillVersion[]): SkillVersionLookup {
  const byId = new Map(versions.map((version) => [version.id, version]));

  return {
    async getSkillVersion(id) {
      return byId.get(id) ?? null;
    },
  };
}

function workflowVersion(
  overrides: Partial<WorkflowVersion> = {},
): WorkflowVersion {
  return {
    id: "workflow-version-1",
    definitionId: "workflow-1",
    version: 1,
    steps: [{ key: "step-1", skillVersionIds: ["skill-version-a"] }],
    approvalPoints: [],
    errorPolicy: "fail-run",
    publishedAt: AT,
    ...overrides,
  };
}

describe("resolveSkillVersions", () => {
  it("resolves ids in the requested order", async () => {
    const a = skillVersion();
    const b = skillVersion({
      id: "skill-version-b",
      skillDefinitionId: "skill-b",
      content: "# Skill B",
    });

    await expect(
      resolveSkillVersions(lookupOf(a, b), [
        "skill-version-b",
        "skill-version-a",
      ]),
    ).resolves.toEqual([b, a]);
  });

  it("returns an empty list for an empty request", async () => {
    await expect(resolveSkillVersions(lookupOf(), [])).resolves.toEqual([]);
  });

  it("rejects an unknown id with the id and no content", async () => {
    const error = await resolveSkillVersions(lookupOf(skillVersion()), [
      "missing",
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SkillDeliveryError);
    expect(error).toMatchObject({
      code: "skill_version_not_found",
      skillVersionId: "missing",
    });
    expect((error as SkillDeliveryError).message).toBe(
      'Skill version "missing" was not found',
    );
  });

  it("rejects a duplicate id before resolving it twice", async () => {
    const requested: string[] = [];
    const lookup: SkillVersionLookup = {
      async getSkillVersion(id) {
        requested.push(id);
        return skillVersion();
      },
    };

    await expect(
      resolveSkillVersions(lookup, ["skill-version-a", "skill-version-a"]),
    ).rejects.toMatchObject({
      code: "duplicate_skill_version",
      skillVersionId: "skill-version-a",
    });
    expect(requested).toEqual(["skill-version-a"]);
  });
});

describe("composeSkillPrompt", () => {
  it("joins contents byte for byte in the given order", () => {
    const a = skillVersion({ content: "# A\n" });
    const b = skillVersion({ id: "skill-version-b", content: "# B" });

    expect(composeSkillPrompt([a, b])).toBe("# A\n\n\n# B");
  });

  it("returns one skill's content unchanged", () => {
    const content = "  # Title\n\nBody with trailing space \n";

    expect(composeSkillPrompt([skillVersion({ content })])).toBe(content);
  });

  it("rejects an empty selection", () => {
    expect(() => composeSkillPrompt([])).toThrow(SkillDeliveryError);
    expect(() => composeSkillPrompt([])).toThrow(
      "A step must deliver at least one skill version",
    );
  });

  it("rejects whitespace-only content without embedding it", () => {
    const error = (() => {
      try {
        composeSkillPrompt([skillVersion({ content: "   \n\t" })]);
        return null;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toMatchObject({
      code: "invalid_skill_content",
      skillVersionId: "skill-version-a",
    });
    expect((error as SkillDeliveryError).message).toBe(
      'Skill version "skill-version-a" has no content',
    );
  });
});

describe("projectWorkflowVersionWithSkills", () => {
  const a = skillVersion();
  const b = skillVersion({
    id: "skill-version-b",
    skillDefinitionId: "skill-b",
    content: "# Skill B\n\nFollow B.",
  });

  it("composes each step and pins the delivered ids in order", async () => {
    const version = workflowVersion({
      steps: [
        {
          key: "first",
          skillVersionIds: ["skill-version-b", "skill-version-a"],
          workingDirectory: "packages/app",
          retry: { maxAttempts: 2 },
        },
        { key: "second", skillVersionIds: ["skill-version-a"] },
      ],
    });

    await expect(
      projectWorkflowVersionWithSkills(version, lookupOf(a, b)),
    ).resolves.toEqual({
      workflowId: "workflow-1",
      workflowVersion: 1,
      steps: [
        {
          key: "first",
          prompt: `${b.content}\n\n${a.content}`,
          skillVersionIds: ["skill-version-b", "skill-version-a"],
          workingDirectory: "packages/app",
          retry: { maxAttempts: 2 },
        },
        {
          key: "second",
          prompt: a.content,
          skillVersionIds: ["skill-version-a"],
        },
      ],
    });
  });

  it("rejects an invalid workflow version", async () => {
    const version = workflowVersion({ steps: [] });

    await expect(
      projectWorkflowVersionWithSkills(version, lookupOf(a)),
    ).rejects.toMatchObject({ code: "invalid_workflow_version" });
  });

  it("rejects the whole projection when any step cannot resolve", async () => {
    const version = workflowVersion({
      steps: [
        { key: "first", skillVersionIds: ["skill-version-a"] },
        { key: "second", skillVersionIds: ["missing"] },
      ],
    });

    await expect(
      projectWorkflowVersionWithSkills(version, lookupOf(a)),
    ).rejects.toMatchObject({
      code: "skill_version_not_found",
      skillVersionId: "missing",
    });
  });
});

const directories: string[] = [];
const stores: SqliteWorkflowStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function openStore(): Promise<SqliteWorkflowStore> {
  const directory = await mkdtemp(join(tmpdir(), "domino-skill-delivery-db-"));
  directories.push(directory);
  const store = openSqliteWorkflowStore({
    path: join(directory, "domino.db"),
  });
  stores.push(store);
  return store;
}

async function makeWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "domino-skill-delivery-"));
  directories.push(directory);
  const workspaceRoot = join(directory, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(join(workspaceRoot, "marker.txt"), "unchanged\n");
  return workspaceRoot;
}

async function snapshotTree(
  root: string,
): Promise<Map<string, string | null>> {
  const snapshot = new Map<string, string | null>();

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath =
        prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(directory, entry.name);

      if (entry.isDirectory()) {
        snapshot.set(relativePath, null);
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        snapshot.set(relativePath, await readFile(absolutePath, "utf8"));
      } else {
        snapshot.set(relativePath, "<other>");
      }
    }
  }

  await walk(root, "");
  return snapshot;
}

function recordingRuntime(turns: FakeTurn[]): {
  runtime: AgentRuntime;
  prompts: string[];
  sessionCount: () => number;
} {
  const base = createFakeRuntime(turns);
  const prompts: string[] = [];
  let sessions = 0;

  const runtime: AgentRuntime = {
    ...base,
    async createSession(request: CreateSessionRequest) {
      sessions += 1;
      const session = await base.createSession(request);

      return {
        ...session,
        async prompt(promptRequest: PromptRequest) {
          prompts.push(promptRequest.text);
          return session.prompt(promptRequest);
        },
      };
    },
  };

  return { runtime, prompts, sessionCount: () => sessions };
}

describe("local skill delivery", () => {
  it("sends composed skill content and leaves the workspace unchanged", async () => {
    const store = await openStore();
    const workspaceRoot = await makeWorkspace();

    const a = publishSkillVersion(skillVersion());
    const b = publishSkillVersion(
      skillVersion({
        id: "skill-version-b",
        skillDefinitionId: "skill-b",
        content: "# Skill B\n\nFollow B.",
      }),
    );

    await store.createSkillDefinition({ id: "skill-a", name: "Skill A" });
    await store.createSkillDefinition({ id: "skill-b", name: "Skill B" });
    await store.createSkillVersion(a);
    await store.createSkillVersion(b);

    await store.createWorkflowDefinition({
      id: "workflow-1",
      name: "Workflow",
    });
    const version = publishWorkflowVersion(
      workflowVersion({
        steps: [
          { key: "first", skillVersionIds: [b.id, a.id] },
          { key: "second", skillVersionIds: [a.id] },
        ],
      }),
      { knownSkillVersionIds: new Set([a.id, b.id]) },
    );
    await store.createWorkflowVersion(version);

    const before = await snapshotTree(workspaceRoot);
    const recording = recordingRuntime([
      { deltas: ["first done"] },
      { deltas: ["second done"] },
    ]);
    let sequence = 0;
    const engine = createWorkflowEngine({
      persistence: store,
      runtime: recording.runtime,
      idFactory: () => `id-${(sequence += 1)}`,
      now: () => AT,
    });

    const plan = await projectWorkflowVersionWithSkills(version, store);
    const handle = await engine.startRun(plan, {
      workspaceRoot,
      runtimeProfileId: "profile-opaque",
    });
    const run = await handle.completion;

    expect(run.status).toBe("completed");
    expect(recording.prompts).toEqual([
      `${b.content}\n\n${a.content}`,
      a.content,
    ]);
    expect(await snapshotTree(workspaceRoot)).toEqual(before);

    const stored = await store.getRun(handle.runId);
    expect(stored?.plan.steps.map((step) => step.skillVersionIds)).toEqual([
      [b.id, a.id],
      [a.id],
    ]);
  });

  it("opens no session when a skill version is missing", async () => {
    const store = await openStore();
    const workspaceRoot = await makeWorkspace();
    const recording = recordingRuntime([]);
    const engine = createWorkflowEngine({
      persistence: store,
      runtime: recording.runtime,
      idFactory: () => "id-1",
      now: () => AT,
    });
    const version = workflowVersion({
      steps: [{ key: "step-1", skillVersionIds: ["missing"] }],
    });

    const start = async () => {
      const plan = await projectWorkflowVersionWithSkills(version, store);
      return engine.startRun(plan, {
        workspaceRoot,
        runtimeProfileId: "profile-opaque",
      });
    };

    await expect(start()).rejects.toMatchObject({
      code: "skill_version_not_found",
      skillVersionId: "missing",
    });
    expect(recording.sessionCount()).toBe(0);
    expect(await snapshotTree(workspaceRoot)).toEqual(
      new Map([["marker.txt", "unchanged\n"]]),
    );
  });
});
