# Feature: Run API, approvals, and live event stream

**From build-plan:** feature 14A
**Build attempt:** 1
**Branch:** `feature/run-api-approvals-and-live-event-stream`
**Status:** verified

## Goal

Make a registered project runnable from the server. An operator can start a
published workflow version against the project's canonical workspace with its
default runtime profile, list and read runs, pause, continue, cancel, answer an
approval before its gated step executes, and follow retained workflow and
runtime events over a server-sent event stream. This item delivers the engine
approval semantics, the server service, and the HTTP surface. Dashboard screens
are feature 14B.

## In scope

- Approval waiting and answering in the workflow engine:
  - a step may carry an optional approval point from its published workflow
    version;
  - the engine records a pending `ApprovalRequest`, moves the run to
    `waiting_approval`, and starts no runtime session or prompt until the
    approval is answered;
  - approving resumes the gated step;
  - **rejecting cancels the run** and leaves the gated step unexecuted;
  - cancelling a run while it waits for approval marks its pending approval
    `cancelled`;
  - pause and continue are refused while the run waits for approval.
- Run binding to a project and a published workflow version, persisted with the
  run, plus the project id and workflow version id in the run record.
- A run orchestration service that resolves the project, its selected workflow
  version, its default runtime profile, and the step skill versions; projects
  the workflow into an execution plan; creates a Reasonix ACP runtime for that
  run; and owns start, list, detail, pause, continue, cancel, and answer
  operations.
- A server-side event stream over SSE. The transport and its reconnect behavior
  are decided in this item.
- HTTP APIs for:
  - listing and registering projects;
  - reading published workflow definitions and versions for selection;
  - reading skill definition/version metadata for selection;
  - listing and starting runs and reading one run's detail;
  - requesting pause, continue, and cancel;
  - answering one approval.
- Startup reconciliation for runs left active by a stopped process, including
  cancelling their pending approvals.
- Typed, non-secret service and HTTP errors with stable codes.

## Out of scope

- Any dashboard page, form, navigation shell, theme control, or translation
  catalog entry. Feature 14B owns those.
- Moving or embedding the existing Settings screen; feature 14B owns the
  dashboard shell and the Settings fold-in.
- Publishing, editing, or deleting workflow, skill, project, runtime profile, or
  run records. Feature 14A only starts runs from already published records.
- Concurrent runs. The engine and service keep the existing one-active-run
  rule; a second start returns a typed conflict.
- Resuming a run after a process restart, retrying an interrupted step, or
  auto-continuing an interrupted run.
- Loopback binding, cross-origin mutation protection, log redaction, and
  approval-identifier hardening beyond binding an approval to its run and step.
  Feature 15 owns those.
- Live Reasonix proof. Feature 3B has no disposable credential and no writable
  Reasonix home; every automated test in this item uses the fake runtime.
- Any new dependency, form library, ORM, state manager, or event-bus package.

## Build loop

`workflow.stepReview` is `feature`, so implement all steps, then present one
review packet. `workflow.checkpointCommits` is `disabled`; do not create
checkpoint commits. `/complete` creates the final feature commit and offers the
configured local squash-merge landing. Work one small step at a time and leave
the project building after each step.

## Build steps

- [x] 1. **Extend the execution and run contracts, including migration 3.**
  - Add `ExecutionStep.approval?: { key: string; message: string }` to
    `src/types/workflow.ts` and validate it in
    `src/lib/workflow/execution-plan.ts`: when present it is an object with
    non-empty `key` and `message`, and no other keys are accepted.
  - Add optional `projectId?: string` and `workflowVersionId?: string` to
    `WorkflowRun`.
  - Add history kinds `approval_requested`, `approval_approved`,
    `approval_rejected`, and `approval_cancelled` to the union, the SQLite
    allowed-kind set, and every exhaustive switch that handles history.
  - Add SQLite migration version 3 with two nullable columns on
    `workflow_runs`: `project_id TEXT` and `workflow_version_id TEXT`. Bump
    `SCHEMA_VERSION` to 3. Existing version-1/2 rows decode with both fields
    absent. `decodeRun` accepts null for both and rejects a non-string value.
  - Keep `createRun`/`updateRun` writing both columns. The in-memory store
    needs no schema change because it clones whole records.
  - Do not make either field required; tests and existing runs without a
    project must keep working.
  - **Done when:** focused `execution-plan` and SQLite tests prove approval
    validation, migration from version 2 with an existing run, round-trip of
    both new run fields, null decoding, and the new history kinds. Existing
    engine and SQLite tests still pass.

- [x] 2. **Add approval waiting and answering to the engine.**
  - Extend `StartWorkflowRunOptions` with optional `projectId`,
    `workflowVersionId`, and `runtime`; extend `CreateWorkflowEngineOptions` so
    `runtime` is optional. A start uses `StartWorkflowRunOptions.runtime` and
    falls back to the engine's runtime only for existing callers. If neither
    exists, `startRun` fails before writing anything.
  - Persist `projectId` and `workflowVersionId` from the start options on the
    new run.
  - Add `answerApproval(runId, approvalId, decision)` to `WorkflowEngine`,
    where `decision` is `"approve" | "reject"`.
  - Before executing a step whose `approval` is present, look for an existing
    approval for that `stepRunId`: reuse a pending one, skip raising when an
    approved one exists, and otherwise create a new `ApprovalRequest` with
    status `pending` and the definition's message. Set the run to
    `waiting_approval`, append `approval_requested` naming the step, and await
    the decision. No `AgentRuntime.createSession` call may happen first.
  - On approve: set the approval to `approved` with `resolvedAt`, restore the
    run to `running`, append `approval_approved`, and execute the step.
  - On reject: set the approval to `rejected` with `resolvedAt`, append
    `approval_rejected`, and cancel the run with the existing cancel path. The
    gated step stays `pending`; the run ends `cancelled`, not `failed`.
  - `cancelRun` accepts `waiting_approval`, marks every pending approval
    `cancelled` with `resolvedAt`, appends `approval_cancelled` per approval,
    and then records `run_cancelled`. `pauseRun` and `continueRun` reject
    `waiting_approval` with `WorkflowRunStateError`.
  - Add a typed `WorkflowApprovalError` with reasons `not_found`,
    `already_resolved`, and `run_not_waiting`. An approval whose `runId` differs
    from the requested run is reported as `not_found`. Extend
    `WorkflowRunOperation` with `"answer_approval"`.
  - A decision resolves the waiting executor exactly once. A second decision,
    a decision after cancellation, or a decision for a terminal run fails
    without changing records.
  - **Done when:** engine tests with the fake runtime and in-memory persistence
    prove: no session/prompt before approval; approve executes the gated step;
    reject cancels with the step pending and no session; cancel while waiting
    cancels the approval; duplicate and wrong-run answers fail; pause and
    continue are refused while waiting; no approval is duplicated on the
    approved path; and the run's `projectId`/`workflowVersionId` are persisted.

- [x] 3. **Carry approval points through skill delivery and startup
  reconciliation.**
  - Extend `projectWorkflowVersionWithSkills` so each projected step copies
    the approval point named by `step.approvalPointKey` into
    `ExecutionStep.approval` (`key` and `message` from
    `WorkflowVersion.approvalPoints`). A step without an approval point gets no
    `approval` field. The workflow version is already validated, so a dangling
    reference remains an `invalid_workflow_version` failure.
  - Extend `reconcileInterruptedRuns`: for each run it marks `interrupted`, list
    its approvals and set every `pending` approval to `cancelled` with the
    reconciliation timestamp, then append `approval_cancelled` with the
    approval's `stepRunId` before appending `run_interrupted`.
  - **Done when:** focused tests prove ordered approval messages in the
    projected plan, no approval field for unguarded steps, and reconciliation
    cancelling pending approvals while leaving resolved approvals untouched.
    A second reconciliation call still writes nothing.

- [x] 4. **Build the run orchestration service.**
  - Add `src/lib/runs/service.ts` with a `RunService` over the existing
    `WorkflowExecutionPersistence`, `ProjectPersistence`,
    `PublishedDefinitionPersistence`, and `RuntimeProfilePersistence`, plus a
    `CredentialStore`, a runtime factory, `now`, and `newId`. No provider,
    model, or credential value is stored by the service.
  - `startRun({ projectId, workflowVersionId })` validates exactly those two
    fields, then in order:
    1. load the project (`project_not_found`);
    2. require the version id to be one of the project's selected workflow
       versions (`workflow_version_not_selected`);
    3. load the version (`workflow_version_not_found`) and project it with
       skill delivery (`workflow_version_invalid`, `skill_version_missing`);
    4. require `project.defaultRuntimeProfileId` (`runtime_profile_required`),
       load it (`runtime_profile_not_found`), and validate it
       (`runtime_profile_invalid`);
    5. check credential presence only; a `missing` status returns
       `credential_missing` without creating a run;
    6. create the ACP runtime and start the engine; if engine start reports
       another active run, close the runtime and return `run_busy`.
  - The runnable plan comes from `projectWorkflowVersionWithSkills`; the
    project's workspace root and profile id go to `startRun`. Pass the run's
    runtime through `StartWorkflowRunOptions.runtime`. Close that runtime when
    `handle.completion` settles, and also when start fails after creation.
  - `listRuns()` returns summaries in persistence order with the project name
    resolved from the project store (a missing project leaves the name absent).
    `getRun(id)` returns the run, steps, approvals, history, and retained
    runtime events, or `run_not_found`.
  - `pause(id)`, `continue(id)`, and `cancel(id)` request the engine operation
    and return the refreshed detail without awaiting run completion. Pause and
    cancel during a step may therefore return with `pauseRequested` or
    `cancelRequested` true; the stream reports the eventual state. A state
    error becomes `run_state_conflict`.
  - `answerApproval(id, approvalId, { decision })` accepts only
    `"approve" | "reject"`, calls the engine, and returns the refreshed detail
    without awaiting completion. Map typed approval failures to
    `approval_not_found`, `approval_already_resolved`, and
    `run_state_conflict`.
  - Add `src/lib/runs/runtime.ts` with the Reasonix runtime factory and the
    process-wide service singleton. Resolve the database, Reasonix home, and
    Reasonix binary with `resolveSettingsPaths`. Open one store, run
    `reconcileInterruptedRuns`, and create the engine with `randomUUID` and
    ISO-8601 `now`.
  - Runtime launch contract:
    - command: configured Reasonix binary;
    - args: `acp --model <providerName>/<model> --permission-mode acceptEdits
      --workspace-only`;
    - cwd: the project's canonical workspace root;
    - env: the current environment plus `REASONIX_HOME` set to the configured
      Reasonix home;
    - request timeout: `DEFAULT_RUN_REQUEST_TIMEOUT_MS`, 30 minutes, injectable
      for tests. This is longer than the 30-second transport default because a
      real workflow step can exceed it.
  - `acceptEdits` is the narrowest installed mode that lets a workflow edit
    files without the unverified interactive approval flow; `--workspace-only`
    confines writes to the session cwd that the engine already checks. Neither
    claim is a live verification.
  - **Done when:** service tests use a temporary SQLite database, a fake
    runtime, and a fake credential store. They prove the happy path, exact
    runtime launch args, runtime close on completion and on start failure, each
    typed validation error, `run_busy`, pause/continue/cancel, approval
    approve/reject/cancel, missing-event and empty-list behavior, and that no
    credential value appears in any returned record.

- [x] 5. **Add the Projects, Workflows, and Skills APIs.**
  - Add `src/types/run-api.ts` with stable error codes, response envelopes, and
    narrow client-side guards. Reuse the existing `{ error: { code, message,
    fields? } }` envelope shape from the settings API; do not import
    `SettingsError` into the run service.
  - Add `src/lib/runs/http.ts` mapping each code to a status, reading a JSON
    object body, requiring `application/json`, and rethrowing unexpected
    errors.
  - Add `GET /api/projects` returning `{ projects }` in store order and
    `POST /api/projects` registering one project through `registerProject`.
    Accept exactly `name`, `workspaceRoot`, `configuration`,
    `defaultRuntimeProfileId`, `workflowVersionIds`, and `skillVersionIds`, all
    optional except `name` and `workspaceRoot`. Generate ids and timestamps on
    the server. Return 201 `{ project }`.
  - Map registration reasons: invalid name/configuration/profile id or duplicate
    selection to `invalid_request` with a field; missing, non-directory, or
    inaccessible root to `workspace_root_invalid`; duplicate root to
    `workspace_root_registered`; unknown profile to `runtime_profile_not_found`;
    unknown workflow/skill version to the matching not-found code; persistence
    failures to `persistence_error`.
  - Add `GET /api/workflows` returning `{ definitions, versions }` with every
    published version, including steps and approval points. Add
    `GET /api/skills` returning `{ definitions, versions }` where version
    metadata omits `content` entirely.
  - Bypass the locale proxy as the existing `/api` routes already do. Use
    `connection()` for these non-streaming handlers.
  - **Done when:** route-handler tests prove success, empty collections, each
    mapped error, rejected extra fields, rejected non-JSON bodies, and that no
    skill content, credential, or secret-like field is returned.

- [x] 6. **Add the Run APIs.**
  - Add `GET /api/runs` (`{ runs }`), `POST /api/runs` (201 `{ run }`),
    `GET /api/runs/[id]` (`{ run }`), and POST routes
    `/api/runs/[id]/pause`, `/continue`, and `/cancel` (200 `{ run }`).
  - Add `POST /api/runs/[id]/approvals/[approvalId]` accepting exactly
    `{ decision: "approve" | "reject" }` and returning `{ run }`.
  - Map statuses: invalid input 400, unknown project/version/run/approval 404,
    state conflicts, busy runs, missing profile, missing credential, missing
    skill, and unselected version 409, unavailable runtime 503, persistence
    failure 500. Unexpected errors are not converted into success.
  - Responses contain no credential, environment value, provider key, or raw
    runtime stderr. The recorded run `error` and step `error` fields may carry
    the runtime's own failure message, which the product requires the dashboard
    to show unchanged.
  - **Done when:** handler tests with an injected fake service prove every
    method, status, envelope, and validation failure, including a start that
    returns before completion and controls that do not await it.

- [x] 7. **Add the SSE event stream and finish verification.**
  - Add `src/lib/runs/stream.ts` with a stream builder that takes the service,
    run id, abort signal, poll interval (750 ms), heartbeat interval (15 s),
    and injectable timer/clock seams. It emits:
    - one initial `retry: 2000` line;
    - one `event: snapshot` frame containing the full run detail (run, steps,
      approvals, history, all retained runtime events);
    - `event: state` frames with run, steps, approvals, and history whenever a
      state fingerprint changes;
    - one `event: event` frame per newly retained runtime event, in store
      order;
    - `: ping` heartbeat comments.
  - **Reconnect decision:** the server does not rely on `Last-Event-ID` and
    does not replay by id. Every connection starts with a fresh snapshot, and
    the client replaces its state from it. `EventSource` may reconnect
    automatically after the advertised 2-second delay; because the snapshot
    carries all retained events and history, no event is lost across a
    reconnect. The server keeps the stream open while the run is active and
    until the client disconnects; the client closes it on a terminal status.
  - Add `GET /api/runs/[id]/events` returning `text/event-stream` with
    `Cache-Control: no-cache, no-transform` and an immediate flush. A missing
    run returns the normal 404 JSON envelope before any stream starts. Stop
    polling and clear timers when `request.signal` aborts. Mark the route
    `dynamic = "force-dynamic"`.
  - **Done when:** tests drive the stream builder with a fake timer and prove
    the initial snapshot, heartbeat, one state frame per change, ordered event
    frames without duplicates, reconnect producing a new snapshot, and abort
    ending the stream. The full `npm test`, `npx tsc --noEmit`, `npm run lint`,
    and `npm run build` pass, and the final diff contains no live-runtime
    claim.

## Files / areas

- `src/types/workflow.ts` - execution step approval, run project/version ids,
  approval history kinds.
- `src/lib/workflow/execution-plan.ts` - approval validation.
- `src/lib/workflow/engine.ts` - approval waiting/answering, per-run runtime,
  state matrix.
- `src/lib/workflow/skill-delivery.ts` - approval point projection.
- `src/lib/workflow/startup-reconciliation.ts` - pending approval cancellation.
- `src/lib/workflow/sqlite/migrations.ts` - schema version 3.
- `src/lib/workflow/sqlite/sqlite-store.ts` - new run columns and decoding.
- `src/types/run-api.ts` - API contracts and error codes.
- `src/lib/runs/service.ts` - run orchestration.
- `src/lib/runs/runtime.ts` - Reasonix runtime factory and singleton.
- `src/lib/runs/http.ts` - typed responses and body parsing.
- `src/lib/runs/stream.ts` - SSE framing and polling.
- `src/app/api/projects/route.ts` - project list and registration.
- `src/app/api/workflows/route.ts`, `src/app/api/skills/route.ts` - selection
  reads.
- `src/app/api/runs/route.ts`, `src/app/api/runs/[id]/route.ts` - list, start,
  detail.
- `src/app/api/runs/[id]/pause/route.ts`,
  `src/app/api/runs/[id]/continue/route.ts`,
  `src/app/api/runs/[id]/cancel/route.ts`,
  `src/app/api/runs/[id]/approvals/[approvalId]/route.ts` - controls.
- `src/app/api/runs/[id]/events/route.ts` - SSE.
- Co-located `*.test.ts` files next to every changed module and route.
- Do not edit anything under `src/components/ui/`, and do not touch
  `src/components/settings/`, `src/app/[locale]/`, or `src/i18n/` in this item.

## Data / contracts

### ExecutionStep

```ts
interface ExecutionStep {
  key: string;
  prompt: string;
  skillVersionIds?: readonly string[];
  workingDirectory?: string;
  retry?: { maxAttempts: number };
  approval?: { key: string; message: string };
}
```

`approval` is copied only from a published approval point named by the step. It
is not user input at run time.

### WorkflowRun additions

`projectId` and `workflowVersionId` are optional in the TypeScript contract so
older records remain readable, but the run service always writes both. They are
never exposed as a substitute for the engine's opaque `runtimeProfileId`.

### Migration 3

```sql
ALTER TABLE workflow_runs ADD COLUMN project_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN workflow_version_id TEXT;
```

`SCHEMA_VERSION` becomes 3. A version-2 database upgrades in place; existing
rows keep null for both columns and decode without either field.

### Approval state matrix

| Run status | pause | continue | cancel | answer approval |
| --- | --- | --- | --- | --- |
| `running` | record request | conflict | record request | conflict |
| `paused` | conflict | resume | cancel | conflict |
| `waiting_approval` | conflict | conflict | cancel run and pending approval | apply once |
| terminal or inactive | conflict | conflict | conflict | conflict |

- Rejection ends the run as `cancelled`; it is not a failure and the gated step
  stays `pending`.
- An approval is bound to exactly one `runId` and one `stepRunId`. The API path
  carries the run; a mismatched approval is reported as not found.
- `ApprovalRequest.response` remains unused; the decision is `status` plus
  `resolvedAt`.

### Error codes

Shared envelope:

```json
{ "error": { "code": "run_not_found", "message": "The run was not found." } }
```

Codes and statuses:

- 400: `invalid_request`, `invalid_json`
- 404: `project_not_found`, `workflow_version_not_found`,
  `skill_version_not_found`, `run_not_found`, `approval_not_found`
- 409: `workspace_root_registered`, `runtime_profile_not_found`,
  `runtime_profile_required`, `runtime_profile_invalid`, `credential_missing`,
  `workflow_version_not_selected`, `workflow_version_invalid`,
  `skill_version_missing`, `run_busy`, `run_state_conflict`,
  `approval_already_resolved`
- 415: `unsupported_media_type`
- 500: `persistence_error`
- 503: `runtime_unavailable`

Messages stay generic; no store path, catalog output, runtime stderr, or
credential value is attached.

### Runtime launch

`reasonix acp --model <providerName>/<model> --permission-mode acceptEdits
--workspace-only`, cwd at the project's canonical root, `REASONIX_HOME` from
configuration, and a 30-minute injectable request timeout. The credential is
read only for presence.

### SSE frames

```text
retry: 2000

event: snapshot
data: {"run":{...},"steps":[...],"approvals":[...],"history":[...],"events":[...]}

event: state
data: {"run":{...},"steps":[...],"approvals":[...],"history":[...]}

event: event
data: {"id":"...","runId":"...","stepRunId":"...","event":{"type":"assistant_text_delta","text":"..."},"recordedAt":"..."}

: ping
```

## Testing

- Tests are configured with Vitest and live next to their source.
- Every logic-bearing step ships focused tests. Use a temporary SQLite database
  (`:memory:` or a temp file), the existing fake runtime, a fake credential
  store, and injected timers. Never spawn the real Reasonix binary and never
  read a real credential.
- Engine tests cover the approval paths, state conflicts, and the absence of a
  runtime session before approval.
- Service tests cover project/version/profile resolution, runtime launch args,
  runtime closure, start failure cleanup, run summaries, detail assembly,
  control semantics, and approval answering.
- Route tests inject a fake service, matching the existing settings route-test
  pattern.
- Stream tests use a fake timer and an abort signal; no wall-clock sleeps.
- Final gates: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
  Run `npx next typegen` first if adding route files leaves generated route
  types missing.
- No browser harness is configured, so this item makes no browser or visual
  claim.
- Baseline observed on 2026-11-07 before this spec: `npm test` passed 565 tests
  with 4 live tests skipped; `npx tsc --noEmit` passed.

## Notes for the AI

- Implement 14A only. Do not build dashboard pages, navigation, translation
  entries, or the Settings fold-in; those are 14B.
- Preserve the engine's existing semantics: pause between steps, cancel
  preserves reached state, and a runtime step never gets interrupted by pause.
  Approval waiting is a new distinct state, not a variant of pause.
- The one-active-run rule stays. Do not add a run queue, worker, or concurrent
  scheduler for this item.
- Reuse the existing persistence, skill delivery, registration, settings path
  resolution, fake runtime, and route-handler patterns. Do not create a second
  project store or a second credential store.
- Do not add a dependency. Input validation is typed and hand-written like the
  existing settings service; Zod is unnecessary for two-id and enum bodies.
- Keep `/api` outside the locale proxy. Do not add localized route segments.
- Do not put skill content in the skills catalog response, and do not read or
  return a credential value anywhere.
- The recorded run and step `error` strings may be shown unchanged later. Do not
  strip the runtime's real failure message in this item; feature 15 owns
  redaction across logs and views.
- `acceptEdits` plus `--workspace-only` is a launch decision, not a live
  verification. Do not claim that Reasonix ran a workflow.
- If a repository detail blocks a step, add a focused check to that step rather
  than inventing a default. Do not start a dev server.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":25338,"specSha256":"76d33e3b99a3f888a7c36a25754db2e259ae24322018d32164f23328998827b8","branch":"refs/heads/feature/run-api-approvals-and-live-event-stream","head":"89d2d3a75fcace2a7d76a071c30689ee8e339c79","baseRef":"refs/heads/main","baseCommit":"31eb0502d5cf8e9b2a150eca2ec015ac73c6d54c","sourceTree":"ece5c43b7d67d04f42322faa5bb348d5155c9ba2","landing":"local-merge","absentOptional":[]} -->

## Findings

None resolved in this work item. F-01 to F-41 remain open or unverified in the live ledger; this independent review added F-38 to F-41.

## Independent review

**Status:** passed
**Target commit:** 89d2d3a75fcace2a7d76a071c30689ee8e339c79
**Base commit:** 31eb0502d5cf8e9b2a150eca2ec015ac73c6d54c
**Base ref:** main
**Spec hash:** 76d33e3b99a3f888a7c36a25754db2e259ae24322018d32164f23328998827b8
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-11-07T20:44:38Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh session
**Actual execution:** manual
**Reviewed at:** 2026-11-07T20:54:20Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `npm test`: pass (641 passed, 4 pre-existing live tests skipped)
- `npx tsc --noEmit`: pass
- `npm run lint`: pass (0 errors, 2 pre-existing warnings outside this delta)
- `npm run build`: pass
- `git diff --check`: pass

## Evidence

- Freshness: `HEAD` equals the target, `git merge-base main HEAD` equals the base, the spec SHA-256 matched, and only `blueprint/context/review.md` and `blueprint/context/findings.md` differ from the target.
- Reviewed the complete `31eb0502d5cf8e9b2a150eca2ec015ac73c6d54c..89d2d3a75fcace2a7d76a071c30689ee8e339c79` delta: 45 files covering engine approvals, migration 3, skill delivery, startup reconciliation, the run service, the Reasonix runtime factory, HTTP and SSE routes, and their tests.
- Focused tests cover approval validation and projection, migration from version 2 with an existing run, null decoding, the four new history kinds, the no-session-before-approval rule, approve/reject/cancel, and ordered SSE frames.
- Service tests assert runtime launch arguments, runtime closure on completion and failed start, typed validation errors, and that no credential value appears in a run detail. Skill catalog summaries omit content.
- Reviewer runtime: Reasonix CLI model `deepseek/deepseek-flash` executing the installed codex adapter tree (`.agents/skills`). The session started at 2026-11-07T20:48:22Z, after the request was prepared at 2026-11-07T20:44:38Z, without the builder transcript.

## Findings

- F-38 [P2] open - Run control responses are built before the request is recorded
- F-39 [P2] open - Concurrent approval decisions can duplicate history and resurrect a cancelled run
- F-40 [P2] open - Service control paths have no happy-path tests
- F-41 [P3] open - The new run modules and API routes bypass the `@/` import alias

## Remaining risk

- Automatic execution was requested, but this adapter could not confirm a fresh isolated child with an exact reviewer model, so the review completed as the permitted manual fallback from an automatic request.
- No live Reasonix workflow run was exercised. The spec excludes live proof and every automated test uses the fake runtime.
- No browser harness is configured, so no browser or visual behavior was reviewed.
- SSE polling re-reads and slices the full retained event list on every 750 ms tick per connection. The cost is unmeasured for long runs.
- Existing ledger findings outside this delta remain open and were not repaired here.
