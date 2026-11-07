import { describe, expect, it } from "vitest";
import { handleRunRequest } from "../../../lib/runs/http";
import { RunServiceError } from "../../../lib/runs/service";
import { runServiceWith } from "../../../lib/runs/test-support";
import type { SkillDefinition } from "../../../types/workflow-definition";
import { handleGetSkills } from "./route";

const AT = "2026-11-07T00:00:00.000Z";

const definition: SkillDefinition = {
  id: "skill-1",
  name: "Release checklist",
};

const version = {
  id: "skill-version-1",
  skillDefinitionId: "skill-1",
  version: 1,
  publishedAt: AT,
};

describe("GET /api/skills", () => {
  it("returns skill metadata without markdown content", async () => {
    const service = runServiceWith({
      listSkills: async () => ({
        definitions: [definition],
        versions: [version],
      }),
    });

    const response = await handleGetSkills(service);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      definitions: [definition],
      versions: [version],
    });
    expect(JSON.stringify(body)).not.toContain("content");
  });

  it("maps a store failure", async () => {
    const service = runServiceWith({
      listSkills: async () => {
        throw new RunServiceError("persistence_error");
      },
    });

    const response = await handleRunRequest(() => handleGetSkills(service));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "persistence_error" },
    });
  });
});
