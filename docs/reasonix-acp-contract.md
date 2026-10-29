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
| Handshake and capabilities | `initialize` | Re-run in this session, 2026-10-29 | verified |
| Session summaries | `session/list` | Re-run in this session, 2026-10-29; returned `sessionId`, `cwd`, `title`, `updatedAt` | verified |
| Create session | `session/new` | PoC run, 2026-10-28; returned a `sessionId` | verified in the PoC, not re-run here |
| Prompt and streaming | `session/prompt`, `session/update` | PoC run, 2026-10-28; text arrived through `session/update`, `stopReason: end_turn` | verified in the PoC, not re-run here |
| Close session | `session/close` | PoC run, 2026-10-28 | verified in the PoC, not re-run here |
| Cancel | `session/cancel` notification | PoC run, 2026-10-28; prompt ended with `stopReason: cancelled` | verified in the PoC, not re-run here |
| Resume after process restart | `session/resume` | PoC run, 2026-10-28; a new process resumed the same `sessionId` and completed a prompt | verified in the PoC, not re-run here |
| Load with history replay | `session/load` | PoC run, 2026-10-28; prior response was observable again, then a new prompt succeeded | verified in the PoC, not re-run here |
| Steering | `_reasonix.io/session/steer` | PoC run, 2026-10-28; the target text was received | partially verified, see limits |

"Re-run in this session" means the smoke script was executed again on 2026-10-29
while writing this file. The other rows come from the PoC handoff and its scripts;
they were not re-executed here because they require model calls.

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

## Environment note

Starting Reasonix in this environment printed configuration migration warnings
about a read-only lock directory under `~/.reasonix/locks`. They did not affect the
`initialize` response or `session/list`. They are recorded here as an observed
environment condition, not as part of the protocol.
