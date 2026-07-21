# Security And Privacy Architecture

This document owns Tracekeeper's technical trust boundaries. Public vulnerability reporting remains in [SECURITY.md](../../SECURITY.md), and the short user-facing data statement remains in [PRIVACY.md](../../PRIVACY.md).

## Trust Model

Tracekeeper is local-first, not trust-free. The user explicitly chooses an AI client that can receive selected vault context through MCP. Tracekeeper controls what its local runtime can read and write; it cannot control how a connected third-party Agent or model provider handles content after receiving it.

| Zone | Trust posture |
| --- | --- |
| Active vault | User-owned source of truth; access is scoped and validated |
| Tracekeeper-controlled vault folders | Bounded operational writes are allowed according to policy |
| Local MCP runtime | Loopback service requiring a generated token by default |
| Connected Agent client | Explicitly user-authorized consumer; not automatically trusted with arbitrary filesystem access |
| Client configuration files | Outside-vault exception, changed only after user confirmation and backup |
| Network and shell | Not exposed by Tracekeeper MCP tools |

## Runtime Boundary

- Production MCP uses Streamable HTTP hosted by desktop Obsidian.
- The default bind address is `127.0.0.1`; wildcard interfaces are not the product default.
- A generated local token is required. Missing-token startup is a development-only opt-in.
- Browser-style CORS origins are restricted to Obsidian and loopback origins; wildcard CORS is not used.
- Tokens and other sensitive argument keys are excluded or redacted from audit summaries.
- The connection URL contains a credential and should be treated as sensitive local configuration.

Loopback reduces exposure but is not authentication. Token validation remains required because other local processes may reach loopback services.

## Filesystem Boundary

MCP tools must:

- resolve every input against the configured active vault;
- reject path traversal, vault-outside paths, and symlink escapes;
- exclude the active Obsidian configuration directory from reads and scans;
- never read or write arbitrary Agent client configuration;
- never expose delete, rename, bulk rewrite, or shell execution.

The Obsidian plugin may update supported client configuration only through a user-confirmed flow that previews the target, preserves unrelated entries, creates a timestamped backup, and replaces through a temporary file.

## Permission Classes

| Class | Allowed behavior | Examples |
| --- | --- | --- |
| Read-only | Inspect vault-local state without changing notes | status, lint, recall, read note, inspect Review Queue |
| Low-risk write | Create bounded working records or candidates in allowlisted Tracekeeper paths | task/session records, context packs, source records, proposals |
| Review-gated write | Append to a durable target only from an approved proposal | approved writeback |

Generated records must not overwrite existing notes. Project memory auto-save is a user-controlled exception to global review: it remains append-only, duplicate-protected, project-scoped, and dependent on a valid Wiki bridge.

## Human Review Invariants

- Proposal creation is not approval.
- Approval is not application.
- Only approved proposals are eligible for durable target writeback.
- Graph-health and migration findings are advisory until a user acts.
- MCP cannot approve its own proposal or delete rejected history.
- The plugin must show enough source, target, and diff context for an informed decision.

## Data Handling

Tracekeeper does not require a hosted backend or external database and does not upload vault content by itself. Data may still leave the machine when the user connects an Agent whose model or service is remote. Users must review that client's privacy policy and choose which vault content to expose.

Audit records should contain operation identity, result, bounded target paths, client/session context, duration, and risk level. They should not persist tokens, passwords, API keys, cookies, authorization headers, or full sensitive payloads.

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
- audit payloads or error reporting;
- external network access, subprocesses, or dependency execution.

Any proposal to add remote services, shell execution, vault-outside access, or automatic durable writes changes the product trust model and must update the product, architecture, security, and status documents together.
