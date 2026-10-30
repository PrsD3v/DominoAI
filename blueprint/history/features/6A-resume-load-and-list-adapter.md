# Feature: Resume, load, and list adapter

**From build-plan:** feature 6A
**Build attempt:** 1
**Branch:** feature/resume-load-and-list-adapter
**Status:** verified

## Goal

Add the remaining session recovery operations to Domino's runtime contract and
ACP adapter. `listSessions` returns normalized summaries from `session/list`,
`resumeSession` reopens a persisted session without consuming history, and
`loadSession` reopens a persisted session while replaying prior assistant text as
normalized runtime events. Every operation is capability-gated. Fake-agent tests
prove the local semantics, and one opt-in live test proves `session/list` through
the same adapter path Domino uses.

Roadmap position: Feature 6 is split. This is 6A only. Feature 6B stays
`BLOCKED / DEFERRED` until a disposable Reasonix credential and a writable
Reasonix home exist. It owns live `session/resume` and `session/load` proof. No
live resume or load claim follows from this feature.

## In scope

- Extend the runtime-independent contract in `src/types/runtime.ts`:
  - `SessionSummary` with `id`, `workspaceRoot`, `title`, and `updatedAt`.
  - `SessionOpenRequest` with `sessionId` and `workspaceRoot`.
  - `LoadSessionRequest` with `sessionId`, `workspaceRoot`, and
    `onEvent: (event: RuntimeEvent) => void`.
  - `AgentRuntime.listSessions(): Promise<SessionSummary[]>`.
  - `AgentRuntime.resumeSession(request: SessionOpenRequest): Promise<Session>`.
  - `AgentRuntime.loadSession(request: LoadSessionRequest): Promise<Session>`.
- Keep resume and load as separate methods and separate ACP requests. Do not add
  a replay boolean or merge them behind one operation.
- Implement `listSessions` in the ACP runtime:
  - Gate on the advertised `sessions.list` capability.
  - Send exactly `session/list` with `{}`.
  - Parse `{ sessions: [{ sessionId, cwd, title, updatedAt }] }` into
    `SessionSummary[]`, mapping `sessionId` to `id` and `cwd` to `workspaceRoot`.
  - Preserve the runtime's order and ignore extra fields.
- Implement `resumeSession` in the ACP runtime:
  - Gate on the advertised `sessions.resume` capability.
  - Send exactly `session/resume` with
    `{ sessionId, cwd: request.workspaceRoot, mcpServers: [] }`.
  - Return a normal `Session` for the requested session id.
  - Do not register a history listener and do not emit any event during resume.
- Implement `loadSession` in the ACP runtime:
  - Gate on the advertised `loadSession` capability.
  - Register a `session/update` listener before sending `session/load`.
  - Send exactly `session/load` with
    `{ sessionId, cwd: request.workspaceRoot, mcpServers: [] }`.
  - Emit `assistant_text_delta` events for matching `agent_message_chunk`
    updates in receipt order, using the existing extractor and the requested
    session id.
  - Ignore updates for another session, other update kinds, non-text content,
    and malformed payloads.
  - Unsubscribe in `finally` before the returned session is used.
  - Return a normal `Session` for the requested session id.
- Reject `listSessions`, `resumeSession`, and `loadSession` without a wire
  request when the runtime is closing or closed.
- Propagate transport, JSON-RPC, and protocol errors unchanged. Never turn a
  failed list, resume, or load into an empty or successful result.
- Extend `createFakeRuntime` so it still satisfies `AgentRuntime`. The fake keeps
  its current capabilities, which advertise no list, resume, or load support,
  and its new methods reject with `UnsupportedCapabilityError`.
- Extend the fake ACP agent with deterministic `session/list`, `session/resume`,
  and `session/load` behavior and modes for empty, malformed, missing
  capability, error, and late replay cases.
- Add one opt-in live test for `session/list` through `createAcpRuntime` against
  the installed Reasonix CLI. It must not create a session, send a prompt, use a
  credential, or make a model call.
- Update `docs/reasonix-acp-contract.md` only for a `session/list` pass actually
  observed through the Domino adapter.

## Out of scope

- Live `session/resume` and `session/load` verification. Feature 6B owns it and
  stays blocked.
- Any claim that resume or load is verified through Domino. The PoC evidence
  remains PoC evidence.
- Prompt execution, cancellation, or failure-safety changes outside what the
  existing session object already provides.
- `session/delete`, `additionalDirectories`, MCP server configuration, steering,
  or other advertised ACP methods.
- An optional `cwd` filter for `session/list`. The adapter lists all summaries
  and does not add a filter without a current caller.
- Session view UI, persistence, run records, dashboard work, and Feature 11A
  settings.
- New dependencies, retries, caching, or background session refresh.
- Editing Feature 3B or its live test.

## Build loop

Follow `workflow.stepReview: "feature"` and
`workflow.checkpointCommits: "disabled"`. Continue through passing steps and
present one final review packet. Do not run `/complete`.

## Build steps

- [x] 1. **Extend the runtime contract and fake runtime.**
  - Add `SessionSummary`, `SessionOpenRequest`, and `LoadSessionRequest` to
    `src/types/runtime.ts`.
  - Add `listSessions`, `resumeSession`, and `loadSession` to `AgentRuntime`.
  - Keep existing `CreateSessionRequest`, `PromptRequest`, `PromptResult`,
    `RuntimeEvent`, and `Session` unchanged.
  - Implement the new methods in `createFakeRuntime`. Because its capabilities
    still advertise no list, resume, or load support, each method rejects with
    `UnsupportedCapabilityError` naming `sessions.list`, `sessions.resume`, or
    `loadSession`.
  - Make the ACP runtime satisfy the extended interface with temporary methods
    that reject with `UnsupportedCapabilityError`; steps 3 to 5 replace them with
    the real implementations. This keeps the repository typecheck green after
    the contract change.
  - Extend `fake-runtime.test.ts` to prove the fake still satisfies the
    contract, keeps its existing capability shape, and rejects each unsupported
    operation with the expected capability name.

  Done when: `npx tsc --noEmit` passes and the fake-runtime tests prove the
  extended contract without spawning a process.

- [x] 2. **Parse `session/list` results.**
  - Add `parseSessionListResult(value: unknown): SessionSummary[]` to
    `src/lib/runtime/acp/protocol.ts`.
  - Require an object with an array `sessions`. Reject a missing or non-array
    value with `AcpProtocolError`.
  - Require every entry to be an object with a non-empty string `sessionId`,
    non-empty string `cwd`, string `title`, and non-empty string `updatedAt`.
    An empty title is valid. Ignore extra fields.
  - Map `sessionId` to `id`, `cwd` to `workspaceRoot`, and preserve `title` and
    `updatedAt` verbatim.
  - Preserve runtime order and do not sort, deduplicate, or rewrite timestamps.
  - Add protocol tests for a valid list, an empty list, extra fields, a missing
    `sessions` field, a non-array `sessions` value, a non-object entry, and each
    missing or invalid required field.

  Done when: focused protocol tests pass and no raw ACP list object leaves the
  adapter.

- [x] 3. **Implement `listSessions` and its fake-agent path.**
  - Add `listSessions` to the ACP runtime behind the `sessions.list` capability.
  - Check runtime state before any wire request, send `session/list` with `{}`,
    parse the result, and return the summaries.
  - Add a default `session/list` handler to the fake agent returning two
    deterministic summaries.
  - Add fixture modes for an empty list, a malformed list, and an initialize
    response without the `list` capability.
  - Add runtime tests for the exact method and params, normalized summaries,
    order preservation, an empty list, malformed results, a missing capability
    with no wire call, and a closed runtime with no wire call.

  Done when: runtime and fixture tests prove the list path and every failure
  path without a live run.

- [x] 4. **Implement `resumeSession` and prove it does not replay.**
  - Add `resumeSession` to the ACP runtime behind the `sessions.resume`
    capability.
  - Check runtime state before any wire request, send `session/resume` with the
    exact params, and return the shared session object for the requested id.
  - Do not register a notification listener for resume.
  - Add `session/resume` to the fake agent. Its default response is `{}`; one
    mode sends a decoy `session/update` during resume so a later prompt test can
    prove the update was not buffered into the session.
  - Add fixture modes for a resume error and an initialize response without the
    `resume` capability.
  - Add runtime tests for the exact method and params, the returned session id,
    a prompt whose result contains only its own chunks and not the resume decoy,
    close on the returned session, error propagation, a missing capability with
    no wire call, and a closed runtime with no wire call.

  Done when: resume tests pass and the test log proves `session/resume`, not
  `session/load`, was sent.

- [x] 5. **Implement `loadSession` and history replay.**
  - Add `loadSession` to the ACP runtime behind the `loadSession` capability.
  - Register the update listener before the request and remove it in `finally`.
  - Send `session/load` with the exact params and emit matching assistant text
    chunks before returning the shared session object.
  - Add `session/load` to the fake agent. Its default mode emits two assistant
    text chunks, a user chunk, and a foreign-session chunk before responding
    with `{}`.
  - Add fixture modes for an empty history, a load error, a late update after
    the load response, and an initialize response without `loadSession`.
  - Add runtime tests for the exact method and params, ordered history events,
    ignored foreign, user, and non-text updates, empty history, error
    propagation, no event after the load settles, a throwing `onEvent` that
    does not abort the load, a missing capability with no wire call, a closed
    runtime with no wire call, and a prompt and close on the returned session.
  - Add one comparative test that runs resume and load against the fake agent
    and asserts that only load emits replayed events.

  Done when: load tests pass, resume and load use distinct wire methods, and the
  test log shows the replay contract.

- [x] 6. **Prove live `session/list` and run the feature gate.**
  - Add `src/lib/runtime/acp/session-list.live.test.ts`, gated by
    `DOMINO_LIVE_ACP=1` and skipped by default.
  - Start `createAcpRuntime` with the installed Reasonix command and a temporary
    working directory. Assert `runtime.capabilities.sessions.list` is true, call
    `listSessions`, and assert an array whose entries have non-empty `id`,
    non-empty `workspaceRoot`, a string `title`, and non-empty `updatedAt`. Do
    not call `session/new`, send a prompt, or use a model.
  - Run `DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/session-list.live.test.ts`.
    If it passes, update only the `session/list` evidence in
    `docs/reasonix-acp-contract.md` to name the Domino live test and the
    observation date. If it does not pass, leave the table unchanged and record
    the observed reason in the final review notes.
  - Run `npm test -- src/lib/runtime/acp/protocol.test.ts src/lib/runtime/acp/runtime.test.ts src/lib/runtime/fake-runtime.test.ts`.
  - Run the full `npm test` suite.
  - Run `npx tsc --noEmit`.
  - Run `git diff --check`.
  - Confirm the default test run skips live files, no test ran resume or load
    live, and Features 3B and 6B are unchanged.

  Done when: the live list test passes once, every non-live check passes, the
  ACP contract table records only observed behavior, and the working tree
  contains only the intended files.

## Files / areas

- `src/types/runtime.ts` - session summary and reopen contracts.
- `src/lib/runtime/fake-runtime.ts` - contract-complete unsupported methods.
- `src/lib/runtime/fake-runtime.test.ts` - fake contract and capability tests.
- `src/lib/runtime/acp/protocol.ts` - `session/list` result parsing.
- `src/lib/runtime/acp/protocol.test.ts` - list parsing cases.
- `src/lib/runtime/acp/runtime.ts` - list, resume, load, and the load listener.
- `src/lib/runtime/acp/runtime.test.ts` - list, resume, load, and failure tests.
- `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` - deterministic list,
  resume, load, and capability modes.
- `src/lib/runtime/acp/session-list.live.test.ts` - the single opt-in live test.
- `docs/reasonix-acp-contract.md` - only the observed `session/list` evidence.
- `blueprint/build-plan.md` - the approved 6A and 6B split.

Do not touch workflow engine code, persistence, Feature 11A settings, the
dashboard, `docs/reasonix-acp-contract.md` rows for resume or load, or the
existing live session test.

## Data / contracts

- `SessionSummary` is `{ id: string; workspaceRoot: string; title: string;
  updatedAt: string }`. `id` is the runtime session id, `workspaceRoot` is the
  reported `cwd`, and `updatedAt` is the reported RFC3339 string preserved
  verbatim.
- `SessionOpenRequest` is `{ sessionId: string; workspaceRoot: string }`.
  `LoadSessionRequest` adds `onEvent`.
- `session/list` receives `{}`. The ACP result is
  `{ sessions: [{ sessionId, cwd, title, updatedAt }] }`;
  `parseSessionListResult` maps it to `SessionSummary[]`. The ACP shape and field
  names do not leave the adapter.
- `session/resume` and `session/load` receive
  `{ sessionId, cwd, mcpServers: [] }`, matching the observed PoC params and the
  existing `session/new` shape. MCP is not implemented; the empty list is
  required to match the observed calls.
- The requested `sessionId` identifies the returned `Session`. The adapter does
  not interpret the runtime's resume or load configuration payload; a
  successful JSON-RPC response is success, and no raw payload is exposed.
- `loadSession` replay is the sequence of matching `assistant_text_delta`
  events emitted while the `session/load` request is pending. The listener is
  removed before the promise resolves. A late update is ignored.
- `resumeSession` never registers a history listener. Any update the runtime
  sends during resume is not exposed.
- Capability errors use the existing `UnsupportedCapabilityError` with
  `sessions.list`, `sessions.resume`, or `loadSession`.
- A closed runtime rejects these operations without a wire request. No new
  persistence, configuration surface, or dependency is introduced.
- Session titles, workspace paths, and replayed text are user data. Do not log
  them or include them in error messages.

## Testing

- Protocol unit tests for `session/list` success, empty, extra fields, and
  malformed input.
- Fake-agent integration tests through the real transport and ACP runtime for
  list, resume, load, capability denial, error propagation, listener cleanup,
  and shutdown.
- One opt-in live test for `session/list` through the Domino adapter. It uses no
  credential and no model call.
- Existing live tests stay opt-in and skipped by default. No live resume or load
  test is added in 6A, and no resume or load live claim is made.
- No Browser tests exist in this project, so no browser coverage is added.
- The final gate is the focused tests, the full `npm test` suite,
  `npx tsc --noEmit`, and `git diff --check`.

## Notes for the AI

- Do not mark Feature 6 or 6B complete. This is only 6A.
- Do not change Feature 3B, its blocked status, or its live test.
- Do not claim live resume or load behavior. The PoC rows stay PoC evidence
  until 6B passes.
- Keep resume and load as distinct public methods and distinct ACP methods.
- Do not expose raw ACP method names, params, result objects, or update payloads
  through the runtime contract.
- Do not log prompt text, history text, titles, or workspace paths.
- Do not add a dependency, retry, cache, timer, or background refresh.
- Preserve the existing prompt, cancel, close, timeout, and shutdown behavior.
- Use the installed fake agent and temporary paths only. The live list test is
  the only test allowed to spawn Reasonix.
- No em dashes in generated content.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":16218,"specSha256":"d13c87ef84771ebb566999cf79930140d6b087629e1e5d208631b8abab71b707","branch":"refs/heads/feature/resume-load-and-list-adapter","head":"c876aeefb0b900b0ef3f802fe89a08e6e1319c53","baseRef":"refs/heads/main","baseCommit":"ce8b77c8b178fc9fa3e2aeced2a08edc79f30831","sourceTree":"0d8aa9cdd31bb70124fe3cd8fc949b3318c3b4d7","landing":"local-merge","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** c876aeefb0b900b0ef3f802fe89a08e6e1319c53
**Base commit:** ce8b77c8b178fc9fa3e2aeced2a08edc79f30831
**Base ref:** main
**Spec hash:** d13c87ef84771ebb566999cf79930140d6b087629e1e5d208631b8abab71b707
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-30T10:16:13Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-30T10:33:03Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `npx tsc --noEmit`: pass
- `npm test`: pass (260 passed, 3 opt-in live files skipped)
- `npm run lint`: pass (0 errors, 2 pre-existing warnings outside this delta)
- `git diff --check`: pass
- `DOMINO_LIVE_ACP=1 npx vitest run src/lib/runtime/acp/session-list.live.test.ts`: pass

### Evidence

- Read the complete `ce8b77c8b178fc9fa3e2aeced2a08edc79f30831..c876aeefb0b900b0ef3f802fe89a08e6e1319c53` delta: runtime contract, `parseSessionListResult`, ACP runtime list/resume/load, fake runtime, fake agent fixture, protocol and runtime tests, contract table row, and the build-plan 6A/6B split.
- A fresh ACP probe of the installed CLI reported `sessions.list: {}`, `sessions.resume: {}`, `loadSession: true`, and a five-entry `session/list` result whose `sessionId`, `cwd`, `title`, and `updatedAt` are all strings, matching the updated contract row.
- Tests prove exact wire methods and params (`session/list` with `{}`, `session/resume` and `session/load` with `sessionId`, `cwd`, `mcpServers: []`), order preservation, capability denial with no wire call, closed-runtime rejection with no wire call, ordered replay with foreign, user, thought, and image updates ignored, no replay during resume, listener removal before the promise settles, late-update suppression, a throwing `onEvent` not aborting the load, error propagation, and resume and load staying distinct operations.
- Listener throws are contained by the transport notification dispatch at `src/lib/runtime/acp/transport.ts:199`, so the load contract holds.
- No changed file logs session ids, titles, workspace paths, or replayed text, and protocol error messages name only indexes and field names, never values.

### Findings

- F-01 [P3] open - Live `session/list` test passes on an empty result (follow-up, spec-prescribed assertions).

### Remaining risk

- Live `session/resume` and live `session/load` were not exercised; Feature 6B owns them and remains blocked on a disposable credential and a writable Reasonix home.
- No browser test harness is configured, so no browser evidence was gathered or needed for this adapter-only change.
- No dependency or vulnerability scanner is declared, so the security lens was a source review only.
- `npm run lint` reports two pre-existing warnings at `src/lib/runtime/acp/protocol.test.ts:53` and `src/lib/runtime/reasonix/env-file-store.ts:4`, both outside this delta.

## Try it now

Run or do:

```bash
DOMINO_LIVE_ACP=1 npx vitest run src/lib/runtime/acp/session-list.live.test.ts
```

Expected:

```text
✓ src/lib/runtime/acp/session-list.live.test.ts (1 test)
Test Files  1 passed (1)
```

This proves:

`AgentRuntime.listSessions()` reaches the installed Reasonix CLI over ACP, reads
the advertised `sessions.list` capability, and returns parsed session summaries.

Note: this needs the installed Reasonix CLI on `PATH`. It makes no model call and
uses no credential.
