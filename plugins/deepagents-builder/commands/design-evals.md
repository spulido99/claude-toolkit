---
name: design-evals
description: Design eval scenarios from JTBD. Scaffolds evals directory and generates scenario datasets for new or existing agents.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[agent-path]"
---

# Design Eval Scenarios

Guide the user through designing an eval suite using Evals-Driven Development (EDD).

## Workflow

### Step 1: Detect Context

Determine the project state:

1. **Find agent code**: Search for `create_agent` or `create_deep_agent` in:
   - `agent.py`, `main.py`, `src/agent.py`
   - `agents/*/agent.py` (multi-agent projects)
   - Path provided as argument: `$ARGUMENTS`
2. **Check for existing evals**: Look for `evals/` directory
3. **Detect multi-agent structure**: Look for `agents/` with subdirectories

Report findings to user:
- "Found agent at `agent.py` with 8 tools: [list]. No evals directory yet."
- "Found multi-agent project with coordinator, billing, shipping. Existing evals for billing."
- "No agent code found. We'll define scenarios from scratch — the dataset becomes your spec."

### Step 2: Scaffold Directory (If First Run)

If no `evals/` directory exists, create:

```
evals/
  datasets/
  __snapshots__/
  conftest.py
  eval-config.yaml
```

Generate `conftest.py` with the detected agent import. Generate default `eval-config.yaml`.

For multi-agent projects, scaffold per-agent `evals/` directories.

### Step 3: Trigger Eval Designer

Hand off to the `eval-designer` agent with context about:
- Agent tools and subagents (if code exists)
- Existing eval datasets (if any)
- Project structure (single vs multi-agent)

The eval-designer will:
1. Interview the user about JTBD
2. Generate happy path + edge case + failure scenarios per JTBD
3. Write scenario YAML to `evals/datasets/`

### Step 4: Show Summary

After the eval-designer finishes, display:

```
Created evals/datasets/{name}.yaml with N scenarios:
  - {job1}: M scenarios (happy path, edge cases, failures)
  - {job2}: M scenarios
  - {job3}: M scenarios

Tags: smoke(N) | e2e(N) | edge_case(N) | error_handling(N)

Next steps:
  1. Run /eval to generate initial snapshots
  2. Review scenarios and add more with /add-scenario
  3. Run /eval-status to check dataset health
```
