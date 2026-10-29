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
- [x] 3A. **Handshake, capability discovery, and session lifecycle (local implementation)** - Implement `initialize` with capability reporting plus session create and close, recording only what the installed runtime reports. Acceptance: protocol version 1 validation; initialized notification; missing or unsupported capabilities normalized to false; session create and close through the fake transport; error propagation; runtime and session close are idempotent; tests prove the local adapter path. The live test remains scaffolding and is not evidence of a successful `session/new` or `session/close` through Domino.
- [ ] 3B. **Live Reasonix runtime verification** - Prove against the installed Reasonix CLI with a valid, disposable credential: successful `initialize`, `session/new`, and `session/close`; use `session/prompt` only if needed to prove the intended runtime behavior. Do not use a production secret and do not record unexecuted behavior as verified. This remains open independently of 3A and is required before Feature 3 completion or the Feature 11A connection test.
- [ ] 4. **Prompt execution and event normalization** - Run `session/prompt`, map streamed updates into normalized runtime events, and handle stop reasons without discarding original event data.
- [ ] 5. **Cancel and failure safety** - Verify `session/cancel` produces a cancelled result, and make EOF, crash, and timeout end pending work instead of hanging it.
- [ ] 6. **Resume, load, and list** - Keep `resume` (continue the session) and `load` (replay history) distinct, with observable tests establishing each semantics against the installed Reasonix version, and expose session summaries from `session/list`.
- [ ] 7. **Optional steering** - Discover the steering method from runtime metadata, expose it as an optional capability, and characterize whether it interrupts the current prompt or queues behind it.

## Workflow engine and storage

- [ ] 8. **Workflow and skill definition model** - Versioned, validated definitions for workflows, steps, skills, approval points, and error policy, with tests for malformed input; the model belongs to Domino and imports nothing from an external definition format yet.
- [ ] 9. **Workflow engine core** - Define the application-owned persistence contracts, then execute a definition against `AgentRuntime` step by step on an in-memory implementation of them, with step and run state, retry policy, and recorded history; workflow pause, continue, and cancel are run operations, kept distinct from a Reasonix session resume. Acceptance includes per-operation containment: before each runtime step, the resolved working path, including symlink targets, must remain inside the supplied workspace root, and the step is refused otherwise. Pause semantics are acceptance too: between steps, pause takes effect before the next step starts; during a step, the request is recorded and that step finishes with no next step started. Pause never interrupts an active Reasonix prompt. Acceptance also includes runtime binding: a run binds an opaque `runtimeProfileId` string, and the engine sees only `AgentRuntime`, with no provider, model, or credential knowledge.
- [ ] 10. **SQLite persistence** - Implement the persistence contracts from feature 9 with SQLite for definitions, projects, runs, step runs, approvals, session links, and retained events, so run state and history survive an app restart; the SQLite driver, migration approach, schema, and event retention policy are decided here, and the engine never imports the SQLite layer. Acceptance includes startup reconciliation: on boot, runs that were active when the process stopped are marked `interrupted`, their step states and history are preserved, and nothing implies automatic continuation. Automated tests load persisted active runs as if after a process restart and assert the interrupted result, so the restart claim is proved here rather than in the end-to-end slice. The persistence interface keeps runtime profile references opaque; 11A adds the non-secret profile table and migration. No credential value is stored.
- [ ] 11. **Project registration and configuration** - Register a workspace as a Project with a stable Domino id, workspace root, project configuration, and selected workflow and skill versions. Acceptance is registration-time validation: the root must exist and be a directory, it is canonicalized with symlinks resolved before storage, a registered project persists across restarts, an invalid root is rejected, and a second project can select the same workflow definition unchanged. Runtime containment is not re-implemented here. A project stores an optional opaque default runtime profile reference; 11A validates it against the profile table.
- [ ] 11A. **Reasonix provider, model, and credential settings** - Add a non-secret RuntimeProfile and its migration on feature 10's persistence interface, plus a write-only store for Reasonix's official `<Reasonix home>/.env`, with atomic, locked, symlink-safe writes that preserve existing keys and refuse malformed files. The initial Settings screen selects existing Reasonix providers and models, enters a write-only key, shows credential status and every profile sharing the same `api_key_env`, and runs a real ACP `session/prompt` connection test in a read-only, no-tool, empty workspace. It also validates a project's optional default profile. Connection-test acceptance waits for features 3 and 4. Acceptance: no secret in SQLite, workflow, run snapshot, event, log, error response, or Git; `doctor` and `session/new` alone do not prove connection; unit and integration tests run with a fake provider and temporary Reasonix home; a disposable live key proves the real path; Feature 3 stays open until its own live criteria pass; Windows and macOS are not claimed until tested on those systems; no internal Reasonix API and no new dependency.
  - [x] Stage 1: **Contracts** - `RuntimeProfile`, `CredentialRef`, and write-only `CredentialStore` with validation; no secret fields and no readback.
  - [x] Stage 2/2.1: **Credential file store** - `ReasonixEnvFileStore` for `<Reasonix home>/.env`; atomic, locked, symlink-safe writes; parser compatibility and security hardening; tests use temporary homes and synthetic secrets.
  - [x] Stage 3: **Provider/model catalog** - Read-only metadata from `reasonix doctor --json`; credential presence only; no connection-validity claim.
  - [ ] Stage 4: **Runtime Profile persistence and migration** - Blocked because Features 9 and 10 (persistence contracts and SQLite implementation) are not present in this checkout. Do not implement them here.
  - [ ] Later stages: API, Settings UI, real Test Connection, and project default-profile integration. Not implemented.
  - These stages are reviewable implementation units; Feature 11A is not complete while Stage 4 and later stages remain open.

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
