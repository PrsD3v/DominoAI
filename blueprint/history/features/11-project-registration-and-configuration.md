# Feature: Project registration and configuration

**From build-plan:** feature 11
**Build attempt:** 1
**Branch:** `feature/project-registration-and-configuration`
**Status:** verified

## Goal

Register a workspace as a Domino Project through Feature 10's persistence
contract. Registration validates the workspace root at the moment of entry,
canonicalizes it with symlinks resolved, assigns a stable Domino id, records the
project configuration, the optional opaque default runtime profile reference, and
the selected published workflow and skill versions. A registered project survives
a store reopen, and a second project can select the same published workflow
version without changing it.

This feature delivers a server-side library boundary. The Projects screen, HTTP
API, and server safety controls belong to later features.

## In scope

- A new registration module under `src/lib/projects/` that writes through
  `ProjectPersistence` and `PublishedDefinitionPersistence` from
  `src/types/persistence.ts`.
- Registration-time validation and canonicalization of `workspaceRoot`:
  non-empty input, existing path, directory, and real path with symlinks
  resolved before storage.
- Rejection of any second project whose canonical root equals an existing
  project's canonical root.
- A stable Domino `id` generated with `randomUUID()` at registration, and
  `createdAt` / `updatedAt` ISO-8601 timestamps.
- Name validation, `configuration` defaulting to `{}` and requiring a
  JSON-serializable plain object, and an optional opaque
  `defaultRuntimeProfileId` guarded only against empty values.
- Selected `workflowVersionIds` and `skillVersionIds` stored in caller order;
  every selected id must reference an existing published version, and duplicates
  within either list are rejected. Empty selections are accepted.
- Read-back of the stored record so the returned `Project` reflects exactly what
  persistence will return.
- Focused Vitest coverage for every validation path plus SQLite durability,
  rejection atomicity, and shared-definition behavior.

## Out of scope

- Any UI, route handler, Server Action, or form. Feature 14 owns the Projects and
  Settings screens; Feature 15 owns loopback, cross-origin, and request-level
  validation.
- Re-implementing per-step workspace containment from Feature 9. Registration
  only validates and stores the root.
- Validating `defaultRuntimeProfileId` against a profile table. Feature 11A owns
  the profile table and that check; registration keeps the reference opaque.
- Publishing, editing, or versioning definitions. Feature 8 owns definitions and
  Feature 10 owns their storage.
- Schema changes or migrations. Migration version 1 already has `projects`,
  `project_workflow_versions`, and `project_skill_versions`.
- Updating, renaming, unregistering, or deleting projects; no such operation is
  in the build plan yet.
- Checking that every skill referenced by a selected workflow version's steps is
  also selected for the project. That semantic is not established.
- Multi-user ownership, tenancy, or concurrent registration coordination. The
  product is single-user and local; validation runs before the transactional
  insert.

## Build loop

`workflow.stepReview` is `feature`, so build both steps, then present one review
packet. `workflow.checkpointCommits` is `disabled`; do not create checkpoint
commits. `/complete` makes the final feature commit. Each logic-bearing step
ships its focused test in the same reviewed diff and `npm test` must be green
before the review packet.

## Build steps

- [x] **Step 1 - Registration validation, canonical root, and stored record** -
  Add `src/lib/projects/registration.ts` with `ProjectRegistrationError`
  (`reason` union named below), the `ProjectRegistrationInput` and
  `RegisterProjectOptions` types, a `ProjectRegistrationStore` based on
  `ProjectPersistence`, and `registerProject`. Validate name, configuration,
  optional profile id, and root; canonicalize the root with `realpath` and
  require a directory; reject a root already stored by `listProjects()`; generate
  the id and timestamps; call `createProject`; read the record back with
  `getProject` and return it. Add `registration.test.ts` using temporary
  directories and a minimal in-memory fake of `ProjectPersistence`.
  *Done when:* focused tests prove a successful registration stores the
  canonical root (symlink input stores its target), a stable UUID-shaped id, equal
  `createdAt`/`updatedAt`, the provided configuration, and the optional profile
  id; whitespace-only name, non-object or non-serializable configuration, empty
  profile id, empty/missing/file roots, and an already-registered canonical root
  each raise `ProjectRegistrationError` with the matching reason and store
  nothing; unknown filesystem errors propagate unchanged; `npm test` passes.

- [x] **Step 2 - Verified selections, durable restart, and shared definitions** -
  Widen the store contract to `ProjectRegistrationStore extends ProjectPersistence,
  PublishedDefinitionPersistence`. Before `createProject`, reject duplicate
  selection ids and reject any selected workflow or skill version that
  `getWorkflowVersion` / `getSkillVersion` cannot find. Add SQLite integration
  tests against a temporary database path using `openSqliteWorkflowStore`.
  *Done when:* tests prove a registered project is returned unchanged after
  closing and reopening the database (id, canonical root, name, configuration,
  optional profile id, ordered selections, timestamps); a rejected unknown
  selection or duplicate selection leaves no project and no selection rows;
  project B can select the same workflow version as project A and
  `getWorkflowVersion` still returns the identical published version;
  `npm test` and `npx tsc --noEmit` pass.

## Files / areas

- New: `src/lib/projects/registration.ts` - types, error, validation,
  canonicalization, and `registerProject`.
- New: `src/lib/projects/registration.test.ts` - validation unit tests (Step 1)
  and SQLite integration tests (Step 2).
- Reuse: `src/types/persistence.ts` (`Project`, `ProjectPersistence`,
  `PublishedDefinitionPersistence`).
- Reuse: `src/lib/workflow/sqlite/sqlite-store.ts`
  (`openSqliteWorkflowStore`) and `node:sqlite` via the existing store in tests.
- No changes to `src/types/workflow.ts`, the engine, the ACP adapter, migrations,
  or the app shell.

## Data / contracts

- Input:

  ```ts
  interface ProjectRegistrationInput {
    readonly name: string;
    readonly workspaceRoot: string;
    readonly configuration?: Record<string, unknown>;
    readonly defaultRuntimeProfileId?: string;
    readonly workflowVersionIds?: readonly string[];
    readonly skillVersionIds?: readonly string[];
  }

  interface RegisterProjectOptions extends ProjectRegistrationInput {
    readonly store: ProjectRegistrationStore;
  }

  interface ProjectRegistrationStore
    extends ProjectPersistence,
      PublishedDefinitionPersistence {}

  function registerProject(options: RegisterProjectOptions): Promise<Project>;
  ```

- Stored `Project`:
  - `id` - UUID string from `randomUUID()`, generated once and never changed.
  - `name` - stored exactly as supplied after a non-whitespace check; no
    trimming or case folding.
  - `workspaceRoot` - absolute real path of the supplied root, symlinks resolved
    by `realpath`. Relative input resolves against the process working directory;
    no `~` expansion.
  - `configuration` - plain object stored as JSON; defaults to a fresh `{}` when
    omitted; values must survive `JSON.stringify` without throwing.
  - `defaultRuntimeProfileId` - present only when supplied; opaque, non-empty,
    never inspected against profiles or credentials.
  - `workflowVersionIds` / `skillVersionIds` - caller order preserved, defaults
    to `[]`, no duplicates, every id must exist as a published version.
  - `createdAt` / `updatedAt` - ISO-8601, equal at registration.
- Return value is the record read back through `getProject`, so persistence
  normalization (for example JSON round-tripping) is visible to the caller.
- Error reasons on `ProjectRegistrationError`:
  `invalid-name`, `invalid-configuration`, `invalid-profile-id`, `root-missing`,
  `root-not-directory`, `root-inaccessible`, `duplicate-root`,
  `duplicate-selection`, `unknown-workflow-version`, `unknown-skill-version`.
  First failure wins in the order: name, configuration, profile id, root
  resolution, duplicate root, selections. All validation happens before
  `createProject`, which is already transactional, so a rejected registration
  writes nothing.
- Root filesystem mapping: empty input, `ENOENT`, or a broken symlink is
  `root-missing`; a resolved non-directory is `root-not-directory`; `EACCES` or
  `EPERM` is `root-inaccessible`; other errors propagate unchanged.
- Uniqueness: a canonical `workspaceRoot` identifies one project. Comparison is
  exact string equality over canonical paths, which `realpath` already
  normalizes for separators, trailing slashes, and symlinks.
- No credential or secret value is accepted or stored. `configuration` is
  ordinary user JSON and receives no secret-specific handling.

## Testing

- Runner: `npm test` (Vitest). Baseline observed before this spec: 22 test files
  passed, 4 live files skipped, 404 tests passed, 4 skipped. Typecheck:
  `npx tsc --noEmit`. No `Verify` command and no browser test command exist; this
  feature has no UI, so browser evidence does not apply.
- Step 1 unit tests use `mkdtemp` temporary roots and a small in-memory
  `ProjectPersistence` fake defined in the test file; they assert reasons and
  that nothing was written. They do not mock the filesystem.
- Step 2 integration tests use `openSqliteWorkflowStore` on a temporary database
  path, seed published definitions through the existing store, and reopen the
  database to prove restart persistence. They assert definition immutability by
  comparing workflow versions before and after the second registration.
- Cleanup follows the existing `rm(..., { recursive: true, force: true })`
  pattern; tests never touch a real workspace.

## Notes for the AI

- Keep this a library. Do not add `src/app/api/...`, a Server Action, a Projects
  screen, or localized strings in this feature.
- Depend only on the persistence contracts, `node:fs/promises`, `node:path`, and
  `node:crypto`. Do not import the workflow engine, the ACP adapter, or SQLite
  directly from the registration module.
- Use the `@/` alias for type-only imports, which Vitest erases without
  resolving. Runtime imports must stay relative because no tsconfig path-alias
  resolver is configured, and same-directory imports stay relative.
- `createProject` already enforces foreign keys; the explicit existence checks
  exist to produce typed `ProjectRegistrationError`s before any write, not to
  replace the database constraint.
- Do not add a schema migration. The project tables and selection tables already
  exist in schema version 1.
- Registration is the only write path in this feature; no update or delete
  operation is introduced.
- The resolved decisions to preserve: empty selections are valid because a
  workflow library may be empty at registration time; duplicate canonical roots
  are rejected because a registered root identifies one project and the
  workspace allowlist derives from these records.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":11395,"specSha256":"079deedbe4608c6800ea4c942e429912ff99bef977ba2ac3bd08066b50a0baa4","branch":"refs/heads/feature/project-registration-and-configuration","head":"013db9e0c97d8bcdc645ba9d6b579756b716e533","baseRef":"refs/heads/main","baseCommit":"78b4e8b924735731bc85d77c9dc24a5bb0811686","sourceTree":"416946eb8e475504b5636deea8c57666f9cab951","landing":"local-merge","absentOptional":[]} -->

## Findings

- None resolved in this work item. F-01 through F-19 remain open in the live
  ledger for later review.

## Independent review

**Status:** passed
**Target commit:** 013db9e0c97d8bcdc645ba9d6b579756b716e533
**Base commit:** 78b4e8b924735731bc85d77c9dc24a5bb0811686
**Base ref:** main
**Spec hash:** 079deedbe4608c6800ea4c942e429912ff99bef977ba2ac3bd08066b50a0baa4
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-30T13:11:27Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** unknown (runtime did not expose exact model)
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-30T13:16:30Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `npx tsc --noEmit`: pass (no output)
- `npm test`: pass (23 files passed, 4 pre-existing live files skipped; 422 tests passed, 4 skipped)
- `npm run lint`: pass (0 errors; 2 pre-existing warnings in `src/lib/runtime/acp/protocol.test.ts` and `src/lib/runtime/reasonix/env-file-store.ts`, both outside this delta)
- `git diff --check`: pass (also clean across the reviewed range)

## Evidence

- Freshness confirmed before review: `HEAD` is `013db9e0c97d8bcdc645ba9d6b579756b716e533`, `git merge-base main HEAD` is `78b4e8b924735731bc85d77c9dc24a5bb0811686`, `sha256sum blueprint/context/current-feature.md` is `079deedbe4608c6800ea4c942e429912ff99bef977ba2ac3bd08066b50a0baa4`, and `git status --porcelain` shows only `blueprint/context/review.md`.
- Reviewed the complete `78b4e8b924735731bc85d77c9dc24a5bb0811686..013db9e0c97d8bcdc645ba9d6b579756b716e533` delta: `src/lib/projects/registration.ts` (296 lines), `src/lib/projects/registration.test.ts` (477 lines), and the verified spec. One commit in the range.
- Validation order in `registerProject` matches the spec (name, configuration, profile id, root resolution, duplicate root, selections), and every `createProject` call happens after all checks, so a rejected registration writes nothing (`registration.ts:113-165`).
- Root handling matches the documented mapping for the three named codes: `realpath` canonicalizes symlinks, `stat` plus `isDirectory` produces `root-not-directory`, and duplicate detection compares canonical strings (`registration.ts:191-247`, `:237`).
- Selections preserve caller order, reject duplicates within each list, and check publication through `getWorkflowVersion`/`getSkillVersion` before the insert; empty selections are accepted (`registration.ts:249-283`). The returned record is the one read back through `getProject`, with a typed failure if persistence returns `null`.
- Security boundary: no secret, credential, or profile content is read or stored; `defaultRuntimeProfileId` stays opaque; no request surface, authorization, or injection path exists in this library. All SQLite access goes through the parameterized persistence contracts.
- Performance: registration does one `listProjects()` scan, one lookup per selected id, and one insert on a local single-user store; no unbounded loop, payload growth, or blocking hot path was found.
- Tests: 18 focused cases cover every `reason` in the union, the symlink and broken-symlink roots, unexpected filesystem error propagation, SQLite durability across a reopen, rejection atomicity against real `projects` and selection row counts, and shared-definition immutability. No skipped, focused, or placeholder tests; cleanup uses `mkdtemp` plus `rm(..., { recursive: true, force: true })` and no real workspace path.
- Behavior checks run directly against the module on Node 24 with a stub store: an explicit `null` configuration and `null` selection lists register successfully as `{}`, `[]`, `[]` (F-16), and a root routed through a file rejects with a raw `ENOTDIR` error rather than a typed reason (F-17).

## Findings

- F-16 [P3] open - An explicit `null` is silently treated as an omitted value
- F-17 [P3] open - `ENOTDIR` and `ELOOP` escape the typed registration reasons
- F-18 [P3] open - Canonical-root resolution is duplicated from containment with a different error taxonomy
- F-19 [P3] open - Three spec-stated validation behaviors have no test
- No P0 or P1 findings; F-01 through F-15 stay unchanged and none of their files are in this delta.

## Remaining risk

- The reviewer model was not exposed by this runtime; it is recorded as unknown rather than guessed.
- The `codex` reviewer adapter is the request's declared reviewer, confirmed only as far as the installed `.agents/skills` codex tree; this runtime exposed no adapter identifier, so the adapter identity remains declared metadata, not runtime proof.
- Check was not run because the request records `Check required: no` (`qualityGates.regular.check` is `manual`). No `Verify` command, no `Browser tests` command, and no dependency-vulnerability or security-scanner command exist in this project, so no current vulnerability scan and no browser evidence were produced; this feature has no UI, so neither was applicable.
- The duplicate-root check is a `listProjects()` read followed by a separate insert, with no coordination between concurrent registrations. The spec explicitly places concurrent registration out of scope, so this was not exercised and is unverified under concurrent writers.
- Duplicate detection compares stored root strings, so a project written directly through `createProject` with a non-canonical root would not match a later canonical registration. Unreachable while registration is the only write path, which is the current spec.
- Filesystem conditions were exercised on this host only: `root-inaccessible` was never taken (`EACCES`/`EPERM`), and no check covers a Windows or case-insensitive volume.
