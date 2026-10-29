# Feature: Runtime contracts and adapter test harness

**From build-plan:** feature 1
**Build attempt:** 1
**Status:** verified
**Branch:** feature/runtime-contracts-and-adapter-test-harness

## Goal

Give Domino a runtime-independent contract for creating a session and running a
prompt, plus a scripted fake runtime so every later engine and adapter test can
run in Vitest without Reasonix, a child process, a network call, or a database.

## In scope

- Domino-owned TypeScript contracts for `AgentRuntime`, `Session`,
  `PromptRequest`, `PromptResult`, and `RuntimeEvent`, with the normalized stop
  reason vocabulary needed now.
- A scripted fake `AgentRuntime` that satisfies the same contracts as the future
  Reasonix adapter and is exercised by Vitest.
- Tests for the fake runtime's observable behavior: distinct session ids,
  ordered event delivery, assembled result text, stop reason, and exhausted
  script failure.

## Out of scope

- ACP transport, JSON-RPC framing, process spawn, timeouts, and crash handling
  (feature 2).
- The ACP `initialize` handshake, capability discovery, session close, and
  recording what the runtime reports (feature 3).
- Mapping ACP `session/update` payloads into runtime events and the full stop
  reason vocabulary (feature 4).
- Cancel, EOF, crash, and timeout safety (feature 5).
- `resume`, `load`, `list`, and session summaries (feature 6).
- Steering (feature 7).
- Persistence contracts, SQLite, the workflow engine, and any UI (features 8 to
  15).
- Any Reasonix import, binary path, environment variable, or ACP method name in
  the public contract.
- New npm dependencies. The contract and fake use TypeScript and Vitest only.

## Build loop

This is a regular feature. Config sets `workflow.stepReview` to `feature` and
`checkpointCommits` to `disabled`, so implement both steps as one reviewable
packet, then stop for one review before `/check` and `/audit`. Do not create
checkpoint commits. `/complete` creates the feature commit.

## Build steps

- [x] 1. Add the runtime contract module at `src/types/runtime.ts`.
  Done when the module exports the contract shapes below, contains no import of
  Reasonix, ACP, Node process, network, or persistence code, and
  `npx tsc --noEmit` passes.

- [x] 2. Add the scripted fake runtime at `src/lib/runtime/fake-runtime.ts` and
  its tests at `src/lib/runtime/fake-runtime.test.ts`.
  Done when `createFakeRuntime` is assignable to `AgentRuntime`, a reviewer can
  see the module imports no `node:child_process`, network, or Reasonix code,
  and `npm test` passes with tests covering:
  - two sessions receive different, stable ids (`fake-session-1`,
    `fake-session-2`);
  - scripted deltas arrive through `onEvent` in order as
    `assistant_text_delta` events;
  - the prompt result joins the deltas and defaults the stop reason to
    `completed`;
  - a scripted turn can set `cancelled`;
  - a prompt with no scripted turn left rejects with an `Error` instead of
    resolving.

## Files / areas

- `src/types/runtime.ts` - new contract-only module, imported with the `@/*`
  alias.
- `src/lib/runtime/fake-runtime.ts` - new fake implementation.
- `src/lib/runtime/fake-runtime.test.ts` - new Vitest tests, colocated with the
  fake per the project testing rule.
- No existing file changes are required. No dependency is added.

## Data / contracts

```ts
// src/types/runtime.ts

export type PromptStopReason = "completed" | "cancelled";

export type RuntimeEvent = {
  type: "assistant_text_delta";
  text: string;
};

export interface CreateSessionRequest {
  workspaceRoot: string;
}

export interface PromptRequest {
  text: string;
  onEvent: (event: RuntimeEvent) => void;
}

export interface PromptResult {
  text: string;
  stopReason: PromptStopReason;
}

export interface Session {
  readonly id: string;
  prompt(request: PromptRequest): Promise<PromptResult>;
}

export interface AgentRuntime {
  createSession(request: CreateSessionRequest): Promise<Session>;
}
```

Contract rules:

- `Session.id` is the runtime session id. It stays distinct from a workflow run
  id; nothing in this feature equates them.
- `workspaceRoot` is passed through unchanged. Validation, canonicalization, and
  containment are features 11 and 9 and must not be implemented here.
- Events are delivered synchronously, in order, through `onEvent` while the
  prompt is active. `PromptResult.text` is the complete assistant text for that
  prompt, not a delta.
- `PromptStopReason` holds only the two semantics the ACP evidence proves:
  `completed` (ACP `end_turn`) and `cancelled`. Feature 4 extends the vocabulary
  when it maps the remaining stop reasons. Do not add speculative values now.
- `createSession` and `prompt` report failure by rejecting with an `Error`. No
  custom error taxonomy is introduced in this feature; failure safety is
  feature 5.
- The contract declares no capability discovery, no `initialize`, no `close`,
  no `resume`, `load`, `list`, or steering. Those arrive only with the features
  that implement and test them.
- At most one prompt per session is assumed. Concurrent sessions and
  interleaved prompts are post-MVP and are not modeled or tested here.

Fake runtime shape:

```ts
// src/lib/runtime/fake-runtime.ts

export interface FakeTurn {
  deltas: string[];
  stopReason?: PromptStopReason;
}

export function createFakeRuntime(turns?: FakeTurn[]): AgentRuntime;
```

Fake behavior:

- Session ids increment from `fake-session-1`.
- Each prompt consumes the next scripted turn from one shared queue, emits one
  `assistant_text_delta` per delta in array order, and resolves
  `{ text: deltas.join(""), stopReason: stopReason ?? "completed" }`.
- A prompt after the script is exhausted rejects with an `Error` whose message
  is stable enough to assert, for example `"fake runtime has no scripted turn"`.
- The fake uses no timers, no child process, no filesystem, no network, and no
  environment variables.

## Testing

`npm test` is configured and is the gate. Add `src/lib/runtime/fake-runtime.test.ts`
covering the five behaviors in step 2, including the rejection path. Type-only
step 1 is verified with `npx tsc --noEmit`.

No `Browser tests` command exists and none is added: this feature has no UI or
browser behavior. No `Verify` command is configured yet; `/ci` owns that setup
and it is not a prerequisite for this feature because the typecheck and test
commands already exist and run green on `main` (11 tests at spec time).

## Notes for the AI

- Keep `src/types/runtime.ts` type-only. Use `import type` where the types are
  consumed.
- The public contract is the boundary. If a later ACP detail seems necessary
  here, it belongs to the feature that implements and tests that capability.
- Prefer `interface` for object shapes and a union for `RuntimeEvent` so later
  features extend the union instead of reshaping it.
- Do not add a barrel export, a factory abstraction, an error class hierarchy,
  a retry helper, or a runtime registry. Nothing in this feature requires them.
- The fake is test infrastructure, not production code. Keep it deterministic
  and small enough to trust.
- No em dashes in code, comments, tests, or documentation.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":7210,"specSha256":"62ff8f6cf258d803b101712cf619dec26c22abc476232929233001e2e51a47ba","branch":"refs/heads/feature/runtime-contracts-and-adapter-test-harness","head":"87e8af4e942ebffa862dca6578742f1f172a6eb2","baseRef":"refs/heads/main","baseCommit":"87e8af4e942ebffa862dca6578742f1f172a6eb2","sourceTree":"2995fd136cfaf63e4859b3c71d425d41ced587d8","landing":"local-merge","absentOptional":[]} -->
