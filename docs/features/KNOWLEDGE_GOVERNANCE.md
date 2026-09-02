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
Durable Memory may link to relevant Wiki or Source notes so Recall and the
Obsidian graph use the same relationships. Either relation may be absent; a
MemoryRecord does not require a Wiki.

A finished task therefore has two independent outcome dimensions. Task status
describes whether the Agent finished its execution; the finish result's
durable-output status freezes the state at closeout of every exact Wiki/Memory
proposal linked to that task. Human and Agent closeout surfaces show both, and
the human surface may additionally reflect later exact applied-proposal
evidence without rewriting the closeout snapshot. Source capture is durable
provenance and remains readable even when a linked proposal is pending,
rejected, or abandoned, but it is never presented as proof that the proposed
Wiki/Memory target was applied.

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

Global durable-memory changes enter Knowledge Change Review by default. The
user may select Global Auto as a fully supported policy, while Review remains
the fresh-install default. A user may edit an unapproved proposal, approve it,
return it for revision, or not accept it. Approval confirms the content;
applying it remains a separate, previewed, explicitly confirmed action.

Memory and Wiki proposals have independent routing. Every MemoryRecord
candidate declares global or project scope; for direct `propose_memory` calls,
`memory_scope` is mandatory and `project_hint` supplies identity rather than
scope authority. An explicit target under `01_knowledge/wiki/**` is a Wiki
change and does not require `memory_scope`. Wiki routing follows the independent
user-selected rule: review each, review by task batch, auto-manage eligible
create-only or intact managed-relation changes, or ignore. Fresh installs and
upgrades without a stored Wiki rule default to batch review. Agent-supplied risk
labels and user-intent claims do not select or expand this policy.

Wiki roles are semantic rather than directory-owned. `wiki/index.md` is the
root entry, while Topic Maps and topics may live anywhere under the Wiki root.
The `wiki/hubs/` directory is optional compatibility content: initialization,
Doctor, and write routing neither create nor require it, and upgrades never
move or delete an existing directory.

An incomplete proposal is a remediation item, not a review-ready change. An
append proposal must resolve an existing Vault-local Memory/Wiki target before
approval. A create-capable Wiki proposal may instead target one absent Markdown
file under `01_knowledge/wiki/**`, while a lifecycle proposal with a validated
claim may target a new MemoryRecord. In every case the target path must remain
inside its exact allowed knowledge boundary and writable content must be
present. Existing Wiki targets stay append-only; a missing Memory append target
does not inherit Wiki creation authority.

Managed proposal writeback bodies use proposal-id-bound hidden Markdown
boundaries so headings inside the proposed content remain payload rather than
record sections. The Runtime, transition owner, and Obsidian review projection
consume the same boundary parser. Missing, duplicated, reordered, or mismatched
boundaries fail closed. Legacy body-only proposals remain compatible only when
their heading boundary is unambiguous; an ambiguous actionable legacy proposal
must be resubmitted, while terminal history is never rewritten or reopened.

The review detail presents the available task and source evidence, current or
absent target state, and a projected append or create diff from the reviewed
proposal. Memory and legacy approval remain separate from apply. For Wiki
review, the human-facing batch or single-item modal presents one authoritative
preview; its final confirmation authorizes both the exact approval receipts and
their governed applies. The internal coordinator commits approval before target
write, and public MCP still cannot approve a pending proposal. The operation-
bound confirmation includes the concrete effect and target state. A Wiki or lifecycle target is
created atomically only during that explicit apply step. Creation never
overwrites an occupied path, and interruption compensation may remove only the
exact file owned by the confirmed operation. A project proposal whose Hub is
missing is not review-ready: approval cannot supply the additional structure
authority, and legacy blocked proposals must be resubmitted after the runtime
can follow the selected Project Auto policy.

Wiki batch execution remains in its confirmation modal and reports the current
phase, durable completed-count, target note, and waiting state. After the batch
operation is claimed, confirmation and cancellation controls are disabled until
a terminal receipt is available; closing the modal is not treated as a cancel.
The batch journal owns restart recovery and reopens the same modal after layout
readiness, while a target drift creates a new-preview conflict instead of
reusing the old confirmation.

Wiki batch schema v3 executes every approved item as a durable
`prepare -> apply -> verify` chain. For a task-linked batch, preview computes an
ordered task-content hash chain: each item's expected task hash is the previous
verified item's result hash. Verification accepts an applied proposal only when
its operation id, exact target result hash, and task result hash all belong to
that batch item. A skipped or conflicting item therefore cannot make a later
write look like an external task edit, and an externally applied proposal is
never adopted as batch progress.

Project identity is equally fail-closed. `project_id` is an opaque stable id
returned by the Runtime, not the human label, Hub directory key, or repository
leaf. An unknown or conflicting explicit id is rejected before a proposal file
or task link is written. Project Memory enumeration requires one current
canonical Hub and never returns a successful empty catalog for an arbitrary id.

Approval commits a receipt that binds the exact proposal revision and content
hash reviewed by the user. The apply preview produces an opaque, expiring
confirmation token bound to that approved proposal's revision, semantic content
and complete file state, its target and optional task state, the complete
touched-note set, and the bounded activity context. A token cannot be reused for a
different proposal or after any bound content changes. The token is an
implementation credential for the confirmed preview and must not be displayed,
logged, or stored in review notes.

Task-linked v2 Wiki proposals carry a Runtime-derived `review_batch_id`; an
unlinked or legacy proposal remains a singleton. A batch contains at most 100
proposals and 2 MiB of writeback content. High-risk user-body changes are split
into individual review. Applied items leave the working queue but are not moved
to Archive implicitly.

The batch journal stores only paths, hashes, bounded operation identities, and
step results. It does not store proposal bodies, diffs, writeback blocks, or
confirmation tokens. A restart reconstructs a required relation block from the
still-bound proposal revisions and rejects it unless its hash matches the
claimed manifest. Internal item writes keep their encrypted operation journals;
the visible activity timeline receives one idempotent batch summary through the
native activity-shard repository.

Tracekeeper-managed Wiki relations use one hash-bound Markdown region. New
notes may include it during creation; existing notes are changed only inside a
valid region, while a missing region requires review and a modified region
fails closed. Topic links point to their Topic Map and Source index, Topic Maps
point toward `wiki/index.md`, and Source-part paths are never durable Wiki
relations.

Editing and revision flows use optimistic replacement. If a proposal changes
while a modal is open, Tracekeeper preserves the current file and the user's
unsaved draft, reports the conflict through both visible and assistive status,
and returns focus to the relevant input. Apply failures retain an actionable
status and keyboard focus so the user can retry an interrupted operation or
close the modal and generate a fresh preview after a conflict.

Global and project Memory use independent policy rules:

- fresh installations start with Global Review and Project Auto;
- Settings exposes review and ignore alternatives, and records an explicit
  policy confirmation whenever the user changes the selected rule;
- an upgrade preserves every stored memory rule exactly and asks for that
  confirmation without rewriting the selected policy;
- Global Auto and Project Auto use the same immutable MemoryRecord v2 writer,
  authority constraints, conflict detection, recovery, and audit semantics;
- global entries link to the canonical Global Memory Hub and have
  `project_id: null`;
- a stable project id owns one project hub, while the display name remains
  non-authoritative;
- every eligible operation creates one immutable entry under a normalized
  Agent namespace;
- exact operation retries reuse the same entry, while changed payloads fail
  closed;
- existing project `memory.md` notes remain readable and catalogued but receive
  no new automatic writes;
- Wiki and Source relations are optional; a missing relation does not change an
  otherwise eligible Auto decision;
- an explicitly supplied relation that cannot be verified, a claim conflict,
  or a lifecycle relation change falls back to review;
- a missing or invalid canonical Global Hub blocks persistence and directs the
  user to the explicit structure-repair flow;
- Project Auto may create a missing canonical project Hub as part of the same
  governed operation only when an exact repository identity determines the
  complete Hub binding. Creation is exclusive and create-only; occupied paths,
  invalid existing Hubs, or ambiguous identities remain blocked or review-gated.

A pending proposal is not durable memory. Only an eligible scope Auto-save or
a completed approved writeback may be described as persisted.

At `finish_task`, direct proposals already linked to the task are included in
the durable-output summary even when the Agent correctly omits duplicate
`memory_candidate_records`. Exact finish retries retain the original closeout
snapshot; proposal correlation requires the managed id and review-owner path,
and missing or mismatched evidence is reported as unresolved.

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

Global and project knowledge Recall require a non-empty query. Project-history
and task-history Recall may omit it for bounded recent history. Every scope
returns canonical matches with path, excerpt, match reason, content origin,
relation evidence, and `instruction_trust: data_only`; result scope and project
identity remain consistent with the Runtime-resolved request.

An archiveable proposal remains addressable by its explicit proposal id after
it leaves the active review queue. Archiving first shows the exact source and
destination paths plus every managed task/session reference. Any duplicate id,
occupied destination, changed source or reference, or unresolved association
blocks confirmation. A successful move preserves proposal history and updates
Tracekeeper-owned links; it does not rewrite unrelated notes or historical
Agent activity text. The main review surface lists only changes that still need
attention: blocked proposals that must be resubmitted, incomplete proposals,
pending review, approved changes awaiting apply, and requested revisions.
Rejected, applied, and otherwise completed records remain available through a
separate, explicitly confirmed archive-maintenance action instead of occupying
the working queue. Confirmation persists operation ownership before the move.
If the operation is interrupted, the same operation may resume from its bounded
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

`tracekeeper.lint` v4 is the read-only Doctor entry point for structure, links,
Sources, claims, lifecycle, and graph health. It reports invalid v2 records,
missing claim identity, unresolved evidence or Hub/Source relations, lifecycle
cycles and conflicts, stale verification, Source-part integrity, bounded
directory growth, and legacy Memory candidates. Graph profiles control
reporting severity but never create notes or rewrite links. Graph Health no
longer turns an aggregate statistical report into a Knowledge Change Review
proposal. Only a concrete Wiki role or relation change can enter the normal
reviewed proposal flow.

Lint v4 also returns a generation-bound Maintenance Snapshot with deterministic
candidate ids and cursors. An Agent may call `tracekeeper.request_maintenance`
with only current requestable ids; it cannot supply a raw path, deletion mode,
hash, or approval. The request is shown in Knowledge Change Review and becomes
completed only after a separately governed repair or cleanup removes the
underlying candidate; otherwise a newer generation marks it stale.

Captured Source bodies are evidence, not authored knowledge relationships. Shell
conditions, Markdown links, absolute paths, and other syntax copied into a
`source_capture` or `source_part` must not be reported as broken knowledge
links. Operational proposal/task metadata is likewise excluded from semantic
graph warnings; its mirrors remain auditable through the task and proposal
records. When older segmented captures are found, the plugin may offer an
explicit, hash-bound consolidation preview that creates bounded Source indexes
and parts first, then requires separate confirmations for relationship repair
and moving the legacy files to `02_archive`.

Redundant Source files already moved by that consolidation may later enter a
third, separately confirmed cleanup preview. Eligibility requires completed
materialization and archive journals, exact archive and Source-part coverage,
valid current output hashes and manifests, repaired Wiki relations, and no
active or ambiguous operation. Cleanup is limited to
`02_archive/source_migrations/**`, uses `FileManager.trashFile()`, preserves
current Source indexes and parts, and never includes MemoryRecord, Wiki body,
unknown Archive content, proposal history, or operation journals.

Managed proposal references in task and session records are one semantic
relationship even though Tracekeeper mirrors them in frontmatter and the note
body for machine and Obsidian readability. Lint reports misaligned ids, paths,
links, duplicate identities, missing mirror markers, and mirrors that resolve to
different targets; it does not rewrite historical Markdown. Graph-health totals
deduplicate a valid mirror and separately expose the raw observation count.

Graph Health ignores captured Source syntax and operational proposal mirrors
when calculating semantic graph defects. Treat its ignored-observation count as
diagnostic context, not as a list of files to edit. The plugin's suggested
official Graph View filter is `path:01_knowledge -path:.parts -path:02_archive`;
Tracekeeper never writes that filter into Obsidian configuration.

Source records use a normalized `web`, `file`, or `transcript` owner route and
carry a stable `source_id` plus content hash. Small captures keep content in the
Source index note. Large captures use a bounded manifest of content-addressed
part notes linked visibly from that index; Memory and Wiki relations target the
Source index rather than an individual part.

Provenance fields and Source index-to-part links are structural evidence, not
knowledge relationships. They remain inspectable in the raw Obsidian graph but
are excluded from Recall relation evidence and expansion unless the Source note
also declares the target through `related_wiki` or `related_sources`.

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
