# DominoAI - Project Overview

<!-- blueprint:source-hash 68c38c68d9617d62e72fdd04aba2f1709902df8e8bb9d6374a2a73dbada20ef5 -->

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
  constrain filesystem paths Domino controls. The runtime edits real files.
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

Build order, MVP only. Headline work: the Reasonix ACP adapter plus the
runtime-independent workflow engine. Status reflects the checkboxes in
`blueprint/build-plan.md`.

1. **Runtime contracts and adapter test harness** - implemented: runtime-independent
   `AgentRuntime`, `Session`, `PromptResult`, and `RuntimeEvent` contracts plus a
   fake runtime; no Reasonix-specific ACP types and no concrete persistence.
2. **ACP transport and process lifecycle** - implemented: the Reasonix CLI over
   stdio with JSON-RPC framing, pending requests, timeouts, and crash or shutdown
   handling.
3. **Handshake, capability discovery, session lifecycle** - open, split in two:
   - **3A Local handshake and session lifecycle** - implemented and locally
     tested: `initialize`, capability reporting, and idempotent fake session
     create and close; live create and close are unproven.
   - **3B Live Reasonix runtime verification - BLOCKED / DEFERRED** - needs a
     disposable credential and a writable Reasonix home; live `initialize`,
     `session/new`, and `session/close` stay unproven.
4. **Prompt execution and event normalization** - implemented: streamed updates
   become normalized runtime events; stop reasons are preserved.
5. **Cancel and failure safety** - implemented: a verified cancelled result, and
   EOF, crash, or timeout ending pending work instead of hanging it.
6. **Resume, load, and list** - open, split in two:
   - **6A Resume, load, and list adapter** - implemented: capability-gated
     `session/resume`, `session/load`, and `session/list`; `load` replays
     normalized history while `resume` does not; a live `session/list` passes.
   - **6B Live Reasonix resume and load verification - BLOCKED / DEFERRED** -
     same live prerequisites as 3B; no live resume or load claim.
7. **Optional steering** - open, split in two:
   - **7A Steering discovery and optional capability** - implemented: the
     advertised method is read from runtime metadata and steering is an optional,
     capability-gated session operation; denial and failure paths are typed.
   - **7B Live steering characterization - BLOCKED / DEFERRED** - interrupt
     versus queue stays unproven pending the same prerequisites.
8. **Workflow and skill definition model** - implemented: versioned and
   validated, owned by Domino, importing nothing from an external format yet.
9. **Workflow engine core** - implemented: the persistence contracts and an
   in-memory implementation; pause, continue, and cancel are run operations; each
   step re-checks containment; a run binds an opaque `runtimeProfileId`, never a
   provider, model, or credential.
10. **SQLite persistence** - implemented: the same contracts behind SQLite, plus
    startup reconciliation. Automated tests load persisted active runs as if
    after a restart and assert they become `interrupted` with their history
    intact.
11. **Project registration and configuration** - implemented: registration-time
    validation and canonicalization of the workspace root, plus selected
    definition versions. A project may hold an optional opaque default runtime
    profile reference, validated by 11A.
11A. **Reasonix provider, model, and credential settings** - open; each stage is
    a reviewable implementation unit:
    - **Stage 1 Contracts** - implemented: non-secret `RuntimeProfile`,
      `CredentialRef`, and write-only `CredentialStore`.
    - **Stage 2/2.1 Credential file store** - implemented: atomic, locked,
      symlink-safe writes to `<Reasonix home>/.env`.
    - **Stage 3 Provider/model catalog** - implemented: read-only metadata from
      `reasonix doctor --json`; credential presence only, no connection claim.
    - **Stage 4 Persistence and migration** - implemented: non-secret profile
      metadata through the persistence interface and SQLite layer.
    - **Stage 5 Settings API** - implemented: catalog, profile
      create/list/update, and write-only credential set/remove/status endpoints;
      typed, non-secret errors.
    - **Stage 6 Settings screen** - implemented: the initial Settings screen on
      the Stage 5 API, shadcn/ui defaults, English and Persian RTL, light and
      dark themes.
    - **Stage 7 Test Connection** - implemented with a fake runtime and a typed
      result; the real connection test still depends on 3B and is not claimed.
    - **Stage 8 Project default-profile integration** - not implemented: set,
      clear, and validate a project's optional default profile id against
      persisted profiles.
    - Feature 11A is not complete while Stage 8 remains open.
12. **Blueprint compatibility assessment** - not implemented: an evidence-based
    decision before any import or mapping is assumed.
13. **Skill delivery proof and central library** - not implemented: instructions
    reach the agent through a verified ACP path, and the target project tree is
    unchanged by any permanent Skill install.
14. **Minimal run dashboard** - not implemented: start against a registered
    project, watch events, pause or continue, cancel, answer approvals; shadcn/ui
    defaults, English and Persian RTL, light and dark themes, Zod-validated forms
    where needed. Folds in the 11A Settings screen without a second credential
    store.
15. **Server and approval safety controls** - not implemented: loopback binding,
    cross-origin mutation rejection, approvals bound to one run and step, and
    secret redaction in logs, event views, API responses, and the settings flow.
16. **End-to-end MVP slice** - not implemented: a three-step run with an approval
    pause against the real runtime, page reload while paused, then completion and
    a second reload. Page reload only; the restart case belongs to feature 10.

Every ACP capability claim needs repeatable test evidence from the installed
Reasonix version; `resume` and `load` stay distinct.

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
- **shadcn/ui** - component library; default components are used as-is and never
  edited under `components/ui/`
- **Zod** - schema validation when a form needs it; React Hook Form only when
  complexity justifies it
- **Localization** - typed English and Persian catalogs, English default, Persian
  RTL, cookie switcher
- **Node.js 24, npm** - runtime and package manager
- **Reasonix CLI v2.54.0 over ACP** - the first agent runtime, reached over stdio
- **Model provider** - provider-agnostic; `deepseek/deepseek-flash` in development
- **Credential handling** - existing Reasonix providers/models; a write-only
  `<Reasonix home>/.env` store; no Domino credential store in the MVP and no new
  dependency
- **Vitest** - test runner, already configured
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
leave the machine through Domino. Optional sustainability ideas (sponsorships,
paid support, an optional commercial hosted offering) are additive and
uncommitted.

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
  profile sharing the same `api_key_env`, and a real connection test; feature 14
  folds this screen into the dashboard

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

- Both light and dark mode are supported; the current shell follows the OS scheme
  through `prefers-color-scheme`.
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
- **Build / start** - `npm run build`, `npm run start`
- **Env vars, by name** - runtime binary path, workspace allowlist, storage path,
  provider variable names; values are never committed
- **Storage** - one local SQLite file; no database server
- **Workers** - the adapter child process; no separate worker
- **Health path** - > TODO, decided with the event transport
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

Each is assigned to the feature that settles it.

1. How skill content reaches the runtime without a permanent project install -
   feature 13
2. Dashboard event transport and reconnect behavior, SSE suggested - feature 14
3. Whether Blueprint definitions are consumed as-is or mapped - feature 12
4. Packaging and install path - post-MVP, with release automation
5. Whether the theme follows the OS only or exposes an explicit light/dark toggle
   - feature 14
6. Credential file path, permissions, and atomic replacement on Windows and macOS
   - feature 11A
7. Connection test cost, timeout, and error categories - feature 11A

## Open questions

- `project-plan.md` section 3 "Delivery status" is stale: it calls 11A Stage 4
  blocked and the API, Settings UI, and connection test open, while the build plan
  records Stages 4 to 7 implemented. Fix the plan, then re-run `/overview`.
