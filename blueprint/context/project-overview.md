# DominoAI - Project Overview

<!-- blueprint:source-hash 89cb346094216f8b7daf45997cb3a831206e26feb5c80387af3d51ec26fe2a1a -->

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
- **Small team (future potential audience, not supported in the MVP)** - a shared,
  versioned workflow and skill library, still local. The MVP is single-user with
  no accounts, multi-user auth, or hosted mode.
- **Not targeted initially** - non-technical users, enterprise compliance buyers,
  hosted multi-tenant operators.
- Users supply their own runtime binary and own model API key. Domino does not
  sell or proxy inference.

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
- Model output, agent output, imported skill text, and results from future tool
  integrations such as MCP are data, never authorization to widen the workspace or
  permission scope. MCP itself is outside the MVP.
- API keys and session transcripts are secrets: never logged, never stored in
  SQLite, workflow definitions, run records, events, logs, API responses, or
  project files, and never sent anywhere except the configured provider. Domino
  may write a key only to the runtime's official credential file after explicit
  user action, and it never reads the key back.
- Not established, therefore not assumed: scale, availability targets,
  compliance, audit retention, tenant isolation, billing.

## Features

Build order, MVP only. Headline work: the Reasonix ACP adapter plus the
runtime-independent workflow engine.

1. **Runtime contracts and adapter test harness** - extend the existing Vitest
   setup with Domino-owned, runtime-independent `AgentRuntime`, `Session`,
   `PromptResult`, and `RuntimeEvent` contracts, plus a fake runtime. The public
   types expose no Reasonix-specific ACP methods or raw ACP structures and depend
   on no concrete persistence.
2. **ACP transport and process lifecycle** - the Reasonix CLI over stdio with
   JSON-RPC framing, pending requests, timeouts, and crash or shutdown handling.
3. **Handshake, capability discovery, session lifecycle** - the original feature
   is split into two stages:
   - **3A Local handshake and session lifecycle** - implemented and locally
     tested: `initialize`, capability reporting, fake session create and close,
     and idempotent close. Live session creation and close are not proven.
   - **3B Live Reasonix runtime verification - BLOCKED / DEFERRED** - keep open;
     requires a valid, disposable credential and a writable Reasonix home.
     Original acceptance remains: live `initialize`, `session/new`, and
     `session/close`; a prompt only if needed to prove runtime behavior; no
     production secret and no unverified claim. Keep outside the selectable
     checklist until both prerequisites exist.
4. **Prompt execution and event normalization** - streamed updates become
   normalized runtime events; stop reasons are preserved.
5. **Cancel and failure safety** - a verified cancelled result, and EOF, crash, or
   timeout ending pending work instead of hanging it.
6. **Resume, load, and list** - continuing a Reasonix session and replaying its
   history stay distinct, each with observable tests establishing its semantics
   against the installed Reasonix version.
7. **Optional steering** - split into two stages:
   - **7A Steering discovery and optional capability** - the advertised method is
     read from runtime metadata and steering is an optional, capability-gated
     session operation.
   - **7B Live steering characterization - BLOCKED / DEFERRED** - interrupt
     versus queue stays unproven until a disposable credential and a writable
     Reasonix home exist.
8. **Workflow and skill definition model** - versioned and validated, owned by
   Domino, importing nothing from an external format yet.
9. **Workflow engine core** - defines the persistence contracts and runs on an
   in-memory implementation; pause, continue, and cancel are run operations, each
   step re-checks workspace containment, and pause lets a running step finish
   without starting the next one.
10. **SQLite persistence** - the same contracts behind SQLite, plus startup
    reconciliation. Automated tests load persisted active runs as if after a
    restart and assert they become `interrupted` with their history intact.
11. **Project registration and configuration** - registration-time validation and
    canonicalization of the workspace root, plus selected definition versions.
    A project may hold an optional opaque default runtime profile reference,
    validated by 11A.
11A. **Reasonix provider, model, and credential settings** - one feature with
    explicit stage status:
    - **Stage 1 Contracts** - implemented and committed: non-secret
      `RuntimeProfile`, `CredentialRef`, and write-only `CredentialStore`.
    - **Stage 2/2.1 Credential file store** - implemented and committed:
      atomic, locked, symlink-safe writes to `<Reasonix home>/.env`.
    - **Stage 3 Provider/model catalog** - implemented and committed: read-only
      metadata from `reasonix doctor --json`; credential presence only.
    - **Stage 4 Persistence and migration** - blocked by Features 9 and 10; no
      profile persistence exists in this checkout.
    - **Later** - API, Settings UI, real connection test, and project
      default-profile integration are not implemented.
    Feature 11A remains open. Its real connection test depends on 3B and
    Feature 4.
12. **Blueprint compatibility assessment** - evidence-based decision before any
    import or mapping is assumed.
13. **Skill delivery proof and central library** - instructions reach the agent
    through a verified ACP path; the target project tree stays unchanged.
14. **Minimal run dashboard** - start against a registered project, watch events,
    pause or continue, cancel, answer approvals; built from shadcn/ui defaults and
    localized through the existing catalog in English and Persian RTL, with light
    and dark themes and Zod-validated forms where needed. Event transport and
    reconnect are decided here.
15. **Server and approval safety controls** - loopback binding, cross-origin
    mutation rejection, approvals bound to one run and step, and secret redaction.
16. **End-to-end MVP slice** - a three-step run with an approval pause, page
    reload while paused, then completion and a second reload. Page reload only;
    the restart case belongs to feature 10's tests.

Every claimed ACP capability needs repeatable test evidence from the installed
Reasonix version, and `resume` and `load` stay distinct operations.

### Deferred, explicitly not MVP

Second runtime adapter, custom provider creation or editing, a Domino-owned
credential store, validated Claude provider support, MCP, Playwright and image
analysis, concurrent or scheduled runs, multi-user auth and hosted mode, parallel
or conditional steps, full recovery of an interrupted workflow after a Domino
restart, export or Git sync of definitions, PostgreSQL, packaging.

## Data model

Derived from project-plan.md section 4. Field names and the status vocabulary are
proposed here; the SQLite driver, migration approach, schema, and event retention
policy are decided in feature 10. The engine talks only to the persistence
interface, never to SQLite.

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
- Stage 4 of 11A persists this non-secret profile metadata. It is blocked until
  Features 9 and 10 provide the persistence interface and SQLite layer. No
  credential value belongs in this model.

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

> Lock the identifiers and the pinning rules now: run ids, session ids, and
> version ids must not be conflated, and a run must keep the versions it started
> with.

## Tech stack

- **Next.js 16 App Router, React 19, TypeScript strict** - the application and its
  server routes
- **Tailwind CSS v4** - CSS-first theme with light and dark tokens, no config file
- **shadcn/ui** - component library; default components are used as-is and never
  edited under `components/ui/`
- **Zod** - schema validation when a form needs it; React Hook Form is optional
  and added only when form complexity justifies it
- **Localization** - typed English and Persian catalogs, English default, Persian
  RTL, cookie-backed switcher
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
paid support, an optional commercial hosted offering) are additive and uncommitted.

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

- shadcn/ui default components are used as-is; existing components are reused
  before adding a new one. Nothing under `components/ui/` is edited, forked, or
  replaced. Missing components are added with the CLI.
- Custom layout comes from page-level composition, wrapper components, Tailwind
  utilities, and CSS variables.
- Simple forms use native React handling; Zod defines the schema when
  schema-based validation is needed; React Hook Form is added only when form
  complexity justifies it.

### Theme and references

- Both light and dark mode are supported; the current shell follows the OS scheme
  through `prefers-color-scheme`.
- UI reference images may arrive later. Store them in `blueprint/reference/` and
  build from the image rather than from prose.

### Already in place

Bilingual app shell with English default and Persian RTL, cookie-backed language
switcher, per-language fonts (Vazirmatn and Geist), localized loading, error, and
404 states, and a working Vitest setup.

## Control operations

Three operations are distinct and stay separate in the engine, the adapter, and
the UI.

| Operation | Owner | Meaning |
| --- | --- | --- |
| Workflow pause and continue | Workflow Engine | Between steps, pause takes effect before the next step. During a step, the request is recorded and that step finishes; no next step starts. It does not interrupt an active Reasonix prompt. |
| Workflow cancel | Workflow Engine | End the run as cancelled, preserving the step state reached. |
| Reasonix session resume | Runtime adapter | Reattach to a runtime session, with or without history replay. |

Pause and continue work only while the Domino process stays alive. Stronger
interruption needs a separately verified runtime capability and is outside the
MVP. On startup, runs that were active when the process stopped are marked
`interrupted`; their state and history are preserved and nothing implies
automatic continuation.

## Deployment

- **Target** - the developer's own machine, next to the project it operates on
- **App type** - Node server (Next.js server runtime); static export is
  incompatible with running the ACP adapter or streaming events
- **Build / start** - `npm run build`, `npm run start`
- **Env vars, by name** - runtime binary path, workspace allowlist, storage path,
  provider variable names. Values are never committed
- **Storage** - one local SQLite file owned by the app; no database server
- **Workers** - the adapter child process; no separate worker for the MVP
- **Health path** - > TODO, decided with the event transport
- **Domain** - none; localhost, loopback only by default
- **Packaging** - > TODO (npm package, npx, or clone and run)

## Post-MVP extension candidates

Candidates, not commitments; they are not scheduled to follow the MVP directly.

- Domino owns workflow orchestration, step state, approvals, permissions, and
  history; the runtime executes agent tasks.
- Future browser interaction and image or screenshot analysis may come through
  runtime-native tools or a separately integrated tool provider. Viability is
  unknown until verified.
- A Reasonix CLI capability is not assumed to work through ACP until verified
  through the exact path Domino uses.
- No browser-specific abstraction, Playwright dependency, MCP dependency, or
  image-analysis contract is added before a concrete post-MVP requirement
  justifies it.
- Future tool integrations must not expand workspace access or permissions based
  on agent output or tool results.

Browser automation, Playwright, screenshot capture, image analysis, and MCP remain
outside the MVP.

## Open decisions

Each is assigned to the feature that settles it. None blocks feature 1.

1. SQLite driver, migration approach, and schema details - feature 10
2. Event retention policy for runtime events - feature 10
3. How skill content reaches the runtime without a permanent project install -
   feature 13
4. Dashboard event transport and reconnect behavior, SSE suggested - feature 14
5. Whether Blueprint definitions are consumed as-is or mapped - feature 12
6. Packaging and install path - post-MVP, with release automation
7. Whether the theme follows the OS only or exposes an explicit light/dark toggle
   - feature 14
8. Credential file path, permissions, and atomic replacement on Windows and macOS
   - feature 11A
9. Connection test cost, timeout, and error categories - feature 11A
