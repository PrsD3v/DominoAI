import { describe, expect, it } from "vitest";
import type {
  ApprovalPointDefinition,
  DefinitionValidationError,
  SkillDefinition,
  SkillVersion,
  WorkflowDefinition,
  WorkflowStepDefinition,
  WorkflowVersion,
} from "./workflow-definition";
import {
  isSkillDefinition,
  isSkillVersion,
  isWorkflowDefinition,
  isWorkflowVersion,
  validateApprovalPoint,
  validateSkillDefinition,
  validateSkillVersion,
  validateWorkflowDefinition,
  validateWorkflowStepDefinition,
  validateWorkflowVersion,
} from "./workflow-definition";

const WORKFLOW_DEFINITION: WorkflowDefinition = {
  id: "workflow-1",
  name: "Release",
};

const SKILL_DEFINITION: SkillDefinition = {
  id: "skill-1",
  name: "Release notes",
};

const APPROVAL_POINT: ApprovalPointDefinition = {
  key: "review-plan",
  message: "Approve the plan?",
};

const SKILL_VERSION: SkillVersion = {
  id: "skill-version-1",
  skillDefinitionId: "skill-1",
  version: 1,
  content: "# Instructions\n\nWrite the release notes.",
  publishedAt: "2026-10-30T00:00:00.000Z",
};

function workflowStep(
  overrides: Partial<WorkflowStepDefinition> = {},
): WorkflowStepDefinition {
  return {
    key: "step-1",
    skillVersionIds: ["skill-version-1"],
    ...overrides,
  };
}

const WORKFLOW_VERSION: WorkflowVersion = {
  id: "workflow-version-1",
  definitionId: "workflow-1",
  version: 1,
  steps: [
    workflowStep({
      approvalPointKey: "review-plan",
      errorPolicy: "fail-run",
      workingDirectory: "packages/app",
      retry: { maxAttempts: 2 },
    }),
  ],
  approvalPoints: [APPROVAL_POINT],
  errorPolicy: "fail-run",
  publishedAt: "2026-10-30T00:00:00.000Z",
};

function hasField(
  errors: readonly DefinitionValidationError[],
  field: string,
): boolean {
  return errors.some((error) => error.field === field);
}

describe("workflow and skill definition containers", () => {
  it("accepts valid workflow and skill definitions", () => {
    expect(validateWorkflowDefinition(WORKFLOW_DEFINITION)).toEqual([]);
    expect(validateSkillDefinition(SKILL_DEFINITION)).toEqual([]);
    expect(isWorkflowDefinition(WORKFLOW_DEFINITION)).toBe(true);
    expect(isSkillDefinition(SKILL_DEFINITION)).toBe(true);
  });

  it("rejects non-object definitions with a named field", () => {
    expect(validateWorkflowDefinition(null)).toEqual([
      { field: "workflowDefinition", message: "must be an object" },
    ]);
    expect(validateSkillDefinition(null)).toEqual([
      { field: "skillDefinition", message: "must be an object" },
    ]);
  });

  it("returns every missing field issue in one call", () => {
    expect(validateWorkflowDefinition({})).toEqual([
      { field: "id", message: "must be a non-empty string" },
      { field: "name", message: "must be a non-empty string" },
    ]);
    expect(validateSkillDefinition({ id: "", name: "" })).toEqual([
      { field: "id", message: "must be a non-empty string" },
      { field: "name", message: "must be a non-empty string" },
    ]);
  });

  it("rejects unknown and secret-like fields", () => {
    expect(
      hasField(
        validateWorkflowDefinition({
          ...WORKFLOW_DEFINITION,
          apiKey: "secret",
        }),
        "apiKey",
      ),
    ).toBe(true);
    expect(
      hasField(
        validateSkillDefinition({ ...SKILL_DEFINITION, token: "secret" }),
        "token",
      ),
    ).toBe(true);
  });

  it("rejects an invalid definition with a guard", () => {
    expect(isWorkflowDefinition({ id: "", name: "Release" })).toBe(false);
    expect(isSkillDefinition({ id: "skill-1" })).toBe(false);
  });
});

describe("skill versions", () => {
  it("accepts a valid skill version", () => {
    expect(validateSkillVersion(SKILL_VERSION)).toEqual([]);
    expect(isSkillVersion(SKILL_VERSION)).toBe(true);
  });

  it("rejects a non-object skill version", () => {
    expect(validateSkillVersion(null)).toEqual([
      { field: "skillVersion", message: "must be an object" },
    ]);
  });

  it("rejects non-positive, fractional, NaN, and infinite versions", () => {
    for (const version of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        hasField(validateSkillVersion({ ...SKILL_VERSION, version }), "version"),
      ).toBe(true);
    }
  });

  it("rejects invalid timestamps", () => {
    for (const publishedAt of ["", "not-a-date", 123]) {
      expect(
        hasField(
          validateSkillVersion({ ...SKILL_VERSION, publishedAt }),
          "publishedAt",
        ),
      ).toBe(true);
    }
  });

  it("rejects empty and whitespace-only content", () => {
    for (const content of ["", "   ", "\n\t"]) {
      expect(
        hasField(validateSkillVersion({ ...SKILL_VERSION, content }), "content"),
      ).toBe(true);
    }
  });

  it("rejects missing identifiers and unknown fields", () => {
    const errors = validateSkillVersion({
      id: "",
      skillDefinitionId: "",
      version: 1,
      content: "Do the work.",
      publishedAt: "2026-10-30T00:00:00.000Z",
      secret: "value",
    });

    expect(errors.map((error) => error.field)).toEqual([
      "secret",
      "id",
      "skillDefinitionId",
    ]);
  });
});

describe("approval points", () => {
  it("accepts a valid approval point", () => {
    expect(validateApprovalPoint(APPROVAL_POINT)).toEqual([]);
  });

  it("rejects a non-object approval point", () => {
    expect(validateApprovalPoint(null)).toEqual([
      { field: "approvalPoint", message: "must be an object" },
    ]);
  });

  it("rejects empty fields and unknown fields", () => {
    expect(validateApprovalPoint({ key: "", message: "" })).toEqual([
      { field: "key", message: "must be a non-empty string" },
      { field: "message", message: "must be a non-empty string" },
    ]);

    expect(
      hasField(
        validateApprovalPoint({ ...APPROVAL_POINT, password: "secret" }),
        "password",
      ),
    ).toBe(true);
  });
});

describe("workflow steps", () => {
  it("accepts a step with optional fields omitted", () => {
    expect(validateWorkflowStepDefinition(workflowStep())).toEqual([]);
  });

  it("accepts a step with every supported field", () => {
    expect(validateWorkflowStepDefinition(WORKFLOW_VERSION.steps[0])).toEqual([]);
  });

  it("rejects a non-object step", () => {
    expect(validateWorkflowStepDefinition(null)).toEqual([
      { field: "workflowStep", message: "must be an object" },
    ]);
  });

  it("rejects an empty or duplicate skill-version list", () => {
    expect(
      hasField(
        validateWorkflowStepDefinition({
          ...workflowStep(),
          skillVersionIds: [],
        }),
        "skillVersionIds",
      ),
    ).toBe(true);

    expect(
      validateWorkflowStepDefinition({
        ...workflowStep(),
        skillVersionIds: ["skill-version-1", "skill-version-1"],
      }),
    ).toEqual([
      {
        field: "skillVersionIds[1]",
        message: 'duplicates "skill-version-1"',
      },
    ]);
  });

  it("rejects an invalid retry policy and unknown retry fields", () => {
    for (const maxAttempts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        hasField(
          validateWorkflowStepDefinition({
            ...workflowStep(),
            retry: { maxAttempts },
          }),
          "retry.maxAttempts",
        ),
      ).toBe(true);
    }

    expect(
      hasField(
        validateWorkflowStepDefinition({
          ...workflowStep(),
          retry: { maxAttempts: 1, delay: 10 },
        }),
        "retry.delay",
      ),
    ).toBe(true);
  });

  it("rejects empty optional strings and an unsupported error policy", () => {
    const errors = validateWorkflowStepDefinition({
      ...workflowStep(),
      approvalPointKey: "",
      errorPolicy: "continue",
      workingDirectory: "",
    });

    expect(errors.map((error) => error.field)).toEqual([
      "approvalPointKey",
      "errorPolicy",
      "workingDirectory",
    ]);
  });

  it("rejects unknown step fields", () => {
    expect(
      validateWorkflowStepDefinition({
        ...workflowStep(),
        apiKey: "secret",
      }),
    ).toEqual([{ field: "apiKey", message: "is not allowed" }]);
  });
});

describe("workflow versions", () => {
  it("accepts a valid workflow version", () => {
    expect(validateWorkflowVersion(WORKFLOW_VERSION)).toEqual([]);
    expect(isWorkflowVersion(WORKFLOW_VERSION)).toBe(true);
  });

  it("accepts an empty approval-point list when no step references one", () => {
    expect(
      validateWorkflowVersion({
        ...WORKFLOW_VERSION,
        steps: [workflowStep()],
        approvalPoints: [],
      }),
    ).toEqual([]);
  });

  it("rejects a non-object workflow version", () => {
    expect(validateWorkflowVersion(null)).toEqual([
      { field: "workflowVersion", message: "must be an object" },
    ]);
  });

  it("rejects a missing or unsupported error policy", () => {
    expect(
      hasField(
        validateWorkflowVersion({
          ...WORKFLOW_VERSION,
          errorPolicy: undefined,
        }),
        "errorPolicy",
      ),
    ).toBe(true);

    for (const errorPolicy of ["continue", "abort", "fail"]) {
      expect(
        hasField(
          validateWorkflowVersion({ ...WORKFLOW_VERSION, errorPolicy }),
          "errorPolicy",
        ),
      ).toBe(true);
    }
  });

  it("rejects an empty or missing step list", () => {
    expect(
      validateWorkflowVersion({ ...WORKFLOW_VERSION, steps: [] }),
    ).toEqual([{ field: "steps", message: "must be a non-empty array" }]);

    expect(
      hasField(
        validateWorkflowVersion({ ...WORKFLOW_VERSION, steps: undefined }),
        "steps",
      ),
    ).toBe(true);
  });

  it("rejects duplicate step keys", () => {
    expect(
      validateWorkflowVersion({
        ...WORKFLOW_VERSION,
        steps: [
          workflowStep({ key: "same" }),
          workflowStep({ key: "same", skillVersionIds: ["skill-version-1"] }),
        ],
      }),
    ).toEqual([{ field: "steps[1].key", message: 'duplicates "same"' }]);
  });

  it("rejects duplicate approval-point keys", () => {
    expect(
      validateWorkflowVersion({
        ...WORKFLOW_VERSION,
        approvalPoints: [
          { key: "review-plan", message: "First" },
          { key: "review-plan", message: "Second" },
        ],
      }),
    ).toEqual([
      { field: "approvalPoints[1].key", message: 'duplicates "review-plan"' },
    ]);
  });

  it("rejects a step that references an unknown approval point", () => {
    expect(
      validateWorkflowVersion({
        ...WORKFLOW_VERSION,
        steps: [workflowStep({ approvalPointKey: "missing" })],
      }),
    ).toEqual([
      {
        field: "steps[0].approvalPointKey",
        message: 'references unknown approval point "missing"',
      },
    ]);
  });

  it("rejects unknown fields at every level", () => {
    const errors = validateWorkflowVersion({
      ...WORKFLOW_VERSION,
      apiKey: "secret",
      steps: [{ ...workflowStep(), token: "secret" }],
      approvalPoints: [
        { key: "review-plan", message: "Approve", password: "secret" },
      ],
    });

    expect(errors.map((error) => error.field)).toEqual([
      "apiKey",
      "steps[0].token",
      "approvalPoints[0].password",
    ]);
  });

  it("returns every issue in one call", () => {
    const errors = validateWorkflowVersion({
      id: "",
      definitionId: "",
      version: 0,
      steps: [],
      approvalPoints: [{}],
      errorPolicy: "continue",
      publishedAt: "not-a-date",
      extra: true,
    });

    expect(errors.map((error) => error.field)).toEqual([
      "extra",
      "id",
      "definitionId",
      "version",
      "publishedAt",
      "errorPolicy",
      "steps",
      "approvalPoints[0].key",
      "approvalPoints[0].message",
    ]);
  });

  it("is a pure validator", () => {
    const snapshot = structuredClone(WORKFLOW_VERSION);

    validateWorkflowVersion(WORKFLOW_VERSION);

    expect(WORKFLOW_VERSION).toEqual(snapshot);
  });

  it("rejects an invalid workflow version with a guard", () => {
    expect(
      isWorkflowVersion({ ...WORKFLOW_VERSION, errorPolicy: "continue" }),
    ).toBe(false);
  });
});
