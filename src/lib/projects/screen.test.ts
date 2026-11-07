import { describe, expect, it } from "vitest";
import type { Project } from "../../types/persistence";
import type {
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import type { RuntimeProfile } from "../../types/runtime-settings";
import {
  applyDefaultProfile,
  profileOptionLabel,
  projectFieldFromApi,
  projectFormBody,
  selectedWorkflowLabels,
  skillVersionGroups,
  skillVersionLabel,
  toggleId,
  validateProjectDraft,
  workflowVersionGroups,
} from "./screen";

const AT = "2026-11-08T10:00:00.000Z";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Demo",
    workspaceRoot: "/workspace/demo",
    configuration: {},
    workflowVersionIds: ["version-1", "version-2"],
    skillVersionIds: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function profile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: "profile-1",
    label: "Default",
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
    ...overrides,
  };
}

function catalog(): WorkflowCatalogResponse {
  return {
    definitions: [
      { id: "workflow-1", name: "Delivery" },
      { id: "workflow-2", name: "Empty" },
    ],
    versions: [
      {
        id: "version-1",
        definitionId: "workflow-1",
        version: 1,
        steps: [{ key: "one", skillVersionIds: ["skill-version-1"] }],
        approvalPoints: [],
        errorPolicy: "fail-run",
        publishedAt: AT,
      },
      {
        id: "version-2",
        definitionId: "workflow-1",
        version: 2,
        steps: [{ key: "two", skillVersionIds: ["skill-version-1"] }],
        approvalPoints: [],
        errorPolicy: "fail-run",
        publishedAt: AT,
      },
    ],
  };
}

function skills(): SkillCatalogResponse {
  return {
    definitions: [{ id: "skill-1", name: "Planner" }],
    versions: [
      {
        id: "skill-version-1",
        skillDefinitionId: "skill-1",
        version: 1,
        publishedAt: AT,
      },
      {
        id: "skill-version-2",
        skillDefinitionId: "skill-1",
        version: 2,
        publishedAt: AT,
      },
    ],
  };
}

describe("project fields", () => {
  it("maps API fields and ignores unrelated ones", () => {
    expect(projectFieldFromApi("name")).toBe("name");
    expect(projectFieldFromApi("versionId")).toBe("workflowVersionIds");
    expect(projectFieldFromApi("body")).toBeNull();
  });

  it("requires a name, root, and one workflow version", () => {
    expect(
      validateProjectDraft({
        name: " ",
        workspaceRoot: "",
        defaultRuntimeProfileId: null,
        workflowVersionIds: [],
        skillVersionIds: [],
      }),
    ).toEqual(["name", "workspaceRoot", "workflowVersionIds"]);

    expect(
      validateProjectDraft({
        name: " Demo ",
        workspaceRoot: "/workspace",
        defaultRuntimeProfileId: "profile-1",
        workflowVersionIds: ["version-1"],
        skillVersionIds: [],
      }),
    ).toEqual([]);
  });

  it("trims text and omits a missing profile", () => {
    expect(
      projectFormBody({
        name: " Demo ",
        workspaceRoot: " /workspace ",
        defaultRuntimeProfileId: null,
        workflowVersionIds: ["version-1"],
        skillVersionIds: ["skill-version-1"],
      }),
    ).toEqual({
      name: "Demo",
      workspaceRoot: "/workspace",
      workflowVersionIds: ["version-1"],
      skillVersionIds: ["skill-version-1"],
    });

    expect(
      projectFormBody({
        name: "Demo",
        workspaceRoot: "/workspace",
        defaultRuntimeProfileId: "profile-1",
        workflowVersionIds: ["version-1"],
        skillVersionIds: [],
      }),
    ).toMatchObject({ defaultRuntimeProfileId: "profile-1" });
  });

  it("toggles a selection without reordering the rest", () => {
    expect(toggleId(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("catalog options", () => {
  it("groups workflow versions by definition, newest first", () => {
    const groups = workflowVersionGroups(catalog());

    expect(groups.map((group) => group.definition.id)).toEqual([
      "workflow-1",
      "workflow-2",
    ]);
    expect(groups[0].versions.map((version) => version.id)).toEqual([
      "version-2",
      "version-1",
    ]);
    expect(groups[1].versions).toEqual([]);
  });

  it("groups skill versions and labels one by name and version", () => {
    const groups = skillVersionGroups(skills());

    expect(groups[0].versions.map((version) => version.version)).toEqual([2, 1]);
    expect(skillVersionLabel(skills(), "skill-version-2")).toBe("Planner v2");
    expect(skillVersionLabel(skills(), "missing")).toBe("missing");
  });

  it("labels a project's selected workflow versions", () => {
    expect(selectedWorkflowLabels(project(), catalog())).toEqual([
      "Delivery v1",
      "Delivery v2",
    ]);
    expect(
      selectedWorkflowLabels(
        project({ workflowVersionIds: ["missing"] }),
        catalog(),
      ),
    ).toEqual(["missing"]);
  });
});

describe("profiles", () => {
  it("labels options with provider and model", () => {
    expect(profileOptionLabel([profile()], "profile-1")).toBe("Default");
    expect(profileOptionLabel([profile()], "missing")).toBeNull();
    expect(profileOptionLabel([profile()], undefined)).toBeNull();
  });

  it("sets and clears the default profile without changing other fields", () => {
    const set = applyDefaultProfile(project(), "profile-1");
    expect(set.defaultRuntimeProfileId).toBe("profile-1");
    expect(set.workflowVersionIds).toEqual(["version-1", "version-2"]);

    const cleared = applyDefaultProfile(set, null);
    expect("defaultRuntimeProfileId" in cleared).toBe(false);
    expect(cleared.name).toBe("Demo");
  });
});
