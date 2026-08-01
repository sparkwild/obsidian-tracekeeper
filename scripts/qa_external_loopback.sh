#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_SHA="${TRACEKEEPER_CANDIDATE_SHA:-}"
CURRENT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"

if [[ "${TRACEKEEPER_EXTERNAL_LOOPBACK_QA:-}" != "1" ]]; then
  printf 'External loopback QA requires TRACEKEEPER_EXTERNAL_LOOPBACK_QA=1.\n' >&2
  exit 2
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all)" ]]; then
  printf 'External loopback QA requires a completely clean candidate worktree.\n' >&2
  exit 3
fi

if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || [[ "$EXPECTED_SHA" != "$CURRENT_SHA" ]]; then
  printf 'TRACEKEEPER_CANDIDATE_SHA must equal the exact 40-character HEAD commit.\n' >&2
  exit 4
fi

printf 'Tracekeeper external loopback QA candidate: %s\n' "$CURRENT_SHA"
printf 'Runner: %s\n' "$(uname -srm)"
printf 'Node: %s\n' "$(node --version)"

(cd "$REPO_ROOT" && npm run test:loopback --workspace packages/mcp-runtime)
(cd "$REPO_ROOT" && npm run test:loopback --workspace apps/mcp-server)

printf 'Tracekeeper external loopback QA passed for %s.\n' "$CURRENT_SHA"
