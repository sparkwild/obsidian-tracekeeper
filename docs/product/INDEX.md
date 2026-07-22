# Product Contract

## Product Identity

Tracekeeper is an Obsidian-native, local-first knowledge and AI-memory system for an individual user. It helps the user maintain durable knowledge in a vault and lets local AI agents recall and propose updates without taking ownership away from the user.

The product is the plugin, the local vault structure, and the controlled Agent connection together. It is not a SaaS system wrapped around Obsidian.

## Product Roles

| Role | Primary responsibility |
| --- | --- |
| User | Owns the vault, chooses connected agents and memory policy, and makes durable review decisions |
| Obsidian | Provides the human knowledge workspace, native file model, links, graph, and plugin surface |
| Tracekeeper plugin | Makes Agent activity, runtime state, permissions, graph health, and proposed writes visible and controllable |
| AI Agent | Recalls scoped context, performs work, records bounded traces, and proposes durable knowledge |
| Companion Skill | Teaches an Agent when to recall, when to close out, and how to respect Tracekeeper's review model |

## Core Value

Tracekeeper addresses two failure modes of personal AI knowledge work:

- useful decisions and context remain trapped in disposable conversations;
- automation writes too eagerly and pollutes long-term knowledge.

The product therefore separates working traces from durable knowledge. Agents can be proactive about recall and closeout while the user retains a visible review and policy boundary.

## Core Workflows

### Maintain knowledge in Obsidian

The user writes and reorganizes notes with normal Obsidian capabilities. Tracekeeper adds a stable Memory + Wiki structure, graph-health feedback, source traces, and review artifacts without replacing the vault's Markdown files with an external database.

### Connect an Agent

The target first-run experience is one recoverable setup flow:

1. Check or initialize the Tracekeeper vault structure.
2. Confirm that the local MCP runtime is running.
3. Select the user's Agent client.
4. Preview and apply, or copy, the MCP connection configuration.
5. Install or display the matching Tracekeeper Skill/workflow instructions.
6. Reload the Agent client when required.
7. Verify connection, permissions, and a test recall.
8. Perform a first project-scoped recall so the user sees the value immediately.

The flow must expose progress and allow resuming after a restart. It must not silently write client configuration or pretend that a Skill was installed when the client has no supported installation mechanism.

The current implementation persists this sequence as a resumable settings workflow. Client configuration, Skill confirmation, restart, connection verification, and first recall are separate states. Connection success requires audit evidence from the selected client's credential principal; first recall requires a successful external `tracekeeper.recall` with at least one match. A plugin-internal preview cannot complete either step.

Each managed Agent profile owns an independent local credential. Rotating one profile invalidates only that Agent's prior connection and returns its onboarding state to configuration/restart verification; other Agent connections remain available.

A repository-hosted companion Skill is available at `skills/tracekeeper/SKILL.md`. The community-plugin build embeds that same file into `main.js`; onboarding can therefore copy the canonical Skill content even when the user installed Tracekeeper without cloning this repository.
It teaches `start_task -> recall -> finish_task` workflows, review boundaries, and approved writeback habits.
It does not grant permissions or define MCP runtime internals.
Automatic Skill installation is not claimed: the current UI provides client-sensitive instructions, copies the embedded canonical Skill, and asks the user to confirm installation or mounting for the selected Agent. It does not silently write outside the vault or into client-owned directories. Client-specific automation gaps are tracked in the [status snapshot](../status/INDEX.md).

### Start, recall, and finish work

For meaningful work, the Agent records a bounded task, recalls only the relevant project or project history, reads full notes only when excerpts are insufficient, and closes the task with outcomes and durable memory candidates. The exact behavior is defined in the [Agent Workflow Contract](../architecture/AGENT_WORKFLOW_CONTRACT.md).

### Review durable changes

Global long-term-memory changes enter the Review Queue by default. The user may edit, approve, reject, or request revision. Applying an approved proposal is a separate action.

Project memory may use a lighter user-controlled rule: append-only auto-save into a project memory note, with duplicate protection and an explicit Wiki bridge. If the bridge is missing, the update falls back to review.

## Human And Agent Boundary

The Agent may:

- search and read vault-scoped context;
- create bounded task, session, source, analysis, and context-pack records;
- submit memory proposals;
- apply content only after the proposal has been approved through the human review flow.

The Agent must not:

- treat MCP connectivity as blanket permission over the vault;
- delete, rename, or bulk-rewrite user notes;
- silently promote a suggestion into global durable memory;
- read Obsidian configuration or files outside the active vault through MCP;
- execute shell commands through Tracekeeper.

## Product Surfaces

The plugin's human-facing surfaces cover activity, source status, Review Queue, memory inspection, runtime logs and status, permission policy, graph health, and settings. New surfaces should strengthen visibility or control inside Obsidian rather than create a parallel knowledge application.

## Non-Goals

- A hosted Tracekeeper account, cloud backend, or proprietary sync layer
- A replacement for Obsidian editing, links, graph, or file ownership
- A universal chat client or model provider
- Autonomous ingestion of every conversation
- Unrestricted filesystem, network, or command execution for Agents
- Invisible automatic rewriting of long-term knowledge

## Product Success Criteria

Tracekeeper succeeds when users can:

- understand where their AI memory lives;
- connect an Agent without hand-debugging several unrelated configuration systems;
- see when and why an Agent recalled or wrote information;
- recover project context across sessions without loading the whole vault;
- review important long-term changes before they become durable;
- remove Tracekeeper while retaining ordinary, readable Markdown knowledge.
