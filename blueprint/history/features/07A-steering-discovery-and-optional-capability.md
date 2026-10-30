# Feature: Steering discovery and optional capability

**From build-plan:** feature 7A
**Build attempt:** 1
**Branch:** feature/steering-discovery-and-optional-capability
**Status:** verified

## Goal

Read the steering method the runtime advertises in its `initialize` response,
surface steering as an optional runtime capability, and add a capability-gated
`Session.steer` operation. The method name is discovered at runtime and never
hardcoded. Fake-agent tests prove acceptance, denial, and failure paths. No claim
is made about whether steering interrupts the active prompt or queues behind it.

Roadmap position: Feature 7 is split. This is 7A only. Feature 7B stays
`BLOCKED / DEFERRED` until a disposable Reasonix credential and a writable
Reasonix home exist. It owns the live interrupt-versus-queue characterization.
No evidence about that behavior follows from this feature.

## In scope

- Extend the runtime-independent contract in `src/types/runtime.ts`:
  - `RuntimeCapabilities.steering: boolean`, false unless the runtime advertised
    a usable steering method.
  - `Session.steer(text: string): Promise<void>`.
- Parse steering metadata in `src/lib/runtime/acp/protocol.ts`:
  - Add `parseSteeringMethod(value: unknown): string | null`. It reads
    `agentCapabilities._meta["reasonix.io"].sessionSteer.method` from an
    `initialize` result and returns that method only when it is a non-empty
    string. Everything else returns `null`.
  - Derive `RuntimeCapabilities.steering` from the same rule inside
    `parseInitializeResult`, so the capability and the method can never
    disagree.
  - Never expose the advertised method name, the `_meta` payload, or any other
    raw ACP structure through `RuntimeCapabilities` or `Session`.
- Implement steering in the ACP runtime:
  - Capture the advertised method privately during `initialize`.
  - `Session.steer(text)` checks runtime and session state before any wire
    request.
  - Reject with `UnsupportedCapabilityError("steering")` with no wire request
    when the runtime did not advertise a usable method.
  - Reject with a plain `Error` and no wire request when the session is closed or
    has no active prompt. Steering is meaningful only against the active prompt,
    and this matches the existing prompt guard style.
  - Otherwise send one request to the advertised method with exactly
    `{ sessionId, prompt: [{ type: "text", text }] }`, matching the observed PoC
    call in `~/Projects/reasonix-workflow-poc/acp-steer-smoke.mjs`.
  - Resolve to `void` on a successful JSON-RPC response and ignore the result
    payload, whose shape is not verified. Propagate transport, JSON-RPC, and
    timeout errors unchanged.
  - Do not alter `prompt`, `cancel`, `close`, session tracking, or cancellation
    state. A failed steer must leave the active prompt running.
- Extend `createFakeRuntime`:
  - Add `steering: false` to its fixed capability snapshot.
  - Implement `Session.steer` as a rejection with
    `UnsupportedCapabilityError("steering")`.
- Extend the fake ACP agent with deterministic steering behavior:
  - Default `initialize` keeps advertising
    `sessionSteer: { method: "_reasonix.io/session/steer" }`.
  - Fixture modes for missing steering metadata, malformed steering metadata,
    and a steering JSON-RPC error.
  - A default handler for `_reasonix.io/session/steer` that returns `{}` and is
    observable through the existing message log.
- Add one opt-in live test for steering through `createAcpRuntime`. It must be
  skipped by default and must keep its assertions when the environment cannot
  create a session.
- Leave `docs/reasonix-acp-contract.md` unchanged unless the live test actually
  passes. Its steering row stays "partially verified, see limits".

## Out of scope

- Live steering characterization, interrupt-versus-queue semantics, and any
  behavior that depends on a real model. Feature 7B owns them and stays blocked.
- Any live steering claim, any new evidence-table row, and any promotion of the
  PoC steering row.
- Steering persistence, run records, workflow-engine integration, dashboard
  controls, keyboard shortcuts, or UI (features 9, 14, 15).
- Session inbox, goal pause or resume, `submitForm`, status, reload extensions,
  MCP, `delete`, `additionalDirectories`, and other advertised `_meta` methods.
- Concurrent prompts, steering before the first prompt of a session, and
  steering after a prompt completes beyond the explicit rejection above.
- Retries, queues, timers, caching, new dependencies, or a configuration surface.
- Changes to Feature 3B, Feature 6B, their live tests, or their blocked status.

## Build loop

Follow `workflow.stepReview: "feature"` and
`workflow.checkpointCommits: "disabled"`. Continue through passing steps and
present one final review packet. Do not run `/complete`.

## Build steps

- [x] 1. **Parse and expose the steering capability.**
  - Add `steering: boolean` to `RuntimeCapabilities` and
    `steer(text: string): Promise<void>` to `Session` in
    `src/types/runtime.ts`.
  - Add `parseSteeringMethod` to `src/lib/runtime/acp/protocol.ts` with the
    exact metadata path and validation above.
  - Have `parseInitializeResult` set `steering` from that same rule.
  - Update the fake runtime's capability snapshot and reject `steer` with
    `UnsupportedCapabilityError("steering")`.
  - Give the ACP runtime a temporary `Session.steer` that rejects with
    `UnsupportedCapabilityError("steering")` until step 2 replaces it, so the
    repository typechecks after the contract change.
  - Update the existing normalized-capability expectation in
    `protocol.test.ts` and add cases for a valid method, missing `_meta`, missing
    `reasonix.io`, missing `sessionSteer`, a missing or empty `method`, and a
    non-string `method`. Extend `fake-runtime.test.ts` for the new capability and
    rejection.
  - Do not log the advertised method name or any metadata payload.

  Done when: `npx tsc --noEmit` passes and the protocol and fake-runtime tests
  prove the capability rule without changing any other adapter behavior.

- [x] 2. **Implement `Session.steer` and prove it through the fake agent.**
  - Store the advertised method privately in the ACP runtime and pass it to each
    session object.
  - Implement the state checks, capability denial, exact request, and error
    propagation described in scope.
  - Add the default steering handler and the missing, malformed, and error
    fixture modes to `test-fixtures/fake-agent.mjs`. Malformed modes must be
    selectable without changing the default handshake.
  - Add runtime tests using the existing message log to prove:
    - the exact advertised method is called with exactly the required params;
    - a successful response resolves `void` and leaves the prompt running;
    - the prompt result text and stop reason are unchanged by a successful
      steer;
    - a runtime without steering metadata denies with
      `UnsupportedCapabilityError("steering")` and sends no wire request;
    - steering with no active prompt sends no wire request;
    - steering after the prompt settles sends no wire request;
    - steering on a closed session or closed runtime sends no wire request;
    - a steering JSON-RPC error rejects with the original error and the prompt
      still completes normally;
    - no new request is sent on the default prompt, cancel, or close paths.
  - Do not assert or document interrupt-versus-queue behavior. The fake agent is
    a determinism fixture, not runtime evidence.

  Done when: focused runtime and fixture tests pass, the log proves the exact
  method and params, every denial path is wire-silent, and the existing prompt,
  cancel, and close tests still pass.

- [x] 3. **Add the opt-in live test and run the feature gate.**
  - Add `src/lib/runtime/acp/steering.live.test.ts`, gated by
    `DOMINO_LIVE_ACP=1` and skipped by default, following the existing live test
    setup.
  - It should assert `runtime.capabilities.steering`, create a session, start a
    prompt, send one steer after the first assistant chunk, and assert the steer
    resolves. Do not assert interrupt or queue behavior; record what is observed
    in the final review notes only.
  - Run `DOMINO_LIVE_ACP=1 npx vitest run src/lib/runtime/acp/steering.live.test.ts`
    once. If it cannot create a session, leave its assertions unchanged, leave
    `docs/reasonix-acp-contract.md` unchanged, and record the observed reason in
    the final review notes.
  - Run `npm test -- src/lib/runtime/acp/protocol.test.ts src/lib/runtime/acp/runtime.test.ts src/lib/runtime/fake-runtime.test.ts`.
  - Run the full `npm test` suite, `npx tsc --noEmit`, `npm run lint`, and
    `git diff --check`.
  - Confirm Features 3B and 6B and their live tests are unchanged, the default
    test run skips every live file, and the working tree contains only intended
    files.

  Done when: every non-live check passes, the live attempt result is recorded
  truthfully, no live steering behavior is claimed, and the diff is limited to
  this feature.

## Files / areas

- `src/types/runtime.ts` - `steering` capability and `Session.steer`.
- `src/lib/runtime/acp/protocol.ts` - steering metadata parsing.
- `src/lib/runtime/acp/protocol.test.ts` - capability parsing cases.
- `src/lib/runtime/acp/runtime.ts` - private method capture and steer request.
- `src/lib/runtime/acp/runtime.test.ts` - steering acceptance and failure paths.
- `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` - deterministic steering
  handler and capability modes.
- `src/lib/runtime/acp/steering.live.test.ts` - the single opt-in live test.
- `src/lib/runtime/fake-runtime.ts` - contract-complete unsupported steering.
- `src/lib/runtime/fake-runtime.test.ts` - fake capability and rejection tests.
- `docs/reasonix-acp-contract.md` - only if the live test passes.
- `blueprint/build-plan.md` - the approved 7A and 7B split.

Do not touch workflow engine code, persistence, Feature 11A settings, the
dashboard, localization catalogs, or the existing 3B and 6B tests.

## Data / contracts

- `RuntimeCapabilities.steering` is a boolean. It is true only when the
  `initialize` result has
  `agentCapabilities._meta["reasonix.io"].sessionSteer.method` as a non-empty
  string. Any missing, non-object, empty, or non-string value normalizes to
  false. There is no hardcoded fallback method.
- The advertised method is adapter-private. It is never part of
  `RuntimeCapabilities`, `RuntimeEvent`, errors, or logs.
- `Session.steer(text)` sends one JSON-RPC request to the advertised method with
  `{ sessionId, prompt: [{ type: "text", text }] }`. The observed PoC call shape
  is the contract; no other fields are added.
- A successful JSON-RPC response resolves `void`. Any result payload is ignored
  because its shape is unverified and is not exposed. A JSON-RPC, transport, or
  timeout error rejects with the original error.
- Capability denial uses `UnsupportedCapabilityError("steering")`. No-active-prompt
  and closed-session rejection use a plain `Error` with an actionable message.
  All three cases send no wire request.
- Steering is not cancellation. It never sets cancel state, ends a prompt, or
  changes the prompt result. The prompt's text chunks and stop reason stay
  exactly as they are without steering.
- Steering text is user data. Do not log it or include it in error messages or
  test names.
- No persistence, configuration, dependency, or public ACP type is added.

## Testing

- Protocol unit tests for steering capability detection: valid method, missing
  `_meta`, missing `reasonix.io`, missing `sessionSteer`, empty method,
  non-string method, and a schema-only entry without `method`.
- Fake-agent integration tests through the real transport and ACP runtime for
  the exact wire method and params, successful resolve, capability denial,
  no-active-prompt denial, post-prompt denial, closed session and runtime
  denial, error propagation, and prompt-result invariance.
- Fake runtime contract tests for `steering: false` and the typed rejection.
- One opt-in live test for steering through the Domino adapter. It is skipped by
  default and is expected to fail in this environment until a credential and a
  writable Reasonix home exist.
- Baseline observed on 2026-10-30: `npm test` reported 260 passed and 3 skipped.
- No Browser tests command is configured, so no browser coverage is added.
- The final gate is the focused tests, the full `npm test` suite,
  `npx tsc --noEmit`, `npm run lint`, and `git diff --check`.

## Notes for the AI

- Do not mark Feature 7, 7A, or 7B complete from this spec; `/complete` owns
  closure.
- Do not characterize steering as interrupt or queue. That is Feature 7B and is
  blocked on live prerequisites.
- Do not touch Feature 3B, Feature 6B, or their live tests.
- Do not hardcode `_reasonix.io/session/steer`; read it from `initialize`
  metadata.
- Do not expose raw ACP method names, params, metadata, or payloads through the
  runtime contract.
- Do not log steering text, session ids, workspace paths, or metadata values.
- Preserve the existing prompt, cancel, close, timeout, and shutdown behavior.
- Use the fake agent and temporary paths only. The new live test is the only
  test allowed to spawn Reasonix for this feature.
- No em dashes in generated content.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":13375,"specSha256":"5aec6e140c9caf9ecffad78442969c92f3875863af2e8f01c3b6925dfdc29fed","branch":"refs/heads/feature/steering-discovery-and-optional-capability","head":"ac3e1e3822de256f9ef94a119533e8c54166a8c1","baseRef":"refs/heads/main","baseCommit":"ac3e1e3822de256f9ef94a119533e8c54166a8c1","sourceTree":"66ccc86e5ecd2fdaed732e5bb5727ca1b8344a81","landing":"local-merge","absentOptional":[]} -->
