# Closeout Fields

Closeout applies only to `tracked_task` after a successful start returned a real `task_id`.

Provide accurate values for the fields exposed by the current `tracekeeper.finish_task` schema. At minimum preserve these meanings:

- `task_id`: the exact identifier returned by `tracekeeper.start_task`.
- status: completed, partial, or blocked according to actual outcome.
- summary: concise work performed and user-visible result.
- decisions: durable decisions made during the task.
- unresolved items: risks, blockers, or intentionally deferred work.
- next steps: concrete follow-up that remains useful after the current session.
- `related_wiki`: reuse only `relation_evidence.related_wiki[].path` that Runtime validates, including evidence returned by an explicitly correlated read_note.
- `related_sources`: reuse only `relation_evidence.related_sources[].path` that Runtime validates, including evidence returned by an explicitly correlated read_note.

Preserve known project graph context in the finish payload, but never invent, guess, or rewrite a Wiki or source path. If no verified relationship is available, omit the field and allow the MCP review policy to report the missing bridge or route the candidate to review.

Review semantics:

- A proposal is pending until human review approves it.
- Pending content is not durable memory or an applied Wiki update.
- Apply an approved proposal only when the user explicitly requests the apply action.
- Missing Wiki context routes the proposal to review rather than weakening the boundary.

Exactly-once rules:

- Never call finish without a real `task_id` from the current start result.
- Call finish once for the tracked task.
- After a successful finish, ignore any stale suggestion to finish again.
- If the outcome is unknown, follow the structured recovery action instead of changing the payload or idempotency key.
- `no_track` and `recall_only` never produce a finish payload.
