# Current Status

- Snapshot date: 2026-07-23
- Repository version: `0.2.4`

This is a dated implementation snapshot, not a permanent product contract. Update it when a release materially changes the implemented boundary.

## Implemented Baseline

### Runtime And Package Boundaries

- Desktop Obsidian hosts the production loopback Streamable HTTP MCP runtime; the standalone server remains a development and test composition root.
- Reusable MCP protocol, authentication, tool dispatch, and application services live in `packages/mcp-runtime` rather than inside either application.
- Structured public tool metadata lives in `packages/contracts`; the registry drives stable order, effect, idempotency, world boundary, workflow role, input/output schemas, capability, and public/deprecated status.
- The plugin and standalone server import workspace packages through declared package dependencies. Neither application imports the other application's source or compiled output.
- The public MCP surface contains 12 focused `tracekeeper.*` tools covering status, lint, recall, reads, task lifecycle, context packs, review, source workflows, and memory proposals.
- `tools/list` is filtered by the authenticated principal's capabilities. Tool definitions expose corrected annotations and output schemas; dispatch uses the same capability evaluator.
- Core results provide validated structured content, compact JSON text parity, and capability-filtered Agent action envelopes. Structured errors include bounded recovery metadata; committed-write contract failures retain safe recovery identity.
- Streamable HTTP supports MCP `2025-06-18` and `2025-11-25`, requires the negotiated protocol-version header after initialization, and exercises both versions in the smoke matrix.
- Declared resources and prompts are complete: five fixed Vault-scoped resources implement list/read, while four user-invoked workflow prompts implement capability-filtered list/get.

### Knowledge Reads

- Core exposes a rebuildable in-memory `KnowledgeIndex` whose snapshots include generation and index-state provenance.
- The Obsidian adapter subscribes to Vault events before starting a background initial rebuild. Events received during rebuild are queued and replayed before the new generation becomes current.
- Production status, recall, context, graph, lint, and task-start paths share the current indexed snapshot instead of synchronously rescanning the vault for every tool call.
- Connection Status exposes index state, generation, note count, and last rebuild, and a plugin command can request a rebuild without replacing the Vault as fact source.
- The standalone runtime retains the Node filesystem scan path for development and tests; the Vault remains the only durable fact source.
- Recall matches identify note type, content origin, and `instruction_trust: data_only`. Correlated `read_note` calls retain the `recall_id`, so source instructions remain knowledge data rather than authority.
- Recall excludes Tracekeeper control and inbox records. Project-scoped matching keeps project id/hint as strong evidence while allowing repository paths to corroborate notes that do not carry repository metadata; explicit repository conflicts remain excluded.
- Task startup, project Recall/history, context-pack construction, and closeout now share one Runtime project-identity resolver. It separates canonical `project_hint` from `repo_path`, resolves unique repository matches against durable project memory, reports source/confidence/warnings, and refuses project filtering for ambiguous or contradictory evidence.
- Global and project recall expand a bounded candidate pool before Runtime ranking. Resolved project Recall also injects at most two durable project-memory anchors, limits ordinary results to one generated task/session record when durable knowledge is available, and exposes the query-echo penalty, so a generated work record that repeats the current request does not outrank durable project memory. Chinese queries use bounded NFKC-normalized 2/3-gram matching with incidental single-gram suppression. Project-history recall continues to expose task and session records for continuity.
- Recall results and correlated `read_note` results expose only active-snapshot-verified Wiki/source relations through `relation_evidence`; project closeout persists only verified paths and reports missing sources without weakening the missing-Wiki review boundary. Exact or derived project Recall does not silently broaden a zero match to global scope, and candidate hints are concrete readable note paths.

### Recoverable Writes And Tasks

- Coordinated multi-step operations use stable operation IDs, payload hashes, step records, atomic journal replacement, startup roll-forward recovery, and per-artifact audit-event identities.
- The operation journal is stored under `00_tracekeeper/control/operations/` and is excluded from knowledge scanning.
- Approved writeback uses a stable target marker and optimistic content checks so retries do not duplicate the target block and external edits are not silently overwritten.
- `start_task` and `finish_task` accept idempotency keys. Replays return the original result, while reusing a key with a different payload is rejected.
- The first `finish_task` invocation freezes its normalized request and derived routing/language snapshot in the journal. Recovery reuses that snapshot, so later graph, policy, language, or task-metadata changes cannot mutate the original closeout.
- Completed tasks cannot be finished a second time with a conflicting closeout.
- Vault-local process locks and atomic journal claims prevent the Obsidian runtime and standalone development runtime from executing the same idempotency key at the same time.
- Runtime status retains the latest startup-recovery counts so the Obsidian Connection Status surface can show recovered, failed, and skipped operations.
- Task closeout returns a canonical `memory_closeout_state` covering no candidates, disabled, suggested, queued review, partial/full auto-save, missing Wiki bridge, and conflict. Compatibility status fields remain available, and completed tasks are never instructed to finish again.
- The resolved project identity is persisted in the task record, propagated into the recommended first Recall and context-pack result, inherited at closeout, and rejected when explicit closeout/context identity conflicts with the real task.

### Identity, Limits, And Audit

- Managed Agent clients receive independent credential principals; legacy shared-token settings are migrated for compatibility.
- Settings can rotate one managed client credential at a time; the old credential stops working while other client credentials remain unchanged.
- Credentials carry explicit tool capabilities. A read-only principal cannot invoke write tools, and client-reported identity cannot change authorization.
- Managed clients can use local capability-profile presets; new managed credentials default to Knowledge Assistant, while existing `['*']` credentials retain full compatibility as display-only Custom. Profiles are convenience mappings over credential capabilities, not hosted roles or a second authorization layer. Credential rotation preserves the selected profile and capability set.
- Runtime authentication retains credential hashes rather than plaintext token values after construction.
- MCP sessions are principal-bound and have idle-lifetime, active-session-count, per-session stream, request-body-read-time, and request-body-size limits. Active event streams are not removed by ordinary idle pruning, and POST requests reject unsupported content types.
- Tool-call audit records include credential principal and bounded workflow evidence such as mode, task/recall/action ids, contract/result versions, scope diagnostics, recall match count, and closeout state; tokens, complete prompts, note bodies, and full response bodies are not persisted.

### Agent Ecosystem And Onboarding

- Skill v2.1.0 is aligned across contract, plugin, and ecosystem checks: entrypoint plus focused references with versioned hash manifest and flattened artifact, three-mode routing, timing-aware `next_actions`, strict Runtime-validated closeout graph-path reuse, and a tracked-task-only multi-source ingestion route.
- `capture_source` and `propose_memory` accept stable keyed retries. Repeating the same payload returns the original result; reusing the key with changed source or proposal content is rejected. Generated source-analysis and proposal content follows the Obsidian-selected content language, while captured raw material remains unchanged.
- A user request to gather knowledge from external or local materials and save it locally selects the Skill's ingestion route only. It does not grant `vault.write` or `memory.propose`, allow MCP to fetch external content, or bypass global/Wiki review boundaries.
- MCP initialization instructions and public Recall/proposal/review contracts repeat the local knowledge destination without taking over mode-selection policy. External Wiki connectors are selected only when the user explicitly names an external destination.
- Tracked closeout guidance preserves existing `related_wiki` and `related_sources` paths from Recall or correlated note reads without inventing graph relationships; Runtime validation and Review Queue fallback remain authoritative.
- The plugin embeds and verifies the complete bundle. A supported managed client can preview and explicitly confirm install/update with hash rechecks, staging, backup, rollback, and modified-file protection; other clients receive copy-only compatibility guidance.
- `npm run agent:ecosystem` rebuilds bundle identity, checks workflow semantics and unsafe examples, and verifies plugin packaging, installation controls, and evidence fields as part of `npm run verify`.
- Plugin onboarding is resumable across vault check, runtime readiness, client configuration, bundle availability/copy/install evidence, client reload, external connection verification, first recall, and observed tracked workflow.
- Configuration, user confirmation, file verification, MCP connection, recall, and Skill-trigger behavior are not conflated. Same-principal audit evidence is required for connection, non-empty recall, and a complete `start -> recall -> finish` observation.

### Eval And Local Diagnostics

- `evals/agent-initiative/` contains 37 shared scenarios and a frozen Git-sourced Skill v1 fixture. The deterministic v1 characterization scores 83.11 with 23/37 passing; Skill v2 scores 100 with 37/37 passing, a +16.89 delta and no regressed scenario ids.
- The static Eval improves recall-only classification from 0 to 1, preserves the 10/10 no-track guardrail, and improves forbidden scenarios from 4/6 to 6/6. These are reproducible policy-characterization results, not observed LLM success rates.
- An opt-in real Codex A/B runner uses 12 bilingual scenarios, one temporary Vault and token-protected loopback MCP process per run, project-local Skill injection for only the Skill arm, redacted JSONL artifacts, strict overall/per-class pass rates, and independent invocation/lifecycle/propagation metrics. Project-identity probes additionally measure correct startup resolution, correct first project Recall, first-Recall durable-memory hits, recovery retries, duplicate Recall, and calls before effective Recall. A read-only replay mode can reparse selected scenarios or arms with the current evaluator without MCP/model execution or raw-evidence mutation; derived reports retain source, raw-artifact, evaluation-code, and scenario-set hashes. Its non-model tests run in repository verification; real model calls do not.
- The runner derives task closeout only from `finish_task`, not from an earlier proposal status, and accepts contract-equivalent scalar/one-item-list path arguments. This prevents correct local Wiki proposals from being scored as closeout or propagation failures.
- A bounded one-repetition smoke across no-track, recall-only, and tracked-task scenarios completed all six MCP-only/Skill-arm executions. Both arms preserved the no-track guardrail, invoked Recall for history, completed one start/Recall/finish lifecycle with the real task id, and propagated verified Wiki/source paths. This smoke showed no arm delta and is not the full 12-scenario repeated benchmark.
- A three-repetition `real-track-basic` probe exposed Agent-supplied short project names, which led to the shared resolver canonicalizing unmatched hints through unique durable `repo_path` matches. In the post-fix run, both arms resolved startup and first project-Recall identity correctly in 3/3 runs with no identity recovery or duplicate Recall. The Skill arm reached durable project memory on the first Recall in 3/3 runs versus 2/3 for MCP-only and averaged 4.33 tool calls versus 5.67; both averaged two calls before effective Recall. One MCP-only run called `project_history` before the required narrow project Recall, so strict scenario acceptance was 2/3 versus 3/3. The Skill arm preserved expected Wiki paths in 2/3 runs versus 3/3 for MCP-only, so this small sample demonstrates improved identity enforcement but not a uniformly superior Skill arm.
- The first complete repeated matrix ran 12 scenarios × 2 arms × 3 repetitions (72 successful model executions; run `2026-07-23T07-04-53-089Z-327948`). Replayed under the final corrected evaluator, MCP-only passed 29/36 and Skill v2.0.0 passed 28/36. Both preserved no-track at 9/9 and recall-only at 6/9; MCP-only led tracked-task strict acceptance 14/18 to 13/18, while Skill improved Recall invocation and first durable-memory hits. This result rejected any claim that the pre-tuning Skill arm was uniformly better.
- That matrix exposed three actionable defects: Skill v2.0.0 classified all three durable policy-summary prompts below `tracked_task`; unqualified project-Wiki requests could drift to external connectors; and the evaluator lacked strict rates and conflated proposal status, finish status, and scalar/list path forms.
- A focused post-tuning matrix reran the three affected tracked scenarios × 2 arms × 3 repetitions (18 successful model executions; run `2026-07-23T08-09-19-715Z-712751`). Replaying the unchanged raw JSONL under the corrected evaluator gives Skill v2.0.1 9/9 strict passes versus MCP-only 7/9. The Skill arm achieved 9/9 mode classification, Recall invocation, start/Recall/finish lifecycle, task-id continuity, exactly-once finish, Wiki propagation, and source propagation, with zero tool errors and no external connector calls. Its comparable pre-tuning subset was 5/9. MCP-only's two remaining failures both skipped Tracekeeper for the durable policy-summary cue, while its Wiki and query-echo scenarios passed 6/6. The focused sample validates the intended Skill responsibility but does not replace a full post-tuning matrix.
- The seeded full post-tuning matrix ran 12 scenarios × 2 arms × 3 repetitions (72 successful model executions; experiment `skill-v2.0.1-full-seed-2026072301`). The redacted aggregate and a read-only replay agreed: Skill v2.0.1 passed 25/36 versus MCP-only 29/36, with paired outcomes of two Skill wins, six MCP-only wins, 23 pass ties, and five fail ties. Both arms preserved no-track at 9/9 with no external connector or approved-writeback calls. The Skill arm reached 100% mode classification, Recall invocation, tracked start/Recall/finish, real task-id continuity, and exactly-once finish; improved verified Wiki/source propagation to 72.22%/88.89% from 66.67%/77.78%; and added 0.36 average tool calls per run. It nevertheless missed the overall, recall-only, tracked-task, and Wiki-propagation acceptance targets, primarily because its first Recall more often used `global` or `project_history` rather than the required narrow `project` scope. The observed baseline is tracked in `evals/agent-initiative/baselines/real-skill-v2.0.1.json`; raw real-Agent artifacts remain local and Git-ignored.
- The v2.0.1 matrix also exposed one independent runtime defect: a Skill-arm `finish_task` reused the `start_task` idempotency key, and the Runtime loaded the cross-tool journal payload as a finish payload before failing on an undefined `closeoutGroups` filter. The Runtime now rejects start/finish key collisions before payload casting as a typed, non-retryable `IDEMPOTENCY_CONFLICT`; bidirectional integration coverage verifies no workflow artifacts are created.
- Skill v2.0.2 and the cross-tool idempotency fix were evaluated through a gated sequence. The 24-run Recall/idempotency probe passed: all runs executed, Skill recall-only passed 8/9 versus 7/9 for MCP-only, Skill idempotency passed 3/3, both arms had zero tool errors, and Skill used 0.42 fewer tool calls per run. The subsequent seeded 72-run matrix and read-only replay agreed: Skill passed 33/36 versus MCP-only 31/36, recall-only improved to 9/9 versus 7/9, tracked work tied at 15/18, and both preserved no-track at 9/9. Skill completed all 18 tracked lifecycles with the real task id and exactly one finish, passed policy-summary, forbidden-recovery, and idempotency 3/3 each, made no external or approved-writeback calls, had zero tool errors, and added 0.28 calls per run.
- The v2.0.2 real-matrix release gate remains held because verified graph-path propagation missed its floor: Skill preserved Wiki paths in 12/18 tracked runs and source paths in 15/18, below the required 16/18 each. All three strict Skill failures were the query-echo closeout scenario: Recall exposed only a request-echo task record and no verifiable durable project paths, so the Agent correctly omitted `related_wiki` and `related_sources` rather than inventing them. The observed redacted baseline is `evals/agent-initiative/baselines/real-skill-v2.0.2.json`; raw real-Agent artifacts remain local and Git-ignored.
- v2.0.3 real-matrix validation has not completed. The first seeded query-echo attempt produced six infrastructure failures before model execution because the restricted environment could not write the Codex state database; the runner correctly marked the aggregate incomplete, excluded all pairs, and retained resumable attempt evidence. A sandbox-external resume still requires explicit authorization for sending the synthetic prompts and repository-derived Skill/MCP configuration to the selected model service, so no v2.0.3 pass-rate claim is published yet.
- Activity aggregates recent local audit events into workflow conversion ratios, incomplete or aged workflows, permission denials, zero matches, closeout distribution, P50/P95 tool duration, recent principals, and bundled Skill version. It provides a copyable local Eval command and states that retained audit calls cannot measure missed calls.

### Product And Release Baseline

- The current three-root vault architecture, required indexes/control files, lint, graph health, and legacy-layout inspection are implemented.
- Global durable memory is review-gated by default; user-enabled project memory remains append-only, duplicate-protected, and linked to a Wiki context.
- Client configuration changes preserve unrelated entries and use short-lived preview plans. Confirmation rechecks the original file hash and current client credential before creating a timestamped backup and temporary-file replacement.
- The GitHub release workflow verifies and packages the plugin, uploads the three community assets, and generates artifact attestations.

## Remaining Engineering Limits

- Native Views, Modals, feature models, legacy migration, graph evaluation, Review Queue/writeback, activity/audit projection, source/task/context/proposal records, shared Markdown parsing, and client-configuration I/O have been extracted from the historical large `main.ts`. The composition entry now retains lifecycle and registration, required-structure initialization, runtime/settings/onboarding composition, Agent-connection aggregation, and thin local-action delegates.
- Core has Node and Obsidian `VaultRepository` adapters. Production note reads and generated task/source/context/session/proposal/audit/auto-memory paths prefer the injected repository; the standalone development composition intentionally retains safe filesystem fallbacks, and several compatibility path prechecks still use the Node safety layer.
- The in-memory index intentionally rebuilds on plugin startup; persistent index caching is not part of the current baseline.
- Automated coverage focuses on contracts, recovery, repository adapters, protocol matrices, runtime flows, Skill installation, local profiles, onboarding evidence, workflow diagnostics, and pure view models. A full Obsidian-hosted UI integration suite is not yet present.
- The standalone MCP command is a development tool; production packaging remains the Obsidian-hosted runtime.
- The real initiative runner is opt-in. The current evidence includes one gated probe and one seeded repeated full matrix in a single Codex environment; additional seeds and client/model environments are still required before treating the observed arm delta as stable.

## Next Coherent Slices

1. Run the dedicated Skill v2.1.0 multi-source-ingestion matrix in an explicitly authorized model-execution environment, then repeat the existing 72-run matrix only if language, source capture, proposal idempotency, and safety checks pass.
2. Resume the bounded v2.0.3 query-echo propagation matrix in an explicitly authorized model-execution environment and confirm durable-first Recall plus verified Wiki/source evidence in both arms.
3. Repeat the full seeded matrix only if the bounded matrix passes without regressing Recall routing, lifecycle, safety, or efficiency, then evaluate the 16/18 Wiki and source propagation release floors.
4. Split the large MCP application-tool module by use-case ownership while preserving the contract registry, result validation, audit metadata, and current package boundary.
5. Add real Obsidian-hosted UI acceptance coverage for managed Skill install/update, capability profiles, workflow diagnostics, onboarding, Review Queue, index rebuild, and credential lifecycle.
6. Continue reducing composition-root orchestration only where it creates an independently testable controller; do not split files solely for line count.
7. Decide from measured large-vault startup data whether a rebuildable persistent index cache is justified.

## Status Update Rule

When a gap is implemented, move any lasting decision into the appropriate product, architecture, or security owner and edit this snapshot to describe the new executable baseline. Do not turn this file into an accumulating historical changelog; released history belongs in `CHANGELOG.md`.
