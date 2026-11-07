import type { Project } from "../../types/persistence";
import type {
  SkillCatalogResponse,
  SkillVersionSummary,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import type { RuntimeProfile } from "../../types/runtime-settings";
import type {
  SkillDefinition,
  WorkflowDefinition,
  WorkflowVersion,
} from "../../types/workflow-definition";
import { workflowLabel } from "../runs/screen";

export type ProjectFieldName =
  | "name"
  | "workspaceRoot"
  | "defaultRuntimeProfileId"
  | "workflowVersionIds"
  | "skillVersionIds";

/** Select sentinel for clearing a project's default runtime profile. */
export const NO_PROFILE = "__no_profile__";

export interface ProjectDraft {
  readonly name: string;
  readonly workspaceRoot: string;
  readonly defaultRuntimeProfileId: string | null;
  readonly workflowVersionIds: readonly string[];
  readonly skillVersionIds: readonly string[];
}

export interface WorkflowVersionGroup {
  readonly definition: WorkflowDefinition;
  readonly versions: readonly WorkflowVersion[];
}

export interface SkillVersionGroup {
  readonly definition: SkillDefinition;
  readonly versions: readonly SkillVersionSummary[];
}

const API_FIELD_MAP: Record<string, ProjectFieldName> = {
  name: "name",
  workspaceRoot: "workspaceRoot",
  defaultRuntimeProfileId: "defaultRuntimeProfileId",
  workflowVersionIds: "workflowVersionIds",
  skillVersionIds: "skillVersionIds",
  versionId: "workflowVersionIds",
};

/** Resolve a server field name to a form field, ignoring unrelated fields. */
export function projectFieldFromApi(field: string): ProjectFieldName | null {
  return API_FIELD_MAP[field] ?? null;
}

/** Required client-side checks; the server remains authoritative. */
export function validateProjectDraft(
  draft: ProjectDraft,
): readonly ProjectFieldName[] {
  const fields: ProjectFieldName[] = [];

  if (draft.name.trim() === "") {
    fields.push("name");
  }

  if (draft.workspaceRoot.trim() === "") {
    fields.push("workspaceRoot");
  }

  if (draft.workflowVersionIds.length === 0) {
    fields.push("workflowVersionIds");
  }

  return fields;
}

export function projectFormBody(draft: ProjectDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    workspaceRoot: draft.workspaceRoot.trim(),
    ...(draft.defaultRuntimeProfileId === null
      ? {}
      : { defaultRuntimeProfileId: draft.defaultRuntimeProfileId }),
    workflowVersionIds: [...draft.workflowVersionIds],
    skillVersionIds: [...draft.skillVersionIds],
  };
}

/** Add or remove one id while keeping the original selection order. */
export function toggleId(
  ids: readonly string[],
  id: string,
): readonly string[] {
  return ids.includes(id)
    ? ids.filter((entry) => entry !== id)
    : [...ids, id];
}

export function workflowVersionGroups(
  catalog: WorkflowCatalogResponse,
): readonly WorkflowVersionGroup[] {
  return catalog.definitions.map((definition) => ({
    definition,
    versions: catalog.versions
      .filter((version) => version.definitionId === definition.id)
      .sort((left, right) => right.version - left.version),
  }));
}

export function skillVersionGroups(
  catalog: SkillCatalogResponse,
): readonly SkillVersionGroup[] {
  return catalog.definitions.map((definition) => ({
    definition,
    versions: catalog.versions
      .filter((version) => version.skillDefinitionId === definition.id)
      .sort((left, right) => right.version - left.version),
  }));
}

export function skillVersionLabel(
  catalog: SkillCatalogResponse,
  versionId: string,
): string {
  const version = catalog.versions.find((entry) => entry.id === versionId);

  if (version === undefined) {
    return versionId;
  }

  const definition = catalog.definitions.find(
    (entry) => entry.id === version.skillDefinitionId,
  );

  return `${definition?.name ?? version.skillDefinitionId} v${version.version}`;
}

export function profileOptionLabel(
  profiles: readonly RuntimeProfile[],
  profileId: string | undefined,
): string | null {
  if (profileId === undefined) {
    return null;
  }

  return profiles.find((profile) => profile.id === profileId)?.label ?? null;
}

export function selectedWorkflowLabels(
  project: Project,
  catalog: WorkflowCatalogResponse,
): readonly string[] {
  return project.workflowVersionIds.map((id) =>
    workflowLabel(catalog, id, id),
  );
}

export function applyDefaultProfile(
  project: Project,
  profileId: string | null,
): Project {
  return {
    id: project.id,
    name: project.name,
    workspaceRoot: project.workspaceRoot,
    configuration: project.configuration,
    ...(profileId === null ? {} : { defaultRuntimeProfileId: profileId }),
    workflowVersionIds: project.workflowVersionIds,
    skillVersionIds: project.skillVersionIds,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
