import { describe, expect, it } from "vitest";
import { InvalidExecutionPlanError } from "./execution-plan";
import type { PublishedWorkflowView } from "./projection";
import { projectPublishedWorkflow } from "./projection";

function view(
  overrides: Partial<PublishedWorkflowView> = {},
): PublishedWorkflowView {
  return {
    workflowId: "workflow-1",
    workflowVersion: 2,
    steps: [{ key: "step-1", prompt: "Do the work" }],
    ...overrides,
  };
}

describe("projectPublishedWorkflow", () => {
  it("projects the workflow identity and executable step fields in order", () => {
    const source = view({
      steps: [
        { key: "one", prompt: "Do one" },
        {
          key: "two",
          prompt: "Do two",
          workingDirectory: "packages/app",
          retry: { maxAttempts: 3 },
        },
      ],
    });

    expect(projectPublishedWorkflow(source)).toEqual({
      workflowId: "workflow-1",
      workflowVersion: 2,
      steps: [
        { key: "one", prompt: "Do one" },
        {
          key: "two",
          prompt: "Do two",
          workingDirectory: "packages/app",
          retry: { maxAttempts: 3 },
        },
      ],
    });
  });

  it("defaults an explicit retry policy without maxAttempts to one attempt", () => {
    const source = view({
      steps: [{ key: "one", prompt: "Do one", retry: {} }],
    });

    expect(projectPublishedWorkflow(source).steps[0]?.retry).toEqual({
      maxAttempts: 1,
    });
  });

  it("drops fields that are not executable", () => {
    const source = {
      workflowId: "workflow-1",
      workflowVersion: 2,
      steps: [
        {
          key: "one",
          prompt: "Do one",
          skills: ["skill-a"],
          approvalPoints: [{ id: "approval-1" }],
          errorPolicy: { retry: 5 },
          provider: "reasonix",
          model: "deepseek/deepseek-flash",
        },
      ],
    };

    const plan = projectPublishedWorkflow(source);

    expect(plan.steps[0]).toEqual({ key: "one", prompt: "Do one" });
    expect(plan.steps[0]).not.toHaveProperty("skills");
    expect(plan.steps[0]).not.toHaveProperty("approvalPoints");
    expect(plan.steps[0]).not.toHaveProperty("errorPolicy");
    expect(plan.steps[0]).not.toHaveProperty("provider");
    expect(plan.steps[0]).not.toHaveProperty("model");
  });

  it("does not mutate or reuse the published view", () => {
    const source = view({
      steps: [{ key: "one", prompt: "Do one" }],
    });
    const snapshot = structuredClone(source);

    const plan = projectPublishedWorkflow(source);

    expect(source).toEqual(snapshot);
    expect(plan.steps[0]).not.toBe(source.steps[0]);
  });

  it("rejects an empty published step list", () => {
    expect(() => projectPublishedWorkflow(view({ steps: [] }))).toThrow(
      InvalidExecutionPlanError,
    );
  });

  it("rejects duplicate step keys", () => {
    expect(() =>
      projectPublishedWorkflow(
        view({
          steps: [
            { key: "same", prompt: "One" },
            { key: "same", prompt: "Two" },
          ],
        }),
      ),
    ).toThrow('Duplicate workflow step key "same"');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects maxAttempts %s",
    (maxAttempts) => {
      expect(() =>
        projectPublishedWorkflow(
          view({
            steps: [{ key: "one", prompt: "Do one", retry: { maxAttempts } }],
          }),
        ),
      ).toThrow(InvalidExecutionPlanError);
    },
  );
});
