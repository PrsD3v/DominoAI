# Execution History

> **Supplementary project memory.** This file records decisions, closures, and
> out-of-roadmap work that the canonical 16-feature roadmap does not express. It
> is not a roadmap and never overrides the canonical plans.

## Authority

| Document | Role |
| --- | --- |
| `blueprint/build-plan.md` | Canonical roadmap: scope, order, completion markers |
| `blueprint/project-plan.md` | Canonical product plan: problem, users, data, tech, delivery |
| `blueprint/context/project-overview.md` | Generated consolidation of the two plans |
| `blueprint/context/current-feature.md` | Active feature context for this checkout or worktree |
| `blueprint/history/` | Immutable completed specs |
| `blueprint/context/execution-history.md` | This file: dated out-of-roadmap history |

Suggested reading order for an agent: the build plan, then this file, then the
active spec. This file cannot authorize skipping roadmap work, changing
completion markers, or claiming unverified behavior.

## Maintenance rules

1. Append a dated entry. Do not rewrite or delete older entries.
2. Record evidence: commit SHAs, file paths, commands, archive paths, and hashes.
3. Label every entry with one status: `VERIFIED`, `COMPLETED`, `PROPOSED`,
   `BLOCKED`, `DEFERRED`, or `UNVERIFIED`.
4. `COMPLETED` means implemented and recorded. It does not mean merged, deployed,
   or live verified.
5. Never record a live runtime result unless the exact command ran and produced
   it. Administrative closure is not technical verification.
6. Never edit `blueprint/build-plan.md` or `blueprint/project-plan.md` to
   accommodate an execution-order preference. That is a separate user decision.

## State snapshot, 2026-10-30

Observed from the repository, not from a dashboard:

- Canonical roadmap: 3 of 16 items checked in the root `build-plan.md` (1, 2, 3).
  Next unchecked item is 4. Features 4 to 8 remain open.
- Active feature: none. `blueprint/context/current-feature.md` is the canonical
  "Nothing in progress" stub.
- Findings and independent review: both canonical empty stubs.
- Checked out here: `feature/handshake-capability-discovery-and-session-lifecycle`
  at `9464a35`.
- `main` is at `c9c269f` (feature 2). Feature 3 is not merged.
- Uncommitted at this snapshot: the feature 3 closure bookkeeping
  (`build-plan.md` item 3 note, overview source-hash, unarchived archive file) and
  the `docs/reasonix-acp-contract.md` observation dates. Completion markers do not
  imply a merge or a live verification.

## Feature 3 administrative closure

Status: `COMPLETED` administratively on 2026-10-30, with live verification
`DEFERRED`.

- Build steps 1 to 4 were implemented and committed in `9464a35` ("feat: add ACP
  handshake and session lifecycle").
- Build step 5, live proof against the installed Reasonix, is `UNVERIFIED`. It was
  not checked off.
- Live runs on 2026-10-29 and 2026-10-30 reached a successful `initialize`
  handshake, then `session/new` failed with a JSON-RPC error because the model
  `deepseek/deepseek-flash` has no API key. `session/close` was never reached and
  no prompt was sent.
- Why it cannot pass here: Reasonix reads provider keys from `~/.reasonix/.env`,
  which is a `/dev/null` character device in this environment, and it does not
  read shell environment variables. The repository `.env` is not read by the
  runtime.
- The closure is an acceptance exception, not a technical success. No live
  Reasonix session creation or close is verified, and the feature's live
  acceptance was not met.
- Archive:
  `blueprint/history/features/03-handshake-capability-discovery-and-session-lifecycle.md`.
  The first 19,348 bytes are the original spec bytes,
  `sha256 9e110ca58b3a890cd54b7d5a36e220f0496cebbf96e9cfbe952e8c93f5c17506`.
  A `## Verification exception` section follows the spec and records the reason,
  the acceptance criteria, and the resume procedure.
- The archive is currently untracked. Closure did not create an implementation
  commit, did not merge anything, and did not run a passing live test.
- `docs/reasonix-acp-contract.md` keeps `session/new` and `session/close` in the
  "PoC only; not verified through Domino" bucket. Do not promote them without a
  passing live run.

### Resuming live verification

Add a disposable key for `deepseek/deepseek-flash` where Reasonix reads it
(`~/.reasonix/.env`, or run `reasonix setup`), then run:

```bash
DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/runtime.live.test.ts
```

Only a passing run updates the contract table. The original acceptance criteria
remain in the archived step 5 and in the archive's verification-exception
section.

## Planning commits

| Commit | Subject | Files changed |
| --- | --- | --- |
| `3d237c6` | `docs: record feature separation and stage status` | `build-plan.md`, `project-plan.md` |
| `20cf406` | `docs: synchronize Blueprint feature hierarchy` | `build-plan.md`, `project-overview.md` |
| `e29a8c7` | `docs: defer blocked Feature 3B` | `build-plan.md`, `project-overview.md`, `project-plan.md` |

These commits introduced the 3A/3B split, the 11A stage breakdown, and the
"runtime profile" records in the planning documents. They live on the
`docs/feature-separation-status` line, not on `main` or on the feature 3 branch
tip.

## Feature 4 preparation

Status: `PROPOSED` specification only. Not implemented.

- Worktree: `/home/prs/Projects/dominoai/.worktrees/feature-4`
- Branch: `feature/prompt-execution-and-event-normalization`
- HEAD at this snapshot: `7d042cc` ("chore: integrate deferred planning status
  for Feature 4")
- Specification: uncommitted `blueprint/context/current-feature.md`,
  `sha256 ad336d87293311827e497ed4ee7e1e7ae83b0327d4982e9647f2128d03de56ce`.
  All five build steps are unchecked.
- The spec implements `session/prompt` against the fake agent only. It makes no
  live Reasonix prompt claim, and it records Feature 3B as blocked.
- Do not overwrite this worktree, its branch, or its uncommitted spec. Do not
  assume implementation happened.

## Feature 11A (Reasonix provider, model, and credential settings)

Branch `feature/reasonix-provider-settings`, tip `982356f`. Its base is
`3d237c6` on `main`'s `c9c269f`, so this branch does not contain the feature 3
adapter commits from `9464a35`.

| Stage | Status | Commit | Notes |
| --- | --- | --- | --- |
| 1 Contracts | `COMPLETED` | `f99b40d` | `RuntimeProfile`, `CredentialRef`, write-only `CredentialStore`; validation rejects secrets and readback |
| 2/2.1 Credential file store | `COMPLETED` | `0b7136a` | `ReasonixEnvFileStore` for `<Reasonix home>/.env`; atomic, locked, symlink-safe writes; combined stage unit |
| 3 Provider/model catalog | `COMPLETED` | `982356f` | Read-only metadata from `reasonix doctor --json`; presence only, no validity claim |
| 4 Runtime Profile persistence and migration | `BLOCKED` | none | Needs Features 9 and 10; temporary-database tests and migration are part of its acceptance |
| API, Settings UI, real connection test, project default profile | `BLOCKED` | none | Needs 3B, Feature 4, and Stage 4 |

- Files: `src/types/runtime-settings.ts`, `src/types/runtime-catalog.ts`,
  `src/lib/runtime/reasonix/env-file-store.ts`,
  `src/lib/runtime/reasonix/provider-catalog.ts`, and their tests.
- Do not duplicate or reimplement Stage 2/2.1. Extend the existing store.
- No stage marks Feature 11A complete, and no connection validity is claimed.

## Execution-order discussion

Status: `PROPOSED`, not approved, not implemented.

- Prioritizing Features 9 and 10 over Features 4 to 8 has been discussed as a
  possible execution strategy.
- Preparation exists: branch `feature/workflow-engine-core` and worktree
  `/home/prs/Projects/dominoai/.worktrees/feature-9`, both at `7d042cc`, with an
  uncommitted Feature 9 specification,
  `sha256 bcbe278d17337c22115f1e610e781ca4251f32973bf15e6c03dd3eb259d90b48`.
  The specification's seven steps are unchecked and no workflow code exists.
- There is no evidence of approval and no implementation. The canonical roadmap is
  unchanged, and the planning `project-plan.md` still records that Features 9 and
  10 keep their existing order as prerequisites for Feature 11A Stage 4.
- A readiness review of Feature 9 produced the verdict "READY WITH
  PREREQUISITES", where the prerequisites are decisions and boundaries, not
  earlier feature code. That verdict is advisory and does not authorize
  reordering, skipping Features 4 to 8, or starting implementation.

## Roadmap variants

Two roadmap variants exist at this snapshot. Recorded for orientation; not
resolved here.

- Root `blueprint/build-plan.md` (canonical in this checkout): 16 features, with
  item 3 closed administratively.
- Planning-integrated variant, introduced by `3d237c6`, `20cf406`, `e29a8c7`, and
  merged into feature 4 and feature 9 at `7d042cc`: adds 3A/3B, item 11A with
  stages, and the Feature 9 runtime-binding acceptance.
- Always read the plan from the checkout you are in. Titles and numbering can
  differ between branches. Resolving the variant difference is a user decision,
  not an agent edit.

## Known gaps and unverified items

- Feature 3 live verification remains `DEFERRED`; only the local adapter path is
  tested.
- feature 4 is specified but not implemented.
- Features 5, 6, 7, 8, and 10 have no specification file; only their roadmap
  lines exist.
- Feature 11A Stage 4 and later are blocked.
- The feature 11A branch does not contain the feature 3 adapter code.
- No dashboard record was used as evidence for this file; all facts above were
  read from Git state, plan files, code, and tests on 2026-10-30.

## Feature 9 execution-order approval and decision resolution, 2026-10-30

Status: `COMPLETED` for the execution-order decision; `PROPOSED` for
implementation. This section updates the status of the earlier
"Execution-order discussion" note. Its historical facts remain.

- The user approved Feature 9 as the next execution priority on 2026-10-30,
  ahead of Features 4 to 8. The canonical 16-feature roadmap in
  `blueprint/build-plan.md` is unchanged. This is an execution-order decision,
  not a roadmap edit.
- Worktree: `/home/prs/Projects/dominoai/.worktrees/feature-9`
- Branch: `feature/workflow-engine-core`
- HEAD: `7d042cc` ("chore: integrate deferred planning status for Feature 4")
- Specification: uncommitted `blueprint/context/current-feature.md`,
  `sha256 d90e0d78837bfece02bca5916eb81ef30d06c89cc2bd427865b1c590c673994e`.
- No implementation, test, commit, merge, push, reset, rebase, stash, or discard
  was performed. The base suite was green before the specification edit:
  `npm test` passed 96 tests with 2 live tests skipped, and `npx tsc --noEmit`
  passed.

Resolved Feature 9 decisions:

1. **Feature 8 boundary.** Feature 8 owns the published, versioned workflow and
   skill model. Feature 9 owns only `WorkflowExecutionPlan`, projected through
   `src/lib/workflow/projection.ts` from a narrow `PublishedWorkflowView`.
   Feature 9 declares no public `WorkflowDefinition` or `WorkflowStepDefinition`
   and does not import Feature 8. Skill content is resolved before projection.
   Status: `PROPOSED` until implementation approval.
2. **Retry backoff.** `maxAttempts` only, default 1, immediate retries, with no
   delay, backoff, jitter, or timer. Status: `PROPOSED`.
3. **Approval waiting.** The engine never waits, never creates an approval
   request, and never enters `waiting_approval`. Approval-point semantics are
   Feature 8; raising and answering approvals are Feature 14. The execution
   record stays in the persistence contract for Feature 10/14. Status:
   `PROPOSED`.
4. **Project persistence.** Feature 9 excludes projects. Feature 10 owns the
   durable project record, schema, and migration mechanism. Feature 11 owns
   registration, root validation and canonicalization, and configuration
   semantics, and writes through Feature 10's store. Additional project fields
   arrive as a Feature 11 migration. Status: `PROPOSED`.
5. **Session close failure.** A close failure is recorded in history but does not
   fail a successful step or run and does not trigger a retry. A prompt error
   remains the primary attempt failure. Status: `PROPOSED`.

Implementation remains blocked on explicit user approval of this specification.

## Feature 4 spec refresh, 2026-10-30

Status: `COMPLETED` for the specification; `PROPOSED` for implementation.

- The user chose "Refresh the spec in the worktree" over creating a second
  active spec in the root checkout. The root checkout cannot freeze a new spec
  for this feature: branch `feature/prompt-execution-and-event-normalization`
  exists, is checked out in `.worktrees/feature-4` at `7d042cc`, its HEAD is not
  local `main` (`c9c269f`), and its tree holds an uncommitted project change.
- Worktree: `/home/prs/Projects/dominoai/.worktrees/feature-4`
- Spec: `blueprint/context/current-feature.md`, `sha256
  daa0c7f1749b3138a42d764f10d499b31854356d0023a4cb50f9ba47b6953c8a`. It
  supersedes the earlier hash `ad336d87…56ce`; the earlier entry above remains
  as history. Branch, archive path, and build attempt 1 are unchanged.
- What the refresh changed: aligned the roadmap position with the
  planning-integrated plan (3A complete, 3B blocked and deferred, 11A's
  connection test depends on 3B and Feature 4); named the unknown-stop-reason
  error `AcpUnsupportedStopReasonError` with `reportedStopReason`; recorded the
  PoC evidence for `params.sessionId`, `params.update.sessionUpdate`, and
  `update.content.text`; added late-chunk, text-free, and throwing-`onEvent`
  cases so listener cleanup and text preservation are observable; made
  close-during-prompt and prompt timeout explicit Feature 5 scope; recorded that
  `npx next typegen` must run before `npx tsc --noEmit` in this worktree.
- No implementation, commit, merge, push, reset, or discard. All five build steps
  remain unchecked.
- Baseline evidence in the worktree: `npm test -- src/lib/runtime/acp/protocol.test.ts
  src/lib/runtime/acp/runtime.test.ts` passed 28 tests; after `npx next typegen`,
  `npx tsc --noEmit` passed. The live tests were not run.

## Branch consolidation onto main, 2026-10-30

Status: `COMPLETED` locally; nothing was pushed.

- All work now lives on `main`. `main` fast-forwarded from `c9c269f` to `7d042cc`
  (Feature 3A plus the planning commits), then merged
  `feature/reasonix-provider-settings` (`982356f`) in `56a6911`. The merge added
  the 11A provider/credential source files and kept the newer planning documents.
- One commit adds the remaining pending work: Feature 3 closure bookkeeping
  (`execution-history.md`, the 03 archive, the `AGENTS.md` pointer, and the
  2026-10-30 ACP contract observation dates), the refreshed Feature 4 spec as the
  active `current-feature.md`, and Feature 9's spec plus its implementation.
- Feature 9's spec is parked at
  `blueprint/context/parked/feature-9-workflow-engine-core.md` because only one
  `blueprint/context/current-feature.md` may be active. Its `src/lib/workflow/`
  and `src/types/workflow*.ts` files are committed on `main`; its 23 tests passed
  in the old worktree before the move.
- Worktree directories `.worktrees/feature-4`, `.worktrees/feature-9`, and
  `.worktrees/planning` were removed, and the empty `.worktrees/` was deleted.
  Branches `feature/handshake-capability-discovery-and-session-lifecycle`,
  `feature/prompt-execution-and-event-normalization`, and
  `feature/reasonix-provider-settings` were deleted after the merge.
- Two branch refs and their worktree metadata remain because the agent sandbox
  protects `.git/worktrees/*` and `.git/config`: `docs/feature-separation-status`
  and `feature/workflow-engine-core` are still listed as prunable worktrees.
  Finish outside the sandbox with
  `git worktree prune && git branch -d docs/feature-separation-status feature/workflow-engine-core`.
  A `blueprint dashboard --target .worktrees/feature-9` process may also still be
  running against the removed path.
- Going forward: one branch per feature from `main`; on completion merge into
  `main`, push, and delete the feature branch.
- No push, reset, or stash was used. Every uncommitted file was snapshotted to the
  session scratch directory before consolidation.
