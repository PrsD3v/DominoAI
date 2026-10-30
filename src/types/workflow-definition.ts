/**
 * Domino-owned, versioned workflow and skill definition model.
 *
 * Published versions are immutable snapshots. Validation rejects malformed
 * input and unknown fields, including secret-like fields, before a definition
 * can be published. This model imports nothing from an external definition
 * format, ACP, persistence, or the workflow engine.
 */

/** Policy applied when a step exhausts its attempts. Only fail-run is supported. */
export type WorkflowErrorPolicy = "fail-run";

/** Editable container for a workflow. Versions reference it by id. */
export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
}

/** Editable container for a skill. Versions reference it by id. */
export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
}

/** Human approval required before a step that references it executes. */
export interface ApprovalPointDefinition {
  readonly key: string;
  readonly message: string;
}

/** Attempt policy for one step. Absent retry means one attempt. */
export interface StepRetryPolicy {
  readonly maxAttempts: number;
}

/** One ordered step in a published workflow version. */
export interface WorkflowStepDefinition {
  readonly key: string;
  readonly skillVersionIds: readonly string[];
  readonly approvalPointKey?: string;
  readonly errorPolicy?: WorkflowErrorPolicy;
  readonly workingDirectory?: string;
  readonly retry?: StepRetryPolicy;
}

/** Immutable published snapshot of a workflow. */
export interface WorkflowVersion {
  readonly id: string;
  readonly definitionId: string;
  readonly version: number;
  readonly steps: readonly WorkflowStepDefinition[];
  readonly approvalPoints: readonly ApprovalPointDefinition[];
  readonly errorPolicy: WorkflowErrorPolicy;
  readonly publishedAt: string;
}

/** Immutable published snapshot of a skill's markdown content. */
export interface SkillVersion {
  readonly id: string;
  readonly skillDefinitionId: string;
  readonly version: number;
  readonly content: string;
  readonly publishedAt: string;
}

/** One validation problem on a definition or version. */
export interface DefinitionValidationError {
  readonly field: string;
  readonly message: string;
}

const WORKFLOW_DEFINITION_FIELDS = new Set(["id", "name"]);
const SKILL_DEFINITION_FIELDS = new Set(["id", "name"]);
const SKILL_VERSION_FIELDS = new Set([
  "id",
  "skillDefinitionId",
  "version",
  "content",
  "publishedAt",
]);
const APPROVAL_POINT_FIELDS = new Set(["key", "message"]);
const STEP_FIELDS = new Set([
  "key",
  "skillVersionIds",
  "approvalPointKey",
  "errorPolicy",
  "workingDirectory",
  "retry",
]);
const RETRY_FIELDS = new Set(["maxAttempts"]);
const WORKFLOW_VERSION_FIELDS = new Set([
  "id",
  "definitionId",
  "version",
  "steps",
  "approvalPoints",
  "errorPolicy",
  "publishedAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasNonWhitespace(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function fieldPath(prefix: string, field: string): string {
  return prefix.length === 0 ? field : `${prefix}.${field}`;
}

function rejectExtraFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix: string,
  errors: DefinitionValidationError[],
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      errors.push({
        field: fieldPath(prefix, field),
        message: "is not allowed",
      });
    }
  }
}

function requireNonEmptyString(
  value: Record<string, unknown>,
  field: string,
  prefix: string,
  errors: DefinitionValidationError[],
): void {
  if (!isNonEmptyString(value[field])) {
    errors.push({
      field: fieldPath(prefix, field),
      message: "must be a non-empty string",
    });
  }
}

function skillVersionIdErrors(
  value: unknown,
  path: string,
  errors: DefinitionValidationError[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ field: path, message: "must be a non-empty array" });
    return;
  }

  const seen = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const id: unknown = value[index];

    if (!isNonEmptyString(id)) {
      errors.push({
        field: `${path}[${index}]`,
        message: "must be a non-empty string",
      });
    } else if (seen.has(id)) {
      errors.push({
        field: `${path}[${index}]`,
        message: `duplicates "${id}"`,
      });
    } else {
      seen.add(id);
    }
  }
}

function retryErrors(
  value: unknown,
  path: string,
  errors: DefinitionValidationError[],
): void {
  if (!isRecord(value)) {
    errors.push({ field: path, message: "must be an object" });
    return;
  }

  rejectExtraFields(value, RETRY_FIELDS, path, errors);

  if (!isPositiveInteger(value.maxAttempts)) {
    errors.push({
      field: `${path}.maxAttempts`,
      message: "must be an integer of at least 1",
    });
  }
}

function workflowStepErrors(
  value: unknown,
  prefix: string,
): DefinitionValidationError[] {
  if (!isRecord(value)) {
    return [{ field: prefix.length === 0 ? "workflowStep" : prefix, message: "must be an object" }];
  }

  const errors: DefinitionValidationError[] = [];

  rejectExtraFields(value, STEP_FIELDS, prefix, errors);
  requireNonEmptyString(value, "key", prefix, errors);
  skillVersionIdErrors(
    value.skillVersionIds,
    fieldPath(prefix, "skillVersionIds"),
    errors,
  );

  if (
    value.approvalPointKey !== undefined &&
    !isNonEmptyString(value.approvalPointKey)
  ) {
    errors.push({
      field: fieldPath(prefix, "approvalPointKey"),
      message: "must be a non-empty string",
    });
  }

  if (value.errorPolicy !== undefined && value.errorPolicy !== "fail-run") {
    errors.push({
      field: fieldPath(prefix, "errorPolicy"),
      message: 'must be "fail-run"',
    });
  }

  if (
    value.workingDirectory !== undefined &&
    !isNonEmptyString(value.workingDirectory)
  ) {
    errors.push({
      field: fieldPath(prefix, "workingDirectory"),
      message: "must be a non-empty string",
    });
  }

  if (value.retry !== undefined) {
    retryErrors(value.retry, fieldPath(prefix, "retry"), errors);
  }

  return errors;
}

function approvalPointErrors(
  value: unknown,
  prefix: string,
): DefinitionValidationError[] {
  if (!isRecord(value)) {
    return [{ field: prefix.length === 0 ? "approvalPoint" : prefix, message: "must be an object" }];
  }

  const errors: DefinitionValidationError[] = [];

  rejectExtraFields(value, APPROVAL_POINT_FIELDS, prefix, errors);
  requireNonEmptyString(value, "key", prefix, errors);
  requireNonEmptyString(value, "message", prefix, errors);

  return errors;
}

function skillVersionErrors(
  value: unknown,
  prefix: string,
): DefinitionValidationError[] {
  if (!isRecord(value)) {
    return [{ field: prefix.length === 0 ? "skillVersion" : prefix, message: "must be an object" }];
  }

  const errors: DefinitionValidationError[] = [];

  rejectExtraFields(value, SKILL_VERSION_FIELDS, prefix, errors);
  requireNonEmptyString(value, "id", prefix, errors);
  requireNonEmptyString(value, "skillDefinitionId", prefix, errors);

  if (!isPositiveInteger(value.version)) {
    errors.push({
      field: fieldPath(prefix, "version"),
      message: "must be an integer of at least 1",
    });
  }

  if (!hasNonWhitespace(value.content)) {
    errors.push({
      field: fieldPath(prefix, "content"),
      message: "must contain at least one non-whitespace character",
    });
  }

  if (!isTimestamp(value.publishedAt)) {
    errors.push({
      field: fieldPath(prefix, "publishedAt"),
      message: "must be a valid timestamp",
    });
  }

  return errors;
}

/** Validate a workflow definition container. */
export function validateWorkflowDefinition(
  value: unknown,
): DefinitionValidationError[] {
  if (!isRecord(value)) {
    return [{ field: "workflowDefinition", message: "must be an object" }];
  }

  const errors: DefinitionValidationError[] = [];

  rejectExtraFields(value, WORKFLOW_DEFINITION_FIELDS, "", errors);
  requireNonEmptyString(value, "id", "", errors);
  requireNonEmptyString(value, "name", "", errors);

  return errors;
}

/** Validate a skill definition container. */
export function validateSkillDefinition(
  value: unknown,
): DefinitionValidationError[] {
  if (!isRecord(value)) {
    return [{ field: "skillDefinition", message: "must be an object" }];
  }

  const errors: DefinitionValidationError[] = [];

  rejectExtraFields(value, SKILL_DEFINITION_FIELDS, "", errors);
  requireNonEmptyString(value, "id", "", errors);
  requireNonEmptyString(value, "name", "", errors);

  return errors;
}

/** Validate a skill version, including non-empty markdown content. */
export function validateSkillVersion(
  value: unknown,
): DefinitionValidationError[] {
  return skillVersionErrors(value, "");
}

/** Validate one approval-point definition. */
export function validateApprovalPoint(
  value: unknown,
): DefinitionValidationError[] {
  return approvalPointErrors(value, "");
}

/** Validate one workflow step definition. */
export function validateWorkflowStepDefinition(
  value: unknown,
): DefinitionValidationError[] {
  return workflowStepErrors(value, "");
}

/** Validate a published workflow version and its internal references. */
export function validateWorkflowVersion(
  value: unknown,
): DefinitionValidationError[] {
  if (!isRecord(value)) {
    return [{ field: "workflowVersion", message: "must be an object" }];
  }

  const errors: DefinitionValidationError[] = [];

  rejectExtraFields(value, WORKFLOW_VERSION_FIELDS, "", errors);
  requireNonEmptyString(value, "id", "", errors);
  requireNonEmptyString(value, "definitionId", "", errors);

  if (!isPositiveInteger(value.version)) {
    errors.push({
      field: "version",
      message: "must be an integer of at least 1",
    });
  }

  if (!isTimestamp(value.publishedAt)) {
    errors.push({
      field: "publishedAt",
      message: "must be a valid timestamp",
    });
  }

  if (value.errorPolicy !== "fail-run") {
    errors.push({ field: "errorPolicy", message: 'must be "fail-run"' });
  }

  const stepKeys = new Set<string>();
  const steps = value.steps;

  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push({ field: "steps", message: "must be a non-empty array" });
  } else {
    for (let index = 0; index < steps.length; index += 1) {
      const step: unknown = steps[index];
      const prefix = `steps[${index}]`;

      errors.push(...workflowStepErrors(step, prefix));

      if (isRecord(step) && isNonEmptyString(step.key)) {
        if (stepKeys.has(step.key)) {
          errors.push({
            field: `${prefix}.key`,
            message: `duplicates "${step.key}"`,
          });
        } else {
          stepKeys.add(step.key);
        }
      }
    }
  }

  const approvalKeys = new Set<string>();
  const approvalPoints = value.approvalPoints;

  if (!Array.isArray(approvalPoints)) {
    errors.push({ field: "approvalPoints", message: "must be an array" });
  } else {
    for (let index = 0; index < approvalPoints.length; index += 1) {
      const point: unknown = approvalPoints[index];
      const prefix = `approvalPoints[${index}]`;

      errors.push(...approvalPointErrors(point, prefix));

      if (isRecord(point) && isNonEmptyString(point.key)) {
        if (approvalKeys.has(point.key)) {
          errors.push({
            field: `${prefix}.key`,
            message: `duplicates "${point.key}"`,
          });
        } else {
          approvalKeys.add(point.key);
        }
      }
    }

    if (Array.isArray(steps)) {
      for (let index = 0; index < steps.length; index += 1) {
        const step: unknown = steps[index];

        if (!isRecord(step)) {
          continue;
        }

        const key: unknown = step.approvalPointKey;

        if (isNonEmptyString(key) && !approvalKeys.has(key)) {
          errors.push({
            field: `steps[${index}].approvalPointKey`,
            message: `references unknown approval point "${key}"`,
          });
        }
      }
    }
  }

  return errors;
}

/** True when the value is a valid workflow definition. */
export function isWorkflowDefinition(
  value: unknown,
): value is WorkflowDefinition {
  return validateWorkflowDefinition(value).length === 0;
}

/** True when the value is a valid skill definition. */
export function isSkillDefinition(value: unknown): value is SkillDefinition {
  return validateSkillDefinition(value).length === 0;
}

/** True when the value is a valid skill version. */
export function isSkillVersion(value: unknown): value is SkillVersion {
  return validateSkillVersion(value).length === 0;
}

/** True when the value is a valid workflow version. */
export function isWorkflowVersion(value: unknown): value is WorkflowVersion {
  return validateWorkflowVersion(value).length === 0;
}
