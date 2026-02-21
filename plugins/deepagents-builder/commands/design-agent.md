---
name: design-agent
description: Design a simple single agent interactively — role, tools, prompt, and model. Generates create_deep_agent(...) code. Escalates to /design-topology if complexity warrants multi-agent.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[agent-description]"
---

# Design Agent

Design a simple single agent interactively. Guides through role, tools, prompt, and model selection, then generates `create_deep_agent(...)` code. Escalates to `/design-topology` if complexity warrants a multi-agent architecture.

## Workflow

### Step 1: Detect Project Context

Search the workspace for an existing DeepAgents project:

1. Search for `create_deep_agent` in `agent.py`, `main.py`, `src/**/*.py`
2. Search for `pyproject.toml`, existing `@tool` functions, `prompts.py`
3. Report findings to the user

If no project is found, suggest running `/new-sdk-app` first. Continue in standalone mode if the user prefers.

### Step 2: Gather Agent Role

Determine what the agent will do:

1. If `$ARGUMENTS` is provided, parse the role description from it (skip the question)
2. Otherwise, ask: **"What will your agent do?"**
3. Extract from the answer: role name, primary actions, domain

### Step 3: Gather Tool Requirements

Ask the user: **"What tools or capabilities does this agent need?"**

Parse the response into a capability list and count them.

### Step 4: Escalation Check

This is a critical gate. Check whether the agent is too complex for a single-agent design. Triggers for escalation to `/design-topology`:

- More than 10 capabilities identified
- More than 2 distinct bounded contexts detected
- User mentions subagents, delegation, or coordinator patterns

If any trigger fires, present the choice:

1. **Escalate** — Switch to `/design-topology` for multi-agent architecture
2. **Continue** — Proceed with single-agent design anyway

### Step 5: Gather Configuration

Ask one question at a time:

1. **Model**: Which model? (default: `anthropic:claude-sonnet-4-5-20250929`)
2. **File access**: Does the agent need file access? If yes → include `FilesystemBackend`
3. **Safety**: Are any capabilities sensitive or destructive? If yes → configure `interrupt_on`
4. **Memory**: Should the agent use persistent memory via AGENTS.md? (default: no)

### Step 6: Design Agent

Delegate to agent-architect (Steps 1-5, simple case) to produce:

- **System prompt** with sections: Role, Context & Vocabulary, Workflow, Tool Usage, Stopping Criteria
- **Tool list** — names and descriptions for each capability
- **Model** — selected model string
- **Optional features** — backend, interrupt_on, memory, checkpointer

Present the full specification to the user for approval before generating code.

### Step 7: Generate Code

Based on the approved specification:

**If existing project detected (Step 1)**:
- Update `agent.py` with the new `create_deep_agent(...)` call
- Generate `prompts.py` with the system prompt constant
- Generate `tools.py` with `@tool` stubs for each capability

**If standalone (no project)**:
- Generate a single self-contained `agent.py` with everything inline

Code requirements:
- Use `system_prompt=` parameter (not `prompt=`)
- Include `MemorySaver()` as checkpointer
- Follow patterns from the quickstart skill

### Step 8: Confirm & Suggest Next Steps

Display a summary and suggest the EDD workflow:

```
Agent '{role_name}' designed and generated.
  File: {path} | Model: {model} | Tools: {n}

Next:
  /design-tools         — Implement tool stubs with AI-friendly design
  /add-tool             — Add tools one at a time
  /add-interactive-chat — Generate chat console for testing
  /design-evals         — Create eval scenarios (start EDD early)
```
