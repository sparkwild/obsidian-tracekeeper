# Knowledge Governance

Tracekeeper adds Agent-assisted Recall, bounded work records, sources, graph
health, and review to ordinary Markdown knowledge without taking ownership away
from the user.

## Knowledge Maintenance

The user edits and reorganizes notes through Obsidian. Tracekeeper maintains the
three-root knowledge structure, reports graph and structure issues, and creates
reviewable artifacts without replacing Markdown with an external database.

Memory captures continuity such as tasks, decisions, preferences, lessons, and
project history. Wiki notes capture reusable subjects such as hubs, concepts,
claims, guides, and references. Durable Memory should link to relevant Wiki or
Source notes so Recall and the Obsidian graph use the same relationships.

## Agent Work

Agents may:

- search and read Vault-scoped context;
- create bounded tasks, sessions, sources, analyses, and context packs;
- submit durable knowledge proposals;
- apply content only after the proposal has been approved through the human
  review flow.

Agents must not treat connectivity as blanket Vault permission, delete or
bulk-rewrite user notes, read outside the active Vault, execute shell commands
through Tracekeeper, or silently promote a suggestion to global durable memory.

The normative mode selection, Recall, source-ingestion, and closeout behavior is
defined by the [Agent Workflow](AGENT_WORKFLOW.md).

## Durable Memory

Global durable-memory changes enter Knowledge Change Review by default. A user
may edit an unapproved proposal, approve it, return it for revision, or not
accept it. Approval confirms the content; applying it remains a separate,
previewed, explicitly confirmed action.

An incomplete proposal is a remediation item, not a review-ready change. A
missing, invalid, or unavailable target must be resolved from existing
Vault-local Memory/Wiki candidates, and writable content must be present, before
approval is available. The review detail presents the available task and source
evidence, current target context, and an expected append diff. Approval still
does not write; apply generates a fresh preview and requires a separate
confirmation.

Project memory may use an opt-in lighter rule:

- fresh installations start with project memory in Knowledge Change Review;
- automatic project persistence requires an explicit user selection and a
  separately visible onboarding confirmation;
- an upgrade preserves every stored memory rule exactly and asks for that
  confirmation without rewriting the selected policy;
- the target is the current project's memory note;
- writes are append-only and duplicate-protected;
- the project must have a valid Wiki bridge;
- a missing bridge or conflict falls back to review.

A pending proposal is not durable memory. Only an eligible project auto-save or
a completed approved writeback may be described as persisted.

## Human Surfaces

The plugin provides native Obsidian surfaces for:

- current Agent activity and actionable workflow diagnostics;
- Memory inspection and opening the underlying Markdown;
- Source status and source-to-proposal traceability;
- Knowledge Change Review;
- Runtime status and local logs;
- Memory and persistence policy;
- graph health and structure migration;
- client and memory settings.

Default surfaces should emphasize the user's next action. Raw client and Session
evidence, execution diagnostics, latency percentiles, evaluation commands, and
aggregate lifecycle metrics remain available as advanced local diagnostics.
Metrics cover only calls that reached Tracekeeper and are never a missed-call
denominator.

## Lint, Graph, And Migration

`tracekeeper.lint` is the read-only structure check. Graph profiles control
reporting severity but never create notes or rewrite links. A selected graph
suggestion may become a normal Knowledge Change Review proposal.

Legacy layouts are handled through a human-governed Obsidian workflow:

1. inspect and preview legacy roots, targets, counts, and conflicts;
2. rebuild missing current structure without overwriting existing files;
3. validate and write a migration report;
4. require a second explicit confirmation before moving legacy content to the
   Obsidian system trash.

MCP may report legacy structure but never moves or deletes it.
