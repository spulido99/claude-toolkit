---
name: eval
description: Run evals against your agent. Default snapshot mode. Use --smoke, --full, --report, or --diagnose for other modes.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
argument-hint: "[--smoke|--full|--report|--diagnose]"
---

# Run Evals

Execute eval scenarios against the agent and report results.

## Workflow

### Step 1: Parse Arguments

Determine run mode from `$ARGUMENTS`. Pick the mode that `${CLAUDE_PLUGIN_ROOT}/skills/evals/SKILL.md` § Run Modes assigns to the argument (no argument means snapshot mode).

### Step 2: Validate Setup

Before running:

1. Check `evals/datasets/` exists and has at least one dataset file
2. Check `evals/conftest.py` exists (agent discovery)
3. Check `evals/eval-config.yaml` exists (use defaults if not)

If setup is incomplete, suggest running `/design-evals` first.

### Step 3: Trigger Eval Runner

Hand off to the `eval-runner` agent with:
- Run mode (snapshot/smoke/full/report/diagnose)
- Dataset paths
- Configuration from `eval-config.yaml`

### Step 4: Display Results

The eval-runner returns results. Display them in the shape of Level 1 in `${CLAUDE_PLUGIN_ROOT}/skills/evals/references/03-dev-workflow.md` § Failure Investigation UX, and add by mode:

- **Report**: trajectory diffs for each failure (Level 2).
- **Diagnose**: LLM diagnosis with root cause and suggested fixes (Level 3).
- **Full**: Tier 2 results with LLM judge scores.

End each CHANGED scenario with `→ /eval-update to review and accept/reject`.
