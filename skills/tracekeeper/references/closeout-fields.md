# Closeout Fields

Closeout applies only to `tracked_task` after a successful start returned a real `task_id`.

Provide accurate values for the fields exposed by the current `tracekeeper.finish_task` schema. At minimum preserve these meanings:

- `task_id`: the exact identifier returned by `tracekeeper.start_task`.
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

Preserve known project graph context in the finish payload, but never invent, guess, or rewrite a Wiki or source path. If no verified relationship is available, omit the field and allow the MCP review policy to report the missing bridge or route the candidate to review.

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
- Missing Wiki context routes the proposal to review rather than weakening the boundary.
- Project auto-save caps an Agent `verified` request to `supported`; user authority, lifecycle transitions, unresolved claim conflicts, and uncertain project identity still require review.

Task tracking and durable Memory are independent. A task without project identity
can still submit a project candidate when that candidate supplies its own project
identity, and a project task can submit a global candidate. Ordinary task fields
are never promoted automatically.

Exactly-once rules:

- Never call finish without a real `task_id` from the current start result.
- Call finish once for the tracked task.
- After a successful finish, ignore any stale suggestion to finish again.
- If the outcome is unknown, follow the structured recovery action instead of changing the payload or idempotency key.
- `no_track` and `recall_only` never produce a finish payload.
