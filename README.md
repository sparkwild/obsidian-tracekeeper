# Tracekeeper

[简体中文说明](./README.zh-CN.md)

Tracekeeper is an Obsidian-native, local-first knowledge and AI-memory system. It lets explicitly connected AI agents recall scoped vault context and propose durable updates through a loopback-only, credential-protected MCP Runtime, while Obsidian remains the human workspace and the vault remains the source of truth.

## What Tracekeeper Does

- Connects AI tools to the active vault through a local MCP Runtime while desktop Obsidian is open.
- Recalls selected vault context and builds bounded context packs without exposing unrestricted filesystem access.
- Routes Wiki changes through human review and applies approved writebacks only after preview and explicit confirmation.
- Saves Global or Project memory according to user-selected policy as governed, immutable Markdown records with retry-safe operation identity.
- Keeps durable knowledge in ordinary vault files with no hosted Tracekeeper backend or external database.

## Installation

After Tracekeeper is approved for the Obsidian Community Plugins directory, install it there:

1. Open **Settings** in Obsidian.
2. Go to **Community plugins**.
3. Turn on community plugins if your vault has not enabled them yet.
4. Select **Browse**, search for **Tracekeeper**, then install it.
5. Enable **Tracekeeper** from the installed plugins list.

Before directory approval, or for manual installation and release-candidate testing, install from the matching GitHub release:

1. Download `main.js`, `manifest.json`, and `styles.css` from the release whose tag matches the version in `manifest.json`.
2. Create `plugins/tracekeeper/` inside the vault's Obsidian configuration folder.
3. Copy the three files into that folder.
4. Restart Obsidian or reload community plugins, then enable **Tracekeeper**.

## The Idea

AI assistants are useful for finding patterns, summarizing long conversations, and turning scattered material into structured knowledge. A personal vault still needs a human steward.

Tracekeeper keeps that boundary clear:

- Memory captures tasks, sessions, decisions, preferences, and project continuity.
- Wiki organizes reusable topics, hubs, sources, and graph entry points.
- Memory can link to verified Wiki or Source notes when those relations exist, so Obsidian graph and Agent Recall can use the same structure without requiring a Wiki for every record.
- No external database is required, and no app auto-sync platform is required.

AI can help recall context, draft proposals, and prepare updates. You choose the persistence policy: Review keeps the final write decision with you, while Auto is limited to governed immutable MemoryRecord v2 writes.

## Why It Exists

Personal knowledge bases often fail in two opposite ways: conversations stay trapped in chat history, or automation writes too eagerly and pollutes the vault. Tracekeeper sits between those extremes.

Tracekeeper routes durable AI output according to explicit policy. Wiki changes and review-routed memory stay inspectable and require human approval; eligible Auto memory uses the same validation, identity, lifecycle, and conflict controls before creating an immutable record.

## First Use

1. Write and collect notes in Obsidian as usual.
2. Enable Tracekeeper and open **Settings -> Community plugins -> Tracekeeper**.
3. In **MCP Service**, start the Runtime and confirm that the credential-free loopback endpoint reports **Local access protected**.
4. In **Agent Configuration**, choose **Add Agent** and one AI tool. The persistent card appears immediately. Run only the public, client-native command shown there; copy is explicit and remains unverified until the client reaches the endpoint.
5. Use the card's default OAuth flow when the client supports it: the browser waits while Obsidian shows an explicit Allow/Deny approval. Choose manual Bearer only when the client can safely store credentials. After issuing a credential once, Tracekeeper can explicitly copy a complete `mcpServers` JSON object containing the endpoint and authorization header; the JSON exists only in the current modal and is never stored by Tracekeeper.
6. Install the companion Skill from the Agent card by explicitly selecting a Skills directory, or use the AI-assisted prompt with the exported local bundle. A copied prompt is not proof of installation; Tracekeeper verifies the final directory and bundle hash. Skill installation, authorization, connection, and usage remain independent; reload the AI tool if required and ask it to initialize Tracekeeper and call a `tracekeeper.*` tool.
7. Review proposed memory, wiki, graph, or migration changes in **Knowledge Change Review**.
8. Edit a change proposal, approve it, return it for revision, or do not accept it. An approved change still requires a preview and explicit apply confirmation before it enters the vault.

## Agent And MCP Connection

Tracekeeper exposes a local Streamable HTTP MCP Runtime while desktop Obsidian is open. Production binds to exact `127.0.0.1`, and every MCP resource request requires a credential belonging to one persistent Agent integration. The endpoint and client-native command never contain credentials. Supported clients discover Tracekeeper's local OAuth metadata, complete authorization-code + PKCE with RFC 8707 resource binding, and receive a per-Agent access token. Manual Bearer credentials use the same verifier, Session binding, revocation, and audit foundation.

Each Agent credential is an access gate bound to its integration and Session, not to untrusted `clientInfo`. OAuth and manual Bearer credentials are independently replaceable and revocable; replacing or revoking one closes its Sessions without changing other cards or Skill files. Successful requests still use the Runtime's fixed `local-user` capability set.

AI tools connect through `tracekeeper.*` MCP tools. The connection lets an assistant read selected vault context, build context packs, record bounded working notes, and submit memory updates according to your memory rules. Fresh installations use Global Review and Project Auto; you can select Review or Auto per scope. Eligible Auto operations create their own immutable MemoryRecord v2 entry under the canonical Global or Project Hub.

For shared use across Codex, Claude, OpenClaw, and other MCP clients, the companion Skill selects `no_track`, `recall_only`, or `tracked_task`. Tracked work starts once, recalls the narrowest useful context, finishes once with the returned task id, and reports whether closeout memory was saved, queued, suggested, or blocked. Recall results label Vault content as knowledge data rather than instructions, and structured MCP actions reduce client-side guesswork. See the [Agent Workflow](./docs/features/AGENT_WORKFLOW.md).

The connection is local-first:

- no hosted Tracekeeper backend
- no external database
- no app auto-sync or background sync service
- no default network upload
- no shell command execution
- no vault-outside file access from MCP tools
- no Obsidian configuration directory reads through MCP tools

## Knowledge Change Review

Global long-term memory changes are review-gated by default. When Global Review is selected, Tracekeeper stores a durable global update first as a change proposal in Knowledge Change Review. The same surface presents Wiki changes, graph-health suggestions, and structure-migration conflicts that need human confirmation. You decide whether to approve, return for revision, or not accept a proposal. Global Auto remains an explicit user-selected policy and writes only governed MemoryRecord v2 entries.

Approval and writeback are separate actions. Tracekeeper only applies an approved proposal to its target note after you preview and explicitly confirm the writeback.

Project memory auto-saves by default as create-only entries under `01_knowledge/memory/projects/<project-key>/agents/<agent-type>/`. Stable operation identity makes an exact retry reuse the same entry and rejects a changed payload instead of overwriting another operation. Every new entry links to the stable project Hub and, when present, verified Wiki or Source notes through Obsidian-native links. Wiki and Source relations are optional. Existing project `memory.md` files remain readable and catalogued but are not rewritten, split, or migrated automatically.

`tracekeeper.recall` remains a relevance-ranked selection. When an Agent needs complete global or project-memory enumeration, the canonical read-only `tracekeeper.memory` catalog lists current, history, conflict, review, and legacy metadata over one index generation without returning note bodies.

## What It Helps With

- Turning scattered project notes into coherent task/session memories first.
- Capturing recurring preferences, decisions, and lessons as long-term memory.
- Reviewing AI-generated knowledge before it becomes part of your vault.
- Keeping AI collaboration grounded in your own Obsidian workspace.
- A stable Memory + Wiki structure where immutable project-memory entries stay connected to project and topic hubs.
- Building a personal knowledge system where automation suggests and the user decides.

## Graph Health

Tracekeeper reports Obsidian wikilink graph health through `tracekeeper.lint`. The lint output includes isolated notes, one-way leaf nodes, connected components, hub candidates, unresolved wikilinks, and missing recommended graph entry files.

The graph health profile is configured in the Tracekeeper settings:

- `off`: graph structure is available for manual inspection only and is not added to lint.
- `advisory`: graph findings are reported as warnings and suggestions.
- `strict`: missing graph entry notes, missing recommended hubs, isolated notes, and unresolved graph links become lint errors.

Graph health never creates notes or rewrites links by itself. Use the report, or the Obsidian Graph Health view, to create a knowledge change proposal before adding a vault-level graph index, topic hubs, or explicit `Graph links` sections.

## Design Principles

- Vault first: Obsidian remains the durable knowledge home.
- Policy-controlled persistence: Global Review is the default, and user-selected Auto is constrained to governed immutable memory records.
- Traceability first: knowledge should keep enough context to be trusted later.
- AI as collaborator: the assistant helps organize and propose, but the user owns the Vault, policy, and review decisions.

## Safety Model

Tracekeeper is desktop-only because it hosts a local MCP Runtime. Every MCP resource request requires a valid credential for one persistent Agent integration. Public OAuth routes cannot dispatch tools. The Runtime validates `Host`, restricts browser-style CORS to Obsidian and loopback origins, enforces PKCE and exact loopback redirects, and rejects query-parameter credentials.

MCP writes are intentionally narrow:

- working records are written only to Tracekeeper-controlled vault folders
- generated records do not overwrite existing notes
- approved writeback appends to an existing target note from an approved proposal
- multi-step task and writeback operations are idempotent, journaled, and resumed on runtime startup
- every Session has a random identifier, every Session request revalidates its integration-bound credential, and request-size, session-count, stream, and idle-time limits remain enforced
- delete, rename, bulk rewrite, and system command execution are not available MCP actions

Normal Agent configuration is owned by each client's official OAuth/MCP entry; Tracekeeper does not read or write cross-platform client configuration paths. Skill installation is a user-selected, previewed, and recoverable Vault-outside write; AI-assisted installation only supplies a local source and instructions until the destination is externally verified. Tokens, digests, authorization codes, PKCE verifiers, pending handles, token responses, and Authorization Headers never enter connection URLs, copied commands, AI instructions, Runtime logs, or Vault audit records.

## Documentation

- [Documentation index](./docs/INDEX.md)
- [Product overview](./docs/overview/PRODUCT.md)
- [Feature documentation](./docs/features/INDEX.md)
- [Technology stack](./docs/technology/TECHNOLOGY_STACK.md)
- [Architecture](./docs/architecture/INDEX.md)
- [Agent Workflow](./docs/features/AGENT_WORKFLOW.md)
- [Trust boundaries](./docs/architecture/TRUST_BOUNDARIES.md)
- [Engineering and release guide](./docs/development/ENGINEERING_AND_RELEASE.md)

## License

This project is licensed under the [MIT License](./LICENSE).
