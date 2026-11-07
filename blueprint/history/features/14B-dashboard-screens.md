# Feature: Dashboard screens

**From build-plan:** feature 14B
**Build attempt:** 1
**Branch:** `feature/dashboard-screens`
**Status:** verified

## Goal

Turn the feature 14A run API into the operator-facing dashboard. One shell hosts
Projects, Workflows, the run list, run detail, and the existing Settings screen.
From the browser the operator can register a project, choose a published
workflow version, start a run, follow live state and runtime events, pause or
continue, cancel, approve or reject an approval, and read step results. English
and Persian RTL, light and dark themes, and accessible controls are part of the
work, not follow-up polish.

## In scope

- A dashboard shell used by every dashboard page: skip link, brand, primary
  navigation (Projects, Workflows, Runs, Settings), language switcher, main
  content landmark, and footer. The active destination is marked with
  `aria-current="page"`.
- Page routes, decided here because the plans leave routes open:
  - `/[locale]` redirects to `/[locale]/runs`;
  - `/[locale]/projects`;
  - `/[locale]/workflows`;
  - `/[locale]/runs`;
  - `/[locale]/runs/[id]`;
  - `/[locale]/settings` keeps its current URL and renders the existing
    `SettingsScreen` inside the shell.
- One route-group layout at `src/app/[locale]/(dashboard)/layout.tsx`; the
  existing `error.tsx`, `loading.tsx`, and `not-found.tsx` stay at
  `src/app/[locale]/`.
- Projects screen:
  - list registered projects with name, workspace root, default runtime profile,
    selected workflow versions, selected skill version count, and registration
    time;
  - register a project with name, workspace root, optional default runtime
    profile, selected workflow versions, and selected skill versions;
  - set or clear an existing project's default runtime profile through the
    feature 11A Stage 8 `PATCH /api/settings/projects/[id]` route, so an existing
    project can become runnable without a second project record;
  - localized field errors associated with their inputs, and a focused error
    summary.
- Workflows screen: read-only list of workflow definitions, every published
  version, latest published version, steps, approval points, and the most recent
  run for that definition with its outcome. No editor is added; no publish API
  exists in the repository.
- Run list screen: runs newest first with status, project, workflow and version,
  created time, and duration; a start-run form limited to each project's selected
  workflow versions; navigation to the new run on success.
- Run detail screen:
  - initial run detail load, then the feature 14A SSE stream;
  - status, project, workflow version, workspace root, run id, timestamps, and
    elapsed time;
  - step timeline in `stepIndex` order with status, attempts, start and finish
    times, result text, and error;
  - pending approval prompt with the approval message and the affected step key;
  - pause, continue, cancel, approve, and reject actions with the run and, for
    approvals, the step named in the accessible label;
  - runtime event feed and workflow history;
  - live-connection status, reconnect behavior, and a manual reload path.
- English and Persian catalogs for every new label, status, action, empty state,
  and error. English remains the default; Persian uses the same layout, logical
  spacing utilities, and the existing cookie switcher.
- Light and dark presentation through the existing semantic tokens and
  `prefers-color-scheme`; no theme provider or `.dark` switch is added.
- Status is always expressed with localized text, never color alone. A cancelled
  or interrupted run is distinguishable from a completed run by its label and
  badge variant.
- Keyboard reachable controls, visible focus through the existing tokens, proper
  labels, `aria-invalid`, `aria-describedby`, `aria-live` feedback, and status
  announcements that do not announce a ticking clock every second.
- Pure, tested helpers for response narrowing, error parsing, selection,
  control availability, formatting, and stream-frame interpretation.

## Out of scope

- Any change to the 14A server APIs, routes, SSE frames, run service, workflow
  engine, or persistence. The screens consume the existing contracts.
- Publishing or editing workflows and skills, and any Skill or Session screen
  from the later roadmap. Workflows stays read-only.
- Editing a project after registration except its default runtime profile.
  Registration has no update route and this feature adds none.
- A second credential store, credential value display, or changes to the Reasonix
  environment file. Settings reuses `SettingsScreen` unchanged.
- Secret redaction in event text, logs, API responses, or the event view. Feature
  15 owns redaction; this feature renders the runtime's original text and makes
  no redaction claim.
- Loopback binding, cross-origin mutation rejection, approval-to-step server
  binding, authentication, hosted mode, multi-user behavior, and telemetry.
- Polling fallback, WebSocket transport, service-worker caching, optimistic
  mutation, or offline behavior.
- New dependencies. In particular, no Zod package is added: the existing Settings
  screen validates manually, the server remains authoritative for every mutation,
  and these forms only need required-field and selection checks.
- Browser-test infrastructure. No `Browser tests` command is configured, so no
  runner is added inside this feature.
- Screenshots, visual-reference replication, or a prototype pass. No reference
  image exists, so the work follows the existing shell and shadcn defaults.

## Build loop

`workflow.stepReview` is `feature`: implement all steps, then present one review
packet. `workflow.checkpointCommits` is `disabled`, so no per-step commit;
`/complete` creates the final feature commit. Each step must leave `npm test`,
`npx tsc --noEmit`, and `npm run lint` runnable.

## Build steps

- [x] Step 1: Add the run-service client and screen logic.
  Create `src/lib/runs/client.ts` with a small `fetch` wrapper that returns the
  parsed body, HTTP status, and a typed failure code, plus JSON request helpers.
  Create `src/lib/runs/screen.ts` with:
  - error parsing (`RunFailureCode = RunErrorCode | "network" | "unexpected"`,
    field-error extraction);
  - narrowing for project list/response, workflow catalog, skill catalog, run
    list/detail/state, step runs, approvals, history entries, runtime event
    records, and SSE frames;
  - selection helpers (`workflowVersionsForProject`,
    `latestVersionByDefinition`, `lastRunByWorkflow`, `stepKeyFor`,
    `pendingApprovals`, profile label lookup);
  - control predicates (`canPause`, `canContinue`, `canCancel`,
    `canAnswerApproval`, `isTerminalRunStatus`);
  - formatting helpers (`formatDuration`, `formatTimestamp`, `shortRunId`) and
    safe path builders using `encodeURIComponent`.
  Do not add a client data-fetching library. Tests use literals, not network.
  **Done when:** `src/lib/runs/screen.test.ts` covers valid and malformed
  responses, every failure-code path, field errors, project-to-version
  selection, latest-version selection, last-run selection, control availability
  for each run status, terminal detection, duration and timestamp formatting,
  and `snapshot`/`state`/`event` frame parsing; `npm test` and
  `npx tsc --noEmit` pass.

- [x] Step 2: Add the dashboard shell and fold Settings into it.
  Create `src/components/dashboard/dashboard-shell.tsx` (server component
  composition) and `src/components/dashboard/dashboard-nav.tsx` (client
  component using `usePathname` for `aria-current`). Move the existing home and
  settings pages under `src/app/[locale]/(dashboard)/`, preserve
  `/[locale]/settings`, and make `/[locale]` a guarded redirect to
  `/[locale]/runs`. The shell renders one skip link, header, nav, main landmark,
  language switcher, and footer. Add the navigation messages to both catalogs.
  Do not duplicate the Settings screen or edit `src/components/ui/`.
  **Done when:** `/{en,fa}` redirects to `/{en,fa}/runs`; `/{en,fa}/settings`
  renders the existing `SettingsScreen` inside the shell; the active nav item
  carries `aria-current="page"`; switching language keeps the current path; and
  `npx tsc --noEmit`, `npm run lint`, and `npm test` pass.

- [x] Step 3: Build the Projects screen.
  Create `src/lib/projects/screen.ts` and its test for workflow/skill option
  grouping, default-profile labels, and client-side required-field checks. Create
  `src/components/projects/projects-screen.tsx`. Load `GET /api/projects`,
  `GET /api/workflows`, `GET /api/skills`, and `GET /api/settings/profiles`
  together with visible loading, empty, and retry states. The registration form
  posts `name`, `workspaceRoot`, optional `defaultRuntimeProfileId`,
  `workflowVersionIds`, and `skillVersionIds`. Wrap shadcn `Select` in
  `DirectionProvider` as `ProfileForm` does. Each project row offers a default
  profile select and save action using `PATCH /api/settings/projects/[id]` with
  `{ defaultRuntimeProfileId: string | null }`; save and clear paths are both
  reachable. Show typed API errors (`workspace_root_invalid`,
  `workspace_root_registered`, `runtime_profile_not_found`,
  `workflow_version_not_found`, `skill_version_not_found`, `invalid_request`,
  `network`, `unexpected`) with localized text, and associate field errors with
  their inputs. Never render a credential value or `credentialRef`.
  **Done when:** a project registered from the form appears in the list with its
  selected versions and default profile; setting then clearing the default
  profile updates the row without a second project record; duplicate root,
  unknown profile, unknown version, and invalid input show localized messages;
  `src/lib/projects/screen.test.ts` passes with `npm test`, and
  `npx tsc --noEmit` and `npm run lint` pass.

- [x] Step 4: Build the Workflows screen.
  Create `src/lib/workflows/screen.ts` and its test for grouping versions by
  definition, choosing the latest published version, resolving skill names, and
  choosing the most recent run per definition. Create
  `src/components/workflows/workflows-screen.tsx`. Load `GET /api/workflows`,
  `GET /api/skills`, and `GET /api/runs`. Show each definition with every
  published version, the latest version marked as such, step keys in order,
  approval-point messages, and the last run's status and time. Read-only: no
  publish, edit, or delete control. Show a clear empty state when no definitions
  or versions are published and a localized retry when the catalog is malformed
  or unreachable.
  **Done when:** a workflow definition shows its latest version, steps, approval
  points, and last run outcome; a catalog with multiple versions lists all and
  marks only the highest; an empty catalog shows the empty state; tests,
  typecheck, and lint pass.

- [x] Step 5: Build the run list and start-run form.
  Create `src/components/runs/run-list-screen.tsx`. Load `GET /api/runs`,
  `GET /api/projects`, and `GET /api/workflows`. Render runs newest first with
  localized status, project, workflow and version, created time, duration, and a
  link to `/[locale]/runs/[id]`. The start form selects a project and only that
  project's `workflowVersionIds`, then posts `{ projectId, workflowVersionId }`
  to `POST /api/runs` and navigates to the returned run. Handle
  `runtime_profile_required` and `credential_missing` with a localized hint that
  points to Projects and Settings, `run_busy`, `workflow_version_not_selected`,
  `invalid_request`, `network`, and `unexpected`. Show loading, empty, and retry
  states, and disable submit while a start is pending.
  **Done when:** the list is newest first and links to detail; the workflow
  select offers only the selected project's versions and resets on project
  change; a successful start navigates to the new run; each typed failure shows
  its localized message; tests, typecheck, and lint pass.

- [x] Step 6: Build the run detail live view.
  Create `src/components/runs/run-detail-screen.tsx`, with focused child
  components for the step timeline, approval panel, event feed, history, and
  controls, plus a client stream hook under `src/components/runs/`. Load
  `GET /api/runs/[id]` first so a missing run is a localized not-found state
  instead of a retrying stream. Open `GET /api/runs/[id]/events` with
  `EventSource`; apply the first `snapshot` as the full detail, each `state` as
  the new state, and each `event` by appending to the event feed. Use the
  server's `retry: 2000` reconnect delay, show a localized live/lost/closed
  status, and replace state from the snapshot after reconnect so no event is
  duplicated. Close the source when the run reaches a terminal status. Provide a
  manual reload that refetches detail and reopens the stream. Render steps in
  `stepIndex` order with result text, errors, and attempts; render pending
  approvals with Approve and Reject posting `{ decision }`; render Pause,
  Continue, and Cancel only when the status allows them, with an inline
  confirmation for Cancel. Every action label names the run id and, for
  approvals, the step key. Keep raw agent text unchanged and render it with
  `dir="auto"` and preserved whitespace; never use `dangerouslySetInnerHTML`.
  Handle `run_not_found`, `run_state_conflict`, `approval_not_found`,
  `approval_already_resolved`, `persistence_error`, `network`, and `unexpected`
  by showing localized text and refreshing detail after a stale-state conflict.
  **Done when:** the initial detail renders steps, approvals, events, and
  history; snapshot then event frames update the view; a reconnect snapshot
  replaces state without duplicate events; approving resumes the run and
  rejecting cancels it; pause, continue, and cancel appear only in valid states
  and succeed; a terminal run closes the stream; a missing run shows not-found;
  pure stream application is covered by tests, and typecheck and lint pass.

- [x] Step 7: Complete localization, accessibility, and final verification.
  Fill both catalogs for every new screen, status, action, empty state, error,
  stream state, and accessible name. Keep raw ids, paths, commands, protocol
  payloads, and agent output unchanged next to localized explanations. Verify
  focus order, skip link, labels, `aria-invalid`, `aria-describedby`, focused
  error summaries, `aria-current`, `aria-live` feedback, and that no status relies
  on color. Confirm no file under `src/components/ui/` changed and no dependency
  was added. Record a short manual `/check` path in the review packet for
  Projects, Workflows, run list, run detail, and Settings in both locales.
  **Done when:** the existing catalog-parity and non-empty tests pass with the new
  keys, the manual check path is recorded, and `npm test`, `npx tsc --noEmit`,
  and `npm run lint` pass on the final tree.

## Files / areas

- `src/app/[locale]/(dashboard)/layout.tsx` - dashboard shell layout.
- `src/app/[locale]/(dashboard)/page.tsx` - locale-aware redirect to `/runs`.
- `src/app/[locale]/(dashboard)/projects/page.tsx` - Projects page composition.
- `src/app/[locale]/(dashboard)/workflows/page.tsx` - Workflows page
  composition.
- `src/app/[locale]/(dashboard)/runs/page.tsx` - run list page composition.
- `src/app/[locale]/(dashboard)/runs/[id]/page.tsx` - run detail page
  composition.
- `src/app/[locale]/(dashboard)/settings/page.tsx` - moved existing settings page.
- `src/components/dashboard/dashboard-shell.tsx` - shell composition.
- `src/components/dashboard/dashboard-nav.tsx` - client nav with active state.
- `src/components/projects/projects-screen.tsx` - Projects screen.
- `src/components/workflows/workflows-screen.tsx` - Workflows screen.
- `src/components/runs/run-list-screen.tsx` - run list and start form.
- `src/components/runs/run-detail-screen.tsx` - run detail composition.
- `src/components/runs/step-timeline.tsx` - step list and results.
- `src/components/runs/approval-panel.tsx` - pending and resolved approvals.
- `src/components/runs/run-controls.tsx` - pause, continue, cancel.
- `src/components/runs/event-feed.tsx` - live runtime events.
- `src/components/runs/history-list.tsx` - workflow history.
- `src/components/runs/use-run-stream.ts` - client EventSource hook.
- `src/lib/runs/client.ts` - run-service JSON request helper.
- `src/lib/runs/screen.ts` and `.test.ts` - narrowing, parsing, selection,
  controls, formatting, stream frames.
- `src/lib/projects/screen.ts` and `.test.ts` - project list/form helpers.
- `src/lib/workflows/screen.ts` and `.test.ts` - workflow grouping helpers.
- `src/i18n/messages.ts` - English and Persian catalogs.
- Existing unchanged surfaces: `src/app/api/**`, `src/lib/runs/service.ts`,
  `src/lib/runs/stream.ts`, `src/components/settings/**`,
  `src/components/ui/**`.

## Data / contracts

All endpoints already exist and keep their current shapes. No server route, error
code, SSE frame, or persistence record is added or changed.

- `GET /api/projects` returns `ProjectListResponse`.
- `POST /api/projects` accepts `name`, `workspaceRoot`, optional
  `configuration`, optional `defaultRuntimeProfileId`, optional
  `workflowVersionIds`, optional `skillVersionIds`, and returns
  `ProjectResponse` with status 201.
- `GET /api/settings/projects/[id]` returns
  `SettingsProjectDefaultProfileResponse`; `PATCH` accepts exactly
  `{ defaultRuntimeProfileId: string | null }`.
- `GET /api/settings/profiles` returns `SettingsProfilesResponse`; only
  non-secret profile metadata is displayed.
- `GET /api/workflows` returns `WorkflowCatalogResponse`;
  `GET /api/skills` returns `SkillCatalogResponse` with content-free summaries.
- `GET /api/runs` returns `RunListResponse` in store order; the client sorts
  newest first by `createdAt`, then by `id` for equal timestamps.
- `POST /api/runs` accepts exactly `{ projectId, workflowVersionId }` and returns
  `RunResponse` with status 201.
- `GET /api/runs/[id]` returns `RunResponse`.
- `POST /api/runs/[id]/pause`, `/continue`, and `/cancel` return `RunResponse`.
- `POST /api/runs/[id]/approvals/[approvalId]` accepts exactly
  `{ decision: "approve" | "reject" }` and returns `RunResponse`.
- `GET /api/runs/[id]/events` is `text/event-stream` with an initial `retry:
  2000` line and a named `snapshot` event carrying `RunDetail`, then named
  `state` events carrying `RunState` and named `event` events carrying
  `RuntimeEventRecord`; `: ping` comments keep the connection open. Reconnecting
  yields a fresh snapshot. This feature uses the browser `EventSource` and its
  automatic reconnect, does not add a second transport, and closes the source
  after a terminal run status.
- Client failure codes are `RunErrorCode` plus `network` and `unexpected`. The
  server error body is `{ error: { code, message, fields? } }`; messages are
  technical English and are not shown as the primary user-facing text.
- Ids in URLs and API paths are encoded with `encodeURIComponent`. Run,
  workflow, and version ids stay distinct and are never conflated in labels.
- No credential, prompt body, or API key is copied into client state beyond the
  non-secret run, project, and profile fields above.

## Testing

- `npm test` (Vitest) covers pure logic only:
  - response narrowing accepts well-formed payloads and rejects malformed ones;
  - failure and field-error parsing for every run error code plus `network` and
    `unexpected`;
  - project-to-version selection, latest published version, last run per
    definition, pending approvals, step-key resolution, and control
    availability for every run status;
  - terminal-status detection, duration/timestamp formatting, and safe id/path
    encoding;
  - SSE frame parsing for `snapshot`, `state`, `event`, and malformed data;
  - project and workflow screen grouping helpers.
- `src/i18n/messages.test.ts` continues to enforce identical English and Persian
  key sets, non-empty values, and translated prose.
- `npx tsc --noEmit` and `npm run lint` run on the final tree.
- No browser test command exists, so this feature adds no browser runner. The
  review packet records a manual `/check` path for both locales; unit tests do
  not claim rendered, visual, live-runtime, or persisted-data evidence.
- The final report must distinguish unit-tested logic, typecheck/lint results,
  and any manual browser observation that was actually performed.

## Notes for the AI

- Follow the repository, not generic Next.js advice. Server components compose
  pages; the interactive screens follow the existing `SettingsScreen` pattern:
  `"use client"`, route-handler `fetch`, typed narrowing, and no client data
  library. Route Handlers already exist for every operation.
- Use `@/` imports. Keep components focused and extract reusable logic into the
  named pure modules. React Compiler is enabled: do not add `useMemo`,
  `useCallback`, or `React.memo` without a measured need.
- Do not edit, fork, or replace `src/components/ui/`. Reuse Alert, Badge, Button,
  Card, Input, Label, Select, Separator, and Skeleton. If a genuinely missing
  primitive is required, stop and ask before adding one; do not hand-roll a
  replacement under `components/ui/`.
- Base UI `Select` needs `DirectionProvider` from
  `@base-ui/react/direction-provider` for correct RTL, as `ProfileForm` already
  does. Keep logical spacing utilities (`ps-*`, `me-*`, `start-*`).
- Use the existing semantic color tokens; no hardcoded hex values, inline
  styles, `.dark` class, or theme provider.
- Forms: native React state and required-field checks; the server validates the
  rest. Focus the error summary on failure, set `aria-invalid`, and reference
  the summary from each invalid field. Do not surface raw server messages or
  stack traces as the primary text.
- Preserve raw agent output, technical ids, paths, and protocol text unchanged
  with `dir="auto"` or `dir="ltr"` as appropriate, and keep the localized
  explanation beside it. React's default escaping is the only rendering rule;
  no `dangerouslySetInnerHTML`.
- Accessibility: one skip link in the shell, one `main` landmark, labeled nav,
  `aria-current` on the active destination, text plus badge variant for status,
  `role="status"`/`aria-live` for feedback and stream state, and no live
  announcement for the per-second elapsed clock.
- The run detail initial fetch is intentional: it turns a missing run into a
  not-found state before `EventSource` starts and prevents an endless reconnect
  loop against a 404. The stream is authoritative after that.
- Cancelling is destructive and irreversible. Use an inline confirmation that
  names the run; do not rely on a native `confirm()` or add a dialog dependency.
- During a pending action, disable only the controls that would conflict and show
  a localized in-progress label. Refresh detail after `run_state_conflict` or
  `approval_already_resolved`, because another action or the stream changed the
  state.
- Keep the empty states useful: an empty Projects list explains registration, an
  empty Workflows list explains that no published versions exist, and an empty
  Runs list points to starting a run. An empty profile list points to Settings.
- The workflow catalog is read-only because no publish API or editor exists.
  Do not invent one, seed data, or write directly to SQLite from this feature.
- Do not claim secret redaction, loopback binding, cross-origin protection,
  live Reasonix execution, mobile support, Windows, or macOS. Those are later
  features or unverified environment claims.
- If a required API field or state cannot be produced from the existing
  contracts, stop and report it instead of adding server scope to this feature.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":23740,"specSha256":"c9e7be450a3e379d9eacc9a5f3b890f2779441106e958f1809c1d57ac7ddaa5e","branch":"refs/heads/feature/dashboard-screens","head":"e459ceee597ee8321e8d5e909eedad2f04083a52","baseRef":"refs/heads/main","baseCommit":"cc7f7ee1b707550e978e7bfefd6e27c90971ec6b","sourceTree":"253bb3ed53aa42f61359a3f0ecc166cd433716ff","landing":"local-merge","absentOptional":[]} -->

## Findings

### 14B/F-42 [P2] closed - The default-profile save confirmation can never render

**File:** src/components/projects/projects-screen.tsx:396
**Found:** 2026-11-08 by /audit independent (scope: current; lens: quality)
**Why it matters:** `ProjectProfileControl` reports a successful save through
`saved` (`projects-screen.tsx:175`, rendered at `:293-297` with `role="status"`),
but each instance is mounted with
`key={`${project.id}-${project.defaultRuntimeProfileId ?? "none"}`}` (`:396`).
A successful PATCH calls `onUpdated(...)` (`:212`) and then `setSaved(true)`
(`:213`) in the same batch. The parent state update writes the new
`defaultRuntimeProfileId`, the key changes, React unmounts that instance and
mounts a fresh one whose `saved` is `false`, and the update queued on the
unmounted instance is discarded. The Save button is disabled while the selection
equals the stored profile (`:176`, `:280`), so every successful save changes the
key: the localized "Default runtime profile updated." status and its live-region
announcement are unreachable. The row badge still shows the new profile, so no
record is wrong, but the accessible confirmation the spec asks for never appears
and both the state and its `role="status"` markup are dead.
**Suggested fix:** Key the control by `project.id` only and sync `selected` from
the prop with an explicit effect or comparison, or lift the saved announcement
into `ProjectCard`/`ProjectsScreen` so the remount cannot drop it.
**Resolution:** Fixed on 2026-11-08: the saved announcement moved to `ProjectsScreen`'s `feedback` state, so the control can remount without dropping it. The row still updates from the parent state.
Verified closed on 2026-11-07 by /audit independent re-review of `e459cee`: `ProjectProfileControl` holds no saved state any more, `ProjectsScreen` owns `feedback` (`projects-screen.tsx:400-402`) and sets it from `handleProfileUpdated` (`:428-429`), which also rewrites the row through `applyDefaultProfile` (`:430-447`), and the live status Alert at `:466-474` sits outside the remounted subtree, so the profile-derived `key` at `:386` can no longer drop the confirmation.

### 14B/F-43 [P2] closed - The live run view rebuilds the whole event list for every frame and every tick

**File:** src/lib/runs/screen.ts:607
**Found:** 2026-11-08 by /audit independent (scope: current; lens: performance)
**Why it matters:** `appendRunEvents` (`screen.ts:607-624`) rebuilds a `Set` of
every existing event id and copies the whole `events` array on each call, and
`use-run-stream.ts:140` calls it once per incoming `event` frame. Because the
server emits one `assistant_text_delta` record per streamed chunk
(`src/lib/runtime/acp/runtime.ts:191`), a long agent step produces thousands of
frames, so applying the stream is quadratic in the retained event count and
allocates a full array copy per chunk. The same list is then re-rendered from
scratch on every second of the elapsed clock: `RunDetailLive` owns the ticker
(`run-detail-screen.tsx:100-108`), `EventFeed` re-renders with a new `onReload`
identity each time, and every row resolves its step key with a linear
`steps.find` (`event-feed.tsx:75`, `screen.ts:480-485`), giving O(events × steps)
per tick while the run is live. Magnitude was not profiled, so this is a
structural risk rather than a measured regression.
**Suggested fix:** Keep the applied-event id set in a ref inside the stream hook
and append into a copied array once per animation frame or batch instead of per
frame, and pass an already-resolved `stepKey` or a `Map` of step ids to keys into
`EventFeed` so a tick does not re-scan `steps` per event.
**Resolution:** Fixed on 2026-11-08: `useRunStream` buffers incoming event frames and flushes them at most every 100 ms, clears the buffer on snapshot/replacement, and `EventFeed` builds one step-id map per render instead of scanning steps per event.
Verified closed on 2026-11-07 by /audit independent re-review of `e459cee`: `use-run-stream.ts:18` defines `EVENT_FLUSH_MS = 100`, `enqueueEvent` only buffers (`:76-82`), `flushPending` applies one batch per tick (`:57-70`), the buffer is dropped on `snapshot`, on `replaceDetail`, and on cleanup (`:41-49`, `:139-146`, `:150`), and `event-feed.tsx:41` builds one `stepKeys` map per render with an O(1) `get` at `:76`. Append work is now bounded by flush count (about ten per second) instead of by streamed-frame count. Residual cost — one array copy per flush in `appendRunEvents` (`screen.ts:604-622`) and one live-view re-render per elapsed-clock tick — is recorded under remaining risk, not as a defect.

### 14B/F-44 [P3] closed - Unused helpers and catalog keys shipped with the dashboard

**File:** src/lib/projects/screen.ts:142
**Found:** 2026-11-08 by /audit independent (scope: current; lens: quality)
**Why it matters:** `profileOptions` (`projects/screen.ts:142-150`) is exported
but no screen or test references it; both the registration form
(`project-form.tsx:317-321`) and the row control (`projects-screen.tsx:269-273`)
build the "label — provider / model" string inline, so the helper is a second,
unused copy of that formatting. The new catalog also carries keys nothing
renders: `runs.detail.resultsTitle` (`messages.ts:282`),
`runs.detail.noResult` (`:287`), `runs.detail.streamLabel` (`:306`), and
`statuses.stream.closed` (`:89`, which cannot even be looked up because
`RunStreamStatus` has no `closed` member). The whole `home` block (`:18-45`) is
now unrendered as well, because this delta deletes the only page that used it;
`messages.test.ts:42-44` keeps it alive only by asserting its translation.
**Suggested fix:** Delete `profileOptions` and the unreachable keys, or replace
the inline formatting with the helper so there is one implementation. Keep the
`home` block only if a later screen is planned; otherwise drop it from both
catalogs and move the prose check in `messages.test.ts` to a rendered key.
**Resolution:** Fixed on 2026-11-08: removed `profileOptions`, the unreachable run-detail/stream keys, and the unrendered `home` catalog block; the translation test now checks a rendered key.
Verified closed on 2026-11-07 by /audit independent re-review of `e459cee`: no `profileOptions` reference survives anywhere in `src`; `statuses.stream` now carries `ended`, which is a real `RunStreamStatus` member and is rendered at `event-feed.tsx:51`; `runs.detail.resultsTitle`, `runs.detail.noResult`, and `runs.detail.streamLabel` are gone from both catalogs; the `home` block is gone; and `messages.test.ts:42-44` now asserts `fa.projects.title`, which `projects/page.tsx:13` renders.

### 14B/F-45 [P3] closed - Only three client failure codes are exercised by the parser test

**File:** src/lib/runs/screen.test.ts:214
**Found:** 2026-11-08 by /audit independent (scope: current; lens: tests)
**Why it matters:** Spec step 1 requires the test to cover "every failure-code
path". The `failure parsing` block asserts only `network` (`status === 0`),
`run_busy`, and the `unexpected` fallback (`screen.test.ts:214-225`); the other
twenty-one entries of `RUN_ERROR_CODES` (`types/run-api.ts:6-29`), which include
the codes the screens surface as primary text such as `runtime_profile_required`,
`credential_missing`, `run_state_conflict`, and `approval_already_resolved`, are
never passed through `parseRunFailure`. The membership check is uniform today, so
this is assertion strength rather than a live defect, but a dropped or renamed
code would keep the suite green while the screen showed "unexpected".
**Suggested fix:** Drive the case from `RUN_ERROR_CODES`, asserting
`parseRunFailure(400, { error: { code, message } })` returns each code, and keep
the malformed-body cases separate.
**Resolution:** Fixed on 2026-11-08: added a table-driven test that asserts every entry of `RUN_ERROR_CODES` survives `parseRunFailure`.
Verified closed on 2026-11-07 by /audit independent re-review of `e459cee`: `screen.test.ts:228-234` iterates `RUN_ERROR_CODES` and asserts `parseRunFailure(400, { error: { code, message } })` returns the same code, with the `network` and malformed-body cases kept separate (`:214-226`).

### 14B/F-47 [P3] closed - Two server field errors never reach their inputs

**File:** src/components/projects/project-form.tsx:400
**Found:** 2026-11-08 by /audit independent (scope: current; lens: quality)
**Why it matters:** `projectFieldFromApi` maps `defaultRuntimeProfileId` and
`skillVersionIds` (`projects/screen.ts:49-50`) and `fieldMessage` has text for
both (`project-form.tsx:59-62`), so the server can report those fields and the
summary lists them. Neither input is associated with the failure, though: the
profile `SelectTrigger` keeps `aria-describedby="project-profile-help"` and sets
no `aria-invalid` (`:303-308`), and the skill-versions `fieldset` has neither
`aria-invalid` nor an `aria-describedby` pointing at `project-form-error`
(`:400-406`). Spec step 3 requires field errors associated with their inputs and
`aria-describedby` on invalid fields, so a screen-reader user who lands on either
control is not told what is wrong.
**Suggested fix:** Give the skill fieldset and the profile select the same
conditional `aria-invalid` and `aria-describedby="…-help project-form-error"`
treatment the name and workspace-root inputs already use.
**Resolution:** Fixed on 2026-11-08: the profile select now sets `aria-invalid` and references the error summary, and the skill-versions fieldset references its help text plus the summary.
Verified closed on 2026-11-07 by /audit independent re-review of `e459cee`: the profile `SelectTrigger` sets `aria-invalid` and `aria-describedby="project-profile-help project-form-error"` when `defaultRuntimeProfileId` is invalid (`project-form.tsx:302-313`), and the skill-versions `fieldset` references `project-skill-help project-form-error` when `skillVersionIds` is invalid (`:406-412`), so the summary now reaches both controls. Residual: neither `fieldset` sets `aria-invalid` at group level; the association is carried by `aria-describedby` only.

## Independent review

**Status:** passed
**Target commit:** e459ceee597ee8321e8d5e909eedad2f04083a52
**Base commit:** cc7f7ee1b707550e978e7bfefd6e27c90971ec6b
**Base ref:** main
**Spec hash:** c9e7be450a3e379d9eacc9a5f3b890f2779441106e958f1809c1d57ac7ddaa5e
**Prepared by:** codex
**Builder model:** unknown (runtime did not expose exact model)
**Requested reviewer:** codex
**Requested model:** deepseek/deepseek-flash
**Requested execution:** automatic
**Requested at:** 2026-11-07T22:55:02Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-07T23:05:02Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `cc7f7ee1b707550e978e7bfefd6e27c90971ec6b..e459ceee597ee8321e8d5e909eedad2f04083a52` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `npm test`: pass
- `npm run lint`: pass
- `npx tsc --noEmit`: unavailable
- `npx tsc --noEmit --incremental false`: pass
- `npm run build`: unavailable

## Evidence

- Freshness re-verified before review: `HEAD` = `e459ceee597ee8321e8d5e909eedad2f04083a52`, merge base of `main` and `HEAD` = `cc7f7ee1b707550e978e7bfefd6e27c90971ec6b`, `sha256sum blueprint/context/current-feature.md` = `c9e7be450a3e379d9eacc9a5f3b890f2779441106e958f1809c1d57ac7ddaa5e`, and `git status --porcelain` lists only `blueprint/context/findings.md` and `blueprint/context/review.md`.
- `git diff --stat cc7f7ee1..e459ceee`: 34 files, +6118/−235 — the verified spec, 7 new `(dashboard)` route files plus `not-found.tsx` and the two deleted legacy pages, 2 shell components, 12 screen components (2 projects, 9 runs, 1 workflows), 4 pure modules with 3 test files, and the two catalogs; `src/components/ui/`, `package.json`, and `package-lock.json` are untouched.
- `npm test`: 52 files passed (4 live-runtime files skipped), 678 tests passed, 4 skipped, 15.06 s.
- `npm run lint`: eslint exit 0 with 2 pre-existing warnings outside the delta (`src/lib/runtime/acp/protocol.test.ts`, `src/lib/runtime/reasonix/env-file-store.ts`); no warnings in the new files.
- `npx tsc --noEmit --incremental false`: clean exit, no diagnostics — the typecheck that could run without a cache write passes.
- Quality re-check of the repaired findings: `projects-screen.tsx:400-474` (F-42), `use-run-stream.ts:18,41-82,139-150` with `event-feed.tsx:41,76` (F-43), removal of `profileOptions`/`home`/unreachable keys (F-44), `screen.test.ts:228-234` (F-45), `project-form.tsx:302-313,406-412` (F-47).
- Quality sweep of the new modules: no `dangerouslySetInnerHTML`, no `console.*`, no inline styles, hex colors, `.dark` classes, `useMemo`/`useCallback`/`React.memo`, and no `credentialRef`/`apiKey` rendering in the dashboard components; ids in API/page paths go through `encodeURIComponent` (`screen.ts:687-704`).
- Security lens: every new client call is a same-origin relative `fetch` with `cache: "no-store"` (`client.ts:17-45`), server error text is never used as primary UI text (typed codes map to localized catalog entries), and agent/runtime text is rendered through escaped React children with `dir="auto"`.
- Tests lens: no `.only`/`.skip`/placeholder tests in the new modules; snapshot/state/event/malformed-frame parsing, narrowing, failure codes, selection, formatting, and path encoding are covered (`screen.test.ts:214-495`, `projects/screen.test.ts`, `workflows/screen.test.ts`), with the control-predicate matrix gap recorded as F-50.
- Accessibility spot-check against spec step 7: one skip link and one `main` landmark in `dashboard-shell.tsx:14-72`, `aria-current="page"` in `dashboard-nav.tsx:35`, `role="status"` live regions at `event-feed.tsx:49` and `projects-screen.tsx:467`, focused error summaries at `project-form.tsx:96-100` and `run-list-screen.tsx:122-126`, and the per-second clock rendered outside any live region (`run-detail-screen.tsx:246-251`, `step-timeline.tsx:74-80`).

## Findings

- Closed after re-verification: F-42, F-43, F-44, F-45, F-47.
- Still open, re-checked this pass: F-46 (load/refresh scaffold and `BadgeVariant` duplication remains; the `NO_PROFILE` sentinel half is resolved).
- New: F-48 [P3] unused and untested `patchRunJson`; F-49 [P3] duplicated profile/skill label formatting; F-50 [P3] control predicates tested for two statuses each instead of every run status.
- No P0 or P1 finding is open.

## Remaining risk

- `npx tsc --noEmit` is unavailable here: `tsconfig.json` sets `incremental: true`, so the plain command must write `tsconfig.tsbuildinfo` and the review sandbox is read-only (`error TS5033 ... EROFS`). Its equivalent, `npx tsc --noEmit --incremental false`, passes.
- `npm run build` is unavailable here: Next 16 fails with `EROFS ... open '.next/trace'` and "Build directory is not writeable". Production bundling of this delta is therefore unverified.
- No browser/test-runner evidence exists for rendered behavior (`Browser tests` is not configured for this project): RTL layout, theme, focus order, and live SSE behavior were reviewed from source only, not observed.
- Residual, unprofiled performance cost in the live run view: `appendRunEvents` still copies the event array once per 100 ms flush (`screen.ts:604-622`), the whole detail tree re-renders once per elapsed-clock tick, and `formatTimestamp` builds a new `Intl.DateTimeFormat` per call (`screen.ts:670-681`). Magnitude is unknown; the quadratic per-frame work F-43 named is gone.
- Pre-existing open findings outside this review's repairs still apply to the delta, notably F-41 (new modules use relative imports instead of the `@/` alias), which also covers `lib/projects/screen.ts` and `lib/workflows/screen.ts` added here.
- F-46 duplication (four hand-written loaders, four `BadgeVariant` declarations) is a maintenance risk that remains, and F-49 adds a second label-formatting copy.

## Try it now

Run or do:

1. Run `npm run dev` and open http://localhost:3000/en/runs.
2. Switch the language control to فارسی and open /fa/runs.

Expected:

- the dashboard shell shows Projects, Workflows, Runs, and Settings;
- the Runs page shows the start-run form and the "No runs yet" empty state;
- the Persian route renders right-to-left with translated labels.

This proves:

- the dashboard shell, routing, and localized empty state render; it does not prove a live run, SSE updates, or approvals, which need a registered project, published workflow, and configured runtime.
