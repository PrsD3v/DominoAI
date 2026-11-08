# DominoAI - Project Overview

<!-- blueprint:source-hash b6bd6bd507e8427f127528ce7e73d991a234e5e994d22958fce525f3a6d063c2 -->

> A local-first workflow control layer for AI coding agents, open source under MIT.

## Problem

AI coding agents can write code, but running one as a repeatable process is still
manual: skills and prompts get copied into every project, step state is invisible,
and long runs are restarted by hand. Domino sits between the operator and an agent
runtime, defining the workflow, deciding the next step, pausing for approval, and
recording what happened.

Architecture principle: **workflow control belongs to Domino; task execution
belongs to the runtime.** The dashboard is an operations console over a workflow
engine, not a chat UI.

## Users

- **Solo developer (primary)** - already runs a local CLI agent such as Reasonix
  and wants a repeatable multi-step workflow with pause and continue, without a
  hosted service.
- **Small team (future potential, not supported in the MVP)** - a shared,
  versioned workflow and skill library, still local. The MVP is single-user.
- **Not targeted initially** - non-technical users, enterprise compliance buyers,
  hosted multi-tenant operators.
- Users supply their own runtime binary and model API key; Domino does not sell
  or proxy inference.

## Usage model

- One trusted operator on their own machine, in their own trust domain.
- Not internet-facing, no accounts, single-user, no multi-tenancy.
- The workspace allowlist and containment derive from registered projects and
  constrain filesystem paths Domino controls.
- Containment has two moments: registration validates and canonicalizes the root,
  and every runtime step re-checks that its resolved path, including symlink
  targets, stays inside that canonical root before executing.
- These checks do not sandbox arbitrary shell commands the runtime chooses to run,
  and they do not guarantee operating-system-level isolation; the runtime still
  acts with the operator's operating-system permissions.
- Agent output, imported skill text, and future tool results are data, never
  authorization to widen the workspace or permission scope. MCP is outside the MVP.
- API keys and session transcripts are secrets: never logged, never stored in
  SQLite, workflow definitions, run records, events, logs, API responses, or
  project files, and never sent anywhere except the configured provider. Domino
  may write a key only to the runtime's official credential file after explicit
  user action, and it never reads the key back.
- Not established, therefore not assumed: scale, availability targets,
  compliance, audit retention, tenant isolation, billing.

## Features

Build order, MVP only. Status reflects the checkboxes in
`blueprint/build-plan.md`. Headline work: the Reasonix ACP adapter plus the
runtime-independent workflow engine.

1. **Runtime contracts and adapter test harness** - implemented: runtime-independent `AgentRuntime`, `Session`, `PromptResult`, and `RuntimeEvent` plus a fake runtime; no ACP-specific types and no concrete persistence.
2. **ACP transport and process lifecycle** - implemented: Reasonix CLI over stdio with JSON-RPC framing, pending requests, timeouts, and crash or shutdown handling.
3. **Handshake, capability discovery, session lifecycle** - open. 3A implemented: `initialize`, capability reporting, and idempotent fake session create and close. 3B BLOCKED / DEFERRED: live `initialize`, `session/new`, and `session/close` are unproven without a disposable credential and writable Reasonix home.
4. **Prompt execution and event normalization** - implemented: streamed updates become normalized runtime events; stop reasons are preserved.
5. **Cancel and failure safety** - implemented: a verified cancelled result, and EOF, crash, or timeout ending pending work instead of hanging it.
6. **Resume, load, and list** - open. 6A implemented: capability-gated `session/resume`, `session/load`, and `session/list`; `load` replays normalized history while `resume` does not; a live `session/list` passes. 6B BLOCKED / DEFERRED: no live resume or load claim.
7. **Optional steering** - open. 7A implemented: the advertised method comes from runtime metadata, steering is capability-gated, and denial and failure paths are typed. 7B BLOCKED / DEFERRED: interrupt versus queue is unproven.
8. **Workflow and skill definition model** - implemented: versioned and validated, owned by Domino, importing nothing from an external format yet.
9. **Workflow engine core** - implemented: persistence contracts and an in-memory implementation; pause, continue, and cancel are run operations; each step re-checks containment; a run binds an opaque `runtimeProfileId`, never a provider, model, or credential.
10. **SQLite persistence** - implemented: the same contracts behind SQLite plus startup reconciliation; tests load persisted active runs as if after a restart and assert `interrupted` with history intact.
11. **Project registration and configuration** - implemented: registration-time validation and canonicalization of the workspace root, selected definition versions, and an optional opaque default runtime profile reference validated by 11A.
11A. **Reasonix provider, model, and credential settings** - open. Stages 1-3 implemented: non-secret `RuntimeProfile`, `CredentialRef`, write-only `CredentialStore`, atomic locked symlink-safe `<Reasonix home>/.env` writes, and a metadata-only catalog from `reasonix doctor --json`. Stage 4 implemented: profile persistence and migration. Stage 5 implemented: catalog, profile, and write-only credential endpoints with typed non-secret errors. Stage 6 implemented: Settings screen on shadcn/ui defaults, English and Persian RTL. Stage 7 implemented with a fake runtime; the real connection test depends on 3B. Stage 8 implemented: opaque project default-profile set, clear, and validation. 11A stays open only for the live connection proof.
12. **Blueprint compatibility assessment** - implemented: an evidence-based decision in `docs/blueprint-compatibility.md`; Blueprint definitions are not consumed as-is and no importer is built, though skill text may be copied manually into a SkillVersion with review.
13. **Skill delivery proof and central library** - open. 13A implemented: published skill versions resolve from the central library, compose in declared order, and travel over `session/prompt` without writing into the target project; missing or duplicate versions fail before a session; the run pins delivered ids. 13B BLOCKED / DEFERRED: no live claim that delivered instructions influence the model.
14. **Minimal run dashboard** - implemented. 14A: run orchestration bound to a registered project and default profile, Projects and definition read APIs, run list/detail/control APIs, approval waiting and answering, and SSE with snapshot-on-reconnect; rejecting an approval cancels the run. 14B: dashboard shell plus Projects, Workflows, run list, run detail, live events, pause/continue, cancel, and approvals, with Settings folded in; English and Persian RTL, light and dark themes, accessible controls.
15. **Server and approval safety controls** - open: active spec written (eight steps), no implementation. Loopback binding, cross-origin mutation rejection, approvals bound to one run and one step, and secret redaction in logs, event views, API responses, and settings.
16. **End-to-end MVP slice** - not implemented: a three-step run with an approval pause against the real runtime, page reload while paused, then completion and a second reload. Page reload only; the restart case belongs to feature 10.

Every ACP capability claim needs repeatable test evidence from the installed
Reasonix version; `resume` and `load` stay distinct. The live scenarios (3B, 6B,
7B, 13B, and the real 11A connection test) remain blocked by the same missing
disposable credential and writable Reasonix home.

### Deferred, explicitly not MVP

Second runtime adapter, custom provider creation or editing, a Domino-owned
credential store, validated Claude provider support, MCP, Playwright and image
analysis, concurrent or scheduled runs, multi-user auth and hosted mode, parallel
or conditional steps, full recovery of an interrupted workflow after a Domino
restart, export or Git sync of definitions, PostgreSQL, packaging.

## Data model

Derived from project-plan.md section 4. Field names and the status vocabulary are
proposed here. The engine talks only to the persistence interface, never SQLite.

### Project

- `id` (string) - stable Domino identifier
- `name` (string) - display name
- `workspaceRoot` (absolute canonical path, symlinks resolved) - the runtime cwd;
  fixed by registration-time validation
- `configuration` (JSON) - project-specific settings
- optional default runtime profile id (opaque string; validated by 11A; never a
  credential)
- selected workflow version ids and selected skill version ids
- `createdAt`, `updatedAt` (ISO-8601)
- has many `WorkflowRun`

### RuntimeProfile and CredentialRef

- `RuntimeProfile`: `id`, `label`, `adapterId` (`reasonix`), `providerName`,
  `model`, `apiKeyEnv`, `credentialRef`, `createdAt`, `updatedAt`
- `CredentialRef`: `kind` (`reasonix-env`), `providerName`, `apiKeyEnv`; it
  points to a runtime-owned credential and never contains a key value
- Stage 4 of 11A persists this non-secret profile metadata through the
  persistence interface and SQLite layer. No credential value belongs in this
  model.

### WorkflowDefinition and WorkflowVersion

- `WorkflowDefinition`: `id`, `name`
- `WorkflowVersion`: `id`, `definitionId`, `version` (integer), `steps`,
  `approvalPoints`, `errorPolicy`, `publishedAt`
- published versions are immutable; editing creates a new version
- a step carries at least a key, the skill versions it uses, its approval point,
  and its error policy

### SkillDefinition and SkillVersion

- `SkillDefinition`: `id`, `name`
- `SkillVersion`: `id`, `skillDefinitionId`, `version`, `content` (markdown),
  `publishedAt`
- published versions are immutable and referenced by workflow versions

### WorkflowRun

- `id` (string)
- `projectId` to `Project`
- `workflowVersionId` to `WorkflowVersion`, pinned at start
- `skillVersionIds`, pinned at start
- `runtimeProfileId` (opaque) and pinned non-secret profile metadata; never a
  credential
- `status`: `pending`, `running`, `paused`, `waiting_approval`, `completed`,
  `failed`, `cancelled`, `interrupted`
- `startedAt`, `finishedAt`
- has many `StepRun`, `ApprovalRequest`, `RuntimeSessionRef`, `RuntimeEventRecord`

### StepRun

- `id`, `runId` to `WorkflowRun`, `stepKey`
- `status` (same vocabulary, scoped to one step)
- `attempt` (integer), `result` (JSON), `error` (string or null)
- `startedAt`, `finishedAt`

### ApprovalRequest

- `id`, `runId`, `stepRunId`
- `requestedAt`, `decision` (`approved`, `rejected`, or pending), `decidedAt`
- bound to exactly one run and one step; it cannot authorize another one

### RuntimeSessionRef

- `id`, `runId`, `stepRunId`
- `runtime` (for example `reasonix`), `runtimeSessionId`, `cwd`
- deliberately a different identifier from the workflow run id

### RuntimeEventRecord

- `id`, `runId`, `stepRunId`
- `type` (normalized event type), `payload` (JSON), `createdAt`
- retention policy is decided in feature 10

> Lock these rules now: run ids, session ids, and version ids never conflate, and
> a run keeps the versions it started with.

## Tech stack

- **Next.js 16 App Router, React 19, TypeScript strict** - the application and its
  server routes
- **Tailwind CSS v4** - CSS-first theme with light and dark tokens, no config file
- **shadcn/ui** - installed; default components are used as-is and never edited
  under `components/ui/`
- **Zod** - schema validation when a form needs it; React Hook Form only when
  complexity justifies it; neither is installed yet
- **Localization** - typed English and Persian catalogs, English default, Persian
  RTL, cookie switcher
- **Node.js 24, npm** - runtime and package manager
- **Reasonix CLI v2.54.0 over ACP** - the first agent runtime, reached over stdio
- **Model provider** - provider-agnostic; `deepseek/deepseek-flash` in development
- **Credential handling** - existing Reasonix providers/models; a write-only
  `<Reasonix home>/.env` store; no Domino credential store and no new dependency
- **Vitest** - test runner
- **SQLite** - initial storage, behind an application-owned persistence interface
- **MIT license** - `LICENSE` at the repository root
- **ACP contract record** - `docs/reasonix-acp-contract.md`, with verified and
  unverified capabilities

## Monetization

None, deliberately. MIT license, open source distribution, no paid tier, no
paywall, no telemetry resale, no usage metering. The user runs Domino locally with
their own runtime and API key, so inference and compute costs are theirs.

Constraints that follow: no feature may require a Domino-hosted account, server,
or network call, and no user code, prompt content, API key, or transcript may
leave the machine through Domino. Sustainability ideas (sponsorships, paid
support, an optional commercial hosted offering) are additive and uncommitted.

## UI/UX

An operations console, dense and information-first, monospace for event text.
Status is never conveyed by color alone. Screen names are fixed; routes are not
decided.

- Workflow list - definitions, active version, last run and outcome
- Projects - registered workspaces and their selected definition versions
- Run detail - step timeline, live events, elapsed time, approval prompt
- Session view - runtime sessions with status, workspace, and title
- Skill and workflow editor - versioned definitions and validation errors
- Settings - runtime binary path, workspace allowlist, existing Reasonix provider
  and model selection, a write-only API key field, credential status, every
  profile sharing the same `api_key_env`, and a real connection test; folded into
  the dashboard by feature 14 without a second credential store

Every stop, cancel, and approval action names the run and step it affects. A
cancelled or interrupted run is visually distinct from a completed one,
failures show the runtime's real error, and the interface is keyboard reachable
because the audience is developers.

### Language and direction

- English is the default locale; Persian renders RTL from the same layout, using
  logical spacing utilities. There are no duplicated per-language screens.
- A runtime language switcher preserves the current route and keeps the choice in
  a cookie across reloads.
- Labels, statuses, approval controls, validation messages, and errors are
  localized.
- Raw agent output, terminal output, code, file paths, commands, identifiers, and
  protocol payloads stay unchanged; the original technical message is kept next
  to any localized explanation.

### Components and forms

- shadcn/ui defaults are used as-is and reused before adding a new one; nothing
  under `components/ui/` is edited or forked. Missing components arrive via the
  CLI. Custom layout uses page composition, wrappers, Tailwind, and CSS variables.
- Simple forms use native React handling; Zod when schema validation is needed;
  React Hook Form only when complexity justifies it.

### Theme and references

- Both light and dark mode are supported through the existing semantic tokens and
  `prefers-color-scheme`; no theme provider or `.dark` toggle is added.
- UI reference images may arrive later. Store them in `blueprint/reference/` and
  build from the image rather than from prose.

## Control operations

Three operations are distinct and stay separate in the engine, the adapter, and
the UI.

| Operation | Owner | Meaning |
| --- | --- | --- |
| Workflow pause and continue | Workflow Engine | Between steps, pause takes effect before the next step. During a step, the request is recorded and that step finishes; no next step starts. It does not interrupt an active Reasonix prompt. |
| Workflow cancel | Workflow Engine | End the run as cancelled, preserving the step state reached. |
| Reasonix session resume | Runtime adapter | Reattach to a runtime session, with or without history replay. |

Pause and continue work only while the Domino process stays alive; stronger
interruption needs a separately verified runtime capability and is outside the
MVP. On startup, runs active when the process stopped are marked `interrupted`,
with state and history preserved and no implied continuation.

## Deployment

- **Target** - the developer's own machine, next to the project it operates on
- **App type** - Node server (Next.js server runtime); static export cannot run
  the ACP adapter or stream events
- **Build / start** - `npm run build`, `npm run start`; loopback binding arrives
  with feature 15
- **Env vars, by name** - runtime binary path, workspace allowlist, storage path,
  provider variable names; values are never committed
- **Storage** - one local SQLite file; no database server
- **Workers** - the adapter child process; no separate worker
- **Health path** - > TODO; SSE is chosen, the endpoint is not
- **Domain** - none; localhost, loopback only by default
- **Packaging** - > TODO (npm package, npx, or clone and run)

## Post-MVP extension candidates

Candidates, not commitments; they are not scheduled to follow the MVP directly.

- Domino owns orchestration, step state, approvals, permissions, and history; the
  runtime executes agent tasks.
- Future browser interaction and image analysis may come through runtime-native
  tools or a separate tool provider; viability is unknown until verified.
- A Reasonix capability is not assumed to work through ACP until verified through
  the exact path Domino uses, and no browser, MCP, or image-analysis dependency is
  added before a concrete post-MVP requirement justifies it.
- Future tool integrations must not expand workspace access or permissions based
  on agent output or tool results.

Browser automation, Playwright, screenshot capture, image analysis, and MCP remain
outside the MVP.

## Open decisions

Still open, each assigned to the feature that settles it.

1. Packaging and install path - post-MVP, with release automation.
2. Credential file path, permissions, and atomic replacement on Windows and macOS
   - 11A; not claimed until tested on those systems.
3. Connection test cost, timeout, and error categories - 11A; live proof is
   blocked by 3B.
4. Health check path - SSE is chosen, the endpoint is not.

Resolved by implementation: skill content reaches the runtime inline over
`session/prompt` (13A); the dashboard uses SSE with a snapshot on reconnect
(14A); Blueprint definitions are not imported as-is (12); the theme follows
`prefers-color-scheme` with no toggle (14B).

## Open questions

> Plan contradictions found while regenerating this overview. Resolve them in the
> plans, then re-run `/overview`. Delete this section when empty.

- `project-plan.md` section 3 "Delivery status" is stale: it says 11A Stage 4 is
  blocked until Features 9 and 10 exist and that the API, Settings UI, real
  connection test, and project default-profile integration remain open, while
  `build-plan.md` records Stages 4 to 8 implemented.
- `project-plan.md` section 5 is stale: shadcn/ui is listed as "planned in 11A
  Stage 6" though it is installed, and the persistence row says the driver,
  migrations, and schema are undecided though feature 10 settled them.
- `project-plan.md` section 10 still lists as open the event transport and theme
  decisions that features 14A and 14B settled, and describes skill delivery as
  pending feature 13 though 13A chose inline ACP prompt delivery.
- `build-plan.md` says "Feature 11A is not complete while Stages 5 to 8 remain
  open"; all four are now checked, so that sentence is obsolete. 11A is still
  legitimately open for the live connection proof that depends on 3B.
