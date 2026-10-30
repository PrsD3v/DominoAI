# Feature: Reasonix settings API

**From build-plan:** feature 11A Stage 5
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/reasonix-settings-api`
**Archive:** `blueprint/history/features/11A-stage-5-reasonix-settings-api.md`

## Goal

Expose the non-secret RuntimeProfile, provider/model catalog, and write-only
credential operations built in 11A Stages 1 to 4 through local JSON API routes.
A later Settings screen (Stage 6) and connection test (Stage 7) consume this API.
This stage adds no UI, no live ACP call, and no project default-profile change.

## In scope

- Add `listRuntimeProfiles` to the application-owned profile persistence
  contract and implement it in the existing SQLite store.
- A dependency-injected settings service that owns profile creation, listing,
  updating, catalog lookup, and credential set/remove/status. It derives
  `apiKeyEnv` from the provider catalog and never accepts or returns a secret
  except as the `PUT` credential request body.
- Server wiring that resolves the SQLite path, the Reasonix home, and the
  Reasonix executable from environment variables, opens the store lazily, and
  constructs the existing `ReasonixEnvFileStore` and catalog loader.
- Next.js route handlers under `src/app/api/settings/` with stable JSON error
  codes, a JSON content-type requirement on mutations, and no credential
  readback.
- Let `/api` paths bypass the locale proxy so API requests are not redirected to
  `/[locale]/api/...`.
- Document the environment variable names and ignore the default local database
  directory.

## Out of scope

- The Settings screen and any component, i18n catalog entry, theme, or form work
  (Stage 6). This stage returns stable error codes so Stage 6 can localize them.
- Test Connection and any ACP prompt, session, or live runtime call (Stage 7).
  Feature 3B remains blocked and no live capability is claimed here.
- Setting, clearing, or validating a Project's `defaultRuntimeProfileId`
  (Stage 8). `registerProject` keeps its current opaque non-empty-string check.
- Loopback binding, cross-origin rejection, authentication, and log redaction
  (feature 15). The build plan assigns those controls to feature 15, including
  this settings API. This stage must not claim protection it does not have.
- Profile deletion, provider creation or editing, Claude, MCP, and a Domino-owned
  credential store.
- Any new dependency. Zod exists only transitively; do not import it. Reuse
  `validateRuntimeProfile`, `validateCredentialRef`, and the Stage 3 parser.
- Changes to the `RuntimeProfile`, `CredentialRef`, or `CredentialStore` shapes,
  the `.env` file format, or the provider catalog parser.

## Build loop

`workflow.stepReview` is `feature`: implement all steps below and present one
review packet. `workflow.checkpointCommits` is `disabled`, so do not create
per-step checkpoint commits. `/complete` creates the final feature commit. Keep
every step independently working and leave the suite green.

## Build steps

- [x] **Step 1 - Add profile listing to the persistence contract.**
  In `src/types/persistence.ts`, add
  `listRuntimeProfiles(): Promise<readonly RuntimeProfile[]>` to
  `RuntimeProfilePersistence`. Implement it in
  `src/lib/workflow/sqlite/sqlite-store.ts` with
  `SELECT * FROM runtime_profiles ORDER BY created_at ASC, id ASC`, decoding
  every row through the existing `decodeRuntimeProfile`. Do not add a migration;
  the table already exists.
  Add coverage in `src/lib/workflow/sqlite/runtime-profiles.test.ts` for an empty
  list, deterministic ordering by `created_at` then `id`, and a round trip of
  all persisted fields.
  *Done when:* the focused test file passes, no migration changes, and
  `npx tsc --noEmit` passes.

- [x] **Step 2 - Build the settings service with injected dependencies.**
  Add `src/lib/settings/service.ts` exporting `SettingsError` (stable `code`,
  optional `fields`, no upstream message or secret), `SettingsProfileView`
  (`{ profile: RuntimeProfile; credentialStatus: CredentialStatus }`), the
  service interface, and `createSettingsService(deps)` with
  `deps: { profiles: RuntimeProfilePersistence; credentials: CredentialStore;
  loadCatalog: () => Promise<RuntimeProviderCatalog>; now?: () => string;
  newId?: () => string }`. Default `newId` is `crypto.randomUUID()` and default
  `now` is `new Date().toISOString()`.
  - Create input is exactly `{ label, providerName, model }`: all strings,
    non-empty, no extra keys. The server owns `id`, `adapterId: "reasonix"`,
    `apiKeyEnv`, `credentialRef`, `createdAt`, and `updatedAt`.
  - The provider must exist in the loaded catalog, the model must be listed for
    it, and the catalog must report a non-null `apiKeyEnv`. The catalog value is
    the only source for `apiKeyEnv`; a client cannot supply it.
  - Update input is the same full `{ label, providerName, model }` object and
    re-derives the catalog fields. It preserves `id` and `createdAt` and sets
    `updatedAt` to `now()`. Unknown ids are `profile_not_found`.
  - Listing reads all profiles and reports credential presence per profile,
    caching the `CredentialStore.status` result per `apiKeyEnv` within one call.
    It never writes or returns a secret.
  - `setCredential(id, input)` accepts exactly `{ secret: string }`, calls
    `CredentialStore.set`, and returns the post-write status.
    `removeCredential(id)` calls `CredentialStore.remove` and returns the
    post-remove status. `getCredentialStatus(id)` returns presence only. Every
    one of them first requires an existing profile.
  - Revalidate the assembled profile with `validateRuntimeProfile` before
    persistence. Translate catalog, persistence, and credential-store failures
    into `SettingsError` codes below without copying upstream details.
  Add `src/lib/settings/service.test.ts` using a fake catalog, an in-memory
  profile store, and a fake credential store. Cover create, list with shared
  `apiKeyEnv`, update, unknown profile, unknown provider, unknown model, null
  `apiKeyEnv`, extra input keys, invalid secret mapping, set/remove/status, and
  that every returned value is JSON-serializable with no secret-bearing field.
  *Done when:* those tests pass and `npx tsc --noEmit` passes.

- [x] **Step 3 - Wire paths, the SQLite store, and the Reasonix adapters.**
  Add `src/lib/settings/runtime.ts` with a pure
  `resolveSettingsPaths(env, homeDir, cwd)` returning
  `{ databasePath, reasonixHome, reasonixBin }`. Defaults: database
  `<cwd>/.domino/domino.db`, Reasonix home `<homeDir>/.reasonix`, executable
  `reasonix`. `DOMINO_DB_PATH`, `DOMINO_REASONIX_HOME`, and
  `DOMINO_REASONIX_BIN` override them; an empty or whitespace-only value counts
  as unset. Paths are resolved to absolute paths.
  Add `createSettingsServiceFromEnvironment(env, homeDir, cwd)` that creates the
  parent database directory with mode `0700` when missing, opens
  `openSqliteWorkflowStore`, and builds `ReasonixEnvFileStore` plus
  `loadReasonixProviderCatalog`. Add an optional `command = "reasonix"`
  parameter to `runReasonixDoctor` so the settings loader can pass
  `reasonixBin`; keep the existing default and export shape.
  `getSettingsService()` lazily builds and caches one service from
  `process.env`, `os.homedir()`, and `process.cwd()`, and returns the same
  instance on later calls (store it on `globalThis` so dev reloads do not open
  duplicate handles).
  Add `src/lib/settings/runtime.test.ts` covering default and override
  resolution, whitespace-only values, and a temporary directory proving the
  database parent is created with `0700` and the store opens there. Tests must
  never point at the real `~/.reasonix` or the repository `.env`.
  *Done when:* runtime tests pass, no file is written outside the temporary
  root, and `npx tsc --noEmit` passes.

- [x] **Step 4 - Add JSON helpers and the catalog plus profile collection routes.**
  Add `src/lib/settings/http.ts` with:
  - `readJsonObject(request)` returning `unknown` and raising
    `invalid_json` for unparseable or non-object bodies;
  - a mutation guard requiring `content-type` to start with
    `application/json` on `POST`, `PATCH`, and `PUT` bodies, raising
    `unsupported_media_type`;
  - `settingsErrorResponse(error)` mapping every `SettingsError` code to the
    status below and emitting `{ error: { code, message, fields? } }` with a
    short generic message. Never include upstream error messages, catalog
    details, file paths, or the request body.
  Add route handlers that import the cached service but export a named
  `handle...(request, service)` function the tests call directly:
  - `src/app/api/settings/providers/route.ts` - `GET` returns
    `{ catalog: RuntimeProviderCatalog }`.
  - `src/app/api/settings/profiles/route.ts` - `GET` returns
    `{ profiles: SettingsProfileView[] }`; `POST` returns
    `201 { profile: RuntimeProfile }`.
  Add handler tests in matching `route.test.ts` files using plain `Request`
  objects and a fake service. Cover success shapes, malformed JSON, the
  content-type guard, validation fields, `catalog_unavailable`, and the absence
  of any secret field in every response.
  *Done when:* handler tests pass and `npx tsc --noEmit` passes.

- [x] **Step 5 - Add profile update and write-only credential routes.**
  Add:
  - `src/app/api/settings/profiles/[id]/route.ts` - `PATCH` returns
    `{ profile: RuntimeProfile }`.
  - `src/app/api/settings/profiles/[id]/credential/route.ts` - `GET` returns
    `{ status: CredentialStatus }`; `PUT` accepts `{ secret }` and returns
    `{ status }`; `DELETE` returns `{ status }`.
  Await the route `params` promise (Next 16) and pass the decoded id to the
  service. Add handler tests for `200`, `404 profile_not_found`, malformed JSON,
  `400 invalid_secret`, and credential error mapping. Assert that no response
  contains the submitted secret and that `PUT` never echoes it.
  *Done when:* handler tests pass and `npx tsc --noEmit` passes.

- [x] **Step 6 - Let API paths bypass the locale proxy and document the env names.**
  In `src/proxy.ts`, return `NextResponse.next()` for `pathname === "/api"` or a
  pathname starting with `/api/` before any locale redirect or cookie write.
  Add `src/proxy.test.ts` proving `/api/settings/providers` is not redirected
  while `/settings` still redirects to the default locale and `/fa/settings`
  sets the locale cookie.
  Add `.env.example` containing only the three variable names with empty values
  and short comments, and add `!.env.example` plus `/.domino/` to `.gitignore`
  so the example is tracked and the default database directory is not.
  *Done when:* proxy tests pass, `git status` shows no generated database files,
  and `npx tsc --noEmit` passes.

- [x] **Step 7 - Run the full verification pass.**
  Run the focused settings and SQLite tests, then the full suite, typecheck, and
  a production build. Review the final diff for stray files and confirm no secret
  value appears in any tracked file.
  *Done when:* `npm test` has no new failures, `npx tsc --noEmit` exits 0,
  `npm run build` succeeds, and the diff contains only the files named under
  Files / areas. If the build fails for an environment reason, record the exact
  error and do not waive it.

## Files / areas

- `src/types/persistence.ts` - add `listRuntimeProfiles`.
- `src/lib/workflow/sqlite/sqlite-store.ts` - implement listing.
- `src/lib/workflow/sqlite/runtime-profiles.test.ts` - list coverage.
- `src/lib/settings/service.ts` and `service.test.ts` - new business logic.
- `src/lib/settings/runtime.ts` and `runtime.test.ts` - new path and store wiring.
- `src/lib/settings/http.ts` - new JSON parsing and error mapping.
- `src/lib/runtime/reasonix/provider-catalog.ts` - optional executable parameter
  on `runReasonixDoctor`; parser unchanged.
- `src/app/api/settings/providers/route.ts` and `route.test.ts`.
- `src/app/api/settings/profiles/route.ts` and `route.test.ts`.
- `src/app/api/settings/profiles/[id]/route.ts` and `route.test.ts`.
- `src/app/api/settings/profiles/[id]/credential/route.ts` and `route.test.ts`.
- `src/proxy.ts` and `src/proxy.test.ts`.
- `.env.example`, `.gitignore`.
- No implementation changes to the UI, i18n catalog, `package.json`,
  `src/types/runtime-settings.ts`,
  `src/lib/runtime/reasonix/env-file-store.ts` behavior,
  `src/lib/projects/registration.ts`, the workflow engine, or the user-owned
  plans. The plan and overview were updated during this planning step; leave
  them untouched while building.

## Data / contracts

### Endpoints

| Method | Path | Request body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/settings/providers` | none | `200 { catalog }` |
| `GET` | `/api/settings/profiles` | none | `200 { profiles: [{ profile, credentialStatus }] }` |
| `POST` | `/api/settings/profiles` | `{ label, providerName, model }` | `201 { profile }` |
| `PATCH` | `/api/settings/profiles/:id` | `{ label, providerName, model }` | `200 { profile }` |
| `GET` | `/api/settings/profiles/:id/credential` | none | `200 { status }` |
| `PUT` | `/api/settings/profiles/:id/credential` | `{ secret }` | `200 { status }` |
| `DELETE` | `/api/settings/profiles/:id/credential` | none | `200 { status }` |

- `CredentialStatus` is `missing | present | unknown`. `present` never proves
  validity. No endpoint reads, returns, logs, or stores the key value.
- A returned `RuntimeProfile` keeps the Stage 1 shape, including the non-secret
  `credentialRef`. `apiKeyEnv` is always the catalog value for the selected
  provider; a provider without a reported `apiKeyEnv` cannot be selected.
- Request objects are closed: unknown fields are rejected with
  `invalid_request`. `POST` and `PATCH` require all three editable fields; neither
  accepts `id`, adapter, env name, reference, or timestamp fields from a client.
- JSON mutations require `content-type: application/json`.
- `PATCH` does not remove an existing credential entry when the provider or env
  name changes. The old entry stays in the Reasonix `.env`; the user owns it.

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `invalid_request` | 400 | Body shape or field value rejected; `fields` names the problems. |
| `invalid_json` | 400 | Body is not valid JSON or not a JSON object. |
| `unsupported_media_type` | 415 | Mutation body is not `application/json`. |
| `invalid_secret` | 400 | The credential store rejected the secret format. |
| `profile_not_found` | 404 | No profile has the id. |
| `provider_unknown` | 400 | Provider is not in the current catalog. |
| `model_unknown` | 400 | Model is not listed for the provider. |
| `api_key_env_unknown` | 400 | The provider reports no API-key environment name. |
| `catalog_unavailable` | 503 | `reasonix doctor --json` could not produce a catalog. |
| `credential_path_rejected` | 409 | Reasonix home is missing, a symlink, or not a directory. |
| `credential_file_invalid` | 409 | The existing `.env` file is malformed. |
| `credential_conflict` | 409 | The file changed under the writer. |
| `credential_locked` | 503 | Another writer holds the lock past the timeout. |
| `credential_unavailable` | 500 | Credential file read or write failed. |
| `persistence_error` | 500 | SQLite read or write failed. |

Error responses are `{ error: { code, message, fields? } }`; `message` is short,
generic, and English. Stage 6 maps codes to localized copy and keeps the code
next to the localized explanation.

### Persistence

- `RuntimeProfilePersistence` gains
  `listRuntimeProfiles(): Promise<readonly RuntimeProfile[]>`.
- Listing order is `created_at ASC, id ASC`, giving deterministic output.
- No schema change, no secret column, and no change to the migration version.

### Environment

| Name | Default | Use |
| --- | --- | --- |
| `DOMINO_DB_PATH` | `<cwd>/.domino/domino.db` | Local SQLite file. Parent directory is created with mode `0700`. |
| `DOMINO_REASONIX_HOME` | `<home>/.reasonix` | Directory containing the official Reasonix `.env`. |
| `DOMINO_REASONIX_BIN` | `reasonix` | Executable used for `reasonix doctor --json`. |

Empty or whitespace-only values count as unset. `.env.example` lists names only.

## Testing

- Commands: `npm test` and `npx tsc --noEmit`; focused runs use
  `npm test -- <paths>`. Add `npm run build` as the final integration check.
- In this environment `node` and `npm` are not on the default `PATH`. Prepend
  `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"`.
- Baseline observed on 2026-10-30 before any change: `npm test` passed 433 tests
  with 4 skipped in 24 passing test files; `npx tsc --noEmit` exited 0.
- Service tests use fakes only. Route-handler tests call the exported
  `handle...` functions with plain `Request` objects. Runtime tests use
  temporary directories. No test may touch the real `~/.reasonix`, the
  repository `.env`, or the real Reasonix CLI.
- Existing `runtime-profiles.test.ts` keeps its Stage 4 coverage; list tests are
  additive.
- No live Reasonix, credential-validity, network, browser, UI, or connection-test
  evidence is in scope or may be claimed. `reasonix doctor` is exercised only
  through a fake runner.

## Notes for the AI

- 11A Stages 1 to 4 are implemented: contracts `f99b40d`, credential file store
  `0b7136a`, provider catalog `982356f`, persistence `aa3e78b`. Reuse them; do
  not fork a second profile shape, credential store, or catalog parser.
- Feature 4 is complete, but Stage 5 makes no ACP call. Feature 3B stays blocked
  on a disposable credential and a writable Reasonix home; do not close it, run
  a live test, or imply that a saved profile works.
- `/api` currently falls through `src/proxy.ts` to the `[locale]` catch-all.
  Handle the bypass before writing route tests, or every API request will
  redirect.
- SQLite does not create missing parent directories. Create them before
  `openSqliteWorkflowStore`; do not let a store open fail with `ENOENT`.
- Never trust a client-supplied profile id, timestamp, adapter, env name, or
  credential reference. `validateRuntimeProfile` rejects unknown fields; the
  request parsers must reject them too.
- Never log a request body, secret, `.env` content, or catalog command output.
  Error messages must be generic; upstream classes may carry details.
- Feature 15 owns loopback binding and cross-origin rejection. Requiring JSON on
  mutations is request hygiene, not a replacement for feature 15, and must not
  be described as complete server protection.
- If `npx tsc --noEmit` reports missing generated route types after adding
  routes, run `npx next typegen` once first.
- Route `GET` handlers call `connection()` before opening the service. Without
  it, `npm run build` prerenders the synchronous SQLite query and creates
  `.domino/domino.db` inside the checkout. Mutation handlers already read a
  request body, so they stay request-time.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":18888,"specSha256":"4a4735fb5c6ab9b8d7dca61383e4c24414a10fdc4b8924eb89715f2f4afd85b5","branch":"refs/heads/feature/reasonix-settings-api","head":"32f3363f12c5eb1ad30a750473276b5f03c4966e","baseRef":"refs/heads/main","baseCommit":"aa3e78bd3bc0d0866ea5c1d68a67289b2dd7bcc7","sourceTree":"3fe6e21068d25262e5dcf77ab15e1d45405f530d","landing":"local-merge","absentOptional":[]} -->

## Findings

None resolved in this work item. F-22 to F-26 remain open in the live ledger.

## Independent review

**Status:** passed
**Target commit:** 32f3363f12c5eb1ad30a750473276b5f03c4966e
**Base commit:** aa3e78bd3bc0d0866ea5c1d68a67289b2dd7bcc7
**Base ref:** main
**Spec hash:** 4a4735fb5c6ab9b8d7dca61383e4c24414a10fdc4b8924eb89715f2f4afd85b5
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** deepseek/deepseek-flash
**Requested execution:** automatic
**Requested at:** 2026-10-30T20:34:43Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-30T20:44:23Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD`: pass (`32f3363f12c5eb1ad30a750473276b5f03c4966e`, equals `Target commit`)
- `git rev-parse --abbrev-ref HEAD`: pass (`feature/reasonix-settings-api`, the spec's declared work branch)
- `git merge-base main HEAD`: pass (`aa3e78bd3bc0d0866ea5c1d68a67289b2dd7bcc7`, equals `Base commit`; base ref `main` still resolves)
- `sha256sum blueprint/context/current-feature.md`: pass (`4a4735fb5c6ab9b8d7dca61383e4c24414a10fdc4b8924eb89715f2f4afd85b5`, equals `Spec hash`)
- `git status --porcelain`: pass (only ` M blueprint/context/review.md` before this pass wrote the ledger and receipt; `blueprint/context/findings.md` matched the target on entry)
- `npx tsc --noEmit`: pass (exit 0, no output)
- `npm test`: pass (31 test files passed, 4 pre-existing live-ACP files skipped; 480 tests passed, 4 skipped)
- `npm run build`: pass (11 static pages, all four `/api/settings/*` routes emitted as dynamic `ƒ`, no `.domino` directory created, `git status` unchanged afterwards)
- `npm run lint`: pass (0 errors; the 2 warnings are pre-existing, in `src/lib/runtime/acp/protocol.test.ts` and `src/lib/runtime/reasonix/env-file-store.ts`, both outside this delta)
- `git diff --check`: pass (no whitespace errors)

### Evidence

- Freshness was established before any review work: `HEAD` equals the target, `main` still yields the recorded merge base, the spec bytes still hash to `4a4735fb...85b5`, and no tracked, staged, unstaged, or untracked path differed from the target except the two permitted evidence files (`git status --porcelain`, `git ls-files -- blueprint/context/findings.md`).
- Delta reviewed (`git diff --stat aa3e78b..32f3363`): 24 files, +2311/-19. Code scope excluded `blueprint/context/review.md` and `blueprint/context/findings.md`. Reviewed in full: `src/lib/settings/service.ts` (432), `service.test.ts` (425), `runtime.ts` (93), `runtime.test.ts` (110), `http.ts` (95), the four `src/app/api/settings/**` handlers and their tests (21/38/32/70 + 73/156/132/178), `src/proxy.ts` (+5) and `src/proxy.test.ts` (31), the `listRuntimeProfiles` additions in `src/types/persistence.ts:46` and `src/lib/workflow/sqlite/sqlite-store.ts:1116-1123`, `runtime-profiles.test.ts` (+48), the `runReasonixDoctor(command)` change in `provider-catalog.ts:229-231`, `.env.example`, `.gitignore`, and the spec.
- Write-only credential handling: `SettingsService` exposes no credential read (`service.ts:97-105`); `setCredential` forwards the secret only to `CredentialStore.set` (`service.ts:403`); `setCredential`, `removeCredential`, and `getCredentialStatus` all return `CredentialStatus` (`service.ts:391-421`); the `PUT` handler responds `{ status }` only (`[id]/credential/route.ts:18-27`). Every service test asserts `JSON.stringify(...)` never contains the submitted secret (`service.test.ts:281`, `345-347`), the route test asserts the `PUT` body is not echoed (`[id]/credential/route.test.ts:75-77`), and the profiles response is asserted free of a `secret` key (`profiles/route.test.ts:72`).
- No secret can reach a response, error, log, or persisted row: `SettingsError` builds its message from the fixed `MESSAGES` table and never attaches an upstream message (`service.ts:40-81`); `credentialFailure` discards the store's message for all seven `CredentialStoreErrorCode` values (`service.ts:199-219`); `readJsonObject` and `requireJsonContentType` emit fixed messages (`http.ts:75`, `:93`); `settingsErrorResponse` serialises only `code`, `message`, and the caller-free `fields` list (`http.ts:30-46`); the service tests assert quoted upstream text such as `sk-test` and `raw upstream detail` never appears in a mapped error (`service.test.ts:256-258`, `:407`); no `console.*` call exists in any new module or route (`grep -rn "console\." src/lib/settings src/app/api/settings src/proxy.ts` returned nothing); `RuntimeProfile` carries no secret field and `validateRuntimeProfile` rejects unknown ones, which `assertValidProfile` runs before every write (`service.ts:247-253`, `:340`, `:373`); the SQLite schema and migration version are untouched.
- Input shapes are closed and server-owned: `parseProfileInput` rejects any key outside `label`/`providerName`/`model` (`service.ts:147`, `:167-169`), `parseSecretInput` rejects any key outside `secret` (`service.ts:185`), and `createProfile`/`updateProfile` construct the profile field-by-field so a client can never supply `id`, `adapterId`, `apiKeyEnv`, `credentialRef`, `createdAt`, or `updatedAt` (`service.ts:324-338`, `:359-371`). `updateProfile` preserves `id` and `createdAt` through the spread (`:360`) and re-derives the catalog fields.
- Catalog-derived `apiKeyEnv`: the only source is `provider.apiKeyEnv` inside `requireSelection`, which also rejects an unknown provider, an unlisted model, and a `null` env name (`service.ts:221-245`); the create and update tests pin the resulting value and assert the client-supplied `apiKeyEnv` is rejected (`service.test.ts:158`, `:169-189`, `:303`).
- Error-code to HTTP-status mapping matches the spec table row for row: all 15 codes are present in `SettingsErrorCode` (`service.ts:17-32`) and in `STATUS_BY_CODE` (`http.ts:7-23`), the `Record<SettingsErrorCode, number>` type makes the mapping total, and each value was compared against the spec's table (`current-feature.md:246-262`) one by one. Credential-store codes map as `unsafe_path` to 409, `parse` to 409, `conflict` to 409, `lock` to 503, `invalid_secret` to 400, and `invalid_ref`/`io` to 500 (`service.ts:199-219`), with a parameterised test over all six (`service.test.ts:378-408`).
- `listRuntimeProfiles`: the store decodes every row through the existing `decodeRuntimeProfile` with no migration change (`sqlite-store.ts:1116-1123`), and the new tests cover the empty table, deterministic `created_at` then `id` ordering with a tie, and a full field round trip that also proves the returned `credentialRef` is a fresh object (`runtime-profiles.test.ts:247-295`). `listProfiles` caches the status per `apiKeyEnv` within one call (`service.ts:302-314`), which is correct because `ReasonixEnvFileStore.status` resolves the entry from `ref.apiKeyEnv` only (`env-file-store.ts:509-528`); the shared-env test asserts exactly one status call for two profiles (`service.test.ts:260-282`).
- `/api` proxy bypass precedes every locale decision and cookie write (`proxy.ts:9-11`), and the test proves `/api/settings/providers` is not redirected while `/settings` still redirects to the default locale and `/fa/settings` still sets the locale cookie (`proxy.test.ts:7-30`).
- Build-time `connection()` usage: each `GET` handler awaits `connection()` before touching the service (`providers/route.ts:18`, `profiles/route.ts:29`, `[id]/credential/route.ts:46`), and the production build proves it: all four routes are reported as dynamic `ƒ`, no page was prerendered against SQLite, and `.domino` was absent from the checkout after `npm run build` while `git status` stayed clean apart from the permitted evidence file.
- Feature 15 deferral judged against the spec, not as a defect: loopback binding, cross-origin rejection, authentication, and log redaction are explicitly assigned to feature 15 for this API (`current-feature.md:43-45`), the spec calls the JSON content-type requirement "request hygiene, not a replacement for feature 15" (`:321-323`), and neither the code, the comments, nor the docs in this delta claim server protection. The one hygiene control that does exist is real: mutations reject a non-`application/json` body before parsing (`http.ts:86-95`), which the route tests exercise for `POST`, `PATCH`, and `PUT`.
- Tests prove stated behavior rather than mirroring it: the service suite uses a fake catalog, an in-memory profile store, and a fake credential store with `statusCalls` recording (`service.test.ts:47-107`), covers create, list with a shared `apiKeyEnv`, update preservation, unknown profile, unknown provider, unknown model, null `apiKeyEnv`, extra keys, invalid secret, set/remove/status, catalog-failure mapping, and persistence-failure mapping; the route suites call the exported `handle...` functions with plain `Request` objects and a service whose unused methods throw (`providers/route.test.ts:22-37` and the identical guard in the other two), so an unexpected call fails the test; `runtime.test.ts` uses `mkdtemp` roots only and asserts the created database directory is `0700` plus that the store opens there (`:88-109`), and no test points at `~/.reasonix` or the repository `.env`.
- Best-practice checks: no `any`, no skipped, focused, or todo tests in the new files (`grep -rn "\.only(\|\.skip(\|\.todo(\|xit(\|fit("` over the new and changed test files returned nothing), no em dash, en dash, or ellipsis character anywhere in the delta (byte scan of `git diff aa3e78b..32f3363`), no `@/*` alias use in the new files (recorded as F-22), no new dependency in `package.json`, and `.env.example` is tracked while `/.domino/` is ignored.

### Findings

- F-22 [P3] open - The new settings modules and API routes bypass the `@/` import alias (src/lib/settings/service.ts:2)
- F-23 [P3] open - Two spec-stated request shapes have no test (src/lib/settings/http.ts:78)
- F-24 [P3] open - The update race remap and the create/update persistence failures are untested (src/lib/settings/service.ts:377)
- F-25 [P3] open - Every catalog-reading request spawns `reasonix doctor` (src/lib/settings/service.ts:321)
- F-26 [P3] open - A failed store open returns an untyped 500 instead of a settings error (src/lib/settings/runtime.ts:64)
- No P0 or P1 finding is open: no secret can reach a response, error, log, or persisted row on any reachable path, the error codes and statuses match the spec exactly, the input shapes are closed, and typecheck, tests, lint, build, and `git diff --check` all pass.

### Remaining risk

- Check was not run because the request records `Check required: no` (`qualityGates.regular.check` is `manual`). No `Verify` command is configured in `AGENTS.md`, so this receipt rests on the typecheck, test, lint, build, and diff checks above and not on a spec-verification run.
- The reviewer model `deepseek/deepseek-flash` comes from the runtime's own subagent usage receipts (`~/.reasonix/stats/2026-10-31.jsonl`, `usage_source: "subagent"`, requests at 00:13-00:14 +03:30, which is 20:43-20:44Z). This session printed no model identifier of its own, so the value is runtime-recorded rather than session-reported.
- The request declares the `codex` reviewer adapter. This host is the Reasonix runtime, which exposed no adapter identifier; the adapter identity is declared metadata, confirmed only as far as the `.agents/` codex skill tree this review actually read.
- No live Reasonix CLI, `reasonix doctor`, credential-validity, network, browser, or UI evidence exists or may be claimed: the spec puts all of them out of scope, service and route tests use fakes only, and `reasonix doctor` is exercised through a fake runner. The "no secret in any response" claim is therefore proven by construction plus fake-backed tests, not by an end-to-end run with the real `ReasonixEnvFileStore`.
- Route-entry wiring is verified only by the build and the absent `.domino` directory: `connection()`, the awaited Next 16 `params` promise, and `getSettingsService()` are not covered by a test because the handlers are exercised through the exported `handle...` functions. A refactor that dropped `connection()` would show up as a generated `.domino/domino.db` after `npm run build` rather than as a test failure.
- No profiler, benchmark, or timing evidence was collected; F-25 and the catalog-per-request conclusion come from reading `service.ts:321`, `:357`, `runtime.ts:74-77`, and `provider-catalog.ts:229-256`.
- Concurrency was not exercised: profile writes are single statements, `updateProfile` is a read-modify-write with whole-row overwrite, and no test covers two writers on the same id.
- F-24 and the untested persistence branches depend on the in-memory fake's shape, so their reachability in production is limited to a record deleted between the read and the write.
- Request bodies are unbounded: no size limit is set on any mutation, and App Router handlers impose none by default. This is hardening that feature 15 owns and no current requirement states, so it is not recorded as a finding.

## Try it now

Run or do:

```bash
npm run dev
# in another terminal
curl -s http://localhost:3000/api/settings/profiles
```

Expected:

```json
{"profiles":[]}
```

This proves:

The `/api` locale-proxy bypass works and the profile list endpoint opens the local SQLite store and returns the documented empty list. It does not exercise credential writes.
