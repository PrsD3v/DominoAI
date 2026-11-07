# Feature: Skill library and inline ACP prompt delivery

**From build-plan:** feature 13A
**Build attempt:** 1
**Branch:** feature/skill-library-and-inline-acp-prompt-delivery
**Status:** verified

## Goal

A workflow step that references published skill versions runs with their
markdown delivered as instructions over the existing ACP `session/prompt` call.
The selected versions are resolved from Domino's central library in the step's
declared order, composed deterministically, and pinned in the stored run plan.
Nothing is written into the target project, and no Reasonix plugin, extension,
or project-level Skill install is involved.

This feature supplies the library read path, prompt composition, projection, and
a local fake-runtime proof. The live behavioral proof is feature 13B and remains
blocked; 13A makes no claim that a model follows the delivered instructions.

## In scope

- A read-only skill library resolver over the existing
  `PublishedDefinitionPersistence` contract: `getSkillVersion` by id, preserving
  the requested order, rejecting duplicates and unknown ids with typed errors.
- Deterministic prompt composition from resolved `SkillVersion.content` values.
- Projection from a published `WorkflowVersion` to an executable
  `WorkflowExecutionPlan` whose step prompts are the composed skill content.
- Pinning the delivered skill version ids on each projected `ExecutionStep` and
  in the persisted run plan. No SQLite migration: the plan is stored as JSON.
- Backward-compatible plan decoding so runs written before this feature still
  load.
- A local end-to-end proof with the fake runtime: the composed text reaches
  `session/prompt` unchanged and in order, resolution failures happen before any
  session is created, and the target workspace tree is unchanged.
- Focused Vitest coverage for the resolver, composer, projection, plan decoding,
  and the local proof.

## Out of scope

- The live behavioral proof. Feature 13B owns the test that a real Reasonix
  session demonstrably uses the delivered instructions; it is blocked on the
  same disposable credential and writable Reasonix home as 3B and 6B.
- Any claim that model behavior changes. 13A proves delivery to the runtime
  boundary, not comprehension.
- Reasonix plugin installation, `[skills] paths`, plugin packages, and
  `_reasonix.io/session/reloadExtensions`. The inline prompt path is chosen
  because it needs no install and writes nothing.
- Writing skill content to the target workspace, a temporary file, a hidden
  directory, or `.agents/` / `.claude/`.
- Skill editor UI, definition create/update APIs, route handlers, localization,
  and dashboard screens. Seeding skills in tests uses the persistence contract.
- Changing project registration or treating the project's selected
  `skillVersionIds` as a delivery filter. The step binding is authoritative; the
  project list stays a registration-time selection.
- Changing the ACP adapter, session lifecycle, engine state machine, approvals,
  retries, pause/continue/cancel, or containment.
- New dependencies, external definition formats, Blueprint imports, or secrets.

## Build loop

- One review packet after all steps (`workflow.stepReview: "feature"`), with no
  per-step review pause and no checkpoint commits
  (`workflow.checkpointCommits: "disabled"`).
- Each step leaves the repository working. Before a step is marked done, run its
  focused tests and `npx tsc --noEmit`.
- `/complete` creates the final 13A commit after approval and archives this
  spec. Feature 13 stays open because 13B is unchecked.
- No dev server and no browser are needed; this feature has no UI.

## Build steps

- [x] 1. **Add the skill library resolver and prompt composer.**
  - Create `src/lib/workflow/skill-delivery.ts` with:
    - `SkillVersionLookup` - the minimal read port
      `getSkillVersion(id): Promise<SkillVersion | null>`, compatible with
      `PublishedDefinitionPersistence`.
    - `SkillDeliveryError` with a typed `code`, an optional opaque
      `skillVersionId`, and optional definition issues.
    - `resolveSkillVersions(lookup, skillVersionIds)`.
    - `composeSkillPrompt(skillVersions)`.
  - The resolver preserves request order, rejects a repeated id with
    `duplicate_skill_version`, and rejects an unknown id with
    `skill_version_not_found`. It accepts an empty request and returns an empty
    list; composition is what rejects an empty delivery.
  - The composer rejects zero versions with `empty_skill_selection` and a
    whitespace-only content with `invalid_skill_content`. Otherwise it joins the
    contents byte for byte, in the given order, with exactly `"\n\n"` between
    them. It never trims, rewrites, numbers, or adds headings.
  - Error messages name only the opaque version id. Skill content never appears
    in an error message.
  - *Done when:* `npm test -- src/lib/workflow/skill-delivery.test.ts` passes
    and `npx tsc --noEmit` is clean. Tests cover one skill, two skills in a
    fixed order, the exact join string, a missing id, a duplicate id, an empty
    request followed by an empty composition, whitespace-only content, and that
    the error carries the failing id but no content.

- [x] 2. **Pin delivered skill versions in the execution plan and decode them.**
  - Add optional `skillVersionIds?: readonly string[]` to `ExecutionStep` in
    `src/types/workflow.ts`, documented as the published versions delivered in
    that step's prompt, in composition order.
  - Extend `validateExecutionPlan` in `src/lib/workflow/execution-plan.ts`: when
    `skillVersionIds` is present it must be a non-empty array of unique,
    non-empty strings. Absent stays valid so feature 9 plans and existing tests
    do not change.
  - Extend `decodePlan` in `src/lib/workflow/sqlite/sqlite-store.ts` to accept
    the optional field and reject a malformed one, while continuing to load
    stored plans that omit it.
  - *Done when:* the focused execution-plan and sqlite-store tests pass and
    `npx tsc --noEmit` is clean. Tests cover accepted ids, rejection of empty,
    duplicate, and non-string values, a run round-trip that preserves the ids,
    and an older plan without the field that still decodes.

- [x] 3. **Project a published workflow version into a skill-composed plan.**
  - Add `projectWorkflowVersionWithSkills(workflowVersion, lookup)` to
    `src/lib/workflow/skill-delivery.ts`.
  - Validate the workflow version first with `validateWorkflowVersion` and throw
    `SkillDeliveryError` with code `invalid_workflow_version` and the
    definition issues when it fails.
  - For each step in order, resolve its `skillVersionIds`, compose the prompt,
    and build an `ExecutionStep` carrying `key`, `prompt`, `skillVersionIds`,
    and the step's optional `workingDirectory` and `retry`.
  - Map `workflowId` from `definitionId` and `workflowVersion` from `version`,
    then run `validateExecutionPlan` before returning. Never return a partial
    plan when any step fails to resolve.
  - *Done when:* the focused tests pass and `npx tsc --noEmit` is clean. Tests
    cover two steps with different skill sets, preserved step and composition
    order, preserved `workingDirectory` and `retry`, an empty step list rejected
    by the existing workflow-version validation, and a missing skill version
    rejecting the whole projection.

- [x] 4. **Prove local delivery end to end with the fake runtime.**
  - Add an integration block to `src/lib/workflow/skill-delivery.test.ts` that
    uses a temporary SQLite database, a temporary workspace with a marker file,
    and the real engine with a wrapped `createFakeRuntime` that records each
    `PromptRequest.text`.
  - Publish two skill versions through `publishSkillVersion` and the store, plus
    a workflow version whose first step binds both in a fixed order and whose
    second step binds one.
  - Assert every step prompt equals the deterministic composition, the recorded
    prompts arrive in workflow order, and the persisted run's
    `plan.steps[].skillVersionIds` match what was delivered.
  - Snapshot the workspace entries and file bytes before and after the run and
    assert they are identical. Assert a missing skill version throws before
    `createSession` is called, so no session is opened for an unresolvable step.
  - *Done when:* `npm test -- src/lib/workflow/skill-delivery.test.ts` passes and
    `npx tsc --noEmit` is clean. The proof uses no network, no Reasonix process,
    and no writes outside the temporary directories.

- [x] 5. **Run the full gate and review the diff.**
  - Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `git diff --check`
    from the repository root.
  - Review `git diff` and `git status` for only the intended files, the active
    spec, and the approved build-plan split. Remove scratch files.
  - Confirm no change to `src/lib/runtime/`, `src/app/`, `src/components/`,
    `src/i18n/`, `package.json`, `.agents/`, or `.claude/`, and no write outside
    the repository.
  - *Done when:* the full suite, typecheck, lint, and whitespace check pass, and
    the diff contains only the intended delivery, plan, store, and test changes.

## Files / areas

- `src/lib/workflow/skill-delivery.ts` (new) - resolver, composer, typed errors,
  and skill-aware projection.
- `src/lib/workflow/skill-delivery.test.ts` (new) - focused unit tests and the
  local fake-runtime proof.
- `src/types/workflow.ts` - optional `skillVersionIds` on `ExecutionStep`.
- `src/lib/workflow/execution-plan.ts` - plan validation for the optional field.
- `src/lib/workflow/execution-plan.test.ts` - focused validation tests.
- `src/lib/workflow/sqlite/sqlite-store.ts` - `decodePlan` compatibility.
- `src/lib/workflow/sqlite/sqlite-store.test.ts` - plan round-trip and legacy
  decoding tests.
- `blueprint/context/current-feature.md` (this spec) and the approved
  `blueprint/build-plan.md` split.
- No changes to the ACP adapter, runtime types, engine, persistence contracts,
  app routes, components, i18n catalog, or dependencies.

## Data / contracts

### Delivery contract

- Source of truth for which skills a step receives: the published
  `WorkflowStepDefinition.skillVersionIds` array, in declared order. This is the
  only model surface that binds a skill version to a step. A project's
  `skillVersionIds` list is not consulted and does not filter delivery.
- Resolution goes through `PublishedDefinitionPersistence.getSkillVersion`; the
  stored `SkillVersion.content` is treated as Domino-owned instruction content.
  No agent output, runtime event, or imported text is promoted to skill content.
- Delivery is exactly one ACP `session/prompt` text per step. No file, directory,
  plugin, config, `.env`, or extension change is made.
- Composition is the contents joined with `"\n\n"` in order, unchanged. The
  output is deterministic for the same versions.
- The run plan stores the composed prompt and the delivered version ids, so a
  run keeps the versions and instructions it started with.

### Plan shape

```ts
interface ExecutionStep {
  readonly key: string;
  readonly prompt: string;
  readonly skillVersionIds?: readonly string[];
  readonly workingDirectory?: string;
  readonly retry?: ExecutionRetryPolicy;
}
```

`skillVersionIds` is optional only for compatibility with plans projected
before this feature. The skill-aware projection always sets it. No SQLite
migration is required because `workflow_runs.plan_json` is already JSON.

### Errors

- `skill_version_not_found` - an id returned no stored version.
- `duplicate_skill_version` - the same id appeared twice in one request.
- `empty_skill_selection` - composition received no versions.
- `invalid_skill_content` - a version's content is empty or whitespace only.
- `invalid_workflow_version` - the projection input failed definition
  validation; the issues are attached.

Messages name at most the opaque skill version id. They never include content,
paths, or secrets.

## Testing

- Commands: `npm test` (Vitest), `npx tsc --noEmit`, `npm run lint`.
- Focused: `npm test -- src/lib/workflow/skill-delivery.test.ts`,
  `npm test -- src/lib/workflow/execution-plan.test.ts`,
  `npm test -- src/lib/workflow/sqlite/sqlite-store.test.ts`.
- Baseline at spec time: 547 passed, 4 skipped (`session-list`,
  `steering`, `transport`, and `runtime` live tests skip without
  `DOMINO_LIVE_ACP=1`).
- No browser test harness is configured, and this feature has no UI.
- No live test is added in 13A. The live behavioral proof belongs to 13B and
  cannot pass in this environment until a disposable credential and writable
  Reasonix home exist.

## Notes for the AI

- Do not install or modify anything under `~/.reasonix`. Do not use
  `[skills] paths`, plugin packages, or `_reasonix.io/session/reloadExtensions`.
  The chosen mechanism is prompt content over the existing ACP path.
- Do not write skill content into the target workspace or into `.agents/` /
  `.claude/`. The workspace-unchanged assertion is part of the acceptance.
- Keep `projectPublishedWorkflow` and its tests unchanged. The new projection is
  additive so feature 9's contract keeps working.
- Do not add UI, route handlers, or localization strings. The prompt itself is
  not user-facing UI text.
- Do not inject timestamps, ids, or per-run data into the plan prompts; the
  composition must stay deterministic.
- Preserve existing plan decoding for stored runs. Reject malformed new values
  rather than coercing them.
- Report 13A as locally proven only. Do not claim a model used the instructions;
  that claim waits for 13B.
- No app route starts workflow runs yet, so this delivery path is exercised by
  Vitest and the engine, like features 9 and 10. Do not add a route only to make
  it reachable; feature 14 wires run start.
- If the full gate exposes an unrelated pre-existing failure, report it instead
  of widening this feature.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":13928,"specSha256":"91c680c16ea7b2eeb5ea44e19d6df88869e35375a8f878d00110bdf6e8870c4e","branch":"refs/heads/feature/skill-library-and-inline-acp-prompt-delivery","head":"20bbe1099305ef356a9efdcd1e41f426287a9516","baseRef":"refs/heads/main","baseCommit":"20bbe1099305ef356a9efdcd1e41f426287a9516","sourceTree":"470010513f84be642f79b890b5a5c1e9739d9c03","landing":"local-merge","absentOptional":[]} -->
