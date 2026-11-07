import type {
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import type {
  WorkflowDefinition,
  WorkflowVersion,
  WorkflowStepDefinition,
} from "../../types/workflow-definition";
import { workflowVersionGroups } from "../projects/screen";
import { lastRunByWorkflow } from "../runs/screen";
import type { RunSummary } from "../../types/run-api";

export interface WorkflowDefinitionView {
  readonly definition: WorkflowDefinition;
  readonly versions: readonly WorkflowVersion[];
  readonly latest: WorkflowVersion | null;
  readonly lastRun: RunSummary | null;
}

export interface StepView {
  readonly step: WorkflowStepDefinition;
  readonly skillLabels: readonly string[];
  readonly approvalMessage: string | null;
}

function skillName(
  skills: SkillCatalogResponse,
  skillDefinitionId: string,
): string {
  return (
    skills.definitions.find((entry) => entry.id === skillDefinitionId)?.name ??
    skillDefinitionId
  );
}

/** Resolve one step's skill version ids to display labels. */
export function stepViews(
  version: WorkflowVersion,
  skills: SkillCatalogResponse,
): readonly StepView[] {
  const versions = new Map(skills.versions.map((entry) => [entry.id, entry]));

  return version.steps.map((step) => ({
    step,
    skillLabels: step.skillVersionIds.map((id) => {
      const skillVersion = versions.get(id);

      return skillVersion === undefined
        ? id
        : `${skillName(skills, skillVersion.skillDefinitionId)} v${skillVersion.version}`;
    }),
    approvalMessage:
      step.approvalPointKey === undefined
        ? null
        : version.approvalPoints.find(
            (point) => point.key === step.approvalPointKey,
          )?.message ?? null,
  }));
}

/** Definitions in catalog order, versions newest first, plus their last run. */
export function workflowDefinitionViews(
  catalog: WorkflowCatalogResponse,
  runs: readonly RunSummary[],
): readonly WorkflowDefinitionView[] {
  return workflowVersionGroups(catalog).map((group) => ({
    definition: group.definition,
    versions: group.versions,
    latest: group.versions[0] ?? null,
    lastRun: lastRunByWorkflow(runs, group.definition.id),
  }));
}
