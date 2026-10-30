# Coding Standards

> Your conventions. Edit these once to match your stack.
>
> Stack detected by `/onboard`: Next.js 16.4 (App Router under `src/app`,
> Turbopack, React Compiler enabled), React 19.3, TypeScript 5 in strict mode,
> Tailwind CSS v4 with no config file, ESLint 9 flat config, npm.
>
> No database or auth provider is installed yet. shadcn/ui is installed as the
> component library. Those sections say so; replace them when a feature actually
> adds the dependency.
>
> Re-run `/onboard` if the stack changes materially.

## TypeScript

- Strict mode is on in `tsconfig.json`; keep it on
- No `any` types - use proper typing or `unknown`
- Define interfaces for all props, API responses, and data models
- Use type inference where obvious, explicit types where helpful
- Import through the `@/*` path alias (`@/lib/...`), not long relative paths

## React

- Functional components only (no class components)
- Use hooks for state and side effects
- Keep components focused - one job per component
- Extract reusable logic into custom hooks

## Next.js

- App Router only, source under `src/`
- Server components by default
- Only use `'use client'` when needed (interactivity, hooks, browser APIs)
- React Compiler is enabled in `next.config.ts`; do not hand-write `useMemo`,
  `useCallback`, or `React.memo` unless a measured problem requires it
- Use Server Actions for form submissions and simple mutations
- Use Route Handlers (`src/app/api/.../route.ts`) when you need:
  - Webhooks (Clerk, GitHub, etc.)
  - File uploads with progress tracking
  - Long-running operations
  - Specific HTTP status codes or headers
  - Endpoints for future mobile/CLI clients
  - Third-party integrations
- Otherwise, fetch data directly in server components
- Dynamic routes for item/collection pages
- `next dev` manages a `<!-- BEGIN:nextjs-agent-rules -->` block at the end of
  `AGENTS.md`. Leave it in place and commit it with your work.

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Route handlers: `src/app/api/[route]/route.ts`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib/Utils: `src/lib/[utility].ts`
- Only `src/app/` exists today; create the other folders when the first feature
  needs them

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Files: Match component name or kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Styling

- Tailwind CSS for all styling
- Tailwind v4: CSS-first config via `@import "tailwindcss"` and `@theme` in
  `src/app/globals.css`. There is no `tailwind.config.js`; do not add one.
- The Tailwind loader is wired through `next.config.ts`
  (`@tailwindcss/turbopack`)
- No inline styles
- Colors that need to be themed go through `@theme` custom properties, not
  hardcoded hex values in components
- The scaffold follows the OS color scheme through `prefers-color-scheme` in
  `globals.css`; keep that pattern until a feature needs an explicit toggle
- shadcn/ui is the component library. Its default components live under
  `src/components/ui/` and are never edited, forked, or replaced.
- Add a missing component with the shadcn CLI, for example
  `npx shadcn@latest add <component>`, and keep it at the generated defaults.
- Compose the defaults from feature components using their props and variants,
  plus Tailwind classes. Use the generated `cn` helper from `@/lib/utils` for
  conditional classes.
- The shadcn semantic tokens live in `src/app/globals.css`. Dark values follow
  `prefers-color-scheme`; do not add a `.dark` class switch or a theme provider.
- Keep custom layout in page-level composition and wrapper components, not in
  `src/components/ui/`.

## Database

No database or ORM is installed. When a feature needs persistence, choose the
provider and ORM in that feature's spec, then record the conventions here
(migration workflow, seed path, environment variables).

## Data Fetching

- Server components fetch directly; do not add a client data-fetching library
  until a feature needs one
- Client components call Server Actions or Route Handlers
- Validate external input at the boundary where it enters the app; no validation
  library is installed yet
- No authentication provider is installed. If one is added, scope every
  user-owned query by the authenticated user id and never trust a
  client-supplied user id

## Error Handling

- Use try/catch in Server Actions
- Return `{ success, data, error }` pattern from actions
- Show the user a message they can act on; do not surface raw errors or stack
  traces

## Testing

The blueprint installs no test runner; testing is opt-in at the project level,
because the overlay can't know your stack. Adding unit testing is an explicit
setup task the AI can do through the normal workflow, either as a build-plan item
or with `/tests`. The setup should choose the stack-native runner, wire the
scripts or commands, add a small example test, and update the Commands section
of `AGENTS.md`.

When `AGENTS.md` declares a `Verify` command, treat it as the umbrella automated
gate. It combines only the checks this project actually has, in this order when
available: typecheck, tests, then build. The command does not enable an absent
test runner or replace focused evidence. It gives local work and optional CI one
exact command to run. `/ci` owns Verify and CI setup. `/tests` adds the real test
command to Verify when it already exists, but never creates CI only because
testing was configured.

**The opt-in switch is one signal: a `test` command in the Commands section of
`AGENTS.md`.** Declare one and **tests become a gate for logic-bearing steps**,
not an optional extra; leave it out and the loop verifies logic with the evidence
it already uses (run it, a screenshot, the build). Adding the runner is itself a
deliberate step, never a silent mid-step install. This is the single definition
of the switch; the skills and `ai-interaction.md` only point back here.

- **What to test (the scope rule):** pure logic where a wrong answer is possible -
  parsers, formatters, validators, id/slug builders, server actions. These have
  assertable inputs and outputs and real edge cases (empty, missing, malformed).
- **What not to test:** UI components and integration-level surfaces (render or
  export routes, anything driving a real browser or external service). Verify those
  with a screenshot and the build, not brittle unit tests.
- **The gate (when a runner is configured):** a build step that adds in-scope logic
  must ship a passing test in the same reviewable diff. The project's test command
  must be green before the step is approved, before any checkpoint commit, and
  before `/complete` merges. UI and integration-only steps are exempt and ride on
  screenshot plus build evidence.
- **When it's named:** the `/feature` spec's Testing section predicts the coverage,
  `/implement` writes the test with the step, and if a step surfaces logic the spec
  didn't foresee, add a focused test then.
- An empty suite should fail, not pass, so "no tests ran" never looks like "passed".
- Test files live next to source files (for example `feature.test.ts`).
- Run them via the project's test command (see Commands in `AGENTS.md`), not a
  hardcoded tool name.

Stack binding: this is a TypeScript Next.js app and Vitest is configured as its
runner (`npm test`), with `vi.mock()` for external dependencies and
`vi.useFakeTimers()` for time-dependent logic. The test gate is active for
logic-bearing steps.

## Browser Verification

For UI and integration behavior, prefer real browser evidence over reading the
code and assuming it works.

- Browser automation is separately opt-in through `/tests browser`. That setup
  reuses a compatible runner or prefers Playwright for supported projects, then
  documents the exact command as `Browser tests` in `AGENTS.md`.
- When `Browser tests` is declared, add focused coverage for stable behavioral
  done-whens when it is proportionate, and run the documented command during
  `/check`. Do not assume it proves visual fidelity, real authenticated-profile
  behavior, browser chrome, or another claim the test does not observe.
- If no Browser tests command is declared, do not add a runner silently in the
  middle of an unrelated feature. Use the available dev server, browser
  screenshots, build output, API output, or manual evidence instead.
- Browser tests are not part of the default Verify command or CI unless the user
  separately chooses that slower gate.
- Browser evidence is especially important for flows that click, type, submit,
  navigate, download files, render complex layouts, or depend on client-side
  state.

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible

## Comments

Write code that explains itself; comment only what the code cannot say.
Over-commenting is a common AI tell, so resist it.

- Comment the **why**, not the **what**. Delete any comment that restates the code.
- No banner/header blocks, section dividers, or step-by-step narration of obvious
  code. A file does not need a comment announcing each region.
- A comment earns its place only when it captures something the code can't: a
  non-obvious decision, a gotcha or workaround, why a value is what it is, or a
  link to a spec or issue.
- Prefer self-documenting names and small functions over explanatory comments.
- Keep doc comments minimal: a one-line purpose on an exported type or function is
  plenty; don't write JSDoc that just repeats the signature.
- When in doubt, leave the comment out.

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages,
  READMEs, specs. They read as AI-generated.
- Use a hyphen for `term - description` separators; rephrase prose with commas,
  parentheses, or a colon. Avoid en dashes and the ellipsis character too.
