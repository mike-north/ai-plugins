#!/usr/bin/env bash
# git-context.sh - Gather git diff context for code review
# Usage: git-context.sh [stat|diff|nx-affected]
set -euo pipefail

MODE="${1:-all}"

merge_base() {
  git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo "HEAD~1"
}

BASE=$(merge_base)

case "$MODE" in
  stat)
    git diff --stat "${BASE}" 2>/dev/null || echo "No diff available — ensure you have commits on a feature branch"
    ;;
  diff)
    git diff "${BASE}" 2>/dev/null || echo "No diff available"
    ;;
  nx-affected)
    if [[ -f "nx.json" ]]; then
      npx nx show projects --affected --base="$BASE" 2>/dev/null || echo "Nx affected detection failed"
    else
      echo "N/A - not an Nx workspace"
    fi
    ;;
  *)
    echo "Usage: git-context.sh [stat|diff|nx-affected]"
    exit 1
    ;;
esac
