# Tracekeeper MCP Server

Streamable HTTP MCP Runtime for Tracekeeper operations. It is read-only by default and exposes controlled write tooling only for low-risk working records.

## JSON-RPC methods

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `prompts/list`

## Tools

`tools/list` returns:

- `tracekeeper.status`
- `tracekeeper.lint`
- `tracekeeper.recall`
- `tracekeeper.read_note`
- `tracekeeper.start_task`
- `tracekeeper.finish_task`
- `tracekeeper.build_context_pack`
- `tracekeeper.review_queue`
- `tracekeeper.apply_approved_writeback`
- `tracekeeper.source_request`
- `tracekeeper.capture_source`
- `tracekeeper.propose_memory`

Permission policy:

- default posture: read-only vault-local access
- graph health checks are advisory and never write notes or enforce a vault structure
- controlled write tools are limited to low-risk working records
- global memory writeback is review-gated by default; project memory auto-save is user-controlled and append-only
- full matrix: [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)

Current write allowlist:

- Writes are strictly limited to:
  - `00_tracekeeper/work/context_packs/`
  - `00_tracekeeper/work/source_analysis/`
  - `00_tracekeeper/work/sessions/`
  - `00_tracekeeper/work/tasks/`
  - `00_tracekeeper/inbox/review_queue/`
  - `00_tracekeeper/inbox/agent_requests/` request status updates
  - `00_tracekeeper/control/audit_log.md`
  - `01_knowledge/sources/`
  - `01_knowledge/memory/projects/` when the user enables project memory auto-save
  - existing target note named by an approved `apply_approved_writeback` proposal
- only markdown (`.md`) files are created for generated records
- generated records do not overwrite existing files
- approved writeback appends to an existing target note and updates the approved proposal status
- no delete / no rename

Security constraints:

- no shell calls
- no network calls
- no vault-outside reads
- no Obsidian configuration directory reads
- required local Runtime token by default
- no wildcard CORS; browser-style origins are limited to Obsidian and loopback
- all writes append events to `00_tracekeeper/control/audit_log.md` (file is created if absent)

## Run

The production Runtime is hosted by the desktop Obsidian plugin. The standalone command is for local development checks only:

```bash
cd <repo>/apps/mcp-server
npm install --cache /private/tmp/tracekeeper-npm-cache
npm run typecheck
npm run build
npm run test
node dist/server.js --vault-root <vault> --vault-config-dir <config-dir> --port 58437 --token <token>
```

Then send Streamable HTTP JSON-RPC requests to `http://127.0.0.1:58437/mcp?token=<token>`.

The standalone command refuses to start without `--token`. For isolated local development checks only, pass `--allow-missing-token-for-dev` explicitly.

## Package scripts

```bash
npm run typecheck
npm run build
npm run test
npm run smoke
```

`npm run test`/`npm run smoke` executes `./scripts/smoke.mjs` against a temporary, non-network vault fixture and validates:

- token, origin, and session enforcement
- required-token startup enforcement
- non-wildcard CORS origin reflection for allowed loopback origins
- initialize/tools/list/resources/list/prompts/list
- read_note and status paths
- recall global/project/project-history scopes
- compact tool text with full `structuredContent`
- controlled write tools
- finish_task closeout proposal creation
- source_request source-analysis flow
- apply_approved_writeback review-gated flow

## Notes

- `read_note` accepts `{ vaultRoot, path }` and validates vault scope + path traversal.
- `start_task` returns `task_id`, `recommended_recall`, and `next_actions_for_agent` plus a context pack summary, and writes a bounded active task record.
- `propose_memory` and `finish_task` support:
  - `memory_scope` (`global` / `project`)
  - `project_hint`
  - `related_wiki`
  - `related_sources`
- project-scoped auto memory writes require valid wiki bridge references; when `related_wiki` cannot be resolved, behavior downgrades to `Review Queue` and outputs `missing_wiki_bridge: true`.
- `architecture_status` and `missing_graph_bridges` are returned for traceability in memory-write related operations.
- `recall` accepts `scope: "project"` and `scope: "project_history"` plus project, repo, or path hints so agents do not load all project memory indiscriminately. Recall entries include `excerpt`, `why_matched`, `matched_tokens`, score details, and `graph_links`; use `read_note` only when full content is needed.
- `scope: "project_history"` includes matching project notes, agent task records, and session notes linked to those task records for cross-session continuity.
- `finish_task` records a session note and returns `next_actions_for_agent`. `review_proposal_mode: "auto_propose"` follows configured memory rules, so global memory queues by default while project memory can auto-save as append-only project memory. `review_proposal_mode: "review_queue"` sends closeout memory candidates to Review Queue. `suggest` remains accepted for compatibility and only returns `suggested_memory_updates`.
- `lint` is the single check entry and includes graph health findings according to the configured graph profile.
- Compatibility tools such as `project_context`, `project_history`, and `list_review_queue` are not returned by `tools/list`; use the public tools above instead.
