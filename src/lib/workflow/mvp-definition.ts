import type { PublishedDefinitionPersistence } from "../../types/persistence";
import type {
  SkillDefinition,
  SkillVersion,
  WorkflowDefinition,
  WorkflowVersion,
} from "../../types/workflow-definition";
import { publishSkillVersion, publishWorkflowVersion } from "./definition";

/**
 * Deterministic MVP fixture: three ordered steps, one approval pause, and one
 * skill version per step. The ids and timestamp are fixed so seeding the same
 * database twice cannot create different records.
 */
export const MVP_SEED_PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

export const MVP_SKILL_DEFINITION_ID = "mvp-skill";
export const MVP_SKILL_DEFINITION_NAME = "MVP step instructions";

export const MVP_WORKFLOW_DEFINITION_ID = "mvp-workflow";
export const MVP_WORKFLOW_DEFINITION_NAME = "MVP three-step workflow";
export const MVP_WORKFLOW_VERSION_ID = "mvp-workflow-v1";

export const MVP_APPROVAL_POINT_KEY = "approve-apply";
export const MVP_APPROVAL_MESSAGE =
  "Approve the changes before the agent applies them.";

/** Step prompts in execution order. Each is also its skill version's content. */
export const MVP_SKILL_CONTENTS = [
  "Inspect the workspace and report what needs to change. Do not edit files.",
  "Apply the smallest change that satisfies the request.",
  "Verify the change and report the observed result.",
] as const;

/** Step keys in execution order, aligned with `MVP_SKILL_CONTENTS`. */
export const MVP_STEP_KEYS = ["inspect", "apply", "verify"] as const;

/** Skill version ids in execution order, aligned with `MVP_STEP_KEYS`. */
export const MVP_SKILL_VERSION_IDS = [
  "mvp-skill-v1",
  "mvp-skill-v2",
  "mvp-skill-v3",
] as const;

export interface MvpSeedRecords {
  readonly skillDefinition: SkillDefinition;
  readonly skillVersions: readonly SkillVersion[];
  readonly workflowDefinition: WorkflowDefinition;
  readonly workflowVersion: WorkflowVersion;
}

export interface MvpSeedResult {
  readonly seeded: boolean;
}

/** Build and validate the seed records without touching persistence. */
export function createMvpSeedRecords(): MvpSeedRecords {
  const skillVersions = MVP_SKILL_VERSION_IDS.map((id, index) =>
    publishSkillVersion({
      id,
      skillDefinitionId: MVP_SKILL_DEFINITION_ID,
      version: index + 1,
      content: MVP_SKILL_CONTENTS[index],
      publishedAt: MVP_SEED_PUBLISHED_AT,
    }),
  );

  const workflowVersion = publishWorkflowVersion(
    {
      id: MVP_WORKFLOW_VERSION_ID,
      definitionId: MVP_WORKFLOW_DEFINITION_ID,
      version: 1,
      steps: MVP_STEP_KEYS.map((key, index) => ({
        key,
        skillVersionIds: [MVP_SKILL_VERSION_IDS[index]],
        ...(key === "apply"
          ? { approvalPointKey: MVP_APPROVAL_POINT_KEY }
          : {}),
      })),
      approvalPoints: [
        { key: MVP_APPROVAL_POINT_KEY, message: MVP_APPROVAL_MESSAGE },
      ],
      errorPolicy: "fail-run",
      publishedAt: MVP_SEED_PUBLISHED_AT,
    },
    { knownSkillVersionIds: new Set(MVP_SKILL_VERSION_IDS) },
  );

  return {
    skillDefinition: {
      id: MVP_SKILL_DEFINITION_ID,
      name: MVP_SKILL_DEFINITION_NAME,
    },
    skillVersions,
    workflowDefinition: {
      id: MVP_WORKFLOW_DEFINITION_ID,
      name: MVP_WORKFLOW_DEFINITION_NAME,
    },
    workflowVersion,
  };
}

/**
 * Publish the MVP fixture into an empty definition store. Any existing
 * definition, including a partially seeded store, is left untouched.
 */
export async function seedMvpDefinition(
  persistence: PublishedDefinitionPersistence,
): Promise<MvpSeedResult> {
  const [workflows, skills] = await Promise.all([
    persistence.listWorkflowDefinitions(),
    persistence.listSkillDefinitions(),
  ]);

  if (workflows.length > 0 || skills.length > 0) {
    return { seeded: false };
  }

  const records = createMvpSeedRecords();

  await persistence.createSkillDefinition(records.skillDefinition);

  for (const version of records.skillVersions) {
    await persistence.createSkillVersion(version);
  }

  await persistence.createWorkflowDefinition(records.workflowDefinition);
  await persistence.createWorkflowVersion(records.workflowVersion);

  return { seeded: true };
}
