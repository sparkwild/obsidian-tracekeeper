# Real Agent Initiative Runner

This folder contains the opt-in real-Agent A/B evaluation:

- `scenarios.json` — runnable scenario matrix for real-model tracing.
- `synthetic-vault.mjs` — creates ephemeral vault fixture data for each run.
- `trace-parser.mjs` — normalizes `codex --json` line events to evaluator traces.
- `runner.mjs` — starts an isolated local MCP runtime for each run, invokes Codex, and compares the observed arms.

## Usage

Preview the matrix without starting MCP or calling a model:

```bash
npm run eval:agent-initiative:real -- --scenario real-greeting
```

Run one real two-arm smoke:

```bash
npm run eval:agent-initiative:real -- --execute --scenario real-greeting
```

Run the separate v2.1.0 multi-source ingestion matrix without changing the existing 12-scenario regression matrix:

```bash
npm run eval:agent-initiative:real -- \
  --execute \
  --scenarios evals/agent-initiative/real/ingestion-scenarios.json \
  --arm both \
  --repetitions 1 \
  --seed tracekeeper-v210-ingest \
  --experiment-id tracekeeper-v210-ingest
```

This matrix uses only synthetic local source files and a deliberately unavailable example URL. It measures local snapshot capture, safe `external_reference` fallback, review-boundary preservation, stable retry-key use, and non-duplicating closeout. It does not perform a real network fetch.

Run the complete matrix three times per arm:

```bash
npm run eval:agent-initiative:real -- \
  --execute \
  --repetitions 3 \
  --seed 2026072301 \
  --experiment-id skill-v2.0.2-full-seed-2026072301
```

Resume that exact experiment after an interruption:

```bash
npm run eval:agent-initiative:real -- \
  --execute \
  --repetitions 3 \
  --seed 2026072301 \
  --experiment-id skill-v2.0.2-full-seed-2026072301 \
  --resume
```

Limit resume retries for infra-failed attempts (codex exit or MCP connectivity failures):

```bash
npm run eval:agent-initiative:real -- \
  --execute \
  --scenario real-greeting \
  --max-infra-retries 2 \
  --experiment-id resume-budget-demo \
  --resume
```

Run parser, CLI, metric, and synthetic-Vault tests without calling a model:

```bash
npm run eval:agent-initiative:real:test
```

Replay an existing run with the current parser, scenarios, and evaluator without starting MCP or calling a model:

```bash
npm run eval:agent-initiative:real -- \
  --replay-report evals/agent-initiative/reports/real/<run-id>/aggregate.json \
  --report evals/agent-initiative/reports/real/<run-id>/replay-current.json
```

The replay command accepts `--scenario`, `--max-scenarios`, `--arm`, and `--strict`, so a single arm or bounded scenario subset can be checked independently. It reads the source report and referenced redacted `raw.jsonl` files, leaves them unchanged, and records source, raw-artifact, evaluation-code, and scenario-set SHA-256 identities in the derived report. The output path must differ from the source report.

## Options

- `--scenario` or `--only-id`/`--only-ids`: comma-separated scenario ids (or repeat the flag).
- `--arm both|mcp-only|mcp-skill|both,mcp-skill`
	- `both` runs both arms; `mcp-only` runs MCP tool only; `mcp-skill` copies the local `skills/tracekeeper` bundle into the temp workspace before execution.
	- If `mcp-only` is selected, run fails fast if any external tracekeeper skill is discoverable in user home/agent roots.
- `--max-infra-retries N`: allow at most `N` retries after the initial attempt when a tuple did not execute successfully; attempts are persisted in `checkpoint.json`.
- `--replay-report path`: reevaluate an existing aggregate and its raw artifacts under `evals/agent-initiative/reports/`; this mode does not require `--execute`.
- `--seed value`: deterministically counterbalance which arm runs first in each scenario/repetition pair.
- `--experiment-id id`: use a stable directory under `evals/agent-initiative/reports/real/` for checkpoints and final output.
- `--resume`: resume an existing experiment and skip completed scenario/arm/repetition tuples. A stable experiment id or explicit output/report path is required.
- `--repetitions N`: repeat each scenario N times per arm.
- `--max-scenarios N`: execute only first N selected scenarios.
- `--model`: model override for `codex`.
- `--codex-bin` / `--codex-binary`: override codex executable used.
- `--output-dir path`: custom output directory under `evals/agent-initiative/reports/`.
- `--report path`: write to a specific report file under `evals/agent-initiative/reports/`.
- `--strict`: exit non-zero if any run fails.
- `--keep-vault`: keep generated synthetic vault directories for postmortem.

## A/B boundary

Every scenario/repetition/arm receives a fresh temporary worktree, Vault, token, loopback port, and standalone MCP process.

- `mcp-only` exposes the same MCP endpoint and prompt but installs no project Skill.
- `mcp-skill` copies the live `skills/tracekeeper` bundle to the temporary worktree's `.agents/skills/tracekeeper`.
- Two-arm experiments use the seed to balance `mcp-only`-first and `mcp-skill`-first pairs. The exact order is recorded and reproducible.
- The runner passes only the original scenario request plus the same neutral workspace instruction. It does not reveal the expected mode, arm, or expected Wiki/source paths to the Agent.
- Existing Codex authentication is reused. `--ignore-user-config` prevents user MCP configuration from entering the run, and the runner never creates, copies, or rewrites `CODEX_HOME`.
- If an external `tracekeeper` Skill is discoverable in known user Skill/plugin roots, the `mcp-only` arm fails fast instead of reporting a contaminated comparison.

## Safety and output

Execution writes one JSON report (default `evals/agent-initiative/reports/real/<run-id>/aggregate.json`):

- `runs`: per-run metadata, output path map, evaluation checks, and class.
- `summaries`: per-run evaluation summary with continuity, project-identity, first-recall, duplicate-call, and review metrics.
- `aggregates`: per-arm aggregate rates (`mode_classification_rate`, `tracked_start_recall_finish_rate`, `first_project_recall_identity_rate`, etc.), efficiency averages, and class counts.
- `paired_outcomes`: paired strict-pass wins, losses, ties, discordant pairs, and overall/per-class arm deltas.
- `provenance`: seed, timestamps, Skill identity, evaluator/scenario/MCP stack hashes, Codex version, execution environment, and start/completion Git identities. The report flags a working-tree change during execution.
- `provenance.model_status`: whether `--model` was explicitly provided for this run (`requested` or `unknown`).
- `provenance.release_grade`: `true` when a model was explicitly requested, otherwise `false`.
- `aggregates` also expose strict scenario pass rates (`strict_scenario_pass_rate`, `strict_no_track_pass_rate`, `strict_recall_only_pass_rate`, `strict_tracked_task_pass_rate`).
  - strict rates divide `summary.passed` counts by the corresponding run sample count.
  - if a denominator is zero (for example, no sampled `recall_only` runs), the corresponding strict pass rate is `null`.
- Task closeout status is derived only from `tracekeeper.finish_task`; a status returned by a separate proposal or write tool is not treated as the tracked task's closeout report.
- Argument and propagation checks treat a schema-supported scalar path as equivalent to the corresponding one-item list.
- `delta`: difference between `mcp-skill` and `mcp-only` where both arms are present.
- `dry_run: true`: returned when `--execute` is not set, with no actual codex calls.
- `replay: true`: returned by read-only replay mode, together with source/evaluator fingerprints and per-run raw-artifact hashes.
- `checkpoint.json`: updated atomically after each completed run. Resume rejects configuration or local integrity mismatches; this detects accidental mutation but is not a signature against an attacker who controls the report directory.

Per-run files are currently:

- `raw.jsonl`: raw codex stdout (token/tmp roots redacted).
- `trace.json`: normalized evaluator trace.
- `agent-message.json`: captured final assistant message.
- `diagnostics.json`: parse/transport diagnostics.

The runtime binds to `127.0.0.1` on an ephemeral port and uses a random bearer token. Raw stdout, diagnostics, Agent messages, tokens, temporary roots, and user-home paths are redacted before persistence. Raw JSONL can still contain synthetic prompt or synthetic note content; reports are ignored by Git and should be treated as local evaluation artifacts.

## Interpretation

- Real execution consumes model quota and is probabilistic. Use repetitions before drawing conclusions.
- The aggregate reports mode classification, proactive Recall, tracked lifecycle completion, task-id continuity, no-track false positives, tool errors, and Wiki/source closeout propagation per arm and as `mcp-skill - mcp-only` deltas.
- The project-identity probe also reports whether task startup resolved a canonical identity, whether the first project Recall used that identity and ranked durable project memory first, whether the Agent needed an identity-recovery retry, duplicate Recall rate, average tool calls, and calls before the first effective Recall.
- Lower `project_identity_recovery_rate`, `duplicate_recall_rate`, `average_tool_calls_per_run`, and `average_tool_calls_before_effective_recall` are better. Other rates are success rates where higher is better.
- This runner is not a CI gate. Only its local parser/configuration tests belong in ordinary verification.
- A good result characterizes this client/model/scenario set; it does not prove that every Agent will select the Skill or that every user Vault has adequate knowledge quality.
