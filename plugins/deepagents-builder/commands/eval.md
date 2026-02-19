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

Determine run mode from `$ARGUMENTS`:

| Argument | Mode | Description |
|----------|------|-------------|
| (none) | Snapshot | Compare trajectories against snapshots. Fast, free. |
| `--smoke` | Smoke | Only `@smoke`-tagged scenarios. Fastest. |
| `--full` | Full | Tier 2 simulated users + strong LLM judge. Pre-merge. |
| `--report` | Report | Re-run + show trajectory diffs for failures. |
| `--diagnose` | Diagnose | Re-run + LLM analysis of failures with suggestions. |

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

The eval-runner returns results. Display based on mode:

**Snapshot/Smoke**:
```
✓ N passed | ✗ N failed | ~ N changed

FAILED: {scenario_name}
  Expected: [tools...]
  Actual:   [tools...]
  → /eval --report for diff | /eval --diagnose for analysis

CHANGED: {scenario_name}
  {one-line diff description}
  → /eval-update to review and accept/reject
```

**Report**: Include trajectory diffs for each failure.

**Diagnose**: Include LLM diagnosis with root cause and suggested fixes.

**Full**: Include Tier 2 results with LLM judge scores.
