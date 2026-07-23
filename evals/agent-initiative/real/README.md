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

Run the complete matrix three times per arm:

```bash
npm run eval:agent-initiative:real -- --execute --repetitions 3
```

Run parser, CLI, metric, and synthetic-Vault tests without calling a model:

```bash
npm run eval:agent-initiative:real:test
```

## Options

- `--scenario` or `--only-id`/`--only-ids`: comma-separated scenario ids (or repeat the flag).
- `--arm both|mcp-only|mcp-skill|both,mcp-skill`
	- `both` runs both arms; `mcp-only` runs MCP tool only; `mcp-skill` copies the local `skills/tracekeeper` bundle into the temp workspace before execution.
	- If `mcp-only` is selected, run fails fast if any external tracekeeper skill is discoverable in user home/agent roots.
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
- The runner passes only the original scenario request plus the same neutral workspace instruction. It does not reveal the expected mode, arm, or expected Wiki/source paths to the Agent.
- Existing Codex authentication is reused. `--ignore-user-config` prevents user MCP configuration from entering the run, and the runner never creates, copies, or rewrites `CODEX_HOME`.
- If an external `tracekeeper` Skill is discoverable in known user Skill/plugin roots, the `mcp-only` arm fails fast instead of reporting a contaminated comparison.

## Safety and output

Execution writes one JSON report (default `evals/agent-initiative/reports/real/<run-id>/aggregate.json`):

- `runs`: per-run metadata, output path map, evaluation checks, and class.
- `summaries`: per-run evaluation summary with continuity/review metrics.
- `aggregates`: per-arm aggregate rates (`mode_classification_rate`, `tracked_start_recall_finish_rate`, etc.) and class counts.
- `delta`: difference between `mcp-skill` and `mcp-only` where both arms are present.
- `dry_run: true`: returned when `--execute` is not set, with no actual codex calls.

Per-run files are currently:

- `raw.jsonl`: raw codex stdout (token/tmp roots redacted).
- `trace.json`: normalized evaluator trace.
- `agent-message.json`: captured final assistant message.
- `diagnostics.json`: parse/transport diagnostics.

The runtime binds to `127.0.0.1` on an ephemeral port and uses a random bearer token. Raw stdout, diagnostics, Agent messages, tokens, temporary roots, and user-home paths are redacted before persistence. Raw JSONL can still contain synthetic prompt or synthetic note content; reports are ignored by Git and should be treated as local evaluation artifacts.

## Interpretation

- Real execution consumes model quota and is probabilistic. Use repetitions before drawing conclusions.
- The aggregate reports mode classification, proactive Recall, tracked lifecycle completion, task-id continuity, no-track false positives, tool errors, and Wiki/source closeout propagation per arm and as `mcp-skill - mcp-only` deltas.
- This runner is not a CI gate. Only its local parser/configuration tests belong in ordinary verification.
- A good result characterizes this client/model/scenario set; it does not prove that every Agent will select the Skill or that every user Vault has adequate knowledge quality.
