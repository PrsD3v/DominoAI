import type {
  SkillDefinition,
  SkillVersion,
  WorkflowDefinition,
  WorkflowVersion,
} from "./workflow-definition";

/**
 * A registered workspace. Feature 11 owns registration-time validation and
 * canonicalization of `workspaceRoot`; this record only stores the result.
 * `defaultRuntimeProfileId` stays an opaque reference to a Feature 11A profile.
 */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly configuration: Record<string, unknown>;
  readonly defaultRuntimeProfileId?: string;
  readonly workflowVersionIds: readonly string[];
  readonly skillVersionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Application-owned persistence contract for registered projects. */
export interface ProjectPersistence {
  createProject(project: Project): Promise<void>;
  getProject(id: string): Promise<Project | null>;
  updateProject(project: Project): Promise<void>;
  listProjects(): Promise<readonly Project[]>;
}

/**
 * Application-owned persistence contract for published definitions.
 * Published versions are immutable, so no update method exists for them.
 * Editable definition containers can be renamed.
 */
export interface PublishedDefinitionPersistence {
  createWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null>;
  updateWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  listWorkflowDefinitions(): Promise<readonly WorkflowDefinition[]>;

  createSkillDefinition(definition: SkillDefinition): Promise<void>;
  getSkillDefinition(id: string): Promise<SkillDefinition | null>;
  updateSkillDefinition(definition: SkillDefinition): Promise<void>;
  listSkillDefinitions(): Promise<readonly SkillDefinition[]>;

  createWorkflowVersion(version: WorkflowVersion): Promise<void>;
  getWorkflowVersion(id: string): Promise<WorkflowVersion | null>;
  listWorkflowVersions(
    definitionId: string,
  ): Promise<readonly WorkflowVersion[]>;

  createSkillVersion(version: SkillVersion): Promise<void>;
  getSkillVersion(id: string): Promise<SkillVersion | null>;
  listSkillVersions(
    skillDefinitionId: string,
  ): Promise<readonly SkillVersion[]>;
}
