# Feature: Test Connection

**From build-plan:** feature 11A Stage 7
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/test-connection`

## Goal

Add a Settings action that tests one saved runtime profile against the installed
Reasonix CLI by running a single ACP `session/prompt` in a temporary empty
workspace with a read-only permission posture. The server returns a typed
success or failure, and the Settings screen shows that result without rendering
or logging a credential or raw runtime error.

This stage proves the local request/response path with a fake runtime. It makes
no live Reasonix connection claim. Live proof remains blocked by Feature 3B and
must not be asserted until 3B passes.

## In scope

- A shared `ConnectionTestResult` contract with stable failure codes.
- A server-side runner that:
  - creates a temporary empty workspace, removes write permission from it, and
    removes it afterwards;
  - launches the installed Reasonix CLI over the existing ACP transport with
    `--model <provider>/<model>` and `--permission-mode read-only`;
  - points the child at the configured Reasonix home through `REASONIX_HOME`;
  - creates one session, sends one short prompt, and requires a completed stop
    reason;
  - enforces an overall timeout and always closes the runtime and removes the
    workspace, including on failure or timeout.
- A `testConnection(profileId)` operation on the existing settings service.
- A `POST /api/settings/profiles/:id/connection-test` route that returns the
  typed result.
- A per-profile "Test connection" action in the existing Settings screen with
  loading, success, and typed failure states.
- English and Persian RTL strings, light and dark themes, and existing shadcn/ui
  default components used as-is.
- Focused Vitest coverage for the runner, service, route, client narrowing, and
  the result guard.

## Out of scope

- Any live Reasonix connection or prompt claim. Feature 3B stays blocked and
  unproven; this feature does not run a live test as acceptance.
- Repository access, file tools, MCP servers, or approval handling during the
  test. The test workspace is empty and read-only, and the session requests no
  MCP servers.
- Streaming test progress, cancellation UI, retries, or persisting test results.
- Project default-profile integration (11A Stage 8).
- Cross-origin protection and other server hardening (Feature 15).
- Folding the Settings screen into the dashboard (Feature 14).
- New dependencies, provider/model catalog changes, credential mutation, or
  profile mutation.
- Windows and macOS behavior claims.

## Build loop

- `workflow.stepReview` is `feature`: implement all steps, then present one
  review packet before `/complete`.
- `workflow.checkpointCommits` is `disabled`: do not create checkpoint commits.
- `/complete` creates the final feature commit.

## Build steps

- [x] 1. **Result contract and client narrowing** - Add
  `CONNECTION_TEST_FAILURE_CODES`, `ConnectionTestResult`, and
  `isConnectionTestFailureCode` to `src/types/runtime-settings.ts`; add
  `SettingsConnectionTestResponse` to `src/types/settings-api.ts`; add
  `narrowConnectionTestResponse` to `src/lib/settings/screen.ts`.
  **Done when:** `src/types/runtime-settings.test.ts` covers accepted failure
  codes and rejected values, `src/lib/settings/screen.test.ts` covers valid and
  malformed response bodies, and `npx tsc --noEmit` passes.

- [x] 2. **Typed connection runner** - Add
  `src/lib/runtime/reasonix/connection-test.ts` with
  `runReasonixConnectionTest(options)`, an injectable runtime factory defaulting
  to `createAcpRuntime`, an injectable timeout with a `60_000` ms default, and
  temporary-workspace lifecycle handling. Confirm with the installed CLI help
  that `reasonix acp` advertises `--permission-mode read-only`; if it does not,
  stop and report the exact mismatch instead of substituting an unevidenced
  flag.
  **Done when:** `src/lib/runtime/reasonix/connection-test.test.ts` proves with
  a fake runtime that a successful prompt returns `{ outcome: "succeeded" }`;
  the launch arguments are exactly `acp`, `--model`,
  `<provider>/<model>`, `--permission-mode`, `read-only`; the child cwd and
  session workspace are the same empty directory; `REASONIX_HOME` is set; the
  prompt is the fixed test prompt; and the workspace is removed afterwards. The
  same test file proves `credential_missing` is not returned by this module,
  while workspace failure, runtime start/handshake failure, session failure,
  prompt failure, a cancelled stop reason, and timeout each map to their typed
  code and still close the runtime and remove the workspace.

- [x] 3. **Service operation and API route** - Add `testConnection(id)` to
  `src/lib/settings/service.ts`, wire the runner in
  `src/lib/settings/runtime.ts`, and add
  `src/app/api/settings/profiles/[id]/connection-test/route.ts` with `POST`.
  **Done when:** service tests prove an unknown profile returns the existing
  `profile_not_found` settings error, a `missing` credential returns
  `{ outcome: "failed", code: "credential_missing" }` without invoking the
  runner, and a `present` or `unknown` credential invokes the runner with the
  fetched profile. Route tests prove `POST` passes the id through, returns
  `{ result }`, returns typed settings errors for an unknown profile, and never
  includes a secret or raw runtime message. Existing route-test service stubs
  include the new method.

- [x] 4. **Settings screen action and bilingual copy** - Add
  `src/components/settings/connection-test-button.tsx` and render it for each
  profile inside `src/components/settings/settings-screen.tsx`. Add the English
  and Persian strings to `src/i18n/messages.ts`, including one hint that the
  test sends one short prompt to the selected provider and may incur a small
  charge.
  **Done when:** the button is disabled only while its own request is running;
  success and typed failure results appear in an `aria-live` region; HTTP-level
  settings failures reuse the existing localized settings messages; the action
  has an accessible name that includes the profile label; both catalogs define
  exactly the same keys and no empty strings; `npx tsc --noEmit`,
  `npm test -- src/i18n/messages.test.ts src/lib/settings/screen.test.ts`, and
  `npm run lint` pass.

- [x] 5. **Focused verification and honest evidence** - Run the full test suite,
  typecheck, and lint. Record only observed results and confirm the feature
  makes no live Reasonix claim.
  **Done when:** `npm test`, `npx tsc --noEmit`, and `npm run lint` pass. The
  final notes state that the fake-runtime path is verified, that Feature 3B
  remains blocked, and that no live connection test was executed. If the local
  Node toolchain is unavailable, stop and report that verification is
  incomplete instead of marking this step done.

## Files / areas

- `src/types/runtime-settings.ts` and `src/types/runtime-settings.test.ts` -
  result union, failure codes, guard.
- `src/types/settings-api.ts` - connection-test response envelope.
- `src/lib/settings/screen.ts` and `src/lib/settings/screen.test.ts` - client
  narrowing.
- `src/lib/runtime/reasonix/connection-test.ts` and
  `src/lib/runtime/reasonix/connection-test.test.ts` - runner.
- `src/lib/settings/service.ts` and `src/lib/settings/service.test.ts` - profile
  lookup, credential gate, runner invocation.
- `src/lib/settings/runtime.ts` - environment wiring for the Reasonix binary,
  Reasonix home, and runner.
- `src/app/api/settings/profiles/[id]/connection-test/route.ts` and
  `route.test.ts` - local JSON endpoint.
- `src/components/settings/connection-test-button.tsx` and
  `src/components/settings/settings-screen.tsx` - Settings action and result.
- `src/i18n/messages.ts` - English and Persian strings.

## Data / contracts

### Result shape

```ts
type ConnectionTestFailureCode =
  | "credential_missing"
  | "invalid_profile"
  | "workspace_unavailable"
  | "runtime_unavailable"
  | "session_failed"
  | "prompt_failed"
  | "cancelled"
  | "timeout";

type ConnectionTestResult =
  | { readonly outcome: "succeeded" }
  | { readonly outcome: "failed"; readonly code: ConnectionTestFailureCode };
```

- The endpoint responds `200` with `{ result }` when the test ran, including a
  failed outcome. An unknown profile or a persistence/credential-store failure
  keeps the existing typed settings error response.
- A result never contains a credential value, raw runtime message, file path,
  provider response, or model output.
- `credential_missing` is returned by the service when the stored credential
  status is `missing`. A status of `unknown` still attempts the test.
- `invalid_profile` is returned when the persisted profile fails
  `validateRuntimeProfile` before a runtime is started.
- `succeeded` requires a `completed` prompt stop reason. It does not require a
  particular reply text.

### Runner contract

- Launch: `reasonix acp --model <providerName>/<model> --permission-mode read-only`
  with the temporary workspace as cwd.
- Environment: inherit the server environment and set
  `REASONIX_HOME` to the resolved Reasonix home used by the credential store.
- Workspace: create with `mkdtemp` under the OS temporary directory, verify it
  is empty, then remove write permission (`0o500`). Restore owner write
  permission before recursive removal. Cleanup runs in `finally` on success,
  failure, timeout, and session-close failure. Cleanup failure does not change
  an already typed result.
- Session: the existing adapter sends `mcpServers: []`. The runner does not
  register a permission handler and does not grant tools.
- Prompt: one fixed text prompt that asks for a short reply and instructs the
  model not to call tools, read files, or change anything.
- Timeout: one overall deadline, `60_000` ms by default, injectable for tests.
  The transport request timeout is set to the same value. After the deadline,
  the runner returns `timeout`, closes the runtime, and removes the workspace.
- Error mapping is by stage: workspace creation/preparation failure,
  runtime start or handshake failure, `session/new` failure, `prompt` failure,
  and a non-completed stop reason map to the codes above. Raw errors are
  discarded.

### Decisions recorded for 11A

- Connection-test timeout: 60 seconds overall.
- Error categories: the eight stable codes above. No provider-specific error
  taxonomy is introduced before the live path is proven.
- Permission posture: `read-only`, because the installed Reasonix help text
  advertises `read-only` as a permission mode. An empty workspace, no MCP
  servers, and a no-tool prompt are defense in depth, not a tool sandbox claim.
- Cost: one short provider prompt per click. The UI states this, and the button
  is disabled while the request is in flight.

## Testing

- Runner tests use `createFakeRuntime` or a small injected runtime and real
  temporary directories. They assert launch arguments, cwd/workspace identity,
  `REASONIX_HOME`, prompt text, typed success and failure mapping, timeout
  behavior, runtime close, and workspace removal.
- Service tests reuse the in-memory profile and credential stores and a stub
  runner. They prove profile lookup, the credential gate, and that the runner
  receives the stored profile.
- Route tests call the exported handler directly, following the existing
  settings route tests. They prove the envelope, typed errors, id pass-through,
  and absence of secrets or raw runtime messages.
- Client tests cover `narrowConnectionTestResponse` and the result guard.
- No browser test harness is configured, so no browser, visual, or live
  integration evidence is claimed.
- The live ACP path is not run. Feature 3B remains the prerequisite for any live
  connection claim.

Observed on 2026-10-31: `npm test` passed 528 tests with 4 live tests skipped;
`npx tsc --noEmit` passed; `npm run lint` reported 0 errors and 2 pre-existing
warnings; `npm run build` passed and listed the new connection-test route. No
live Reasonix connection test was executed.

## Notes for the AI

- Read the relevant Next.js guide under `node_modules/next/dist/docs/` before
  writing the route handler; this Next.js version may differ from training data.
- Reuse the existing ACP runtime, transport, settings service, HTTP helpers,
  settings client, and shadcn/ui components. Do not create a parallel transport
  or a second credential path.
- Do not edit files under `src/components/ui/`. Style feature components through
  props and Tailwind classes.
- Keep every user-facing string in the typed bilingual catalog, with Persian RTL
  and both themes. Do not interpolate a credential, provider error, or file path
  into a message.
- Do not log the test prompt, runtime output, environment, or credential. Do not
  add AI attribution to commits.
- This feature deliberately stops short of a live test. Do not mark Feature 3B,
  Feature 11A, or any live capability as verified.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":12995,"specSha256":"07f75c312b1b000536c843a0638ff8c4a551feb9ef9ac8379ccb9e548e70f0f8","branch":"refs/heads/feature/test-connection","head":"53c6d7e39b5dfa054bea445528fff2b1e39fa632","baseRef":"refs/heads/main","baseCommit":"77d41ad4dbda4a3dcd6ed158ef87ce65c60e88eb","sourceTree":"48e58f64b363d9ebaa2b1b8003e76ef8ec035da2","landing":"local-merge","absentOptional":[]} -->

## Findings

None resolved in this work item. F-01 to F-37 remain open or unverified in the live ledger; the passing review added F-34 to F-37.

## Independent review

**Status:** passed
**Target commit:** 53c6d7e39b5dfa054bea445528fff2b1e39fa632
**Base commit:** 77d41ad4dbda4a3dcd6ed158ef87ce65c60e88eb
**Base ref:** main
**Spec hash:** 07f75c312b1b000536c843a0638ff8c4a551feb9ef9ac8379ccb9e548e70f0f8
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** deepseek/deepseek-flash
**Requested execution:** automatic
**Requested at:** 2026-10-31T03:10:00Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-31T03:17:37+03:30
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `npx tsc --noEmit`: pass, no output
- `npm test` (first full-suite run): fail, 527 passed, 1 failed, 4 skipped; the only failure was the known flaky `src/lib/runtime/reasonix/env-file-store.test.ts > serializes simultaneous stale-lock takeover` (F-33), `CredentialLockError` at `env-file-store.ts:780`
- `npm test` (full-suite rerun, as the request allows for F-33): pass, 528 passed, 4 skipped, 0 failed
- `npm run lint`: pass, 0 errors and the 2 pre-existing warnings (`acp/protocol.test.ts:55`, `reasonix/env-file-store.ts:4`)
- `npm run build`: pass, and it lists `/api/settings/profiles/[id]/connection-test` as a dynamic (`ƒ`) route
- `reasonix acp --help`: unavailable, no `reasonix` binary on PATH in this environment

## Evidence

- Freshness before review: `git rev-parse HEAD` = 53c6d7e39b5dfa054bea445528fff2b1e39fa632; `git merge-base main HEAD` = 77d41ad4dbda4a3dcd6ed158ef87ce65c60e88eb; `sha256sum blueprint/context/current-feature.md` = 07f75c312b1b000536c843a0638ff8c4a551feb9ef9ac8379ccb9e548e70f0f8; `git status --porcelain` showed only ` M blueprint/context/review.md`
- Delta reviewed file by file from `git diff 77d41ad..53c6d7e`: 20 files, 1331 insertions, covering the result contract, client narrowing, runner, service, environment wiring, route, button, screen, i18n, and their tests
- Launch contract: `connection-test.test.ts:147-153` asserts exactly `acp --model deepseek/deepseek-flash --permission-mode read-only`; `:155` asserts `requestTimeoutMs` equals the 60 s default; `:157-159` assert workspace mode `0o500`, an empty directory, and `cwd` equal to `sessionRoot`; `:154` asserts `REASONIX_HOME`; `:160` asserts the single fixed prompt
- Type mapping: `connection-test.ts:179` validates the profile before any workspace or process; `:96` workspace, `:112` runtime start/handshake, `:120` session, `:129` prompt, `:133` non-completed stop reason; each case asserted in the runner tests and each asserting teardown
- Secret boundary: `ConnectionTestResult` cannot carry extra fields (`runtime-settings.test.ts:236-243`), the result guard rejects unknown codes (`runtime-settings.test.ts:224-233`), the client narrowing rejects malformed bodies (`screen.test.ts:369-393`), and the route body is asserted secret-free (`connection-test/route.test.ts:74`)
- Service gating: `service.test.ts:411-447` proves `credential_missing` short-circuits without calling the runner, `:449-500` proves `present` and `unknown` both invoke it with the stored profile, and `:502-513` proves an unknown profile keeps `profile_not_found`
- Teardown claim checked against the real adapters: `runtime.ts:103-120` memoizes `close()`, `transport.ts:304-308` rejects requests after close, `runtime.ts:249` sends `mcpServers: []`
- Bilingual coverage: `screen.test.ts:417-426` covers every failure code plus the hint in both catalogs, and `const fa: Messages` keeps the key sets identical
- Treated the existing ledger as context only; the review started from the diff, and F-01..F-33 were not used as the checklist

## Findings

- F-34 [P2] unverified - The `read-only` permission flag has no recorded evidence and the contract recorded `ask`
- F-35 [P3] open - The timeout path closes the runtime before the session
- F-36 [P3] open - Two spec-stated runner guarantees have no test
- F-37 [P3] open - `execute` is over the project's 50-line function guideline
- F-33 [P2] open - Re-observed, not part of this delta: the credential-lock test failed in the first full run and passed on the rerun

## Remaining risk

- F-34: the CLI is not installed here, so neither `reasonix acp --help` nor a live `--permission-mode read-only` acceptance could be reproduced; the only recorded launch in `docs/reasonix-acp-contract.md:19` uses `ask`
- `reasonix acp --help` was unavailable in this environment, so the spec's step 2 CLI-help confirmation rests on the builder's record and no live ACP handshake was observed
- No live Reasonix connection was executed. Feature 3B remains blocked and no live prompt claim is supported by this review
- The Settings action's own done-when behaviors (disabled only while its request runs, `aria-live` announcements, an accessible name including the profile label) were verified by reading `connection-test-button.tsx:79-115` only; the project has no component tests and no browser harness, and the spec declares no visual evidence
- The connection-test endpoint is unauthenticated and cross-origin reachable, and each call can spend provider credit; cross-origin protection is deferred to Feature 15 by the approved spec, so this is recorded as accepted scope, not a defect
- `Reviewer context`, `Reviewer adapter`, and `Reviewer model` are declared metadata. The model identifier was read from the runtime session metadata (`deepseek/deepseek-flash`), not cryptographically attested
- F-33 remains the only observed load-sensitive failure; it reproduced once under full-suite load and passed on the rerun, so the suite is green but not deterministically green
- No dependency or scanner output exists in this project, so the security lens rests on reading the changed trust boundaries, not on a vulnerability scan
