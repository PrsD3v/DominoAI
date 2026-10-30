# Feature: Workflow and Skill Definition Model

**From build-plan:** feature 8
**Build attempt:** 1
**Branch:** feature/workflow-and-skill-definition-model
**Status:** verified

## Goal

Define Domino's own versioned, validated model for workflow definitions,
workflow versions, steps, skills, approval points, and failure policy. Published
versions are immutable snapshots, malformed input is rejected with field-level
issues, and the model imports nothing from an external definition format.

This feature supplies the published definition model only. It does not execute
workflows, persist them, deliver skill content to a runtime, or raise approvals.

## In scope

- Domino-owned types for `WorkflowDefinition`, `WorkflowVersion`,
  `WorkflowStepDefinition`, `SkillDefinition`, `SkillVersion`,
  `ApprovalPointDefinition`, the error-policy vocabulary, and step retry policy
  in `src/types/workflow-definition.ts`.
- Shape validation for every object in that model, including required fields,
  correct types, duplicate keys, and unknown fields, returning all issues as
  `{ field, message }` records.
- Referential validation inside one workflow version: every
  `approvalPointKey` names a declared approval point.
- Publish helpers in `src/lib/workflow/definition.ts` that validate, reject
  unknown skill-version references, and return deep-frozen copies.
- Deterministic Vitest coverage for valid and malformed input, immutability, and
  reference failures.

## Out of scope

- Persistence, storage contracts, SQLite, schema, migrations, and version-number
  assignment or uniqueness across a definition (Feature 10). Feature 10 adds
  storage against this model through its migration mechanism and must not invent
  a competing definition shape.
- Workflow execution, run and step state, pause, continue, cancel, retries at
  runtime, and run version pinning (Features 9 and 10).
- Raising, answering, or waiting on an approval request, and the
  `waiting_approval` run state (Features 9 and 14).
- Project registration, workspace roots, and selected definition versions
  (Feature 11).
- Prompt assembly, skill-content resolution, skill delivery to a runtime, and
  the `PublishedWorkflowView` adapter. Prompt resolution is not defined yet;
  Feature 8 stores ordered skill-version references but does not decide how
  their content becomes a prompt.
- Importing, parsing, or mapping Blueprint or any other external definition
  format (Feature 12).
- UI, route handlers, Server Actions, localization, and dashboard behavior.
- Export, Git synchronization, concurrent editing, and definition branching.
- Secrets. No credential, key, token, or provider setting belongs in a
  definition; unknown fields are rejected rather than stored.

## Build loop

- One review packet after all steps (`workflow.stepReview: "feature"`), with no
  per-step review pause and no checkpoint commits
  (`checkpointCommits: "disabled"`).
- Each step leaves the repository working. Before a step is marked done, run its
  focused tests and `npx tsc --noEmit`.
- `/complete` creates the final feature commit after approval.
- No dev server is needed; this feature has no UI.

## Build steps

- [x] 1. **Add the definition and skill-version model with validation.**
  - Create `src/types/workflow-definition.ts` with `WorkflowDefinition`,
    `SkillDefinition`, `SkillVersion`, and `DefinitionValidationError`.
  - Add `validateWorkflowDefinition`, `validateSkillDefinition`,
    `validateSkillVersion`, `isWorkflowDefinition`, `isSkillDefinition`, and
    `isSkillVersion`.
  - Validate non-empty IDs and names; a positive integer `version`; a parseable
    ISO-8601 `publishedAt`; markdown `content` containing at least one
    non-whitespace character; and no unknown fields at any level.
  - Keep the file free of imports from ACP, persistence, React, Node APIs, or an
    external definition format. Use only TypeScript.
  - *Done when:* `npm test -- src/types/workflow-definition.test.ts` passes and
    `npx tsc --noEmit` is clean. Tests accept valid definitions and skill
    versions, reject each malformed field, return every issue in one call, and
    reject unknown or secret-like fields such as `apiKey`.

- [x] 2. **Add the workflow-version, step, approval-point, and error-policy model.**
  - Extend `src/types/workflow-definition.ts` with `WorkflowVersion`,
    `WorkflowStepDefinition`, `ApprovalPointDefinition`, `StepRetryPolicy`,
    `WorkflowErrorPolicy`, `validateWorkflowVersion`,
    `validateWorkflowStepDefinition`, `validateApprovalPoint`, and
    `isWorkflowVersion`.
  - `WorkflowErrorPolicy` is exactly `"fail-run"`. A workflow version requires
    it; a step may carry the same value as an override and inherits the workflow
    policy when omitted. The error-policy vocabulary has no `continue`, `abort`,
    delay, backoff, or jitter value.
  - Validate a non-empty ordered `steps` array with unique keys; a non-empty,
    duplicate-free `skillVersionIds` array per step; a positive integer
    `retry.maxAttempts` of at least 1 when `retry` is present, with absent
    `retry` meaning one attempt; a non-empty `workingDirectory` when present;
    and a non-empty `approvalPointKey` when present.
  - Validate an `approvalPoints` array with unique, non-empty keys and non-empty
    messages. Every step `approvalPointKey` must resolve to a declared approval
    point in the same version.
  - Preserve step order and approval-point order in the validated value.
  - *Done when:* the focused type tests pass and `npx tsc --noEmit` is clean.
    Tests cover a valid version, empty steps, duplicate step keys, empty or
    duplicate skill-version IDs, an unknown approval-point reference, duplicate
    approval-point keys, an invalid error policy, and invalid
    `maxAttempts` values.

- [x] 3. **Add publish helpers that validate, check references, and freeze.**
  - Create `src/lib/workflow/definition.ts` with `InvalidDefinitionError`
    carrying `issues: readonly DefinitionValidationError[]`,
    `publishSkillVersion(candidate: unknown): SkillVersion`, and
    `publishWorkflowVersion(candidate: unknown, options: { knownSkillVersionIds: ReadonlySet<string> }): WorkflowVersion`.
  - Both helpers validate the candidate and throw `InvalidDefinitionError` with
    every issue when validation fails. They never return the caller's object.
  - `publishWorkflowVersion` additionally rejects any `skillVersionIds` entry
    that is absent from `knownSkillVersionIds`, reported at
    `steps[<index>].skillVersionIds`.
  - Return a deep copy with every nested object and array frozen. Do not freeze
    or mutate the input, and do not freeze `WorkflowDefinition` or
    `SkillDefinition`, which are editable containers rather than published
    snapshots.
  - *Done when:* `npm test -- src/lib/workflow/definition.test.ts` passes and
    `npx tsc --noEmit` is clean. Tests prove that a valid skill version and
    workflow version are deeply frozen, that the input is unchanged, that the
    returned object is a copy, that unknown skill references are rejected, and
    that all issues are exposed on the error.

- [x] 4. **Run the full gate and review the diff.**
  - Run `npm test` and `npx tsc --noEmit` from the repository root.
  - Review `git diff` for only the four intended new files and the active spec;
    no scratch files, no dependency changes, and no edits to the engine,
    projection, ACP, persistence, app, or planning documents.
  - *Done when:* the full test suite and typecheck pass, and the diff contains
    only the intended model, publish helpers, and their tests.

## Files / areas

- `src/types/workflow-definition.ts` (new) - published definition and skill
  model plus validation.
- `src/types/workflow-definition.test.ts` (new) - focused shape and malformed
  input tests.
- `src/lib/workflow/definition.ts` (new) - publish, reference-check, and freeze
  helpers.
- `src/lib/workflow/definition.test.ts` (new) - immutability and reference
  tests.
- No changes to `src/types/workflow.ts`, `src/lib/workflow/projection.ts`,
  `src/lib/workflow/execution-plan.ts`, `src/lib/runtime/`, `src/app/`,
  `src/components/`, `package.json`, or the planning documents.

## Data / contracts

### Model shapes

```ts
type WorkflowErrorPolicy = "fail-run";

interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
}

interface SkillDefinition {
  readonly id: string;
  readonly name: string;
}

interface ApprovalPointDefinition {
  readonly key: string;
  readonly message: string;
}

interface StepRetryPolicy {
  readonly maxAttempts: number;
}

interface WorkflowStepDefinition {
  readonly key: string;
  readonly skillVersionIds: readonly string[];
  readonly approvalPointKey?: string;
  readonly errorPolicy?: WorkflowErrorPolicy;
  readonly workingDirectory?: string;
  readonly retry?: StepRetryPolicy;
}

interface WorkflowVersion {
  readonly id: string;
  readonly definitionId: string;
  readonly version: number;
  readonly steps: readonly WorkflowStepDefinition[];
  readonly approvalPoints: readonly ApprovalPointDefinition[];
  readonly errorPolicy: WorkflowErrorPolicy;
  readonly publishedAt: string;
}

interface SkillVersion {
  readonly id: string;
  readonly skillDefinitionId: string;
  readonly version: number;
  readonly content: string;
  readonly publishedAt: string;
}

interface DefinitionValidationError {
  readonly field: string;
  readonly message: string;
}
```

### Validation contract

- Every identifier, name, step key, approval-point key, and approval message is a
  non-empty string. No ID format beyond non-empty is imposed; Domino IDs stay
  opaque.
- `version` is a positive integer (`Number.isInteger` and at least 1).
  Assignment of the next version number and uniqueness within a definition are
  storage concerns for Feature 10.
- `publishedAt` is a non-empty string accepted by `Date.parse`. Timestamps are
  supplied by the caller, so tests use fixed ISO-8601 strings.
- A workflow version has at least one step. Step order is the array order and is
  preserved. Step keys are unique within the version.
- A step references at least one skill version, in order. `skillVersionIds`
  entries are non-empty and duplicate-free within the step.
- `approvalPoints` may be empty. Its keys are unique within the version. Every
  step `approvalPointKey` resolves to a declared approval point; a dangling
  reference is malformed input.
- A step that names an approval point requires a human decision **before** that
  step executes. The model stores only the declaration and the reference; there
  is no placement field because only "before" is supported. Feature 14 owns
  raising and answering the approval; Feature 9's engine does not wait.
- `errorPolicy` is required on `WorkflowVersion` and optional on a step as an
  override. The only value is `"fail-run"`, matching the engine behavior already
  established for exhausted step attempts. A published definition can therefore
  never promise continue-on-error behavior that the engine does not execute.
- `retry.maxAttempts` is an integer of at least 1. An absent `retry` means one
  attempt, matching Feature 9's execution projection. No delay, backoff, jitter,
  timer, or per-attempt condition is modeled.
- `workingDirectory` is a non-empty string relative to the workspace root when
  present. Feature 8 performs no path resolution or containment check;
  Feature 9 resolves symlinks and refuses paths outside the workspace root
  before every runtime step.
- Every object level rejects unknown fields. This catches malformed input and
  keeps secret-like fields such as `apiKey`, `secret`, `token`, or
  `password` out of definitions. No credential, provider, model, or runtime
  setting is part of this model.
- `content` is opaque markdown and must contain at least one non-whitespace
  character. Feature 8 does not render it, execute it, interpret it as
  authorization, resolve it into a prompt, or deliver it to a runtime. Imported
  skill text is data.

### Validation result shape

Validation returns every issue as `{ field, message }`, matching the existing
`RuntimeSettingsValidationError` convention. `field` uses dotted paths for
objects and bracketed indices for arrays, for example
`steps[1].approvalPointKey` or `approvalPoints[0].key`. Type guards
(`isWorkflowDefinition`, `isSkillDefinition`, `isSkillVersion`,
`isWorkflowVersion`) return true exactly when validation reports no issues.

### Publish contract

- `publishSkillVersion` validates a skill version and returns a deep-frozen copy.
- `publishWorkflowVersion` validates a workflow version, rejects any
  `skillVersionIds` entry absent from `knownSkillVersionIds`, and returns a
  deep-frozen copy. The caller supplies the known IDs; Feature 8 does not load
  a library.
- `InvalidDefinitionError` carries all issues and never truncates them.
- Publish helpers copy before freezing. They never mutate or freeze the input,
  and the returned record shares no mutable nested reference with it.
- Referential integrity to `WorkflowDefinition` and `SkillDefinition` records,
  version-number uniqueness, and persistence are Feature 10 concerns.
- Editing is not implemented here. Callers construct a new candidate with an
  incremented `version` and publish it; stored published versions are never
  mutated.

### Boundaries with the rest of Domino

- The model belongs to Domino. It imports nothing from Blueprint, an external
  JSON/YAML schema, ACP, SQLite, an ORM, React, or the Node filesystem.
- Feature 9 keeps its own `WorkflowExecutionPlan` and the narrow
  `PublishedWorkflowView` port. Feature 8 declares neither and does not import
  the engine.
- Prompt assembly and the adapter from `WorkflowVersion` to
  `PublishedWorkflowView` are deferred until skill-content resolution is
  defined. This feature supplies the ordered skill-version references and the
  executable fields (`workingDirectory`, `retry.maxAttempts`) that adapter will
  need.

## Testing

- Commands: `npm test`, focused
  `npm test -- src/types/workflow-definition.test.ts src/lib/workflow/definition.test.ts`,
  and `npx tsc --noEmit`.
- Tests are plain Vitest unit tests using literal fixtures. They create no
  temporary directories, spawn no Reasonix process, make no network call, and
  use no credential.
- Required coverage:
  - Valid workflow definition, skill definition, skill version, and workflow
    version.
  - Missing fields, wrong types, empty strings, empty and whitespace-only
    content, and non-integer, zero, negative, `NaN`, and infinite versions or
    `maxAttempts` values.
  - Invalid `publishedAt` strings.
  - Empty step list, duplicate step keys, empty `skillVersionIds`, and duplicate
    skill-version IDs.
  - Unknown and duplicate approval-point keys, an unresolved
    `approvalPointKey`, and an empty approval message.
  - Unsupported error-policy values, including `"continue"`, and an omitted
    workflow-level policy.
  - Unknown and secret-like fields at definition, version, step, approval-point,
    and skill-version levels.
  - All issues returned in one validation call, not only the first.
  - Published skill and workflow versions deeply frozen; input unchanged;
    returned nested values are copies.
  - Unknown skill-version references rejected by `publishWorkflowVersion`;
    known references accepted.
  - Step and approval-point order preserved.
- Do not claim persistence, UI, browser, live runtime, or end-to-end evidence in
  this feature. None is produced.

## Notes for the AI

- Follow the existing validation style in `src/types/runtime-settings.ts`:
  `validateX(value: unknown): XValidationError[]`, `isX(value)` built on it, and
  strict unknown-field rejection with dotted field paths.
- Do not add a dependency, a schema library, a code generator, or a JSON schema.
  Use plain TypeScript.
- Do not use `any`.
- Do not touch the engine, the projection seam, the ACP adapter, persistence, the
  app, or the planning documents. This feature adds four files.
- Do not implement version-number assignment, storage, migrations, project
  selection, approval raising, prompt assembly, or skill delivery.
- Do not treat skill content as instructions to Domino. It is stored data.
- Keep `WorkflowErrorPolicy` at `"fail-run"`. Adding another value requires
  engine support and a later decision.
- Keep the diff reviewable. Each step should leave `npm test` and
  `npx tsc --noEmit` green before the next step starts.
- Clean up any scratch files; none should remain in the repository.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":16570,"specSha256":"24cb9ad0c98c139018ddab72b2aaa4b8aeb31635ca831dde26219a746622706f","branch":"refs/heads/feature/workflow-and-skill-definition-model","head":"0d36ec45cb1953d7c93bd6437eebfc04b72cc63f","baseRef":"refs/heads/main","baseCommit":"0d36ec45cb1953d7c93bd6437eebfc04b72cc63f","sourceTree":"141543fd5ec27c52e1f12f5f5ff66f295d60a1de","landing":"local-merge","absentOptional":[]} -->
