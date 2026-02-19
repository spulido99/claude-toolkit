---
name: add-scenario
description: Add a single eval scenario to an existing dataset interactively or from a production trace.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[--from-trace <path-or-id>]"
---

# Add Eval Scenario

Add a single scenario to an existing eval dataset.

## Workflow

### Step 1: Parse Arguments

Check `$ARGUMENTS` for `--from-trace`:

- **`--from-trace <local-path>`**: Load a local trace file (JSON)
- **`--from-trace langsmith:<run_id>`**: Fetch trace from LangSmith
- **No arguments**: Interactive mode — ask user to describe the scenario

### Step 2: Find Existing Dataset

Locate the dataset to add to:

1. Search `evals/datasets/*.yaml` and `evals/datasets/*.json`
2. If multiple datasets exist, ask which one to add to
3. If no dataset exists, suggest running `/design-evals` first

### Step 3a: From Trace

If `--from-trace` was provided:

1. **Load trace**: Read the local JSON file or fetch from LangSmith
2. **Display conversation**: Show the user/assistant/tool turns
3. **Ask for expected behavior**: "This is what happened. What *should* have happened?"
   - Which tools should have been called?
   - What should the agent have responded?
   - Is this a regression (agent used to work) or a new capability needed?
4. **Generate scenario YAML**: Convert the trace into structured scenario format
   - Use actual tool calls as basis for `expected_tools`
   - Generate `mock_responses` from actual tool responses
   - Ask user for `success_criteria`
   - Tag as `regression` if it's a bug fix scenario
5. **Append to dataset**

### Step 3b: Interactive Mode

If no `--from-trace`:

1. Trigger the `eval-designer` agent in single-scenario mode
2. The designer asks:
   - "Describe what happened or what should happen"
   - "Which job does this relate to?" (show existing jobs)
   - "Is this a happy path, edge case, or failure scenario?"
3. Generate scenario YAML
4. Append to the appropriate job section in the dataset

### Step 4: Confirm and Suggest

```
Scenario '{name}' added to evals/datasets/{file}.yaml
Tags: [{tags}]

Next: Run /eval to generate the initial snapshot for this scenario.
```
