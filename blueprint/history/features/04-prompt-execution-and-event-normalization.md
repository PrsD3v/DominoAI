# Feature: Prompt execution and event normalization

**From build-plan:** feature 4
**Build attempt:** 1
**Branch:** feature/prompt-execution-and-event-normalization

**Status:** verified

## Goal

Implement the ACP-backed prompt path. A session sends `session/prompt`, streamed
`session/update` notifications become normalized runtime events, and the result
carries the accumulated text with a normalized stop reason. Every text chunk is
preserved in receipt order, and a stop reason the adapter has not proven is never
converted into success.

Roadmap position: this checkout uses the planning-integrated roadmap. Feature 3A
is complete; feature 3B (live Reasonix verification) is `BLOCKED / DEFERRED`.
Feature 11A's real connection test depends on 3B and this feature, but neither
dependency is satisfied here. This feature is implemented and tested against the
fake ACP agent only.

## In scope

- Replace the `Session.prompt` stub that currently throws "implemented in feature
  4".
- Send exactly
  `{ sessionId, prompt: [{ type: "text", text: request.text }] }`.
- Register a `session/update` notification listener before sending the request
  and unsubscribe it in a `finally` block.
- Process only notifications whose `params.sessionId` equals this session's id
  and whose `params.update.sessionUpdate` is `"agent_message_chunk"`.
- Extract text from `params.update.content.text` only when `content` is an object
  with a string `text`; ignore every other update kind and malformed payload.
- Accumulate each extracted chunk into the result text before invoking
  `request.onEvent`, then emit one `assistant_text_delta` event per chunk in
  receipt order.
- Normalize the prompt stop reason:
  - `end_turn` becomes `completed`;
  - `cancelled` becomes `cancelled`;
  - a missing, non-string, or unproven value throws
    `AcpUnsupportedStopReasonError` (an `AcpProtocolError` subclass) that keeps
    the reported value in `readonly reportedStopReason: unknown`.
- Reject a prompt without sending a wire request when the runtime is closing or
  closed, the session is closed, or the session already has an active prompt.
- Propagate transport and protocol errors unchanged; never synthesize a
  completed result from a failure.
- Extend the fake agent with deterministic prompt modes and prove the behavior
  with focused tests.

## Out of scope

- `session/cancel`, prompt timeout, EOF, crash, and close-during-prompt
  semantics. Feature 5 owns failure safety, including how pending work ends.
- Resume, load, list, and steering. Features 6 and 7 own them.
- Live Reasonix prompt verification. Feature 3B stays blocked and deferred; its
  prompt step remains optional and unproven.
- Tool calls, image content, thought chunks, MCP, UI, persistence, credential
  settings, and provider configuration (Feature 11A).
- Concurrent prompts beyond rejecting a second prompt on the same session.
  Concurrent prompts on different sessions are neither added nor tested.
- New dependencies.
- Updating `docs/reasonix-acp-contract.md` with live prompt results. No live
  prompt runs in this feature.

## Build loop

Follow `workflow.stepReview: "feature"` and
`workflow.checkpointCommits: "disabled"`. Continue through passing steps and
present one final review packet. Do not run `/complete`.

## Build steps

- [x] 1. **Add prompt result and update normalization.**
  - Add a typed prompt-result parser in `src/lib/runtime/acp/protocol.ts` that
    maps `end_turn` and `cancelled` and rejects everything else.
  - Add `AcpUnsupportedStopReasonError` beside `AcpUnsupportedProtocolError`,
    carrying `reportedStopReason` without any prompt or credential content.
  - Add a typed session-update extractor returning `null` for a foreign
    `sessionId`, another `sessionUpdate` kind, non-object `content`, and
    non-string `content.text`.
  - Test valid `end_turn`, valid `cancelled`, missing stop reason, unknown string
    stop reason, and non-string stop reason.
  - Test text extraction for a valid chunk, a foreign session id, a non-text
    update, a text update without text, and malformed params.

  Done when: protocol tests pass and no raw ACP update object or method name is
  exported through the runtime contract.

- [x] 2. **Implement `Session.prompt` in the ACP runtime.**
  - Replace the stub in `createSessionObject`.
  - Add per-session `closed` and `prompting` guards, and check runtime state
    before any wire request.
  - Register the update listener before `transport.request("session/prompt", …)`
    and unsubscribe in `finally`.
  - Accumulate text before emitting; emit only `assistant_text_delta` for this
    session.
  - Return `{ text, stopReason }` from the parsed result; an empty chunk stream
    with `end_turn` returns `{ text: "", stopReason: "completed" }`.
  - Ensure no event is emitted after the prompt promise settles, and that a
    second active prompt rejects immediately.
  - Reject a prompt after session close, during runtime closing/closure, and
    preserve existing session close and idempotency behavior.

  Done when: runtime tests prove request params, event order, accumulated text,
  empty-text success, listener removal, closed/runtime/active-prompt guards, and
  error propagation.

- [x] 3. **Extend the fake ACP agent for prompts.**
  - Add a `session/prompt` handler. Default mode emits two text chunks as
    `session/update` notifications for the requested `sessionId`, then returns
    `{ stopReason: "end_turn" }`.
  - Add modes for `cancelled`, unknown stop reason, a JSON-RPC error, a
    text-free `end_turn`, and a late text chunk sent after the prompt response.
  - Keep log-file behavior so tests can inspect the exact methods and params.
  - Keep existing transport, session, and initialize modes unchanged.

  Done when: the fake agent exercises success, cancellation, unknown stop, error,
  empty text, and post-result update paths without a model call or network.

- [x] 4. **Add focused prompt tests.**
  - Assert the exact `session/prompt` params.
  - Assert chunks arrive as ordered `assistant_text_delta` events and that
    `PromptResult.text` equals their concatenation.
  - Assert `end_turn` and `cancelled` mapping.
  - Assert missing, unknown, and non-string stop reasons throw
    `AcpUnsupportedStopReasonError` with the reported value preserved.
  - Assert transport and fake-agent errors reach the caller.
  - Assert another session's updates, non-text updates, and malformed params are
    ignored without events.
  - Assert a second concurrent prompt is rejected without a second wire request.
  - Assert prompt after session close or runtime closure is rejected.
  - Assert the late-chunk mode produces no event after the prompt settles.
  - Assert a throwing `onEvent` does not lose accumulated text.
  - Preserve all existing Feature 3A tests and fake-runtime prompt tests.

  Done when: the focused runtime and protocol tests pass with no live test run.

- [x] 5. **Run the feature gate.**
  - Run `npx next typegen` first. This worktree has no generated Next types, so
    `npx tsc --noEmit` otherwise fails on `LayoutProps` before reaching any
    feature code. Generated `next-env.d.ts` and `.next/` are Git-ignored.
  - Run `npm test -- src/lib/runtime/acp/protocol.test.ts src/lib/runtime/acp/runtime.test.ts`.
  - Run the full `npm test` suite.
  - Run `npx tsc --noEmit`.
  - Run `git diff --check`.
  - Confirm no test ran with `DOMINO_LIVE_ACP=1` and no live prompt success is
    claimed.

  Done when: all non-live checks pass, no generated file is staged, and 3B stays
  unchanged.

## Files / areas

- `src/lib/runtime/acp/protocol.ts` - prompt result, stop-reason error, update
  text extraction.
- `src/lib/runtime/acp/protocol.test.ts` - success and malformed cases.
- `src/lib/runtime/acp/runtime.ts` - real `Session.prompt` and guards.
- `src/lib/runtime/acp/runtime.test.ts` - prompt request, event, guard, and error
  tests.
- `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` - deterministic prompt
  modes.
- `src/types/runtime.ts` - only if a proven contract clarification is required;
  never add raw ACP types or a new stop reason without evidence.
- `src/lib/runtime/fake-runtime.ts` - existing behavior should keep satisfying
  the contract; change only if a contract test requires it.

Do not touch `ReasonixEnvFileStore`, the provider catalog, Feature 11A settings,
persistence, or Feature 3B live verification.

## Data / contracts

- `PromptRequest` stays `{ text, onEvent }`; `PromptResult` stays
  `{ text, stopReason }`.
- `PromptStopReason` stays `"completed" | "cancelled"` unless evidence adds a
  proven value. Unknown ACP reasons fail rather than mapping to `completed`.
- The observed PoC shape is `message.params.update.sessionUpdate ===
  "agent_message_chunk"` with `update.content.text`, and the prompt result's
  `stopReason` was `end_turn` or `cancelled`. The PoC used one session and did
  not filter updates by `sessionId`; the adapter filters on `params.sessionId`
  per ACP v1. Neither shape is proven against Reasonix through Domino, so no live
  claim follows.
- Text chunks are delivered in receipt order and concatenated without reordering,
  trimming, or deduplication.
- Accumulate before emitting, so a throwing `onEvent` callback loses at most the
  callback invocation: the transport already isolates listener exceptions from
  the read loop and other listeners.
- Unsupported update kinds are not converted into text and are not exposed as raw
  ACP. This feature models no tool, thought, or image events.
- No raw ACP method name, notification payload, or ACP type appears in the public
  runtime contract.

## Testing

- Unit tests for prompt result parsing and session-update extraction.
- Fake-agent integration tests through the real transport and ACP runtime.
- No live Reasonix run, credential, network, or model call.
- Existing live tests stay opt-in and skipped by default.
- Feature 3B remains blocked and deferred; this feature claims no live prompt
  execution.

## Notes for the AI

- Do not implement cancellation, timeout, resume, load, list, or steering.
- Do not use a fake success for an unknown stop reason.
- Do not expose the raw `session/update` object or raw ACP method names.
- Do not add a dependency.
- Do not modify the 3B item, mark it complete, or write a live claim into the ACP
  contract table.
- If the transport closes while a prompt is in flight, propagate the real error;
  do not synthesize a completed result.
- Do not log prompt text or chunk text; session transcripts are secrets.
- Keep the existing session lifecycle, capability checks, and close idempotency
  intact.
- Use the installed fake-agent fixture and temporary paths only.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":10740,"specSha256":"5b17bcaaa20b8592bd1ca0c4bf6a9dbc117544a05fad052f1957b0d73c433ddd","branch":"refs/heads/feature/prompt-execution-and-event-normalization","head":"ccf82b69785f58b96a304d949fa63bc325c25e2b","baseRef":"refs/heads/main","baseCommit":"ccf82b69785f58b96a304d949fa63bc325c25e2b","sourceTree":"8cc4363630f88bfb7e997794ec58564a97a6ef7c","landing":"local-merge","absentOptional":[]} -->
