# Changelog

All notable changes to Tracekeeper will be documented in this file.

## [0.2.3] - Community CSS Lint Fix

### Fixed

- Removed duplicate Review Queue button background declarations reported by the Obsidian community CSS scanner.

## [0.2.2] - Review Queue and Memory Closeout Polish

### Added

- Automatic refresh for the Agent Activity and Review Queue views while they are open.
- Task closeout memory status reporting for empty, queued, auto-saved, mixed, and ignored closeouts.
- Start-task closeout contract guidance so agents know which durable fields to submit at task end.

### Changed

- Review Queue now shows all queue item types, not only memory proposals.
- Review Queue cards and actions are simplified for one-pass user confirmation.
- Project memory closeout defaults to auto-save by rule, while global memory remains review-gated.
- Project history recall now finds auto-saved project memory using token-based query matching.
- Project memory candidates now expose concrete project memory directories instead of a generic memory root.

## [0.2.1] - Obsidian Memory Workflow

First public release in the 0.2 series. Version 0.2.0 was skipped as an internal stabilization point; 0.2.1 is the reviewed release candidate for the Obsidian Memory workflow.

### Added

- `tracekeeper.project_context` and `tracekeeper.project_history` for project-scoped recall and continuity.
- `tracekeeper.finish_task` closeout fields for decisions, solution changes, lessons, preferences, and memory candidates.
- Optional `review_proposal_mode` on `tracekeeper.finish_task` to create Review Queue proposals without writing durable memory directly.
- Agent MCP usage documentation for cross-agent start, recall, closeout, and review flow.

### Changed

- Review Queue empty state now explains why no proposals appear until an agent submits or closes out memory candidates.
- README positioning now emphasizes Obsidian Memory first, optional Obsidian Wiki structure second.

## [0.1.0] - Initial Private Build

### Added

- Obsidian plugin scaffold for Agent Activity, Review Queue, audit, permissions, runtime status, and AI tool connections.
- MCP server with read-only tools, bounded working-record writes, and review-gated approved writeback.
- Shared TypeScript core package for vault scanning, recall, context packs, source analysis, lint, and safety helpers.
- Root workspace verification through `npm run verify`.

### Changed

- Product name, plugin display name, MCP config key, and repository name are aligned as Tracekeeper / `tracekeeper` / `obsidian-tracekeeper`.
- User-facing connection settings no longer assume a fixed vault path, repository path, local port, or developer machine path.
- README, manifest description, and community submission notes are prepared for public community plugin review.

### Security

- MCP Runtime now requires a generated local token by default.
- Standalone missing-token startup is limited to an explicit development flag.
- HTTP Runtime CORS no longer uses wildcard origins and is limited to Obsidian or loopback origins.
