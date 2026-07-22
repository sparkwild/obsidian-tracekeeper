# Current Status

- Snapshot date: 2026-07-22
- Repository version: `0.2.3`

This is a dated implementation snapshot, not a permanent product contract. Update it when a release materially changes the implemented boundary.

## Implemented Baseline

### Runtime And Package Boundaries

- Desktop Obsidian hosts the production loopback Streamable HTTP MCP runtime; the standalone server remains a development and test composition root.
- Reusable MCP protocol, authentication, tool dispatch, and application services live in `packages/mcp-runtime` rather than inside either application.
- Structured public tool metadata lives in `packages/contracts`; the registry drives tool order, schemas, risk, capability, and public/deprecated status.
- The plugin and standalone server import workspace packages through declared package dependencies. Neither application imports the other application's source or compiled output.
- The public MCP surface contains 12 focused `tracekeeper.*` tools covering status, lint, recall, reads, task lifecycle, context packs, review, source workflows, and memory proposals.

### Knowledge Reads

- Core exposes a rebuildable in-memory `KnowledgeIndex` whose snapshots include generation and index-state provenance.
- The Obsidian adapter subscribes to Vault events before starting a background initial rebuild. Events received during rebuild are queued and replayed before the new generation becomes current.
- Production status, recall, context, graph, lint, and task-start paths share the current indexed snapshot instead of synchronously rescanning the vault for every tool call.
- Connection Status exposes index state, generation, note count, and last rebuild, and a plugin command can request a rebuild without replacing the Vault as fact source.
- The standalone runtime retains the Node filesystem scan path for development and tests; the Vault remains the only durable fact source.

### Recoverable Writes And Tasks

- Coordinated multi-step operations use stable operation IDs, payload hashes, step records, atomic journal replacement, startup roll-forward recovery, and per-artifact audit-event identities.
- The operation journal is stored under `00_tracekeeper/control/operations/` and is excluded from knowledge scanning.
- Approved writeback uses a stable target marker and optimistic content checks so retries do not duplicate the target block and external edits are not silently overwritten.
- `start_task` and `finish_task` accept idempotency keys. Replays return the original result, while reusing a key with a different payload is rejected.
- The first `finish_task` invocation freezes its normalized request and derived routing/language snapshot in the journal. Recovery reuses that snapshot, so later graph, policy, language, or task-metadata changes cannot mutate the original closeout.
- Completed tasks cannot be finished a second time with a conflicting closeout.
- Vault-local process locks and atomic journal claims prevent the Obsidian runtime and standalone development runtime from executing the same idempotency key at the same time.
- Runtime status retains the latest startup-recovery counts so the Obsidian Connection Status surface can show recovered, failed, and skipped operations.

### Identity, Limits, And Audit

- Managed Agent clients receive independent credential principals; legacy shared-token settings are migrated for compatibility.
- Settings can rotate one managed client credential at a time; the old credential stops working while other client credentials remain unchanged.
- Credentials carry explicit tool capabilities. A read-only principal cannot invoke write tools, and client-reported identity cannot change authorization.
- Runtime authentication retains credential hashes rather than plaintext token values after construction.
- MCP sessions are principal-bound and have idle-lifetime, active-session-count, per-session stream, request-body-read-time, and request-body-size limits. Active event streams are not removed by ordinary idle pruning, and POST requests reject unsupported content types.
- Tool-call audit records include credential principal and bounded result evidence such as recall match count; tokens and response bodies are not persisted.

### Agent Ecosystem And Onboarding

- The companion workflow Skill is canonical at `skills/tracekeeper/SKILL.md` and embedded into the community-plugin bundle from that source. Onboarding can copy it without requiring a repository checkout. It teaches meaningful-task start/recall/finish habits but does not grant permissions or duplicate the server.
- `npm run agent:ecosystem` checks the Skill against the normative Agent workflow contract and is part of `npm run verify`.
- Plugin onboarding is resumable across vault check, runtime readiness, client configuration, embedded Skill copy/setup, Agent restart, external connection verification, and first recall.
- Configuration is not treated as successful connection. Connection and first-recall completion require recorded tool-call evidence from the selected credential principal, and first recall requires at least one match.

### Product And Release Baseline

- The current three-root vault architecture, required indexes/control files, lint, graph health, and legacy-layout inspection are implemented.
- Global durable memory is review-gated by default; user-enabled project memory remains append-only, duplicate-protected, and linked to a Wiki context.
- Client configuration changes preserve unrelated entries and use short-lived preview plans. Confirmation rechecks the original file hash and current client credential before creating a timestamped backup and temporary-file replacement.
- The GitHub release workflow verifies and packages the plugin, uploads the three community assets, and generates artifact attestations.

## Remaining Engineering Limits

- Native Views, Modals, feature models, legacy migration, graph evaluation, Review Queue/writeback, activity/audit projection, source/task/context/proposal records, shared Markdown parsing, and client-configuration I/O have been extracted from the historical large `main.ts`. The composition entry now retains lifecycle and registration, required-structure initialization, runtime/settings/onboarding composition, Agent-connection aggregation, and thin local-action delegates.
- Core has Node and Obsidian `VaultRepository` adapters. Production note reads and generated task/source/context/session/proposal/audit/auto-memory paths prefer the injected repository; the standalone development composition intentionally retains safe filesystem fallbacks, and several compatibility path prechecks still use the Node safety layer.
- The in-memory index intentionally rebuilds on plugin startup; persistent index caching is not part of the current baseline.
- Automated coverage focuses on contracts, recovery, repository adapters, runtime flows, onboarding state, and pure view models. A full Obsidian-hosted UI integration suite is not yet present.
- The standalone MCP command is a development tool; production packaging remains the Obsidian-hosted runtime.

## Next Coherent Slices

1. Continue reducing composition-root orchestration only where it creates an independently testable controller; do not split files solely for line count.
2. Split the large MCP application-tool module by use-case ownership while preserving the contract registry and current package boundary.
3. Add real Obsidian-hosted UI acceptance coverage for onboarding, Review Queue, index rebuild, and credential lifecycle.
4. Decide from measured large-vault startup data whether a rebuildable persistent index cache is justified.

## Status Update Rule

When a gap is implemented, move any lasting decision into the appropriate product, architecture, or security owner and edit this snapshot to describe the new executable baseline. Do not turn this file into an accumulating historical changelog; released history belongs in `CHANGELOG.md`.
