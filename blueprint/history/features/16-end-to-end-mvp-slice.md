# Feature: End-to-end MVP slice

**From build-plan:** feature 16
**Build attempt:** 1
**Branch:** `feature/end-to-end-mvp-slice`
**Status:** locally verified; live acceptance deferred by verification exception

## Goal

Make the MVP slice demonstrable from the running app: a three-step workflow with
one approval pause runs, a page reload while paused shows the persisted state and
history, approval lets the run complete, and a second reload shows the final
result. The local slice is proved through the app's own request handlers, the
real SQLite store, and a controlled runtime. The real-Reasonix run stays
explicitly blocked and is never claimed as verified.

## In scope

- A checked-in seed fixture: one skill definition with three skill versions, one
  workflow definition, and one immutable workflow version with three ordered
  steps and one approval point.
- Idempotent boot seeding of that fixture through the existing published
  definition persistence, only when the store holds no definitions.
- A repeatable local slice test: seed, register, start, approval pause, reload
  read from a fresh service and store on the same database, approve, complete,
  second reload read.
- A server-side event-stream snapshot on the reloaded service, proving the SSE
  path the run detail page uses after a reload.
- Manual `/check` instructions for the real-runtime reload run, recorded as
  blocked.

## Out of scope

- Any live Reasonix claim, including Feature 3B, 6B, 7B, 13B, and the 11A real
  connection test. Those prerequisites stay blocked.
- A workflow or skill authoring UI, an import endpoint, or a publish API.
- A browser automation harness or any new runtime/test dependency.
- Cross-process restart recovery. Feature 10 owns startup reconciliation, and
  this slice is a page reload only.
- Schema or migration changes. The seed uses existing persistence methods.
- Bilingual catalog entries for the seeded definition data.

## Build loop

- `workflow.stepReview: "feature"`: steps 1 to 3 are built, then presented as
  one review packet. There is no per-step approval pause.
- `workflow.checkpointCommits: "disabled"`: no checkpoint commits are created
  between steps. `/complete` creates the feature commit.
- Step 4 is the live real-runtime proof. It is blocked by the same missing
  prerequisites as 3B and must not be marked complete. Local work stops after
  step 3 and the feature stays open.

## Build steps

- [x] 1. **Seed fixture module.** Add `src/lib/workflow/mvp-definition.ts`
  exporting the stable seed ids, a validated seed record factory, and
  `seedMvpDefinition(persistence)`. It publishes through `publishSkillVersion`
  and `publishWorkflowVersion` so malformed records can never be persisted. It
  reads `listWorkflowDefinitions()` and `listSkillDefinitions()`; when both are
  empty it creates the skill definition, the three skill versions, the workflow
  definition, and the workflow version, in that order, and reports
  `{ seeded: true }`. Otherwise it writes nothing and reports
  `{ seeded: false }`.
  Done when: a focused test proves a fresh temporary SQLite store gains exactly
  one workflow definition, one workflow version with three ordered steps, one
  approval point referenced by the middle step, and three skill versions; a
  second call writes nothing; a store that already holds an unrelated definition
  is left untouched; and the persisted version projects through
  `projectWorkflowVersionWithSkills` with step 2 carrying the approval point.

- [x] 2. **Seed on run-service boot.** Call `seedMvpDefinition(store)` in
  `createRunServiceFromEnvironment` immediately after the store opens and before
  the engine and service are built. Do not add seeding to
  `createSettingsServiceFromEnvironment`. A seeding failure rejects service
  construction, exactly like a failed migration; it is not swallowed.
  Done when: a test builds the service twice against one temporary
  `DOMINO_DB_PATH` and `service.listWorkflows()` returns the seeded definition
  and version after the first build and exactly the same single definition and
  version after the second build, with no duplicate ids.

- [x] 3. **Local end-to-end slice test.** Add `src/lib/runs/mvp-slice.test.ts`
  covering the whole local path with a temporary database, a temporary
  workspace directory, the real `openSqliteWorkflowStore`, the seeded
  definitions, one persisted runtime profile, and `createFakeRuntime` with three
  scripted turns. Register the project through `handleCreateProject`, start the
  run through `handleStartRun`, wait for `waiting_approval`, read it back through
  `handleGetRun` and a fresh service plus fresh store on the same database, read
  the initial SSE snapshot through `createRunEventStream().start()`, approve
  through `handleAnswerApproval`, wait for `completed`, and read it again through
  a second fresh service plus store.
  Done when: the test asserts each of these as observable behavior:
  - after step 1 the run is `waiting_approval`, step 1 is `completed`, step 2 is
    `pending`, and exactly one pending approval exists for the step-2 step run;
  - the reloaded read returns the same run status, one completed step, the
    pending approval, and history containing `step_completed` and
    `approval_requested`;
  - the SSE snapshot on the reloaded service contains the `waiting_approval`
    state;
  - after approval the run is `completed` with three `completed` steps in order,
    each step result equal to its scripted fake turn, and each step prompt equal
    to the matching seeded skill content;
  - the second reloaded read returns the completed run with the same three
    results and history containing `approval_approved` and `run_completed`;
  - no credential value is read or persisted, and every store opened by the test
    is closed.

- [ ] 4. **Live real-runtime reload proof — BLOCKED, do not mark complete.**
  Run the same three-step seeded workflow against the installed Reasonix CLI
  with a valid disposable key in a writable Reasonix home: start the run, wait
  for the approval pause, reload the page, confirm the paused state, pending
  approval, and history; approve; confirm completion; reload again and confirm
  the final result. Use the default Reasonix runtime profile from 11A.
  Done when: a live run actually passes and the result is recorded. Blocker:
  `~/.reasonix/.env` is a `/dev/null` character device in this environment, so
  no credential can be written, and no disposable key is available. Resume only
  after 3B's prerequisites exist. Do not record this step as done, and do not
  describe the local fake-runtime test as a live Reasonix result.

## Files / areas

- New: `src/lib/workflow/mvp-definition.ts` — seed ids, record factory, and
  `seedMvpDefinition`.
- New: `src/lib/workflow/mvp-definition.test.ts` — fixture, idempotency, and
  projection tests.
- New: `src/lib/runs/mvp-slice.test.ts` — the local end-to-end slice.
- Modified: `src/lib/runs/runtime.ts` — one seeding call in
  `createRunServiceFromEnvironment`.
- Modified: `src/lib/runs/runtime.test.ts` — boot seeding coverage.
- Read-only but load-bearing: `src/lib/runs/service.ts`,
  `src/app/api/runs/route.ts`, `src/app/api/runs/[id]/route.ts`,
  `src/app/api/runs/[id]/approvals/[approvalId]/route.ts`,
  `src/app/api/projects/route.ts`, `src/lib/runs/stream.ts`,
  `src/lib/workflow/sqlite/sqlite-store.ts`,
  `src/lib/workflow/skill-delivery.ts`, `src/lib/runtime/fake-runtime.ts`.

## Data / contracts

- Stable seed ids, all lowercase kebab-case:
  - skill definition `mvp-skill`, name `MVP step instructions`;
  - skill versions `mvp-skill-v1`, `mvp-skill-v2`, `mvp-skill-v3`, versions
    1, 2, 3 under `mvp-skill`;
  - workflow definition `mvp-workflow`, name `MVP three-step workflow`;
  - workflow version `mvp-workflow-v1`, `definitionId` `mvp-workflow`,
    `version` 1, `errorPolicy` `fail-run`.
- Skill contents, in order, are the step prompts and are delivered verbatim:
  1. `Inspect the workspace and report what needs to change. Do not edit files.`
  2. `Apply the smallest change that satisfies the request.`
  3. `Verify the change and report the observed result.`
- Workflow steps in order: `inspect` → `mvp-skill-v1`, `apply` →
  `mvp-skill-v2`, `verify` → `mvp-skill-v3`. Each step references exactly one
  skill version. No `workingDirectory`, no `retry`.
- Approval point: key `approve-apply`, message
  `Approve the changes before the agent applies them.`, referenced by the `apply`
  step only. This yields one approval pause after `inspect` completes.
- `publishedAt` is the fixed timestamp `2026-01-01T00:00:00.000Z`, so seeding is
  deterministic and repeatable.
- Seeding writes only definitions and versions. It writes no project, runtime
  profile, credential, run, workspace file, or log content.
- Empty-store rule: seed only when both `listWorkflowDefinitions()` and
  `listSkillDefinitions()` are empty. Any non-empty definition state is left
  alone, including a partial state. Recovery from a partial seed is deleting the
  local, Git-ignored `.domino/domino.db` and restarting the app.
- No API shape changes. The slice consumes the existing run, project, and event
  endpoints unchanged.

## Testing

- Focused: `npm test -- src/lib/workflow/mvp-definition.test.ts
  src/lib/runs/runtime.test.ts src/lib/runs/mvp-slice.test.ts`
- Full: `npm test` (baseline on 2026-11-08: 57 files, 722 passed, 4 live tests
  skipped)
- Types: `npx tsc --noEmit`
- Lint: `npm run lint`
- No browser test command exists and none is added. The page-reload UI behavior
  is checked manually with `npm run dev`:
  1. Start the app on a fresh database so seeding runs.
  2. Register a workspace and select the seeded workflow version and the default
     runtime profile.
  3. Start the run from the dashboard and wait for the approval card.
  4. Reload the run detail page; the status, completed step, pending approval,
     step timeline, history, and result text must match the pre-reload state.
  5. Approve, let the run complete, reload again, and confirm the final three
     step results and `completed` status.
  With the current environment this manual run cannot use a real Reasonix
  credential, so it is recorded as blocked and no live result is claimed.

Locally verified on 2026-11-08:

- `npm test` — 59 files passed, 729 tests passed, 4 live tests skipped.
- `npm test -- src/lib/workflow/mvp-definition.test.ts` — 5 passed.
- `npm test -- src/lib/runs/runtime.test.ts` — 3 passed.
- `npm test -- src/lib/runs/mvp-slice.test.ts` — 1 passed.
- `npx tsc --noEmit` — passed with no errors.
- `npm run lint` — passed with 2 pre-existing warnings in
  `src/lib/runtime/acp/protocol.test.ts` and
  `src/lib/runtime/reasonix/env-file-store.ts`; none in this feature's files.

Step 4 is not executed and remains unchecked. No live Reasonix result is
recorded.

## Notes for the AI

- Keep the seed fixture in English. The seeded names and approval message are
  persisted definition data, not UI chrome, so they are not added to the typed
  bilingual catalog. UI labels around them already come from the catalog.
- Do not edit `components/ui/`, add a dependency, or add a migration.
- Do not seed from the settings service; the run service owns the fixture.
- Do not make seeding best-effort with a swallowed error. Construction failure is
  visible and retried on the next request because the cached service promise
  resets.
- The fake runtime's turns are consumed in order across steps, one turn per
  step. Keep the scripted turns aligned with `inspect`, `apply`, `verify`.
- The approval decision body is `{"decision":"approve"}`; rejection cancels the
  run and is covered by 14A, not by this feature.
- Feature 15 is implemented on `main`; loopback binding, origin checks, and
  redaction already apply to these requests. Do not re-implement them.
- Do not run `reasonix` or any live ACP test as evidence for this feature.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":11982,"specSha256":"e92007b8e0591548fa34a4faf2c8427b8d220b63b1f77ccc3a56a1b20a455b53","branch":"refs/heads/feature/end-to-end-mvp-slice","head":"2b5cc27a8286501b1ab9dabfab9b74e23ec8b871","baseRef":"refs/heads/main","baseCommit":"2b5cc27a8286501b1ab9dabfab9b74e23ec8b871","sourceTree":"90d38badd211cd9e2e2b2981bc7208c2b551931c","landing":"local-merge","absentOptional":[]} -->

## Verification exception

**Status:** closed administratively on 2026-11-08 with build step 4 deferred.
This spec reached local verification but never reached the live MVP acceptance.

- **Step 4 (live real-runtime reload proof):** UNVERIFIED / DEFERRED. It is
  intentionally left unchecked. This closure is not a successful Reasonix run and
  must not be read as one.
- **Reason:** `~/.reasonix/.env` is a `/dev/null` character device in this
  environment, so no credential can be written, and no disposable key is
  available. Features 3B, 6B, 7B, and 13B remain blocked by the same
  prerequisites, and 11A's real connection test has not passed.
- **What actually ran:** build steps 1 to 3. The local slice test exercises the
  seeded three-step workflow, the approval pause after `inspect`, reads from
  fresh service and store instances on the same database, the server-side event
  snapshot, approval, completion, and a second fresh read with results in order.
  It uses the fake runtime, not Reasonix. `npm test` passed 729 tests with 4 live
  tests skipped; `npx tsc --noEmit` and `npm run build` passed; `npm run lint`
  passed with two pre-existing warnings.
- **Original acceptance criteria (preserved):** run the three-step seeded
  workflow with one approval pause against the real Reasonix runtime using the
  default Reasonix runtime profile from 11A; reload the page while paused and
  confirm the persisted state and history; continue, complete, and reload again
  to confirm the final result. This is a page reload only, not a process
  restart.
- **Resume verification:** with a disposable key in a writable Reasonix home
  (the 3B prerequisites), run the manual path in the spec's Testing section and
  record the result. Only a passing live run changes this exception.

**Closure bookkeeping:** build-plan item 16 is checked administratively so the
roadmap can move on, with this deferral noted on its line. No live Reasonix
result is claimed. No findings and no independent review were recorded for this
work item.

## Try it now

Run or do:

```bash
DOMINO_DB_PATH=.domino/mvp-check.db npm run dev
```

Open `http://localhost:3000/en/workflows`.

Expected: a `MVP three-step workflow` card with code `mvp-workflow`, badge
`Latest: Version 1`, `Last run: No runs yet.`, and `Steps` listing
`Step inspect` with badge `MVP step instructions v1`, `Step apply` with badge
`MVP step instructions v2` plus `Approve the changes before the agent applies
them.`, and `Step verify` with badge `MVP step instructions v3`. The
`Approval points` column shows `approve-apply` with the same message. Delete
`.domino/mvp-check.db` to see the seed run again.

This proves: the empty-store boot seed publishes the three-step workflow and its
single approval point, and the existing dashboard renders them.
