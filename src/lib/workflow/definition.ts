import type {
  DefinitionValidationError,
  SkillVersion,
  WorkflowVersion,
} from "../../types/workflow-definition";
import {
  validateSkillVersion,
  validateWorkflowVersion,
} from "../../types/workflow-definition";

/** Raised when a definition cannot be published. */
export class InvalidDefinitionError extends Error {
  readonly issues: readonly DefinitionValidationError[];

  constructor(issues: readonly DefinitionValidationError[]) {
    const first = issues[0];
    const summary =
      first === undefined ? "unknown issue" : `${first.field}: ${first.message}`;

    super(
      `Invalid definition (${issues.length} ${
        issues.length === 1 ? "issue" : "issues"
      }): ${summary}`,
    );
    this.name = "InvalidDefinitionError";
    this.issues = issues;
  }
}

/** Options required to publish a workflow version. */
export interface PublishWorkflowVersionOptions {
  readonly knownSkillVersionIds: ReadonlySet<string>;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  Object.freeze(value);

  return value;
}

/** Validate a skill version and return an immutable copy. */
export function publishSkillVersion(candidate: unknown): SkillVersion {
  const issues = validateSkillVersion(candidate);

  if (issues.length > 0) {
    throw new InvalidDefinitionError(issues);
  }

  const source = candidate as SkillVersion;
  const published: SkillVersion = {
    id: source.id,
    skillDefinitionId: source.skillDefinitionId,
    version: source.version,
    content: source.content,
    publishedAt: source.publishedAt,
  };

  return deepFreeze(published);
}

/**
 * Validate a workflow version, reject skill-version references outside the
 * supplied set, and return an immutable copy.
 */
export function publishWorkflowVersion(
  candidate: unknown,
  options: PublishWorkflowVersionOptions,
): WorkflowVersion {
  const issues = validateWorkflowVersion(candidate);

  if (issues.length > 0) {
    throw new InvalidDefinitionError(issues);
  }

  const source = candidate as WorkflowVersion;
  const referenceIssues: DefinitionValidationError[] = [];

  source.steps.forEach((step, stepIndex) => {
    step.skillVersionIds.forEach((skillVersionId) => {
      if (!options.knownSkillVersionIds.has(skillVersionId)) {
        referenceIssues.push({
          field: `steps[${stepIndex}].skillVersionIds`,
          message: `references unknown skill version "${skillVersionId}"`,
        });
      }
    });
  });

  if (referenceIssues.length > 0) {
    throw new InvalidDefinitionError(referenceIssues);
  }

  const published: WorkflowVersion = {
    id: source.id,
    definitionId: source.definitionId,
    version: source.version,
    steps: source.steps.map((step) => ({
      key: step.key,
      skillVersionIds: [...step.skillVersionIds],
      ...(step.approvalPointKey === undefined
        ? {}
        : { approvalPointKey: step.approvalPointKey }),
      ...(step.errorPolicy === undefined
        ? {}
        : { errorPolicy: step.errorPolicy }),
      ...(step.workingDirectory === undefined
        ? {}
        : { workingDirectory: step.workingDirectory }),
      ...(step.retry === undefined
        ? {}
        : { retry: { maxAttempts: step.retry.maxAttempts } }),
    })),
    approvalPoints: source.approvalPoints.map((point) => ({
      key: point.key,
      message: point.message,
    })),
    errorPolicy: source.errorPolicy,
    publishedAt: source.publishedAt,
  };

  return deepFreeze(published);
}
