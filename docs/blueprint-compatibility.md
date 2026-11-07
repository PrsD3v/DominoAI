# Blueprint compatibility assessment

> Decision record for build-plan feature 12. It answers whether Domino can
> consume AI Blueprint definitions as-is or must map them into Domino's own
> model, and it is written before any import or mapping code exists.

## Environment

| Item | Value |
| --- | --- |
| Assessment date | 2026-11-07 |
| Installed Blueprint version | `1.13.0`, from `blueprint/.state/manifest.json` |
| Upstream repository | `https://github.com/aiblueprinthq/ai-blueprint` |
| Upstream release | `1.13.0` |
| Upstream revision | `a31461341770fe2fc88b0372fc9f49f15acda652`, 2026-10-11, `chore: prepare 1.13.0 release (#37)` |
| Upstream package | `create-ai-blueprint` `1.13.0` |
| Domino model under comparison | `src/types/workflow-definition.ts` |

Method: read the installed workspace artifacts, then read the upstream parser
sources and maintainer validation at the pinned revision. No Blueprint skill was
executed, and no Reasonix session was started.

The upstream checkout used for this reading was a local sibling clone. The
durable reference is the public repository and the revision above, not the local
path.

## License

AI Blueprint is MIT licensed. The root `LICENSE` and
`packages/create-ai-blueprint/LICENSE` both carry this notice:

```text
MIT License

Copyright (c) 2026 Brad Traversy
```

The grant permits use, copy, modification, merging, publication, distribution,
sublicensing, and sale, provided the copyright notice and permission notice are
included in all copies or substantial portions of the software. The software is
provided without warranty.

Consequences for Domino:

- Reading and describing the format creates no obligation.
- Copying substantial portions of Blueprint files into Domino requires
  preserving the upstream copyright and permission notice.
- The license is permissive, not copyleft, so it does not constrain Domino's own
  MIT distribution.
- Domino's `LICENSE` is not a substitute for the upstream notice when upstream
  content is copied.

## Definition surfaces

| Surface | Path | Machine-readable form | Upstream consumer | Workflow-definition semantics |
| --- | --- | --- | --- | --- |
| Project config | `blueprint/config.json` | JSON with `schemaVersion` 1, strict known keys, enumerated values | `parseProjectConfig` in `packages/create-ai-blueprint/lib/project-config.ts`; also checked by `scripts/validate-blueprint.ts` | Policy only: step review, checkpoint commits, Git landing, verification, review execution, quality gates, continuous limits. No steps, skills, or approval bindings. |
| Build plan | `blueprint/build-plan.md` | Markdown checklist | `parseBuildPlan` in `packages/create-ai-blueprint/lib/build-plan.ts` | Roadmap items. The parser reads checkbox state, an optional `NN` or `NNa` id, a bold or first-segment title, indentation depth, and line number, then classifies leaf and split-parent items. Acceptance prose is not parsed. |
| Project plan | `blueprint/project-plan.md` | Prose | Read as prose by `overview`; hashed for overview freshness by `lib/status.ts` | Product intent. No structured parser and no schema. |
| Project overview | `blueprint/context/project-overview.md` | Generated prose with a `blueprint:source-hash` fingerprint | `lib/status.ts` checks the fingerprint against the two plans | Generated summary. No workflow definition. |
| Current work | `blueprint/context/current-feature.md` | Markdown with type, title, status, build-plan identity, and checkbox steps | `parseCurrentWork` in `lib/current-work.ts` | Active spec state. The parser reads the work type, title, status, build-plan item, and each checklist step's checked state and title. The steps are build instructions, not engine steps. |
| Findings | `blueprint/context/findings.md` | Markdown headings with id, severity, and status | `parseFindings` in `lib/findings.ts` | Review ledger. The parser reads `### <id> [P0-P3] <status> - <title>` headings and counts blockers. No workflow definition. |
| Independent review | `blueprint/context/review.md` | Markdown `**Field:** value` lines with hashes and state vocabulary | `parseIndependentReview` in `lib/review.ts` | Review request or receipt. The parser reads status, target and base commits, spec hash, snapshot path, execution pairing, verdict, and check result. No workflow definition. |
| Agent skills | `.agents/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md` | Markdown with `name`, `description`, and optional `disable-model-invocation` frontmatter | Agent runtime reads the body as instructions; `scripts/validate-blueprint.ts` validates frontmatter, adapter parity, and cross-references | Prose playbooks. The body is prompt content, not an executable step graph. |
| Install manifest | `blueprint/.state/manifest.json` | JSON with `schemaVersion`, `version`, `adapters`, `managedFiles` hashes | `readManifest` in `lib/update.ts`; `lib/project-metadata.ts` | Installer metadata. No workflow semantics. |
| History | `blueprint/history/{features,fixes,rollbacks}/*.md` | Markdown archives with type, title, and status fields | `parseHistoryItem` in `lib/history.ts` | Completed-work records. No workflow definition. |
| Interaction and standards | `blueprint/context/ai-interaction.md`, `blueprint/context/coding-standards.md` | Prose | Agents read them as instructions | Conventions, no parser and no schema. |
| Activity state | `blueprint/.state/run.json` | JSON activity record | `lib/run-state.ts` | Excluded from this assessment. It is generated dashboard state, not a definition surface. |

## What the parsers do not provide

The surfaces above are real, and several have line-oriented parsers. None of
them produces an executable workflow definition:

- No file carries an ordered list of executable engine steps.
- No surface binds a step to a skill version id.
- No approval point is bound to a step.
- No error policy is attached to a step or run.
- No workflow identity or immutable workflow version is recorded.
- Approval, pause, retry, and failure behavior live in skill prose that an agent
  interprets. The maintainer validation checks that prose exists and stays
  aligned across adapters; it does not compile it.

The `config.json` policy describes when checks and reviews should run. It does
not describe which steps run, in what order, or where approval pauses.

## Comparison with Domino's model

Domino's model in `src/types/workflow-definition.ts` is a versioned,
validated definition:

- `WorkflowDefinition` and `SkillDefinition` are editable containers.
- `WorkflowVersion` is an immutable snapshot with ordered `steps`,
  `approvalPoints`, an `errorPolicy`, a positive `version`, and `publishedAt`.
- `WorkflowStepDefinition` has a `key`, non-empty `skillVersionIds`, an optional
  `approvalPointKey`, an optional `errorPolicy`, an optional
  `workingDirectory`, and an optional retry policy.
- `ApprovalPointDefinition` has a `key` and `message`.
- `SkillVersion` holds Markdown `content`, a positive version, and
  `publishedAt`.
- Validation rejects unknown fields, duplicate keys, missing references, empty
  content, invalid timestamps, and secret-like fields.

| Criterion | Evidence | Result |
| --- | --- | --- |
| Machine-readable validation | `config.json`, `build-plan.md`, and the state ledgers have parsers. Skills, plans, and prose have no schema. No parser emits a workflow definition. | Partial |
| Semantic completeness | No surface carries ordered engine steps, per-step skill references, approval bindings, error policy, or workflow version identity. | Fail |
| Versioned stability | `config.json` has `schemaVersion` 1 and the installer records version `1.13.0`. No published schema or compatibility policy exists for skill or plan semantics, and maintainer validation is release-specific. | Weak |
| License fit | MIT with a notice condition and no copyleft. | Pass |
| Runtime independence | Skill bodies are written for agent adapters and human invocation. Consuming them as execution definitions imports Blueprint-specific behavior into Domino's engine. | Fail for as-is |
| Reversibility | An importer couples Domino to an unversioned prose format. No import keeps the model independent. | Pass for no import, fail for as-is |

Decision rule: an as-is result is allowed only when every surface can be
validated deterministically and carries ordered steps, skill references,
approval bindings, error policy, and version identity without an LLM in the
loop. The evidence does not meet that rule.

## Mapping

| Blueprint surface | Domino type | Mapping |
| --- | --- | --- |
| `blueprint/config.json` | None | No mapping. Policy is not a workflow version, and Domino project configuration is its own concern. |
| `blueprint/build-plan.md` | None | No mapping. Roadmap items are not run steps. |
| `blueprint/project-plan.md` | None | No mapping. Product prose. |
| `blueprint/context/project-overview.md` | None | No mapping. Generated summary. |
| `blueprint/context/current-feature.md` | None | No mapping to `WorkflowVersion`. A spec is not a run, and its checklist steps are build instructions. |
| `blueprint/context/findings.md` | None | No mapping. Review ledger, not a definition. |
| `blueprint/context/review.md` | None | No mapping. Review receipt, not a definition. |
| `.agents/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md` | `SkillVersion.content`, manual only | Skill text can be copied into a new `SkillVersion` after human review. Frontmatter and invocation semantics have no Domino field. No `WorkflowVersion` mapping. |
| `blueprint/.state/manifest.json` | None | No mapping. Installer metadata. |
| `blueprint/history/*.md` | None | No mapping. Completed-work prose; Domino run history is its own persistence. |
| `blueprint/context/ai-interaction.md`, `blueprint/context/coding-standards.md` | `SkillVersion.content`, manual only | Reference text can be copied after human review. No structural mapping. |
| `blueprint/.state/run.json` | None | Excluded. Activity state, not a definition. |

## Decision

Do not consume AI Blueprint definitions as-is. Do not build a Blueprint importer
in the MVP.

Domino workflow definitions remain Domino-owned and versioned in the model in
`src/types/workflow-definition.ts`. Blueprint skill text may be reused only by a
human-reviewed copy into a new Domino `SkillVersion`, with the upstream MIT
notice preserved when the copied portion is substantial. No Blueprint file is
read at run time, and no prose workflow semantics are mapped into a
`WorkflowVersion`.

This is the "no import" outcome, with one narrow manual path for skill content.

## Rejected alternatives

- **Consume as-is.** It fails semantic completeness and deterministic
  validation. Making it work would require an LLM to turn prose into steps,
  approvals, and error handling, so the same input could produce different runs
  and would not be verifiable.
- **Build a general importer now.** No current requirement asks for it. Feature
  13 can use Domino-owned skills, and an importer would add a compatibility
  surface with no user. That conflicts with proportional engineering.
- **Map every surface into Domino.** The build plan, spec, findings, review, and
  history are roadmap and state, not executable definitions. Mapping them would
  conflate separate concepts that the project plan keeps distinct.

## Consequences

- Feature 13 and the central library use Domino-owned skills. The delivery proof
  must not depend on a Blueprint definition.
- Domino can run in a Blueprint-initialized project without reading or rewriting
  Blueprint files.
- A future opt-in import, if requested, is a separate feature with human review,
  a one-way copy into Domino's own model, and no semantic-equivalence claim.
- The product plan's open decision about Blueprint consumption is resolved by
  this record.

## Not claimed

- No proof that a Blueprint workflow runs on Reasonix or through ACP.
- No proof that copied skill text produces the same behavior when delivered by
  Domino.
- No claim that `blueprint/config.json` maps to Domino project configuration.
- No assessment of Blueprint versions after `1.13.0`.
- No execution of any Blueprint skill during this assessment.
