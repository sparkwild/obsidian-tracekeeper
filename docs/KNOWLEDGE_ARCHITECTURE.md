# Tracekeeper Knowledge Architecture

Tracekeeper uses one local Agent Knowledge System. Memory and Wiki are not separate products: memory records what happened, while wiki pages give those memories stable topic anchors for Obsidian graph and agent recall.

## Directory Layout

```text
00_tracekeeper/
  control/
  inbox/
    agent_requests/
    review_queue/
  work/
    tasks/
    sessions/
    context_packs/
    source_analysis/
01_knowledge/
  index.md
  memory/
    index.md
    global/
    projects/
      index.md
      <project>/
        index.md
        memory.md
  wiki/
    index.md
    hubs/
      index.md
    concepts/
    claims/
    guides/
    references/
  sources/
    index.md
    web/
    files/
    transcripts/
    attachments/
02_archive/
  review_queue/
```

`00_tracekeeper` is for plugin/runtime workflow records. `01_knowledge` is the durable knowledge layer. `02_archive` stores processed or old operational records.

Legacy folders are read for compatibility only: `00_control`, `01_inbox`, `02_timeline`, `03_sources`, `04_memory`, `05_projects`, `06_outputs`, and `07_archive`. Lint reports them, and the Obsidian plugin structure check can rebuild their content into the current layout after user confirmation.

## Structure Organizer

The plugin-side structure check is the only place that performs legacy cleanup. MCP lint stays read-only.

- First it repairs missing base entries only.
- Then it previews legacy roots, file counts, copy targets, and conflicts.
- Copy/rebuild never overwrites current files; conflicts become `legacy_migration_review` items in the Review Queue.
- Cleanup is a second confirmation step and uses Obsidian system trash, not permanent deletion.
- Migration and cleanup reports are written under `00_tracekeeper/control/migrations/`.
- A task record is written under `00_tracekeeper/work/tasks/` so the activity home shows the cleanup as the latest task.

## Memory-Wiki Bridge

Durable memory should not become isolated project logs. Each memory note needs explicit graph links to the Wiki topics it supports.

Project memory target:

```text
01_knowledge/memory/projects/<project>/memory.md
```

Project memory index:

```text
01_knowledge/memory/projects/<project>/index.md
```

Memory notes should include:

```markdown
## Graph links

- [[01_knowledge/wiki/hubs/example_topic|Example topic]]
- [[01_knowledge/sources/example_source|Example source]]
```

Wiki hubs or concepts should include:

```markdown
## Related memory

- [[01_knowledge/memory/projects/example/memory|Example project memory]]
```

## Write Policy

- Global memory defaults to Review Queue.
- Project memory may auto-save when the user enables automatic project memory.
- Project auto-save is append-only and requires a valid Wiki bridge.
- Missing or unresolved Wiki bridge downgrades project memory to Review Queue.
- Agents should not choose arbitrary durable memory paths.
- YAML relations such as `related`, `sources`, `related_wiki`, and `related_memory` should also appear as body wikilinks.

## Lint Coverage

`tracekeeper.lint` checks the architecture without migrating data automatically.

Issue kinds:

- `architecture_legacy_directory`
- `architecture_missing_required_path`
- `architecture_invalid_memory_path`
- `architecture_invalid_wiki_path`
- `graph_missing_memory_wiki_bridge`
- `graph_missing_wiki_memory_backlink`
- `graph_missing_project_index`
- `graph_yaml_only_relation`
- `write_policy_unstable_target`

In `advisory` mode these are warnings. In `strict` mode, missing required entries, invalid memory/wiki paths, and missing memory-to-wiki bridges become errors. Structural graph findings are suppressed when graph profile is `off`.

## Recall

Recall treats memory, wiki, and sources as one pool. Project recall should prefer:

1. Project memory index and project memory notes.
2. Related Wiki hubs and concepts.
3. Related source notes.
4. Task and session records linked through the same project hint.

This keeps agent context selective while still allowing cross-session continuity for the same project.
