# Feature: SQLite persistence

**From build-plan:** feature 10
**Build attempt:** 1
**Branch:** feature/sqlite-persistence
**Status:** verified

## Goal

Implement Feature 9's application-owned persistence contract with SQLite so run
state, step state, approvals, session links, retained events, and history survive
an application restart. Persist the durable Project record and the published
workflow and skill definitions Feature 11 must select versions from. Add startup
reconciliation so runs that were active when the process stopped become
`interrupted` with their step states and history preserved.

The engine keeps talking only to `WorkflowExecutionPersistence`. The SQLite layer
is a separate implementation with no import back into the engine, and the engine
code does not change in this feature.

## In scope

- A local SQLite store built on Node's built-in `node:sqlite` module
  (`DatabaseSync`), with no new runtime dependency.
- A versioned migration mechanism inside the store, reported through
  `PRAGMA user_version`, and refusal to open a database written by a newer schema.
- SQLite implementations of every method of the existing
  `WorkflowExecutionPersistence` contract from Feature 9, with the same
  duplicate-id and missing-record behavior the in-memory implementation already
  has.
- A durable Project record store with its schema and migrations, written by
  Feature 11 later. Not exposed through `WorkflowExecutionPersistence`.
- A durable published-definition store for workflow definitions and versions and
  skill definitions and versions, reusing Feature 8's model and validators.
  Published versions are stored without an update method.
- The event-retention decision for runtime events.
- Startup reconciliation: a function over the persistence contract that marks
  runs that were active at process stop as `interrupted`, preserves their step
  states and existing history, records one interruption history entry, and is
  idempotent on a second call.
- Deterministic Vitest coverage for migrations, record round-trips, ordering,
  durability across close and reopen, the engine running on the SQLite store, and
  reconciliation.

## Out of scope

- `RuntimeProfile` persistence, its migration, the credential store, the Settings
  screen, and the real connection test (Feature 11A Stage 4 and later). Feature 10
  stores only an opaque `runtimeProfileId` string.
- Project registration, `workspaceRoot` validation and canonicalization, project
  configuration semantics, and the registration API (Feature 11). Feature 10
  stores the record and does not validate or canonicalize a path.
- Dashboard, event transport, and server routes (Feature 14), and the app-level
  boot path that will call reconciliation. Reconciliation is exercised by tests
  "as if after a process restart", which is the acceptance this feature owes.
- Server hardening, cross-origin rules, and log redaction (Feature 15).
- Event pruning, compaction, archival, or a storage-size cap. No deletion API is
  added.
- Concurrent writers, multiple processes, or multiple Domino instances sharing
  one file; encryption at rest; backup and restore; PostgreSQL.
- Import or export of Blueprint or any external definition format (Features 12
  and 13), and any change to Feature 8's model or validators.
- Reworking the engine, the in-memory store's behavior, or the ACP adapter.

## Build loop

Follow `workflow.stepReview: "feature"` and `workflow.checkpointCommits:
"disabled"` from `blueprint/config.json`: implement all steps, then present one
review packet. `/complete` makes the final feature commit.

## Build steps

- [x] 1. **Driver, schema, and migrations**
  Align the Node type definitions with the runtime this project already declares
  (Node 24) by bumping the existing `@types/node` devDependency to `^24`; Node 20
  types ship no `node:sqlite` declarations, and no hand-written ambient module
  declaration is added. Add `src/lib/workflow/sqlite/migrations.ts` with an
  ordered, immutable migration list, `SCHEMA_VERSION`, and an `applyMigrations`
  that runs each pending migration inside a transaction and sets
  `PRAGMA user_version`. Add `openSqliteDatabase({ path })`, returning the
  migrated `DatabaseSync` with a `close()`, enabling
  `PRAGMA foreign_keys = ON`, accepting a file path or `:memory:`, and throwing
  the typed schema error when the stored `user_version` is newer than this build.
  The record stores are composed on top of it in the following steps.
  `Done when`: a temp-file test opens a fresh database, sees every table from
  "Data / contracts", re-opens it without re-running migrations, refuses a
  database with `user_version` = 2 with a `WorkflowPersistenceError` whose code is
  `schema`, and closes cleanly; `npx tsc --noEmit` and `npm test` pass. If the
  `@types/node` bump surfaces type errors outside this feature's files, stop and
  report them instead of editing unrelated code.

- [x] 2. **Execution records over SQLite**
  Implement `WorkflowExecutionPersistence` for runs, step runs, approvals,
  runtime session references, retained runtime events, and history, comparing the
  in-memory store's behavior as the reference. Booleans are stored as 0/1,
  `plan` and `event` as JSON text, times as the record's own ISO-8601 string; the
  store never generates a timestamp or an id. Lists are ordered by insertion
  sequence and filtered by run. Duplicate ids and updates of missing records raise
  the existing `WorkflowRecordError`; foreign-key violations, undecodable JSON,
  and unknown status or history-kind values raise `WorkflowPersistenceError` with
  the documented code. Returned records are copies no caller can mutate back into
  the store.
  `Done when`: focused tests cover every method, ordering after an update,
  per-run filtering, duplicate and missing-record errors, mutation isolation
  (mutating a returned record and a stored input object does not change stored
  state), an orphan step run rejected by the foreign key, and corrupted
  `plan_json`, `event_json`, status, and history-kind values each rejected with a
  decode error; `npm test` is green.

- [x] 3. **Durability across a restart and engine integration**
  Prove the state actually survives the process boundary, not just a round-trip
  inside one open database. Write runs, steps, approvals, session references,
  events, and history to a temp-file database, close it, reopen it, and read the
  identical records back in the same order. Add one integration test that runs
  the existing engine over the SQLite store with the fake runtime and reads the
  finished records back.
  `Done when`: the close-and-reopen test asserts full record equality including
  the execution plan and retained event order, the engine integration test
  completes a multi-step run and finds completed step runs plus run, step, and
  session history in the reopened database, and `npx tsc --noEmit` passes.

- [x] 4. **Published definition store**
  Persist Feature 8's `WorkflowDefinition`, `WorkflowVersion`, `SkillDefinition`,
  and `SkillVersion` through a `PublishedDefinitionPersistence` contract in
  `src/types/persistence.ts`, with creation, lookup, and listing only for versions
  and update support only for the editable containers. Reuse the existing
  Feature 8 validators on write and never re-implement their rules. Version
  numbers are unique per definition.
  `Done when`: tests store and read back a workflow version with steps,
  approval points, retry policy, and working directory unchanged, and a skill
  version with its markdown content; reject a duplicate version id, a repeated
  `(definitionId, version)` pair, an invalid version rejected by the Feature 8
  validator, and an unknown definition id; and confirm that neither version type
  exposes an update method.

- [x] 5. **Project records**
  Add the `Project` type and a `ProjectPersistence` contract (create, get,
  update, list) in `src/types/persistence.ts`, plus the SQLite implementation.
  Store `configuration` as JSON, keep `defaultRuntimeProfileId` opaque and
  nullable, and keep selected workflow version ids and selected skill version ids
  in order with a foreign key to the published versions from step 4. No validation
  or canonicalization of `workspaceRoot` is added here.
  `Done when`: tests round-trip a project with configuration, no default profile,
  and selected versions persisted in step 4; reject a duplicate id; reject an
  update of a missing project; reject a selected version id that was never
  persisted; and prove the project is absent from the
  `WorkflowExecutionPersistence` surface.

- [x] 6. **Startup reconciliation**
  Add `reconcileInterruptedRuns({ persistence, now })` over the persistence
  contract only, so it works against both implementations. Runs in `pending`,
  `running`, `paused`, or `waiting_approval` become `interrupted` with
  `finishedAt` and `updatedAt` from the injected clock and both request flags
  cleared. Step run rows are not rewritten, existing history is preserved, and
  one `run_interrupted` history entry is appended per reconciled run. Terminal
  runs are untouched, and a second call returns no runs and writes nothing.
  Extend `WorkflowHistoryKind` with `run_interrupted` for that entry.
  `Done when`: tests against the SQLite store and the in-memory store cover every
  active status, each terminal status left untouched, preserved step states and
  history, exactly one added history entry, the injected clock value, and
  idempotency; `npm test` and `npx tsc --noEmit` pass.

## Files / areas

- `package.json`, `package-lock.json` - `@types/node` `^20` to `^24`
- `src/types/persistence.ts` - new: `Project`, `ProjectPersistence`,
  `PublishedDefinitionPersistence`
- `src/types/workflow.ts` - add the `run_interrupted` history kind only
- `src/lib/workflow/persistence-errors.ts` - new home for the existing
  `WorkflowRecordError` plus `WorkflowPersistenceError`; update the two current
  importers
- `src/lib/workflow/sqlite/migrations.ts` - new: schema version and migrations
- `src/lib/workflow/sqlite/sqlite-store.ts` - new: open/close and the three
  store implementations
- `src/lib/workflow/sqlite/migrations.test.ts`,
  `src/lib/workflow/sqlite/sqlite-store.test.ts` - new
- `src/lib/workflow/startup-reconciliation.ts`,
  `src/lib/workflow/startup-reconciliation.test.ts` - new
- `src/lib/workflow/in-memory-persistence.ts`,
  `src/lib/workflow/in-memory-persistence.test.ts` - import path for the moved
  error class only
- `src/lib/workflow/engine.ts` - not changed

## Data / contracts

One SQLite file, one connection, one store object implementing
`WorkflowExecutionPersistence`, `ProjectPersistence`, and
`PublishedDefinitionPersistence` plus `close()`. The engine receives it typed as
`WorkflowExecutionPersistence`, so published, project, and definition records
stay outside that interface. Schema version 1 contains:

- `workflow_runs` - `seq INTEGER PRIMARY KEY AUTOINCREMENT`, `id TEXT NOT NULL
  UNIQUE`, `workflow_id`, `workflow_version INTEGER`, `plan_json`, `runtime_profile_id`,
  `workspace_root`, `status`, `created_at`, `updated_at`, `started_at` nullable,
  `finished_at` nullable, `pause_requested INTEGER`, `cancel_requested INTEGER`,
  `error` nullable
- `step_runs` - `seq`, `id` unique, `run_id` referencing `workflow_runs(id)`,
  `step_key`, `step_index`, `status`, `attempts`, `max_attempts`, `created_at`,
  `updated_at`, `started_at`, `finished_at`, `result_text`, `error`
- `approvals` - `seq`, `id` unique, `run_id`, `step_run_id` referencing
  `step_runs(id)`, `status`, `message`, `requested_at`, `resolved_at`, `response`
- `runtime_session_refs` - `seq`, `id` unique, `run_id`, `step_run_id`,
  `runtime_session_id`, `agent_name` nullable, `created_at`, `closed_at`,
  `close_error`
- `runtime_events` - `seq`, `id` unique, `run_id`, `step_run_id`, `event_json`,
  `recorded_at`
- `workflow_history` - `seq`, `id` unique, `run_id`, `step_run_id` nullable,
  `kind`, `message`, `created_at`
- `projects` - `seq`, `id` unique, `name`, `workspace_root`,
  `configuration_json`, `default_runtime_profile_id` nullable, `created_at`,
  `updated_at`
- `project_workflow_versions`, `project_skill_versions` - `project_id`,
  version id, `position`, primary key on the first two columns
- `workflow_definitions`, `skill_definitions` - `id` primary key, `name`
- `workflow_versions` - `seq`, `id` unique, `definition_id`, `version`,
  `steps_json`, `approval_points_json`, `error_policy`, `published_at`,
  unique `(definition_id, version)`
- `skill_versions` - `seq`, `id` unique, `skill_definition_id`, `version`,
  `content`, `published_at`, unique `(skill_definition_id, version)`

Indexes cover each `run_id` and `project_id` list path together with `seq`.
Every child table indexes its parent column so the engine's per-run lists stay
ordered without scanning.

Contract behavior:

- Ids, timestamps, and statuses come from the caller; the store validates and
  round-trips them, and never invents one.
- `list*` returns insertion order, which `seq` preserves across updates; per-run
  lists filter by `run_id` and stay in that order.
- `create*` on an existing id throws `WorkflowRecordError("create", kind, id)`;
  `update*` on a missing id throws `WorkflowRecordError("update", kind, id)`,
  matching the in-memory implementation.
- `WorkflowPersistenceError` carries a `code`: `schema` (database written by a
  newer version), `decode` (unreadable JSON, unknown status, or unknown history
  kind, naming the table and id), `reference` (foreign-key violation),
  `conflict` (a repeated definition and version pair), or `invalid` (a definition
  the Feature 8 validator rejects before it is stored).
- Published versions have no update method. Definition containers do.
- No credential value, API key, transcript body beyond normalized runtime events,
  provider name, or model name is stored. `runtime_profile_id` stays an opaque
  string.
- **Event retention:** runtime events are kept for the lifetime of the run. The
  store adds no pruning, compaction, deletion, or size cap, because no established
  requirement sets a retention limit and deleting a run's evidence would weaken
  the history the product exists to keep. Revisit in the release or dashboard
  work only if a real storage requirement appears.
- **Reconciliation:** `pending`, `running`, `paused`, and `waiting_approval` runs
  become `interrupted`; `completed`, `failed`, `cancelled`, and `interrupted`
  runs are untouched. Step states and existing history rows are preserved, the
  two request flags are cleared, `finishedAt` and `updatedAt` come from the
  injected clock, and exactly one `run_interrupted` history entry is appended.
  Nothing resumes, retries, or closes a runtime session, and no step status is
  rewritten, so nothing implies automatic continuation.
- The store opens synchronously and its methods remain `async` to satisfy the
  existing contract.

## Testing

Test command: `npm test` (Vitest). Typecheck: `npx tsc --noEmit`. There is no
Browser tests command, and none is needed: this feature has no UI.

- `src/lib/workflow/sqlite/migrations.test.ts` - fresh schema, idempotent
  re-open, newer-schema refusal, close, `:memory:` support.
- `src/lib/workflow/sqlite/sqlite-store.test.ts` - every execution method,
  ordering, filtering, error mapping, decode failures, foreign keys, mutation
  isolation, close-and-reopen durability, engine integration, project records,
  and published definitions.
- `src/lib/workflow/startup-reconciliation.test.ts` - active and terminal
  statuses, preserved step states and history, one history entry, injected clock,
  and idempotency, run against both stores.
- Each test uses its own database under `mkdtemp(join(tmpdir(), "domino-sqlite-"))`
  and removes it afterwards. No test writes inside the repository and no test
  touches a real Reasonix home or the network.

## Notes for the AI

- Use `node:sqlite` from Node 24. Do not add `better-sqlite3`, an ORM, a query
  builder, Zod, or any migration framework; none is installed, and the schema is
  small enough that plain SQL and prepared statements are the smaller design.
- Do not change `src/lib/workflow/engine.ts`, the engine's behavior, or the
  persistence contract's method set. Feature 9's tests must keep passing
  unchanged.
- The only allowed shared-type change is adding `run_interrupted` to
  `WorkflowHistoryKind`; it is additive and needed to record the transition.
- Move `WorkflowRecordError` to `persistence-errors.ts` and update its importers;
  do not duplicate the class or silently change its message format, which
  existing tests assert.
- Keep the SQLite implementation out of `src/types/` and out of the engine: the
  store imports the contracts, never the reverse.
- No environment variable, storage-path default, or app bootstrap is introduced
  here; the open function takes an explicit path. Wiring belongs to the feature
  that owns the server.
- Do not implement Feature 11's registration validation, Feature 11A's profile
  table, or any event pruning.
- Timestamps in tests come from fixed ISO strings so assertions stay
  deterministic; reconciliation takes its clock as an argument.
- Because this feature changes persisted format and a devDependency, re-run
  `npx tsc --noEmit` and `npm test` before presenting the review packet, and
  check that `git status` shows only the intended files.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":17460,"specSha256":"2204152d5d861268997f6f3deabf567850c3cb06e364c5455ef3ec7df67cdb01","branch":"refs/heads/feature/sqlite-persistence","head":"f9d25e93faaf75b4abe7ae2017a5de44874b436d","baseRef":"refs/heads/main","baseCommit":"f2ca58581ad285277ca8df2664f466725fdbad6f","sourceTree":"737806e4610bcd751a413e15bd34084e3cbca4ef","landing":"local-merge","absentOptional":[]} -->

## Findings

- None resolved in this work item. F-01 through F-15 remain open in the live
  ledger for later review.

## Independent review

**Status:** passed
**Target commit:** f9d25e93faaf75b4abe7ae2017a5de44874b436d
**Base commit:** f2ca58581ad285277ca8df2664f466725fdbad6f
**Base ref:** main
**Spec hash:** 2204152d5d861268997f6f3deabf567850c3cb06e364c5455ef3ec7df67cdb01
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** claude
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-30T12:33:25Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** unknown (runtime did not expose exact model)
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-30T12:50:53Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `npx tsc --noEmit`: pass
- `npm test`: pass (22 files, 404 tests; 4 pre-existing live tests skipped)
- `npm run lint`: pass (0 errors; 2 pre-existing warnings outside this delta)
- `git diff --check`: pass

## Evidence

- Reviewed the complete `f2ca58581ad285277ca8df2664f466725fdbad6f..f9d25e93faaf75b4abe7ae2017a5de44874b436d` delta: migrations, store, reconciliation, types, and tests.
- `SqliteWorkflowStore` implements all 22 `WorkflowExecutionPersistence` methods plus the project and published-definition contracts; `engine.ts` is unchanged.
- Parity with the in-memory store checked for duplicate-id, missing-record, ordering, per-run filtering, and returned copies.
- Schema, indexes, foreign-key enforcement, and `user_version` refusal match the spec's data contract; all SQL is parameterized except a constant migration version.
- Tests cover 35 store cases, 8 migration cases, 10 reconciliation cases across both stores, and an engine-over-SQLite integration case.

## Findings

- F-10 [P3] open - new persistence files bypass the `@/` import alias
- F-11 [P2] open - a failed history append loses the interruption record
- F-12 [P3] open - the store accepts writes it cannot read back
- F-13 [P3] open - unique-versus-conflict classification reads SQLite message text
- F-14 [P3] open - missing duplicate-id, decode-branch, and update-rollback tests
- F-15 [P3] open - mutation-isolation test never mutates the stored input object
- No P0 or P1 findings.

## Remaining risk

- The reviewer model was not exposed by this runtime; recorded as unknown rather than guessed.
- This session runs on Reasonix; the `claude` reviewer adapter above is the user's explicit declaration, not runtime-proven.
- No security scanner or dependency-vulnerability command is configured, so no current vulnerability scan was performed.
- No browser or integration harness is configured; this feature has no UI, so none was needed.
- Runtime events have no retention cap by design; storage growth is deferred to later release or dashboard work.
