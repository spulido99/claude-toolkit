---
name: eval-update
description: Review and accept/reject changed snapshots after intentional agent changes.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: ""
---

# Review Changed Snapshots

Interactive review of snapshots that have changed since they were last accepted.

## Workflow

### Step 1: Find Changed Snapshots

1. Read all snapshot files in `evals/__snapshots__/*.json`
2. Compute current `agent_hash` (from agent prompt + tool names)
3. Find snapshots where stored `agent_hash` doesn't match current hash
4. Also find snapshots that failed due to trajectory changes in last run (from `evals/.results/latest.json`)

If no changed snapshots:
```
All snapshots are current. Nothing to review.
```

### Step 2: Review Each Changed Snapshot

For each changed snapshot, present the change and ask for a decision:

```
1/N: {scenario_name}
  Change: {one-line description of what changed}
  Accept this change? [yes / no / diff]
```

**If user selects "diff"**: Show the full trajectory diff (old vs new), then ask again.

**If user selects "yes" (accept)**:
- Update the snapshot file with the new trajectory
- Update `agent_hash` to current
- Update `recorded_at` timestamp

**If user selects "no" (reject)**:
- Keep old snapshot unchanged
- Mark scenario as will-fail-until-fixed

### Step 3: Summary

After reviewing all changed snapshots:

```
Review complete:
  Accepted: N snapshots updated
  Rejected: N snapshots kept (scenarios will show as FAILED)

Rejected scenarios will fail until the agent behavior matches the old snapshot.
Run /eval to verify current state.
```
