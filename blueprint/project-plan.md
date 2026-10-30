# Project Plan

> Source of truth for what this project is and why it exists. Written from the
> Sokan technical handoff and the AI Blueprint integration addendum. Where the
> handoff marks a capability as unproven, this plan keeps it unproven.

## 1. Problem - What problem are we solving?

AI coding agents can write code, but running one as a repeatable software
development process is still manual and opaque.

Today the operator has to:

- reinstall or copy the same prompts, skills, and workflow files into every project
- remember which step of the process the agent has reached
- read raw CLI output to learn whether a step passed, failed, or stopped
- restart long runs by hand and lose context when a process dies
- accept vendor bundles where runtime, model, and hosting are sold together

Domino sits between the user and an agent runtime as a **workflow control and
management layer**. It defines the process, decides which step runs next, pauses
where approval is required, and records what happened. The runtime executes the
work.

Architecture principle: **workflow control belongs to Domino; task execution
belongs to the runtime.**

Explicit non-goal: a chat front end for an agent. The dashboard is an operations
console over a workflow engine, not a conversation UI.

Naming: the handoff document calls the project "Sokan"; this repository and the
architecture addendum call it "DominoAI" / "Domino". This plan uses Domino as the
current name.

## 2. Users - Who is this for?

Primary:

- A developer who already runs a local CLI agent (Reasonix today) and wants a
  repeatable multi-step workflow with pause and continue instead of ad-hoc
  prompting.
- Someone who will not hand their code, keys, or machine to a hosted agent
  service.

Future potential audience, not supported in the MVP:

- Small teams that want one shared, versioned definition of their workflow and
  skill library, still running locally. The MVP is single-user with no accounts,
  no multi-user authentication, and no hosted mode.

Not the initial audience:

- non-technical end users
- enterprise buyers needing compliance, SSO, audit trails, or an SLA
- hosted multi-tenant SaaS operators

Users bring their own runtime binary and their own model API key. Domino does not
sell inference and does not sit in the path of model calls.

## 3. Features - What does the MVP need?

The MVP is the smallest product that satisfies the handoff's definition of
success: a usable adapter, a runtime-independent workflow engine, persistence,
and one simple multi-step workflow observable end to end.

Core (MVP):

- Reasonix ACP adapter with sessions, prompts, streamed events, cancel, resume, load, and list
- runtime capability discovery, so unsupported features are recorded rather than assumed
- normalized runtime events, kept separate from ACP method names
- a central, versioned library of reusable workflow and skill definitions with steps and approval points
- a project registry that binds a workspace to its configuration and its selected definition versions
- a workflow engine that owns run state, ordering, retry, pause, continue, cancel, and history
- SQLite persistence for definitions, projects, workflow runs, step runs, approvals, and runtime session links
- Skill content delivered to the runtime through a verified mechanism, with no permanent install in the target project
- runtime profiles that select an existing Reasonix provider and model, with a write-only API key entry and a real connection test
- a minimal dashboard to start a workflow against a registered project, watch it, stop it, answer approvals, and read results
- local operation with user-supplied API keys; Domino never persists or returns them, and no secret appears in project files, logs, workflow history, or API responses

Deferred (explicitly not MVP):

- a second runtime adapter
- custom provider creation or editing
- a Domino-owned credential store
- Claude provider support validated end to end
- MCP tool integration
- Playwright and screenshot or image analysis
- concurrent or scheduled runs
- multi-user auth, accounts, and hosted mode
- parallel or conditional workflow steps
- full recovery and continuation of an interrupted workflow after the Domino process restarts
- export or sync of definitions into target project files
- bidirectional Git synchronization
- PostgreSQL or another server database

### Delivery status (feature separation)

- Feature 3A (handshake, capability discovery, and session lifecycle) is implemented and locally tested. Feature 3B (live Reasonix session creation and close with a valid disposable credential) is blocked and deferred by the missing valid disposable credential and writable Reasonix home. Feature 3 remains open; 3B is intentionally outside the selectable checklist until both prerequisites exist. No live success is claimed.
- Feature 11A Stage 1 (contracts), Stage 2/2.1 (credential file store), and Stage 3 (provider/model catalog) are implemented and tested. Stage 4 (persistence and migration) is blocked until Features 9 and 10 exist. API, Settings UI, real connection test, and project default-profile integration remain open.
- Features 9 and 10 keep their existing order and remain prerequisites for Feature 11A Stage 4. These implementation units do not mark any feature complete.

## 4. Data - What are we storing?

These are distinct concepts with distinct identifiers. Conflating them is a known
failure mode in this kind of system.

| Entity | Purpose |
| --- | --- |
| Project | A registered workspace: stable Domino id, canonical workspace root with symlinks resolved, project configuration, and selected workflow and skill versions |
| Workflow definition | Versioned, immutable once published: steps, approval points, error policy |
| Skill definition | Reusable instruction content, versioned, referenced by workflow versions |
| Workflow run | One execution of one definition version against one project |
| Step run | State and result of one step inside a run |
| Approval request | What was asked, when, and how it was answered |
| Runtime profile | Non-secret settings that select an existing adapter, provider, model, and `api_key_env` name; never a key value |
| Credential reference | Provider and `api_key_env` name used to locate the runtime-owned credential; contains no secret |
| Runtime session reference | The runtime's own session id, linked to a step run |
| Runtime event record | Normalized events, or a summarized retention of them |

Rules:

- a workflow run id is not a runtime session id
- a runtime session alone never reconstructs workflow state
- published versions are immutable; editing a definition creates a new version
- a run pins the exact Workflow and Skill versions it started with, so later
  edits never mutate a running or completed run
- a run pins the runtime profile metadata it started with, never a secret
- Domino owns a central, versioned library of reusable Skill and Workflow
  definitions; project-specific instructions and configuration may stay in the
  target project's Git repository
- the Project Registry associates a project with the definition versions and
  configuration it uses, so one definition can run against several projects
- Domino does not rewrite the target project's tree in the MVP; export or sync
  into project files is a later, opt-in capability, and bidirectional Git
  synchronization is out of scope
- Domino never stores a secret. API keys never enter SQLite, workflow
  definitions, run records, events, logs, API responses, or Git. On explicit
  user action Domino may write a key only to the runtime's official credential
  file; otherwise it refers to it by provider and `api_key_env` name

Storage: SQLite is the selected initial engine, held as a local file owned by the
app. The driver, migration approach, schema details, and event retention policy
are decided in the persistence feature. The Workflow Engine reads and writes
through an application-owned persistence interface, so it does not depend on
SQLite directly and a different engine can be added later without changing engine
logic. The interface contracts and an in-memory implementation arrive with the
engine core, so early engine work needs no database; SQLite is implemented behind
the same interface afterward. No PostgreSQL, server database, or Prisma layer is
added for the MVP.

## 5. Tech - What stack are we using?

| Layer | Choice | Status |
| --- | --- | --- |
| App | Next.js 16 App Router, React 19, TypeScript strict | installed |
| Styling | Tailwind CSS v4, CSS-first theme, light and dark tokens | installed |
| UI components | shadcn/ui, default components used as-is | planned in 11A Stage 6 |
| Forms | native React handling; Zod for schema validation; React Hook Form optional | not installed yet |
| Localization | English and Persian, English default, cookie-backed switcher | shell implemented |
| Runtime | Node.js 24 | available |
| Agent runtime | Reasonix CLI v2.54.0 over ACP (JSON-RPC over stdio) | installed; partially verified by smoke tests |
| Model | provider-agnostic; `deepseek/deepseek-flash` in development | current setup |
| Tests | Vitest | installed |
| Storage | SQLite, local file | selected; driver, migrations, and schema decided in the persistence feature |
| Package manager | npm | lockfile present |
| License | MIT | `LICENSE` file at the repository root |

Constraints:

- the ACP adapter runs inside the Node server process, so this is a server app,
  not a static export
- the runtime is reached through ACP, not by importing Reasonix internals
- the model provider is a runtime setting and never a Domino dependency
- credential handling writes only to the runtime's official credential file after
  explicit user action; no Domino credential store and no new dependency are
  added for it
- the Workflow Engine depends on an application-owned persistence interface, not
  on SQLite or an ORM directly
- no PostgreSQL, server database, or Prisma layer is added for the MVP; SQLite is
  sufficient for one local operator
- runtime capabilities are claimed only after verification against the installed
  Reasonix version through the exact ACP path Domino uses; `resume` and `load`
  stay distinct, and each semantics is established by observable tests
- UI work uses shadcn/ui default components as-is and reuses installed components
  before adding new ones; nothing under `components/ui/` is edited, forked, or
  replaced, and custom layout comes from page-level composition, wrapper
  components, Tailwind utilities, and CSS variables
- every user-facing string comes from the typed bilingual catalog, with English as
  the default locale and Persian rendered RTL
- simple forms use native React handling; Zod is required when schema-based
  validation is needed, and React Hook Form is added only when form complexity
  justifies it
- both light and dark mode are supported
- the existing ACP smoke scripts in `~/Projects/reasonix-workflow-poc` are
  evidence, not code to copy blindly; their results should become repeatable
  tests inside this repository

## 6. Monetize - How will this make money?

It will not, and that is a product decision rather than an unfinished area.

- License: MIT. Free to use, modify, redistribute, and run commercially by users.
- Distribution: open source. No paid tier, no seat count, no feature paywall.
- Cost model: the user runs Domino on their own machine and connects their own
  runtime and API key, so inference and compute costs are theirs. Domino carries
  no server cost for user work.
- No ads, no telemetry resale, and no usage metering for billing.

Compatibility constraints that follow from this:

- no feature may require a Domino-hosted account, server, or network call to work
- no user code, prompt content, API key, or session transcript may leave the
  user's machine through Domino
- a future commercial offering must be additive to the open source core, never a
  removal from it

Sustainability options that stay compatible with MIT and local-first use, none
committed for the MVP:

- GitHub Sponsors or donations
- paid support or consulting
- an optional commercial hosted offering, as a separate product

## 7. UI/UX - How should this look and feel?

An operations console, not a chat window. Optimize for two questions: what is
happening now, and what does the user need to decide.

Screens:

- Workflow list: definitions, active version, last run and its outcome
- Projects: registered workspaces, their workspace root, and the workflow and
  skill versions each one selects
- Run detail: step timeline with per-step state, live event stream, elapsed time,
  and the approval prompt when the run is waiting
- Session view: runtime sessions with status, workspace, and title
- Skill and workflow editor: versioned definitions, active or inactive state,
  validation errors shown in place
- Settings: runtime binary path, workspace allowlist, existing Reasonix provider
  and model selection, a write-only API key field, credential status, every
  profile sharing the same `api_key_env`, and a real connection test

Interaction rules:

- every stop, cancel, and approval action names the run and the step it affects
- a cancelled or crashed run is visually distinct from a completed one
- failures show the runtime's real error and never claim success without a real
  result
- status is never conveyed by color alone; pair it with text and an icon
- the interface is keyboard reachable, because the audience is developers

Language and direction:

- the interface ships in English and Persian, with English as the default locale
- Persian renders RTL and English LTR from one layout using logical spacing
  utilities; there are no duplicated per-language screens
- a runtime language switcher preserves the current route and keeps the choice in
  a cookie across reloads
- UI labels, statuses, approval controls, validation messages, and errors are
  localized
- raw agent output, terminal output, code, file paths, commands, identifiers, and
  protocol payloads stay unchanged; the original technical message is kept next
  to any localized explanation

Components and forms:

- shadcn/ui is the component library; its default components are used as-is and
  are never edited, forked, or replaced
- a missing component is added with the shadcn CLI and kept at its default
  implementation
- custom layout uses page-level composition, wrapper components, Tailwind
  utilities, and CSS variables, never edits inside `components/ui/`
- simple forms use native React handling; Zod defines the schema when
  schema-based validation is needed, and React Hook Form is added only when form
  complexity justifies it
- validation messages are localized through the same catalog

Theme:

- both light and dark mode are supported
- the current shell follows the OS color scheme through `prefers-color-scheme`

Visual direction: dense and information-first, monospace for event text. UI
reference images may arrive later; when they do, store them in
`blueprint/reference/` and build the target from the image rather than from prose.
No mockups exist yet; `/prototype` is available if the layout must be locked
before building.

## 8. Deployment - Where and how will this ship?

Local-first by design. The target is a developer running Domino on their own
machine, next to the project it operates on.

- App type: Node server (Next.js server runtime). Static export is incompatible
  with running the ACP adapter or streaming live events.
- Runtime: Node.js 24 with npm.
- Build: `npm run build`. Start: `npm run start`.
- Environment variables, by name only: runtime binary path, workspace root
  allowlist, storage path, and the provider variable names the runtime already
  expects. Values are never committed. The API key value stays in the runtime's
  credential file; Domino never stores or returns it.
- Database: a local SQLite file created and owned by the app. No database server
  is required. Its path comes from an environment variable and the file is never
  committed.
- Background work: the adapter child process. No separate worker for the MVP.
- Health check path: to be decided together with the event transport.
- Domain: none. `localhost` is the deployment target.
- Packaging, whether npm package, npx, or clone and run, is undecided.
- Hosted deployment is out of scope for the MVP, and the MIT license permits
  anyone to self-host it later.

## 9. Usage model and constraints (optional)

Established:

- one operator, on their own machine, in their own trust domain
- the operator is trusted; the code Domino runs and the files it touches are the
  operator's own
- not internet-facing for the MVP, single-user, no accounts

Real boundaries that must hold even in a single-user tool:

- the runtime executes commands and edits files, so the workspace allowlist and
  containment are real controls, not formalities; the allowlist derives from
  registered projects
- containment has two moments: registration validates and canonicalizes the root,
  and every runtime step re-checks that its resolved path, including symlink
  targets, stays inside that canonical root before executing
- these checks constrain filesystem paths Domino controls. They do not sandbox
  arbitrary shell commands the runtime chooses to run, and they do not guarantee
  operating-system-level isolation; the runtime still acts with the operator's
  operating-system permissions
- model output, agent output, imported skill text, and results from future tool
  integrations such as MCP are data, never authorization to widen the workspace or
  permission scope; MCP itself is outside the MVP
- API keys and session transcripts are secrets: never logged, never written into
  workflow definitions, run records, events, or API responses, and never sent
  anywhere except the configured provider. Domino may write a key only to the
  runtime's official credential file after explicit user action; it never reads
  the key back
- approval points exist because a destructive step needs a human decision

Not established, therefore not assumed:

- user counts and scale, availability targets, compliance requirements, audit
  retention, tenant isolation, billing

## 10. Open decisions and risks

Decided:

- storage engine: SQLite, behind an application-owned persistence interface
- an interrupted workflow run does not continue after a Domino restart in the MVP

Open decisions, each assigned to the feature that settles it. None blocks
feature 1.

1. SQLite driver, migration approach, and schema details - feature 10.
2. Event retention policy for runtime events - feature 10.
3. How skill content reaches the runtime without a permanent project install:
   prompt context, a runtime-native mechanism, or a temporary workspace - decided
   by feature 13's delivery proof.
4. Dashboard event transport (SSE is suggested) and its reconnect behavior -
   feature 14.
5. Whether Blueprint definitions are consumed as-is or mapped into a Domino model
   - feature 12.
6. Packaging and install path - post-MVP, alongside release automation.
7. Whether the theme follows the OS only or also exposes an explicit light/dark
   toggle - feature 14.
8. Credential file path, permissions, and atomic replacement on Windows and
   macOS - feature 11A.
9. Connection test cost, timeout, and error categories - feature 11A.

Known risks:

- ACP behavior is only partially proven: steering semantics, concurrent prompts,
  and crash behavior are unverified.
- The runtime can hang or die mid-prompt, so pending requests must never wait forever.
- Skill content is executable influence; treating it as trusted input would be a
  security mistake.
- The framework moves quickly (Next.js 16, React Compiler, Tailwind v4), so version
  drift should be handled deliberately.
- The main delivery risk is scope drift toward a full dashboard before the adapter
  and the engine are proven.

## 11. Control operations

Three operations look similar and are not the same. They need separate names in
the engine, the adapter, and the UI.

| Operation | Owner | Meaning |
| --- | --- | --- |
| Workflow pause and continue | Workflow Engine | Hold the run between steps and later continue it in the same app process |
| Workflow cancel | Workflow Engine | End the run as cancelled, preserving the state each step reached |
| Reasonix session resume | Runtime adapter | Reattach to a runtime session, with or without history replay |

MVP behavior:

- pause and continue work while the Domino process stays alive
- if the run is between steps, pause takes effect before the next step starts
- if a step is already executing, the pause request is recorded and that step is
  allowed to finish; no next step starts
- pause does not interrupt an active Reasonix prompt. Stronger interruption needs
  a separately verified runtime capability and is outside this MVP
- cancel ends the run as cancelled and is not a pause; Reasonix session resume is
  a runtime adapter operation, not a workflow control
- a run's persisted state and history stay readable after a page reload and after
  a Domino restart
- on startup, the app reconciles state: any run that was active when the process
  stopped is marked `interrupted`, and its step states and history are preserved
- an interrupted run is never reported as completed, successful, or still
  running, and its existence never implies automatic continuation
- full recovery and continuation of an interrupted run is deferred and is not
  implied by the MVP

## 12. MVP acceptance

The MVP is done when these are observed, not listed:

- the Reasonix adapter is usable on its own, with automated tests for the proven scenarios
- a session can be created and listed
- a prompt runs and its events are received and shown
- cancel produces a cancelled result
- resume and load behave differently, and the difference is tested
- runtime failures are reported as failures
- the workflow engine runs without importing ACP details
- a project can be registered and a workflow started against it
- a project can select a runtime profile, configure an existing Reasonix
  provider/model and a write-only API key, and pass a real connection test
- Skill instructions reach the Reasonix agent through a verified ACP-compatible
  mechanism, a small observable task uses them, and the target project's file
  tree is unchanged
- a simple multi-step workflow runs end to end, including an approval pause and
  the intended pause and continue behavior
- the app binds to loopback by default, workspace paths stay contained under their
  root, cross-origin mutations are rejected, and approvals are scoped to one run
  and step
- run state and history remain readable after a page reload and after an app
  restart, with runs interrupted by that restart marked `interrupted` rather than
  completed or still running; feature 10's automated tests prove the restart case
- the automated tests pass

Not required for this definition: a full-featured dashboard beyond the minimal
run view, a second runtime, MCP, browser automation, image analysis, cross-process
recovery of an interrupted run, and export or Git synchronization of definitions
into project files.

## 13. Post-MVP extension candidates

These are candidates, not commitments, and they are not scheduled to follow the
MVP immediately.

- Domino stays responsible for workflow orchestration, step state, approvals,
  permissions, and history. The runtime stays responsible for executing agent
  tasks.
- Future browser interaction and image or screenshot analysis may come through
  runtime-native tools or a separately integrated tool provider. Which path is
  viable is unknown until verified.
- A Reasonix CLI capability is not assumed to be available through ACP until it is
  verified through the exact ACP path Domino uses.
- No browser-specific abstraction, Playwright dependency, MCP dependency, or
  image-analysis contract is added before a concrete post-MVP requirement
  justifies it.
- Future tool integrations must not expand workspace access or permissions based
  on agent output or tool results.

Browser automation, Playwright, screenshot capture, image analysis, and MCP
integration remain outside the MVP.
