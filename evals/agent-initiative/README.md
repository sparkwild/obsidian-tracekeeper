# Agent Initiative Eval

This directory provides the Phase 0 local static characterization for Tracekeeper Agent initiative. It evaluates deterministic traces as data. It does not call an LLM, start MCP, read an Obsidian Vault, or write user knowledge.

## Baselines

The two baselines reuse the same 37 scenarios:

- `current-skill-v1.json` points only to `fixtures/skills/tracekeeper-v1/SKILL.md`. The fixture is an exact byte snapshot of Git blob `fd78ad6d8e9c36ba7ecca78f688b4858db6bd779` from commit `5114bfe37216816f45de5b575e8aada5b0897ca9`; `source.json` records the extraction command and SHA-256. It never reads the live Skill.
- `current-skill-v2.json` fingerprints the live Skill v2 entrypoint and all four referenced workflow documents. Its deterministic adapter derives a capability profile from those texts, then classifies prompts and recovery states by semantic patterns rather than scenario ids.

These are static characterizations, not observed model success rates. A passing v2 result means that the fingerprinted Skill text can be mapped deterministically to the expected policy trace; it does not prove that a particular Agent will select or follow the Skill.

## Scenario and scoring contract

Every scenario selects one expected mode: `no_track`, `recall_only`, or `tracked_task`. The contract checks required and forbidden tools, ordered calls, arguments, task-id continuity, finish cardinality, forbidden effects, recovery reports, and closeout status.

The fixed Phase 0 weights are:

| Dimension | Weight |
| --- | ---: |
| Mode classification | 25 |
| Required tools | 20 |
| Forbidden tools and behaviors | 15 |
| Call order | 10 |
| Argument quality | 10 |
| `task_id` continuity and finish cardinality | 10 |
| Closeout status report | 5 |
| Failure recovery report | 5 |

A case passes only when every check passes. No difficult recovery or forbidden scenario is removed to improve the score.

## Commands

Verify the frozen v1 baseline and report hash:

```bash
node evals/agent-initiative/evaluator/run-eval.mjs --baseline v1 --check-baseline
```

Verify the current v2 bundle, baseline, and strict result:

```bash
node evals/agent-initiative/evaluator/run-eval.mjs --baseline v2 --check-baseline --strict
```

Print an auditable v1-versus-v2 comparison with per-case results, improved/regressed ids, class delta, and no-track/forbidden guardrails:

```bash
npm run eval:agent-initiative:compare
```

Run evaluator tests:

```bash
npm run eval:agent-initiative:test
```

The existing `npm run eval:agent-initiative` command remains the v1 compatibility check. Use `--traces <file>` with a single baseline to evaluate externally captured synthetic traces. Use `--report <name>` to write beneath the ignored `reports/` directory.

## Real Agent A/B runner

`real/` contains a separate opt-in runner that starts a token-protected loopback MCP runtime over a fresh temporary synthetic Vault for every run. It compares identical Codex prompts in two arms: MCP only and MCP plus the repository's Tracekeeper Skill installed into the temporary worktree.

```bash
npm run eval:agent-initiative:real:test
npm run eval:agent-initiative:real -- --scenario real-greeting
npm run eval:agent-initiative:real -- --execute --scenario real-recall-basic,real-track-basic
```

The default command only previews the matrix. `--execute` consumes model quota and writes redacted, Git-ignored traces under `reports/real/`. The real execution lane is deliberately not a CI or release gate; only its parser, CLI, metric, and synthetic-Vault tests run during ordinary verification. See [the runner guide](real/README.md) for isolation and interpretation rules.

## Limitations

- Static adapters model explicit Skill semantics; they do not measure probabilistic model behavior.
- Prompt patterns are bilingual scenario semantics, not a general natural-language classifier.
- Runtime action-envelope and MCP integration behavior can be sampled with the opt-in real runner, but results remain client-, model-, scenario-, and repetition-dependent.
- Changing scenarios, Skill sources, adapters, or evaluator output requires an intentional baseline/hash review.
