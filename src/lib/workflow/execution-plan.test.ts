import { describe, expect, it } from "vitest";
import type { ExecutionStep, WorkflowExecutionPlan } from "@/types/workflow";
import {
  InvalidExecutionPlanError,
  validateExecutionPlan,
} from "./execution-plan";

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    key: "step-1",
    prompt: "Do the work",
    ...overrides,
  };
}

function plan(steps: readonly ExecutionStep[]): WorkflowExecutionPlan {
  return {
    workflowId: "workflow-1",
    workflowVersion: 1,
    steps,
  };
}

describe("validateExecutionPlan", () => {
  it("accepts unique steps with no retry policy", () => {
    expect(() =>
      validateExecutionPlan(plan([step(), step({ key: "step-2" })])),
    ).not.toThrow();
  });

  it("accepts an integer maxAttempts of at least one", () => {
    expect(() =>
      validateExecutionPlan(
        plan([
          step({ key: "one", retry: { maxAttempts: 1 } }),
          step({ key: "two", retry: { maxAttempts: 3 } }),
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects an empty step list", () => {
    expect(() => validateExecutionPlan(plan([]))).toThrow(
      InvalidExecutionPlanError,
    );
    expect(() => validateExecutionPlan(plan([]))).toThrow(
      "must contain at least one step",
    );
  });

  it("rejects duplicate step keys", () => {
    expect(() =>
      validateExecutionPlan(
        plan([step({ key: "same" }), step({ key: "same", prompt: "Other" })]),
      ),
    ).toThrow('Duplicate workflow step key "same"');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects maxAttempts %s",
    (maxAttempts) => {
      expect(() =>
        validateExecutionPlan(plan([step({ retry: { maxAttempts } })])),
      ).toThrow(InvalidExecutionPlanError);
    },
  );
});
