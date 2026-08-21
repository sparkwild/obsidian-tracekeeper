# Closeout Fields

Closeout applies only to `tracked_task`. It either completes a live task with a
real `task_id` or creates one closeout-only task without an Agent-supplied id.

Provide accurate values for the fields exposed by the current `tracekeeper.finish_task` schema. At minimum preserve these meanings:

- Live `task_id`: the exact identifier returned by `tracekeeper.start_task`.
  Never include one for closeout-only.
- Closeout-only `goal`: the original goal retained when work began.
- Closeout-only `started_at`: the original client-held ISO start time. Runtime
  records `started_at_source: client_claim` and keeps server recording time
  separate.
- `recording_reason`: omit or use `ordinary_closeout` for an ordinary task. Use
  `start_unavailable` only when a live start had no structured result, and then
  include the unchanged original `start_idempotency_key`.
- status: completed, partial, or blocked according to actual outcome.
- Returned `durable_output.status`: the Runtime's separate snapshot of exact
  Wiki/Memory proposals linked to the task. Always report it when persistence
  was requested; never infer it from task status.
- summary: concise work performed and user-visible result.
- decisions: decisions made during the task; these remain task facts unless copied into an explicit memory candidate.
- unresolved items: risks, blockers, or intentionally deferred work.
- next steps: concrete follow-up that remains useful after the current session.
- `memory_candidate_records`: optional explicit durable-memory candidates. Every record must declare `scope: "global"` or `scope: "project"`; candidate project identity is independent from task context.
- For an ordinary evidence-backed Agent candidate, use `proposed_authority: "agent"` and `proposed_confidence: "supported"`. Do not claim `user` authority or `verified` confidence on the user's behalf.
- `related_wiki`: reuse only `relation_evidence.related_wiki[].path` that Runtime validates, including evidence returned by an explicitly correlated read_note.
- `related_sources`: reuse only `relation_evidence.related_sources[].path` that Runtime validates, including evidence returned by an explicitly correlated read_note.

Preserve known project graph context in the finish payload, but never invent,
guess, or rewrite a Wiki or source path. Wiki and Source relations are optional;
omit either field when verified relationship evidence is unavailable. If a
supplied relation cannot be verified, preserve the Runtime's warning or review
outcome.

Review semantics:

- A proposal is pending until human review approves it.
- Pending content is not durable memory or an applied Wiki update.
- A captured Source, Source Recall match, or Source `read_note` result is
  provenance evidence, not proof that a linked Wiki/Memory target was applied.
- A direct `propose_memory` call is already linked to the task. Omit its
  duplicate finish candidate as instructed, then use the returned
  `durable_output` summary instead of accepting `no_candidates` as persistence
  success.
- Apply an approved proposal only when the user explicitly requests the apply action.
- Direct `propose_memory` MemoryRecord candidates declare `memory_scope`;
  `project_hint` is identity evidence, not scope authority. Explicit Wiki
  targets do not require `memory_scope` and always enter review.
- Global and Project Auto use the same immutable MemoryRecord v2 semantics.
  Global defaults to Review; its fully supported Auto mode writes under the
  canonical Global Memory Hub with `project_id: null`.
- A missing or invalid canonical Global Hub blocks persistence and returns an
  explicit structure-repair action. Project Auto may exclusively create a
  missing canonical project Hub from exact repository identity; ambiguous
  identity, occupied paths, and invalid existing Hubs remain fail-closed.
  Approval does not grant Hub-creation authority to queued or legacy proposals.
- Auto caps an Agent `verified` request to `supported`; user authority,
  lifecycle or relation transitions, unresolved claim conflicts, and uncertain
  project identity still require review.

Task tracking and durable Memory are independent. A task without project identity
can still submit a project candidate when that candidate supplies its own project
identity, and a project task can submit a global candidate. Ordinary task fields
are never promoted automatically.

Exactly-once rules:

- Ordinary closeout-only intentionally calls finish without `task_id`; Runtime
  derives a stable id from finish operation identity. Live closeout uses only
  the real id returned by start.
- Never calculate or guess `task_id`. For an unknown live-start result, provide
  `start_unavailable` provenance and the original start key so Runtime performs
  reconciliation.
- Call finish once for the tracked task.
- After a successful finish, ignore any stale suggestion to finish again.
- If the outcome is unknown, follow the structured recovery action instead of changing the payload or idempotency key.
- `no_track` and `recall_only` never produce a finish payload.
