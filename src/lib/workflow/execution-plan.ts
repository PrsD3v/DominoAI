import type { WorkflowExecutionPlan } from "@/types/workflow";

/** Raised when an execution plan cannot be executed as provided. */
export class InvalidExecutionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExecutionPlanError";
  }
}

/** Validates the minimal invariants the engine relies on before execution. */
export function validateExecutionPlan(plan: WorkflowExecutionPlan): void {
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new InvalidExecutionPlanError(
      "A workflow execution plan must contain at least one step",
    );
  }

  const seenKeys = new Set<string>();

  for (const step of plan.steps) {
    if (seenKeys.has(step.key)) {
      throw new InvalidExecutionPlanError(
        `Duplicate workflow step key "${step.key}"`,
      );
    }

    seenKeys.add(step.key);

    if (step.skillVersionIds !== undefined) {
      const skillVersionIds: unknown = step.skillVersionIds;

      if (!Array.isArray(skillVersionIds) || skillVersionIds.length === 0) {
        throw new InvalidExecutionPlanError(
          `Step "${step.key}" skillVersionIds must be a non-empty array`,
        );
      }

      const seenSkillVersionIds = new Set<string>();

      for (const skillVersionId of skillVersionIds) {
        if (typeof skillVersionId !== "string" || skillVersionId.length === 0) {
          throw new InvalidExecutionPlanError(
            `Step "${step.key}" skillVersionIds must contain non-empty strings`,
          );
        }

        if (seenSkillVersionIds.has(skillVersionId)) {
          throw new InvalidExecutionPlanError(
            `Step "${step.key}" skillVersionIds duplicates "${skillVersionId}"`,
          );
        }

        seenSkillVersionIds.add(skillVersionId);
      }
    }

    if (step.retry !== undefined) {
      const { maxAttempts } = step.retry;

      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new InvalidExecutionPlanError(
          `Step "${step.key}" retry.maxAttempts must be an integer of at least 1`,
        );
      }
    }
  }
}
