# Knowledge Runtime

The Knowledge Runtime projects a stable, versioned read model from the active
Vault and coordinates bounded writes without creating a second knowledge store.

## Vault Model

Tracekeeper uses three top-level roots:

```text
00_tracekeeper/   operational control, inbox, work records, audit, and journals
01_knowledge/     durable Memory, Wiki, and Sources owned by the user
02_archive/       inactive or completed artifacts
```

Body wikilinks are the graph contract. Relationship fields such as
`related_wiki` and `related_sources` are mirrored in note bodies so Obsidian,
Recall, and graph inspection share the same relationships.

## Repository Boundary

Core defines an asynchronous Vault repository port for safe reads,
create-if-absent, optimistic replacement, and Markdown listing. The port exposes
only Vault-relative paths.

- The Obsidian adapter is the production implementation and coordinates writes
  with Vault APIs and file events.
- The Node filesystem adapter is used by the standalone development composition
  and temporary fixtures. It enforces containment, symlink rejection, atomic
  replacement, and file-version checks.

Optimistic versions detect external edits; they are not a second source of
truth. A stale replacement fails instead of silently overwriting newer content.

## Read And Recall Flow

1. The plugin creates an empty index, subscribes to Vault events, and rebuilds
   the first snapshot in the background.
2. Create, modify, delete, and rename events update affected records and graph
   edges. Events received during rebuild are queued and replayed.
3. Each tool invocation receives one stable snapshot generation.
4. Recall ranks bounded Memory, Wiki, Source, task, and session candidates using
   the requested scope and Runtime-resolved project identity.
5. The Agent consumes excerpts, match reasons, and verified relations first,
   then reads a complete note only when necessary.

The index is disposable. Status exposes readiness and generation, and a rebuild
can reproduce it from Markdown.

## Project Memory

One stable `project_id` owns a project hub at
`01_knowledge/memory/projects/<project-key>/index.md`. The display hint and
observed Agent type are metadata, not authorization or identity. A missing hub
may be materialized only from an exact normalized repository path; hint-only,
ambiguous, or conflicting evidence is review-bound.

Eligible `propose_memory` and `finish_task` operations use exclusive create to
write one immutable entry under
`01_knowledge/memory/projects/<project-key>/agents/<agent-type>/`. The entry
path and canonical operation hash make exact retries converge and changed
payloads conflict. Entries link to the hub and verified Wiki or Source notes
through the production repository's `FileManager.generateMarkdownLink()`
boundary, so the shared native edge DTO and Obsidian Backlinks provide the
aggregate without rewriting the hub.

Legacy project `memory.md` notes remain byte-preserved read members. They are
included in project Recall and the complete project-memory catalog but are
never represented as operation records. Recall remains relevance-ranked and
candidate-bounded. The read-only `tracekeeper.project_memory` catalog projects
metadata-only rows over one snapshot generation, binds cursors to the project,
sort, and generation, and fails closed on incomplete or contradictory
identity. Full note bodies remain behind `tracekeeper.read_note`. Bases are
optional presentation and are not a storage or discovery dependency.

## Recoverable Writes

Task closeout, project auto-memory, source and proposal creation, and approved
writeback use operation identity proportional to their risk. Coordinated
operations use:

- stable operation and idempotency identities;
- payload-hash conflict detection;
- atomic journal claims and a Vault-local process lock;
- authenticated encryption at rest for normalized recovery payloads and
  completed results, bound to operation identity, idempotency identity,
  payload hash, and value kind;
- an authenticated progress anchor that preserves the longest durable ordered
  step prefix and terminal status across record replacement;
- optimistic file replacement and stable content markers;
- per-step journal progress and startup roll-forward recovery;
- bounded, redacted audit projections.

Retries return the first compatible result. Reusing a key for a changed payload
or another tool fails closed. Recovery never rolls user-visible Markdown back
over a later edit. On-disk journal JSON contains neither a plaintext recovery
payload nor a plaintext completed result; callers recover those values only
through the journal API. Legacy plaintext records are rewritten in sealed form
on a subsequent safe save, while incompatible body-bearing writeback records
are quarantined instead of replayed.

Proposal identity is independent of its current path. Active review enumerates
only the review queue, while history lookup resolves the same explicit
`proposal_id` across the active and archive roots and reports missing,
duplicate, or ambiguous identity instead of selecting an arbitrary note.
Archiving an eligible proposal is a separate human-confirmed operation:

1. a bounded preview captures every source and destination path, source
   revision and hash, destination absence, and Tracekeeper-owned task/session
   reference version;
2. confirmation is bound to that exact preview and expires;
3. after valid confirmation, commit persists a bounded per-target ownership
   claim and operation intent before any move; a different operation cannot
   adopt the same source/destination pair before or after restart;
4. commit revalidates the complete set under the same Vault path-lock domain as
   proposal transitions, moves through
   `FileManager.renameFile()`, waits for native metadata convergence, and
   regenerates managed links with `FileManager.generateMarkdownLink()`;
5. a bounded operation receipt and completed target claim record only path,
   hash, managed-reference, and completion evidence needed for exact retry.

An expired preview cannot start a new archive. Once a valid confirmation has
persisted its intent, restart may roll that exact operation forward; changed
claim, receipt, source, destination, identity, or reference state fails closed.
The persisted operation start time is also the archive audit event time, so a
retry after UTC day rollover remains in the same shard and keeps one event id.

Legacy-structure migration uses a separate Vault-local journal under
`00_tracekeeper/control/operations/legacy-migrations/`. Its immutable identity
binds the mapping, fresh source and target hashes, resolved-edge baseline,
MetadataCache generation, effective link-update capability, and displayed
confirmation. The journal stores bounded paths, hashes, edge shapes, states,
and errors but no note bodies or credentials. Compare-and-replace revisions
and Vault path locks serialize each source/target pair, while an in-process
same-migration queue serializes the complete operation across controller
instances. Recovery re-derives its plan from the journal before using those
same paths. After persisting a durable move or cleanup intent, the controller
re-resolves and rechecks the exact source, destination, or empty root immediately
before calling the native move or trash API.

When inbound links exist, a synthetic preflight first obtains its exact
temporary folder through `Vault.createFolder()`, generates the link with
`FileManager.generateMarkdownLink()`, moves the target with
`FileManager.renameFile()`, and verifies both resolved edges through the shared
native index. Only the invocation that atomically created that folder may send
it to configured trash. User files then advance monotonically through
`planned`, `preflight_passed`, `moved`, `enriched`, and `verified`; uncertainty
is retained as bounded blocked or failed state. Reports and audit events are
projections of persisted journal state and may be refreshed after recovery.
Empty legacy roots have their own preview-bound cleanup attempt state and use
`FileManager.trashFile()` only after all planned descendants are verified.

New audit events append to UTC daily Markdown shards through `Vault.process()`.
Stable event ids suppress exact retries, Vault-scoped path locks coordinate
plugin and Runtime writers, and a generated link from each shard to the audit
hub keeps Backlinks useful. The legacy monolith remains readable but receives no
new events; readers merge both sources deterministically by event identity.

Runtime-log cleanup is also preview-bound. It classifies every current audit
file from fresh content, retains mixed-age or conflicted files, persists bounded
progress before each external effect, and sends only wholly eligible files
through `FileManager.trashFile()`. Receipt revisions distinguish completed,
partial, stale, and outcome-unknown results so restart never guesses whether an
interrupted trash effect occurred. The next audit append may recreate a removed
daily shard.

## Vault-Outside Integration

Explicitly confirmed Skill installation is the normal Vault-outside write owned
by the Obsidian plugin; MCP tools do not perform it. The user selects a Skills
root through the desktop directory picker, and Tracekeeper previews a single
`tracekeeper` target beneath it (or uses the selected directory when it is
already named `tracekeeper`). Official client locations are suggestions only.
An AI-assisted flow exports the complete local bundle to a versioned plugin
source directory and supplies a prompt; it does not claim installation until a
user-selected external directory passes verification. Agent connection
configuration remains owned by each client's official OAuth/MCP entry.

Every direct Skill change:

1. previews the exact target and Tracekeeper-only modification;
2. binds a short-lived plan to original hashes, bundle identity, and the exact
   target;
3. requires explicit confirmation;
4. revalidates before commit;
5. preserves unrelated content;
6. creates a backup and stages replacement;
7. rolls back partial installation failure where possible;
8. records a bounded local audit result without credentials, authorization
   Headers, credential hashes, or absolute target paths.

Every existing physical path segment from the selected Skill target through its
parent chain is checked with `lstat`; a symbolic-link segment blocks detection,
preview, backup, staging, and replacement. Successful file commit is the
durable boundary. If local receipt persistence or audit append fails afterward,
the result is reported as partial with the files already installed; the user is
directed to detect current state instead of repeating the write.

Unknown, conflicting, newer, or user-modified Skill installations are never
silently overwritten. An installed and hash-verified Skill proves only file
identity. It does not prove that a client loaded the Skill or that an Agent
followed it; those claims require observed same-Session workflow evidence.
