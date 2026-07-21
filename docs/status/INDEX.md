# Current Status

- Snapshot date: 2026-07-22
- Repository version: `0.2.3`

This is a dated implementation snapshot, not a permanent product contract. Update it when a release materially changes the implemented boundary.

## Implemented Baseline

- Desktop Obsidian hosts a loopback Streamable HTTP MCP runtime at a configurable port; the default is `58437` with path `/mcp`.
- Runtime authentication uses a generated local token by default.
- The public MCP surface contains 12 focused tools covering status, lint, recall, note reads, task lifecycle, context packs, review, source workflows, and memory proposals.
- The plugin exposes activity, source status, Review Queue, memory inspection, runtime log/status, permission policy, and graph-health views.
- The current three-root vault architecture, required indexes/control files, lint, graph health, and legacy-layout inspection are implemented.
- Global durable memory is review-gated by default; user-enabled project memory may append automatically with duplicate protection and a Wiki bridge.
- Codex and Claude Desktop have automatic configuration support where desktop APIs are available. Claude Code, Cursor, and custom clients receive copyable Streamable HTTP configuration.
- Client configuration changes preserve unrelated entries, create timestamped backups, and use temporary-file replacement.
- The GitHub release workflow verifies and packages the plugin, uploads the three community assets, and generates artifact attestations.

## Known Gaps

- There is no packaged companion Tracekeeper Skill in this repository yet.
- Agent workflow guidance exists in MCP descriptions and documentation, but is not yet generated or checked from one structured contract.
- Connection controls exist in settings, but the recoverable first-run sequence from vault check through Skill installation and first recall is not yet a dedicated onboarding flow.
- Recall scans the vault on demand; there is no persistent incremental `KnowledgeIndex` yet.
- Cross-file vault writes do not yet share a general operation journal and idempotency key model.
- The Obsidian plugin UI remains concentrated in a large `main.ts`, and the plugin workspace has no automated UI test suite.
- The standalone MCP command is a development tool; production packaging is the Obsidian-hosted runtime.

## Next Coherent Slices

1. Define and package the companion Skill from the [Agent Workflow Contract](../architecture/AGENT_WORKFLOW_CONTRACT.md), with thin adapters for supported clients.
2. Implement a resumable onboarding state machine: vault check, runtime, client configuration, Skill setup, restart detection, connection verification, and first recall.
3. Add contract conformance checks so MCP descriptions, Skill guidance, and plugin copy cannot drift semantically.
4. Introduce a rebuildable incremental knowledge index behind the existing recall boundary.
5. Add coordinated operation identifiers, idempotency, atomic writes, and recovery journaling for multi-file workflows.
6. Split plugin UI responsibilities into testable modules and add focused configuration/onboarding fixtures before expanding visual scope.

## Status Update Rule

When a gap is implemented, move any lasting decision into the appropriate product, architecture, or security owner and edit this snapshot to describe the new executable baseline. Do not turn this file into an accumulating historical changelog; released history belongs in `CHANGELOG.md`.
