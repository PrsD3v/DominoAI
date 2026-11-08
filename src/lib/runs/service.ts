import type {
  Project,
  ProjectPersistence,
  PublishedDefinitionPersistence,
  RuntimeProfilePersistence,
} from "../../types/persistence";
import type { AgentRuntime } from "../../types/runtime";
import type {
  CredentialStatus,
  CredentialStore,
  RuntimeProfile,
} from "../../types/runtime-settings";
import { validateRuntimeProfile } from "../../types/runtime-settings";
import type {
  RunDetail,
  RunErrorCode,
  RunFieldError,
  RunState,
  RunSummary,
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import { skillVersionSummary } from "../../types/run-api";
import {
  registerProject as registerProjectRecord,
  ProjectRegistrationError,
  type ProjectRegistrationInput,
} from "../projects/registration";
import type {
  ApprovalRequest,
  RuntimeEventRecord,
  StepRun,
  WorkflowExecutionPersistence,
  WorkflowHistoryEntry,
  WorkflowRun,
} from "../../types/workflow";
import type { WorkflowVersion } from "../../types/workflow-definition";
import type { WorkflowEngine } from "../workflow/engine";
import {
  WorkflowApprovalError,
  WorkflowRunStateError,
} from "../workflow/engine";
import {
  redactRuntimeEvent,
  redactText,
} from "../safety/redaction";
import {
  projectWorkflowVersionWithSkills,
  SkillDeliveryError,
} from "../workflow/skill-delivery";

const MESSAGES: Record<RunErrorCode, string> = {
  invalid_request: "The run request is invalid.",
  invalid_json: "The request body must be a JSON object.",
  unsupported_media_type: "The request body must be JSON.",
  origin_not_allowed: "The request came from an unapproved origin.",
  project_not_found: "The project was not found.",
  workflow_version_not_found: "The workflow version was not found.",
  skill_version_not_found: "The skill version was not found.",
  workspace_root_invalid: "The workspace root cannot be used.",
  workspace_root_registered: "A project is already registered for that workspace.",
  runtime_profile_not_found: "The runtime profile was not found.",
  runtime_profile_required: "The project has no default runtime profile.",
  runtime_profile_invalid: "The runtime profile is not valid.",
  credential_missing: "The runtime profile has no stored credential.",
  workflow_version_not_selected:
    "The workflow version is not selected for this project.",
  workflow_version_invalid: "The workflow version cannot be executed.",
  skill_version_missing: "A skill version required by the workflow is missing.",
  run_not_found: "The run was not found.",
  run_busy: "Another workflow run is already active.",
  run_state_conflict: "The run is not in a state that allows that operation.",
  approval_not_found: "The approval was not found.",
  approval_already_resolved: "The approval was already answered.",
  persistence_error: "The workflow store is unavailable.",
  runtime_unavailable: "The runtime did not start.",
};

/** A typed run-service failure. Messages never contain paths, output, or secrets. */
export class RunServiceError extends Error {
  readonly code: RunErrorCode;
  readonly fields?: readonly RunFieldError[];

  constructor(code: RunErrorCode, fields?: readonly RunFieldError[]) {
    super(MESSAGES[code]);
    this.name = "RunServiceError";
    this.code = code;

    if (fields !== undefined) {
      this.fields = fields;
    }
  }
}

/** A runtime request for one run. The factory owns binary and home paths. */
export interface RunRuntimeRequest {
  readonly profile: RuntimeProfile;
  readonly workspaceRoot: string;
}

export type RunRuntimeFactory = (
  request: RunRuntimeRequest,
) => Promise<AgentRuntime>;

/** Persistence and runtime dependencies for the run service. */
export interface RunServiceDeps {
  readonly persistence: WorkflowExecutionPersistence &
    ProjectPersistence &
    PublishedDefinitionPersistence &
    RuntimeProfilePersistence;
  readonly credentials: CredentialStore;
  readonly engine: WorkflowEngine;
  readonly createRuntime: RunRuntimeFactory;
}

/** Server-facing run operations. Views never include a credential. */
export interface RunService {
  listProjects(): Promise<readonly Project[]>;
  registerProject(input: unknown): Promise<Project>;
  listWorkflows(): Promise<WorkflowCatalogResponse>;
  listSkills(): Promise<SkillCatalogResponse>;
  startRun(input: unknown): Promise<RunDetail>;
  listRuns(): Promise<readonly RunSummary[]>;
  getRun(id: string): Promise<RunDetail>;
  getState(id: string): Promise<RunState>;
  listRuntimeEvents(
    id: string,
    fromIndex: number,
  ): Promise<readonly RuntimeEventRecord[]>;
  pauseRun(id: string): Promise<RunDetail>;
  continueRun(id: string): Promise<RunDetail>;
  cancelRun(id: string): Promise<RunDetail>;
  answerApproval(
    id: string,
    approvalId: string,
    input: unknown,
  ): Promise<RunDetail>;
}

interface StartRunInput {
  readonly projectId: string;
  readonly workflowVersionId: string;
}

const START_FIELDS = new Set(["projectId", "workflowVersionId"]);
const APPROVAL_FIELDS = new Set(["decision"]);
const PROJECT_FIELDS = new Set([
  "name",
  "workspaceRoot",
  "configuration",
  "defaultRuntimeProfileId",
  "workflowVersionIds",
  "skillVersionIds",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function extraFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): RunFieldError[] {
  return Object.keys(value)
    .filter((field) => !allowed.has(field))
    .map((field) => ({ field, message: "is not allowed" }));
}

function parseStartInput(value: unknown): StartRunInput {
  if (!isRecord(value)) {
    throw new RunServiceError("invalid_request", [
      { field: "body", message: "must be an object" },
    ]);
  }

  const fields = extraFields(value, START_FIELDS);
  const projectId = value.projectId;
  const workflowVersionId = value.workflowVersionId;

  if (!isNonEmptyString(projectId)) {
    fields.push({ field: "projectId", message: "must be a non-empty string" });
  }

  if (!isNonEmptyString(workflowVersionId)) {
    fields.push({
      field: "workflowVersionId",
      message: "must be a non-empty string",
    });
  }

  if (fields.length > 0) {
    throw new RunServiceError("invalid_request", fields);
  }

  return {
    projectId: projectId as string,
    workflowVersionId: workflowVersionId as string,
  };
}

function parseDecision(value: unknown): "approve" | "reject" {
  if (!isRecord(value)) {
    throw new RunServiceError("invalid_request", [
      { field: "body", message: "must be an object" },
    ]);
  }

  const fields = extraFields(value, APPROVAL_FIELDS);
  const decision = value.decision;

  if (decision !== "approve" && decision !== "reject") {
    fields.push({
      field: "decision",
      message: 'must be "approve" or "reject"',
    });
  }

  if (fields.length > 0) {
    throw new RunServiceError("invalid_request", fields);
  }

  return decision as "approve" | "reject";
}

function stringList(
  value: unknown,
  field: string,
  errors: RunFieldError[],
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.some((entry) => !isNonEmptyString(entry))
  ) {
    errors.push({
      field,
      message: "must be an array of non-empty strings",
    });
    return undefined;
  }

  return value as string[];
}

function parseProjectInput(value: unknown): ProjectRegistrationInput {
  if (!isRecord(value)) {
    throw new RunServiceError("invalid_json");
  }

  const fields = extraFields(value, PROJECT_FIELDS);
  const name = value.name;
  const workspaceRoot = value.workspaceRoot;

  if (!isNonEmptyString(name)) {
    fields.push({ field: "name", message: "must be a non-empty string" });
  }

  if (!isNonEmptyString(workspaceRoot)) {
    fields.push({
      field: "workspaceRoot",
      message: "must be a non-empty string",
    });
  }

  let configuration: Record<string, unknown> | undefined;

  if (value.configuration !== undefined) {
    if (isRecord(value.configuration)) {
      configuration = value.configuration;
    } else {
      fields.push({
        field: "configuration",
        message: "must be an object",
      });
    }
  }

  let defaultRuntimeProfileId: string | undefined;

  if (value.defaultRuntimeProfileId !== undefined) {
    if (isNonEmptyString(value.defaultRuntimeProfileId)) {
      defaultRuntimeProfileId = value.defaultRuntimeProfileId;
    } else {
      fields.push({
        field: "defaultRuntimeProfileId",
        message: "must be a non-empty string",
      });
    }
  }

  const workflowVersionIds = stringList(
    value.workflowVersionIds,
    "workflowVersionIds",
    fields,
  );
  const skillVersionIds = stringList(
    value.skillVersionIds,
    "skillVersionIds",
    fields,
  );

  if (fields.length > 0) {
    throw new RunServiceError("invalid_request", fields);
  }

  return {
    name: name as string,
    workspaceRoot: workspaceRoot as string,
    ...(configuration === undefined ? {} : { configuration }),
    ...(defaultRuntimeProfileId === undefined
      ? {}
      : { defaultRuntimeProfileId }),
    ...(workflowVersionIds === undefined ? {} : { workflowVersionIds }),
    ...(skillVersionIds === undefined ? {} : { skillVersionIds }),
  };
}

function registrationFailure(
  error: ProjectRegistrationError,
): RunServiceError {
  switch (error.reason) {
    case "invalid-name":
      return new RunServiceError("invalid_request", [
        { field: "name", message: "must be a non-empty string" },
      ]);
    case "invalid-configuration":
      return new RunServiceError("invalid_request", [
        {
          field: "configuration",
          message: "must be a JSON-serializable object",
        },
      ]);
    case "invalid-profile-id":
      return new RunServiceError("invalid_request", [
        {
          field: "defaultRuntimeProfileId",
          message: "must be a non-empty string",
        },
      ]);
    case "unknown-profile-id":
      return new RunServiceError("runtime_profile_not_found");
    case "root-missing":
    case "root-not-directory":
    case "root-inaccessible":
      return new RunServiceError("workspace_root_invalid");
    case "duplicate-root":
      return new RunServiceError("workspace_root_registered");
    case "duplicate-selection":
      return new RunServiceError("invalid_request", [
        {
          field: "versionId",
          message: `duplicates "${error.versionId ?? ""}"`,
        },
      ]);
    case "unknown-workflow-version":
      return new RunServiceError("workflow_version_not_found");
    case "unknown-skill-version":
      return new RunServiceError("skill_version_not_found");
  }
}

async function closeRuntime(runtime: AgentRuntime): Promise<void> {
  try {
    await runtime.close();
  } catch {
    // A runtime close failure does not change the recorded run result.
  }
}

function summary(run: WorkflowRun, projectName?: string): RunSummary {
  return {
    id: run.id,
    ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
    ...(projectName === undefined ? {} : { projectName }),
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    ...(run.workflowVersionId === undefined
      ? {}
      : { workflowVersionId: run.workflowVersionId }),
    status: run.status,
    workspaceRoot: run.workspaceRoot,
    runtimeProfileId: run.runtimeProfileId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.error === undefined ? {} : { error: run.error }),
    pauseRequested: run.pauseRequested,
    cancelRequested: run.cancelRequested,
  };
}

function redactRunSummary(item: RunSummary): RunSummary {
  return item.error === undefined
    ? item
    : { ...item, error: redactText(item.error) };
}

function redactStepRun(item: StepRun): StepRun {
  return {
    ...item,
    ...(item.resultText === undefined
      ? {}
      : { resultText: redactText(item.resultText) }),
    ...(item.error === undefined ? {} : { error: redactText(item.error) }),
  };
}

function redactApproval(item: ApprovalRequest): ApprovalRequest {
  return {
    ...item,
    message: redactText(item.message),
    ...(item.response === undefined
      ? {}
      : { response: redactText(item.response) }),
  };
}

function redactHistory(
  item: WorkflowHistoryEntry,
): WorkflowHistoryEntry {
  return { ...item, message: redactText(item.message) };
}

function redactEventRecord(
  record: RuntimeEventRecord,
): RuntimeEventRecord {
  return { ...record, event: redactRuntimeEvent(record.event) };
}

function redactState(state: RunState): RunState {
  return {
    run: redactRunSummary(state.run),
    steps: state.steps.map(redactStepRun),
    approvals: state.approvals.map(redactApproval),
    history: state.history.map(redactHistory),
  };
}

export function createRunService(deps: RunServiceDeps): RunService {
  async function storeRead<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new RunServiceError("persistence_error");
    }
  }

  async function requireRun(id: string): Promise<WorkflowRun> {
    const run = await storeRead(() => deps.persistence.getRun(id));

    if (run === null) {
      throw new RunServiceError("run_not_found");
    }

    return run;
  }

  async function projectNameFor(
    run: WorkflowRun,
  ): Promise<string | undefined> {
    const projectId = run.projectId;

    if (projectId === undefined) {
      return undefined;
    }

    const project = await storeRead(() =>
      deps.persistence.getProject(projectId),
    );

    return project?.name;
  }

  async function stateFor(run: WorkflowRun): Promise<RunState> {
    const [steps, approvals, history, projectName] = await Promise.all([
      storeRead(() => deps.persistence.listStepRuns(run.id)),
      storeRead(() => deps.persistence.listApprovals(run.id)),
      storeRead(() => deps.persistence.listHistory(run.id)),
      projectNameFor(run),
    ]);

    return {
      run: summary(run, projectName),
      steps,
      approvals,
      history,
    };
  }

  async function getState(id: string): Promise<RunState> {
    return redactState(await stateFor(await requireRun(id)));
  }

  async function getRun(id: string): Promise<RunDetail> {
    const state = await getState(id);
    const events = (
      await storeRead(() => deps.persistence.listRuntimeEvents(id))
    ).map(redactEventRecord);

    return { ...state, events };
  }

  async function listRuntimeEvents(
    id: string,
    fromIndex: number,
  ): Promise<readonly RuntimeEventRecord[]> {
    await requireRun(id);
    const events = await storeRead(() =>
      deps.persistence.listRuntimeEvents(id),
    );
    const start = Number.isInteger(fromIndex) && fromIndex > 0 ? fromIndex : 0;

    return events.slice(start).map(redactEventRecord);
  }

  async function listProjects(): Promise<readonly Project[]> {
    return storeRead(() => deps.persistence.listProjects());
  }

  async function registerProject(input: unknown): Promise<Project> {
    const parsed = parseProjectInput(input);

    try {
      return await registerProjectRecord({
        ...parsed,
        store: deps.persistence,
      });
    } catch (error) {
      if (error instanceof ProjectRegistrationError) {
        throw registrationFailure(error);
      }

      throw new RunServiceError("persistence_error");
    }
  }

  async function listWorkflows(): Promise<WorkflowCatalogResponse> {
    const definitions = await storeRead(() =>
      deps.persistence.listWorkflowDefinitions(),
    );
    const versions: WorkflowVersion[] = [];

    for (const definition of definitions) {
      versions.push(
        ...(await storeRead(() =>
          deps.persistence.listWorkflowVersions(definition.id),
        )),
      );
    }

    return { definitions, versions };
  }

  async function listSkills(): Promise<SkillCatalogResponse> {
    const definitions = await storeRead(() =>
      deps.persistence.listSkillDefinitions(),
    );
    const versions: SkillCatalogResponse["versions"][number][] = [];

    for (const definition of definitions) {
      const published = await storeRead(() =>
        deps.persistence.listSkillVersions(definition.id),
      );
      versions.push(...published.map(skillVersionSummary));
    }

    return { definitions, versions };
  }

  async function startRun(input: unknown): Promise<RunDetail> {
    const { projectId, workflowVersionId } = parseStartInput(input);
    const project = await storeRead(() =>
      deps.persistence.getProject(projectId),
    );

    if (project === null) {
      throw new RunServiceError("project_not_found");
    }

    if (!project.workflowVersionIds.includes(workflowVersionId)) {
      throw new RunServiceError("workflow_version_not_selected");
    }

    const version = await storeRead(() =>
      deps.persistence.getWorkflowVersion(workflowVersionId),
    );

    if (version === null) {
      throw new RunServiceError("workflow_version_not_found");
    }

    let plan;
    try {
      plan = await projectWorkflowVersionWithSkills(version, deps.persistence);
    } catch (error) {
      if (error instanceof SkillDeliveryError) {
        throw new RunServiceError(
          error.code === "skill_version_not_found"
            ? "skill_version_missing"
            : "workflow_version_invalid",
        );
      }

      throw new RunServiceError("persistence_error");
    }

    const profileId = project.defaultRuntimeProfileId;

    if (profileId === undefined) {
      throw new RunServiceError("runtime_profile_required");
    }

    const profile = await storeRead(() =>
      deps.persistence.getRuntimeProfile(profileId),
    );

    if (profile === null) {
      throw new RunServiceError("runtime_profile_not_found");
    }

    if (validateRuntimeProfile(profile).length > 0) {
      throw new RunServiceError("runtime_profile_invalid");
    }

    let credentialStatus: CredentialStatus;

    try {
      credentialStatus = await deps.credentials.status(profile.credentialRef);
    } catch {
      throw new RunServiceError("credential_missing");
    }

    if (credentialStatus === "missing") {
      throw new RunServiceError("credential_missing");
    }

    let runtime: AgentRuntime;

    try {
      runtime = await deps.createRuntime({
        profile,
        workspaceRoot: project.workspaceRoot,
      });
    } catch {
      throw new RunServiceError("runtime_unavailable");
    }

    let handle;

    try {
      handle = await deps.engine.startRun(plan, {
        workspaceRoot: project.workspaceRoot,
        runtimeProfileId: profile.id,
        projectId: project.id,
        workflowVersionId: version.id,
        runtime,
      });
    } catch (error) {
      await closeRuntime(runtime);

      if (
        error instanceof WorkflowRunStateError &&
        error.operation === "start"
      ) {
        throw new RunServiceError("run_busy");
      }

      throw error;
    }

    void handle.completion.then(
      () => closeRuntime(runtime),
      () => closeRuntime(runtime),
    );

    return getRun(handle.runId);
  }

  async function listRuns(): Promise<readonly RunSummary[]> {
    const [runs, projects] = await Promise.all([
      storeRead(() => deps.persistence.listRuns()),
      storeRead(() => deps.persistence.listProjects()),
    ]);
    const names = new Map(
      projects.map((project) => [project.id, project.name]),
    );

    return runs.map((run) =>
      redactRunSummary(
        summary(
          run,
          run.projectId === undefined ? undefined : names.get(run.projectId),
        ),
      ),
    );
  }

  async function pauseRun(id: string): Promise<RunDetail> {
    const run = await requireRun(id);

    if (run.status !== "running") {
      throw new RunServiceError("run_state_conflict");
    }

    void deps.engine.pauseRun(id).catch(() => {});
    return getRun(id);
  }

  async function continueRun(id: string): Promise<RunDetail> {
    const run = await requireRun(id);

    if (run.status !== "paused") {
      throw new RunServiceError("run_state_conflict");
    }

    void deps.engine.continueRun(id).catch(() => {});
    return getRun(id);
  }

  async function cancelRun(id: string): Promise<RunDetail> {
    const run = await requireRun(id);

    if (
      run.status !== "running" &&
      run.status !== "paused" &&
      run.status !== "waiting_approval"
    ) {
      throw new RunServiceError("run_state_conflict");
    }

    const request = deps.engine.cancelRun(id);

    if (run.status === "paused" || run.status === "waiting_approval") {
      await request.catch(() => {});
    } else {
      void request.catch(() => {});
    }

    return getRun(id);
  }

  async function answerApproval(
    id: string,
    approvalId: string,
    input: unknown,
  ): Promise<RunDetail> {
    const run = await requireRun(id);
    const approval = await storeRead(() =>
      deps.persistence.getApproval(approvalId),
    );

    if (approval === null || approval.runId !== id) {
      throw new RunServiceError("approval_not_found");
    }

    if (approval.status !== "pending") {
      throw new RunServiceError("approval_already_resolved");
    }

    const stepRuns = await storeRead(() =>
      deps.persistence.listStepRuns(id),
    );

    if (!stepRuns.some((step) => step.id === approval.stepRunId)) {
      throw new RunServiceError("approval_not_found");
    }

    if (run.status !== "waiting_approval") {
      throw new RunServiceError("run_state_conflict");
    }

    const decision = parseDecision(input);

    try {
      await deps.engine.answerApproval(id, approvalId, decision);
    } catch (error) {
      if (error instanceof WorkflowApprovalError) {
        switch (error.reason) {
          case "not_found":
            throw new RunServiceError("approval_not_found");
          case "already_resolved":
            throw new RunServiceError("approval_already_resolved");
          case "run_not_waiting":
            throw new RunServiceError("run_state_conflict");
        }
      }

      if (error instanceof WorkflowRunStateError) {
        throw new RunServiceError("run_state_conflict");
      }

      throw error;
    }

    return getRun(id);
  }

  return {
    listProjects,
    registerProject,
    listWorkflows,
    listSkills,
    startRun,
    listRuns,
    getRun,
    getState,
    listRuntimeEvents,
    pauseRun,
    continueRun,
    cancelRun,
    answerApproval,
  };
}
