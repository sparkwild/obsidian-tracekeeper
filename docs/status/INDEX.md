# Current Status

- Snapshot date: 2026-07-23
- Repository version: `0.2.3`

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
- Global and project recall apply visible project-memory priority and work-record query-echo penalties so generated task text does not outrank matching durable project memory. Project-history recall continues to expose task and session records.

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

### Identity, Limits, And Audit

- Managed Agent clients receive independent credential principals; legacy shared-token settings are migrated for compatibility.
- Settings can rotate one managed client credential at a time; the old credential stops working while other client credentials remain unchanged.
- Credentials carry explicit tool capabilities. A read-only principal cannot invoke write tools, and client-reported identity cannot change authorization.
- Managed clients can use local capability-profile presets; new managed credentials default to Knowledge Assistant, while existing `['*']` credentials retain full compatibility as display-only Custom. Profiles are convenience mappings over credential capabilities, not hosted roles or a second authorization layer. Credential rotation preserves the selected profile and capability set.
- Runtime authentication retains credential hashes rather than plaintext token values after construction.
- MCP sessions are principal-bound and have idle-lifetime, active-session-count, per-session stream, request-body-read-time, and request-body-size limits. Active event streams are not removed by ordinary idle pruning, and POST requests reject unsupported content types.
- Tool-call audit records include credential principal and bounded workflow evidence such as mode, task/recall/action ids, contract/result versions, scope diagnostics, recall match count, and closeout state; tokens, complete prompts, note bodies, and full response bodies are not persisted.

### Agent Ecosystem And Onboarding

- Skill v2 is a canonical bundle containing a short entrypoint, four focused references, a versioned hash manifest, and a generated flattened compatibility artifact. It classifies `no_track`, `recall_only`, and `tracked_task`, prefers structured actions, isolates recalled instructions, and keeps permission enforcement in MCP.
- Tracked closeout guidance preserves existing `related_wiki` and `related_sources` paths from Recall or correlated note reads without inventing graph relationships; Runtime validation and Review Queue fallback remain authoritative.
- The plugin embeds and verifies the complete bundle. A supported managed client can preview and explicitly confirm install/update with hash rechecks, staging, backup, rollback, and modified-file protection; other clients receive copy-only compatibility guidance.
- `npm run agent:ecosystem` rebuilds bundle identity, checks workflow semantics and unsafe examples, and verifies plugin packaging, installation controls, and evidence fields as part of `npm run verify`.
- Plugin onboarding is resumable across vault check, runtime readiness, client configuration, bundle availability/copy/install evidence, client reload, external connection verification, first recall, and observed tracked workflow.
- Configuration, user confirmation, file verification, MCP connection, recall, and Skill-trigger behavior are not conflated. Same-principal audit evidence is required for connection, non-empty recall, and a complete `start -> recall -> finish` observation.

### Eval And Local Diagnostics

- `evals/agent-initiative/` contains 37 shared scenarios and a frozen Git-sourced Skill v1 fixture. The deterministic v1 characterization scores 83.11 with 23/37 passing; Skill v2 scores 100 with 37/37 passing, a +16.89 delta and no regressed scenario ids.
- The static Eval improves recall-only classification from 0 to 1, preserves the 10/10 no-track guardrail, and improves forbidden scenarios from 4/6 to 6/6. These are reproducible policy-characterization results, not observed LLM success rates.
- An opt-in real Codex A/B runner now uses 12 bilingual scenarios, one temporary Vault and token-protected loopback MCP process per run, project-local Skill injection for only the Skill arm, redacted JSONL artifacts, and independent invocation/lifecycle/propagation metrics. Its non-model tests run in repository verification; real model calls do not.
- A bounded one-repetition smoke across no-track, recall-only, and tracked-task scenarios completed all six MCP-only/Skill-arm executions. Both arms preserved the no-track guardrail, invoked Recall for history, completed one start/Recall/finish lifecycle with the real task id, and propagated verified Wiki/source paths. This smoke showed no arm delta and is not the full 12-scenario repeated benchmark.
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
- The real initiative runner is opt-in and the current observed sample is intentionally small. Repeated full-matrix runs are still required before treating an arm delta as stable.
- The bounded real smoke showed that a path-valued `project_hint` produced by task startup can initially retrieve the generated task echo rather than canonical project memory. Agents recovered by retrying with canonical `project_hint` plus `repo_path`, but startup and recommended Recall do not yet share one project-identity resolver.

## Next Coherent Slices

1. Add one shared project-identity resolver for task startup, context-pack construction, recommended Recall, and closeout, then cover path-valued startup hints with an integration regression.
2. Split the large MCP application-tool module by use-case ownership while preserving the contract registry, result validation, audit metadata, and current package boundary.
3. Add real Obsidian-hosted UI acceptance coverage for managed Skill install/update, capability profiles, workflow diagnostics, onboarding, Review Queue, index rebuild, and credential lifecycle.
4. Continue reducing composition-root orchestration only where it creates an independently testable controller; do not split files solely for line count.
5. Decide from measured large-vault startup data whether a rebuildable persistent index cache is justified.

## Status Update Rule

When a gap is implemented, move any lasting decision into the appropriate product, architecture, or security owner and edit this snapshot to describe the new executable baseline. Do not turn this file into an accumulating historical changelog; released history belongs in `CHANGELOG.md`.
