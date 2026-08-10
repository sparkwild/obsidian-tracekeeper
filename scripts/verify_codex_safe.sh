#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_root_script() {
  local script="$1"
  printf '\n>>> root: npm run %s\n' "$script"
  (cd "$REPO_ROOT" && npm run "$script")
}

run_workspace_script() {
  local script="$1"
  local workspace="$2"
  printf '\n>>> workspace %s: npm run %s\n' "$workspace" "$script"
  (cd "$REPO_ROOT" && npm run "$script" --workspace "$workspace")
}

verify_plugin_build_mirror() {
  printf '\n>>> root: verify plugin build mirror\n'
  test -f "$REPO_ROOT/main.js"
  cmp -s "$REPO_ROOT/main.js" "$REPO_ROOT/apps/obsidian-plugin/main.js"
}

run_root_script community:check
run_root_script agent:ecosystem
run_root_script agent:ecosystem:test
run_root_script eval:agent-initiative:test
run_root_script eval:agent-initiative:real:test
run_root_script eval:agent-initiative:compare
run_root_script architecture:check
run_root_script release:upgrade-fixture:test
run_root_script typecheck
run_root_script build
verify_plugin_build_mirror
run_workspace_script test packages/core
run_workspace_script test packages/contracts
run_workspace_script test apps/obsidian-plugin
run_workspace_script test:non-listener packages/mcp-runtime
run_workspace_script test:non-listener apps/mcp-server
run_root_script benchmark:index:test
run_root_script package

if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf '\n>>> root: git diff --check\n'
  git -C "$REPO_ROOT" diff --check
fi

printf '\nTracekeeper Codex-safe verification finished without listener or network test rows.\n'
