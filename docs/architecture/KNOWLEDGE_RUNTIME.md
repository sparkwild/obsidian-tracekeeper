# Knowledge Runtime

The Knowledge Runtime projects a stable, versioned read model from the active
Vault and coordinates bounded writes without creating a second knowledge store.

## Vault Model

Tracekeeper uses three top-level roots:

```text
00_tracekeeper/   operational control, inbox, work records, Agent activity, and journals
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

Source candidates are durable provenance, not approved synthesis. Their
presence in Recall or `read_note` does not imply that any linked Wiki/Memory
proposal has been approved or applied; the finish-task durable-output summary
owns that closeout distinction.

The index is disposable. Status exposes readiness and generation, and a rebuild
can reproduce it from Markdown.

## Memory Lifecycle

The global Memory hub is `01_knowledge/memory/global/index.md`; project hubs
live at `01_knowledge/memory/projects/<project-key>/index.md` and link to the
projects parent hub. MemoryRecord v2 is the writable record shape for both
scopes. It requires a stable claim identity, authority, confidence, declared
state, temporal fields, evidence, and explicit supersession or contradiction
relations. The read model resolves these immutable records into `current`,
`history`, and `conflicts` without rewriting historical Markdown. Invalid,
cyclic, duplicate-current, or unresolved records fail into review diagnostics
instead of an arbitrary winner.

Agent-originated evidence may establish at most `supported` confidence during
Global or Project Auto. A requested `verified` level is capped to `supported`
rather than forcing an otherwise eligible Memory candidate into the queue. User
authority, non-active lifecycle transitions, unresolved current-claim
conflicts, and uncertain project identity remain review-gated. Queued proposals
persist the policy reason and warnings shown by the Obsidian review surface.

One stable `project_id` owns a project hub at
`01_knowledge/memory/projects/<project-key>/index.md`. The display hint and
observed Agent type are metadata, not authorization or identity. A direct
Memory candidate declares global or project scope; `project_hint` never selects
scope. A missing or invalid canonical Global or project Hub blocks persistence
and returns an explicit structure-repair action. Hub creation belongs to that
human-initiated structure flow, not the memory write.

Eligible `propose_memory` and `finish_task` operations use one scope-aware
writer and exclusive create to write an immutable entry under
`01_knowledge/memory/global/agents/<agent-type>/` or
`01_knowledge/memory/projects/<project-key>/agents/<agent-type>/`. A Global
record has `project_id: null`. The entry path and canonical operation hash make
exact retries converge and changed payloads conflict. Entries always link to
their Hub and may link to verified Wiki or Source notes through the production
repository's `FileManager.generateMarkdownLink()` boundary. Missing relations
are valid; explicitly supplied but unverifiable relations enter review. The
shared native edge DTO and Obsidian Backlinks provide the aggregate without
rewriting the Hub.

Legacy project `memory.md` and other unkeyed Memory notes remain byte-preserved
read members but never become v2 operation records automatically. Recall
remains relevance-ranked and candidate-bounded. The only public catalog,
read-only `tracekeeper.memory`, projects metadata-only rows for global or
project scope and `current`, `history`, `conflicts`, or `all` view over one
snapshot generation. Its cursor binds scope, project identity where present,
view, sort, and generation, and it fails closed on stale pagination or
incomplete or contradictory project identity. Full note bodies remain behind
`tracekeeper.read_note`. No public project-specific catalog alias exists,
and Bases are optional presentation rather than a storage or discovery
dependency.

## Source Ownership

Source capture normalizes input to `web`, `file`, or `transcript`, then routes
it under the matching `01_knowledge/sources/` owner. The stable Source index
records `source_id`, content hash, route, and part manifest. Content up to the
inline bound remains in the index note; larger UTF-8 content is split into a
bounded number of size-bounded, individually hashed `source_part` notes. The
index visibly links every part, each part identifies its parent Source, and
knowledge relations point to the index so parts do not appear as independent
user-level sources.

## Doctor And Legacy Promotion

`tracekeeper.lint` v3 combines structure, graph, Memory lifecycle, claim,
authority/evidence, Source-part, and bounded-growth diagnostics in one
read-only Doctor result. Its legacy candidates contain path, hash, scope, and
non-authoritative identity suggestions only. The plugin promotion controller
binds a preview to the ready snapshot generation, candidate hashes, and exact
proposal bytes; apply re-reads the Doctor snapshot and creates only a pending
review proposal for a unique suggestion. Missing or ambiguous identity stays
blocked. The source legacy note is never rewritten, moved, deleted, or silently
promoted.

## Recoverable Writes

Task closeout, Global and Project auto-memory, source and proposal creation, and
approved writeback use operation identity proportional to their risk.
Coordinated operations use:

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
- bounded, redacted Agent activity projections.

Retries return the first compatible result. Reusing a key for a changed payload
or another tool fails closed. Recovery never rolls user-visible Markdown back
over a later edit. On-disk journal JSON contains neither a plaintext recovery
payload nor a plaintext completed result; callers recover those values only
through the journal API. Legacy plaintext records are rewritten in sealed form
on a subsequent safe save, while incompatible body-bearing writeback records
are quarantined instead of replayed.

A finish operation snapshots exact proposal ids and review-owner paths already
managed by its task before journaling. That snapshot, plus any finish-generated
or auto-applied output, produces the separate durable-output result. Missing,
mismatched, or out-of-owner references remain unresolved evidence. Exact finish
retries return the original snapshot instead of reinterpreting a proposal after
later human review.

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
The persisted operation start time remains the archive receipt timestamp. Human
archive actions do not create Agent activity events, so retries do not affect
the activity timeline.

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
is retained as bounded blocked or failed state. Reports and Agent activity
projections (when an operation was initiated through MCP) derive from persisted
journal state and may be refreshed after recovery.
Empty legacy roots have their own preview-bound cleanup attempt state and use
`FileManager.trashFile()` only after all planned descendants are verified.

New Agent activity events append to canonical UTC daily Markdown shards under
`00_tracekeeper/control/agent_activity/` through `Vault.process()`. Stable
activity ids suppress exact retries, Vault-scoped path locks coordinate plugin
and Runtime writers, and a generated link from each shard to the Agent Activity
hub keeps Backlinks useful. Legacy audit history is retained only for explicit
cleanup and is not read or migrated by the activity reader.

Agent activity cleanup is preview-bound. It classifies every current canonical
shard from fresh content, retains mixed-age or conflicted files, persists
bounded progress before each external effect, and sends only wholly eligible
files through `FileManager.trashFile()`. Receipt revisions distinguish
completed, partial, stale, and outcome-unknown results so restart never guesses
whether an interrupted trash effect occurred. The next MCP activity append may
recreate a removed daily shard.

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
8. records a bounded local receipt without credentials, authorization Headers,
   credential hashes, or absolute target paths; human Skill actions do not create
   Agent activity events.

Every existing physical path segment from the selected Skill target through its
parent chain is checked with `lstat`; a symbolic-link segment blocks detection,
preview, backup, staging, and replacement. Successful file commit is the
durable boundary. If local receipt persistence fails afterward, the result is
reported as partial with the files already installed; the user is directed to
detect current state instead of repeating the write.

Unknown, conflicting, newer, or user-modified Skill installations are never
silently overwritten. An installed and hash-verified Skill proves only file
identity. It does not prove that a client loaded the Skill or that an Agent
followed it; those claims require observed same-Session workflow evidence.
