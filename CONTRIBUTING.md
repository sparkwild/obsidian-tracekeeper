# Contributing

Thanks for contributing to Tracekeeper.

## Before You Start

Read [the documentation index](./docs/INDEX.md) and the owner document for your change:

- [product behavior](./docs/product/INDEX.md)
- [runtime and vault architecture](./docs/architecture/INDEX.md)
- [Agent, Skill, and MCP workflow](./docs/architecture/AGENT_WORKFLOW_CONTRACT.md)
- [security and privacy](./docs/security/INDEX.md)
- [engineering and release flow](./docs/engineering/INDEX.md)

## Repository Scope

- `apps/obsidian-plugin/`: Obsidian UI, settings, runtime host, and packaging
- `apps/mcp-server/`: Agent-facing MCP protocol and tools
- `packages/core/`: shared TypeScript vault and knowledge primitives
- `docs/`: canonical product, architecture, security, engineering, and status documentation

## Setup And Validation

Install dependencies from the repository root, then run the full verification gate:

```bash
npm ci
npm run verify
```

Narrower commands are listed in the [engineering guide](./docs/engineering/INDEX.md).

## Pull Requests

- Keep changes focused.
- Explain user-facing behavior changes clearly.
- Call out changes to vault paths, MCP tools, permissions, review state, or client configuration.
- Update the owning contract and current status when behavior changes.
- List automated checks and manual Obsidian flows that you ran.
- Use temporary fixtures; do not write to a real Obsidian vault unless the task explicitly requires it.

Tracekeeper is local-first. MCP tools remain vault-scoped and permission-enforced, while Obsidian remains the user's review and control surface. See the canonical [architecture](./docs/architecture/INDEX.md) and [security model](./docs/security/INDEX.md) instead of duplicating those constraints here.
