# Knowledge Governance

Tracekeeper adds Agent-assisted Recall, bounded work records, sources, graph
health, and review to ordinary Markdown knowledge without taking ownership away
from the user.

## Knowledge Maintenance

The user edits and reorganizes notes through Obsidian. Tracekeeper maintains the
three-root knowledge structure, reports graph and structure issues, and creates
reviewable artifacts without replacing Markdown with an external database.

Task tracking captures execution continuity: goals, status, decisions, outcomes,
and next steps. It is separate from Durable Memory. Durable Memory is created
only from explicit candidate records, each declaring global or project scope;
ordinary task fields are never promoted automatically. Wiki notes capture
reusable subjects such as hubs, concepts, claims, guides, and references.
Durable Memory should link to relevant Wiki or Source notes so Recall and the
Obsidian graph use the same relationships.

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

Durable Memory uses the MemoryRecord v2 lifecycle. Each new record has a
stable `memory_id` and `claim_key`, declares global or project scope, authority,
confidence, lifecycle state, observation and validity times, evidence, and
explicit `supersedes` or `contradicts` relations. Authority and confidence are
reviewable claims rather than hidden ranking signals: verified memory requires
evidence, conflicting current claims remain visible as conflicts, and history
is preserved instead of being overwritten.

Global durable-memory changes enter Knowledge Change Review by default. A user
may edit an unapproved proposal, approve it, return it for revision, or not
accept it. Approval confirms the content; applying it remains a separate,
previewed, explicitly confirmed action.

An incomplete proposal is a remediation item, not a review-ready change. An
append proposal must resolve an existing Vault-local Memory/Wiki target before
approval. A create-capable Wiki proposal may instead target one absent Markdown
file under `01_knowledge/wiki/**`, while a lifecycle proposal with a validated
claim may target a new MemoryRecord. In every case the target path must remain
inside its exact allowed knowledge boundary and writable content must be
present. Existing Wiki targets stay append-only; a missing Memory append target
does not inherit Wiki creation authority.

The review detail presents the available task and source evidence, current or
absent target state, and a projected append or create diff from the reviewed
proposal. Approval still does not write. Apply generates the authoritative,
operation-bound preview and requires a separate confirmation whose binding
includes the concrete effect and target state. A Wiki or lifecycle target is
created atomically only during that explicit apply step. Creation never
overwrites an occupied path, and interruption compensation may remove only the
exact file owned by the confirmed operation.

Approval commits a receipt that binds the exact proposal revision and content
hash reviewed by the user. The apply preview produces an opaque, expiring
confirmation token bound to that approved proposal's revision, semantic content
and complete file state, its target and optional task state, the complete
touched-note set, and the bounded activity context. A token cannot be reused for a
different proposal or after any bound content changes. The token is an
implementation credential for the confirmed preview and must not be displayed,
logged, or stored in review notes.

Editing and revision flows use optimistic replacement. If a proposal changes
while a modal is open, Tracekeeper preserves the current file and the user's
unsaved draft, reports the conflict through both visible and assistive status,
and returns focus to the relevant input. Apply failures retain an actionable
status and keyboard focus so the user can retry an interrupted operation or
close the modal and generate a fresh preview after a conflict.

Project memory uses a lighter default rule:

- fresh installations start with automatic project persistence, while global
  memory remains review-gated;
- Settings exposes review and ignore alternatives, and records an explicit
  policy confirmation whenever the user changes the selected rule;
- an upgrade preserves every stored memory rule exactly and asks for that
  confirmation without rewriting the selected policy;
- a stable project id owns one project hub, while the display name remains
  non-authoritative;
- every eligible operation creates one immutable entry under a normalized
  Agent namespace;
- exact operation retries reuse the same entry, while changed payloads fail
  closed;
- existing project `memory.md` notes remain readable and catalogued but receive
  no new automatic writes;
- the project must have a valid Wiki bridge;
- a missing bridge or conflict falls back to review.

A pending proposal is not durable memory. Only an eligible project auto-save or
a completed approved writeback may be described as persisted.

Recall selects relevant evidence and is not exhaustive. The only public memory
catalog is read-only `tracekeeper.memory`; there is no public project-specific
alias. It provides generation-bound, paginated
metadata for global or project scope and exposes `current`, `history`,
`conflicts`, and `all` lifecycle views. Project scope requires the Runtime's
stable project identity. Full entry bodies remain behind
`tracekeeper.read_note`. Obsidian Backlinks provide the human aggregate because
every project record links to its stable project hub, while global records link
to the global Memory hub. Hubs are not rewritten for every operation, and
Bases are not required.

An archiveable proposal remains addressable by its explicit proposal id after
it leaves the active review queue. Archiving first shows the exact source and
destination paths plus every managed task/session reference. Any duplicate id,
occupied destination, changed source or reference, or unresolved association
blocks confirmation. A successful move preserves proposal history and updates
Tracekeeper-owned links; it does not rewrite unrelated notes or historical
Agent activity text. Confirmation persists operation ownership before the move. If the
operation is interrupted, the same operation may resume from its bounded
receipt; a newly generated archive operation cannot take over those claimed
targets and instead reports a recoverable conflict.

## Human Surfaces

The plugin provides native Obsidian surfaces for:

- current Agent activity and actionable workflow diagnostics;
- Memory inspection and opening the underlying Markdown;
- Source status and source-to-proposal traceability;
- Knowledge Change Review;
- Runtime status and Agent activity;
- Memory and persistence policy;
- graph health and structure migration;
- client and memory settings.

Archive and Agent activity cleanup are destructive-or-relocating surfaces and
therefore show their bound preview before confirmation. Cleanup distinguishes
eligible from retained files, explains the configured Obsidian trash behavior,
and never presents mixed-age retention as deletion. Both dialogs start on the
safe cancel action, remain keyboard operable, announce loading, conflict,
success, and recovery status through a live region, and keep an actionable
control focused after failure. Chinese and English recovery text distinguishes
a stale preview from an interruption whose native move or trash outcome may
already be visible; it directs the user to inspect the listed paths and refresh
before retrying.

Default surfaces should emphasize the user's next action. Raw client and Session
evidence, execution diagnostics, latency percentiles, evaluation commands, and
aggregate lifecycle metrics remain available as advanced local diagnostics.
Metrics cover only calls that reached Tracekeeper and are never a missed-call
denominator.

The Agent Activity display reads only the latest 2,000 retained MCP activity
events and states when older rows are omitted. This is a presentation window,
not a retention or cleanup boundary: cleanup independently enumerates and
freshly reads the full current set of canonical daily activity shards before
producing its bound preview. Legacy audit history is not migrated or read by
the activity reader.

## Lint, Graph, And Migration

`tracekeeper.lint` v3 is the read-only Doctor entry point for structure, links,
Sources, claims, lifecycle, and graph health. It reports invalid v2 records,
missing claim identity, unresolved evidence or Hub/Source relations, lifecycle
cycles and conflicts, stale verification, Source-part integrity, bounded
directory growth, and legacy Memory candidates. Graph profiles control
reporting severity but never create notes or rewrite links. A selected graph
suggestion may become a normal Knowledge Change Review proposal.

Source records use a normalized `web`, `file`, or `transcript` owner route and
carry a stable `source_id` plus content hash. Small captures keep content in the
Source index note. Large captures use a bounded manifest of content-addressed
part notes linked visibly from that index; Memory and Wiki relations target the
Source index rather than an individual part.

Legacy Memory remains readable but has no inferred `claim_key` and does not
participate in automatic lifecycle resolution. The plugin may turn a unique
Doctor identity suggestion into a preview-bound review proposal only after a
fresh ready snapshot still matches. Ambiguous or missing suggestions remain
blocked. This promotion flow never rewrites, moves, or deletes the legacy note;
approval and application remain governed by Knowledge Change Review.

Legacy layouts are handled through a human-governed Obsidian workflow:

1. inspect an exact, hash-bound preview of every legacy source, target,
   conflict, unmapped file, and resolved-link baseline;
2. repair missing current-structure entries first, without authorizing a user
   file move;
3. when a planned file has inbound links, separately authorize a bounded
   synthetic probe that uses Obsidian-generated links and a native move to
   prove effective link updating; an inconclusive or failed probe stops before
   linked user files move;
4. confirm the refreshed migration preview, then move mapped files with
   Obsidian's native file manager, apply only deterministic fresh-content
   enrichment, and verify content plus graph convergence from a bounded
   operation journal;
5. review conflicts and unmapped files in Knowledge Change Review, and preview
   and confirm cleanup separately only after every planned move is verified and
   each eligible legacy root is empty.

Restart resumes only the journal-owned source/target mapping and preserves
both-path, neither-path, changed-target, and metadata-timeout states for
review. Same-migration execution is serialized across controller instances.
After durable intent, source/target identity or empty-root eligibility is
checked once more immediately before the native move or trash effect. Cleanup
sends verified empty roots through the user's configured Obsidian trash
behavior; it never treats a copied or same-content target as proof of migration
and never permanently deletes a user file.

MCP may report legacy structure but never moves or deletes it.

Agent activity retention follows the same human-governed rule. Activity reads
only canonical UTC daily shards under the Agent Activity hub; legacy audit
history is not migrated or read. Cleanup previews every current activity shard
from fresh content and sends only wholly eligible files to the configured
Obsidian system trash. Partial,
changed, failed, or outcome-unknown paths remain explicitly reported; cleanup
never rewrites selected sections or permanently deletes through `Vault.delete()`.
