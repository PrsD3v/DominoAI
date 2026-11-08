import { describe, expect, it } from "vitest";
import { seedMvpDefinition } from "./mvp-definition";
import { projectWorkflowVersionWithSkills } from "./skill-delivery";
import { openSqliteWorkflowStore } from "./sqlite/sqlite-store";

function memoryStore() {
  return openSqliteWorkflowStore({ path: ":memory:" });
}

describe("seedMvpDefinition", () => {
  it("publishes the three-step fixture into an empty store", async () => {
    const store = memoryStore();

    try {
      await expect(seedMvpDefinition(store)).resolves.toEqual({
        seeded: true,
      });

      const definitions = await store.listWorkflowDefinitions();
      const versions = await store.listWorkflowVersions("mvp-workflow");
      const skillDefinitions = await store.listSkillDefinitions();
      const skillVersions = await store.listSkillVersions("mvp-skill");

      expect(definitions).toEqual([
        { id: "mvp-workflow", name: "MVP three-step workflow" },
      ]);
      expect(skillDefinitions).toEqual([
        { id: "mvp-skill", name: "MVP step instructions" },
      ]);
      expect(versions).toHaveLength(1);
      expect(skillVersions).toHaveLength(3);

      const version = versions[0]!;

      expect(version.steps.map((step) => step.key)).toEqual([
        "inspect",
        "apply",
        "verify",
      ]);
      expect(version.steps.map((step) => step.skillVersionIds)).toEqual([
        ["mvp-skill-v1"],
        ["mvp-skill-v2"],
        ["mvp-skill-v3"],
      ]);
      expect(
        version.steps.map((step) => step.approvalPointKey ?? null),
      ).toEqual([null, "approve-apply", null]);
      expect(version.approvalPoints).toEqual([
        {
          key: "approve-apply",
          message: "Approve the changes before the agent applies them.",
        },
      ]);
      expect(version.publishedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(skillVersions.map((entry) => entry.content)).toEqual([
        "Inspect the workspace and report what needs to change. Do not edit files.",
        "Apply the smallest change that satisfies the request.",
        "Verify the change and report the observed result.",
      ]);
    } finally {
      store.close();
    }
  });

  it("projects the seeded version into an executable plan", async () => {
    const store = memoryStore();

    try {
      await seedMvpDefinition(store);

      const [version] = await store.listWorkflowVersions("mvp-workflow");
      const plan = await projectWorkflowVersionWithSkills(version!, store);

      expect(plan.workflowId).toBe("mvp-workflow");
      expect(plan.workflowVersion).toBe(1);
      expect(plan.steps.map((step) => step.key)).toEqual([
        "inspect",
        "apply",
        "verify",
      ]);
      expect(plan.steps.map((step) => step.prompt)).toEqual([
        "Inspect the workspace and report what needs to change. Do not edit files.",
        "Apply the smallest change that satisfies the request.",
        "Verify the change and report the observed result.",
      ]);
      expect(plan.steps.map((step) => step.approval?.key ?? null)).toEqual([
        null,
        "approve-apply",
        null,
      ]);
    } finally {
      store.close();
    }
  });

  it("writes nothing when the store is already seeded", async () => {
    const store = memoryStore();

    try {
      await expect(seedMvpDefinition(store)).resolves.toEqual({
        seeded: true,
      });
      await expect(seedMvpDefinition(store)).resolves.toEqual({
        seeded: false,
      });

      await expect(store.listWorkflowDefinitions()).resolves.toHaveLength(1);
      await expect(store.listWorkflowVersions("mvp-workflow")).resolves.toHaveLength(
        1,
      );
      await expect(store.listSkillDefinitions()).resolves.toHaveLength(1);
      await expect(store.listSkillVersions("mvp-skill")).resolves.toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it("leaves a store with unrelated definitions untouched", async () => {
    const store = memoryStore();

    try {
      await store.createWorkflowDefinition({
        id: "release",
        name: "Release",
      });

      await expect(seedMvpDefinition(store)).resolves.toEqual({
        seeded: false,
      });

      const definitions = await store.listWorkflowDefinitions();
      const skillDefinitions = await store.listSkillDefinitions();

      expect(definitions).toEqual([{ id: "release", name: "Release" }]);
      expect(skillDefinitions).toEqual([]);
      await expect(store.listWorkflowVersions("release")).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it("leaves a skill-only store untouched", async () => {
    const store = memoryStore();

    try {
      await store.createSkillDefinition({ id: "review", name: "Review" });

      await expect(seedMvpDefinition(store)).resolves.toEqual({
        seeded: false,
      });

      await expect(store.listWorkflowDefinitions()).resolves.toEqual([]);
      await expect(store.listSkillDefinitions()).resolves.toEqual([
        { id: "review", name: "Review" },
      ]);
    } finally {
      store.close();
    }
  });

});
