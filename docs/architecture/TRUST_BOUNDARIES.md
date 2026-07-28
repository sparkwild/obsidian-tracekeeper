# Trust Boundaries

Tracekeeper is local-first, not trust-free. The user explicitly chooses an Agent
client that may receive selected Vault context. Tracekeeper controls what its
local Runtime reads and writes; it cannot control how a connected third-party
client or model provider handles content after receiving it.

Public vulnerability reporting remains in [SECURITY.md](../../SECURITY.md), and
the user-facing data statement remains in [PRIVACY.md](../../PRIVACY.md).

## Trust Zones

| Zone | Trust posture |
| --- | --- |
| Active Vault | User-owned source of truth; every access is scoped and validated |
| Tracekeeper-controlled Vault folders | Bounded operational writes are allowed according to policy |
| Local MCP Runtime | Loopback service requiring an authenticated credential principal |
| Connected Agent | Explicitly authorized consumer; never trusted with arbitrary filesystem access |
| Client configuration and Skill targets | Vault-outside exceptions changed only through confirmed, recoverable plugin flows |
| Network and shell | Not exposed by Tracekeeper MCP tools |

## Runtime Boundary

- Desktop Obsidian hosts production MCP on the configured loopback address.
- The HTTP `Host` authority and browser-style `Origin` are validated
  independently before dispatch; invalid values fail closed.
- Loopback is not authentication. Each managed client receives an independent
  credential principal, and client-reported names remain untrusted display
  claims.
- Runtime credential records retain normalized hashes rather than plaintext
  tokens.
- Discovery and dispatch use the same principal capability evaluator, while
  dispatch always rechecks authorization.
- Sessions are principal-bound and limited by idle lifetime, active count,
  per-session streams, request size, read time, content type, and negotiated MCP
  protocol version.
- Lifecycle transitions are serialized. Unload closes the controller before
  releasing the index, and a port conflict never triggers an unconfirmed port
  change.
- CORS is restricted to Obsidian and loopback origins; wildcard CORS is not used.
- Fixed resources and capability-filtered prompts cannot grant capabilities.

## Filesystem Boundary

MCP tools must:

- resolve every path against the configured active Vault;
- reject traversal, Vault-outside paths, symlink escapes, and the active
  Obsidian configuration directory;
- never access arbitrary client configuration;
- never expose delete, rename, bulk rewrite, shell execution, or generic network
  retrieval.

The plugin may change supported client configuration or managed Skill targets
only through the confirmed flow defined by the
[Knowledge Runtime](KNOWLEDGE_RUNTIME.md). Skill content, placement, file
verification, or user confirmation cannot expand MCP permissions.

## Capability And Write Boundary

| Class | Allowed behavior | Examples |
| --- | --- | --- |
| Read-only | Inspect Vault-local state without changing notes | status, lint, Recall, note reads, review inspection |
| Bounded write | Create work records or proposals in allowlisted Tracekeeper paths | tasks, sessions, context packs, sources, proposals |
| Review-gated write | Append to a durable target from an approved proposal | approved writeback |

Generated records never overwrite existing notes. Project auto-memory is a
user-controlled exception to global review and remains project-scoped,
append-only, duplicate-protected, and dependent on a verified Wiki bridge.

Recall and captured material are untrusted knowledge data. Content origin and
`instruction_trust: data_only` make explicit that note text cannot change the
authenticated capability set, review state, active task identity, or
higher-priority instructions.

## Human Review Invariants

- Proposal creation is not approval.
- Approval is not application.
- Only approved proposals are eligible for durable target writeback.
- Graph and migration findings remain advisory until a user acts.
- MCP cannot approve its own proposal or delete rejected history.
- The plugin must show sufficient source, target, context, and change preview for
  an informed decision.

## Recovery And Audit

Coordinated writes use stable operation identity, payload hashes, atomic journal
claims, optimistic replacement, and roll-forward recovery. Concurrent runtimes
cannot claim the same operation, a changed payload is rejected, and recovery
does not overwrite later user edits.

Audit records may contain operation identity, credential principal, untrusted
client/session claims, bounded target paths, result summary, duration, risk, and
bounded workflow metadata. They must not persist plaintext credentials,
authorization headers, absolute external Skill paths, complete prompts, note
bodies, Recall content, full results, or other sensitive payloads.

Local Activity diagnostics are derived from retained audit records and are never
uploaded by Tracekeeper. They describe observed Tracekeeper calls only.

## Data Handling And User Responsibility

Tracekeeper does not require a hosted backend or upload Vault content by itself.
Content may still leave the machine when the user connects a client backed by a
remote model or service. Users choose those clients, protect connection
credentials, review durable changes, and maintain normal Vault backups.

Review artifacts, append-only behavior, duplicate protection, and
client-configuration backups improve recoverability but do not replace a Vault
backup.

Contributor review requirements are defined in
[Security Review](../development/SECURITY_REVIEW.md).
