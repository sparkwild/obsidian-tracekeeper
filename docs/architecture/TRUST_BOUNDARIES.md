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
| Local MCP Runtime | Exact-loopback service protected by a per-Agent credential verifier |
| Connected Agent | Observed consumer of bounded tools; self-reported identity is untrusted and never grants filesystem access |
| Client OAuth state and Skill targets | Pending approvals, unbound registrations, and codes are memory-only; Vault-outside Skill changes require confirmed, recoverable plugin flows |
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
- Loopback is not authentication. Every MCP resource request requires a valid
  per-Agent Bearer in the `Authorization` Header; query credentials are
  rejected and endpoint URLs remain credential-free.
- Runtime receives a verifier and retains no plaintext credential. The plugin
  persists only SHA-256 digests and returns a trusted integration/credential
  context after constant-time comparison.
- Successful requests enter one fixed `local-user` execution domain. Discovery
  and dispatch use the same fixed capability set, and dispatch rechecks the
  required capability and operation policy.
- Sessions use random opaque identifiers and are limited by idle lifetime,
  active count, per-session streams, request size, read time, content type, and
  negotiated MCP protocol version. Every Session request revalidates the
  Bearer and compares its bound integration/credential context; a Session
  identifier is continuity evidence, not client identity.
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
  URI, `state`, and the MCP resource indicator. Obsidian approval is an explicit
  same-origin bridge; the browser page only waits. All OAuth responses are
  non-cacheable and the page uses a restrictive content-security policy with
  one hash-bound static stylesheet, no scripts, and no external resources.
- Pending requests, unbound registrations, and authorization codes are bounded,
  short-lived, one-use memory state. Pending approval expires after five
  minutes. Stop, restart, port change, plugin unload, and global revoke
  invalidate this state. Invalid, expired, replayed, mismatched, concurrent,
  and capacity-exhausted requests fail closed without revealing which check
  failed.
- A pending OAuth request belongs to an existing integration only when its
  trusted `clientId` binding matches that integration and the same Agent's OAuth
  configuration is the active approval context. A first-time unbound request
  can be proposed only to the eligible Agent configuration the user already has
  open; the active local context supplies the `integrationId`, while an
  untrusted client-name claim cannot select an Agent. A request without that
  context, or an additional request while one remains pending, is denied.
  Expired requests are pruned before presentation and capacity checks.
- One OAuth `clientId` has at most one effective integration owner. Approval
  reserves that owner through the authorization-code lifetime, and token
  persistence serially rechecks it. Persisted duplicate owners fail closed and
  remain visible as one settings-level conflict until the human resolves them;
  Tracekeeper never chooses an owner by array order or rewrites the settings
  silently.
- The token endpoint atomically persists the selected integration's digest and
  returns one opaque access token. It does not issue refresh tokens; revoke and
  replacement close only the bound integration's Sessions.
- Fixed resources and capability-filtered prompts cannot grant capabilities.
- Removing one client through its client-native entry requires revocation first;
  the Obsidian management action removes the integration and its Tracekeeper-owned
  Skill-state records without deleting client-owned Skill files. Global revoke
  clears all integrations, active credentials, pending approvals, and Skill-state
  records, terminates all Sessions, and requires every client to be configured
  again.

## Filesystem Boundary

MCP tools must:

- resolve every path against the configured active Vault;
- treat the active Vault root as server-managed runtime context; tool arguments
  must not select or override it;
- reject traversal, Vault-outside paths, symlink escapes, and the active
  Obsidian configuration directory;
- never access arbitrary client configuration;
- never expose delete, rename, bulk rewrite, shell execution, or generic network
  retrieval.

Filesystem reads that return both content and a version bind both values to one
opened file identity. The Node repository rejects symlink path segments, opens
the final file without following a symlink where supported, compares pre/post
handle metadata, and revalidates the resolved path identity before returning.
Replacement or mutation during the read is a conflict, not a mixed
content/version result.

The plugin may change user-selected Skill targets only through the confirmed
flow defined by the [Knowledge Runtime](KNOWLEDGE_RUNTIME.md). Official client
directories are suggestions, not implicit write targets; the AI-assisted flow
does not count as installation until an external directory is verified. Normal
Agent configuration remains client-owned. Production contains no
client-configuration file reader, merger, backup, or writer. Skill content,
placement, file verification, or user confirmation cannot expand MCP
permissions.

## Capability And Write Boundary

| Class | Allowed behavior | Examples |
| --- | --- | --- |
| Read-only | Inspect Vault-local state without changing notes | status, lint, Recall, note reads, review inspection |
| Bounded write | Create governed records or proposals in allowlisted Tracekeeper paths | tasks, sessions, context packs, sources, immutable policy-authorized MemoryRecord v2 entries, proposals, maintenance requests |
| Review-gated write | Append to an existing durable target or create one explicitly approved Wiki/MemoryRecord target | approved writeback |

Generated records never overwrite existing notes. Global and Project Auto are
independently user-controlled and create immutable, duplicate-protected
MemoryRecord v2 entries under the canonical Hub for the declared scope. Global
Review remains the fresh-install default. Wiki and Source relations are
optional and do not grant write authority. Agent-originated evidence is bounded
to `supported` confidence even when the caller requests `verified`. User
authority, lifecycle transitions, unresolved claim conflicts, uncertain
project identity, and explicitly supplied but unverifiable relations remain
human-review boundaries.

An explicit Wiki target follows its independent, user-selected Wiki rule and is
never governed by Global or Project Memory policy. Review-each and batch-review
remain human-confirmed; auto-managed is an explicit opt-in restricted to
create-only Wiki notes and hash-valid managed relation regions. User-authored
body changes, first-time relation-region insertion, ambiguity, and conflicts
remain review-gated. A
missing or invalid Global Memory Hub blocks persistence and returns a
structure-repair action. Project Auto may create a missing canonical project
Hub only from an exact repository identity and only through exclusive,
create-only persistence. Invalid Hubs, occupied paths, and ambiguous or
conflicting identities remain fail-closed.

Recall and captured material are untrusted knowledge data. Content origin and
`instruction_trust: data_only` make explicit that note text cannot change the
fixed capability set, review state, active task identity, or
higher-priority instructions.

## Human Review Invariants

- Proposal creation is not approval.
- A maintenance request is not approval. Public MCP accepts only current lint
  candidate ids and exposes no archive, purge, trash, or delete execution tool.
- Public MCP proposal creation is not approval, and MCP cannot approve its own proposal.
- A human Wiki preview may authorize approval and application with one final confirmation; internally, exact approval receipts still commit before target writeback.
- Only proposals covered by those committed approval receipts are eligible for durable target writeback.
- Approval commits a bounded receipt for the exact proposal revision and
  content hash reviewed by the user.
- Apply requires a fresh opaque confirmation token that is authenticated,
  expiring, and bound to the approved proposal revision, semantic content and
  complete file hash, target, optional task, complete touched-note set, and
  bounded activity context.
- Proposal, target, task, touched-note, activity-context, token, or expiry drift
  fails before a new write begins. A confirmation token cannot authorize a
  different preview or proposal.
- Graph and migration findings remain advisory until a user acts.
- MCP cannot approve its own proposal or delete rejected history.
- The plugin must show sufficient source, target, context, and change preview for
  an informed decision.
- A missing target can authorize creation only when the confirmed effect is a
  Wiki file under `01_knowledge/wiki/**` or a governed MemoryRecord lifecycle
  target. Existing targets remain append operations, occupied create targets
  fail closed, and missing ordinary Memory append targets remain incomplete.
- Proposal archiving is not implied by a review transition. The archive dialog
  shows the exact source-to-destination moves and managed-reference set, gives
  cancel initial focus, and commits only the confirmation bound to that
  displayed preview.
- Agent activity cleanup shows the exact eligible and retained activity shards, event
  counts, cutoff, and configured Obsidian trash behavior. A changed file set,
  content hash, cutoff, trash behavior, expiry, or confirmation fails before a
  new trash effect.
- Source Archive cleanup is a separate Obsidian-only confirmation after repair
  and recheck. It is restricted to journal-proven byte-exact consolidation
  duplicates and calls `FileManager.trashFile()` under the user's current
  Obsidian setting. Unknown outcomes never trigger an automatic repeated Trash.
- Concurrent review edits never silently replace the current proposal. The
  user's unsaved draft remains available, the conflict is announced to
  assistive technology, and focus returns to the relevant control.

## Recovery And Agent Activity

Coordinated writes use stable operation identity, payload hashes, atomic journal
claims, optimistic replacement, and roll-forward recovery. Concurrent runtimes
cannot claim the same operation, a changed payload is rejected, and recovery
does not overwrite later user edits. Normalized recovery payloads and completed
results are stored only as authenticated-encrypted journal values bound to the
operation id, idempotency key, payload hash, and value kind. A separately
authenticated progress anchor binds the longest durable ordered step prefix and
terminal status so replacing the JSON record with a shorter valid prefix cannot
silently replay a completed effect.

The internal Wiki batch coordinator follows the same boundary: it claims one
schema-v3 manifest before any proposal or target mutation, records approval and
per-item `prepare`, `apply`, and `verify` steps as an ordered prefix, and
delegates each file mutation to the existing path-locking adapter without
holding that path lock itself. Task-linked items carry chained before/after
content hashes, and recovery accepts an applied item only when the nested
writeback operation id, target result hash, and task result hash all match. A
batch confirmation token is valid only for the displayed manifest before claim;
the token, note bodies, diffs, and relation blocks are never stored in the batch
journal. After claim, restart may resume that exact operation from its
authenticated hash-only plan. A v2 batch lacks this task chain and is not
automatically resumed; it requires a fresh v3 preview. A changed target or
proposal becomes a terminal conflict requiring a fresh preview, while an
interrupted non-conflict operation remains resumable.

Approved writeback records each target append or exact target creation,
optional task link, proposal transition, and Agent activity append as a
separate journaled step. The proposal transition stores a bounded committed
receipt rather than proposal content. A creation effect uses absent-path
semantics, is bound into the confirmation payload, and can be retried or
compensated only when the target content proves exact operation ownership.
When a later proposal transition conflicts, Tracekeeper removes only the exact
target and task effects owned by that operation; it never rewinds unrelated or
later user edits. If safe task compensation cannot be proven, target
compensation is still attempted and the operation becomes a terminal conflict
that requires a fresh preview.

The Agent activity step is journaled before its external effect. An interruption
after the proposal transition enters the explicit `activity_pending` state, and
recovery uses the committed transition receipt to append the same bounded Agent
activity event at most once, even if the proposal file is no longer present.
Terminal conflicts
are not replayed. Legacy recovery records that contain note bodies are
quarantined instead of being replayed.

Proposal archive recovery accepts only a receipt whose bounded payload matches
the confirmed preview and per-target ownership claims persisted before the
first move. Claims use optimistic replacement, remain bound to one operation,
and share the proposal path-lock domain with review transitions. A different
operation cannot adopt an interrupted pre-move intent or a move already visible
at the destination. The owning operation can roll forward after restart, but
source-and-destination ambiguity, identity drift, managed-reference drift, an
occupied destination, claim drift, or receipt-integrity failure stops the
operation. It never overwrites a destination or deletes either copy.
Human archive actions do not create Agent activity events. The persisted intent
start time remains bound to the archive receipt so restart and exact retry do not
change operation identity.
An expired archive confirmation can resume only when at least one persisted
in-progress target claim proves the same operation and preview, and every
existing claim still matches its target, source hash, start time, and binding.
Missing claims from the same interrupted operation may then be acquired; without
that durable proof the expired preview remains stale.

Agent activity shards use stable event identity and Vault-scoped path
serialization. Same-shard writers cannot replace one another, and exact retries
do not append a second event. The Agent Activity hub and parent-folder creation
share the same path-lock domain as Runtime repository writes. This coordination
is process-local and
does not prevent direct user edits or writes by another plugin; optimistic
validation still treats those as external changes.
Operation effects derive their stable activity identity from the operation id.
Every `tools/call`, including a request rejected before tool execution, receives
a server-generated invocation id; the client JSON-RPC request id is retained
only as bounded observational evidence and cannot suppress another call's Agent
activity event when a client reuses it.

Agent activity cleanup persists a receipt revision and the currently attempted
path before calling configured Obsidian trash. It revalidates the target again
inside the shared path lock. If the process stops after the intent but before a
durable result, restart reports that path as outcome-unknown instead of retrying
destructively. Per-file failure leaves remaining evidence and returns exact
trashed, failed, stale, and retained paths. No cleanup route calls
`Vault.delete()`.

A Source Request may move from pending to either completed or failed. After the
completed transition has been attempted or observed, a later task-reference or
activity-projection failure must remain a separate downstream failure and must
not relabel the terminal request as failed.

Legacy migration serializes the whole same-migration operation in process, not
only individual paths. Immediately after the durable move or cleanup intent it
re-resolves the bounded path and rechecks source identity, target absence, or
empty-root eligibility before the native effect. Drift after confirmation is a
conflict and never inherits the old preview's authority.

Agent activity records may contain operation identity, the fixed execution-domain
label,
trusted integration and credential identifiers, auth mode, untrusted
client/Session claims, bounded target paths, result summary, duration, risk, and
bounded workflow metadata. They must not persist plaintext credentials, token
digests, pending handles, PKCE verifiers, OAuth authorization codes or token
responses, authorization headers, writeback confirmation tokens or their
hashes, absolute external Skill paths, complete prompts, note bodies, Recall
content, full results, or other sensitive payloads. Raw operation-journal JSON
contains neither plaintext payloads nor plaintext completed results. Journals
may retain the normalized recovery payload and completed result only as
authenticated-encrypted values required for exact retry; bounded step receipts
remain separately integrity-anchored. Recovery errors and user-facing conflict
messages contain neither raw confirmation tokens nor note bodies. Legacy
plaintext records are migrated on a subsequent safe journal write or, when
their body-bearing schema is not safe to replay, quarantined.

The journal key is local to the journal directory and permission-restricted.
Sealing prevents accidental raw-record disclosure and detects corruption or
unauthenticated replacement under the supported recovery model. It does not
create a security boundary against the Vault owner, another plugin, or another
process running with the same filesystem authority, which can also access or
replace the adjacent key material.

Local Activity diagnostics are derived from retained Agent activity records and
are never uploaded by Tracekeeper. They describe observed MCP calls only.

## Data Handling And User Responsibility

Tracekeeper does not require a hosted backend or upload Vault content by itself.
Content may still leave the machine when the user connects a client backed by a
remote model or service. Users choose those clients, protect connection
credentials, review durable changes, and maintain normal Vault backups.

Review artifacts, append-only behavior, duplicate protection, and selected Skill
backups improve recoverability but do not replace a Vault backup.

The local Vault is not an adversarial trust boundary against its owner or
another plugin with the same write authority. Receipt and claim binding hashes
support drift detection and optimistic replacement; they are not authenticated
signatures and cannot make deliberately rewritten Vault evidence tamper-proof.

Contributor review requirements are defined in
[Security Review](../development/SECURITY_REVIEW.md).
