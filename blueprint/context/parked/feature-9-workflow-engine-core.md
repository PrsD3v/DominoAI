# Feature: Workflow Engine Core

**From build-plan:** feature 9
**Build attempt:** 1
**Branch:** feature/workflow-engine-core

## Goal

Build the runtime-independent core of Domino's workflow engine. The engine owns
run and step state, executes a minimal execution projection one step at a time
against the `AgentRuntime` contract, records what happened, applies an attempt
policy, enforces workspace containment before every runtime step, and supports
workflow pause, continue, and cancel as run operations. It runs on an in-memory
implementation of its persistence contracts; SQLite arrives in Feature 10.

Feature 8 remains the owner of the published, versioned workflow and skill model.
Feature 9 consumes only the execution projection defined here and never declares
or persists a published workflow definition.

Feature 9 does not depend on the ACP adapter's prompt path. Tests use the existing
fake runtime from Feature 1. No live Reasonix call is made.

## In scope

- Engine-owned contracts for a minimal execution projection, run and step state,
  attempt policy, approval records, runtime session references, retained runtime
  events, and recorded history. The projection is not Feature 8's published
  workflow definition.
- One mapping boundary from a narrow published-workflow view into the execution
  projection. Feature 8's model is never imported by the engine or persistence.
- The application-owned execution persistence interface for the records the
  engine reads and writes, with an in-memory implementation. The interface also
  carries the approval execution record for Feature 10/14; the Feature 9 engine
  does not read or write it.
- A sequential executor that starts a run, creates the run and step records,
  executes each step through `AgentRuntime`, and closes each runtime session.
- Per-operation containment: before each runtime step, resolve the step's working
  path, including symlink targets, and refuse the step unless it stays inside the
  supplied workspace root.
- Attempt policy for failed step attempts.
- Workflow pause, continue, and cancel, kept distinct from Reasonix session
  resume. Pause never interrupts an active prompt.
- Opaque runtime binding through `runtimeProfileId`; the engine sees only the
  injected `AgentRuntime`.
- Deterministic Vitest coverage for state transitions, ordering, retries,
  containment, pause, continue, cancel, and runtime binding.

## Out of scope

- ACP handshake, prompt framing, streamed ACP updates, stop-reason normalization,
  or a live Reasonix session (Features 3B and 4).
- ACP-level cancel, EOF, crash, and timeout handling (Feature 5).
- Resume, load, list, or steering (Features 6 and 7).
- The full versioned, validated workflow and skill definition model, including
  the public `WorkflowDefinition` and `WorkflowStepDefinition` types, skill
  versioning, approval-point semantics, and error-policy validation (Feature 8).
  This feature defines only the execution projection the engine needs.
- SQLite, schema migrations, startup reconciliation, event-retention policy, and
  durable project storage (Feature 10). Feature 10 implements the Feature 9
  execution interface and owns the durable project store, but does not define
  project registration semantics.
- Project registration, registration-time validation and canonicalization, and
  project configuration semantics (Feature 11).
- Runtime profiles, credentials, provider/model catalogs, and settings screens
  (Feature 11A).
- Approval UI, approval API, dashboard, SSE, localization, and server safety
  (Features 14 and 15).
- Concurrent runs, scheduling, queueing, parallel or conditional steps, and
  cross-process recovery.

## Build loop

- One review packet after all steps (`workflow.stepReview: "feature"`); no
  per-step review pause and no checkpoint commits (`checkpointCommits:
  "disabled"`).
- Each step leaves the repository working. Before an item is marked done, run
  `npm test` and `npx tsc --noEmit` in this worktree.
- `/complete` creates the final feature commit after approval.
- No dev server is needed; this feature has no UI.

## Build steps

- [ ] 1. **Define the engine contracts and the execution projection seam.**
  - Add `src/types/workflow.ts` with the status vocabulary,
    `WorkflowExecutionPlan`, `ExecutionStep`, `ExecutionRetryPolicy`,
    `WorkflowRun`, `StepRun`, `ApprovalRequest`, `RuntimeSessionRef`,
    `RuntimeEventRecord`, and the execution persistence interface the engine
    consumes. Do not declare `WorkflowDefinition` or `WorkflowStepDefinition`;
    Feature 8 owns those names and the published model.
  - Add `src/lib/workflow/projection.ts` with the only mapping boundary:
    `projectPublishedWorkflow(source: PublishedWorkflowView):
    WorkflowExecutionPlan`. `PublishedWorkflowView` is a narrow read-only port
    with `workflowId`, `workflowVersion`, and ordered steps carrying `key`, an
    already-resolved `prompt`, optional `workingDirectory`, and optional
    `retry.maxAttempts`. It is not a published definition and carries no skills,
    approval points, or error policy. Feature 8's adapter maps its published
    model into this view; Feature 9 never imports Feature 8.
  - Add `src/lib/workflow/execution-plan.ts` with the minimal engine-side
    validation of `WorkflowExecutionPlan`: non-empty step list, unique step
    keys, and an integer `maxAttempts` of at least 1. The projection calls this
    validator.
  - Keep the public workflow types independent of ACP, SQLite, ORM, provider,
    model, credential, and Feature 8 details. `AgentRuntime` is the only runtime
    dependency.
  - *Done when:* `npx tsc --noEmit` passes; focused tests project a valid
    published view, reject empty steps, duplicate keys, and invalid
    `maxAttempts`, and prove the projection copies only executable fields;
    workflow types reach no ACP, Feature 8, or persistence implementation.

- [ ] 2. **Implement the in-memory persistence layer.**
  - Add `src/lib/workflow/in-memory-persistence.ts` implementing the execution
    persistence interface: runs (including the execution plan snapshot), step
    runs, approvals, runtime session references, retained runtime events, and
    recorded history. It stores no published workflow or skill definitions and
    no project records.
  - Keep project storage and published definition storage out of this interface.
    Feature 10 owns the durable project store; Feature 8 owns the published
    definition model and its storage contract.
  - Store copies on write and return copies on read so callers cannot mutate
    persisted state accidentally. Preserve insertion order for lists.
  - Inject the id and time sources used for records; do not read wall-clock time
    or random ids inside the store.
  - *Done when:* focused tests cover create, read, update, missing records,
    duplicate ids, deterministic list order, approval record round-trip, and
    isolation between two store instances; a record is not changed by mutating
    the object returned to a caller.

- [ ] 3. **Implement workspace containment resolution.**
  - Add `src/lib/workflow/containment.ts` with one resolver that canonicalizes
    the workspace root, resolves the requested step path, and returns the
    resolved path only when it is inside the root.
  - Resolve symlinks for both the root and the target. Refuse a target that is
    outside the root through `..`, an absolute path, or a symlink whose target is
    outside. Refuse a missing root, a non-directory root, or a missing target.
  - Use a typed `WorkspaceContainmentError` that names the rejected path without
    exposing unrelated host paths in user-facing text.
  - *Done when:* temporary-directory tests cover the root itself, a nested
    inside path, a `..` escape, an absolute outside path, a symlink inside the
    root, a symlink that escapes the root, a missing target, and a non-directory
    root; each refusal returns the typed error and makes no runtime call.

- [ ] 4. **Implement the sequential runner and runtime binding.**
  - Add `src/lib/workflow/engine.ts`. `createWorkflowEngine({ persistence,
    runtime, idFactory, now })` returns an engine with `startRun`, `pauseRun`,
    `continueRun`, and `cancelRun`.
  - `startRun(plan: WorkflowExecutionPlan)` validates the plan, persists a deep
    copy of the plan snapshot with the run, creates one `WorkflowRun` and one
    `StepRun` per step, and returns the run id together with a completion
    promise. The run id is available before execution finishes so a caller can
    pause or cancel an active run. The run stores `workflowId` and
    `workflowVersion` from the projection; it never loads or persists a
    published definition.
  - Execute steps strictly in plan order. For each step, create one runtime
    session with the canonical workspace root, send the already-resolved step
    prompt, forward `assistant_text_delta` events to the persistence layer with
    run and step identity, and close the session in a `finally` block. Do not
    resolve skills or read Feature 8 data.
  - Store `runtimeProfileId` as an opaque string on the run. Do not read,
    validate, or pass provider, model, credential, or profile metadata to the
    engine. Record the runtime's own identity only from
    `runtime.capabilities.agent?.name` for the session reference.
  - Refuse a second run on the same engine instance until the first run reaches a
    terminal or paused state. Do not add scheduling or queueing.
  - *Done when:* fake-runtime tests execute three steps in order and assert run
    and step statuses, the recorded events, the session references, the workspace
    root passed to `createSession`, the pinned `workflowId`, `workflowVersion`,
    and plan snapshot, and the opaque `runtimeProfileId`; a second concurrent
    `startRun` is refused with a typed error.

- [ ] 5. **Add the attempt policy.**
  - Default `maxAttempts` to 1. Retry a step only when the runtime throws; a
    `PromptResult` with `stopReason: "cancelled"` is not retried and ends the run
    as cancelled without starting another attempt.
  - On a retry, close the previous session, increment the step attempt, record
    the failed attempt in history, and create a fresh session for the next
    attempt.
  - When attempts are exhausted, mark the step `failed` and the run `failed`,
    keep completed steps and history intact, and stop before the next step.
  - Retries are immediate. Do not add a delay, backoff, jitter, timer, or sleep
    in this feature. A later delay policy needs a new decision and an explicit
    policy field; it must not be inferred.
  - A session close failure is not an attempt failure. Record it in history, keep
    a successful prompt result as the step result, and do not retry only because
    close failed. If the prompt also failed, the prompt error remains the
    attempt failure. A close failure never masks the prompt result.
  - *Done when:* tests cover failure then success, exhaustion at
    `maxAttempts`, no retry when `maxAttempts` is 1, cancelled results not being
    retried, immediate retry with no timer, close failure after success, close
    failure after prompt failure, and the recorded attempt count and error
    history.

- [ ] 6. **Implement pause, continue, and cancel.**
  - `pauseRun` records the request immediately and is safe to call while a step
    is running. Before starting the next step, the engine observes the request,
    sets the run to `paused`, leaves the next step `pending`, and returns. The
    active prompt is allowed to finish; the engine never cancels or interrupts
    it.
  - `continueRun` is valid only for a paused run. It clears the request, sets the
    run back to `running`, and resumes from the first step that is not completed.
    It does not create a second session for a completed step.
  - `cancelRun` ends the run as `cancelled`, preserving the state each step
    reached. Between steps it stops immediately; during a step it lets the
    prompt finish, records the step result, and starts no next step. It never
    calls a runtime session-resume or session-cancel operation.
  - Reject invalid transitions, such as continuing a cancelled run or pausing a
    completed run, with a typed workflow-state error.
  - The engine never creates an approval request, never enters
    `waiting_approval`, and never waits for an approval. Approval-point
    definitions belong to Feature 8; raising and answering approvals belongs to
    Feature 14. Feature 9 only carries the approval record in the persistence
    contract.
  - *Done when:* tests cover pause before a step, pause during a step (the step
    finishes, no next step starts), continue from the paused step, cancel
    between steps, cancel during a step, invalid transitions, and the absence of
    an approval wait; the fake runtime has no resume or cancel method to call.

- [ ] 7. **Integrate containment and finish the feature gate.**
  - Call the containment resolver before every `runtime.createSession` call.
    A refusal marks the step and run `failed`, records the containment error, and
    makes no runtime call.
  - Add one end-to-end deterministic test that projects a three-step published
    view, runs the resulting plan with a retry, a pause and continue, and a
    containment refusal, and asserts run, step, session, event, and history
    state.
  - Run `npm test` and `npx tsc --noEmit` in this worktree. Confirm the diff
    touches only workflow types, workflow library files, and their tests.
  - *Done when:* the full suite and typecheck pass, the containment refusal is
    proved to happen before session creation, and no ACP, SQLite, UI, Feature 8
    type, project record, published definition storage, or credential file is
    changed.

## Files / areas

- `src/types/workflow.ts` - engine-facing execution types and persistence
  contracts. It declares no published `WorkflowDefinition`.
- `src/lib/workflow/projection.ts` - the only published-view to execution-plan
  mapping boundary.
- `src/lib/workflow/execution-plan.ts` - execution plan validation.
- `src/lib/workflow/containment.ts` - workspace containment resolution.
- `src/lib/workflow/in-memory-persistence.ts` - in-memory execution store.
- `src/lib/workflow/engine.ts` - sequential executor and run operations.
- `src/types/workflow.test.ts`, `src/lib/workflow/*.test.ts` - focused Vitest
  coverage next to the source.
- No changes to `src/types/runtime.ts`, `src/lib/runtime/acp/`, `src/app/`,
  `src/components/`, or any SQLite, durable persistence, or credential
  implementation.

## Data / contracts

- **Execution projection seam.** Feature 8 owns the published, versioned
  `WorkflowDefinition` and `WorkflowStepDefinition` model, skill versions,
  approval points, and error policy. Feature 9 consumes only
  `WorkflowExecutionPlan`: `workflowId`, `workflowVersion`, and ordered
  `ExecutionStep`s with `key`, an already-resolved `prompt`, optional
  `workingDirectory` relative to the workspace root, and optional
  `retry.maxAttempts`. `src/lib/workflow/projection.ts` is the only mapping
  boundary: `projectPublishedWorkflow(source: PublishedWorkflowView)` copies
  those executable fields and drops everything else. `PublishedWorkflowView` is
  a narrow port, not a second published model. Skill content is resolved before
  projection; the engine never resolves skills. No public `WorkflowDefinition`
  or `WorkflowStepDefinition` is declared in Feature 9.
- **Run status.** Feature 9 produces `running`, `paused`, `completed`, `failed`,
  and `cancelled`. The shared vocabulary also reserves `pending`,
  `waiting_approval`, and `interrupted` for later features; Feature 9 does not
  produce them.
- **Step status.** A step is `pending`, `running`, `completed`, `failed`, or
  `cancelled`. A paused run leaves unfinished steps `pending`. A step that
  finished while pause or cancel was requested keeps the result it reached.
- **Run identity.** A run has a Domino run id, the projected `workflowId` and
  `workflowVersion`, the execution plan snapshot the run started with, an opaque
  `runtimeProfileId`, the canonical workspace root used for execution, status,
  timestamps, and pause/cancel request flags. A run id is never a runtime
  session id.
- **Session reference.** Each runtime session reference links a run and step run
  to the runtime session id and the runtime's own reported agent name. It does
  not store a provider, model, or credential.
- **Recorded history.** The store records run and step state, retained runtime
  events, step attempts, and lifecycle transitions needed to explain the final
  state. Timestamps come from the injected clock so tests are deterministic.
- **Attempt policy.** `maxAttempts` is an integer of at least 1, default 1. A
  step is retried only when the runtime throws; a `PromptResult` with
  `stopReason: "cancelled"` is not retried. Retries are immediate: no delay,
  backoff, jitter, or timer in Feature 9. A later delay policy requires a new
  decision and an explicit field.
- **Approval boundary.** The engine never creates an approval request, never
  enters `waiting_approval`, and never blocks on an approval. Feature 8 owns
  approval-point definitions and Feature 14 owns raising and answering
  approvals. The `ApprovalRequest` execution record exists for Feature 10/14; no
  Feature 9 engine path writes or reads it.
- **Session close.** Each attempt's session is closed exactly once in a `finally`
  block. A close failure is appended to history but is not an attempt failure: a
  successful prompt keeps its completed step, and a failed prompt remains failed
  for its original error. A close failure never triggers a retry by itself, never
  masks the prompt error, and never turns a successful step or run into a failed
  one. The engine never calls `runtime.close()`; runtime lifecycle stays with the
  caller.
- **Persistence boundary.** The engine talks only to the execution persistence
  interface. It never imports the in-memory implementation, SQLite, an ORM, ACP,
  or Feature 8. Feature 10 implements the same interface with SQLite, owns the
  durable project record, schema, and migration mechanism, and does not implement
  registration-time validation or canonicalization. Published workflow and skill
  definitions belong to Feature 8; project registration, root validation and
  canonicalization, and configuration semantics belong to Feature 11, which
  writes through Feature 10's store. Additional project fields arrive as a
  Feature 11 migration. Feature 9 declares and stores neither. Feature 10 must
  not invent the published-definition shape; when that model lands, its storage
  is added through Feature 10's migration mechanism.
- **Containment.** Before each runtime step, the resolved step path, including
  symlink targets, must remain inside the canonical workspace root. The check is
  per operation and must not be replaced by a one-time registration check.
- **Runtime binding.** The engine receives an `AgentRuntime` and an opaque
  `runtimeProfileId`; it never resolves a profile or reads provider metadata.

## Testing

- `npm test` is the project test command; Vitest is already configured. Each
  logic-bearing step ships focused tests next to its source.
- Tests use `createFakeRuntime` from `src/lib/runtime/fake-runtime.ts`, temporary
  directories from `node:fs/promises` and `node:os`, and injected ids and clocks.
  They make no network call, spawn no Reasonix process, and use no real
  credential.
- Required coverage: projection mapping and dropped fields, execution plan
  validation, in-memory persistence isolation and ordering, containment
  refusals, ordered execution, event forwarding, session creation and close,
  retry and exhaustion, immediate retry with no timer, close failure after
  success and after failure, pause before and during a step, continue, cancel
  before and during a step, invalid transitions, no approval wait, concurrent-run
  refusal, and opaque runtime binding.
- Run `npx tsc --noEmit` as the type gate. Do not claim a live Reasonix or ACP
  result in this feature.
- No browser tests are configured or needed.

## Notes for the AI

- Do not pull Feature 4's ACP prompt implementation into this feature. The engine
  depends on the `Session.prompt` contract and the fake runtime only.
- Do not implement Feature 5's runtime cancel, EOF, crash, or timeout behavior.
  Engine cancel is a run operation and must not call a runtime cancel method.
- Do not implement Feature 8's published model, including
  `WorkflowDefinition`/`WorkflowStepDefinition`, skill versions, approval
  points, or error policy. Use only `WorkflowExecutionPlan` and the projection
  boundary.
- Do not implement Feature 10's SQLite layer or project store, Feature 11's
  project registration and configuration, or Feature 11A's credential work.
- Do not add a retry delay, backoff, jitter, or timer.
- Do not add an approval wait or produce `waiting_approval`.
- Do not let a session close failure fail a step, fail a run, or trigger a retry.
- Do not add dependencies. Use the standard library and installed Vitest.
- Keep the engine free of ACP method names, protocol payloads, provider names,
  model names, and credential values.
- Clean up temporary directories in tests. Do not leave scratch files in the
  repository.
- Keep the diff reviewable: one small step at a time, with `npm test` and
  `npx tsc --noEmit` green before marking a step done.

## Resolved decisions

These five decisions were resolved on 2026-10-30 before implementation. They are
recorded here so implementation does not reopen them silently.

1. **Feature 8 boundary.** Feature 8 owns the published, versioned workflow and
   skill model. Feature 9 owns only `WorkflowExecutionPlan`, projected through
   `src/lib/workflow/projection.ts` from a narrow `PublishedWorkflowView`.
   Feature 9 declares no public `WorkflowDefinition` or `WorkflowStepDefinition`
   and does not import Feature 8. Skill content is resolved before projection.
   Rationale: the engine can execute before Feature 8 lands without creating a
   competing definition model, and the mapping boundary is one small pure
   function.
2. **Retry backoff.** Feature 9 retries immediately with `maxAttempts` only,
   default 1. No delay, backoff, jitter, or timer is added. Rationale: step
   retries are not provider retries; the runtime owns its own timeouts, and a
   delay without evidence would complicate deterministic tests and can hide
   failures. A delay policy can be added later behind an explicit field.
3. **Approval waiting.** The engine never waits for an approval, never creates an
   approval request, and never enters `waiting_approval`. Approval-point
   semantics belong to Feature 8; raising and answering approvals belong to
   Feature 14. The execution record remains in the persistence contract for
   Feature 10/14. Rationale: approval execution is a later UI and API concern, and
   an engine wait with no answer path would deadlock.
4. **Project persistence.** Feature 9's engine interface excludes projects.
   Feature 10 owns the durable project record, schema, and migration mechanism.
   Feature 11 owns registration, root validation and canonicalization, and
   configuration semantics, and writes through Feature 10's store. Additional
   project fields arrive as a Feature 11 migration. Feature 10 does not invent
   registration behavior. Rationale: storage mechanics and registration behavior
   are separate concerns, and the canonical Feature 10 line already assigns
   projects and schema decisions to the persistence feature.
5. **Session close failure.** A close failure is recorded in history but does not
   fail a successful step, fail the run, or trigger a retry. A prompt error
   remains the primary attempt failure. Rationale: close is cleanup, and failing
   completed work would cause duplicate execution on retry. The failure is still
   observable in history.
