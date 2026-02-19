---
name: eval-status
description: Show eval dataset health dashboard — scenario counts, snapshot staleness, last run results.
allowed-tools:
  - Read
  - Glob
  - Grep
argument-hint: ""
---

# Eval Status Dashboard

Show a health summary of the eval dataset without running any evals.

## Workflow

This command is lightweight — it reads files and reports stats. No agent needed.

### Step 1: Read Datasets

Find and read `evals/datasets/*.yaml` and `evals/datasets/*.json`:

- Count total scenarios
- Count scenarios by tag (`smoke`, `e2e`, `edge_case`, `error_handling`, `multi_agent`)
- Count scenarios by JTBD (job name)

### Step 2: Read Snapshots

Check `evals/__snapshots__/`:

- Count snapshot files
- For each snapshot, read `agent_hash`
- Compare against current agent hash (computed from agent prompt + tool names)
- Report: N current, N stale (hash mismatch)

### Step 3: Read Last Run Results

Read `evals/.results/latest.json` if it exists:

- Show: N passed / N failed / N changed
- Show: run date and duration
- Show: per-tag breakdown

### Step 4: Display Dashboard

```
═══ Eval Status ═══

Dataset: N scenarios
  smoke: N | e2e: N | edge_case: N | error_handling: N | multi_agent: N

JTBD Coverage:
  {job1}: N scenarios ✓
  {job2}: N scenarios ✓
  {job3}: N scenarios ✓

Snapshots: N current | N stale (agent changed since last snapshot)

Last Run: (date)
  ✓ N passed | ✗ N failed | ~ N changed
  Duration: Ns | Mode: {mode}

Commands:
  /eval          — Run evals (snapshot mode)
  /eval-update   — Review stale snapshots
  /add-scenario  — Add a new scenario
```

If no datasets exist:
```
No eval datasets found. Run /design-evals to get started.
```

If no run results exist:
```
No eval runs yet. Run /eval to generate initial snapshots.
```
