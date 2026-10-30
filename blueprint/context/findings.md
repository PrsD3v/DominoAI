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
