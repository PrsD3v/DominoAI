import { describe, expect, it } from "vitest";
import type {
  RunSummary,
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import type { WorkflowVersion } from "../../types/workflow-definition";
import { stepViews, workflowDefinitionViews } from "./screen";

const AT = "2026-11-08T10:00:00.000Z";
const LATER = "2026-11-08T11:00:00.000Z";

function version(overrides: Partial<WorkflowVersion> = {}): WorkflowVersion {
  return {
    id: "version-1",
    definitionId: "workflow-1",
    version: 1,
    steps: [
      {
        key: "plan",
        skillVersionIds: ["skill-version-1"],
        approvalPointKey: "approve-plan",
      },
    ],
    approvalPoints: [{ key: "approve-plan", message: "Approve the plan" }],
    errorPolicy: "fail-run",
    publishedAt: AT,
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
      version(),
      version({ id: "version-2", version: 2 }),
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
        version: 3,
        publishedAt: AT,
      },
    ],
  };
}

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    workflowVersion: 1,
    status: "completed",
    workspaceRoot: "/workspace",
    runtimeProfileId: "profile-1",
    createdAt: AT,
    updatedAt: AT,
    pauseRequested: false,
    cancelRequested: false,
    ...overrides,
  };
}

describe("workflow definition views", () => {
  it("orders versions newest first and marks the latest", () => {
    const views = workflowDefinitionViews(catalog(), []);
    const delivery = views[0];

    expect(delivery.definition.name).toBe("Delivery");
    expect(delivery.versions.map((entry) => entry.id)).toEqual([
      "version-2",
      "version-1",
    ]);
    expect(delivery.latest?.id).toBe("version-2");
    expect(views[1].latest).toBeNull();
  });

  it("attaches the most recent run for the definition", () => {
    const views = workflowDefinitionViews(catalog(), [
      run({ id: "old", createdAt: AT }),
      run({ id: "new", createdAt: LATER }),
      run({ id: "other", workflowId: "workflow-2", createdAt: LATER }),
    ]);

    expect(views[0].lastRun?.id).toBe("new");
    expect(views[1].lastRun?.id).toBe("other");
  });
});

describe("step views", () => {
  it("resolves skill labels and approval messages", () => {
    const views = stepViews(version(), skills());

    expect(views[0].skillLabels).toEqual(["Planner v3"]);
    expect(views[0].approvalMessage).toBe("Approve the plan");
  });

  it("keeps unknown ids and omits missing approval points", () => {
    const views = stepViews(
      version({
        steps: [
          {
            key: "plan",
            skillVersionIds: ["missing"],
            approvalPointKey: "missing",
          },
        ],
      }),
      skills(),
    );

    expect(views[0].skillLabels).toEqual(["missing"]);
    expect(views[0].approvalMessage).toBeNull();
  });
});
