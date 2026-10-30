# Feature: Settings screen

**From build-plan:** feature 11A Stage 6
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/settings-screen`
**Archive:** `blueprint/history/features/11A-stage-6-settings-screen.md`

## Goal

Build the initial Settings screen at `/[locale]/settings` on top of the Stage 5
settings API. It lists runtime profiles grouped by `apiKeyEnv`, shows credential
presence, creates and edits profiles from the providers and models the installed
Reasonix reports, and accepts a write-only API key for each credential group.
Every string is bilingual, both themes work, and no credential value is ever
rendered, echoed, or logged.

## In scope

- shadcn/ui initialized with its default components, used as-is with no edits
  under `src/components/ui/`, and styled from feature code through props,
  Tailwind classes, and the generated `cn` helper.
- A server-rendered `/[locale]/settings` route with the existing bilingual shell,
  language switcher, skip link, logical spacing, and light and dark themes.
- A client settings screen that reads `GET /api/settings/providers` and
  `GET /api/settings/profiles` and renders loading, empty, success, and typed
  failure states for each independently.
- Runtime profiles grouped by `apiKeyEnv`. Each group shows every profile that
  shares the environment variable, its credential status, and one write-only key
  control whose effect applies to the whole group.
- Create and edit forms using exactly the Stage 5 profile input
  `{ label, providerName, model }`, with provider and model choices derived from
  the catalog and `apiKeyEnv` never supplied by the browser.
- Localized messages for every new user-facing string, every typed settings error
  code, every credential status, and every form validation message.
- Pure, testable view helpers for grouping, selection defaults, edit recovery,
  response narrowing, and error-code localization.
- A small localized link from the home page header to the settings route so the
  screen is reachable without typing a URL.

## Out of scope

- Test Connection and any ACP call (Stage 7). No connection, validity, or live
  Reasonix claim is made here.
- Setting, clearing, or validating a project default runtime profile (Stage 8).
- Profile deletion, provider creation or editing, Claude, MCP, sessions, and the
  run dashboard.
- Authentication, loopback binding, cross-origin rejection, CSRF protection, and
  log redaction. Feature 15 owns those controls for this API and this screen does
  not claim them.
- Any change to the Stage 5 HTTP contract, the credential file format, the
  provider catalog parser, the `RuntimeProfile` or `CredentialStore` shapes, or
  SQLite schema and migrations.
- A browser test harness. None is configured, and this stage does not add one.
- Zod, React Hook Form, a toast provider, or dependencies beyond shadcn/ui and
  the primitives its CLI installs for the selected components. The Stage 5
  server validation stays authoritative. See Notes for the dependency decision.
- Editing, forking, or replacing anything under `src/components/ui/`, and adding
  a manual theme toggle or a `.dark` class switch. The existing OS-driven light
  and dark behavior stays.
- Redesigning the home page beyond adding the settings link, or converting other
  screens to shadcn/ui. Feature 14 owns the dashboard screens.
- New API routes, server actions, cookies, or persisted UI state.

## Build loop

`workflow.stepReview` is `feature`: implement all steps below and present one
review packet. `workflow.checkpointCommits` is `disabled`, so do not create
per-step checkpoint commits. `/complete` creates the final feature commit. Keep
the suite, typecheck, lint, and build green after every step.

## Build steps

- [x] **Step 1 - Initialize shadcn/ui with its default components.**
  Add shadcn/ui through its CLI, not by hand-copying component source, so the
  generated primitives stay at the upstream defaults. Run the non-interactive
  initialization and add commands, for example
  `npx shadcn@latest init --defaults --base-color zinc` followed by
  `npx shadcn@latest add alert badge button card input label select separator skeleton`
  (adjust only if the installed CLI renamed a flag, and record the exact
  commands used). Create `components.json` with `rsc: true`, `tsx: true`, the
  existing `src/app/globals.css`, the `zinc` base color, the `@/` aliases, and
  the CLI's default style. The CLI adds
  `src/lib/utils.ts`, the semantic CSS variables, and the dependencies it
  requires for initialization and the selected components to `package.json` and
  `package-lock.json`; accept those resolved versions and do not pin alternatives.

  Add the default components this screen uses: `alert`, `badge`, `button`,
  `card`, `input`, `label`, `select`, `separator`, and `skeleton`. Do not add
  `form`, React Hook Form, Zod, `sonner`, or a toast provider. Do not edit,
  fork, or replace anything under `src/components/ui/`.

  Keep the existing OS-driven theme. The scaffold has no theme toggle and the
  coding standards require following `prefers-color-scheme`, so do not
  introduce a `.dark` class toggle. If the CLI writes a class-based dark variant
  or a `.dark` token block, adapt only `src/app/globals.css`: keep the light
  tokens in `:root`, move the dark token values into
  `@media (prefers-color-scheme: dark)`, and retain Tailwind's media-based
  `dark:` variant so the existing home page keeps working. Keep the current font
  variables and body styles.

  Feature code composes these primitives with props and Tailwind classes.
  Layout and conditional classes use the generated `cn` helper. Reuse an
  installed component before adding another one.

  Update `blueprint/context/coding-standards.md` so it no longer says no
  component library is installed. Record shadcn/ui as the installed library,
  the no-edits rule for `src/components/ui/`, the `cn` helper, the semantic
  tokens, and the OS-driven dark mode.

  *Done when:* `components.json` and the listed default components exist
  exactly as the CLI generated them, no hand edit or fork exists under
  `src/components/ui/`, `npm test`, `npx tsc --noEmit`, `npm run lint`, and
  `npm run build` pass, and the home page still follows the OS color scheme in
  light and dark.

- [x] **Step 2 - Share the API contract and add the localized view helpers.**
  Create `src/types/settings-api.ts` with the client-safe contract types currently
  declared in `src/lib/settings/service.ts`:
  `SettingsErrorField`, `SettingsProfileView`, the response envelopes
  `{ catalog }`, `{ profiles }`, `{ profile }`, `{ status }`, and
  `SETTINGS_ERROR_CODES` as a readonly runtime array of all 15 codes. Derive
  `SettingsErrorCode` from that array with
  `(typeof SETTINGS_ERROR_CODES)[number]` so the list and the union cannot drift.
  Move only the type and code-list declarations, not behavior. Keep existing
  imports in `service.ts`, `http.ts`, and their tests working, either by
  importing from the new module or by re-exporting the same names.

  Add `src/lib/settings/screen.ts` with pure helpers and no React or Node
  imports:
  - `groupProfilesByApiKeyEnv(views)` returns groups in first-appearance order.
    Profiles inside a group keep the API order. The group status comes from its
    profiles; if a group ever reports conflicting statuses, use `unknown`.
    `apiKeyEnv` is the only grouping key, so two profiles with different
    providers but the same environment variable share one group and one key.
  - `selectableProviders(catalog)` filters out entries whose `apiKeyEnv` is
    null, because the server rejects them.
  - `initialFormSelection(catalog)` uses `defaultSelection` only when it resolves
    to a selectable provider and a listed model, otherwise the first selectable
    provider and its first model, otherwise `{ providerName: null, model: null }`.
  - `formSelectionFromProfile(catalog, profile)` keeps the provider and model
    when both still resolve; keeps a selectable provider but clears a missing
    model; clears both when the provider is no longer selectable; reports
    `unavailable: boolean` when the stored pair could not be kept.
  - `modelsForProvider(catalog, providerName)` and
    `modelAfterProviderChange(catalog, providerName)` return the listed models and
    the first model or an empty value.
  - `narrowCatalogResponse(value)`, `narrowProfilesResponse(value)`,
    `narrowProfileResponse(value)`, and `narrowCredentialStatusResponse(value)`
    accept only the fields this screen uses and reject malformed JSON shapes.
  - `parseSettingsFailure(status, body)` returns a known `SettingsErrorCode`
    plus the client-only codes `network` and `unexpected`. Unknown, missing, or
    malformed codes map to `unexpected`. `parseSettingsFieldErrors(body)`
    returns only the known field names `label`, `providerName`, `model`, and
    `secret`; anything else becomes `body`.

  Extend both catalogs in `src/i18n/messages.ts` with `nav.settings` and a
  `settings` namespace covering: title, intro, local-only note, loading, empty
  profiles, retry, refresh, section headings, field labels and help text, create,
  edit, cancel, save, saving, remove, removing, confirmation messages, every
  credential status label, the presence-only note, shared-group note, no
  selectable provider notice, unavailable edit selection notice, unexpected and
  network errors, and one message per `SettingsErrorCode`.

  Add `src/lib/settings/screen.test.ts` covering: empty and single groups; two
  profiles sharing an `apiKeyEnv`; different envs; first-appearance order; server
  profile order preserved; conflicting statuses become `unknown`; all three
  statuses preserved; valid and invalid `defaultSelection`; no selectable
  providers; null `apiKeyEnv` filtering; edit keeps a valid pair; edit clears a
  missing model; edit clears an unselectable provider; provider change model
  reset; every known error code accepted; unknown and malformed failures;
  field-name sanitization; every response guard accepting the documented shape
  and rejecting missing or wrong-typed fields; and that every
  `SETTINGS_ERROR_CODES` entry has a localized message key in both catalogs.

  *Done when:* the focused test file and the existing message-parity test pass,
  `npx tsc --noEmit` passes, and no client module imports `service.ts` at
  runtime.

- [x] **Step 3 - Add the settings route and the read-only profile list.**
  Add `src/app/[locale]/settings/page.tsx` as a server component that renders the
  same shell pattern as the home page: skip link, brand header with the page
  title, `LanguageSwitcher`, a link back to the dashboard, `main`, and footer.
  Compose the shell from the installed default `Button`, `Card`, and `Separator`
  components, using `Button asChild` with `Link` where the control navigates.
  Render a new `"use client"` component from
  `src/components/settings/settings-screen.tsx`. Add a localized `nav.settings`
  link in the home page header so the route is reachable from the UI.

  Render the language choices in the existing `LanguageSwitcher` with the
  default `Button` through `asChild`, choosing `variant` from the active locale
  and keeping the current `aria-current`, `hrefLang`, `lang`, and
  route-preserving href behavior. Keep the existing list wrapper as layout. This
  is presentation only: the cookie-backed locale behavior and the home page
  content do not change.

  On mount, `SettingsScreen` fetches `/api/settings/providers` and
  `/api/settings/profiles` in parallel with `cache: "no-store"`, and keeps two
  independent states so one failure never hides the other. Render:
  - A localized loading state that combines the default `Skeleton` with a
    `role="status"` text announcement while either request is pending.
  - A catalog failure `Alert` with a localized code and a retry `Button`;
    existing profiles and their credential controls stay visible.
  - A profiles failure `Alert` with a localized code and a retry `Button`.
  - An empty state built from `Card` when the profile list is empty, next to the
    create form from Step 4.
  - One `Card` per `apiKeyEnv` group with the environment name rendered as
    technical text, a `Badge` for the localized credential status, the
    presence-only note, the number of profiles in the group, and each profile's
    label, provider, and model. Status is always conveyed by text, never by
    color alone.
  - A refresh `Button` that re-fetches both endpoints.

  Use React text rendering only. Never use `dangerouslySetInnerHTML`, and never
  display the server's English `error.message`; localize by `error.code`.

  *Done when:* `npm test`, `npx tsc --noEmit`, `npm run lint`, and
  `npm run build` pass; with `npm run dev`, `/en/settings` and `/fa/settings`
  render the loading state and then either the empty state, the groups, or a
  localized actionable error; a missing `reasonix` executable produces the
  catalog failure banner without removing the profiles section; and the layout
  has no horizontal overflow in either direction.

- [x] **Step 4 - Add profile creation and editing.**
  Add `src/components/settings/profile-form.tsx`, used for both create and edit,
  and compose it from the default `Card`, `Label`, `Input`, `Select`, `Button`,
  and `Alert` components.
  - Selectable providers come from `selectableProviders`; changing the provider
    immediately sets the model to `modelAfterProviderChange`. Render an
    actionable localized `Alert` when the catalog has no selectable provider and
    keep the submit disabled.
  - Create starts from `initialFormSelection`. Edit starts from the selected
    profile through `formSelectionFromProfile`, keeps an unavailable pair
    unselected, shows the localized unavailable notice, and disables submit until
    a valid provider and model are chosen.
  - The form contains only a label `Input` and the provider and model `Select`
    controls, each paired with a `Label`. Wrap the form in the Base UI
    `DirectionProvider` with the active `dir` from `useI18n` so keyboard and
    positioning behavior follows Persian RTL; the generated Select has no
    `dir` prop and this provider is part of the installed dependency. Native
    `required` attributes are convenience; the Stage 5 server stays
    authoritative. Trim the label before submitting and block an empty label
    with a localized field error.
  - Submit `POST /api/settings/profiles` for create and
    `PATCH /api/settings/profiles/:id` for edit with `content-type:
    application/json` and exactly `{ label, providerName, model }`. Disable the
    submit while the request is pending.
  - On failure, keep the entered values, localize the returned code, map the
    sanitized field names to their controls with `aria-invalid` and
    `aria-describedby`, focus an error summary built from `Alert` with
    `tabIndex={-1}`, and focus the first invalid control instead when the summary
    is not the better target.
  - On success, clear edit mode, show a localized confirmation in a
    `role="status"` region, and re-fetch the profile list. If the re-fetch fails,
    keep the current list and show the profiles failure banner.
  - `profile_not_found` during edit refreshes the list and returns the form to
    create mode. `provider_unknown`, `model_unknown`, `api_key_env_unknown`, and
    `catalog_unavailable` also re-fetch the catalog and ask the user to choose
    again.
  - The create form is unavailable with an explanatory localized message when
    the catalog failed to load.

  *Done when:* the previous checks pass; in a browser at `/en/settings` a
  profile can be created from the catalog, appears in its `apiKeyEnv` group
  without a page reload, and can be edited; with the catalog unavailable the form
  is disabled with a localized explanation; and no raw server message appears in
  the page.

- [x] **Step 5 - Add write-only credential management per group.**
  Add `src/components/settings/credential-panel.tsx` inside each group from
  Step 3, composed from the default `Label`, `Input`, `Button`, `Badge`, and
  `Alert` components.
  - Render a password `Input` whose accessible name includes the environment
    variable, with `type="password"`, `autoComplete="new-password"`, and
    `spellCheck={false}`. Do not add a show-password toggle.
  - Saving sends `PUT /api/settings/profiles/:id/credential` with
    `content-type: application/json` and exactly `{ secret }`, using any profile
    id from the group because the credential store keys by `apiKeyEnv`. Removing
    sends `DELETE` to the same path. Disable both actions while pending.
  - On success, update the group status from the response, clear the secret input,
    and announce a localized confirmation in a `role="status"` region. On
    failure, clear the secret input, keep the group status unchanged, and show a
    localized code in the group's error region.
  - Keep the secret only in the input's component state. Clear it after the
    request settles on both success and failure. Never place it in a URL, a
    React key, storage, a cookie, an error message, a log, or a rendered text
    node. No `console.*` call is allowed in the new client files.
  - Show the group's shared-key note so it is clear that setting or removing the
    key affects every profile listed in that group. `present` is labeled as
    presence only, never as a valid connection.

  *Done when:* the previous checks pass; in a browser with a temporary
  `DOMINO_REASONIX_HOME`, saving a disposable fake key changes the group status
  to present and removing it changes the status to missing; the fake key never
  appears in the page source, the DOM after submit, the API response text, the
  browser console, or any request URL; and the real `~/.reasonix` is not touched.

- [x] **Step 6 - Accessibility, direction, themes, and the final verification pass.**
  Review the finished screen for keyboard reachability, visible focus, associated
  labels, announced errors and confirmations, and status text that does not rely
  on color. Confirm that every button, input, select, badge, notice, and card
  surface is a shadcn default component, that the skip link stays a native
  anchor for accessibility, and that no component under `src/components/ui/`
  was edited. Use logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `text-start`)
  rather than left and right, keep the shadcn semantic tokens and the existing
  `@theme` tokens for light and dark, and confirm the layout in Persian RTL with
  the same components.
  Run the full suite, typecheck, lint, and production build. Check the final diff
  for stray files, generated databases, and any literal secret.

  *Done when:* `npm test` passes, `npx tsc --noEmit` exits 0, `npm run lint`
  exits 0, `npm run build` succeeds, `git status` contains only intended files,
  and a browser check of `/en/settings` and `/fa/settings` in light and dark
  shows localized copy, correct direction, no horizontal overflow, and no
  hardcoded English or Persian UI text outside the catalog.

## Files / areas

- `components.json`, `src/lib/utils.ts`, and `src/components/ui/**` - generated
  shadcn/ui configuration, helper, and default components. The components stay
  unedited.
- `src/app/globals.css` - shadcn semantic tokens mapped onto the existing
  OS-driven light and dark scheme, preserving the current fonts and body styles.
- `package.json` and `package-lock.json` - only the dependencies the shadcn CLI
  installs for initialization and the selected components.
- `src/types/settings-api.ts` - shared client-safe API types and error codes.
- `src/lib/settings/service.ts`, `src/lib/settings/http.ts` - import the shared
  types; no behavior change.
- `src/lib/settings/screen.ts` and `src/lib/settings/screen.test.ts` - view
  helpers and coverage.
- `src/i18n/messages.ts` - new `nav.settings` entry and `settings` namespace in
  English and Persian.
- `blueprint/context/coding-standards.md` - record the installed shadcn/ui
  conventions, replacing the stale "no component library" note.
- `src/app/[locale]/settings/page.tsx` - settings route shell.
- `src/components/settings/settings-screen.tsx` - fetching, states, and groups.
- `src/components/settings/profile-form.tsx` - create and edit form.
- `src/components/settings/credential-panel.tsx` - write-only key control.
- `src/components/language-switcher.tsx` - presentation-only `Button` refactor.
- `src/app/[locale]/page.tsx` - localized shadcn `Button` link to the settings
  route.
- No changes to `src/app/api/settings/**`, `src/types/runtime-settings.ts`,
  `src/lib/runtime/reasonix/**`, SQLite code or migrations, or `src/proxy.ts`.
  The build plan and overview were updated during this planning step to record
  the shadcn/ui decision; leave them untouched while building.

## Data / contracts

The screen consumes the Stage 5 endpoints without extending them:

| Method | Path | Request body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/settings/providers` | none | `200 { catalog }` |
| `GET` | `/api/settings/profiles` | none | `200 { profiles: [{ profile, credentialStatus }] }` |
| `POST` | `/api/settings/profiles` | `{ label, providerName, model }` | `201 { profile }` |
| `PATCH` | `/api/settings/profiles/:id` | `{ label, providerName, model }` | `200 { profile }` |
| `PUT` | `/api/settings/profiles/:id/credential` | `{ secret }` | `200 { status }` |
| `DELETE` | `/api/settings/profiles/:id/credential` | none | `200 { status }` |

- Failures are `{ error: { code, message, fields? } }`. Only `code` and the
  recognized field names are used; `message` is never displayed.
- `CredentialStatus` is `missing | present | unknown`. `present` proves presence
  only, never validity, and the UI must say so.
- Grouping key is `apiKeyEnv` alone, because the credential store resolves an
  entry from `apiKeyEnv`. Every profile in a group is therefore affected by the
  same key write or removal.
- A provider whose catalog `apiKeyEnv` is null cannot be selected, because the
  server rejects it with `api_key_env_unknown`.
- The server owns `id`, `adapterId`, `apiKeyEnv`, `credentialRef`, `createdAt`,
  and `updatedAt`. The browser never sends any of them.
- `POST`, `PATCH`, and `PUT` send `content-type: application/json`. Reads use
  `cache: "no-store"`.
- The secret exists only in the password input state and the `PUT` request body.
  There is no read operation, no show toggle, no storage, no URL parameter, and
  no rendered or logged value.
- shadcn/ui is presentation only. The screen still consumes the same endpoints
  and input shapes. Component props and Tailwind classes in feature code change
  appearance; the generated source under `src/components/ui/` is never edited.
- No dates are formatted or displayed, so no additional locale date decision is
  introduced.
- Concurrent edits use the existing last-write-wins behavior. A
  `profile_not_found` response refreshes the list rather than retrying blindly.

## Testing

- Vitest covers the pure view helpers in `src/lib/settings/screen.test.ts` with
  the cases named in Step 2. This is where grouping, selection, narrowing, and
  error localization can actually be wrong.
- `src/i18n/messages.test.ts` already enforces identical English and Persian key
  sets and non-empty strings. New keys are covered automatically, and a focused
  test additionally proves every settings error code has a localized entry.
- UI components are not unit-tested, matching the project standard. There is no
  `Browser tests` command, so do not add one; use the dev server, the API, and
  browser inspection as evidence.
- Commands: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- No live Reasonix CLI, provider, connection, or credential-validity claim may be
  made. Catalog discovery is metadata only, and connection testing belongs to
  Stage 7.

## Notes for the AI

- Dependency decision for this stage: add shadcn/ui, as requested for this
  screen. Use the CLI's default components under `src/components/ui/` without
  editing, forking, or replacing them. Style only through component props,
  Tailwind classes in feature code, and the generated `cn` helper. Do not add
  Zod or React Hook Form; the Stage 5 server already validates every input and
  returns typed field errors, and the form is small enough for native handling.
  Do not add a toast provider; inline `Alert` components and `role="status"`
  regions cover feedback. This supersedes the earlier "no new dependency"
  reading of 11A, and the build plan was updated to record the approved
  dependency. Feature 14 folds this screen into the dashboard and reuses the
  same components.
- Keep the shadcn components unedited. Put layout, spacing, and visual variants
  in the feature components under `src/components/settings/`; use the `Button`
  variants and sizes, `Alert` variants, and `Badge` variants where they fit
  instead of overriding component internals.
- Keep the OS-driven dark mode. Do not add a theme toggle, a `.dark` class
  script, or a theme provider in this stage.
- Server validation is authoritative. Client checks only prevent an obviously
  empty submit.
- Use the `@/` import alias for new modules, per the coding standards.
- Keep the page a server component and the interactive screen a client
  component. Do not convert the page to a client component just to reuse the
  i18n context; the client component can call `useI18n` under the existing
  provider.
- Render profile labels, provider names, model names, and environment variable
  names as text data, not as translated strings. All controls, headings,
  statuses, notices, and errors come from the catalog.
- Do not render the server's generic English error message. Map `error.code` to
  the catalog.
- Keep technical identifiers in monospace and left-to-right where the surrounding
  layout is right-to-left; use `dir="ltr"` only on the identifier itself.
- No em dashes, en dashes, or ellipsis characters in generated content.
- If the local environment lacks the Reasonix executable or a writable Reasonix
  home, verify the failure states and leave the successful catalog and credential
  paths explicitly unverified. Do not describe them as working.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":26307,"specSha256":"2d72a2f71f83a1a5fdf7b10601fedb6ffc933032228905f971033b48953fddd0","branch":"refs/heads/feature/settings-screen","head":"c6d14622012bf9e16b6c664162de995638dec956","baseRef":"refs/heads/main","baseCommit":"252981243ad07597c94e322131ca81c46cbe94a1","sourceTree":"6c75e94b3b26cdb4bd2c0abee6f9fdbbc5658ecf","landing":"local-merge","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** c6d14622012bf9e16b6c664162de995638dec956
**Base commit:** 252981243ad07597c94e322131ca81c46cbe94a1
**Base ref:** main
**Spec hash:** 2d72a2f71f83a1a5fdf7b10601fedb6ffc933032228905f971033b48953fddd0
**Prepared by:** codex
**Builder model:** deepseek/deepseek-flash
**Requested reviewer:** codex
**Requested model:** deepseek/deepseek-flash
**Requested execution:** automatic
**Requested at:** 2026-10-30T22:26:41Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** deepseek/deepseek-flash
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-30T22:36:30Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD` -> `c6d14622012bf9e16b6c664162de995638dec956`: pass (equals Target commit)
- `git merge-base main c6d1462...` -> `252981243ad07597c94e322131ca81c46cbe94a1`: pass (equals Base commit; `main` is a local branch and the only modified path is `blueprint/context/review.md`)
- `sha256sum blueprint/context/current-feature.md`: pass (2d72a2f7...fddd0 matches Spec hash)
- `npx tsc --noEmit`: pass (exit 0, no output)
- `npm run lint`: pass (exit 0; 2 pre-existing warnings outside this delta: `src/lib/runtime/acp/protocol.test.ts:55` unused `_agentInfo`, `src/lib/runtime/reasonix/env-file-store.ts:4` unused `stat`)
- `npm test`: pass on re-run (32 files, 506 tests, 4 skipped). An earlier full run in the same review failed on the flaky lock test recorded as F-33; the file passed in isolation (46/46) and the second full run was green. See F-33.
- `npm run build`: pass (all 14 routes generated, `/[locale]/settings` plus `/en/settings` and `/fa/settings` prerendered)

## Evidence

- Reviewed the complete `2529812..c6d1462` delta, 31 files / +5701 -179, read in full at the source level: `src/lib/settings/{screen.ts,screen.test.ts,client.ts,service.ts}`, `src/types/settings-api.ts`, `src/components/settings/{settings-screen,profile-form,credential-panel}.tsx`, `src/app/[locale]/settings/page.tsx`, the home page and `language-switcher` diffs, `src/i18n/messages.ts` (both catalogs), `src/app/globals.css`, `components.json`, `package.json`, and all nine generated `src/components/ui/` files.
- Security: no `console.*` in the new client files, no `dangerouslySetInnerHTML` anywhere in `src/`, no inline styles in the new screens, secret lives only in `CredentialPanel` state and the `PUT` body (`credential-panel.tsx:63-72`), is cleared on success and failure (`:72`,`:110`), uses `type="password"`, `autoComplete="new-password"`, `spellCheck={false}` and `dir="ltr"` (`:154-161`); only `error.code` is localized and the server `error.message` is never rendered; reads use `cache: "no-store"` (`client.ts:19`).
- Theme: no `.dark` class switch was introduced; the compiled stylesheet keeps dark tokens and every `dark:` utility under `@media (prefers-color-scheme:dark)` (`.next/static/chunks/38p_i9qmc0vq_.css`), and `node_modules/shadcn/dist/tailwind.css` defines no `dark` custom variant, so the media-based variant still governs.
- i18n: every new user-facing string comes from the catalog (`nav.settings`, the `settings` namespace, all 15 server codes plus `network` and `unexpected`, every credential status and field message) in both English and Persian; the typed `Messages` catalog plus `npm test` prove parity. No hardcoded UI text in the new components.
- Behaviour traced against the spec: grouping by `apiKeyEnv` only, `selectableProviders` filtering null envs, `initialFormSelection`/`formSelectionFromProfile` fallbacks, `formSelectionFromProfile` unavailable flag, independent catalog and profile load states, catalog failure leaving profiles and credential controls visible, `profile_not_found` returning to create mode, the four catalog-refresh codes, submit disabled while pending, and the group-shared key note.
- Performance: two parallel mount fetches, mutations update local state instead of refetching the whole list (`handleCredentialStatusChange`, `settings-screen.tsx:252-270`), no unbounded loops or N+1 request patterns in the new code; F-25 already records the per-request `reasonix doctor` spawn on the unchanged Stage 5 endpoints.
- Tests: `screen.test.ts` covers the Step 2 case list (empty, single and shared groups, first-appearance order, preserved profile order, conflicting statuses, all three statuses, valid and invalid `defaultSelection`, no selectable provider, null-env filtering, all three edit branches, provider-change reset, every error code, malformed failures, field-name sanitization, and every guard accept/reject). No `.skip`, `.only`, or `todo(` in the settings or i18n suites. Gaps recorded as F-29.
- Ledger updated: added F-27 (P2), F-28, F-29, F-30, F-31, F-32 (P3), F-33 (P2), and re-examined F-22, whose `@/` import drift now also covers the Stage 6 `screen.ts`, `client.ts`, `screen.test.ts`, and `types/settings-api.ts`.
- The model identifier this runtime exposes for the reviewer is `deepseek/deepseek-flash`, matching `Requested model`.

## Findings

- New this pass: F-27 [P2] open, F-28 [P3] open, F-29 [P3] open, F-30 [P3] open, F-31 [P3] open, F-32 [P3] open, F-33 [P2] open. Updated: F-22 (same drift, more files).
- No P0 or P1 finding is `open` or `fixed`. Pre-existing entries F-02, F-03, F-04, F-11 (P2) and the P3 set remain open; none of them touches a file in this delta except F-22, which is P3.

## Remaining risk

- No browser was available and no `Browser tests` command is configured, so the Step 3, 4, 5, and 6 done-whens that name browser evidence are unproven: `/en/settings` and `/fa/settings` rendering, RTL layout and `DirectionProvider` behaviour, keyboard reachability and focus order, light and dark appearance, no horizontal overflow, and the interactive create/edit/credential flows were not observed.
- The successful catalog and credential paths were not exercised against a live `reasonix`; only the suite, the typecheck, and the build cover them, so no claim is made that they work against the installed CLI.
- `src/components/ui/**` was checked for edits by reading the nine files, not by diffing them against the upstream registry (no network access), so "CLI-generated and unedited" is a reading, not a byte-level proof.
- No coverage tool, dependency scanner, or profiler is installed, so no coverage percentage, vulnerability scan, or measured performance claim is made; F-25's catalog-spawn cost remains a reading of the code.
- F-33 means the project test gate can go red on machine load alone; a green run here is not proof that it will stay green elsewhere.

## Try it now

Run or do:

```bash
npm run dev
```

Then open `http://localhost:3000/en/settings` and `http://localhost:3000/fa/settings`.

Expected: the bilingual Settings screen renders with its runtime profile section, the create form, and a localized catalog-unavailable alert when Reasonix is not installed. No credential value appears anywhere on the page.

This proves: the new settings route is reachable, loads the Stage 5 catalog and profile endpoints, and renders its typed states with the shadcn components.
