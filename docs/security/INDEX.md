# Security And Privacy Architecture

This document owns Tracekeeper's technical trust boundaries. Public vulnerability reporting remains in [SECURITY.md](../../SECURITY.md), and the short user-facing data statement remains in [PRIVACY.md](../../PRIVACY.md).

## Trust Model

Tracekeeper is local-first, not trust-free. The user explicitly chooses an AI client that can receive selected vault context through MCP. Tracekeeper controls what its local runtime can read and write; it cannot control how a connected third-party Agent or model provider handles content after receiving it.

| Zone | Trust posture |
| --- | --- |
| Active vault | User-owned source of truth; access is scoped and validated |
| Tracekeeper-controlled vault folders | Bounded operational writes are allowed according to policy |
| Local MCP runtime | Loopback service requiring a generated credential by default |
| Connected Agent client | Explicitly user-authorized consumer; not automatically trusted with arbitrary filesystem access |
| Client configuration files | Outside-vault exception, changed only after user confirmation and backup |
| Network and shell | Not exposed by Tracekeeper MCP tools |

## Runtime Boundary

- Production MCP uses Streamable HTTP hosted by desktop Obsidian.
- The default bind address is `127.0.0.1`; wildcard interfaces are not the product default.
- Each managed client receives an independent credential principal; the legacy shared token remains a full-access migration credential.
- The user can rotate one managed client's credential without revoking unrelated clients; the affected connection must then be updated and re-established.
- A credential is required. Missing-token startup is a development-only opt-in.
- The running MCP service normalizes configured tokens to SHA-256 hashes and retains only those hashes for request authentication; plaintext values are not kept in Runtime credential records.
- Tool contracts map every tool to a capability, and the authenticated principal is checked before dispatch. Client-reported names remain untrusted display claims.
- `tools/list`, prompt discovery, and dispatch use the same authenticated capability set. A principal does not discover tools or prompts it cannot use, but discovery filtering never replaces the dispatch-time check.
- New managed credentials use the Knowledge Assistant preset by default. Existing full-access credentials remain full-access during migration and are labelled Custom until the user deliberately selects a narrower preset.
- A session is bound to one principal and cannot be reused with another credential.
- The server negotiates MCP `2025-06-18` or `2025-11-25`; subsequent HTTP requests must carry the negotiated `Mcp-Protocol-Version`. Missing or mismatched version headers are rejected before dispatch.
- Request bodies, active sessions, per-session event streams, idle session lifetime, and request-body read time have bounded defaults. POST requests require an `application/json` content type. The body timeout expires before tool dispatch; it does not report cancellation after a write has begun.
- Browser-style CORS origins are restricted to Obsidian and loopback origins; wildcard CORS is not used.
- Tokens and other sensitive argument keys are excluded or redacted from audit summaries.
- The connection URL contains a credential and should be treated as sensitive local configuration.
- Resource reads are limited to five fixed `tracekeeper://` resources backed by allowlisted Vault-relative paths. Prompt templates are capability-filtered user-invoked guidance and cannot grant capabilities.

Loopback reduces exposure but is not authentication. Token validation remains required because other local processes may reach loopback services.

## Filesystem Boundary

MCP tools must:

- resolve every input against the configured active vault;
- reject path traversal, vault-outside paths, and symlink escapes;
- exclude the active Obsidian configuration directory from reads and scans;
- never read or write arbitrary Agent client configuration;
- never expose delete, rename, bulk rewrite, or shell execution.

The Obsidian plugin may update supported client configuration only through a user-confirmed flow. A preview produces a short-lived plan bound to the original file hash and current client credential. Confirmation revalidates both values, preserves unrelated entries, creates a timestamped backup, and replaces through a temporary file. A concurrent edit, expired plan, or credential rotation requires a new preview.

The plugin may install a companion Skill only for a trusted local client profile with a fixed target resolver. It verifies the embedded manifest and every file hash, previews the exact bundle, requires explicit confirmation, rechecks source hashes, stages writes, backs up replaced files, and rolls back partial failure. An unknown, unverifiable, or user-modified installation is never overwritten automatically. Copy-only clients receive content but no false file-verification claim. Skill content and installation status cannot expand MCP permissions.

## Permission Classes

| Class | Allowed behavior | Examples |
| --- | --- | --- |
| Read-only | Inspect vault-local state without changing notes | status, lint, recall, read note, inspect Review Queue |
| Low-risk write | Create bounded working records or candidates in allowlisted Tracekeeper paths | task/session records, context packs, source records, proposals |
| Review-gated write | Append to a durable target only from an approved proposal | approved writeback |

Generated records must not overwrite existing notes. Project memory auto-save is a user-controlled exception to global review: it remains append-only, duplicate-protected, project-scoped, and dependent on a valid Wiki bridge.

Recall results label each excerpt with its content origin and `instruction_trust: data_only`. Note text, captured sources, and prior memory are untrusted knowledge inputs: they cannot change system instructions, the authenticated capability set, the review boundary, or the task id carried by the active workflow.

Multi-step task closeout and approved writeback use operation IDs, idempotency keys, payload hashes, atomic replacement, and a recoverable journal. Vault-local process locks and atomic claims prevent two local runtimes from executing one idempotency key simultaneously. Audit entries use a narrower event identity derived from operation, target, action, and result so one operation can record several distinct artifacts without duplicating any individual event; repository-backed audit appends are serialized and retry optimistic conflicts. Reusing an idempotency key with another payload is rejected. Startup recovery rolls known operations forward and records conflicts instead of silently overwriting a changed file.

## Human Review Invariants

- Proposal creation is not approval.
- Approval is not application.
- Only approved proposals are eligible for durable target writeback.
- Graph-health and migration findings are advisory until a user acts.
- MCP cannot approve its own proposal or delete rejected history.
- The plugin must show enough source, target, and diff context for an informed decision.

## Data Handling

Tracekeeper does not require a hosted backend or external database and does not upload vault content by itself. Data may still leave the machine when the user connects an Agent whose model or service is remote. Users must review that client's privacy policy and choose which vault content to expose.

Audit records contain operation identity, authenticated principal, untrusted client/session claims, bounded target paths, result summary, duration, and risk level. Workflow audit metadata may add contract/result versions, mode, task/recall/action ids, snapshot generation, bounded scope diagnostics, match count, and closeout state. Skill-install audit records are limited to action, client id, bundle hash, backup-created flag, result, and timestamp. Audit records must not persist tokens, passwords, API keys, cookies, authorization headers, absolute external Skill paths, complete prompts, complete recall content, full tool results, or other sensitive payloads.

Activity diagnostics are calculated locally from retained audit records and are never uploaded by Tracekeeper. They describe only observed Tracekeeper calls; they cannot measure prompts for which an Agent should have called but did not. Audit cleanup intentionally reduces their history.

## Recovery And User Responsibility

The vault remains ordinary Markdown and should be backed up using the user's normal local backup or versioning workflow. Tracekeeper provides review artifacts, append-only behavior, duplicate protection, and client-config backups, but these do not replace a vault backup.

The MIT license and warranty terms are defined by `LICENSE`. Users remain responsible for choosing connected Agents, protecting connection tokens, reviewing durable changes, and backing up important data.

## Security Review Checklist

Changes require focused security review when they affect:

- vault root resolution, symlinks, or path normalization;
- MCP authentication, bind address, CORS, or sessions;
- any new read or write target;
- permission classification or Review Queue state transitions;
- client configuration parsing, merge, removal, backup, or replacement;
- companion Skill manifest verification, client target resolution, installation, backup, or replacement;
- audit payloads or error reporting;
- external network access, subprocesses, or dependency execution.

Any proposal to add remote services, shell execution, vault-outside access, or automatic durable writes changes the product trust model and must update the product, architecture, security, and status documents together.
