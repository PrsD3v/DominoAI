# Feature: Blueprint compatibility assessment

**From build-plan:** feature 12
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/blueprint-compatibility-assessment`

## Goal

Decide from recorded evidence whether Domino can consume AI Blueprint definitions
as-is or must map them into Domino's own definition model, and publish that
decision before any import or mapping code exists.

The decision gates feature 13 and the central definition library. An as-is
assumption would bind Domino's engine to a format whose workflow semantics are
carried by prose skills rather than by a validated step graph.

## In scope

- Assess the installed Blueprint version in this workspace, which
  `blueprint/.state/manifest.json` reports as `1.13.0`, against the matching
  upstream release source.
- Inventory every Blueprint definition surface: `blueprint/config.json`,
  `blueprint/build-plan.md`, `blueprint/project-plan.md`,
  `blueprint/context/*.md`, the `.agents/` and `.claude/` skill trees,
  `blueprint/.state/manifest.json`, and `blueprint/history/`.
- Record the upstream license and the attribution obligations it places on reuse.
- Compare those surfaces with Domino's model in `src/types/workflow-definition.ts`
  and record one decision: consume as-is, map into Domino, or do not import.
- Publish the assessment as `docs/blueprint-compatibility.md` and link it from
  the README documentation list.
- With explicit approval, reconcile the product plan's open decision about
  Blueprint consumption with the recorded decision.

## Out of scope

- Any importer, parser, mapper, adapter, schema, migration, or new dependency.
- Running, delivering, or installing a Blueprint skill; that proof belongs to
  feature 13.
- Mapping Blueprint skills to a runtime or claiming they execute through ACP.
- Regenerating or hand-editing `blueprint/context/project-overview.md`.
- Changing the build plan order, scope, or any other feature.
- Treating this assessment as proof that a Blueprint workflow can run on
  Reasonix.

## Build loop

`workflow.stepReview` is `feature`, so implement all three steps and present one
review packet after the last step. `workflow.checkpointCommits` is `disabled`; do
not create checkpoint commits. `/complete` makes the final feature commit. Each
step must leave the repository consistent.

Step 3 contains one approval pause that spec review does not replace. The exact
`blueprint/project-plan.md` edit is user-owned, so show the proposed change and
get approval before applying it. If the user declines, record that outcome
instead of editing the plan.

## Build steps

- [x] **Step 1 - Pin the evidence and inventory definition surfaces** - Create
  `docs/blueprint-compatibility.md` with Environment and Evidence sections.
  Record the assessment date, the installed version from
  `blueprint/.state/manifest.json`, and the upstream source repository, release
  version, and exact revision used. For each surface, record its path, whether a
  program parses it or an agent reads it as prose, and the upstream consumer.
  Record the upstream license grant, its attribution condition, and its
  copyright line.
  *Done when:* the document names the installed version and exact upstream
  revision, lists every in-scope surface in a table with path and consumer, and
  states the license grant and attribution condition. No row claims behavior
  that was not read in the workspace or the pinned upstream source.

- [x] **Step 2 - Compare against Domino's model and record the decision** - Add a
  criteria table with the evidence for machine-readable validation, semantic
  completeness, versioned stability, license fit, runtime independence, and
  reversibility. Add a mapping table from each Blueprint surface to a Domino type
  in `src/types/workflow-definition.ts` or to "no mapping". Choose as-is, map, or
  no import, then record rejected alternatives, consequences for feature 13 and
  later work, and a Not claimed list.
  *Done when:* the document states one decision, every criterion row cites
  inspected evidence, every in-scope surface appears in the mapping table, and
  the decision does not depend on an unsupported claim. An as-is result is
  allowed only when each surface can be validated deterministically and carries
  ordered steps, skill references, approval bindings, error policy, and version
  identity without an LLM in the loop.

- [x] **Step 3 - Publish and reconcile the plan** - Link the document from the
  README Documentation list. Confirm no module under `src/` reads a Blueprint
  definition file. Show the exact `blueprint/project-plan.md` change that
  resolves the open decision and apply it only after the user approves. If the
  user declines, record the pending state and reason in the document. Do not
  regenerate the overview.
  *Done when:* the README link resolves, a search of `src/` finds no read of
  `blueprint/config.json`, `blueprint/build-plan.md`, `blueprint/project-plan.md`,
  or a skill file, and the plan records the resolution or the document records
  the declined and pending plan edit. `npm run lint`, `npx tsc --noEmit`, and
  `npm test` pass.

## Files / areas

- `docs/blueprint-compatibility.md` - new decision record.
- `README.md` - one entry in the Documentation list.
- `blueprint/project-plan.md` - one open-decision entry, approval-gated. If the
  user declines, this file is unchanged and the document records why.
- Read-only evidence inputs: the installed Blueprint files in this workspace,
  `blueprint/.state/manifest.json`, and the upstream `aiblueprinthq/ai-blueprint`
  source at release `1.13.0`.
- No `src/` change.

## Data / contracts

This feature assesses an external format and introduces no persisted schema,
API, migration, or runtime contract.

The material external surfaces to record are:

- `blueprint/config.json`: `schemaVersion` 1, strict known top-level keys, and
  enumerated values for step review, checkpoint commits, landing, verification,
  independent review execution, quality gates, and continuous limits. Upstream
  parses it with `parseProjectConfig`.
- `blueprint/build-plan.md`: a Markdown checklist. Upstream parses checkbox
  state, an optional `NN` or `NNa` identifier, a bold or first-segment title,
  indentation depth, and line number, then classifies leaf and split-parent
  items. Acceptance prose is not parsed.
- Skill files: Markdown with `name`, `description`, and optional
  `disable-model-invocation` frontmatter. The body is prompt content interpreted
  by an agent, not an executable definition.
- `blueprint/.state/manifest.json`: `schemaVersion`, installed version, adapters,
  and `managedFiles` content hashes.
- Context, plan, and history files other than the build plan: prose and
  generated stubs, with no validation schema.

The decision output is one of: consume as-is, map into Domino, or do not import.
The record must state the boundary. If mapping is chosen, Domino owns the mapped
copy, never reads Blueprint files at run time, and does not claim semantic
equivalence.

## Testing

This feature adds no executable logic, so the test gate does not require a unit
test. Do not add a test that only asserts document text.

Verification is repository evidence plus the existing checks:

- Run `npm run lint`, `npx tsc --noEmit`, and `npm test` after step 3 to show the
  docs-only change leaves the existing suite green.
- Open the README link and the new document; confirm headings, tables, and links
  resolve and that each evidence row points to an inspected file.
- Inspect `git diff` and confirm only the intended files changed.

No Browser tests command is configured, and this feature has no browser surface.

## Notes for the AI

- Cite inspected files. Do not characterize a skill from its name or from the
  workflow it is supposed to follow.
- Do not write importer code, add a dependency, or create a schema because a
  later feature might need one.
- Do not infer the Blueprint license from Domino's `LICENSE`. Read the upstream
  license at the pinned revision.
- If the upstream source is unavailable, record the license criterion as
  unproven and stop the decision step. Do not guess.
- Keep the record factual and compact. State what was verified, what was not,
  and what later work must not assume.
- Do not edit the generated overview. Re-running `/overview` after the plan edit
  is outside this feature.
- Follow the project writing standard: no em dashes, en dashes, or ellipsis
  characters.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":8498,"specSha256":"c1867a9337915c4fbd14a8e60e8d03155c3edb6e1ef956fca12c69126930497f","branch":"refs/heads/feature/blueprint-compatibility-assessment","head":"e5e6211d2c6ffdd3d58c7d59abe8fa4294d6669d","baseRef":"refs/heads/main","baseCommit":"e5e6211d2c6ffdd3d58c7d59abe8fa4294d6669d","sourceTree":"ccffa80ef659a4aa422740b7f36356179c2fc788","landing":"local-merge","absentOptional":[]} -->
