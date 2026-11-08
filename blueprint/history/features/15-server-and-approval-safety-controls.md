# Feature: Server and approval safety controls

**From build-plan:** feature 15
**Build attempt:** 1
**Branch:** feature/server-and-approval-safety-controls
**Status:** verified

## Goal

Close the local-server trust gaps that exist after the dashboard work: the server
listens only on loopback by default, browser requests from an unapproved origin
cannot mutate state, an approval authorizes only the run and step it was raised
for, and secret-shaped text never reaches logs, event views, API responses, or
the settings flow. These are local-first safeguards, not authentication.

## In scope

- Loopback-only default binding for `npm run dev` and `npm run start`.
- A shared request guard that rejects:
  - any `/api` request whose `Host` is not a loopback host, and
  - a state-changing `/api` request (`POST`, `PUT`, `PATCH`, `DELETE`) whose
    `Origin` is present but not the request's own loopback origin, or whose
    `Sec-Fetch-Site` is `cross-site`.
- A stable `403` JSON rejection for the guard, shared by the run and settings
  APIs.
- Approval answers bound to the exact run and step: the route's run id, the
  persisted approval's `runId` and `stepRunId`, and the engine's pending approval
  must all agree before a decision is applied.
- Redaction of secret-shaped text at runtime-event ingestion and at every read
  boundary that feeds the dashboard, SSE, or API: run error, step result and
  error, approval message/response, history message, and event text.
- The same redaction on settings success and error responses, and a small
  redacting logger for unexpected server errors.
- English and Persian messages for the new rejection code.
- Focused Vitest coverage for every rule.

## Out of scope

- Authentication, accounts, sessions, hosted mode, TLS, reverse proxies, and
  multi-user authorization.
- Making the server reachable from the LAN or internet. An explicit CLI override
  such as `npm run start -- -H 0.0.0.0` remains possible but unsupported.
- Changing the approval workflow, approval UI, run statuses, persistence schema,
  or ACP adapter behavior.
- Detecting every possible credential format. Redaction is a bounded set of
  secret-shaped patterns, not a data-loss-prevention system.
- Browser test harness setup. No Browser tests command is configured.

## Build loop

- `workflow.stepReview` is `feature`: complete all steps, then present one review
  packet. Do not pause for per-step approval.
- `workflow.checkpointCommits` is `disabled`: make no intermediate commits.
  `/complete` creates the final feature commit for this branch.
- Keep every step independently working; run the focused test file for the step,
  plus `npx tsc --noEmit` after type changes.
- Do not claim browser, live-runtime, or persisted-data evidence that was not
  run. The manual loopback check in step 8 is the only live observation.

## Build steps

1. **Bind dev and start to loopback by default**
   - Change the `dev` and `start` scripts in `package.json` to pass
     `-H 127.0.0.1` to `next dev` and `next start`.
   - Document the loopback default and the unsupported override in `README.md`.
   - Add `src/lib/safety/server-binding.test.ts`, which reads `package.json` and
     asserts both scripts carry the flag.
   - **Done when:** the test passes, and `npm run dev` output or `ss -ltn`
     shows the listener on `127.0.0.1:3000` rather than `0.0.0.0`.

2. **Add the loopback and origin request guard**
   - Create `src/lib/safety/origin.ts` with pure functions that:
     - normalize a `Host` header (`localhost`, `127.0.0.1`, `[::1]`, optional
       port) and decide whether it is loopback;
     - treat `POST`, `PUT`, `PATCH`, and `DELETE` as state-changing;
     - parse an `Origin` header and require `http:`/`https:`, a loopback host,
       and an exact match with the request's own origin;
     - allow a missing `Origin` for non-browser clients, but reject
       `Sec-Fetch-Site: cross-site`;
     - leave `GET`, `HEAD`, and `OPTIONS` free of the origin check.
   - Add `src/lib/safety/origin.test.ts` covering allowed same-origin, rejected
     cross-origin, rejected invalid origin, allowed missing origin, rejected
     cross-site fetch metadata, rejected non-loopback `Host`, and unaffected
     safe methods.
   - **Done when:** the focused test file passes and the helper has no Next.js
     dependency, so its rules are testable in isolation.

3. **Enforce the guard on `/api` in the proxy**
   - Update `src/proxy.ts` so `/api` requests pass the guard before the existing
     locale bypass; a rejected request returns status `403` with
     `{ "error": { "code": "origin_not_allowed", "message": "Cross-origin request rejected." } }`.
   - Add `origin_not_allowed` to `RUN_ERROR_CODES` and `SETTINGS_ERROR_CODES`,
     their status maps (`403`), the client failure parsers' accepted code sets,
     and English and Persian message catalogs.
   - Extend `src/proxy.test.ts` with a cross-origin mutation rejection, a
     same-origin mutation pass-through, a safe-method pass-through on a
     non-loopback host, and an unchanged locale redirect.
   - **Done when:** proxy tests prove `POST /api/runs` from `http://evil.test`
     is rejected, the same request from the current origin continues, and page
     routes still redirect to the locale prefix.

4. **Add the redaction module**
   - Create `src/lib/safety/redaction.ts` exporting:
     - `redactText(text)`, which masks `Bearer <token>`, `sk-…`,
       `sk-ant-…`, `ghp_/gho_/ghu_/ghs_/ghr_…`, `xox[baprs]-…`, and
       `api_key|apikey|access_token|token|secret|password|authorization`
       assignments, replacing only the value with `[redacted]`;
     - `redactValue(value)`, a deep copy for plain JSON objects and arrays;
     - `redactRuntimeEvent(event)`, preserving the event type and record shape.
   - Keep ordinary prose, identifiers, file paths, and code unchanged unless they
     match a secret-shaped value. Make the functions idempotent.
   - Add `src/lib/safety/redaction.test.ts` for each pattern, quoted and unquoted
     assignments, nested payloads, untouched ordinary text, and repeat calls.
   - **Done when:** the focused test file passes and no pattern masks a bare
     word such as `token` or `secret` without a value.

5. **Redact runtime events and run read models**
   - In `src/lib/workflow/engine.ts`, redact each normalized event before
     `appendRuntimeEvent` so new persisted events are already clean.
   - In `src/lib/runs/service.ts`, redact before returning: `run.error`,
     `step.resultText`, `step.error`, `approval.message`, `approval.response`,
     `history.message`, and every event. Apply the same helper in
     `getState`, `getRun`, and `listRuntimeEvents`, which also covers SSE frames.
   - Redact the message and fields in `runErrorResponse`.
   - Add tests in `src/lib/workflow/engine.test.ts`, `src/lib/runs/service.test.ts`,
     and `src/lib/runs/stream.test.ts` proving a secret-shaped fake event is
     absent from stored events, `getRun`, and the snapshot/event frames.
   - **Done when:** a fake runtime event containing `sk-test-secret-value` is
     persisted and returned as `[redacted]`, and all focused tests plus typecheck
     pass.

6. **Redact the settings flow and log safely**
   - Add `settingsJsonResponse(body, init?)` to `src/lib/settings/http.ts`; it
     redacts via `redactValue` and returns JSON. Use it for success bodies in the
     settings routes under `src/app/api/settings/`, and in
     `settingsErrorResponse`.
   - Create `src/lib/safety/log.ts` with `logServerError(scope, error)`, which
     formats the error, redacts it, and writes once with `console.error`.
   - Call it for unexpected (non-typed) errors in `handleRunRequest`,
     `handleSettingsRequest`, and the SSE stream's catch, then preserve the
     existing rethrow/return behavior.
   - Add tests proving settings success and error bodies redact secret-shaped
     label/error text, and a console spy proves logged errors contain
     `[redacted]` and no raw secret.
   - **Done when:** settings route tests pass, no settings response can echo a
     credential value, and unexpected errors are logged redacted exactly once.

7. **Bind approvals to one run and one step**
   - Extend the engine's `PendingApproval` with `runId` and `stepRunId`; in
     `answerApproval`, require the persisted approval and the pending approval to
     agree on both, in addition to the existing pending-id and resolved checks.
   - In `src/lib/runs/service.ts`, before checking run status, load the approval
     and reject a missing record or a different `runId` as `approval_not_found`
     and a non-pending record as `approval_already_resolved`. Also require its
     `stepRunId` to belong to a step run of the URL's run.
   - Keep the existing route shape and decision parsing; do not add an approval
     id to request bodies.
   - Add tests in `src/lib/workflow/engine.test.ts`,
     `src/lib/runs/service.test.ts`, and
     `src/app/api/runs/[id]/approvals/[approvalId]/route.test.ts`: another run's
     approval is `404`, another step's approval is `409`, a resolved approval is
     `409`, and the correct run/step decision still approves or rejects.
   - **Done when:** all four outcomes are asserted and rejecting still cancels
     the run.

8. **Run the final safety pass**
   - Run `npm test`, `npx tsc --noEmit`, and `npm run lint`.
   - Manually start `npm run dev`, confirm the listener is loopback-only, and
     send one same-origin and one cross-origin `POST /api/runs` request with
     `curl` to observe the `403` body.
   - **Done when:** all three commands pass and the manual observations match the
     rules above. No Browser tests command exists, so none is claimed.

## Files / areas

- Server entry and docs: `package.json`, `README.md`.
- Request guard: `src/lib/safety/origin.ts`, `src/lib/safety/origin.test.ts`,
  `src/proxy.ts`, `src/proxy.test.ts`.
- Redaction and logging: `src/lib/safety/redaction.ts`,
  `src/lib/safety/redaction.test.ts`, `src/lib/safety/log.ts`.
- Error contracts: `src/types/run-api.ts`, `src/types/settings-api.ts`,
  `src/lib/runs/http.ts`, `src/lib/settings/http.ts`,
  `src/lib/runs/screen.ts`, `src/lib/settings/screen.ts`,
  `src/i18n/messages.ts`.
- Run path: `src/lib/workflow/engine.ts`, `src/lib/runs/service.ts`,
  `src/lib/runs/stream.ts`, `src/app/api/runs/[id]/events/route.ts`, and the
  existing run route tests.
- Settings path: `src/app/api/settings/**` route handlers and their tests.
- No SQLite schema, migration, ACP adapter, or UI component change is expected.

## Data / contracts

- **Loopback binding:** `npm run dev` and `npm run start` bind `127.0.0.1` by
  default. `-H` is a Next.js CLI flag; no app-level host setting is introduced.
- **API request rules (all `/api` paths):**
  - `Host` must be missing, `localhost`, `127.0.0.1`, or `[::1]`, with any port.
  - For `POST`, `PUT`, `PATCH`, `DELETE`: a present `Origin` must be an
    `http:`/`https:` URL with a loopback host exactly equal to the request's own
    origin. A missing `Origin` is allowed for non-browser clients.
  - `Sec-Fetch-Site: cross-site` is always rejected on those methods.
  - The rejection is `403` with
    `{ "error": { "code": "origin_not_allowed", "message": "Cross-origin request rejected." } }`.
    It contains no paths, headers, or request content.
- **Approval binding:** a decision applies only when the URL run id equals the
  persisted approval's `runId`, the approval's `stepRunId` is a step run of that
  run, the approval is pending, and the engine's pending approval carries the
  same `runId` and `stepRunId`. Wrong run → `404 approval_not_found`; wrong step,
  non-pending, or non-waiting run → `409`. The request body remains
  `{ "decision": "approve" | "reject" }`.
- **Redaction:** masking replaces only the secret-shaped value with
  `[redacted]`, never the key or surrounding prose. It is applied when events are
  persisted and again when run state, run detail, SSE frames, error bodies,
  settings bodies, and log lines are produced, so old persisted rows are also
  covered. It is idempotent.
- **Logging:** exactly one redacted `console.error` call per unexpected failure;
  no request body, header, credential, or file content is logged.
- **Localization:** `origin_not_allowed` is added to both error catalogs in
  English and Persian; other existing strings are reused.

## Testing

- Unit tests live beside their source and use the existing Vitest setup:
  `src/lib/safety/*.test.ts`, `src/proxy.test.ts`,
  `src/lib/runs/service.test.ts`, `src/lib/runs/stream.test.ts`,
  `src/lib/workflow/engine.test.ts`, and the affected route tests.
- Settings tests keep using a fake catalog and a temporary SQLite database; no
  test reads or writes a real Reasonix home.
- Run `npm test` (Vitest) and `npx tsc --noEmit`; `npm run lint` for the final
  pass. No `Verify` command is configured, so none is claimed.
- Manual observation for the binding is shell-level (`ss -ltn`) and `curl` for
  the origin rule. No browser or live-runtime evidence is claimed.

## Notes for the AI

- This is a local-first project with no authentication. Do not add users,
  sessions, tokens, CORS headers, or a hosted-mode switch; the guard reduces
  browser and DNS-rebinding exposure, nothing more.
- Prefer repository-native code: no new dependency for origin parsing or
  redaction; use the platform `URL` and small pure helpers.
- Keep the existing raw-output UX rule intact. Only secret-shaped values are
  masked; agent prose, file paths, commands, and protocol text stay unchanged.
- Next.js here is version 16 and differs from older conventions. Read the
  relevant `node_modules/next/dist/docs/` guide before editing `proxy.ts` or the
  CLI scripts, and heed deprecation notices.
- Do not change `components/ui/` or add a second credential store. The settings
  screen already never receives a credential value.
- If a test needs a fake clock, runtime, or persistence, reuse the existing
  seams in `src/lib/runs/test-support.ts`, `src/lib/runtime/fake-runtime.ts`, and
  the in-memory persistence implementation.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":14161,"specSha256":"c5572c69509485c8041ed54763b2a610606b09b5f0e39e79cc881b3cefe5d834","branch":"refs/heads/feature/server-and-approval-safety-controls","head":"79b74c1d5a537c63349dbd80cbafbf9dacb2bdc8","baseRef":"refs/heads/main","baseCommit":"2ca24161c83488587e2d246d48e0a51c0dcabaa4","sourceTree":"b91ed7ee57accfca44337b7fbd5fd115e3678bb4","landing":"local-merge","absentOptional":[]} -->

## Independent review

# Independent Review

**Status:** passed
**Target commit:** 79b74c1d5a537c63349dbd80cbafbf9dacb2bdc8
**Base commit:** 2ca24161c83488587e2d246d48e0a51c0dcabaa4
**Base ref:** main
**Spec hash:** c5572c69509485c8041ed54763b2a610606b09b5f0e39e79cc881b3cefe5d834
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-11-08T18:18:19+03:30
**Workflow:** regular
**Check required:** no

**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-08T18:32:10+03:30
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `main..79b74c1d5a537c63349dbd80cbafbf9dacb2bdc8` delta in a fresh session or isolated subagent without the builder conversation. Run all Audit lenses from scratch. Run Check when required above. Do not edit product code, accept findings, or reuse the existing findings as the review scope.

## Commands

- `npm test`: pass (57 files, 722 tests passed, 4 live-runtime tests skipped)
- `npx tsc --noEmit`: pass (no output)
- `npm run lint`: pass (0 errors, 2 warnings, both in files outside this delta)
- `/check`: unavailable, not run (the request records `Check required: no`)

## Evidence

- Freshness, checked before reviewing: `git rev-parse HEAD` = 79b74c1d5a537c63349dbd80cbafbf9dacb2bdc8; `git merge-base main HEAD` = 2ca24161c83488587e2d246d48e0a51c0dcabaa4; `sha256sum blueprint/context/current-feature.md` = c5572c69509485c8041ed54763b2a610606b09b5f0e39e79cc881b3cefe5d834; `git status --porcelain` showed only `blueprint/context/review.md`.
- Scope: the complete `2ca2416..79b74c1` delta read end to end, 34 files, +1375 -154, across both commits (`76756da` feature checkpoint, `79b74c1` docs refresh), including `blueprint/context/current-feature.md` (the verified spec) and `blueprint/context/project-overview.md`.
- Loopback binding: `package.json` `dev` and `start` carry `-H 127.0.0.1`; `README.md:54-57` documents the default and the unsupported override; `src/lib/safety/server-binding.test.ts` asserts both scripts.
- Request guard: `src/lib/safety/origin.ts` is pure with no Next.js import (host normalization including bracketed IPv6, state-changing method set, `Origin` parse requiring `http:`/`https:` plus a loopback host plus an exact match with the request's own origin, missing `Origin` allowed, `Sec-Fetch-Site: cross-site` rejected); `src/proxy.ts:17-31` runs it before the locale bypass and returns the contract body with status 403; `src/lib/safety/origin.test.ts` (17 cases) and `src/proxy.test.ts` (cross-origin 403, same-origin pass, safe-method pass, non-loopback `Host` 403, unchanged locale redirect) cover the rules.
- Error contract: `origin_not_allowed` is in `RUN_ERROR_CODES`, `SETTINGS_ERROR_CODES`, both status maps (403), both service message maps, and the English and Persian catalogs; the client parsers build their accepted code sets from the shared arrays (`src/lib/runs/screen.ts:87`, `src/lib/settings/screen.ts:52`), so they pick the code up without an edit.
- Redaction: `src/lib/safety/redaction.ts` covers `Bearer`, `sk-`/`sk-ant-`, `gh[pousr]_`, `xox[baprs]-`, and assignment keys, is quote-aware and idempotent; it is applied at ingestion (`engine.ts:805-806`, before `appendRuntimeEvent`), at every read boundary through the helpers at `service.ts:400-448` used by `getState`, `getRun`, `listRuntimeEvents`, `listRuns`, and each control path that returns `getRun`, in SSE frames (`stream.ts:33`), in `runErrorResponse`, and in `settingsJsonResponse` for all six settings route modules plus `settingsErrorResponse`; `redactValue` deep-copies instead of mutating (`redaction.test.ts`).
- Approval binding: `service.ts:756-778` loads the approval before the run-status check and answers 404 for a foreign or missing `runId`, 409 for a non-pending record, and requires the `stepRunId` to be a step run of the URL run; `engine.ts:371-378` additionally requires the pending approval to agree on both `runId` and `stepRunId`. `service.test.ts` and `engine.test.ts` assert the foreign-run, foreign-step and resolved outcomes, and the pre-existing tests still assert a rejecting answer cancels the run.
- Logging: `src/lib/safety/log.ts` formats, redacts, and writes once; `logServerError` is called on the unexpected-error path of `handleRunRequest`, `handleSettingsRequest`, and the SSE loop catch (`src/app/api/runs/[id]/events/route.ts:57-59`), each covered by a console spy asserting `[redacted]` and no raw secret. `abortableSleep` resolves on abort (`stream.ts:114-133`), so an ordinary client disconnect does not log.
- No mutation path outside `/api`: `grep -rn '"use server"' src` is empty and every route handler lives under `src/app/api`.
- Performance: the added work is bounded per request and per poll tick (deep copy plus regex passes over already-materialized payloads); `listRuntimeEvents` still loads the full event table before slicing, which predates this delta.

## Findings

- F-51 [P3] open - `/api` paths containing a dot skip the host and origin guard
- F-52 [P3] open - The run error body redaction is never exercised by a test
- F-53 [P3] open - Bearer redaction rewrites the scheme word as well as its value
- No P0 or P1 finding from this pass is `open` or `fixed`.

## Remaining risk

- Reviewer identity is declared metadata, not runtime-proven. The host runtime is Reasonix and exposes none of the five Blueprint adapter names, so `Reviewer adapter: codex` follows the project's own `.agents/skills` detection rule, and `Reviewer model: deepseek/deepseek-flash` is the runtime's configured `default_model` with no `subagent_model` override, corroborated by every recent session record; no per-turn model banner was exposed to this session.
- No live or manual observation was repeated in this pass: the `ss -ltn` loopback check and the two `curl` origin probes from build step 8 were not re-run, and starting a dev server is outside the reviewer's boundary.
- `/check` was not required and was not run, and the project declares no Browser tests command, so no browser or live-runtime evidence supports the guard and redaction paths.
- The spec's step 3 asks for "a safe-method pass-through on a non-loopback host" while its data contract rejects a non-loopback `Host` on every `/api` path. The build follows the contract (a `GET` to a non-loopback host is a 403) and `src/proxy.test.ts:85-94` asserts that; the step-3 test list and the contract cannot both be satisfied.
- Step 7 named `src/app/api/runs/[id]/approvals/[approvalId]/route.test.ts`, which is unchanged in this delta. The four outcomes are asserted in `service.test.ts` and `engine.test.ts`, and the pre-existing route test covers the `approval_not_found` 404 and `approval_already_resolved` 409 mappings, so the behavior is covered but not at the level the step named.
- The contract's "wrong step -> 409" holds only when the approval's step run belongs to the URL run (the engine refuses that mismatch). A `stepRunId` from a different run is answered as `404 approval_not_found`; the URL cannot distinguish the two cases and no spec scenario separates them.
- Redaction is a bounded pattern set, as the spec states: for example `Authorization: Basic <base64>` masks only the scheme word and leaves the encoded credential after it.

## Try it now

Run or do (start the server yourself; the agent does not):

```bash
npm run dev
# in a second terminal
ss -ltn | grep 3000
curl -i -X POST http://127.0.0.1:3000/api/runs \
  -H 'content-type: application/json' \
  -H 'origin: http://evil.test' \
  -d '{}'
```

Expected:

- The listener line shows `127.0.0.1:3000`, not `0.0.0.0:3000`.
- The curl request returns `HTTP/1.1 403` with `{"error":{"code":"origin_not_allowed","message":"Cross-origin request rejected."}}`.

This proves: the server binds to loopback by default and rejects a state-changing `/api` request from an unapproved origin before it reaches the run handler.
