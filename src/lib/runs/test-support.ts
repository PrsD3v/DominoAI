import type { Project } from "../../types/persistence";
import type { RunDetail, RunSummary } from "../../types/run-api";
import type { RunService } from "./service";

const AT = "2026-11-07T00:00:00.000Z";

export const SAMPLE_PROJECT: Project = {
  id: "project-1",
  name: "Demo",
  workspaceRoot: "/workspace/demo",
  configuration: {},
  workflowVersionIds: ["workflow-version-1"],
  skillVersionIds: ["skill-version-1"],
  createdAt: AT,
  updatedAt: AT,
};

export const SAMPLE_RUN: RunSummary = {
  id: "run-1",
  projectId: "project-1",
  projectName: "Demo",
  workflowId: "workflow-1",
  workflowVersion: 1,
  workflowVersionId: "workflow-version-1",
  status: "completed",
  workspaceRoot: "/workspace/demo",
  runtimeProfileId: "profile-1",
  createdAt: AT,
  updatedAt: AT,
  startedAt: AT,
  finishedAt: AT,
  pauseRequested: false,
  cancelRequested: false,
};

export const SAMPLE_DETAIL: RunDetail = {
  run: SAMPLE_RUN,
  steps: [],
  approvals: [],
  history: [],
  events: [],
};

/** Build a run service for route tests; unset methods fail loudly. */
export function runServiceWith(
  overrides: Partial<RunService>,
): RunService {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected run service call");
  };

  return {
    listProjects: unexpected,
    registerProject: unexpected,
    listWorkflows: unexpected,
    listSkills: unexpected,
    startRun: unexpected,
    listRuns: unexpected,
    getRun: unexpected,
    getState: unexpected,
    listRuntimeEvents: unexpected,
    pauseRun: unexpected,
    continueRun: unexpected,
    cancelRun: unexpected,
    answerApproval: unexpected,
    ...overrides,
  };
}
