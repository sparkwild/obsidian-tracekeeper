# Security Review

Changes require focused security review when they affect:

- Vault root resolution, path normalization, symlink handling, or protected
  configuration paths;
- service credential generation, storage, reset, Bearer validation, OAuth
  discovery, dynamic registration, pairing, PKCE, redirect/resource validation,
  query credential rejection, Host or Origin validation, bind address,
  sessions, `clientInfo` observation, request limits, or protocol negotiation;
- any new read, write, external-network, or subprocess target;
- fixed capability classification, discovery filtering, or dispatch
  authorization;
- Knowledge Change Review state transitions or durable writeback;
- proposal identity, archive preview, native move, managed-reference relinking,
  history resolution, or archive receipts;
- legacy-structure mapping, native-link preflight, migration preview or
  journal, graph convergence, conflict review, or empty-root cleanup;
- audit event identity, shard or hub creation, concurrent append, legacy/shard
  merge, retention classification, configured trash, or cleanup receipts;
- client-native setup guidance, observed connection evidence, or any proposal
  to reintroduce client-configuration filesystem access;
- Skill bundle identity, target resolution, installation, backup, rollback, or
  update ownership;
- operation journals, recovery, audit payloads, redaction, or error reporting.

## Required Evidence

The review must identify:

1. the fixed `local-user` execution domain and all untrusted client, Session,
   protocol, and content inputs involved;
2. all Vault and Vault-outside targets;
3. the route and validation order: `Host`/`Origin`, public OAuth route
   classification, valid preflight handling, service Bearer for MCP resource
   requests, protocol and Session validation, then tool capability and input
   validation;
4. failure, retry, conflict, and recovery semantics;
5. audit fields and proof that pairing codes and hashes, authorization codes,
   token responses, the service credential and hash, and the `Authorization`
   Header are redacted;
6. focused tests for rejection paths and zero unintended side effects.

For approved writeback, the evidence must additionally prove:

- approval committed a receipt for the exact reviewed revision and content
  hash;
- the opaque confirmation token is authenticated, canonical, expiring, and
  bound to the proposal revision, semantic content and complete file hash,
  target, optional task, complete touched-note set, and bounded audit context;
- missing, malformed, tampered, expired, replayed, or drifted confirmation
  state is rejected before any new write;
- target and task compensation removes only effects owned by the operation and
  never overwrites later user edits;
- `audit_pending` recovery reuses a bounded committed transition receipt,
  appends the audit effect at most once, and does not replay terminal conflicts
  or legacy body-bearing records;
- audit contains neither confirmation tokens nor their hashes, while operation
  journal JSON contains no plaintext token, note body, recovery payload, or
  completed result;
- normalized recovery payloads and completed results retained for exact retry
  are authenticated-encrypted with binding to operation id, idempotency key,
  payload hash, and value kind, while bounded step receipts and terminal status
  are protected by an authenticated monotonic progress anchor;
- legacy plaintext records are rewritten in sealed form on a subsequent safe
  save or quarantined when their body-bearing schema is not replay-safe, and
  journal tests do not claim protection from another process with the same
  filesystem authority as the adjacent key;
- recovery errors, notices, and logs contain neither proposal or target bodies
  nor raw confirmation tokens;
- concurrent proposal edits preserve both the current file and the user's
  unsaved draft, announce the conflict through an assistive live status, and
  restore keyboard focus to an actionable control.

For proposal archive, legacy-structure migration, audit shards, or Runtime-log
cleanup, the evidence must additionally prove:

- the displayed preview and confirmation cover the exact bounded path, identity,
  hash/version, destination, retained-file, managed-reference, cutoff, and
  configured-trash state relevant to that operation;
- changed, expired, duplicate, ambiguous, malformed, oversized, or externally
  modified state fails before the next native move, append, or trash effect;
- Vault-scoped path serialization and optimistic validation prevent concurrent
  Tracekeeper writers from overwriting one another, while direct user or
  third-party edits remain detectable conflicts rather than trusted lock
  participants;
- proposal archive persists bounded per-target ownership before native move,
  rejects cross-operation takeover before and after restart, and advances claim
  and receipt revisions only through compare-and-replace;
- legacy migration binds the displayed mapping, fresh source/target evidence,
  native edge baseline, MetadataCache generation, and capability result;
  obtains exclusive ownership of every synthetic probe folder before cleanup;
  serializes the complete same-migration operation; re-derives recovery paths
  from its integrity-bound journal; performs final post-intent source, target,
  and empty-root rechecks before native effects; and blocks stale,
  both-present, neither-present, changed-target, unresolved-edge, or metadata
  uncertainty without adopting or overwriting user content;
- native move uses `FileManager.renameFile()`, generated links use
  `FileManager.generateMarkdownLink()`, shard append uses `Vault.process()`, and
  cleanup uses `FileManager.trashFile()` with zero reachable `Vault.delete()`;
- stable proposal and audit identities make restart and exact retry
  duplicate-safe, while both/neither-path ambiguity and post-trash intent are
  reported as conflict or outcome-unknown rather than guessed;
- bounded previews, receipts, audit fields, UI notices, and recovery errors
  exclude note bodies, credentials, tokens, absolute external paths, and
  unbounded arguments.

Client interoperability exceptions must remain narrow and must not relax
loopback, redirect, resource, PKCE, or Bearer enforcement. The current Codex
callback relay compatibility advertises that the authorization-response `iss`
parameter is not required, while Tracekeeper still returns a matching `iss` in
the redirect and tests that value. Codex may also repeat the same decoded
`resource` indicator. Tracekeeper accepts that repetition only when every value
is non-empty and identical, then applies the usual exact MCP-resource check;
missing, empty, or conflicting values remain invalid.

Authorization HTML uses `Referrer-Policy: same-origin` so Chromium preserves the
exact loopback `Origin` on both confirmation form posts. Cross-origin redirects
to the client's distinct loopback callback still receive no referrer. OAuth
JSON responses keep `no-referrer`, and form posts remain rejected unless their
`Origin` exactly matches the active Runtime origin.

The confirmation page and its redirect response extend `form-action` only with
the exact origin of the already registered and validated loopback callback.
This permits Chromium to follow the OAuth redirect across local ports without
allowing arbitrary form destinations; all other authorization HTML remains
`form-action 'self'`.

## Proportional Validation For Local MCP

Tracekeeper's current network surface is an exact-loopback MCP service hosted by
desktop Obsidian. It is not a LAN service, remote control plane, hosted OAuth
provider, generic network client, or shell boundary. Security validation must
therefore prove the local transport and Vault contracts without turning normal
release qualification into penetration testing or attack simulation.

Model-assisted repository work is limited to:

- static source, control-flow, trust-boundary, and data-flow review;
- in-process protocol and policy tests that do not create a listener or issue a
  network request;
- existing ordinary tests selected through an explicit non-listener allowlist;
- post-fix regressions that prove invalid state is rejected or handled safely.

Model-assisted work must not run a pre-fix exploit or exfiltration reproduction,
tamper with state to demonstrate a vulnerability, probe authentication bypass
against a live listener, perform port or network scanning, or use high-scale
fuzzing as a release gate. A full-repository cyber-security scan is not a
default release requirement for the current local-only product boundary.

The small amount of real network evidence required for bind lifecycle and
client interoperability is deterministic product QA. A normal CI runner or a
human operator runs fixed loopback fixtures and real supported-client flows in
disposable Vaults, records bounded redacted results, and does not rely on a
model to generate or adapt attack traffic. Model-assisted review may inspect
those completed artifacts without replaying the network flow.

The repository entry point for the fixed automated portion is
`npm run qa:external-loopback`. It requires an explicit external-QA marker, a
full candidate SHA equal to `HEAD`, and a completely clean worktree before it
runs the exact Runtime OAuth and MCP protocol smoke scripts. It neither selects
targets nor generates adaptive traffic.

Adding LAN or remote listening, hosted OAuth, a remote service, generic network
retrieval, or shell execution changes this proportionality decision. Such a
change requires an explicit product and architecture decision, a revised threat
model, and separately authorized security testing before implementation or
release. Any use of a model-provider trusted cyber-access program remains a
separate user or organization decision; it does not expand Tracekeeper's product
requirements or testing authority.

Use temporary Vaults and client fixtures. Do not test a write path against a real
user Vault without explicit authorization.

Any proposal to add remote services, non-loopback HTTP OAuth, hosted OAuth,
shell execution, unrestricted Vault-outside access, or automatic global durable
writes changes the product trust model. It requires explicit product and
architecture decisions before implementation.

The enforced runtime and data boundaries are defined in
[Trust Boundaries](../architecture/TRUST_BOUNDARIES.md).
