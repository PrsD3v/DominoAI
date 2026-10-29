# Feature: Handshake, capability discovery, and session lifecycle

**From build-plan:** feature 3
**Build attempt:** 1
**Branch:** feature/handshake-capability-discovery-and-session-lifecycle

## Goal

Give Domino a real `AgentRuntime` backed by the Reasonix ACP process: perform the
`initialize` handshake, record only the capabilities the installed runtime
reports, and create and close sessions. Prompt execution stays out until feature
4.

## In scope

- Domino-owned capability contract: protocol version, agent identity, and the
  session flags this and the next adapter feature consume.
- ACP handshake: send `initialize`, validate the response, send the `initialized`
  notification, and fail cleanly when the process or protocol does not
  cooperate.
- `createAcpRuntime` owning one transport, returning an `AgentRuntime`.
- Session lifecycle: `session/new` for a workspace root, `session/close` when the
  runtime advertised close support, and runtime shutdown.
- Typed errors at the adapter boundary, plus an explicit close capability error.
- Automated tests against the existing fake agent fixture, one opt-in live test
  against the installed Reasonix, and an updated ACP contract evidence table.

## Out of scope

- `session/prompt`, streamed updates, stop reasons (feature 4).
- Cancel, EOF, crash, and prompt-timeout semantics beyond the transport behavior
  already built in feature 2 (feature 5).
- `session/resume`, `session/load`, `session/list` (feature 6). Their advertised
  flags are recorded, never exercised.
- Steering and `_meta` discovery (feature 7).
- Prompt content capabilities (`image`, `audio`, `embeddedContext`), MCP,
  `delete`, `additionalDirectories`, and the `_meta` extension surface. They are
  advertised but have no consumer in the MVP, so they are not modeled or stored.
- Persistence, project registration, workspace-root validation, and per-operation
  containment (features 9 to 11).
- Dashboard, UI, localization, auth, concurrency, retry, and reconnect behavior.

## Build loop

- One review packet after all steps (`workflow.stepReview: "feature"`); no
  per-step approval pause and no checkpoint commits (`checkpointCommits:
  "disabled"`).
- Each step leaves the repository working. Before an item is marked done, run
  `npm test` and `npx tsc --noEmit`.
- `/complete` creates the final feature commit after approval.
- No dev server is needed; this feature has no UI.

## Build steps

- [x] 1. **Extend the Domino runtime contract and the fake runtime.**
  - Add `RuntimeAgentInfo`, `RuntimeCapabilities`, `Session.close()`,
    `AgentRuntime.capabilities`, `AgentRuntime.close()`, and
    `UnsupportedCapabilityError` to `src/types/runtime.ts`.
  - Update `src/lib/runtime/fake-runtime.ts` with a fixed capability snapshot
    (protocol 1, fake agent identity, `sessions.close: true`, other flags false)
    and idempotent runtime and session close.
  - Cover the capability snapshot and repeated close in
    `src/lib/runtime/fake-runtime.test.ts`.

  Done when: the existing fake runtime tests still pass, new tests cover the
  capability snapshot and idempotent close, and `npm test` plus
  `npx tsc --noEmit` are green.

- [x] 2. **Normalize the ACP handshake and session messages.**
  - Add `src/lib/runtime/acp/protocol.ts` with the ACP wire types used by this
    feature (initialize params and result, session new and close) and parsers
    that return Domino values, not ACP structures:
    - `parseInitializeResult(value: unknown): RuntimeCapabilities`
    - `parseSessionNewResult(value: unknown): string`
  - Validation stays exactly this wide:
    - A non-object result, or a missing or non-numeric `protocolVersion`, rejects
      with `AcpProtocolError`.
    - A numeric `protocolVersion` other than 1 rejects with
      `AcpUnsupportedProtocolError`, carrying the reported version and the
      supported version.
    - `agentInfo` normalizes to `agent: { name, version }` only when it is an
      object with two non-empty string fields; anything else becomes
      `agent: null` and never fails the handshake.
    - Absent capabilities are `false`. A session capability counts as supported
      only when its value is `true` or a non-null object; `false`, `null`, and any
      other value are `false`.
    - Unknown capabilities and extra fields are ignored: not stored, not
      interpreted, and never grounds for rejecting the handshake.
    - A missing, empty, or non-string `sessionId` rejects with `AcpProtocolError`.
  - Add `AcpProtocolError` and `AcpUnsupportedProtocolError` in the same module.

  Done when: `src/lib/runtime/acp/protocol.test.ts` covers the observed Reasonix
  shape plus positive and negative cases for each rule above: absent and
  invalid `agentInfo`, present and absent capability blocks, `true`, object,
  `false`, and `null` session advertisements, unknown capabilities and extra
  fields being ignored, malformed results, and the unsupported version with its
  reported and supported fields, and `npm test` is green.

- [x] 3. **Perform the handshake and own the process.**
  - Add `src/lib/runtime/acp/runtime.ts` with
    `createAcpRuntime(options): Promise<AgentRuntime>` over `startTransport`.
  - Send `initialize` with `{ protocolVersion: 1, clientInfo: { name: "domino",
    version: "0.1.0" }, clientCapabilities: {} }`, parse the result, then send the
    `initialized` notification (no response expected).
  - Expose the parsed capabilities through `runtime.capabilities`; forward
    transport options, with `clientInfo` overridable for tests.
  - On any handshake failure, shut the child down before surfacing the original
    error.
  - Runtime lifecycle uses one simple internal state, `open | closing | closed`,
    set to `closing` synchronously when `close()` starts and `closed` once the
    transport shutdown settles. This state only gates whether new work may be
    sent and post-response checks; the transport remains the source of truth for
    I/O and process exit. Do not build a general concurrency or retry layer.
  - `runtime.close()` is idempotent: repeated and concurrent calls both settle
    after one shutdown. The transport and process enter shutdown once, and the
    process has exited by the time `close()` resolves. Sharing one in-flight
    promise is an implementation detail; the test proves the observable outcome,
    not that sharing itself.
  - After shutdown starts, `createSession()` sends nothing and rejects with
    `TransportClosedError` (method `session/new`, close `{ kind: "shutdown" }`).
  - A `createSession()` that started before shutdown but whose `session/new`
    response arrives after it must not return a usable session. Re-check the
    state after the response: if it is no longer `open`, reject with
    `TransportClosedError` and discard the id. This post-response check is a
    defensive guard: the deterministic fake test proves that no usable session
    is returned and that nothing new is sent, not that this specific internal
    branch was taken. In-flight requests settle only through the transport's
    normal close rejection; nothing is retried, queued, or newly sent.
  - Extend `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` with `initialize`,
    `initialized`, `session/new`, and `session/close` handlers. Keep every existing
    mode and method behavior working. Fixture modes: `no-close-capability`,
    `protocol-2`, `initialize-error`, `slow-session-new` (delays the
    `session/new` response so the close race is deterministic), and
    `close-fails-once` (first `session/close` errors, the next succeeds). When
    `FAKE_AGENT_LOG_FILE` is set, append each received message as one JSON line so
    tests can assert what was sent.

  Done when: tests in `src/lib/runtime/acp/runtime.test.ts` show a successful
  handshake recording the reported capabilities, an initialize error response
  surfacing as `JsonRpcError` with the process gone, a protocol mismatch
  rejecting with `AcpUnsupportedProtocolError` and the child shut down,
  concurrent `runtime.close()` calls both settling with one transport and process
  shutdown and the process actually gone afterwards, a close that starts while
  `slow-session-new` is pending rejecting that `createSession` with
  `TransportClosedError` while returning no usable session and sending no new
  request after shutdown starts, and a request after `runtime.close()` rejecting
  with `TransportClosedError`, all with `npm test` green.
  Fake runtimes use `shutdownGraceMs: 100` so shutdown and process-death
  assertions stay fast and deterministic.

- [x] 4. **Create and close sessions.**
  - `createSession({ workspaceRoot })` sends `session/new` with
    `{ cwd: workspaceRoot, mcpServers: [] }`, returns a `Session` whose `id` is the
    reported `sessionId`, and does not deduplicate or cache sessions.
  - `session.close()` sends `session/close` with `{ sessionId }` at most once when
    it succeeds:
    - Concurrent calls share one in-flight promise and produce at most one
      `session/close` request.
    - After a successful close, later calls resolve without sending another
      request.
    - When the request fails, every waiting caller receives the same error and the
      session is not recorded as closed. Once that failed promise settles, a later
      call may retry with a new request, but only while the runtime is still
      `open`; otherwise it rejects with `TransportClosedError` without sending.
    - When the runtime did not advertise `sessions.close`, the call rejects with
      `UnsupportedCapabilityError("sessions.close")` without sending anything.
  - The ACP session's `prompt` rejects with an explicit "not implemented until
    feature 4" error and makes no wire call.
  - A malformed `session/new` result rejects with `AcpProtocolError` and no session
    is returned.

  Done when: tests assert the exact `session/new` and `session/close` params from
  the fixture log, distinct ids for two sessions, one close request for repeated
  and concurrent closes, no extra request after a successful close, an error
  shared by concurrent waiters through `close-fails-once`, a retry that sends a
  second request and succeeds, no retry once the runtime is closing, the
  unsupported-capability rejection, the prompt stub, and the malformed-result
  rejection, with `npm test` green.

- [ ] 5. **Prove the handshake and lifecycle against the installed Reasonix.**
  - Add `src/lib/runtime/acp/runtime.live.test.ts`, skipped unless
    `DOMINO_LIVE_ACP=1`, mirroring `transport.live.test.ts`: temp workspace,
    `reasonix acp --model deepseek/deepseek-flash --permission-mode ask`, assert
    only real observed behavior: a successful handshake with protocol version 1,
    `agent?.name === "reasonix"`, `sessions.close === true`, then create and close
    one session. Use an explicit 20 s test timeout. This test sends no prompt. No
    provider behavior for `session/new` is confirmed yet, so the test makes no
    claim about model calls.
  - Run `DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/runtime.live.test.ts`.
    When the flag is set, a missing CLI or a different advertised value fails the
    test; it is never converted into a skip or a relaxed assertion.
  - Update `docs/reasonix-acp-contract.md` only with behavior that actually ran:
    the observation date, the Domino execution path used
    (`createAcpRuntime`/`runtime.live.test.ts`), and the reproduce command. Leave
    every unexercised capability in its existing unverified bucket.

  Done when: the opt-in live test actually passes in this environment and the
  contract table records the date, the Domino path, and the reproduce command for
  exactly those operations. If Reasonix is unavailable or the observed behavior
  differs, do not mark anything verified: report the real result and stop.

## Files / areas

- `src/types/runtime.ts` - capability contract, session and runtime close,
  `UnsupportedCapabilityError`.
- `src/lib/runtime/fake-runtime.ts` and `fake-runtime.test.ts` - contract parity.
- `src/lib/runtime/acp/protocol.ts` and `protocol.test.ts` (new) - wire types and
  normalization.
- `src/lib/runtime/acp/runtime.ts` and `runtime.test.ts` (new) - handshake,
  process ownership, session lifecycle.
- `src/lib/runtime/acp/runtime.live.test.ts` (new) - opt-in installed-runtime
  evidence.
- `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` - handshake handlers, modes,
  and the optional message log.
- `docs/reasonix-acp-contract.md` - evidence status.

Existing `json-rpc.ts`, `transport.ts`, and their tests are reused unchanged apart
from behavior the handshake genuinely needs.

## Data / contracts

ACP types stay inside `src/lib/runtime/acp/`; nothing outside imports them. The
public surface is `AgentRuntime`, `Session`, `RuntimeCapabilities`, and the error
classes, with no raw ACP structures or Reasonix method names.

Wire calls this feature makes:

- `initialize` request:
  `{ "protocolVersion": 1, "clientInfo": { "name": "domino", "version": "0.1.0" }, "clientCapabilities": {} }`
- `initialize` result: an object with numeric `protocolVersion` equal to `1`.
  `agentInfo` and `agentCapabilities` are optional.
- `initialized` notification with `params: {}`, sent after a successful parse.
- `session/new` request: `{ "cwd": "<workspaceRoot>", "mcpServers": [] }`,
  result `{ "sessionId": "<non-empty string>" }`.
- `session/close` request: `{ "sessionId": "<id>" }`; its result is ignored.

Normalized capability record:

- `protocolVersion` - the reported, supported version.
- `agent` - `{ name, version }` when both are non-empty strings, otherwise `null`.
- `loadSession` - `true` only when advertised `true`.
- `sessions.list`, `sessions.resume`, `sessions.close` - `true` when the
  corresponding `sessionCapabilities` entry is `true` or a non-null object;
  `false`, `null`, and any other value are `false`.
- Any other advertised capability or extra field is ignored, not stored, not
  interpreted, and not logged. Feature 6 and feature 7 add their flags when they
  consume them.

Error contract:

- `AcpProtocolError` - non-object result, missing or non-numeric
  `protocolVersion`, or missing `sessionId`.
- `AcpUnsupportedProtocolError` - numeric reported version other than 1; carries
  the reported version and the supported version.
- `UnsupportedCapabilityError` - closing when `sessions.close` is false; carries
  `capability: "sessions.close"`.
- `JsonRpcError`, `TransportClosedError`, and `TransportTimeoutError` propagate
  unchanged.
- A handshake failure shuts the child down before the error surfaces. No partial
  runtime is returned.

Lifecycle rules:

- The adapter tracks `open | closing | closed`. It gates sending new work and
  post-response checks only; the transport stays the source of truth for I/O.
- `runtime.close()` is idempotent. Concurrent calls both settle after one
  transport and process shutdown, and the process has exited by the time the call
  resolves. Sharing an in-flight promise is an implementation detail.
- After shutdown starts, `createSession` sends nothing and rejects with
  `TransportClosedError`.
- A `session/new` response that arrives after shutdown starts never produces a
  usable session; the call rejects with `TransportClosedError`.
- `session.close()`:
  - Concurrent calls share one in-flight promise and send at most one
    `session/close`.
  - Success marks the session closed; later calls resolve without a request.
  - Failure propagates the same error to every waiter, the session stays not
    closed, and a later call may retry with a new request while the runtime is
    still `open`. Once the runtime is closing, the retry rejects with
    `TransportClosedError` without sending.
  - Missing `sessions.close` capability rejects with
    `UnsupportedCapabilityError` before any request.
- A session that was never closed is not retried or tracked after runtime close.
- No general concurrency, queueing, or retry layer is added; in-flight work ends
  through the transport's normal close rejection.

The client identity version is a constant in `runtime.ts`, not read from
`package.json`; it is handshake metadata, not product version tracking.

## Testing

The test command is `npm test` (Vitest), and logic-bearing steps ship tests next
to source.

- `protocol.test.ts`: positive and negative cases for each parsing rule: observed
  Reasonix response shape, valid and invalid `agentInfo`, absent capability
  blocks, `true`, object, `false`, and `null` advertisements, unknown capabilities
  and extra fields ignored, malformed results, unsupported protocol version with
  its reported and supported fields, and session id validation. Pure logic, no
  child process.
- `runtime.test.ts`: spawns the fake agent through `process.execPath` with
  `shutdownGraceMs: 100`. Covers capabilities, handshake errors, protocol
  mismatch, process ownership and shutdown, session params from the fixture log,
  concurrent `runtime.close()` settling with one shutdown and the process gone,
  the close-versus-`createSession` race through `slow-session-new`, idempotent and
  concurrent session close, error sharing and retry through `close-fails-once`,
  no retry once closing, close capability refusal, the prompt stub, malformed
  `session/new`, and post-close behavior. Every started runtime and temp
  directory is cleaned up in `finally`.
- `fake-runtime.test.ts`: capability snapshot and repeated close.
- `runtime.live.test.ts`: skipped by default, run with `DOMINO_LIVE_ACP=1` and a
  20 s timeout. Asserts only what actually ran: protocol version 1, `reasonix`
  identity, the advertised `sessions.close` value, and one create plus close. It
  sends no prompt and makes no claim about provider calls during `session/new`.
  With the flag set, missing or different behavior fails the test rather than
  being skipped.
- Feature 2 tests must stay green; the fixture change is additive.
- No browser coverage: this feature has no UI.

## Notes for the AI

- Read `docs/reasonix-acp-contract.md` first, and treat anything outside its
  verified table as unverified. Do not hardcode a method beyond the four used
  here.
- Never infer capabilities. Missing means `false`, and closing without the
  advertised flag is an error, not a silent no-op.
- Keep the adapter state to `open | closing | closed`. It gates new work and
  post-response checks; do not mirror transport internals or add retry or
  queueing machinery.
- A failed `session/close` leaves the session open for an explicit retry; only a
  successful response marks it closed.
- `initialized` is a notification; do not wait for a reply.
- Keep the ACP launch arguments in test options, not in the library defaults.
- Do not add capability plumbing for prompt, cancel, resume, load, list, or
  steering yet. Those features own their tests and flags.
- No em dashes in code, tests, docs, or commit messages.
- Update the contract doc only with results that actually ran; a skipped live
  test proves nothing.
- Do not promote `session/new` or `session/close`, especially on a
  never-prompted session, to verified from the PoC, fake tests, or a spec edit.
  Only a passing live run against the installed runtime does that. If it fails,
  report the real result and update the doc to match the evidence.

## Verification exception

**Status:** closed administratively on 2026-10-30 with build step 5 deferred.
This spec never reached `verified`.

- **Step 5 (live proof against the installed Reasonix):** UNVERIFIED / DEFERRED.
  It is intentionally left unchecked. This closure is not a successful live
  Reasonix test and must not be read as one.
- **Reason:** Reasonix cannot read a valid provider key for
  `deepseek/deepseek-flash` in this environment. It reads provider keys from
  `~/.reasonix/.env`, which is a `/dev/null` character device here, and it does
  not read shell environment variables. The observed failure on 2026-10-29 and
  again on 2026-10-30 was a `JsonRpcError` on `session/new` reporting that the
  model has no API key, raised before a session was created.
- **What actually ran:** the handshake assertions in the live test passed on both
  dates: protocol version `1`, agent name `reasonix`, and `sessions.close:
  true`. `session/new` and `session/close` through the Domino adapter remain
  unverified. The evidence table in `docs/reasonix-acp-contract.md` is unchanged
  and keeps both operations in the "PoC only; not verified through Domino"
  bucket.
- **Original acceptance criteria (preserved):** the opt-in live test must pass in
  this environment, asserting a successful handshake with protocol version 1,
  `agent?.name === "reasonix"`, `sessions.close === true`, then create and close
  one session, sending no prompt. If the runtime is unavailable or the observed
  values differ, nothing is marked verified.
- **Resume verification:** add a key for `deepseek/deepseek-flash` where Reasonix
  reads it (`~/.reasonix/.env`, or run `reasonix setup`), then run:

  ```bash
  DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/runtime.live.test.ts
  ```

  Only a passing run promotes `session/new` and `session/close` in
  `docs/reasonix-acp-contract.md`.

**Closure bookkeeping:** build-plan item 3 is checked so the roadmap can move on,
with this deferral noted on its line. No commit, merge, push, or feature 9 work
was performed. No findings and no independent review were recorded for this work
item.
