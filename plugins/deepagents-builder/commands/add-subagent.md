---
name: add-subagent
description: Add a single subagent to an existing agent architecture interactively or by named capability.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[--capability <name>]"
---

# Add Subagent

Add a single subagent to an existing agent architecture, matching existing topology patterns and conventions.

## Workflow

### Step 1: Parse Arguments

Check `$ARGUMENTS` for mode:

- **`--capability <name>`**: Shortcut mode — skip discovery questions, pre-fill capability name
- **No arguments**: Interactive mode — ask user to describe the new capability

### Step 2: Find Existing Agent

Locate the current agent definition:

1. Search for `create_deep_agent` in `agent.py`, `main.py`, `src/**/*.py`, `agents/**/*.py`
2. If `create_react_agent` found instead → warn about Anti-Pattern 17 (wrong framework), suggest `/evolve` instead
3. Multiple matches → ask which agent via AskUserQuestion
4. No matches → exit with redirect:

```
No existing DeepAgents agent found.
→ Run /new-sdk-app to scaffold a new agent project.
→ Run /design-topology to plan a full architecture first.
```

### Step 3: Analyze Current Architecture

Parse the existing agent configuration:

1. Extract `subagents=[]` list: names, descriptions, tool lists, system_prompt structure, model overrides
2. Detect topology pattern (assistant / read-only fan-out / hybrid — see the architecture skill)
3. Extract naming convention (kebab-case suffixes like `-specialist`, `-platform`)
4. Extract prompt style (section headings used in existing system_prompts)
5. Note each subagent's tool list and whether any tool is write-capable

Before proceeding, apply the **write-coupling guard** (agent-architect Step 8.1b): the new capability must be read-only, parallelizable work whose episode value pays the ~15x token overhead. If it writes in a thread coupled with the main agent's decisions, recommend keeping it as tools on the main agent (with tool search if the catalog is 10+) or packaging the domain as a skill instead.

Report summary to user:
```
Architecture: {topology_pattern}
Subagents: {count} ({names})
Naming convention: {suffix_pattern}
Prompt style: {section_headings}
```

If **no subagents exist**, present options via AskUserQuestion:
1. Add the first subagent anyway (proceed)
2. Run `/design-topology` to plan full architecture first
3. Run `/evolve --pattern extract-platform` for guided refactoring

### Step 4: Gather Requirements

Ask one question at a time via AskUserQuestion:

1. **What business capability?** (skip if `--capability` was provided)
2. **What subagent type?** Options: stream-aligned / platform / complicated-subsystem / enabling
3. **What tools does it need?** Cross-check against existing tool catalog for reuse and conflicts
4. **Different model from main agent?** Default: inherit from orchestrator

### Step 5: Design Subagent

Delegate to `agent-architect` in **Phase 8 (incremental mode)** with the architecture profile and gathered requirements.

The agent produces:

- **Complete subagent dict** (name, description, system_prompt, tools, optional model)
- **Routing impact analysis** (ambiguity check against existing subagents)
- **Boundary verification** (vocabulary collision check)
- **Cognitive load verification** (3-10 tools guideline)

Present the full specification for user approval before writing any code.

### Step 6: Generate Code

After user approval:

1. **Insert subagent dict** into existing `subagents=[]` list, matching the formatting style of existing entries
2. **If tools don't exist**: scaffold `domains/{domain}/tools.py` with `@tool` stubs and `TOOLS = [...]` export
3. **First-subagent case**: offer to update orchestrator's system_prompt with a delegation section explaining when to route to the new subagent

### Step 7: Verify & Connect to EDD

Run inline anti-pattern checks on the updated architecture:

| Check | Severity | Trigger |
|-------|----------|---------|
| One-Time Subagent | warn | New subagent has only 1 tool |
| Unclear Boundaries | error | Description overlaps with existing subagent |
| Vocabulary Collision | warn | Same domain terms used across subagents |
| God Agent | error | Any agent reaches 10+ tools without tool search/skills |
| Fragmented Writes | error | New subagent holds write-capable tools coupled to the main thread |
| Premature Decomposition | warn | Total < 10 tools with 2+ subagents |

Output confirmation:

```
Subagent '{name}' added to {path}
Type: {type} | Tools: {n}
Anti-pattern checks: PASS

Next:
  /add-scenario     — Add eval scenarios for new capabilities
  /validate-agent   — Full architecture scan
  /add-tool         — Implement placeholder tools (if scaffolded)
```
