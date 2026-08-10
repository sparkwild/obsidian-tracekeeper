# Changelog

All notable changes to Tracekeeper will be documented in this file.

## [0.3.0] - Local Agent Runtime And Knowledge Governance

### Added

- Plugin-hosted, loopback-only MCP Runtime with installation-level access protection, OAuth discovery, authorization-code pairing, and PKCE `S256`.
- Native setup guidance for Codex, Claude Code, and Gemini CLI, plus explicit manual fallback guidance for clients without a verified local OAuth flow.
- Skill v2.2.0 with workflow contract v4 for task classification, proactive Recall, explicit memory scope, truthful durable-output closeout, multi-source ingestion, and instruction isolation.
- Memory, Source, Recall, Agent Activity, Runtime, onboarding, migration, and proposal-review surfaces in Obsidian.
- In-memory knowledge indexing, Vault event integration, background rebuild, and reusable Recall application boundaries.
- Multi-source ingestion for user-requested local knowledge capture, source snapshots, and direct candidate-memory submission.
- Idempotent `capture_source` and `propose_memory` operations with operation ownership markers and payload-conflict protection.
- Governed MemoryRecord v2 writes for both Global and Project Auto, with immutable operation records, claim identity, lifecycle validation, and exact-retry recovery.
- Scope-aware Recall across global, project, project-history, and task-history results with canonical relation evidence.

### Changed

- The local Runtime, contracts, Core services, and plugin composition are split into explicit package and ownership boundaries.
- Agent cards now require observed external Session evidence from both MCP initialization and a successful `tracekeeper.*` tool call.
- Project identity, Recall provenance, Source evidence, proposal review context, and Agent activity use normalized, inspectable records.
- Fresh installations use Global Review and Project Auto; users can select Review or Auto per scope, while Wiki changes remain review-only.
- Wiki and Source relations are optional for MemoryRecord v2; unverifiable declared relations enter review, but an absent relation does not block Auto.
- Task completion and durable knowledge persistence are reported separately, including exact proposal and applied-record evidence.
- Tracekeeper-authored source-analysis summaries and proposal drafts now follow the configured Obsidian content language while preserving raw source material in its original language.
- Explicit user requests to research and save knowledge are treated as workflow intent only; MCP capabilities, Vault boundaries, and review policy remain enforced.

### Security

- Runtime requests validate exact loopback binding, Host and Origin boundaries, Bearer access, Session state, request limits, OAuth resources and redirects, pairing expiry/replay, and access reset.
- Client configuration and Skill installation preserve unrelated files, use preview and confirmation boundaries, and avoid exposing credentials in setup instructions or normal diagnostics.
- Recall and Source content are labeled as untrusted knowledge data and cannot grant capabilities or override the accepted Agent workflow.
- OAuth approvals enforce one persistent Agent owner per client, isolate duplicate ownership, bind reservations through authorization-code lifetime, and revalidate ownership before issuing credentials.

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
