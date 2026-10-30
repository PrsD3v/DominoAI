# Feature: Cancel and failure safety

**From build-plan:** feature 5
**Build attempt:** 1
**Branch:** feature/cancel-and-failure-safety

**Status:** verified

## Goal

Make an in-flight ACP prompt end predictably. The adapter can ask the runtime to
stop an active turn with an ACP `session/cancel` notification, and a runtime
that crashes, closes its output, or stops answering ends the pending prompt
with a typed error instead of leaving the caller waiting forever. Cancellation
is reported only when the runtime returns `stopReason: cancelled`; sending a
cancel message is never treated as proof that the turn stopped.

Roadmap position: Feature 3A is complete, Feature 3B stays `BLOCKED / DEFERRED`,
and Feature 4 is verified. This feature is implemented and tested against the
fake ACP agent only. No live Reasonix run, credential, or model call is part of
this work.

## In scope

- Add `cancel(): void` to the runtime-independent `Session` contract in
  `src/types/runtime.ts`, documented as a request whose only evidence is the
  prompt result.
- Implement `cancel()` in the ACP session object: send exactly one
  `session/cancel` notification with `{ sessionId }` for the active prompt, and
  do nothing when no prompt is active, the session is closed, or the runtime is
  not open.
- Keep one cancel notification per active turn: a repeated `cancel()` while the
  same turn runs sends nothing more.
- Reset the cancel-sent guard when a prompt settles, so the next prompt on the
  same session can be cancelled again.
- Implement `cancel()` as a no-op in `createFakeRuntime` so the fake runtime
  keeps satisfying the contract.
- Extend the fake ACP agent with deterministic modes for cancel, ignored cancel,
  a silent prompt, a crashing prompt, and a prompt that ends stdout.
- Add focused tests that prove:
  - cancel of an active prompt produces `stopReason: "cancelled"` and the exact
    `session/cancel` notification on the wire;
  - an ignored cancel leaves the real result in place and never manufactures
    `cancelled`;
  - an idle, repeated, or post-settlement cancel sends no extra notification and
    does not throw;
  - a prompt that times out rejects with `TransportTimeoutError`, produces no
    `PromptResult`, and leaves the session closable and reusable;
  - a prompt whose child crashes, ends stdout, or whose runtime is closed
    mid-prompt rejects with `TransportClosedError` carrying the real close kind;
  - no failure path emits a later event or resolves as completed.

## Out of scope

- Transport redesign. `src/lib/runtime/acp/transport.ts` already rejects pending
  requests on process exit, on stdout EOF, and on request timeout. Change it
  only if a new test exposes a real gap, and keep that change minimal.
- Automatically sending `session/cancel` after a prompt timeout, killing the
  runtime from `Session.cancel()`, or adding retry logic.
- Resume, load, list, and steering. Features 6 and 7 own them.
- Workflow pause, continue, and run cancel. Feature 9 owns those engine
  operations; this feature only adds the adapter-level session cancel.
- Live Reasonix verification and any edit to the verified/unverified table in
  `docs/reasonix-acp-contract.md`. Feature 3B stays blocked.
- Concurrent prompts, steering, tool events, MCP, UI, persistence, and
  credential settings.
- New dependencies.

## Build loop

Follow `workflow.stepReview: "feature"` and
`workflow.checkpointCommits: "disabled"`. Continue through passing steps and
present one final review packet. Do not run `/complete`.

## Build steps

- [x] 1. **Extend the session contract and the fake runtime.**
  - Add `cancel(): void` to `Session` in `src/types/runtime.ts` with a one-line
    doc comment: it requests cancellation, and the prompt result decides it.
  - Add a no-op `cancel()` to the session object returned by
    `createFakeRuntime`, and cover it in `fake-runtime.test.ts` so the contract
    stays exercised without spawning anything.
  - Leave `PromptRequest`, `PromptResult`, and `PromptStopReason` unchanged.

  Done when: `npx tsc --noEmit` passes and the fake-runtime tests prove the
  returned session satisfies the extended contract.

- [x] 2. **Implement ACP cancellation.**
  - In `src/lib/runtime/acp/runtime.ts`, track whether the active prompt has
    already sent a cancel and reset that flag at prompt start and in `finally`.
  - `cancel()` sends `transport.notify("session/cancel", { sessionId: id })`
    only when the session is open, the runtime state is `open`, a prompt is
    active, and no cancel was sent for that turn.
  - Do not gate cancel on an advertised capability: ACP v1 has no cancel
    capability, and the fake agent reports none.
  - Do not catch or reshape transport errors; the guards above make the no-op
    cases explicit instead of hiding failures.
  - Add fixture modes: `prompt-cancel` streams one chunk and answers the pending
    prompt with `{ stopReason: "cancelled" }` only after receiving
    `session/cancel`; `prompt-cancel-ignored` receives the notification and
    finishes the prompt normally.
  - Log notifications so tests can assert the exact wire message.

  Done when: runtime tests show one `session/cancel` notification with the
  session id, `{ text, stopReason: "cancelled" }` as the result, one
  notification for a repeated cancel, no notification for an idle or
  post-settlement cancel, and a completed result when the agent ignores the
  cancel.

- [x] 3. **Prove failure safety for an active prompt.**
  - Add fixture modes: `prompt-silent` (never answers), `prompt-crash` (streams
    then exits with code 1), and `prompt-eof` (streams then ends stdout while
    staying alive).
  - Extend the runtime test helper to accept `requestTimeoutMs`.
  - Test a silent prompt with a short timeout: it rejects with
    `TransportTimeoutError`, returns no result, accepts a second prompt attempt
    (proving the active-prompt guard cleared) and still closes cleanly.
  - Test a prompt in flight when the child crashes, when it ends stdout, and
    when `runtime.close()` runs: each rejects with `TransportClosedError`
    carrying the actual `close` value, and no later session call succeeds.
  - Assert no failure path resolves as `completed` or `cancelled`.

  Done when: all failure-safety tests pass within their normal timeouts, the
  full suite is green, and no hang requires a test timeout to end.

- [x] 4. **Run the feature gate.**
  - Run `npm test -- src/lib/runtime/acp/runtime.test.ts src/lib/runtime/fake-runtime.test.ts`.
  - Run the full `npm test` suite.
  - Run `npx tsc --noEmit`.
  - Run `git diff --check`.
  - Confirm no test ran with `DOMINO_LIVE_ACP=1`, the two live test files stay
    skipped, and the ACP contract table is unchanged.

  Done when: every non-live check passes, the working tree contains only the
  files listed below, and Feature 3B is still marked blocked.

## Files / areas

- `src/types/runtime.ts` - `Session.cancel()` contract.
- `src/lib/runtime/fake-runtime.ts` - no-op cancel for the engine-facing fake.
- `src/lib/runtime/fake-runtime.test.ts` - contract coverage for cancel.
- `src/lib/runtime/acp/runtime.ts` - cancel notification and per-turn guard.
- `src/lib/runtime/acp/runtime.test.ts` - cancel and failure-safety tests.
- `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` - deterministic cancel,
  silent, crash, and EOF prompt modes.
- `src/lib/runtime/acp/transport.ts` - read only unless a new test proves a real
  gap in EOF, crash, or timeout handling.

Do not touch workflow engine code, feature 11A settings, persistence, the
Blueprint plans, or `docs/reasonix-acp-contract.md`.

## Data / contracts

- `Session.cancel(): void` is a best-effort request, not an operation that
  returns a result. The `PromptResult.stopReason` remains the only cancellation
  evidence, matching `docs/reasonix-acp-contract.md`.
- `cancel()` rules: at most one `session/cancel` notification per active turn;
  no wire message when no prompt is active, after the prompt settles, after
  session close, or while the runtime is closing or closed.
- Cancel targets exactly one session: the notification carries that session's
  id and no other session's turn is affected.
- A prompt timeout rejects with `TransportTimeoutError` and clears the
  active-prompt guard. The adapter makes no claim that the runtime stopped the
  turn, so the session stays open; if the runtime still runs the earlier turn, a
  later prompt may fail with the runtime's own error, and that error propagates
  unchanged.
- A transport close rejects the pending prompt with `TransportClosedError`
  carrying `{ kind: "shutdown" }`, `{ kind: "exit", code, signal }`, or
  `{ kind: "protocol", error }` as reported by the transport. No synthesized
  result is produced.
- No raw ACP method name, notification payload, or ACP type appears in the
  public runtime contract.
- No new persisted data, configuration surface, or dependency.

## Testing

- Unit-level contract coverage in `fake-runtime.test.ts`.
- Fake-agent integration tests through the real transport and ACP runtime in
  `runtime.test.ts`; no model call, network, or credential.
- The crash, EOF, and timeout paths must finish well inside the default Vitest
  timeout, which is the observable proof that pending work no longer hangs.
- Live Reasonix tests stay opt-in and skipped. This feature claims no live
  cancellation result, and Feature 3B remains the owner of that proof.

## Notes for the AI

- Do not mark Feature 3B complete or write a live cancellation claim into the
  ACP contract document.
- Do not send a cancel automatically on timeout or on close; only an explicit
  `cancel()` sends it.
- Do not convert a timeout or protocol error into `cancelled` or `completed`.
- Do not log prompt text, chunk text, or any session transcript.
- Keep session close idempotency, prompt guards, and the existing event
  unsubscribe behavior intact.
- Use the installed fake agent and temporary paths only.
- No em dashes in generated content.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":10020,"specSha256":"3856bc3d6d5b081babe3ecb7d230c1e982996e8ae9685dfae4d3f1a0eeca9d88","branch":"refs/heads/feature/cancel-and-failure-safety","head":"98217f17c22c1e27093c827dc4e9e01e7c0b5ce8","baseRef":"refs/heads/main","baseCommit":"98217f17c22c1e27093c827dc4e9e01e7c0b5ce8","sourceTree":"0cbed92c2b7cbee56f4b705d93d5ada06893c085","landing":"local-merge","absentOptional":[]} -->
