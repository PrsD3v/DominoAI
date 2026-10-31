# Feature: Project default-profile integration

**From build-plan:** feature 11A Stage 8
**Build attempt:** 1
**Branch:** `feature/project-default-profile-integration`
**Status:** verified

## Goal

Let a registered project carry an optional default runtime profile id that the
settings API can read, set, and clear, and reject any id that does not match a
persisted runtime profile. The project record keeps only the opaque id; no
provider, model, or credential field is copied onto it.

## In scope

- Registration-time existence validation for an optional
  `defaultRuntimeProfileId`, using the persisted profile table.
- Read, set, and clear operations on the existing settings service, with typed
  non-secret errors.
- A `/api/settings/projects/[id]` GET/PATCH route that exposes those operations,
  reusing the Stage 5 request and error helpers.
- Temporary-database service tests and route-handler tests covering set, clear,
  unknown profile ids, malformed bodies, and unknown projects.
- The two catalog entries the exhaustive settings error catalog requires for the
  new `project_not_found` code.

## Out of scope

- Any project screen, project registration UI, or Settings-screen control. The
  user chose the service + route surface only; feature 14 folds project wiring
  into the dashboard.
- A project registration or listing API. Registration stays the Feature 11
  library operation.
- Deleting profiles, or repairing a project reference after a profile is removed.
  No profile delete operation exists, so no dangling-reference behavior is added.
- Selecting a workflow run's runtime profile from the project default. The engine
  already binds an opaque `runtimeProfileId`; consuming the project default is
  later dashboard work.
- Any schema migration: `projects.default_runtime_profile_id` already exists.
- Any read of a credential value or credential-status lookup.

## Build loop

`workflow.stepReview` is `feature`: implement all four steps, then present one
review packet. `workflow.checkpointCommits` is `disabled`, so no per-step commit;
`/complete` creates the final feature commit. Each step must leave `npm test` and
`npx tsc --noEmit` runnable.

## Build steps

- [x] Step 1: Validate the project's default profile id at registration.
  Extend `ProjectRegistrationStore` with `RuntimeProfilePersistence`, add a
  `unknown-profile-id` reason and a `profileId` error detail, and check
  `getRuntimeProfile(id)` after the existing non-empty-string validation and
  before `createProject`. Update the `FakeProjectStore` test double to implement
  the profile methods, seed a profile in tests that register a known id, and add
  tests for an unknown id (nothing stored) and a known id (stored unchanged).
  **Done when:** registering with an absent profile id rejects with
  `unknown-profile-id` and writes nothing, a persisted profile id is stored as the
  same opaque string, and `npx vitest run src/lib/projects/registration.test.ts`
  passes.

- [x] Step 2: Add the read/set/clear operations to the settings service.
  Add `projects: ProjectPersistence` to `SettingsServiceDeps`, add
  `getProjectDefaultProfile(projectId)` and
  `updateProjectDefaultProfile(projectId, input)` to `SettingsService`, and pass
  the SQLite store from `createSettingsServiceFromEnvironment`. The update input
  accepts exactly `{ defaultRuntimeProfileId: string | null }`: `null` clears,
  a non-empty string must exist in `RuntimeProfilePersistence`, and anything else
  is `invalid_request` with a field error. An absent project is
  `project_not_found`; an absent profile is `profile_not_found`; a store failure
  is `persistence_error`. Persist with an explicit `Project` rebuild that either
  includes the opaque id or omits the field, and updates only `updatedAt`. Add
  `project_not_found` to `SETTINGS_ERROR_CODES`, its message map, the HTTP status
  map (404), and both `en`/`fa` catalogs. Add a temporary-SQLite-database test
  group covering set, clear, unknown id, malformed value, extra field, missing
  key, and unknown project.
  **Done when:** the temporary-database tests prove a set changes only the opaque
  id and `updatedAt`, a clear removes the field from the decoded record, and an
  unknown id or project changes nothing, and
  `npx vitest run src/lib/settings/service.test.ts` passes.

- [x] Step 3: Expose the operations at `/api/settings/projects/[id]`.
  Add `src/app/api/settings/projects/[id]/route.ts` with exported
  `handleGetProjectDefaultProfile` and `handleUpdateProjectDefaultProfile`, a
  `GET` that awaits `connection()` and a `PATCH` that requires
  `application/json`. Both return `{ projectId, defaultRuntimeProfileId }`, where
  a cleared value is `null`. Route errors flow through `handleSettingsRequest`.
  Add `SettingsProjectDefaultProfileResponse` to `src/types/settings-api.ts` and
  route-handler tests for GET, PATCH set, PATCH clear, missing content type,
  invalid JSON, invalid field, unknown profile, and unknown project. Add the two
  new no-op stubs to the existing route-test `serviceWith` helpers so their
  `SettingsService` literals stay complete.
  **Done when:** `npx vitest run src/app/api/settings` passes and the route
  returns the documented shapes and statuses.

- [x] Step 4: Run the final verification.
  Run `npx tsc --noEmit`, then `npm test`. Confirm the touched suites pass and no
  previous suite regressed.
  **Done when:** typecheck passes and the full test run passes, recording any
  timing-flaky failure observed in `env-file-store.test.ts` and its isolated
  result rather than hiding it.

## Files / areas

- `src/lib/projects/registration.ts` and `registration.test.ts` - existence
  validation and the store contract.
- `src/lib/settings/service.ts` and `service.test.ts` - project default-profile
  operations, input parsing, typed errors, temporary-database tests.
- `src/lib/settings/runtime.ts` - pass the SQLite store as `projects`.
- `src/types/settings-api.ts` - `project_not_found` and the response type.
- `src/lib/settings/http.ts` - status mapping for `project_not_found`.
- `src/i18n/messages.ts` - `en` and `fa` messages for `project_not_found`.
- `src/app/api/settings/projects/[id]/route.ts` and `route.test.ts` - HTTP
  surface.
- Existing route tests under `src/app/api/settings/**` - complete the
  `serviceWith` stubs.

## Data / contracts

- Request body for `PATCH /api/settings/projects/:id`: exactly
  `{ "defaultRuntimeProfileId": string | null }`. A non-empty string sets, `null`
  clears, and a missing key, empty string, non-string, or extra field is
  `400 invalid_request` with `{ field, message }`.
- Success response for GET and PATCH: `200` with
  `{ "projectId": string, "defaultRuntimeProfileId": string | null }`.
- Failures: `415 unsupported_media_type`, `400 invalid_json`,
  `400 invalid_request`, `404 profile_not_found`, `404 project_not_found`,
  `500 persistence_error`, using the existing non-secret error body.
- Stored shape: `Project.defaultRuntimeProfileId` remains the opaque profile id
  string or is absent; clearing writes SQL `NULL` and omits the field on decode.
  All other project fields, including selections and `createdAt`, are unchanged;
  only `updatedAt` advances.
- Profile existence is checked through
  `RuntimeProfilePersistence.getRuntimeProfile(id)`, never through the catalog,
  the credential store, or a provider name.

## Testing

Tests are configured with Vitest, so this feature ships tests.

- Service tests use a temporary SQLite database opened with
  `openSqliteWorkflowStore({ path })`, create a real `RuntimeProfile` row, and
  assert through `getProject`/`listProjects` after set and clear; no credential
  value is involved.
- Route tests call the exported handlers with a stub `SettingsService` and a real
  `Request`, following the existing Stage 5 route tests.
- Registration tests extend the existing fake store and SQLite coverage.
- No browser test: this stage adds no UI and the project has no Browser tests
  command.
- Final evidence: `npx tsc --noEmit` and `npm test`, run in this checkout.

## Verification record

- `npx tsc --noEmit` - passed.
- `npx vitest run src/lib/settings src/app/api/settings src/lib/projects` - 10
  files, 114 tests passed.
- `npm test` - 546 passed, 4 skipped, 1 failed:
  `env-file-store.test.ts > serializes simultaneous stale-lock takeover`
  (`CredentialLockError` after 500 ms). The same test failed on the unmodified
  tree before this feature, and the file passes 46/46 in isolation on repeated
  runs. It was not repaired because it is outside Stage 8's scope.

## Notes for the AI

- Reuse `SettingsError`, `readJsonObject`, `requireJsonContentType`, and
  `handleSettingsRequest`; do not add a second error vocabulary or response
  envelope for this route.
- Do not add a migration, dependency, or credential read. The profile table and
  the project column already exist.
- Keep the settings service's existing behavior unchanged. Adding `projects` to
  its dependencies is wiring, not a redesign of profile or credential handling.
- `SETTINGS_ERROR_CODES` is exhaustive: the new `project_not_found` code needs
  entries in `service.ts` messages, `http.ts` statuses, and both locale catalogs,
  or the existing catalog and screen tests fail.
- The baseline full run on 2026-10-31 had one timing failure
  (`env-file-store.test.ts` > serializes simultaneous stale-lock takeover,
  `CredentialLockError` after 500 ms); that file passes 46/46 in isolation. Do not
  claim a green full run unless the rerun is actually green, and report this
  flake if it recurs.
- The branch slug is frozen: `feature/project-default-profile-integration`.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":9668,"specSha256":"837fe55e9cf234915106ac7d93a3fdaab5814383b20c5ac8947af9284962cf1d","branch":"refs/heads/feature/project-default-profile-integration","head":"a2f8e8596d7797446c70404a564d54dc92b46722","baseRef":"refs/heads/main","baseCommit":"a2f8e8596d7797446c70404a564d54dc92b46722","sourceTree":"11dd20090b2623361aa03dc89c9d42610ae6f523","landing":"local-merge","absentOptional":[]} -->
