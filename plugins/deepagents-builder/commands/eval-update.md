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

### Step 1: Trigger Eval Runner

Hand off to the `eval-runner` agent in update mode (its Step 9). It finds the snapshots whose `agent_hash` no longer matches the agent, asks the user to accept or reject each one, and updates the snapshot files.

### Step 2: Show Summary

Display the accepted and rejected counts the eval-runner returns, or "All snapshots are current. Nothing to review." if there was nothing to review.
