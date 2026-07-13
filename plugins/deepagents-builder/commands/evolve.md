---
name: evolve
description: Guided refactoring to evolve your agent to the next maturity level. Assesses current state, recommends a refactoring pattern, and walks through implementation.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[agent-path] [--pattern <name>]"
---

# Evolve Agent Architecture

Guided refactoring to the next maturity level with before/after scoring.

## Arguments

- **agent-path**: Path to the agent file (optional, auto-detected if not provided)
- **--pattern**: Skip auto-recommendation, use a specific refactoring pattern:
  - `adopt-disclosure` — Add tool search + skills to a large catalog (first rung; single agent keeps the tools)
  - `extract-platform` — Extract read-only, parallelizable work into worker subagents (only if the episode value pays ~15x)
  - `split-context` — Split a subagent covering multiple domains
  - `merge-subagents` — Merge underutilized tiny subagents
  - `promote-main` — Promote a dominant subagent to main agent (also cures coupled writes held by a subagent)
  - `extract-specialist` — Extract a complex tool into its own specialist subagent
  - `add-enabling` — Add an enabling agent to fill capability gaps
  - `worker-disclosure` — Apply tool design + tool search inside a worker whose catalog grew
  - `parallel` — Convert sequential independent read-only tasks to parallel execution
  - `config-externalize` — Move hardcoded behavior to external configuration

## Workflow

### Step 1: Parse Arguments

Extract from `$ARGUMENTS`:
- Agent path (first non-flag argument)
- `--pattern <name>` (optional override)

### Step 2: Locate Agent Code

Find the agent to evolve:

1. If agent path provided, use it directly
2. Otherwise, search for `create_agent` or `create_deep_agent` in:
   - `agent.py`, `main.py`, `src/**/*.py`, `agents/*/agent.py`
3. If multiple agents found, ask which to evolve
4. If no agent found:
   ```
   No agent code found.
   → Run /new-sdk-app to scaffold a new DeepAgents project.
   ```
   Exit.

### Step 3: EDD Checkpoint

Before making any changes, check for existing evals:

1. Search for `evals/datasets/*.yaml` and `evals/datasets/*.json`
2. If eval datasets exist:
   ```
   Found eval dataset with N scenarios.
   Recommendation: Run /eval before refactoring to capture a baseline.

   Continue with refactoring or run evals first?
   ```
   Ask user to choose.
3. If no evals: note in output that evals should be created after refactoring.

### Step 4: Trigger Evolution Guide

Hand off to the `evolution-guide` agent in **refactoring mode** with:
- Agent file path
- `--pattern` value (if specified by user)
- Whether evals baseline was captured

The evolution-guide will:
1. Run abbreviated assessment (baseline score)
2. Recommend or apply the specified refactoring pattern
3. Guide step-by-step implementation with code changes
4. Re-score and show improvement delta

### Step 5: Post-Refactoring Summary

After the evolution-guide finishes:

```
Next steps:
  /eval    — Run evals to check for regressions
  /assess  — Full maturity reassessment
```
