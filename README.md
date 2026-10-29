# DominoAI

A local-first workflow control layer for AI coding agents, open source under MIT.

Domino defines and manages multi-step development workflows. A runtime such as
Reasonix CLI executes the steps, while Domino owns the state, the approvals, and
the history.

> **Status:** foundation only. The bilingual UI shell, language switcher, and test
> setup exist. The runtime adapter, workflow engine, persistence, and dashboard are
> the next build-plan features.

## Architecture

Domino sits between the operator and an agent runtime:

| Layer | Responsibility | Status |
| --- | --- | --- |
| Dashboard | Next.js 16 App Router, server-rendered, English and Persian RTL | shell exists |
| Workflow Engine | Run state, step ordering, pause, continue, cancel, history | planned |
| Runtime adapter | ACP client for the agent runtime; first target is Reasonix | planned |
| Persistence | SQLite behind an application-owned interface | planned |
| Event delivery | Runtime events to the dashboard over a server-side stream | planned |

Control belongs to Domino. Execution belongs to the runtime. Domino never hosts
your code: it runs on your machine, next to the project it operates on.

## Bring your own runtime and API key

Domino does not ship a model, proxy inference, or require an account. You point it
at a runtime you installed and at the provider credentials that runtime already
uses. Keys, costs, and data stay on your machine.

The first adapter targets Reasonix CLI. Its observed ACP contract, split into
verified and unverified capabilities, is recorded in
[docs/reasonix-acp-contract.md](docs/reasonix-acp-contract.md).

## Requirements

- Node.js 24
- npm
- Reasonix CLI `v2.54.0` for the first runtime adapter

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. English is the default language; Persian is one
click away and the choice is kept across reloads.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npm test` | Vitest |

## Documentation

- [Project plan](blueprint/project-plan.md) - problem, users, data, decisions
- [Build plan](blueprint/build-plan.md) - ordered feature list
- [Project overview](blueprint/context/project-overview.md) - generated source of truth
- [Reasonix ACP contract](docs/reasonix-acp-contract.md) - observed capabilities

## License

MIT. See [LICENSE](LICENSE).
