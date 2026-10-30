# Reasonix ACP contract - observed baseline

Recorded before build-plan feature 1 so the adapter is written against evidence,
not assumptions.

Rule for this file: an operation is **verified** only when the exact ACP path
Domino will use produced the result in this environment. Advertised capability is
not the same as verified behavior.

## Environment

| Item | Value |
| --- | --- |
| Observation date | 2026-10-29 |
| Runtime | Reasonix CLI `v2.54.0` (`reasonix --version`) |
| Agent info from `initialize` | `name: reasonix`, `version: v2.54.0` |
| Protocol version | `1` |
| Transport | ACP over stdio, JSON-RPC 2.0, one JSON object per line |
| Launch command | `reasonix acp --model deepseek/deepseek-flash --permission-mode ask`, cwd set to the workspace, stdin, stdout, and stderr piped |
| Model used by the reference scripts | `deepseek/deepseek-flash` |
| Node.js | `v24.18.1` |
| Reference scripts | `~/Projects/reasonix-workflow-poc/acp-*.mjs` |

## Method surface used by the reference scripts

| Direction | Method | Purpose |
| --- | --- | --- |
| client to agent | `initialize` | Handshake and capability advertisement |
| client to agent (notification) | `initialized` | Handshake completion |
| client to agent | `session/new` | Create a session for a working directory |
| client to agent | `session/prompt` | Send a prompt and stream the result |
| agent to client | `session/update` | Streamed response and tool updates |
| client to agent | `session/close` | Close a session |
| client to agent (notification) | `session/cancel` | Request cancellation of the active prompt |
| client to agent | `session/resume` | Continue a session without requiring history replay |
| client to agent | `session/load` | Load a session and replay its history |
| client to agent | `session/list` | List session summaries |
| client to agent | `_reasonix.io/session/steer` | Steering, discovered from `_meta` |

The steering method name is read from the initialize response at runtime. It is
not hardcoded.

## Initialize response observed on 2026-10-29

Trimmed to the fields that matter for the adapter:

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "sessionCapabilities": {
      "list": {},
      "resume": {},
      "close": {},
      "delete": {},
      "additionalDirectories": {}
    },
    "promptCapabilities": {
      "image": true,
      "audio": false,
      "embeddedContext": true
    },
    "mcpCapabilities": {
      "http": true,
      "sse": false
    },
    "_meta": {
      "reasonix.io": {
        "sessionSteer": { "method": "_reasonix.io/session/steer" },
        "sessionInbox": { "schemaVersion": 1 },
        "sessionReloadExtensions": { "method": "_reasonix.io/session/reloadExtensions" },
        "extensionSurface": { "supported": true, "schemaVersion": 1 }
      },
      "_reasonix.io/session/extension/submitForm": { "schemaVersion": 1 },
      "_reasonix.io/session/goal/pause": { "schemaVersion": 1 },
      "_reasonix.io/session/goal/resume": { "schemaVersion": 1 },
      "_reasonix.io/session/info": { "schemaVersion": 1 },
      "_reasonix.io/session/mcp/disconnect": { "schemaVersion": 1 },
      "_reasonix.io/session/mcp/reconnect": { "schemaVersion": 1 },
      "_reasonix.io/session/mcpServers": { "schemaVersion": 1 },
      "_reasonix.io/session/mcpStatus": { "schemaVersion": 1 },
      "_reasonix.io/session/mcpStatus_update": { "schemaVersion": 1 },
      "_reasonix.io/session/status": { "schemaVersion": 1 },
      "_reasonix.io/session/status_update": { "schemaVersion": 1 }
    }
  },
  "agentInfo": { "name": "reasonix", "version": "v2.54.0" },
  "authMethods": [
    {
      "id": "reasonix-setup",
      "type": "terminal",
      "args": ["setup"]
    }
  ]
}
```

The `sessionInbox` block also advertises `delete`, `enqueue`, `get`, `list`,
`move`, `refresh`, `retry`, `setPaused`, and `update` methods. None of them have
been exercised.

## Status by operation

| Operation | Method | Evidence | Status |
| --- | --- | --- | --- |
| Transport framing and correlation | an unknown method | Domino transport, 2026-10-29; replied `-32601` with `method not found: domino/transport-probe` | verified |
| Handshake and capabilities | `initialize` | Re-run in this session, 2026-10-29; Domino `createAcpRuntime` live test reached a successful `initialize` on 2026-10-29 | verified |
| Session summaries | `session/list` | Domino live test `session-list.live.test.ts`, 2026-10-30; returned `sessionId`, `cwd`, `title`, `updatedAt` | verified |
| Create session | `session/new` | PoC run, 2026-10-28; returned a `sessionId`. Domino live runs on 2026-10-29 and 2026-10-30 failed with a provider API key error before creating a session | PoC only; not verified through Domino |
| Prompt and streaming | `session/prompt`, `session/update` | PoC run, 2026-10-28; text arrived through `session/update`, `stopReason: end_turn` | verified in the PoC, not re-run here |
| Close session | `session/close` | PoC run, 2026-10-28. Domino live runs on 2026-10-29 and 2026-10-30 were not reached because session creation failed | PoC only; not verified through Domino |
| Cancel | `session/cancel` notification | PoC run, 2026-10-28; prompt ended with `stopReason: cancelled` | verified in the PoC, not re-run here |
| Resume after process restart | `session/resume` | PoC run, 2026-10-28; a new process resumed the same `sessionId` and completed a prompt | verified in the PoC, not re-run here |
| Load with history replay | `session/load` | PoC run, 2026-10-28; prior response was observable again, then a new prompt succeeded | verified in the PoC, not re-run here |
| Steering | `_reasonix.io/session/steer` | PoC run, 2026-10-28; the target text was received | partially verified, see limits |

"Re-run in this session" means the smoke script was executed again on 2026-10-29
while writing this file. The other rows come from the PoC handoff and its scripts;
they were not re-executed here because they require model calls.

## Transport check

The Domino transport spawned the installed CLI with the launch command above,
sent one request with id `1` for an unknown method, matched the response by id,
and then closed the child. No model call and no handshake were involved, so this
proves process start, newline framing, request correlation, error propagation, and
shutdown. The check is repeatable and skipped by default:

```bash
DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/transport.live.test.ts
```

The unknown-method reply was `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found: domino/transport-probe"}}`.

## Domino adapter check

`createAcpRuntime` performed the Domino handshake path against the installed CLI
with this command:

```bash
DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/runtime.live.test.ts
```

On 2026-10-29 and again on 2026-10-30 the handshake succeeded and reported
protocol version 1, agent `reasonix`, and `sessions.close: true`. On both runs the
next call, `session/new`, failed with a JSON-RPC error before a session was
created:

> session/new: model "deepseek/deepseek-flash" has no API key: add
> DEEPSEEK_API_KEY=<key> to /home/prs/.reasonix/.env or run `reasonix setup`
> (shell environment variables are not read)

Handshake through Domino is verified. Create and close through Domino are not
verified in this environment. The live test keeps its assertions and fails on
this condition; it is not skipped or relaxed.

## Advertised but not verified

- `promptCapabilities.image: true` is advertised, but no image has been sent
  through ACP end to end.
- `mcpCapabilities.http: true` is advertised, but no MCP server or tool call has
  been exercised through Domino. MCP is outside the MVP.
- `delete` and `additionalDirectories` are advertised, not exercised.
- The `_meta` session inbox, goal pause and resume, `submitForm`, status, and
  `reloadExtensions` methods are advertised, not exercised.
- `audio` is advertised as `false`; audio input is not available.

## Unverified semantics

- Steering: whether it interrupts the active prompt immediately, queues behind it,
  or behaves differently per model is unknown. The PoC only showed that a request
  was accepted and the expected text arrived.
- Concurrent sessions and interleaved prompts on one runtime.
- Runtime behavior on EOF, crash, or a prompt that never returns.
- The exact difference between `resume` and `load` beyond the observed behavior:
  `load` replayed history, `resume` continued without requiring replay.
- Workspace permission prompts and approval flows as they appear through ACP.
- Model or provider changes at runtime.
- Creating or closing a session through the Domino adapter on a never-prompted
  session. On 2026-10-29 and 2026-10-30 the installed runtime rejected
  `session/new` before creating a session because the configured model had no API
  key.
- Whether `session/new` itself contacts a provider. The observed failure shows it
  resolves the configured model and its credentials, but the full call path and
  any model usage are not characterized.

## Rules for the adapter

- Read capabilities from `initialize`; do not assume a method exists.
- Keep `resume` and `load` as separate operations with separate tests.
- Judge cancellation by the prompt result (`stopReason: cancelled`), not by the
  fact that a cancel message was sent.
- Treat every capability not in the verified table as optional and detectable at
  runtime.
- Never turn a protocol error or timeout into a success result.

## Reproducing the re-verified rows

```bash
export PATH="/home/prs/.nvm/versions/node/v24.18.1/bin:$PATH"
cd ~/Projects/reasonix-workflow-poc
node acp-smoke.mjs     # initialize response
node acp-list-smoke.mjs # session/list
```

Both scripts print the raw JSON-RPC response and a pass or fail line.

The Domino adapter path uses its own live test:

```bash
DOMINO_LIVE_ACP=1 npm test -- src/lib/runtime/acp/runtime.live.test.ts
```

## Environment note

Starting Reasonix in this environment printed configuration migration warnings
about a read-only lock directory under `~/.reasonix/locks`. They did not affect the
`initialize` response or `session/list`. They are recorded here as an observed
environment condition, not as part of the protocol.

`session/new` also requires the configured model to have a provider API key.
Keys are read from `~/.reasonix/.env`, not from shell environment variables. On
2026-10-29 and 2026-10-30 this environment had no key for
`deepseek/deepseek-flash`, so the Domino live test could not create a session. That is an environment condition, not
a protocol result, and it is not recorded as a verified session capability.
