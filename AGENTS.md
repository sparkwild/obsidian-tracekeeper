# Tracekeeper Repository Guide

This file routes coding agents through the repository. It is intentionally compact: durable product and architecture decisions belong under `docs/`, not in a growing instruction file.

## Product Frame

Tracekeeper is an Obsidian-native, local-first personal knowledge and AI-memory system.

- The user's local vault is the durable source of truth.
- Obsidian is the human workspace for maintenance, review, and control.
- The MCP runtime exposes bounded access to the vault while desktop Obsidian is running.
- A companion Agent Skill may teach agents when and how to use Tracekeeper, but it never grants permissions or replaces MCP enforcement.
- Tracekeeper is not a hosted SaaS, a remote synchronization service, or an autonomous owner of the user's knowledge.

Do not introduce a hosted control plane, external database, silent background upload, or automatic long-term-memory rewrite unless the product contract is explicitly changed first.

## Read Before Changing

Start with [docs/INDEX.md](docs/INDEX.md), then read the owner document for the change:

- Product purpose and long-term scope: [docs/overview/INDEX.md](docs/overview/INDEX.md)
- User-facing capabilities and workflows: [docs/features/INDEX.md](docs/features/INDEX.md)
- Agent, Skill, or MCP workflow: [docs/features/AGENT_WORKFLOW.md](docs/features/AGENT_WORKFLOW.md)
- Accepted stack and compatibility constraints: [docs/technology/INDEX.md](docs/technology/INDEX.md)
- Runtime, Vault layout, module ownership, or trust boundaries: [docs/architecture/INDEX.md](docs/architecture/INDEX.md)
- Build, test, release, security review, or contribution flow: [docs/development/INDEX.md](docs/development/INDEX.md)

Read the `INDEX.md` in a documentation area before adding a file there.

## Ownership Boundaries

| Owner | Responsibility | Must not become |
| --- | --- | --- |
| Vault | Durable notes, memory, sources, policy, and review artifacts | An opaque cache hidden from the user |
| Obsidian plugin | Runtime lifecycle, settings, human review, status, and confirmed client configuration | A second knowledge store or generic desktop shell |
| MCP runtime | Vault-scoped tools, permission enforcement, validation, and structured results | The place that teaches every agent workflow habit |
| Core package | Reusable parsing, scanning, recall, graph, lint, and path-safety primitives | A UI or client-specific integration layer |
| Agent Skill | Proactive recall/closeout habits and client-specific workflow guidance | A permission bypass or duplicate server implementation |

The normative Agent workflow lives in `docs/features/AGENT_WORKFLOW.md`. Tool descriptions, prompts, Skills, and onboarding copy should be derived from that contract and kept semantically aligned.

## Repository Map

```text
apps/obsidian-plugin/   Obsidian plugin, local runtime host, and human UI
apps/mcp-server/        Streamable HTTP MCP protocol and tool handlers
packages/core/          Shared vault and knowledge primitives
docs/                   Canonical product and engineering documentation
scripts/                Repository verification and packaging scripts
```

Module READMEs explain local usage only. Cross-module policy belongs in `docs/`.

## Implementation Rules

- Preserve vault-relative path checks and the active-vault boundary.
- Keep the production MCP runtime loopback-only and token-protected by default.
- Treat client configuration as an exceptional vault-outside write: preview it, require confirmation, preserve unrelated entries, and create a backup.
- Keep generated records inside Tracekeeper-controlled folders and avoid overwriting existing notes.
- Keep global durable memory review-gated by default. Project auto-save remains user-controlled, append-only, and linked to Wiki context.
- MCP migration and lint operations remain non-destructive. Destructive cleanup requires an explicit human action in Obsidian.
- Prefer Obsidian APIs and existing local UI primitives for plugin surfaces. Any UI dependency must justify bundle size, theme compatibility, accessibility, and maintenance cost.
- Never hardcode a developer home, repository, vault, configuration path, token, or local port.

## Validation

For code or release-facing changes, run:

```bash
npm run verify
```

Use narrower commands while iterating:

```bash
npm run community:check
npm run typecheck
npm run build
npm run test
npm run package
```

For documentation-only changes, at minimum check Markdown links, run `git diff --check`, and inspect the changed diff. Run `npm run community:check` when public metadata, installation, or release guidance changes.

## Documentation Rules

- Keep root Markdown limited to GitHub/community entry points and policies listed in `docs/INDEX.md`.
- Put durable project overview, feature, technology, architecture, and development decisions in their owning area.
- Keep plans, progress, dated status, research, review evidence, and handoffs outside `docs/`; use the established task location under `tmp/` or `.specs/`.
- Rewrite and consolidate information; do not preserve duplicate documents by merely moving them.
- Link to one authoritative explanation instead of copying tool matrices, permission rules, or release steps into several files.
- If implementation and documentation disagree, verify the executable behavior, update the working status when relevant, and resolve the contract mismatch explicitly.

## Change Discipline

- Keep changes scoped to the request and preserve unrelated user work.
- Do not write to a real Obsidian vault unless the task explicitly requires it.
- Do not stage, commit, tag, push, publish, or alter releases unless explicitly requested.
- In the handoff, report changed boundaries, deleted/replaced documents, and validation performed.
