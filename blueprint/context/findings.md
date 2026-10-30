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
