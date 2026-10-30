import { describe, expect, it } from "vitest";
import type { SkillVersion, WorkflowVersion } from "../../types/workflow-definition";
import { validateWorkflowVersion } from "../../types/workflow-definition";
import {
  InvalidDefinitionError,
  publishSkillVersion,
  publishWorkflowVersion,
} from "./definition";

const SKILL_VERSION: SkillVersion = {
  id: "skill-version-1",
  skillDefinitionId: "skill-1",
  version: 1,
  content: "# Instructions\n\nWrite the release notes.",
  publishedAt: "2026-10-30T00:00:00.000Z",
};

const WORKFLOW_VERSION: WorkflowVersion = {
  id: "workflow-version-1",
  definitionId: "workflow-1",
  version: 1,
  steps: [
    {
      key: "step-1",
      skillVersionIds: ["skill-version-1"],
      approvalPointKey: "review-plan",
      errorPolicy: "fail-run",
      workingDirectory: "packages/app",
      retry: { maxAttempts: 2 },
    },
  ],
  approvalPoints: [{ key: "review-plan", message: "Approve the plan?" }],
  errorPolicy: "fail-run",
  publishedAt: "2026-10-30T00:00:00.000Z",
};

function captureError(run: () => void): InvalidDefinitionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidDefinitionError);
    return error as InvalidDefinitionError;
  }

  throw new Error("Expected InvalidDefinitionError");
}

describe("publishSkillVersion", () => {
  it("returns a frozen copy", () => {
    const published = publishSkillVersion(SKILL_VERSION);

    expect(published).toEqual(SKILL_VERSION);
    expect(published).not.toBe(SKILL_VERSION);
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(SKILL_VERSION)).toBe(false);
  });

  it("rejects malformed content with every issue", () => {
    const error = captureError(() =>
      publishSkillVersion({ ...SKILL_VERSION, content: "   " }),
    );

    expect(error.issues).toEqual([
      {
        field: "content",
        message: "must contain at least one non-whitespace character",
      },
    ]);
  });
});

describe("publishWorkflowVersion", () => {
  it("returns a deeply frozen copy and preserves the input", () => {
    const snapshot = structuredClone(WORKFLOW_VERSION);
    const published = publishWorkflowVersion(WORKFLOW_VERSION, {
      knownSkillVersionIds: new Set(["skill-version-1"]),
    });

    expect(published).toEqual(WORKFLOW_VERSION);
    expect(WORKFLOW_VERSION).toEqual(snapshot);
    expect(published).not.toBe(WORKFLOW_VERSION);
    expect(published.steps).not.toBe(WORKFLOW_VERSION.steps);
    expect(published.steps[0]).not.toBe(WORKFLOW_VERSION.steps[0]);
    expect(published.steps[0].skillVersionIds).not.toBe(
      WORKFLOW_VERSION.steps[0].skillVersionIds,
    );
    expect(published.steps[0].retry).not.toBe(WORKFLOW_VERSION.steps[0].retry);
    expect(published.approvalPoints).not.toBe(WORKFLOW_VERSION.approvalPoints);
    expect(published.approvalPoints[0]).not.toBe(
      WORKFLOW_VERSION.approvalPoints[0],
    );

    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.steps)).toBe(true);
    expect(Object.isFrozen(published.steps[0])).toBe(true);
    expect(Object.isFrozen(published.steps[0].skillVersionIds)).toBe(true);
    expect(Object.isFrozen(published.steps[0].retry)).toBe(true);
    expect(Object.isFrozen(published.approvalPoints)).toBe(true);
    expect(Object.isFrozen(published.approvalPoints[0])).toBe(true);

    expect(Object.isFrozen(WORKFLOW_VERSION)).toBe(false);
    expect(Object.isFrozen(WORKFLOW_VERSION.steps)).toBe(false);
  });

  it("throws when mutating the frozen result", () => {
    const published = publishWorkflowVersion(WORKFLOW_VERSION, {
      knownSkillVersionIds: new Set(["skill-version-1"]),
    });
    const mutable = published as unknown as {
      steps: Array<{ key: string }>;
      approvalPoints: Array<{ key: string }>;
    };

    expect(() => mutable.steps.push({ key: "extra" })).toThrow(TypeError);
    expect(() => mutable.approvalPoints.push({ key: "extra" })).toThrow(
      TypeError,
    );
  });

  it("omits optional step fields that were not provided", () => {
    const published = publishWorkflowVersion(
      {
        ...WORKFLOW_VERSION,
        steps: [{ key: "step-1", skillVersionIds: ["skill-version-1"] }],
        approvalPoints: [],
      },
      { knownSkillVersionIds: new Set(["skill-version-1"]) },
    );

    expect(published.steps[0]).toEqual({
      key: "step-1",
      skillVersionIds: ["skill-version-1"],
    });
    expect(published.steps[0]).not.toHaveProperty("retry");
    expect(published.steps[0]).not.toHaveProperty("approvalPointKey");
    expect(published.steps[0]).not.toHaveProperty("workingDirectory");
  });

  it("rejects every unknown skill-version reference", () => {
    const error = captureError(() =>
      publishWorkflowVersion(
        {
          ...WORKFLOW_VERSION,
          steps: [
            { key: "one", skillVersionIds: ["unknown-1"] },
            { key: "two", skillVersionIds: ["unknown-2"] },
          ],
          approvalPoints: [],
        },
        { knownSkillVersionIds: new Set() },
      ),
    );

    expect(error.issues).toEqual([
      {
        field: "steps[0].skillVersionIds",
        message: 'references unknown skill version "unknown-1"',
      },
      {
        field: "steps[1].skillVersionIds",
        message: 'references unknown skill version "unknown-2"',
      },
    ]);
  });

  it("exposes the same issues as the validator for malformed input", () => {
    const candidate = {
      ...WORKFLOW_VERSION,
      id: "",
      errorPolicy: "continue",
    };
    const expected = validateWorkflowVersion(candidate);
    const error = captureError(() =>
      publishWorkflowVersion(candidate, {
        knownSkillVersionIds: new Set(["skill-version-1"]),
      }),
    );

    expect(error.name).toBe("InvalidDefinitionError");
    expect(error.issues).toEqual(expected);
  });

  it("preserves step and approval-point order", () => {
    const published = publishWorkflowVersion(
      {
        ...WORKFLOW_VERSION,
        steps: [
          { key: "one", skillVersionIds: ["skill-a"] },
          { key: "two", skillVersionIds: ["skill-b"] },
        ],
        approvalPoints: [
          { key: "first", message: "First?" },
          { key: "second", message: "Second?" },
        ],
      },
      { knownSkillVersionIds: new Set(["skill-a", "skill-b"]) },
    );

    expect(published.steps.map((step) => step.key)).toEqual(["one", "two"]);
    expect(published.approvalPoints.map((point) => point.key)).toEqual([
      "first",
      "second",
    ]);
  });
});
