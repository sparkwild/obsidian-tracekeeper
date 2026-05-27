# Tracekeeper

[简体中文说明](./README.zh-CN.md)

Tracekeeper is an Obsidian plugin for people who want AI to help maintain a personal wiki without letting automation rewrite their memory unchecked.

It turns AI-assisted knowledge work into reviewable traces: source notes, proposed updates, and human decisions stay visible inside Obsidian.

## Installation

After Tracekeeper is listed in the Obsidian Community Plugins directory:

1. Open **Settings** in Obsidian.
2. Go to **Community plugins**.
3. Turn on community plugins if your vault has not enabled them yet.
4. Select **Browse**, search for **Tracekeeper**, then install it.
5. Enable **Tracekeeper** from the installed plugins list.

Before community listing, install from the latest GitHub release:

1. Download `main.js`, `manifest.json`, and `styles.css` from the release whose tag matches the version in `manifest.json`.
2. Create `plugins/tracekeeper/` inside the vault's Obsidian configuration folder.
3. Copy the three files into that folder.
4. Restart Obsidian or reload community plugins, then enable **Tracekeeper**.

## The Idea

AI assistants are useful for finding patterns, summarizing long conversations, and turning scattered material into structured knowledge. A personal vault still needs a human steward.

Tracekeeper keeps that boundary clear. AI can help recall context, draft wiki updates, and prepare long-term memory entries, while you keep the final decision before anything becomes durable knowledge.

## Why It Exists

Personal knowledge bases often fail in two opposite ways: conversations stay trapped in chat history, or automation writes too eagerly and pollutes the vault. Tracekeeper sits between those extremes.

Tracekeeper treats every AI suggestion as a candidate. You can inspect it, adjust it, approve it, or reject it from the same place where your notes already live.

## First Use

1. Write and collect notes in Obsidian as usual.
2. Enable Tracekeeper and open the **AI Assistant Connections** view.
3. Copy or auto-configure the connection for your AI tool.
4. Ask the AI assistant to summarize, connect, or refine a topic from your vault.
5. Review proposed wiki or memory updates in the **Review Queue**.
6. Edit, approve, reject, defer, or request revisions before anything becomes durable memory.

## Agent And MCP Connection

Tracekeeper exposes a local Streamable HTTP MCP Runtime while desktop Obsidian is open. The Runtime binds to loopback by default and uses a generated local token in the connection URL or bearer token.

AI tools connect through `tracekeeper.*` MCP tools. The connection lets an assistant read selected vault context, build context packs, record bounded working notes, and propose memory updates for review. It does not give an assistant permission to silently rewrite long-term memory.

The connection is local-first:

- no hosted Tracekeeper backend
- no default network upload
- no shell command execution
- no vault-outside file access from MCP tools
- no Obsidian configuration directory reads through MCP tools

## Review Queue

Long-term memory changes are review-gated. When an assistant proposes a durable update, Tracekeeper stores it as a Review Queue item first. You decide whether to approve, reject, defer, or request revision.

Approved writeback is a separate action. Tracekeeper only applies an approved proposal to its target note after that review step has happened.

## What It Helps With

- Turning scattered project notes into coherent wiki pages.
- Capturing recurring preferences, decisions, and lessons as long-term memory.
- Reviewing AI-generated knowledge before it becomes part of your vault.
- Keeping AI collaboration grounded in your own Obsidian workspace.
- Finding graph entry gaps so AI tools can assemble context from stable hubs instead of scattered leaf notes.
- Building a personal knowledge system where automation suggests and the user decides.

## Graph Health

Tracekeeper can report Obsidian wikilink graph health through the read-only `tracekeeper.graph_health` tool. It measures isolated notes, one-way leaf nodes, connected components, hub candidates, unresolved wikilinks, and missing recommended graph entry files.

The graph health profile is configured in the Tracekeeper settings:

- `off`: graph structure is available for manual inspection only and is not added to lint.
- `advisory`: graph findings are reported as warnings and suggestions.
- `strict`: missing graph entry notes, missing recommended hubs, isolated notes, and unresolved graph links become lint errors.

Graph health never creates notes or rewrites links by itself. Use the report, or the Obsidian Graph Health view, to create a Review Queue proposal before adding a vault-level graph index, topic hubs, or explicit `Graph links` sections.

## Design Principles

- Vault first: Obsidian remains the durable knowledge home.
- Human review first: lasting memory changes should be approved.
- Traceability first: knowledge should keep enough context to be trusted later.
- AI as collaborator: the assistant helps organize and propose, but does not own the vault.

## Safety Model

Tracekeeper is desktop-only because it hosts a local MCP Runtime. The Runtime requires a local token by default and only accepts browser-style CORS requests from Obsidian or loopback origins.

MCP writes are intentionally narrow:

- working records are written only to Tracekeeper-controlled vault folders
- generated records do not overwrite existing notes
- approved writeback appends to an existing target note from an approved proposal
- delete, rename, bulk rewrite, and system command execution are not available MCP actions

User-confirmed client configuration is the only expected write outside the active vault. Tracekeeper previews the target configuration and creates a backup before changing supported AI tool config files.

## License

This project is licensed under the [MIT License](./LICENSE).
