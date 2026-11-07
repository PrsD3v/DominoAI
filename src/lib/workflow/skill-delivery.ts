/**
 * Read published skill versions from Domino's central library and turn their
 * markdown into the prompt text for one workflow step.
 *
 * Delivery is prompt content over the existing ACP `session/prompt` path. This
 * module never writes files, installs a runtime skill, or knows about a
 * provider, model, or credential.
 */
import type { ExecutionStep, WorkflowExecutionPlan } from "../../types/workflow";
import type {
  DefinitionValidationError,
  SkillVersion,
  WorkflowVersion,
} from "../../types/workflow-definition";
import { validateWorkflowVersion } from "../../types/workflow-definition";
import { validateExecutionPlan } from "./execution-plan";

/** Minimal read port over the central skill library. */
export interface SkillVersionLookup {
  getSkillVersion(id: string): Promise<SkillVersion | null>;
}

/** Typed reasons the library or projection cannot deliver a step. */
export type SkillDeliveryErrorCode =
  | "skill_version_not_found"
  | "duplicate_skill_version"
  | "empty_skill_selection"
  | "invalid_skill_content"
  | "invalid_workflow_version";

/** Raised when a step's skill content cannot be resolved or composed. */
export class SkillDeliveryError extends Error {
  readonly code: SkillDeliveryErrorCode;
  readonly skillVersionId?: string;
  readonly issues?: readonly DefinitionValidationError[];

  constructor(
    code: SkillDeliveryErrorCode,
    detail: {
      readonly skillVersionId?: string;
      readonly issues?: readonly DefinitionValidationError[];
    } = {},
  ) {
    super(describe(code, detail));
    this.name = "SkillDeliveryError";
    this.code = code;
    this.skillVersionId = detail.skillVersionId;
    this.issues = detail.issues;
  }
}

function describe(
  code: SkillDeliveryErrorCode,
  detail: {
    readonly skillVersionId?: string;
    readonly issues?: readonly DefinitionValidationError[];
  },
): string {
  switch (code) {
    case "skill_version_not_found":
      return `Skill version "${detail.skillVersionId ?? "unknown"}" was not found`;
    case "duplicate_skill_version":
      return `Skill version "${detail.skillVersionId ?? "unknown"}" is listed more than once`;
    case "empty_skill_selection":
      return "A step must deliver at least one skill version";
    case "invalid_skill_content":
      return `Skill version "${detail.skillVersionId ?? "unknown"}" has no content`;
    case "invalid_workflow_version": {
      const count = detail.issues?.length ?? 0;
      return `Workflow version cannot be projected: ${count} definition ${
        count === 1 ? "issue" : "issues"
      }`;
    }
  }
}

/**
 * Resolve skill version ids in the requested order. Unknown and repeated ids
 * fail with a typed error; no partial list is returned.
 */
export async function resolveSkillVersions(
  lookup: SkillVersionLookup,
  skillVersionIds: readonly string[],
): Promise<readonly SkillVersion[]> {
  const versions: SkillVersion[] = [];
  const seen = new Set<string>();

  for (const skillVersionId of skillVersionIds) {
    if (seen.has(skillVersionId)) {
      throw new SkillDeliveryError("duplicate_skill_version", {
        skillVersionId,
      });
    }

    seen.add(skillVersionId);

    const version = await lookup.getSkillVersion(skillVersionId);

    if (version === null) {
      throw new SkillDeliveryError("skill_version_not_found", {
        skillVersionId,
      });
    }

    versions.push(version);
  }

  return versions;
}

/**
 * Join skill contents in the given order, byte for byte, with exactly one blank
 * line between them. No trimming, rewriting, headings, or numbering is added.
 */
export function composeSkillPrompt(
  skillVersions: readonly SkillVersion[],
): string {
  if (skillVersions.length === 0) {
    throw new SkillDeliveryError("empty_skill_selection");
  }

  const contents = skillVersions.map((version) => {
    if (version.content.trim().length === 0) {
      throw new SkillDeliveryError("invalid_skill_content", {
        skillVersionId: version.id,
      });
    }

    return version.content;
  });

  return contents.join("\n\n");
}

/**
 * Project a published workflow version into an executable plan whose step
 * prompts are the composed skill content. Every step resolves before a plan is
 * returned, so a missing skill never yields a partial plan.
 */
export async function projectWorkflowVersionWithSkills(
  workflowVersion: WorkflowVersion,
  lookup: SkillVersionLookup,
): Promise<WorkflowExecutionPlan> {
  const issues = validateWorkflowVersion(workflowVersion);

  if (issues.length > 0) {
    throw new SkillDeliveryError("invalid_workflow_version", { issues });
  }

  const steps: ExecutionStep[] = [];

  for (const step of workflowVersion.steps) {
    const skillVersions = await resolveSkillVersions(
      lookup,
      step.skillVersionIds,
    );

    steps.push({
      key: step.key,
      prompt: composeSkillPrompt(skillVersions),
      skillVersionIds: [...step.skillVersionIds],
      ...(step.workingDirectory === undefined
        ? {}
        : { workingDirectory: step.workingDirectory }),
      ...(step.retry === undefined
        ? {}
        : { retry: { maxAttempts: step.retry.maxAttempts } }),
    });
  }

  const plan: WorkflowExecutionPlan = {
    workflowId: workflowVersion.definitionId,
    workflowVersion: workflowVersion.version,
    steps,
  };

  validateExecutionPlan(plan);

  return plan;
}
