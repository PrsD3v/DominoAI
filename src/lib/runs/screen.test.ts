import { describe, expect, it } from "vitest";
import type { Project } from "../../types/persistence";
import type {
  ApprovalRequest,
  RuntimeEventRecord,
  StepRun,
  WorkflowHistoryEntry,
} from "../../types/workflow";
import type {
  RunDetail,
  RunSummary,
  SkillCatalogResponse,
  WorkflowCatalogResponse,
} from "../../types/run-api";
import { RUN_ERROR_CODES } from "../../types/run-api";
import type { RuntimeProfile } from "../../types/runtime-settings";
import type {
  WorkflowDefinition,
  WorkflowVersion,
} from "../../types/workflow-definition";
import {
  apiApprovalPath,
  apiRunActionPath,
  apiRunPath,
  appendRunEvents,
  canAnswerApproval,
  canCancel,
  canContinue,
  canPause,
  elapsedMs,
  formatDuration,
  formatTimestamp,
  initialWorkflowVersionId,
  isRunSummary,
  isTerminalRunStatus,
  lastRunByWorkflow,
  mergeRunState,
  narrowProjectListResponse,
  narrowRunDetail,
  narrowRunListResponse,
  narrowRunResponse,
  narrowSkillCatalogResponse,
  narrowWorkflowCatalogResponse,
  pageRunPath,
  parseRunFailure,
  parseRunFieldErrors,
  parseRunStreamFrame,
  pendingApprovals,
  profileLabel,
  runDurationMs,
  runWorkflowLabel,
  shortRunId,
  sortRunsNewestFirst,
  stepKeyForApproval,
  workflowLabel,
  workflowVersionsForProject,
} from "./screen";

const AT = "2026-11-08T10:00:00.000Z";
const LATER = "2026-11-08T10:01:05.000Z";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Demo",
    workspaceRoot: "/workspace/demo",
    configuration: {},
    workflowVersionIds: ["version-2"],
    skillVersionIds: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    projectId: "project-1",
    projectName: "Demo",
    workflowId: "workflow-1",
    workflowVersion: 1,
    workflowVersionId: "version-1",
    status: "running",
    workspaceRoot: "/workspace/demo",
    runtimeProfileId: "profile-1",
    createdAt: AT,
    updatedAt: AT,
    startedAt: AT,
    pauseRequested: false,
    cancelRequested: false,
    ...overrides,
  };
}

function step(overrides: Partial<StepRun> = {}): StepRun {
  return {
    id: "step-run-1",
    runId: "run-1",
    stepKey: "plan",
    stepIndex: 0,
    status: "running",
    attempts: 1,
    maxAttempts: 2,
    createdAt: AT,
    updatedAt: AT,
    startedAt: AT,
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    status: "pending",
    message: "Approve this step?",
    requestedAt: AT,
    ...overrides,
  };
}

function history(overrides: Partial<WorkflowHistoryEntry> = {}): WorkflowHistoryEntry {
  return {
    id: "history-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    kind: "step_started",
    message: "Step started",
    createdAt: AT,
    ...overrides,
  };
}

function event(overrides: Partial<RuntimeEventRecord> = {}): RuntimeEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    stepRunId: "step-run-1",
    event: { type: "assistant_text_delta", text: "hello" },
    recordedAt: AT,
    ...overrides,
  };
}

function detail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    run: run(),
    steps: [step()],
    approvals: [approval()],
    history: [history()],
    events: [event()],
    ...overrides,
  };
}

const definition: WorkflowDefinition = { id: "workflow-1", name: "Delivery" };
const version: WorkflowVersion = {
  id: "version-1",
  definitionId: "workflow-1",
  version: 1,
  steps: [{ key: "plan", skillVersionIds: ["skill-version-1"] }],
  approvalPoints: [{ key: "approve-plan", message: "Approve plan" }],
  errorPolicy: "fail-run",
  publishedAt: AT,
};

function catalog(): WorkflowCatalogResponse {
  return {
    definitions: [
      definition,
      { id: "workflow-2", name: "Review" },
    ],
    versions: [
      version,
      { ...version, id: "version-2", version: 2 },
    ],
  };
}

function skills(): SkillCatalogResponse {
  return {
    definitions: [{ id: "skill-1", name: "Planner" }],
    versions: [
      {
        id: "skill-version-1",
        skillDefinitionId: "skill-1",
        version: 1,
        publishedAt: AT,
      },
    ],
  };
}

function profile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: "profile-1",
    label: "Default",
    adapterId: "reasonix",
    providerName: "deepseek",
    model: "deepseek-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    credentialRef: {
      kind: "reasonix-env",
      providerName: "deepseek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe("failure parsing", () => {
  it("maps a network failure and known codes", () => {
    expect(parseRunFailure(0, null)).toBe("network");
    expect(
      parseRunFailure(409, { error: { code: "run_busy", message: "busy" } }),
    ).toBe("run_busy");
  });

  it("falls back to unexpected for unknown or malformed bodies", () => {
    expect(parseRunFailure(500, { error: { code: "nope" } })).toBe("unexpected");
    expect(parseRunFailure(500, null)).toBe("unexpected");
  });

  it("keeps every declared run error code", () => {
    for (const code of RUN_ERROR_CODES) {
      expect(
        parseRunFailure(400, { error: { code, message: "failure" } }),
      ).toBe(code);
    }
  });

  it("reads field errors and ignores malformed entries", () => {
    expect(
      parseRunFieldErrors({
        error: {
          code: "invalid_request",
          fields: [
            { field: "name", message: "required" },
            { field: "body" },
            "nope",
          ],
        },
      }),
    ).toEqual([{ field: "name", message: "required" }]);
    expect(parseRunFieldErrors(null)).toEqual([]);
  });
});

describe("response narrowing", () => {
  it("accepts a complete run detail", () => {
    expect(narrowRunDetail(detail())?.run.id).toBe("run-1");
    expect(narrowRunResponse({ run: detail() })?.events).toHaveLength(1);
  });

  it("rejects malformed run details", () => {
    expect(narrowRunDetail({ ...detail(), events: "no" })).toBeNull();
    expect(
      narrowRunDetail({
        ...detail(),
        steps: [{ ...step(), status: "unknown" }],
      }),
    ).toBeNull();
    expect(
      narrowRunDetail({
        ...detail(),
        events: [{ ...event(), event: { type: "other", text: "x" } }],
      }),
    ).toBeNull();
  });

  it("narrows lists and catalogs", () => {
    expect(narrowRunListResponse({ runs: [run()] })?.runs).toHaveLength(1);
    expect(narrowRunListResponse({ runs: [{ id: 1 }] })).toBeNull();
    expect(
      narrowProjectListResponse({ projects: [project()] }),
    ).toHaveLength(1);
    expect(narrowWorkflowCatalogResponse(catalog())?.versions).toHaveLength(2);
    expect(narrowSkillCatalogResponse(skills())?.versions).toHaveLength(1);
    expect(
      narrowWorkflowCatalogResponse({
        definitions: [definition],
        versions: [{ ...version, steps: [] }],
      }),
    ).toBeNull();
  });

  it("validates run summaries", () => {
    expect(isRunSummary(run())).toBe(true);
    expect(isRunSummary({ ...run(), status: "unknown" })).toBe(false);
    expect(isRunSummary({ ...run(), createdAt: "not-a-date" })).toBe(false);
  });
});

describe("stream frames", () => {
  it("parses snapshot, state, and event frames", () => {
    const snapshot = parseRunStreamFrame("snapshot", JSON.stringify(detail()));
    expect(snapshot.kind).toBe("snapshot");

    const state = parseRunStreamFrame("state", JSON.stringify({
      run: run(),
      steps: [step()],
      approvals: [approval()],
      history: [history()],
    }));
    expect(state.kind).toBe("state");

    const record = parseRunStreamFrame("event", JSON.stringify(event()));
    expect(record.kind).toBe("event");
  });

  it("ignores malformed or unknown frames", () => {
    expect(parseRunStreamFrame("snapshot", "{").kind).toBe("ignored");
    expect(parseRunStreamFrame("state", JSON.stringify({ run: {} })).kind).toBe(
      "ignored",
    );
    expect(parseRunStreamFrame("event", JSON.stringify({ id: "x" })).kind).toBe(
      "ignored",
    );
    expect(parseRunStreamFrame("other", JSON.stringify(event())).kind).toBe(
      "ignored",
    );
  });
});

describe("control availability", () => {
  it("follows run status", () => {
    expect(canPause("running")).toBe(true);
    expect(canPause("paused")).toBe(false);
    expect(canContinue("paused")).toBe(true);
    expect(canContinue("running")).toBe(false);
    expect(canCancel("waiting_approval")).toBe(true);
    expect(canCancel("completed")).toBe(false);
    expect(canAnswerApproval("waiting_approval")).toBe(true);
    expect(canAnswerApproval("paused")).toBe(false);
  });

  it("detects terminal states", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
    expect(isTerminalRunStatus("interrupted")).toBe(true);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("waiting_approval")).toBe(false);
  });
});

describe("selection helpers", () => {
  it("returns pending approvals only", () => {
    expect(
      pendingApprovals([
        approval(),
        approval({ id: "approval-2", status: "approved" }),
      ]).map((entry) => entry.id),
    ).toEqual(["approval-1"]);
  });

  it("resolves an approval's step key and falls back to the step run id", () => {
    expect(stepKeyForApproval([step()], approval())).toBe("plan");
    expect(
      stepKeyForApproval([], approval({ stepRunId: "missing" })),
    ).toBe("missing");
  });

  it("maps project selections to published versions in project order", () => {
    expect(
      workflowVersionsForProject(
        project({ workflowVersionIds: ["version-2", "missing"] }),
        catalog(),
      ).map((entry) => entry.id),
    ).toEqual(["version-2"]);
    expect(
      initialWorkflowVersionId(
        project({ workflowVersionIds: ["version-2"] }),
        catalog(),
      ),
    ).toBe("version-2");
    expect(
      initialWorkflowVersionId(
        project({ workflowVersionIds: ["missing"] }),
        catalog(),
      ),
    ).toBeNull();
  });

  it("labels a run's workflow and duration", () => {
    expect(runWorkflowLabel(run({ workflowVersionId: "version-2" }), catalog())).toBe(
      "Delivery v2",
    );
    expect(
      runWorkflowLabel(
        run({ workflowId: "missing", workflowVersion: 3, workflowVersionId: "gone" }),
        catalog(),
      ),
    ).toBe("missing v3");
    expect(runDurationMs(run(), Date.parse(LATER))).toBe(65_000);
    expect(runDurationMs(run({ startedAt: undefined }), Date.parse(LATER))).toBe(
      65_000,
    );
  });

  it("labels a workflow version and a profile", () => {
    expect(workflowLabel(catalog(), "version-2", "fallback")).toBe(
      "Delivery v2",
    );
    expect(workflowLabel(catalog(), "missing", "fallback")).toBe("fallback");
    expect(profileLabel([profile()], "profile-1")).toBe("Default");
    expect(profileLabel([profile()], "missing")).toBeNull();
    expect(profileLabel([profile()], undefined)).toBeNull();
  });

  it("sorts runs newest first and finds the last run for a workflow", () => {
    const runs = [
      run({ id: "a", createdAt: AT }),
      run({ id: "b", createdAt: LATER }),
      run({ id: "c", workflowId: "workflow-2", createdAt: LATER }),
    ];

    expect(sortRunsNewestFirst(runs).map((entry) => entry.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(lastRunByWorkflow(runs, "workflow-1")?.id).toBe("b");
    expect(lastRunByWorkflow(runs, "missing")).toBeNull();
  });
});

describe("stream application", () => {
  it("keeps events when a state frame replaces run state", () => {
    const next = mergeRunState(detail(), {
      run: run({ status: "completed" }),
      steps: [step({ status: "completed" })],
      approvals: [],
      history: [],
    });

    expect(next.run.status).toBe("completed");
    expect(next.events).toHaveLength(1);
  });

  it("appends events once in arrival order", () => {
    const base = detail();
    const appended = appendRunEvents(base, [
      event({ id: "event-2" }),
      event({ id: "event-1" }),
      event({ id: "event-3" }),
    ]);

    expect(appended.events.map((record) => record.id)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
    expect(appendRunEvents(appended, [event()])).toBe(appended);
  });
});

describe("formatting and paths", () => {
  it("computes elapsed time only from valid timestamps", () => {
    expect(elapsedMs(AT, undefined, Date.parse(LATER))).toBe(65_000);
    expect(elapsedMs(AT, LATER, Date.parse(LATER))).toBe(65_000);
    expect(elapsedMs(undefined, undefined, 0)).toBeNull();
    expect(elapsedMs("bad", undefined, 0)).toBeNull();
    expect(elapsedMs(AT, "bad", 0)).toBeNull();
  });

  it("formats durations without localized words", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_665_000)).toBe("1:01:05");
  });

  it("formats timestamps and short ids deterministically", () => {
    expect(formatTimestamp("en", "bad")).toBe("—");
    expect(formatTimestamp("en", AT)).not.toBe("—");
    expect(formatTimestamp("fa", AT)).not.toBe("—");
    expect(shortRunId("run-1")).toBe("run-1");
    expect(shortRunId("1234567890123")).toBe("12345678…");
  });

  it("encodes ids in API and page paths", () => {
    expect(apiRunPath("a/b")).toBe("/api/runs/a%2Fb");
    expect(apiRunActionPath("a b", "pause")).toBe("/api/runs/a%20b/pause");
    expect(apiApprovalPath("run", "a/b")).toBe(
      "/api/runs/run/approvals/a%2Fb",
    );
    expect(pageRunPath("fa", "run-1")).toBe("/fa/runs/run-1");
  });
});
