#!/usr/bin/env bash
# Test harness for aws-cdk-patterns skill retrieval.
#
# Runs every scenario in tests/scenarios.txt in two phases:
#   RED   — without the skill loaded (baseline)
#   GREEN — with only dev-patterns loaded via --plugin-dir
#
# Writes per-scenario results + diffs to a timestamped results directory.
# A human reviews the diffs against success criteria in the design spec.
#
# Isolation strategy:
#   RED phase uses --disable-slash-commands (documented as "Disable all skills"
#   in `claude -p --help`). If that flag proves insufficient in a given
#   environment (i.e., it only disables slash invocation, not auto-discovery),
#   fall back to pointing --plugin-dir at an empty directory and using
#   --setting-sources project so user-level plugin settings do not load.
#
# IMPORTANT: Do not run this script from inside an active Claude Code session.
# `claude -p` spawned from within another Claude Code session deadlocks on
# interactive prompts (OAuth, permissions, etc.). Run from a plain shell.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/dev-patterns"
SCENARIOS_FILE="$PLUGIN_DIR/tests/scenarios.txt"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="/tmp/aws-cdk-skill-test-$TIMESTAMP"
WORKSPACE="/tmp/aws-cdk-skill-workspace-$TIMESTAMP"

mkdir -p "$RESULTS_DIR"/{red,green,diff}
mkdir -p "$WORKSPACE"

if [[ ! -f "$SCENARIOS_FILE" ]]; then
  echo "Error: scenarios file not found at $SCENARIOS_FILE" >&2
  exit 1
fi

if [[ ! -d "$PLUGIN_DIR/skills/aws-cdk-patterns" ]]; then
  echo "Error: aws-cdk-patterns skill directory not found at $PLUGIN_DIR/skills/aws-cdk-patterns" >&2
  exit 1
fi

mapfile -t SCENARIOS < "$SCENARIOS_FILE"

echo "Running ${#SCENARIOS[@]} scenarios"
echo "Results: $RESULTS_DIR"
echo "Workspace: $WORKSPACE"
echo ""

cd "$WORKSPACE"

for i in "${!SCENARIOS[@]}"; do
  idx=$(printf "%02d" $((i+1)))
  prompt="${SCENARIOS[$i]}"
  echo "=== Scenario $idx ==="
  echo "Prompt: $prompt"

  echo "  RED phase..."
  claude -p --disable-slash-commands "$prompt" \
    > "$RESULTS_DIR/red/scenario-$idx.txt" 2>&1 || true

  echo "  GREEN phase..."
  claude -p \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    "$prompt" \
    > "$RESULTS_DIR/green/scenario-$idx.txt" 2>&1 || true

  diff -u \
    "$RESULTS_DIR/red/scenario-$idx.txt" \
    "$RESULTS_DIR/green/scenario-$idx.txt" \
    > "$RESULTS_DIR/diff/scenario-$idx.diff" 2>&1 || true

  red_bytes=$(wc -c < "$RESULTS_DIR/red/scenario-$idx.txt")
  green_bytes=$(wc -c < "$RESULTS_DIR/green/scenario-$idx.txt")
  echo "  RED:   $red_bytes bytes"
  echo "  GREEN: $green_bytes bytes"
  echo ""
done

echo "All scenarios complete."
echo "Review diffs at: $RESULTS_DIR/diff/"
