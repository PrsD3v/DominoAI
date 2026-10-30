# Feature: Runtime Profile persistence and migration

**From build-plan:** feature 11A Stage 4
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/runtime-profile-persistence-and-migration`
**Archive:** `blueprint/history/features/11A-stage-4-runtime-profile-persistence-and-migration.md`

## Goal

Persist and reconstruct the non-secret `RuntimeProfile` metadata introduced by
11A Stage 1 through the SQLite persistence layer built by Features 9 and 10, and
add the immutable migration that creates the profile table. This is the remaining
Stage 4 work. It does not add the later Settings API, Settings UI, real ACP Test
Connection, or project default-profile integration.

Stage 4 is unblocked: Features 9 and 10 are present on `main` (`f2ca585`,
`78b4e8b`) and provide the persistence contracts, SQLite database, migration
mechanism, store, and typed errors this stage reuses.

## In scope

- An application-owned `RuntimeProfilePersistence` contract with create,
  retrieve, and update. It uses the existing `RuntimeProfile` type from
  `src/types/runtime-settings.ts`; it does not introduce a second profile shape.
- Immutable SQLite migration 2 creating a `runtime_profiles` table with only
  non-secret columns. `SCHEMA_VERSION` becomes 2.
- A SQLite implementation of the contract in the existing workflow store,
  reusing its validation, error mapping, and decoding conventions.
- `credentialRef` reconstruction from the stored credential kind, provider name,
  and API-key environment variable name.
- Focused temporary-database tests for create, retrieve, update, credentialRef
  reconstruction, invalid input, corrupt stored rows, duplicate ids, migration,
  repeated startup, and the absence of secret columns or values.

## Out of scope

- The 11A Settings API, Settings UI, real ACP Test Connection, and project
  default-profile validation or integration. Those stages remain open.
- `listRuntimeProfiles`, delete, or any query the Stage 4 acceptance does not
  require. A later stage can add them.
- Changing `Project.defaultRuntimeProfileId`, or adding a foreign key from
  `projects` or `workflow_runs` to `runtime_profiles`. The project reference
  stays opaque until the later integration stage.
- Changes to Stage 1 validation, the Stage 2 credential file store, or the
  Stage 3 provider catalog.
- Reading, writing, logging, or returning a credential value. The store receives
  only the non-secret `CredentialRef`.
- Any ACP, Reasonix, engine, adapter, startup-reconciliation, dashboard, or
  project-registration change.
- Editing the user-owned build plan, overview, or execution history. The stale
  Stage 4 blocker is reported to the user, not fixed here.

## Build loop

`workflow.stepReview` is `feature`: implement all steps below, then present one
review packet. `workflow.checkpointCommits` is `disabled`, so do not create
per-step checkpoint commits. `/complete` creates the final feature commit. Keep
every step independently working and leave the existing suite green.

## Build steps

- [x] **Step 1 - Add the application-owned profile persistence contract.**
  In `src/types/persistence.ts`, import `RuntimeProfile` and `RuntimeProfileId`
  from `./runtime-settings` and add `RuntimeProfilePersistence` with
  `createRuntimeProfile`, `getRuntimeProfile`, and `updateRuntimeProfile`.
  *Done when:* the contract compiles, no runtime file changes, and
  `npx tsc --noEmit` passes. The profile shape still comes only from the existing
  `RuntimeProfile`; no duplicate profile type exists.

- [x] **Step 2 - Add migration 2 and prove the v1-to-v2 upgrade.**
  In `src/lib/workflow/sqlite/migrations.ts`, set `SCHEMA_VERSION = 2` and append
  one immutable migration that creates:

  ```sql
  CREATE TABLE runtime_profiles (
    id TEXT NOT NULL PRIMARY KEY,
    label TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key_env TEXT NOT NULL,
    credential_kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  ```

  Do not edit migration 1 and do not change existing tables. In
  `src/lib/workflow/sqlite/migrations.test.ts`, add `runtime_profiles` to the
  expected table list and add one upgrade test: open a database, insert a
  `workflow_definitions` row, drop `runtime_profiles`, set `PRAGMA user_version =
  1`, close, then reopen and assert `user_version` is 2, `runtime_profiles`
  exists, and the existing definition row is intact.
  *Done when:* the upgrade test passes, every existing migration test keeps its
  assertions, `npm test -- src/lib/workflow/sqlite/migrations.test.ts` passes,
  and `npx tsc --noEmit` passes.

- [x] **Step 3 - Implement profile persistence in the SQLite store.**
  In `src/lib/workflow/sqlite/sqlite-store.ts`, make `SqliteWorkflowStore` extend
  `RuntimeProfilePersistence` and add the three methods. Reuse the existing
  `insertRow`, `requireUpdated`, `requireValidDefinition`, `readString`,
  `decodeFailure`, `WorkflowRecordError`, and `WorkflowPersistenceError` helpers.
  - `createRuntimeProfile`: validate with `isRuntimeProfile`; invalid input is a
    `WorkflowPersistenceError` with code `invalid` and writes nothing. A duplicate
    id is a `WorkflowRecordError` with operation `create` and record kind
    `runtime profile`.
  - `getRuntimeProfile`: return `null` when absent. Reconstruct
    `credentialRef: { kind, providerName, apiKeyEnv }` from `credential_kind`,
    `provider_name`, and `api_key_env`, plus the top-level fields. Validate the
    reconstructed profile with `isRuntimeProfile`; a corrupt row is a
    `WorkflowPersistenceError` with code `decode`.
  - `updateRuntimeProfile`: validate the input, write the full record (matching
    `updateProject`; callers supply the existing `createdAt`), and map a missing
    id to a `WorkflowRecordError` with operation `update`.
  - Never store `credentialRef` as JSON and never add a secret column.

  Add `src/lib/workflow/sqlite/runtime-profiles.test.ts` with temporary-file
  databases covering the round trip, reconstruction, update, duplicate id,
  missing update, invalid input (including an extra secret-like field), and a
  manually corrupted row.
  *Done when:* those tests pass, `npx tsc --noEmit` passes, and the table exposes
  exactly the nine non-secret columns above.

- [x] **Step 4 - Prove restart persistence and close the verification loop.**
  Add file-backed restart coverage to the same test file: open a store, create a
  profile, close it, reopen twice, and assert the profile is identical, the schema
  version stays 2, and a second create with the same id still rejects as a
  duplicate because the row survived. Run the full suite and the typecheck.
  *Done when:* the restart test passes, the full `npm test` run has no new
  failures, and `npx tsc --noEmit` passes.

## Files / areas

- `src/types/persistence.ts` - new `RuntimeProfilePersistence` contract.
- `src/lib/workflow/sqlite/migrations.ts` - `SCHEMA_VERSION` 2 and migration 2.
- `src/lib/workflow/sqlite/migrations.test.ts` - expected table list and one
  upgrade test. This is the only existing test that changes, and only additively.
- `src/lib/workflow/sqlite/sqlite-store.ts` - store implementation.
- `src/lib/workflow/sqlite/runtime-profiles.test.ts` - new focused tests.
- No changes to `src/types/runtime-settings.ts`,
  `src/lib/runtime/reasonix/env-file-store.ts`,
  `src/lib/runtime/reasonix/provider-catalog.ts`,
  `src/lib/projects/registration.ts`, the app UI, or `package.json`.

## Data / contracts

- `RuntimeProfilePersistence`:
  - `createRuntimeProfile(profile: RuntimeProfile): Promise<void>`
  - `getRuntimeProfile(id: RuntimeProfileId): Promise<RuntimeProfile | null>`
  - `updateRuntimeProfile(profile: RuntimeProfile): Promise<void>`
- Table `runtime_profiles`: one row per profile, keyed by the stable Domino
  profile id. `created_at` and `updated_at` are the validated ISO-8601 strings
  from `RuntimeProfile`. No credential value, secret, token, password, or
  credential JSON column exists.
- `credentialRef` is derived on read from `credential_kind`,
  `provider_name`, and `api_key_env`. The reconstructed object must agree with
  the top-level `providerName` and `apiKeyEnv`; `isRuntimeProfile` enforces that
  and rejects any unknown adapter, kind, empty field, or malformed timestamp.
- The store does not generate ids or defaults; the caller supplies the stable
  Domino profile id and both timestamps. No profile value is optional.
- Error behavior: invalid input is `WorkflowPersistenceError` code `invalid`;
  duplicate create and missing update are `WorkflowRecordError`; a stored row
  that no longer validates is `WorkflowPersistenceError` code `decode`. Those
  cases map to typed errors; unrelated storage failures still propagate as their
  original error, matching the existing store.
- Migration behavior: version 2 is additive and backfills nothing. A version 1
  database upgrades in place on open. A database written by a newer build is
  still refused with the existing `schema` error. A version 1 build that opens a
  version 2 database refuses it; that is the intended forward-compatibility rule,
  not data loss.
- Contract impact on existing work:
  - Stage 1 is unchanged; its `RuntimeProfile` and validation are reused as the
    only profile shape.
  - Stage 2 and Stage 3 are unchanged; persistence never calls the credential
    file store or the provider catalog.
  - Features 9 and 10 are unchanged; the engine, execution contracts, and startup
    reconciliation never read profiles. `SqliteWorkflowStore` only widens by
    extending the new interface, so existing methods and callers keep working.

## Testing

- Commands: `npm test` and `npx tsc --noEmit`. Focused run:
  `npm test -- src/lib/workflow/sqlite/migrations.test.ts src/lib/workflow/sqlite/runtime-profiles.test.ts`.
- In this environment `node` and `npm` are not on the default `PATH`; use
  `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` before running them.
- Baseline observed on 2026-10-30, before any change:
  - `npm test` passed 422 tests, with 4 skipped, in 23 passing test files (4
    skipped files).
  - One earlier full run failed `serializes simultaneous stale-lock takeover` in
    `src/lib/runtime/reasonix/env-file-store.test.ts` with a
    `CredentialLockError` after 500 ms. The file then passed 46/46 on rerun, so
    the test is timing-flaky. It is pre-existing and out of scope here; do not
    change Stage 2 to fix it, and do not count a single flaky failure as a new
    regression.
  - `npx tsc --noEmit` exited 0.
  - Stage 1 to 3 tests: 19 + 46 + 18 = 83 passing, in
    `src/types/runtime-settings.test.ts`,
    `src/lib/runtime/reasonix/env-file-store.test.ts`, and
    `src/lib/runtime/reasonix/provider-catalog.test.ts`.
- Stage 4 tests are the only new ones: temporary-database round trip, update,
  credentialRef reconstruction, duplicate id, missing update, invalid input,
  corrupt row, migration upgrade, repeated startup, and the absence of secret
  columns or values.
- Final Stage 4 verification on 2026-10-30: `npm test` passed 433 tests with 4
  skipped in 24 passing test files; `npx tsc --noEmit` exited 0; `npm run lint`
  reported 0 errors and 2 pre-existing warnings in
  `src/lib/runtime/acp/protocol.test.ts` and
  `src/lib/runtime/reasonix/env-file-store.ts`.
- No live Reasonix, credential, provider, network, browser, or UI evidence is in
  scope or may be claimed.

## Notes for the AI

- Existing 11A work is implemented and verified, not planned:
  - Stage 1 contracts: `f99b40d`, `src/types/runtime-settings.ts`, 19 tests.
  - Stage 2/2.1 credential file store: `0b7136a`,
    `src/lib/runtime/reasonix/env-file-store.ts`, 46 tests.
  - Stage 3 provider/model catalog: `982356f`,
    `src/lib/runtime/reasonix/provider-catalog.ts`, 18 tests.
  - All are present on `main`, unchanged since their commits, and their tests
    pass. Do not rebuild, replace, or refactor them.
- Features 9 and 10 provide the reusable layer:
  `src/types/persistence.ts`, `src/types/workflow.ts`,
  `src/lib/workflow/persistence-errors.ts`,
  `src/lib/workflow/sqlite/migrations.ts` (`SCHEMA_VERSION` and
  `applyMigrations`), and `src/lib/workflow/sqlite/sqlite-store.ts`
  (`openSqliteWorkflowStore`, `insertRow`, `requireUpdated`,
  `requireValidDefinition`, `readString`, `decodeFailure`).
- Historical status is stale. `blueprint/build-plan.md` and
  `blueprint/context/project-overview.md` still say Stage 4 is blocked because
  Features 9 and 10 are not present; the current repository disproves that.
  `blueprint/context/execution-history.md` repeats the old `BLOCKED` label and
  "known gaps". No Feature 11A spec or archive exists in Git history; Stages 1
  to 3 were implemented as direct commits. Report these discrepancies in the
  review handoff instead of editing the user-owned plans or history.
- This is a stage-scoped build identity chosen by the user. Use the frozen
  archive path and branch above; do not re-derive a numeric feature id or bump
  the build attempt.
- At `/complete`, check off only the `Stage 4` sub-item in
  `blueprint/build-plan.md`; leave Feature 11A and its later stages open. This
  spec does not complete Feature 11A.
- Keep the change additive. Do not edit migration 1, do not add dependencies,
  and do not add profile listing, deletion, foreign keys, API routes, or UI.
- Validate at the persistence boundary before writing. The store must reject a
  secret-bearing or otherwise invalid profile even when a caller bypasses the
  TypeScript type.
- `updateRuntimeProfile` writes the full record, matching `updateProject`; the
  caller supplies the existing `createdAt`.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":13737,"specSha256":"ff3d1d1ae38f784ef31a7d4954b987c3b00a3f5c29c5bec0138590416205cd73","branch":"refs/heads/feature/runtime-profile-persistence-and-migration","head":"15e259c02b582c596f1c7ef5e7422aa24765fddc","baseRef":"refs/heads/main","baseCommit":"6cafcb5539cdb34303ace56f3ea0a9d920c49491","sourceTree":"2ac5cf34840304267a6042201c00b8e7150ae04f","landing":"local-merge","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 15e259c02b582c596f1c7ef5e7422aa24765fddc
**Base commit:** 6cafcb5539cdb34303ace56f3ea0a9d920c49491
**Base ref:** main
**Spec hash:** ff3d1d1ae38f784ef31a7d4954b987c3b00a3f5c29c5bec0138590416205cd73
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-30T19:22:10Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-30T19:34:12Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD`: pass (`15e259c02b582c596f1c7ef5e7422aa24765fddc`, equals `Target commit`)
- `git merge-base main 15e259c02b582c596f1c7ef5e7422aa24765fddc`: pass (`6cafcb5539cdb34303ace56f3ea0a9d920c49491`, equals `Base commit`, base ref `main` still resolves)
- `sha256sum blueprint/context/current-feature.md`: pass (`ff3d1d1ae38f784ef31a7d4954b987c3b00a3f5c29c5bec0138590416205cd73`, equals `Spec hash`)
- `git status --porcelain`: pass (only `blueprint/context/findings.md` and `blueprint/context/review.md`, the two permitted evidence paths)
- `git log --oneline 6cafcb5539cdb34303ace56f3ea0a9d920c49491..15e259c02b582c596f1c7ef5e7422aa24765fddc`: pass (one commit, `15e259c chore: checkpoint 11A stage 4 for independent review`)
- `npx tsc --noEmit`: pass (exit 0, no output)
- `npm test`: pass (24 test files passed, 4 pre-existing live files skipped; 433 tests passed, 4 skipped)
- `npm test -- src/lib/workflow/sqlite/migrations.test.ts src/lib/workflow/sqlite/runtime-profiles.test.ts`: pass (2 files, 19 tests)
- `npm run lint`: pass (0 errors; the 2 warnings are pre-existing and in `src/lib/runtime/acp/protocol.test.ts` and `src/lib/runtime/reasonix/env-file-store.ts`, both outside this delta)
- `git diff --check 6cafcb5539cdb34303ace56f3ea0a9d920c49491..15e259c02b582c596f1c7ef5e7422aa24765fddc`: pass (no whitespace errors)
- `node --input-type=module -e '<node:sqlite UPDATE changes probe>'`: pass (identical-value update reports `changes: 1`, missing row reports `0`)
- `node --input-type=module -e '<node:sqlite BLOB and NULL probe>'`: pass (a `Buffer` in a `TEXT NOT NULL` column reads back as `Uint8Array`; explicit `NULL` is refused by `NOT NULL`)

### Evidence

- Reviewed the complete `6cafcb5539cdb34303ace56f3ea0a9d920c49491..15e259c02b582c596f1c7ef5e7422aa24765fddc` delta from a fresh context with no builder conversation: `src/types/persistence.ts` (+15), `src/lib/workflow/sqlite/migrations.ts` (+18/-1), `src/lib/workflow/sqlite/migrations.test.ts` (+34), `src/lib/workflow/sqlite/sqlite-store.ts` (+96/-1), `src/lib/workflow/sqlite/runtime-profiles.test.ts` (new, 247 lines), and the verified spec. Code scope excluded the request and the ledger.
- Contract (`src/types/persistence.ts:37-46`): `RuntimeProfilePersistence` adds exactly the three documented methods, imports the existing `RuntimeProfile` and `RuntimeProfileId` from `./runtime-settings`, and introduces no second profile shape.
- Migration (`migrations.ts:5`, `:149-164`): `SCHEMA_VERSION` is 2 and migration 2 is one additive `CREATE TABLE runtime_profiles` with the nine spec-listed columns; migration 1 and every existing table are untouched, and `applyMigrations` still refuses a newer-than-supported version.
- Upgrade coverage (`migrations.test.ts:31`, `:91-124`): `runtime_profiles` was added to the expected table list in sorted position, and the new test creates a v2 database, inserts a `workflow_definitions` row, drops `runtime_profiles`, forces `PRAGMA user_version = 1`, reopens, and asserts `user_version === SCHEMA_VERSION`, the recreated table, and the surviving definition row. Existing migration assertions are unchanged.
- Store surface (`sqlite-store.ts:543-556`, `:323-337`, `:522-548`, `:1089-1141`): `SqliteWorkflowStore` only widens by extending the new contract; all SQL is parameterized; the insert and update column orders match `runtimeProfileParameters` exactly, and the update reuses the same `slice(1)` + id shape as `updateRun` (`:606`).
- Write path (`sqlite-store.ts:1089-1105`, `:1116-1141`): both writers validate with `isRuntimeProfile` before touching SQLite, so a secret-like extra field or empty field rejects with `WorkflowPersistenceError("invalid")` and writes nothing, duplicate ids map through `mapWriteError` to `WorkflowRecordError("create", "runtime profile", id)`, and a missing id maps through `requireUpdated` to operation `update`. This is the validate-then-write shape F-12 asks the older writers to adopt.
- Read path (`sqlite-store.ts:522-548`): `credentialRef` is reconstructed from `credential_kind`, `provider_name`, and `api_key_env`, so a rebuilt reference always agrees with the top-level provider and variable name; the whole object is then validated with `isRuntimeProfile`, and an unreadable or invalid row raises `WorkflowPersistenceError("decode")`.
- I verified the one plausible write-path hazard directly: SQLite reports `changes: 1` for an update that sets identical values, so an idempotent `updateRuntimeProfile` cannot raise a spurious missing-record error, while a genuinely missing row reports `0`.
- Security: no secret column, no credential JSON, and no read/write of a credential value exists anywhere in the delta; `api_key_env` stores an environment-variable name that `isRuntimeProfile` restricts with `ENV_NAME_PATTERN`, and the new test at `runtime-profiles.test.ts:148-168` proves a secret-bearing object is rejected and leaves no row. Every statement is parameterized, so there is no injection surface.
- Performance: profile access is a single primary-key lookup and single-row writes; there is no list method, no unbounded loop, and no extra round trip in the delta.
- Tests (`runtime-profiles.test.ts`, 10 cases): file-backed temporary databases cover the round trip plus credentialRef identity, the null result, update, invalid update leaving the stored row intact, duplicate id, missing update, invalid input including a secret-like field, a corrupt row, the exact nine-column table shape, and repeated startup (reopen twice, then duplicate rejection and `user_version` 2). Cleanup uses `mkdtemp` plus `rm(..., { recursive: true, force: true })` on isolated paths, and store closes are idempotent (`migrations.ts:246-252`), so the double close in `afterEach` is safe. No skipped, focused, or placeholder tests were added.
- Spec drift checked against the code rather than assumed: the nine-column table, the three method signatures, the error mapping, the additive migration, and the "no secret value" rule all match `current-feature.md`. The spec's own note about stale plan text is accurate: `blueprint/build-plan.md:91` still records Stage 4 as blocked because Features 9 and 10 were absent. Per the spec this was reported, not edited.
- Lenses were run together over the whole delta; the two findings below are the only ones the review produced, and both are P3.

### Findings

- F-20 [P3] open - The validity guard dereferences the value it is guarding (`sqlite-store.ts:1090`, `:1117`)
- F-21 [P3] open - Only the shape branch of the profile decode path is tested (`runtime-profiles.test.ts:170`)
- No P0, P1, or P2 finding was raised in this delta.
- Re-checked with no status change: F-10 (the new import sites `sqlite-store.ts:13` and `runtime-profiles.test.ts:5` repeat the relative-import drift) and F-12 (the new writers do validate before writing, so the write/read asymmetry stays confined to the run, step, history, and event writers).
- F-01 through F-19 are untouched by this delta and keep their recorded status.

### Remaining risk

- The reviewer model `deepseek/deepseek-flash` comes from the runtime's own subagent usage receipts (`~/.reasonix/stats/2026-10-30.jsonl`, `usage_source: "subagent"`, requests at 23:01-23:03 +03:30, which is 19:31-19:33Z). This session printed no model identifier of its own, so the value is runtime-recorded rather than session-reported.
- The request declares the `codex` reviewer adapter. This host is the Reasonix runtime, which exposed no adapter identifier; the adapter identity is declared metadata, confirmed only as far as the `.agents/` codex skill tree that this review actually read.
- Check was not run because the request records `Check required: no` (`qualityGates.regular.check` is `manual`). No `Verify` command, no `Browser tests` command, and no dependency-vulnerability or security-scanner command are configured, so no current vulnerability scan and no browser evidence were produced; this feature has no UI, so neither was applicable.
- No profiler, benchmark, or runtime timing evidence exists; the performance conclusions come from reading the code paths.
- F-20 was established by reading the argument-evaluation order, not by executing a `null` call against the store, so its reachability depends on a caller that bypasses the TypeScript type.
- Concurrency was not exercised: profile writes are single statements whose duplicate handling relies on the primary-key violation, and no test covers two stores writing the same id at once.
- The verified spec is part of this checkpoint, so the `current-feature.md` diff was reviewed only for consistency with the code, not as product code.
- `blueprint/.state/run.json` was not updated by this reviewer session, because the contract limits an isolated reviewer to the two evidence files; dashboard activity remains the builder's to publish.
