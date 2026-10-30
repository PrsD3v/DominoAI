# Build Plan

Ordered, feature-sized outcomes. Details belong in each `/feature` spec, not here.
Run `/overview` once both plans are ready.

Build order rationale: the handoff makes the Reasonix ACP adapter the current
priority, and every later phase depends on it. The runtime contracts, the
adapter, and the in-memory workflow engine are built incrementally. The engine
defines the persistence contracts and runs on an in-memory implementation first;
SQLite implements the same contracts later and arrives before any claim that run
state survives an app restart.

Workspace safety is split by moment: feature 9 enforces per-operation containment,
feature 11 validates and canonicalizes the root at registration, and feature 15
adds server-level hardening. Adapter tests in features 2 to 7 use controlled
temporary workspaces, so no real project run can begin before both checks exist.

Project registration lands after persistence, because a registered project must
survive a restart, and before the dashboard, because the dashboard starts runs
against a selected project. Blueprint compatibility is assessed before any import
or mapping is assumed, and the Skill delivery proof needs the adapter plus a
definition model in place. Scaffolding is already done and is not a feature.

Feature 11A lands after project registration because a runtime profile must
survive a restart and bind to a registered project. It depends on feature 3's
session lifecycle and feature 4's prompt path for a real connection test, feature
9's runtime binding, and feature 10's persistence. Feature 14 folds the initial
Settings screen into the final dashboard. Feature 15 applies its loopback,
cross-origin, and redaction rules to the 11A settings API. Adding 11A does not
renumber features 12 to 16.

Evidence rule: each proven ACP scenario (initialize, session, prompt, steering,
resume, load, list, cancel) becomes a repeatable automated test in the feature
that implements it. The smoke scripts in `~/Projects/reasonix-workflow-poc` stay
in place as evidence and are not moved or deleted. A capability the handoff
leaves unproven stays marked unproven until a test passes for it.

Repository basics completed before feature 1: the MIT `LICENSE` file, a project
README that states local-first use and bring-your-own runtime and API keys, and
`docs/reasonix-acp-contract.md` recording the installed Reasonix version and the
observed ACP contract, split into verified and unverified capabilities.

Already in place before feature 1: the bilingual app shell with English as the
default locale and Persian RTL, a cookie-backed language switcher, per-language
fonts, localized loading, error, and 404 states, and a working Vitest setup.

UI conventions for every screen: shadcn/ui default components used as-is with no
edits under `components/ui/`, every user-facing string from the typed bilingual
catalog, both light and dark themes, logical spacing for RTL, and Zod schemas when
a form needs schema-based validation. Reference images, when supplied, live in
`blueprint/reference/` and drive the target instead of prose.

## Foundations

- [x] 1. **Runtime contracts and adapter test harness** - Extend the existing Vitest setup with Domino-owned, runtime-independent contracts for `AgentRuntime`, `Session`, `PromptResult`, and `RuntimeEvent`, plus a fake runtime so the engine is testable without Reasonix. Acceptance: the public types expose no Reasonix-specific ACP methods or raw ACP protocol structures; they depend on no SQLite, ORM, or concrete persistence implementation; a fake runtime satisfies the contracts and is exercised by Vitest without spawning Reasonix or making a network call; the initial contracts stay minimal and gain capability only when a later feature requires it.
- [x] 2. **ACP transport and process lifecycle** - Spawn the Reasonix CLI over stdio with JSON-RPC framing, request and notification dispatch, pending-request tracking, timeouts, and crash or shutdown handling.
### Feature 3 - Handshake, capability discovery, and session lifecycle (OPEN)

Feature 3A is complete. Feature 3B is blocked and deferred. It is intentionally
outside the selectable checklist so `/feature` can proceed to Feature 4 while
Feature 3 remains open.

- [x] 3A. **Local handshake, capability discovery, and session lifecycle** - Implement `initialize` with capability reporting plus session create and close, recording only what the installed runtime reports. Acceptance: protocol version 1 validation; initialized notification; missing or unsupported capabilities normalized to false; session create and close through the fake transport; error propagation; runtime and session close are idempotent; 35 focused tests prove the local adapter path. Commit `9464a35`. The live test remains scaffolding and is not evidence of a successful `session/new` or `session/close` through Domino.

- **3B. Live Reasonix runtime verification - BLOCKED / DEFERRED** - Do not mark complete. Original acceptance criteria remain unchanged: prove against the installed Reasonix CLI with a valid, disposable credential that `initialize`, `session/new`, and `session/close` succeed; use `session/prompt` only if needed to prove the intended runtime behavior. Do not use a production secret and do not record unexecuted behavior as verified. Blocker: no valid disposable credential is available and there is no writable Reasonix home in the current environment. Resume only after both are available and the live test actually passes. This remains required before Feature 3 completion, the Feature 11A real connection test, or any live capability claim.

- [x] 4. **Prompt execution and event normalization** - Run `session/prompt`, map streamed updates into normalized runtime events, and handle stop reasons without discarding original event data.
- [x] 5. **Cancel and failure safety** - Verify `session/cancel` produces a cancelled result, and make EOF, crash, and timeout end pending work instead of hanging it.
- [x] 6A. **Resume, load, and list adapter** - Keep `resume` (continue the session) and `load` (replay history) distinct in the runtime contract and ACP adapter, implement session summaries from `session/list`, and prove the local paths with the fake agent. Acceptance: capability-gated `session/resume`, `session/load`, and `session/list`; `load` replays normalized history events while `resume` does not; malformed list results and malformed summary entries are rejected; a live `session/list` test passes against the installed Reasonix version; no live resume or load claim is made.
- **6B. Live Reasonix resume and load verification - BLOCKED / DEFERRED** - Do not mark complete. Original acceptance remains: prove against the installed Reasonix CLI with a valid, disposable credential and a writable Reasonix home that `session/resume` continues the same persisted session without replaying history, and that `session/load` replays the persisted transcript as observable normalized events, with distinct tests for each. Blocker: no valid disposable credential and no writable Reasonix home in the current environment. Resume only after both exist and both live tests pass. This remains required before Feature 6 completion or any live resume or load capability claim.
### Feature 7 - Optional steering (OPEN)

Feature 7A is buildable locally. Feature 7B is blocked on the same live-runtime
prerequisites as 3B and 6B and is intentionally outside the selectable checklist
so `/feature` can proceed to Feature 8 while Feature 7 remains open.

- [x] 7A. **Steering discovery and optional capability** - Read the advertised steering method from the runtime's `initialize` metadata, expose steering as an optional capability, and add a session steering operation that fails typed when the runtime did not advertise it. Acceptance: the method name comes only from runtime metadata and is never hardcoded; a missing or malformed metadata entry normalizes to no steering support; a steer request sends exactly the observed `{ sessionId, prompt: [{ type: "text", text }] }` to the advertised method; capability denial, no active prompt, and a closed session reject without a wire request; errors propagate unchanged; fake-agent tests prove acceptance, denial, and failure paths; no interrupt or queue behavior is claimed.

- **7B. Live steering characterization - BLOCKED / DEFERRED** - Do not mark complete. Original acceptance remains: with a disposable credential and a writable Reasonix home, send a steer during an active prompt and record whether the active prompt is interrupted, the steer queues behind it, or behavior differs by model. Blocker: no valid disposable credential is available and there is no writable Reasonix home in the current environment. Resume only after both are available and the live test actually passes. This remains required before Feature 7 completion or any interrupt or queue claim.

## Workflow engine and storage

- [x] 8. **Workflow and skill definition model** - Versioned, validated definitions for workflows, steps, skills, approval points, and error policy, with tests for malformed input; the model belongs to Domino and imports nothing from an external definition format yet.
- [x] 9. **Workflow engine core** - Define the application-owned persistence contracts, then execute a definition against `AgentRuntime` step by step on an in-memory implementation of them, with step and run state, retry policy, and recorded history; workflow pause, continue, and cancel are run operations, kept distinct from a Reasonix session resume. Acceptance includes per-operation containment: before each runtime step, the resolved working path, including symlink targets, must remain inside the supplied workspace root, and the step is refused otherwise. Pause semantics are acceptance too: between steps, pause takes effect before the next step starts; during a step, the request is recorded and that step finishes with no next step started. Pause never interrupts an active Reasonix prompt. Acceptance also includes runtime binding: a run binds an opaque `runtimeProfileId` string, and the engine sees only `AgentRuntime`, with no provider, model, or credential knowledge.
- [x] 10. **SQLite persistence** - Implement the persistence contracts from feature 9 with SQLite for definitions, projects, runs, step runs, approvals, session links, and retained events, so run state and history survive an app restart; the SQLite driver, migration approach, schema, and event retention policy are decided here, and the engine never imports the SQLite layer. Acceptance includes startup reconciliation: on boot, runs that were active when the process stopped are marked `interrupted`, their step states and history are preserved, and nothing implies automatic continuation. Automated tests load persisted active runs as if after a process restart and assert the interrupted result, so the restart claim is proved here rather than in the end-to-end slice. The persistence interface keeps runtime profile references opaque; 11A adds the non-secret profile table and migration. No credential value is stored.
- [x] 11. **Project registration and configuration** - Register a workspace as a Project with a stable Domino id, workspace root, project configuration, and selected workflow and skill versions. Acceptance is registration-time validation: the root must exist and be a directory, it is canonicalized with symlinks resolved before storage, a registered project persists across restarts, an invalid root is rejected, and a second project can select the same workflow definition unchanged. Runtime containment is not re-implemented here. A project stores an optional opaque default runtime profile reference; 11A validates it against the profile table.
- [ ] 11A. **Reasonix provider, model, and credential settings** - Add a non-secret RuntimeProfile and its migration on feature 10's persistence interface, plus a write-only store for Reasonix's official `<Reasonix home>/.env`, with atomic, locked, symlink-safe writes that preserve existing keys and refuse malformed files. The initial Settings screen selects existing Reasonix providers and models, enters a write-only key, shows credential status and every profile sharing the same `api_key_env`, and runs a real ACP `session/prompt` connection test in a read-only, no-tool, empty workspace. It also validates a project's optional default profile. Connection-test acceptance waits for features 3 and 4. Acceptance: no secret in SQLite, workflow, run snapshot, event, log, error response, or Git; `doctor` and `session/new` alone do not prove connection; unit and integration tests run with a fake provider and temporary Reasonix home; a disposable live key proves the real path; Feature 3 stays open until its own live criteria pass; Windows and macOS are not claimed until tested on those systems; no internal Reasonix API and no new dependency.
  - [x] Stage 1: **Contracts** - `RuntimeProfile`, `CredentialRef`, and write-only `CredentialStore` with validation; no secret fields and no readback. Acceptance: validation rejects forbidden secret-bearing fields and readback; 19 focused tests. Commit `f99b40d`. No later stage is required for this unit.
  - [x] Stage 2/2.1: **Credential file store** - `ReasonixEnvFileStore` for `<Reasonix home>/.env`; atomic, locked, symlink-safe writes; parser compatibility and security hardening; tests use temporary homes and synthetic secrets. Acceptance: temp-home tests cover missing/updated/removed keys, preservation, malformed refusals, symlinks, permissions, stale locks, external conflicts, and cleanup; 46 focused tests. Commit `0b7136a`. Depends on Stage 1.
  - [x] Stage 3: **Provider/model catalog** - Read-only metadata from `reasonix doctor --json`; credential presence only; no connection-validity claim. Acceptance: only provider/model/apiKeyEnv/credentialStatus/default metadata is returned; secret-like fields are ignored; malformed output and command failures are typed; 18 focused tests. Commit `982356f`. Depends on Stage 1.
  - [x] Stage 4: **Runtime Profile persistence and migration** - Persist and reconstruct non-secret profile metadata through the existing persistence architecture. Acceptance: temporary-database tests cover create, retrieve, update, credentialRef reconstruction, invalid data, duplicate IDs, migration, repeated startup, and no secret values. Commit `aa3e78b`. Depends on Stage 1 and Features 9 and 10.
  - [x] Stage 5: **Settings API** - Server-side JSON endpoints for the provider/model catalog, profile create/list/update, and write-only credential set/remove/status. `api_key_env` comes from the catalog, errors are typed and non-secret, and no endpoint reads a credential back. Acceptance: `listRuntimeProfiles` joins the persistence contract with temporary-database tests; service and route-handler tests use a fake catalog, a temporary SQLite database, and a temporary Reasonix home; no secret appears in a response or error; `/api` paths bypass the locale proxy; full tests and typecheck pass. Depends on Stage 4 and Feature 4.
  - [ ] Stage 6: **Settings screen** - The initial Settings screen: existing Reasonix providers and models, write-only key entry, credential status, and every profile sharing the same `api_key_env`, localized in English and Persian RTL with light and dark themes. Acceptance: it uses the Stage 5 API, strings come from the typed catalog, and no credential value is rendered or logged. Depends on Stage 5. The missing shadcn/ui and form-validation dependencies are decided here, because 11A forbids unneeded dependencies.
  - [ ] Stage 7: **Test Connection** - Run an ACP `session/prompt` against a read-only, no-tool, empty workspace with the selected profile and show a typed success or failure. Acceptance: the code path is exercised with a fake runtime; live proof from the installed Reasonix CLI stays blocked by 3B and must not be claimed before 3B passes. Depends on Stage 5, Feature 4, and 3B.
  - [ ] Stage 8: **Project default-profile integration** - Set, clear, and validate a project's optional default runtime profile id against persisted profiles. Acceptance: an unknown profile id is rejected, the stored reference stays opaque, and temporary-database tests cover set, clear, and invalid ids. Depends on Stage 5.
  - These stages are reviewable implementation units; Feature 11A is not complete while Stages 5 to 8 remain open.

## Blueprint and skill integration

- [ ] 12. **Blueprint compatibility assessment** - Evidence-based review of the Blueprint definition format, licensing, and semantics, recorded as a decision before any import or mapping code, and before anything assumes Blueprint definitions can be imported without semantic changes.
- [ ] 13. **Skill delivery proof and central library** - Load a selected Skill from Domino's central versioned library and deliver it to the Reasonix agent through a verified ACP-compatible mechanism. Acceptance: a small observable task demonstrably uses the delivered instructions, and the target project's file tree is unchanged by any permanent Skill install. The mechanism stays open until this proof provides evidence, and no desktop or CLI capability is assumed to work through ACP without it.

## Dashboard

- [ ] 14. **Minimal run dashboard** - Start a workflow against a registered project, watch live events, pause and continue a run, cancel a run, answer approval requests, and read results over a server-side event stream; the transport choice, SSE suggested, and its reconnect behavior are decided here. Build the screens from shadcn/ui default components, localized through the existing catalog in English and Persian RTL, with light and dark themes and Zod-validated forms where schema validation is needed. Fold the initial Settings screen from 11A into the final dashboard without duplicating the credential store.
- [ ] 15. **Server and approval safety controls** - Bind the server to loopback only by default, reject state-changing requests from an unapproved cross-origin context, bind each approval to the exact run and step it was raised for, and redact secrets in logs and event views. No authentication or hosted-mode scope. Apply the same redaction to API responses and the settings flow.

## MVP acceptance

- [ ] 16. **End-to-end MVP slice** - Run a three-step workflow with one approval pause against the real Reasonix runtime. Reload the page while the run is paused and confirm its persisted state and history, then continue, complete the run, and reload again to confirm the final result. This is a page-reload test only; restart reconciliation is covered by feature 10's automated tests, and no cross-process recovery is implied. Use the default Reasonix runtime profile from 11A.

## Later, not in the MVP

These are post-MVP extension candidates, not commitments to build immediately
after the MVP. A Reasonix capability is not assumed to work through ACP until it
is verified through the exact path Domino uses, and no browser or MCP dependency
is added before a concrete requirement justifies it.

They stay out until the adapter, engine, and one real workflow are proven:

- a second runtime adapter, to prove the boundary actually generalizes
- custom provider creation or editing
- a Domino-owned credential store
- Claude provider support validated end to end, plus provider/model selection beyond existing Reasonix providers and the vision capability check
- MCP tool integration
- Playwright browsing plus screenshot and image analysis
- concurrent runs, scheduling, and queueing
- concurrent sessions and interleaved prompts on the same runtime
- full recovery and continuation of an interrupted workflow after the Domino process restarts
- advanced agent control beyond steering
- export or sync of definitions into target project files, opt-in
- bidirectional Git synchronization
- multi-user auth, accounts, and hosted mode
- parallel or conditional workflow steps
- packaging and release automation
