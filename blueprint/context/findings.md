# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-01 [P3] open - Live `session/list` test passes on an empty result

**File:** src/lib/runtime/acp/session-list.live.test.ts:34
**Found:** 2026-10-30 by /audit (scope: current; lens: tests)
**Why it matters:** The test asserts only that the result is an array, then checks
each entry inside a loop. A runtime that returned `[]` would pass unchanged, so
the test proves the RPC round trip but not that real summary fields parse. The
contract table entry in `docs/reasonix-acp-contract.md` cites this test as
evidence that `sessionId`, `cwd`, `title`, and `updatedAt` were returned, which
the current assertions do not require.
**Suggested fix:** Follow-up only, because the approved spec prescribes this
assertion set. When the store is known to hold sessions, assert a non-empty
result (or compare the parsed ids against the observed list) so the evidence
matches the contract row.
**Resolution:** Recorded during the 6A independent review. Observed evidence
outside the test showed the installed runtime returns five summaries with the
expected string fields, so the contract row is accurate today; the gap is in the
assertion strength, not in the code under review.

### F-02 [P2] open - Run operations write stale run snapshots back over newer state

**File:** src/lib/workflow/engine.ts:204
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality, security)
**Why it matters:** `pauseRun` (read at `engine.ts:204`, write at `engine.ts:215`),
`cancelRun` (`:255` then `:271`), and `continueRun` (`:226` then `:232`) each read
the persisted run, branch on that snapshot, then write the whole record back with
a spread of the stale copy. The status they write is the status they read, so a
terminal transition that lands in that window is silently reverted: for example
`complete()` writes `status: "completed"`, then `cancelRun` writes the earlier
snapshot plus `cancelRequested: true`, putting a finished run back to `running`.
Two secondary effects follow: `complete()`/`failRun()` already drained
`cancelWaiters`/`pauseWaiters` and set `this.active = null` before the stale write,
so the operation's returned promise never settles and its caller hangs, and the
reverted record is never repaired because no later transition looks at it. The
window is one microtask with the shipped in-memory store, which is why nothing
fails today; Feature 10 implements this same interface with SQLite, where both
calls suspend on I/O and the interleaving becomes ordinary.
**Suggested fix:** Re-read the run immediately before writing and refuse or skip
the write when the status changed (keep the existing typed state error), or give
the persistence update an expected-current-status precondition so a stale write
is rejected instead of applied. Do not add a lock or a scheduler.
**Resolution:** Re-examined on 2026-10-30 during the Feature 10 audit against the
shipped `SqliteWorkflowStore`. The store's methods do their SQL synchronously,
but the engine still `await`s every one of them, and an `await` of an
already-settled promise yields to the microtask queue. The read-then-write pair
in `pauseRun`, `cancelRun`, and `continueRun` therefore spans an ordinary await
boundary with the new store, exactly as predicted. Status unchanged.

### F-03 [P2] open - A rejected background run task wedges the engine and rejects unhandled

**File:** src/lib/workflow/engine.ts:194
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality)
**Why it matters:** `startRun` (`engine.ts:194`) and `continueRun`
(`engine.ts:248`) both call `void this.run(active)`. `run()` catches an `execute`
failure and `await`s `failRun`, but `failRun` itself awaits `persistence.getRun`,
`listStepRuns`, `updateStepRun`, and `appendHistory` (`engine.ts:706`). If any of
those reject, the rejection escapes `run()` with no handler attached: it becomes
an unhandled rejection (a process-terminating uncaught exception under Node's
default policy), `completion` never settles so every caller awaiting the handle
hangs, and `this.active` is never cleared, so the engine permanently refuses a new
run with `WorkflowRunStateError`. The same shape applies to `complete()`
(`engine.ts:696`): if `updateRun` succeeds and `appendHistory` rejects, `failRun`
returns early because the record already says `completed`, and the completion
promise is never resolved.
**Suggested fix:** Make the terminal path non-throwing: wrap the failure and
completion transitions so the active run, `this.active`, and the completion
promise are always settled even when a persistence call rejects, and attach a
rejection handler to the `this.run(active)` call rather than discarding the
promise.

### F-04 [P2] open - Engine functions far exceed the project's 50-line limit

**File:** src/lib/workflow/engine.ts:356
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality)
**Why it matters:** `coding-standards.md` asks for functions under 50 lines when
possible. `executeStep` is about 180 lines (`engine.ts:356-537`) and mixes attempt
bookkeeping, containment refusal, retry policy, cancelled results, and step
persistence. `startRun` is about 78 lines (`:123-200`), `execute` about 67
(`:288-354`), and `runAttempt` about 59 (`:539-597`). The same
`run.status === "completed" || "failed" || "cancelled"` guard is copied at `:635`,
`:657`, `:682`, and `:709`, and `pause`/`cancel`/`complete`/`failRun`
(`:634-752`) are four near-identical record-transition blocks. This is the file
Features 10, 13, 14, and 15 will each edit, so the duplication is the mechanism
that will let a later status handling change drift out of step.
**Suggested fix:** Extract one `transitionRun(active, status, patch)` helper for
the four terminal transitions and split `executeStep` into an attempt loop plus
small "record attempt failure / record completion" helpers. Behavior stays the
same; the existing tests already pin the history and status sequences.

### F-05 [P3] open - A cancel requested during a step still starts a fresh retry attempt

**File:** src/lib/workflow/engine.ts:387
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality)
**Why it matters:** `execute` observes `cancelRequested` only between steps
(`engine.ts:305`, `:339`), while the attempt loop inside `executeStep`
(`engine.ts:387-444`) never consults it. If a step with `maxAttempts > 1` throws
after `cancelRun` was called, the loop creates a new runtime session for the next
attempt and only then cancels the run. The user asked to stop, and a new runtime
session starts anyway. The spec states cancel starts no next step, so this is a
gap rather than a violation, and no test covers it.
**Suggested fix:** Break out of the attempt loop when a cancel (or pause) has been
requested, leaving the step at the result it reached so `execute` can record the
run cancellation without another `createSession` call.

### F-06 [P3] open - The containment result is discarded, so `workingDirectory` is validated but never used

**File:** src/lib/workflow/engine.ts:389
**Found:** 2026-10-30 by /audit independent (scope: current; lens: security, performance)
**Why it matters:** `executeStep` awaits `resolveContainedStepPath` for every
attempt and throws the returned canonical path away (`engine.ts:389-392`), while
`createSession` receives only `run.workspaceRoot` (`engine.ts:552`), because
`CreateSessionRequest` has no working-directory field. The outcome is that a step
declaring `workingDirectory: "sub"` passes the check and then runs at the
workspace root, and the per-step check guards a path that nothing consumes. The
behavior matches the spec's step 4 wording, so this is not a defect today, but the
check's value depends on a discard that a later runtime contract change would
turn into a real gap.
**Suggested fix:** Keep the resolved path in a local and either pass it once the
runtime contract carries a working directory, or say in one line of code comment
that `workingDirectory` is validation-only in Feature 9 so the discard reads as
deliberate.

### F-07 [P3] open - Prefix test rejects inside directories whose name starts with `..`

**File:** src/lib/workflow/containment.ts:68
**Found:** 2026-10-30 by /audit independent (scope: current; lens: security)
**Why it matters:** `relativePath.startsWith("..")` treats any relative path that
begins with two dots as an escape. A directory named `..data` inside the
workspace resolves to the relative path `..data` and is refused with reason
`outside` even though it is inside the canonical root. The failure is a
false refusal, not an escape, so no path escapes containment; the cost is a
misleading typed error and a step that cannot use a legal directory.
**Suggested fix:** Compare with a separator boundary, for example
`relativePath === ".." || relativePath.startsWith(".." + sep)`, importing `sep`
from `node:path`.

### F-08 [P3] open - New workflow files bypass the `@/` import alias

**File:** src/lib/workflow/engine.ts:1
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality)
**Why it matters:** `coding-standards.md` requires imports through the `@/*` path
alias rather than long relative paths. The new files use `../../types/runtime`
and `../../types/workflow` (`engine.ts:1`, `engine.ts:2`,
`in-memory-persistence.ts:9`, `engine.test.ts:15-16`,
`in-memory-persistence.test.ts:10`), while the feature's own base files
`execution-plan.ts:1` and `projection.ts:1` use `@/types/workflow`. The result is
two import conventions inside one small module that later features must copy.
**Suggested fix:** Switch the five import sites to `@/types/runtime` and
`@/types/workflow`. No behavior changes.
**Resolution:** Re-examined on 2026-10-30: `engine.ts` is unchanged in the
Feature 10 build and the same convention drifted into the new persistence files,
so the finding stays open. See F-10 for the new sites.

### F-09 [P3] open - Attempt events are buffered and an append failure discards a successful result

**File:** src/lib/workflow/engine.ts:544
**Found:** 2026-10-30 by /audit independent (scope: current; lens: performance)
**Why it matters:** `runAttempt` collects every streamed delta in an in-memory
array for the whole attempt (`engine.ts:544`, `:567-575`) and only then writes
them one `await` at a time in the `finally` block (`:579-583`). For a long prompt
that is unbounded per-attempt growth followed by a serial write loop, and because
the loop shares the `finally` block with the session close, a rejected
`appendRuntimeEvent` propagates out of `runAttempt` and turns a successful prompt
into a failed step and a failed run even though the result was recorded. The spec
requires forwarding deltas but does not require buffering them until the attempt
ends.
**Suggested fix:** Persist each event as it arrives (or in small batches) so
memory stays bounded and the write cost overlaps the prompt, and keep the event
flush inside its own try/catch so a persistence failure is recorded in history
without overwriting the attempt result.

### F-10 [P3] open - The new persistence files bypass the `@/` import alias

**File:** src/lib/workflow/sqlite/sqlite-store.ts:2
**Found:** 2026-10-30 by /audit (scope: current; lens: quality)
**Why it matters:** `coding-standards.md` requires imports through `@/*`. The
Feature 10 files repeat the Feature 9 drift instead of fixing it:
`sqlite-store.ts:2`, `:7`, `:22`, `:32`, `sqlite/migrations.ts:2`,
`startup-reconciliation.ts:1`, and the three new test files all import
`../../../types/...` or `../../types/...`, while sibling modules such as
`execution-plan.ts:1` and `projection.ts:1` use `@/types/workflow`. The result is
now three features of files that must be converted, and the new modules are the
copies later features will follow.
**Suggested fix:** Switch the new import sites to `@/types/...` and
`@/lib/...` in the same change that fixes F-08. No behavior changes.
**Resolution:** Re-examined on 2026-10-30 during the independent review of
Feature 10; the new files still use relative type imports. Stays open.
Re-checked on 2026-10-30 during the Feature 11 independent review: the new
`src/lib/projects/registration.ts` does import `@/types/persistence`, so the
drift did not spread into this module and its test file keeps relative runtime
imports only as the spec requires. The listed Feature 10 sites still need the
change. Stays open.
Re-checked on 2026-10-30 during the 11A Stage 4 independent review: the new
import site `sqlite-store.ts:13` (`../../../types/runtime-settings`) and the new
test file `runtime-profiles.test.ts:5` (`../../../types/runtime-settings`) repeat
the same relative form, while the contract added to `src/types/persistence.ts`
uses a sibling-relative `./runtime-settings` that matches that file's existing
convention. Stays open.

### F-11 [P2] open - A failed history append loses the interruption record for good

**File:** src/lib/workflow/startup-reconciliation.ts:47
**Found:** 2026-10-30 by /audit (scope: current; lens: quality, security)
**Why it matters:** Each reconciled run takes two separate persistence writes:
`updateRun` marks it `interrupted` (`:47`), then `appendHistory` writes the single
`run_interrupted` entry (`:48`). The status write lands first, so any failure or
process stop between the two leaves a run that permanently looks reconciled. The
next call skips it because it is no longer active, so the missing history entry is
never repaired and the contract's "exactly one `run_interrupted` history entry"
silently becomes zero. Reproduced by wrapping the in-memory store so
`appendHistory` rejects once: the first call throws, the run is already
`interrupted`, and a second call returns `[]` with `listHistory` empty. The same
window exists for a real crash, a full disk, or a history id collision with the
derived `${run.id}:interrupted` id.
**Suggested fix:** On a second call, also repair `interrupted` runs that lack
their deterministic `run_interrupted` entry (read history, append when absent),
or add a store-level transaction that updates the run and appends the entry
atomically. The first option needs no interface change.
**Resolution:** Re-examined on 2026-10-30 during the independent review. The
two writes are still separate in `startup-reconciliation.ts:47-48`, so the
window stands. Stays open.

### F-12 [P3] open - `createRun` accepts a plan that `getRun` then refuses

**File:** src/lib/workflow/sqlite/sqlite-store.ts:169
**Found:** 2026-10-30 by /audit (scope: current; lens: quality)
**Why it matters:** `decodePlan` requires at least one step (`:169`), but
`createRun` (`:526`) writes any plan the caller passes. A run created with
`steps: []` is accepted and stored, and every later read of it throws
`WorkflowPersistenceError("decode")`. The in-memory store returns such a record
unchanged, so the two implementations differ, and a store that accepts a write it
cannot read back is a durability contract hole. Reproduced against
`openSqliteWorkflowStore`: the create resolves, then `getRun` rejects with
`code: "decode"`. The engine cannot produce this today because
`validateExecutionPlan` refuses an empty plan, so the reachable caller is direct
persistence use in a later feature.
**Suggested fix:** Validate the plan (at least one step, and the documented decode
invariants) in `createRun`/`updateRun` and throw the `decode` or `invalid` code
there, so a write that the store cannot read back is refused at the write.
**Resolution:** Re-examined on 2026-10-30 during the independent review. The
same write/read asymmetry also covers status, step status, history kind, and
event shape: `insertRow` stores them unvalidated (`sqlite-store.ts:526`, `:766`,
`:793`) and only the read path rejects them. One write-path validation fix
covers all of them. Stays open.
Re-checked on 2026-10-30 during the 11A Stage 4 review: the new
`createRuntimeProfile` and `updateRuntimeProfile` (`sqlite-store.ts:1089`,
`:1116`) do validate with `isRuntimeProfile` before inserting or updating, so the
asymmetry stays confined to the run, step, history, and event writers. That
validate-then-write shape is the pattern the fix should copy. Stays open.

### F-13 [P3] open - Unique-versus-conflict classification reads SQLite's message text

**File:** src/lib/workflow/sqlite/sqlite-store.ts:227
**Found:** 2026-10-30 by /audit (scope: current; lens: quality)
**Why it matters:** `mapWriteError` distinguishes a duplicate id from a repeated
`(definitionId, version)` pair by matching `/.id(,|$)/` against the SQLite error
message, because both surface as `errcode` 2067. The documented contract says a
duplicate id raises `WorkflowRecordError` and a repeated pair raises
`WorkflowPersistenceError("conflict")`, so any change in SQLite's or Node's error
text silently turns one into the other, and the tests only pin today's wording.
**Suggested fix:** Work from the constraint itself instead of the text, for
example by checking the id before inserting (`SELECT 1 ... WHERE id = ?`) and
letting the composite unique constraint map to `conflict`, or by catching the
error and re-reading which column set collided. Keep the existing tests.
**Resolution:** Re-examined on 2026-10-30 during the independent review;
`mapWriteError` still matches `/.id(,|$)/` against the SQLite message
(`sqlite-store.ts:227`). Stays open.

### F-14 [P3] open - Duplicate-id, decode-branch, and update-rollback paths lack focused tests

**File:** src/lib/workflow/sqlite/sqlite-store.test.ts:233
**Found:** 2026-10-30 by /audit (scope: current; lens: tests)
**Why it matters:** The suite proves the main paths well, but the spec's step 2
and 5 done-whens reach further than the assertions do. Duplicate-id
`WorkflowRecordError` is asserted only for runs, workflow definitions, and
workflow versions; step runs, approvals, session references, runtime events,
history entries, skill definitions, skill versions, and project version
selections are untested. Decode failures are asserted for a truncated plan, a
wrong-shaped event, an unknown status, an unknown history kind, and a
wrong-shaped project configuration, but not for the boolean, integer, optional
string, and plan-shape branches of `readBoolean`, `readInteger`,
`readOptionalString`, and `decodePlan`. Selection replacement is tested on update,
but the rollback of a failed `updateProject` (old selections preserved) is not,
while the create rollback is.
**Suggested fix:** Add the missing duplicate-id cases through a table-driven
test, one corrupted-value case per decode helper, and one assertion that a failed
`updateProject` leaves the previous selections in place.
**Resolution:** Re-examined on 2026-10-30 during the independent review; the
suite still covers only the cases this entry lists. Stays open.

### F-15 [P3] open - The mutation-isolation test never mutates the object that was stored

**File:** src/lib/workflow/sqlite/sqlite-store.test.ts:207
**Found:** 2026-10-30 by /audit independent (scope: current; lens: tests)
**Why it matters:** `seed(store)` builds its own `baseRun()` internally
(`:147-150`), while the test's local `run = baseRun()` (`:209`) is never passed
to the store. Mutating `run.status` (`:214`) therefore proves nothing about
stored-input isolation, although the spec's step 2 done-when explicitly requires
"mutating ... a stored input object does not change stored state". The
returned-record half of the check (`:216-230`) is real, and the implementation
is safe because values are serialized into SQLite at write time, so this is a
false-confidence gap in the test, not a live defect.
**Suggested fix:** Store the local object (`const run = baseRun(); await
store.createRun(run);`), mutate it after the write, then assert the stored
record is unchanged.
**Resolution:** Open.

### F-16 [P3] open - An explicit `null` is silently treated as an omitted value

**File:** src/lib/projects/registration.ts:114
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality, security)
**Why it matters:** `options.configuration ?? {}` (`registration.ts:114`) and the
two `?? []` spreads for `workflowVersionIds` and `skillVersionIds` (`:124`,
`:125`) cannot tell an explicit `null` from a missing property. The spec requires
`configuration` to be a JSON-serializable plain object and requires
`invalid-configuration` otherwise, and the same function rejects `null` correctly
one field over: `validateProfileId` (`:174`) throws `invalid-profile-id` for
`null` because it tests `=== undefined` first. Reproduced on Node 24 by calling
`registerProject({ configuration: null, workflowVersionIds: null,
skillVersionIds: null })` against a fake store: registration succeeds and the
stored record holds `{}`, `[]`, `[]`. Feature 15 will parse an HTTP body into
these fields, where `null` is ordinary JSON any client can send, so malformed
input is stored as if it had been left out. Nothing is lost, because the defaults
are the only meaning `null` could carry, which keeps this at P3.
**Suggested fix:** Validate first, then default: treat only `undefined` as
omitted (`const configuration = options.configuration === undefined ? {} :
options.configuration;`) so `null` reaches `isRecord` and raises
`invalid-configuration`. Same shape for the two selection lists.
**Resolution:** Open.

### F-17 [P3] open - `ENOTDIR` and `ELOOP` escape the typed registration reasons

**File:** src/lib/projects/registration.ts:222
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality)
**Why it matters:** `mapRootError` (`registration.ts:222-234`) converts only
`ENOENT`, `EACCES`, and `EPERM` and returns every other error unchanged, which
matches the spec's root-mapping line. Every remaining root-resolution failure
therefore reaches the caller as a raw Node error with no `reason`, even when the
supplied path itself caused it. Reproduced on Node 24: `registerProject` with
`<cwd>/package.json/nested` rejects with a plain `Error`
(`reason: undefined`, `code: "ENOTDIR"`, not a `ProjectRegistrationError`), while
`<cwd>/package.json` rejects correctly as `ProjectRegistrationError` /
`root-not-directory`. A symlink loop reaches the same path through `ELOOP`. The
outcome is a misleading error, never a wrong registration, but a caller that
branches on `reason`, which Features 14 and 15 will do, also has to handle an
untyped failure for a mistyped path.
**Suggested fix:** Map `ENOTDIR` to `root-not-directory` and choose `ELOOP`
explicitly (`root-missing` or `root-inaccessible`); it is one condition in
`mapRootError`. That changes the spec's "other errors propagate unchanged" line,
so it needs the user's decision rather than an automatic repair.
**Resolution:** Open.

### F-18 [P3] open - Canonical-root resolution is duplicated from containment with a different error taxonomy

**File:** src/lib/projects/registration.ts:216
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality)
**Why it matters:** `resolveExistingPath` and `resolveWorkspaceRoot`
(`registration.ts:216-247`) repeat the `realpath` + `stat` + `isDirectory` core of
`canonicalDirectory` in `src/lib/workflow/containment.ts:75`, but the two copies
map failures differently: containment maps every failure, including `EACCES` and
`EPERM`, to `missing`, while registration distinguishes `root-missing`,
`root-not-directory`, and `root-inaccessible`. The spec's notes tell this feature
not to re-implement Feature 9's containment, and the part that was re-implemented
is the canonicalization that decides which workspace root identifies a project,
which the spec says the workspace allowlist derives from. Any later change to
canonicalization (case handling, trailing separators, a new error code) now has to
be made twice, and the two copies already disagree about what an unreadable
directory means.
**Suggested fix:** Extract one shared helper that returns a discriminated
canonicalization result and let each caller map it into its own error type.
Roughly 15 lines disappear and both callers keep their current outward behavior.
**Resolution:** Open.

### F-19 [P3] open - Three spec-stated validation behaviors have no test

**File:** src/lib/projects/registration.test.ts:436
**Found:** 2026-10-30 by /audit independent (scope: current; lens: tests)
**Why it matters:** The suite covers every error reason and both storage paths
well, but three spec-stated behaviors are asserted nowhere. Duplicate selection is
exercised only for `workflowVersionIds` (`registration.test.ts:436`), while
`skillVersionIds` duplicates run through a separate loop
(`registration.ts:265`) that no test reaches. The spec says the name is stored
exactly as supplied with no trimming, but the only name assertion is
`toBe("Domino")` (`:114`), so a future `trim()` in `validateName` would pass
unnoticed. `root-inaccessible` is in the error union and in `mapRootError`, and no
test ever takes that branch, so an `EACCES`/`EPERM` regression stays silent.
**Suggested fix:** Add the skill duplicate case beside the existing duplicate
test, register with `name: "  Domino  "` and assert verbatim storage, and take the
inaccessible branch with `chmod 0o000` on a temporary directory, skipping the
case with a visible reason only when the runner is root.
**Resolution:** Open.

### F-20 [P3] open - The validity guard dereferences the value it is guarding

**File:** src/lib/workflow/sqlite/sqlite-store.ts:1090
**Found:** 2026-10-30 by /audit independent (scope: current; lens: quality, security)
**Why it matters:** `createRuntimeProfile` (`sqlite-store.ts:1089-1094`) and
`updateRuntimeProfile` (`:1116-1121`) call
`requireValidDefinition(isRuntimeProfile(profile), "runtime profile", profile.id)`.
JavaScript evaluates every argument before the call, so `profile.id` runs even
when `isRuntimeProfile(profile)` has already returned false. A caller that
bypasses the TypeScript type with `null` or `undefined` therefore gets a raw
`TypeError` instead of the `WorkflowPersistenceError` with code `invalid` that the
spec promises for "a secret-bearing or otherwise invalid profile even when a
caller bypasses the TypeScript type". Nothing is written either way, so this is an
error-contract deviation, not a data risk, and it is the existing store-wide shape
(`createRun`, `createWorkflowDefinition`, `createSkillDefinition`, `createProject`
all pass `<value>.id` the same way), so the new code is not drifting. It becomes
reachable wherever a later stage parses untyped input into these calls, the same
route F-16 records for registration.
**Suggested fix:** Hand the guard the value instead of a dereference, for example
`requireValidDefinition(isRuntimeProfile(profile), "runtime profile", profile)`
and let the helper derive the id defensively. Changing the shared helper fixes
the two new methods and the four existing call sites in one place.
**Resolution:** Open.

### F-21 [P3] open - Only the shape branch of the profile decode path is tested

**File:** src/lib/workflow/sqlite/runtime-profiles.test.ts:170
**Found:** 2026-10-30 by /audit independent (scope: current; lens: tests)
**Why it matters:** The corrupt-row case writes `credential_kind = 'other'`
(`runtime-profiles.test.ts:179`) and asserts the resulting `decode` error, which
exercises only the final `isRuntimeProfile` check in `decodeRuntimeProfile`
(`sqlite-store.ts:522-548`). The other two failure families in that function are
untouched. `readString` raises `decode` when a column is not a string
(`sqlite-store.ts:101-109`), and a `BLOB` written into a `TEXT NOT NULL` column is
read back as a `Uint8Array`, so that branch is reachable (verified directly
against `node:sqlite` on Node 24: `Buffer` parameters survive to the read, while an
explicit `NULL` is refused by the `NOT NULL` constraint). Separately, a stored
`updated_at = 'not-a-timestamp'` passes `readString` and is rejected only by
`isRuntimeProfile`'s timestamp rule. The spec lists "corrupt stored rows" among the
cases to cover, and the same family is already tracked for the Feature 10 suite as
F-14, so a later change to `readString` or to the timestamp rule would silently
change the reported error with no test failing.
**Suggested fix:** Add two cases beside the existing one: a row whose `label` is
written as a `Buffer` and a row with `updated_at = 'not-a-timestamp'`, both
asserting `WorkflowPersistenceError` with code `decode`.
**Resolution:** Open.
