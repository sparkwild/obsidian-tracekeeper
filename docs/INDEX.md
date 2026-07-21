# Documentation Index

This directory contains Tracekeeper's canonical product and engineering documentation. The structure borrows the useful idea of explicit ownership indexes, but is intentionally smaller than a general desktop platform's documentation tree.

## Start Here

| Area | Owns | Does not own |
| --- | --- | --- |
| [Product](product/INDEX.md) | Product identity, users, workflows, onboarding, and non-goals | Protocol schemas or implementation status |
| [Architecture](architecture/INDEX.md) | Runtime boundaries, vault model, write flows, and module ownership | Public release procedure |
| [Agent workflow](architecture/AGENT_WORKFLOW_CONTRACT.md) | Normative Agent, Skill, and MCP usage contract | Permission enforcement implementation |
| [Security](security/INDEX.md) | Trust zones, permissions, privacy boundaries, and threat controls | Vulnerability disclosure intake |
| [Engineering](engineering/INDEX.md) | Repository layout, validation, contribution, packaging, and release | Product roadmap |
| [Status](status/INDEX.md) | Dated implemented baseline, known gaps, and next engineering slices | Durable product or architecture decisions |

## Repository Root Documents

These root files are intentional repository, GitHub, or Obsidian community entry points and should remain concise:

- `AGENTS.md`: repository routing and operating rules for coding agents
- `README.md` and `README.zh-CN.md`: public product and installation overview
- `CHANGELOG.md`: released user-visible changes
- `LICENSE`: MIT license terms
- `PRIVACY.md`: public privacy summary
- `SECURITY.md`: vulnerability reporting policy
- `CONTRIBUTING.md`: contributor entry point
- `CODE_OF_CONDUCT.md`: community conduct policy
- `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md`: contribution forms

The Obsidian release package contains `main.js`, `manifest.json`, and `styles.css`; Markdown is repository documentation, not runtime payload.

## Authority And Routing

Use the following order when documents appear to conflict:

1. Product and security documents define intended boundaries.
2. Architecture and Agent workflow documents define the designed contract.
3. Status documents say how much of that contract is implemented now.
4. Source code and tests are the final evidence for executable behavior.

Resolve contradictions instead of silently choosing one. A design that is not implemented must be labelled as a target; an implementation that violates a durable boundary requires an explicit design decision.

## Documentation Rules

- Each first-level area has an `INDEX.md` that defines its scope.
- Cross-domain material lives with its primary owner and is linked from other areas.
- Durable standards and dated status snapshots must not be mixed in the same section.
- Module READMEs describe how to work with that module; they link here for shared contracts.
- Tool lists, permission matrices, vault layout, and release steps each have one canonical home.
- New root-level technical design files require a clear reason; normally add them under the owning area.
- When a document is fully replaced, delete it and update inbound links in the same change.
