import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../lib/runs/http";
import { RunServiceError } from "../../../lib/runs/service";
import { runServiceWith } from "../../../lib/runs/test-support";
import type {
  WorkflowDefinition,
  WorkflowVersion,
} from "../../../types/workflow-definition";
import { handleGetWorkflows } from "./route";

const AT = "2026-11-07T00:00:00.000Z";

const definition: WorkflowDefinition = {
  id: "workflow-1",
  name: "Release",
};

const version: WorkflowVersion = {
  id: "workflow-version-1",
  definitionId: "workflow-1",
  version: 1,
  steps: [
    {
      key: "step-1",
      skillVersionIds: ["skill-version-1"],
      approvalPointKey: "gate",
    },
  ],
  approvalPoints: [{ key: "gate", message: "Approve the release?" }],
  errorPolicy: "fail-run",
  publishedAt: AT,
};

describe("GET /api/workflows", () => {
  it("returns definitions and published versions", async () => {
    const service = runServiceWith({
      listWorkflows: async () => ({
        definitions: [definition],
        versions: [version],
      }),
    });

    const response = await handleGetWorkflows(service);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      definitions: [definition],
      versions: [version],
    });
  });

  it("returns empty collections", async () => {
    const service = runServiceWith({
      listWorkflows: async () => ({ definitions: [], versions: [] }),
    });

    const response = await handleGetWorkflows(service);

    await expect(response.json()).resolves.toEqual({
      definitions: [],
      versions: [],
    });
  });

  it("maps a store failure", async () => {
    const service = runServiceWith({
      listWorkflows: async () => {
        throw new RunServiceError("persistence_error");
      },
    });

    const response = await handleRunRequest(() => handleGetWorkflows(service));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "persistence_error" },
    });
  });
});
