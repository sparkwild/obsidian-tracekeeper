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

## Recoverable Writes

Task closeout, project auto-memory, source and proposal creation, and approved
writeback use operation identity proportional to their risk. Coordinated
operations use:

- stable operation and idempotency identities;
- payload-hash conflict detection;
- atomic journal claims and a Vault-local process lock;
- optimistic file replacement and stable content markers;
- per-step journal progress and startup roll-forward recovery;
- bounded, redacted audit projections.

Retries return the first compatible result. Reusing a key for a changed payload
or another tool fails closed. Recovery never rolls user-visible Markdown back
over a later edit.

## Vault-Outside Integration

Explicitly confirmed Skill installation is the normal Vault-outside write owned
by the Obsidian plugin; MCP tools do not perform it. Agent connection
configuration is owned by each client's official OAuth/MCP entry. Tracekeeper
does not detect or write cross-platform client configuration paths during
normal setup.

Every managed change:

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

Unknown, conflicting, newer, or user-modified Skill installations are never
silently overwritten. Historical direct-configuration adapters may remain only
for an explicitly confirmed migration or recovery operation; they are not a
normal Agent-installation API and never redefine the OAuth credential boundary.
