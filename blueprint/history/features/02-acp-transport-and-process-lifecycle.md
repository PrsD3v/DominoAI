# Feature: ACP transport and process lifecycle

**From build-plan:** feature 2
**Branch:** feature/acp-transport-and-process-lifecycle
**Build attempt:** 1
**Status:** verified

## Goal

A Domino-owned transport that starts an agent child process over stdio and speaks
JSON-RPC 2.0 with it: newline-delimited framing, request and response
correlation with pending tracking, timeouts, incoming notification and agent
request dispatch, and a deterministic end on EOF, crash, protocol violation, or
explicit shutdown. No caller of the transport can hang. Feature 3 builds
`initialize` and the session lifecycle on it; feature 4 builds prompt execution on
it.

## In scope

- `startTransport(options)` spawning a child process with piped stdin, stdout, and
  stderr, and refusing to resolve before the process actually started.
- JSON-RPC 2.0 message shapes for Domino, a parser, a serializer, and a line
  decoder that survives arbitrary chunk boundaries.
- `request(method, params, { timeoutMs })` with per-connection integer ids, a
  pending map, a typed rejection for JSON-RPC error responses, and a per-request
  timeout.
- `notify(method, params)` for client to agent notifications.
- `onNotification` and `onRequest` subscriptions for agent to client messages.
- `closed` as a settled close outcome, and an idempotent `close()` that ends
  stdin, waits a grace period, then kills the child.
- Failure handling: spawn error, child exit while requests are pending, malformed
  output line, response for an unknown or already-settled id, writes after close,
  and stderr that the child floods.
- Tests that spawn a real Node child fixture, plus one env-gated live check
  against the installed Reasonix CLI, and the matching record in
  `docs/reasonix-acp-contract.md`.

## Out of scope

- `initialize`, `initialized`, capability discovery, `session/new`, `session/close`
  (feature 3).
- `session/prompt` and `session/update` normalization (feature 4).
- `session/cancel`, resume, load, list, and steering (features 5 to 7).
- Any `AgentRuntime` or `Session` implementation, and any ACP method name or
  constant in the domain layer. The transport carries method strings only.
- Process pooling, several transports at once, or reuse of one child across runs.
- Workspace containment, permission or approval semantics, and sandboxing
  (features 9, 11, 15).
- Stderr retention or redaction. Stderr is drained and discarded; feature 15 owns
  log redaction.
- Message size limits against a hostile child. The child is a locally installed
  CLI, not an untrusted peer.
- JSON-RPC batch arrays. ACP sends one JSON object per line.

## Build loop

`workflow.stepReview` is `feature`, so all six steps land in one review packet,
and `workflow.checkpointCommits` is `disabled`, so no checkpoint commits are
made. Each step must leave `npm test`, `npx tsc --noEmit`, and `npm run lint`
green before the next step starts. `/complete` creates the feature commit.

## Build steps

- [x] 1. **JSON-RPC message model and line decoder** - add
  `src/lib/runtime/acp/json-rpc.ts` with `JsonRpcId` (`number | string`),
  request, notification, success response, and error response types; a
  `JsonRpcParseError`; `serializeJsonRpcMessage`; `parseJsonRpcMessage(line)`
  returning the validated message; and `createLineDecoder()` with
  `push(chunk: string): string[]`, which buffers a trailing partial line and
  drops empty or whitespace-only lines. Reject a batch array, a non-object, a
  missing or wrong `jsonrpc` field, a message with neither `method` nor `id`, a
  response carrying both `result` and `error` or neither, a request with a
  non-numeric non-string id, and an error object without numeric `code` and
  string `message`. Add `json-rpc.test.ts` covering each accepted shape, each
  rejected shape, decoding at every split point of a multi-message chunk, CRLF,
  and empty lines.
  **Done when** `npm test` passes with the new cases, and typecheck and lint are
  clean.

- [x] 2. **Spawn and shutdown lifecycle** - add
  `src/lib/runtime/acp/transport.ts` with `TransportOptions`, the `Transport`
  interface, `TransportClose`, and `startTransport`, plus the error classes
  `TransportClosedError` (`close` outcome attached), `TransportTimeoutError`, and
  `JsonRpcError` (`method`, `code`, `data`). Spawn with
  `stdio: ["pipe", "pipe", "pipe"]`, drain stderr to avoid a blocked pipe, resolve
  after the `spawn` event, and reject with the underlying error when the process
  cannot start. Expose `closed`, a promise that resolves once with the close
  outcome. `close()` is idempotent: it settles pending work, ends stdin, waits up
  to `shutdownGraceMs` for exit, sends `SIGKILL` after that, and resolves after the
  process exited. Add `src/lib/runtime/acp/test-fixtures/fake-agent.mjs`, a
  dependency-free ESM script spawned with `process.execPath`, with an
  `ignore-shutdown` mode that keeps running after stdin ends. Add
  `transport.test.ts` covering a successful start and close, a repeated close, a
  missing executable, and the kill fallback for `ignore-shutdown`.
  **Done when** those tests pass, typecheck and lint are clean, and the suite ends
  without a child process still running.

- [x] 3. **Requests, pending tracking, timeouts, and error responses** - add
  `request<T>(method, params, { timeoutMs })` with ids starting at 1 per
  connection, a pending map keyed by the string form of the id, the connection
  `requestTimeoutMs` default (`30_000`) overridable per call, and a
  `RequestOptions` type. A response for a known id settles it; a response for an
  unknown or already-settled id is dropped without touching the connection. An
  error response rejects with `JsonRpcError`. A timeout rejects with
  `TransportTimeoutError`, removes the pending entry, and leaves the connection
  usable. A request after close rejects with `TransportClosedError`. Extend the
  fixture with `echo`, `fail`, and `late-echo` methods. Add cases for a round
  trip with params, concurrent requests resolving to their own results, an error
  response with `code`, `message`, and `data`, a timeout followed by a usable
  connection and a dropped late response, and a request after close.
  **Done when** those tests pass, typecheck and lint are clean.

- [x] 4. **Notifications and agent to client requests** - add
  `notify(method, params)` writing one notification line and throwing
  `TransportClosedError` when the connection is already closed, `onNotification`
  returning an unsubscribe function, and `onRequest` accepting a single handler
  that returns a value or a promise. Dispatch an incoming notification to every
  current listener, catching listener exceptions so one listener cannot stop the
  others or the read loop. Reply to an incoming request with the handler result
  under the same id, with `-32601` and `Method not found` when no handler is
  registered, and with `-32603` and `Internal error` when the handler throws,
  without leaking the raw message. Registering a second request handler throws.
  Extend the fixture with `notify` (two notifications, then a result) and
  `ask-client` (requests `fake/question` from the client and replies with the
  answer). Add cases for delivery, unsubscribe, listener isolation, handler
  result, no handler, handler failure, and a second handler registration.
  **Done when** those tests pass, typecheck and lint are clean.

- [x] 5. **Failure safety: crash, protocol violation, and closed writes** - make
  every open path settle when the child dies or the stream breaks: pending
  requests reject with `TransportClosedError` carrying the close outcome, the
  connection refuses new work, and the child is terminated when the protocol is
  violated. Treat an unparseable output line as a protocol violation: settle
  pending work with `{ kind: "protocol", error }`, kill the child, and resolve
  `closed` accordingly. Extend the fixture with a `crash` method, a
  `malformed-output` method, and `stderr-flood` and `close-stdout` modes; the
  flood mode writes more than 128 KB to stderr before answering, and the
  `close-stdout` mode ends its output while staying alive. Add cases for a pending request during a nonzero exit,
  a malformed line with the child terminated, the flood mode still answering,
  and `notify` after close.
  **Done when** those tests pass, typecheck and lint are clean, and no test leaves
  a child process behind.

- [x] 6. **Live transport check against the installed CLI** - probe the installed
  Reasonix CLI with a throwaway script under `$TMPDIR`, using the launch command
  recorded by the PoC (`reasonix acp --model deepseek/deepseek-flash
  --permission-mode ask`, cwd set to the workspace) and an unknown method, and
  record the exact invocation plus the observed outcome in
  `docs/reasonix-acp-contract.md`. Add `transport.live.test.ts`, skipped unless
  `DOMINO_LIVE_ACP=1`, that starts the real CLI through `startTransport` and
  asserts the behavior just observed, without a model call and without an ACP
  handshake. Mark the row verified only if the probe produced the recorded
  result.
  **Done when** `DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/transport.live.test.ts`
  passes in this environment, the same file is reported as skipped without the
  variable, `docs/reasonix-acp-contract.md` records the invocation and outcome,
  and the full `npm test` run is green.

## Files / areas

- `src/lib/runtime/acp/json-rpc.ts` - message types, parser, serializer, line
  decoder, `JsonRpcParseError`.
- `src/lib/runtime/acp/json-rpc.test.ts` - unit tests for parsing and decoding.
- `src/lib/runtime/acp/transport.ts` - spawn, pending tracking, dispatch,
  timeouts, close, error classes.
- `src/lib/runtime/acp/transport.test.ts` - integration tests against the fixture
  child.
- `src/lib/runtime/acp/transport.live.test.ts` - env-gated live check.
- `src/lib/runtime/acp/test-fixtures/fake-agent.mjs` - dependency-free fixture
  child, driven by the JSON-RPC method it receives and by `FAKE_AGENT_MODE`.
- `docs/reasonix-acp-contract.md` - launch command and transport observation.

The transport is library code exercised by tests, in the same position as
`src/lib/runtime/fake-runtime.ts` from feature 1. Feature 3 is its first consumer;
nothing under `src/app/` imports it yet.

## Data / contracts

- Outgoing request ids are integers starting at 1 per connection. Incoming ids may
  be numbers or strings and are echoed unchanged on replies.
- Frames are one JSON object per line. The serializer emits no newline; the
  transport appends `"\n"` to every write. Empty and whitespace-only output lines
  are ignored.
- `TransportClose` is a discriminated union:
  `{ kind: "shutdown" }` for a local close, `{ kind: "exit", code, signal }` for a
  child exit, and `{ kind: "protocol", error }` for a malformed line. `closed`
  resolves with it once; it never rejects. A process that cannot start makes
  `startTransport` reject, so no transport exists to report.
- `TransportOptions`: `command`, `args`, `cwd`, `env`, `requestTimeoutMs`
  (default `30_000`), `shutdownGraceMs` (default `2_000`).
- Error classes carry what the caller needs to act: `TransportClosedError` holds
  the close outcome and the attempted method, `TransportTimeoutError` holds the
  method and the timeout, and `JsonRpcError` holds the method, `code`, `message`,
  and `data` from the agent.
- Protocol error codes used by Domino: `-32601` for an unhandled incoming method
  and `-32603` for a handler failure.

## Testing

- `npm test` (Vitest) runs the suite. New coverage is in
  `json-rpc.test.ts`, `transport.test.ts`, and the env-gated
  `transport.live.test.ts`.
- The fixture child makes framing, concurrency, timeouts, crash, protocol
  violation, and shutdown repeatable without spawning Reasonix or making a network
  call.
- The live check is skipped by default so the default suite never depends on an
  installed runtime. It is the only test that spawns Reasonix, and it sends no
  prompt.
- No UI is touched, so there is no screenshot or browser evidence.

## Notes for the AI

- Node is not on this shell's PATH, but it is installed at
  `/home/prs/.nvm/versions/node/v24.18.1`. Run
  `export PATH="/home/prs/.nvm/versions/node/v24.18.1/bin:$PATH"` before
  `npm` or `npx` in every step.
- Baseline at spec time: 4 test files, 16 tests, all passing; `npm test` takes
  about 2 seconds.
- Use `node:child_process` and `node:stream` only. Do not add a dependency for
  framing, JSON-RPC, or process handling.
- The fixture is `.mjs` because the spawned process runs the file directly;
  keep it dependency-free and free of TypeScript syntax.
- Keep the transport free of ACP method names and of `AgentRuntime` types. The
  boundary with the runtime layer is feature 3's job.
- Follow the existing style: `@/*` imports, no `any`, error classes over string
  codes, test files next to source, no em dashes in files or comments.

## Open questions

None. Timeout defaults, the single request handler, and dropped unknown response
ids are reversible internal decisions recorded above; no product, persisted-data,
or interoperability choice is left open.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":13170,"specSha256":"a53be6ca0d1ee4a75f7fd8344132431eedb59da344a8562754a8ede4265e5daf","branch":"refs/heads/feature/acp-transport-and-process-lifecycle","head":"331cbb8e2ba5a479bfe69952a33e9c93b706b4dd","baseRef":"refs/heads/main","baseCommit":"331cbb8e2ba5a479bfe69952a33e9c93b706b4dd","sourceTree":"44185e26bb5f38f73db73675e7a90ada676e3b5a","landing":"local-merge","absentOptional":[]} -->
