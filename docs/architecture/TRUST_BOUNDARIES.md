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
| Local MCP Runtime | Exact-loopback service protected by one installation-level service Bearer |
| Connected Agent | Observed consumer of bounded tools; self-reported identity is untrusted and never grants filesystem access |
| Client OAuth state and Skill targets | OAuth registrations, pairing, and codes are memory-only; Vault-outside Skill changes require confirmed, recoverable plugin flows |
| Network and shell | Not exposed by Tracekeeper MCP tools |

## Runtime Boundary

- Desktop Obsidian hosts production MCP on exact `127.0.0.1`; broader loopback
  aliases and non-loopback bind addresses fail closed.
- The HTTP `Host` authority and browser-style `Origin` are validated
  independently before dispatch; invalid values fail closed.
- The MCP authorization specification normally requires HTTPS authorization
  endpoints. Tracekeeper's current local compatibility mode permits plain HTTP
  only on the exact `127.0.0.1` listener used by desktop Obsidian and supported
  loopback clients. This exception never applies to LAN, remote, hosted, or
  non-loopback authorization endpoints.
- Loopback is not authentication. Every MCP resource request requires the same
  installation-level service Bearer in the `Authorization` Header; query
  credentials are rejected and endpoint URLs remain credential-free.
- Runtime retains only the service credential's normalized hash and compares
  request credentials without persisting plaintext credentials or Headers.
- Successful requests enter one fixed `local-user` execution domain. Discovery
  and dispatch use the same fixed capability set, and dispatch rechecks the
  required capability and operation policy.
- Sessions use random opaque identifiers and are limited by idle lifetime,
  active count, per-session streams, request size, read time, content type, and
  negotiated MCP protocol version. Every Session request revalidates the
  Bearer; a Session identifier is continuity evidence, not client identity.
- MCP `clientInfo` is an untrusted observation claim, not authentication or an
  authorization source. It may label local diagnostics but cannot create a
  Principal or capability profile.
- Lifecycle transitions are serialized. Unload closes the controller before
  releasing the index, and a port conflict never triggers an unconfirmed port
  change.
- CORS is restricted to Obsidian and loopback origins, explicitly allows the
  `Authorization` Header, and never uses wildcard origin policy.
- Unauthenticated MCP responses expose only a standards-based
  `WWW-Authenticate` challenge and Protected Resource Metadata. OAuth metadata,
  registration, authorization, and token routes cannot dispatch tools.
- Authorization codes require PKCE `S256`, an exact registered loopback redirect
  URI, `state`, and the MCP resource indicator. Pairing codes enter only a
  same-origin local form body; all OAuth responses are non-cacheable and the
  authorization page uses a restrictive content-security policy.
- Pairing codes, client registrations, and authorization codes are bounded,
  short-lived, one-use memory state. Stop, restart, port change, plugin unload,
  and global reset invalidate them. Invalid, expired, replayed, mismatched, and
  over-attempt requests fail closed without revealing which check failed.
- The token endpoint returns the existing installation Bearer as an opaque
  access token. It does not create per-client credentials, refresh tokens,
  Principals, capability profiles, or independent revocation semantics.
- Fixed resources and capability-filtered prompts cannot grant capabilities.
- Removing one client configuration does not revoke server access. Advanced
  global credential reset rotates the service Bearer, terminates all Sessions,
  and requires every configured client to be updated.

## Filesystem Boundary

MCP tools must:

- resolve every path against the configured active Vault;
- reject traversal, Vault-outside paths, symlink escapes, and the active
  Obsidian configuration directory;
- never access arbitrary client configuration;
- never expose delete, rename, bulk rewrite, shell execution, or generic network
  retrieval.

The plugin may change managed Skill targets only through the confirmed flow
defined by the [Knowledge Runtime](KNOWLEDGE_RUNTIME.md). Normal Agent
configuration remains client-owned. Historical direct-configuration adapters
require a separate migration or recovery confirmation. Skill content,
placement, file verification, or user confirmation cannot expand MCP
permissions.

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
fixed capability set, review state, active task identity, or
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

Audit records may contain operation identity, the fixed execution-domain label,
untrusted client/Session claims, bounded target paths, result summary, duration,
risk, and bounded workflow metadata. They must not persist service credentials,
credential or pairing-code hashes, pairing codes, OAuth authorization codes or
token responses, authorization headers, absolute external Skill paths, complete
prompts, note bodies, Recall content, full results, or other sensitive payloads.

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
