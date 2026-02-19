---
name: assess
description: Run a maturity assessment on your agent architecture. Scores across 4 categories and identifies the path to the next level.
allowed-tools:
  - Read
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[agent-path]"
---

# Assess Agent Maturity

Run the 80-point maturity assessment on an agent architecture.

## Workflow

### Step 1: Locate Agent Code

Find the agent to assess:

1. If `$ARGUMENTS` provides a path, use it directly
2. Otherwise, search for `create_agent` or `create_deep_agent` in:
   - `agent.py`, `main.py`, `src/**/*.py`, `agents/*/agent.py`
3. If multiple agents found, ask which to assess
4. If no agent found:
   ```
   No agent code found.
   → Run /new-sdk-app to scaffold a new DeepAgents project.
   ```
   Exit.

### Step 2: Trigger Evolution Guide

Hand off to the `evolution-guide` agent in **assessment mode** with:
- Agent file path
- Any context about the project structure

The evolution-guide will:
1. Extract the architecture profile (model, tools, subagents, checkpointer, etc.)
2. Score maturity across 4 categories (Structure, Operations, Measurement, Evolution)
3. Determine maturity level (1-5)
4. Detect red flags for the current level
5. Generate the full assessment report

### Step 3: Display Assessment and Suggest Commands

After the evolution-guide finishes, append:

```
Related commands:
  /evolve         — Guided refactoring to next level
  /validate-agent — Detailed anti-pattern and security check
  /tool-status    — Tool catalog quality dashboard
  /design-evals   — Scaffold eval suite (key for Level 4)
```
