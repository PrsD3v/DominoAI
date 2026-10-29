import type { ExecutionStep, WorkflowExecutionPlan } from "@/types/workflow";
import { validateExecutionPlan } from "./execution-plan";

/** Read-only step view a published workflow must provide for projection. */
export interface PublishedWorkflowViewStep {
  readonly key: string;
  readonly prompt: string;
  readonly workingDirectory?: string;
  readonly retry?: {
    readonly maxAttempts?: number;
  };
}

/** Narrow port from the published workflow model owned by Feature 8. */
export interface PublishedWorkflowView {
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly steps: readonly PublishedWorkflowViewStep[];
}

/** Copies only executable fields into a plan the engine can run. */
export function projectPublishedWorkflow(
  source: PublishedWorkflowView,
): WorkflowExecutionPlan {
  const steps: ExecutionStep[] = source.steps.map((step) => ({
    key: step.key,
    prompt: step.prompt,
    ...(step.workingDirectory === undefined
      ? {}
      : { workingDirectory: step.workingDirectory }),
    ...(step.retry === undefined
      ? {}
      : { retry: { maxAttempts: step.retry.maxAttempts ?? 1 } }),
  }));

  const plan: WorkflowExecutionPlan = {
    workflowId: source.workflowId,
    workflowVersion: source.workflowVersion,
    steps,
  };

  validateExecutionPlan(plan);

  return plan;
}
