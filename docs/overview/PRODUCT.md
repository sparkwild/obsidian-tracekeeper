# Product Overview

## Product Identity

Tracekeeper is an Obsidian-native, local-first knowledge and AI-memory system
for an individual user. It helps the user maintain durable knowledge in a local
Vault and lets explicitly connected Agents recall context and propose updates
without taking ownership away from the user.

The product is the Obsidian plugin, the local knowledge structure, and the
controlled Agent connection together. It is not a SaaS service wrapped around
Obsidian.

## Purpose

Tracekeeper addresses two recurring failures in personal AI-assisted work:

- useful decisions and context remain trapped in disposable conversations;
- automation writes too eagerly and pollutes long-term knowledge.

It separates bounded work traces from durable knowledge. Agents may be proactive
about Recall and closeout while the user retains visible control over
permissions, review, and persistence.

## Product Roles

| Role | Durable responsibility |
| --- | --- |
| User | Owns the Vault, selects connected Agents and memory policy, and makes durable review decisions |
| Obsidian | Provides the human workspace, native file model, links, graph, and plugin surface |
| Tracekeeper plugin | Hosts the local Runtime and makes connection, activity, policy, review, and maintenance visible |
| AI Agent | Recalls scoped context, performs work, records bounded traces, and proposes durable knowledge |
| Companion Skill | Teaches an Agent when to Recall, track work, close out, and respect review boundaries |

## Product Scope

Tracekeeper owns:

- a stable local Memory, Wiki, Source, work, and review structure;
- bounded Agent access through a local authenticated Runtime;
- human-visible connection, knowledge-governance, and maintenance surfaces;
- recoverable, attributable writes proportional to their risk.

Detailed behavior belongs to the [feature documentation](../features/INDEX.md).
System organization and trust boundaries belong to the
[architecture documentation](../architecture/INDEX.md).

## Long-Term Non-Goals

- A hosted Tracekeeper account, cloud backend, or proprietary synchronization layer
- A replacement for Obsidian editing, links, graph, or file ownership
- A universal chat client or model provider
- Autonomous ingestion of every conversation
- Unrestricted filesystem, network, or command execution for Agents
- Invisible automatic rewriting of global durable knowledge

## Success Criteria

Tracekeeper succeeds when users can:

- understand where their AI memory lives;
- connect an Agent without hand-debugging unrelated configuration systems;
- see when and why an Agent recalled or wrote information;
- recover project context across sessions without loading the whole Vault;
- review important long-term changes before they become durable;
- remove Tracekeeper while retaining ordinary, readable Markdown knowledge.
