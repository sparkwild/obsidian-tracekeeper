#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_root_script() {
  local script="$1"
  printf '\n>>> root: npm run %s\n' "$script"
  (cd "$ROOT" && npm run "$script")
}

verify_plugin_build_mirror() {
  printf '\n>>> root: verify plugin build mirror\n'
  test -f "$ROOT/main.js"
  cmp -s "$ROOT/main.js" "$ROOT/apps/obsidian-plugin/main.js"
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
run_root_script test
run_root_script package

if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf '\n>>> root: git diff --check\n'
  git -C "$ROOT" diff --check
fi

printf '\nTracekeeper verification finished.\n'
