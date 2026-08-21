# Changelog

All notable changes to Tracekeeper will be documented in this file.

## [Unreleased]

## [0.3.6] - Closeout-first Task Recording

### Added

- Added closeout-only task recording so ordinary tracked work can create one canonical terminal task record with a single `finish_task` call and a Runtime-generated stable task identity.
- Added client-claimed start-time provenance for tasks promoted to live tracking after work has already begun.

### Changed

- Upgraded `start_task` to v4 and `finish_task` to v6 while preserving existing live `start_task` → `finish_task` clients and records.
- Updated the companion Skill to 2.3.0 / workflow contract 5 so ordinary tasks default to closeout-only and cross-session, recovery, visibility, and task-linked intermediate-write workflows continue to use live tracking.

### Fixed

- Reconciled transport-unknown starts by retrying the original start identity before safely falling back, with conflict-closed metadata binding, concurrent exact-retry convergence, and no duplicate task records.
- Distinguished intentional closeout-only records from known-task reconstruction and retained separate server/client time provenance throughout task history and structured results.

## [0.3.5] - Review Proposal Integrity

### Fixed

- Preserved complete nested Markdown proposal payloads through review, preview, and writeback with proposal-bound integrity markers shared by every producer and consumer.
- Blocked ambiguous legacy proposals with explicit resubmission guidance instead of exposing unsafe review or apply actions.
- Rejected unknown or conflicting project identities before proposal creation and required one canonical project Memory Hub for project-scoped enumeration.

### Changed

- Aligned Review Queue and Agent Activity states so actionable integrity failures appear as `需重提`, while rejected, deferred, and applied records remain terminal history.

## [0.3.4] - Knowledge Lifecycle Consistency

### Fixed

- Completed `start_task` and `finish_task` in one canonical Markdown task record, including explicit reconstruction at the same path when the start record is unexpectedly missing.
- Deduplicated mirrored proposal relationships in graph-health totals while preserving raw observations, and stopped treating Source provenance or incidental body links as knowledge relations.
- Kept completed Review Queue history out of the active inbox, added an explicit processed-record organizer, and aligned activity counts with changes that still need attention.
- Recognized receipt-backed official Skill content updates at the same Skill version without treating locally modified bundles as safe to overwrite.

### Changed

- Clarified task closeout, Source relationship, graph-health, review-state, and MCP capability descriptions across the plugin and public workflow documentation.

## [0.3.3] - Project Memory And Runtime Reliability

### Fixed

- Distinguished required base directories from on-demand feature directories, detected file/folder path collisions before repair, and blocked legacy migration while the base structure is invalid.
- Unified Agent Activity Hub creation across plugin and Runtime producers while accepting existing version 1 Hub bodies and reporting incompatible machine metadata without rewriting user content.
- Restored Project Auto for exactly identified repositories by creating a missing canonical project Hub with exclusive, create-only semantics before writing the immutable MemoryRecord; concurrent first writes converge safely while ambiguous, occupied, invalid, and legacy review routes remain fail-closed.
- Reduced recovered OAuth `auth_missing` handshake noise in Recent Events while retaining complete audit history, deduplicated unresolved credential failures, and replaced opaque authentication event labels with actionable diagnostics.
- Prevented legacy project proposals with a missing Hub from appearing approval- or writeback-ready, and added explicit upgrade-and-resubmit guidance.

### Changed

- Aligned update distribution with Obsidian's GitHub Release flow: version tags now create an attested Draft Release, and explicit publication promotes those same qualified assets without rebuilding them.
- Aligned Project Auto behavior and safety exceptions across settings, public documentation, the companion Skill, and deterministic Agent-initiative evaluation.

## [0.3.2] - OAuth Approval Flow Correction

### Fixed

- Restored OAuth confirmation inside the currently open Agent configuration and removed the redundant Agent selection step.
- Rejected unmatched or concurrent authorization requests instead of risking cross-Agent binding, and extended the approval window to five minutes.

## [0.3.1] - Community Plugin Review Hardening

### Fixed

- Added Obsidian 1.13 settings search definitions with lifecycle-safe mounting, refresh, and teardown while preserving the existing settings page on the declared minimum version.
- Replaced avoidable whole-vault lookups with exact or scoped traversal and routed plugin-initiated note removal through Obsidian's recoverable trash behavior.
- Resolved the remaining official community-plugin scanner findings across the plugin, Core, and MCP Runtime without changing the public MCP tool surface.

### Changed

- Added a repository-root build mirror for automated community scanning while keeping the three packaged release assets unchanged.
- Documented the plugin's bounded Markdown enumeration, direct filesystem, and write-only clipboard capabilities in the public README.

### Security

- Tightened operation identity and structured payload validation, including rejection of ASCII control characters and unsupported object values.

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
