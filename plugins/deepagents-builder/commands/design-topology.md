---
name: design-topology
description: Interactive guide to design agent topology based on write coupling — single frontal agent (assistant pattern) by default, subagents only for read-only parallelizable work.
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
argument-hint: "[domain/use-case]"
---

# Design Agent Topology

Guide the user through designing an agent topology. The first-order decision variable is **write coupling** (see the architecture skill's [assistant pattern](${CLAUDE_PLUGIN_ROOT}/skills/architecture/references/assistant-pattern.md) and [topology patterns](${CLAUDE_PLUGIN_ROOT}/skills/architecture/references/topology-patterns.md)) — never tool count, never the interaction regime.

## Workflow

### Step 1: Understand the Domain

Ask the user:

1. **What is the main purpose?** What will this agent system do?
2. **What tools/APIs?** What external systems will it interact with?

### Step 2: Episodes and Write Coupling (first bifurcation)

Ask the user to describe the **episodes** — units of work between human input and result (a conversational turn, or a full autonomous run). Then read the decision questions in `${CLAUDE_PLUGIN_ROOT}/skills/architecture/SKILL.md` § Topology Decision and ask the user each one in order, using the answers to choose the branch.

### Step 3: Capability Mapping

Guide through capability decomposition:

1. List all business capabilities the agent needs
2. Group related capabilities
3. Identify distinct vocabularies (bounded contexts)

Present as tree structure:

```
Capabilities
├── [Capability Group 1]
│   ├── Sub-capability A
│   └── Sub-capability B
└── [Capability Group 2]
    ├── Sub-capability C
    └── Sub-capability D
```

### Step 4: Domain Bounds

Map the bounded contexts found in Step 3 onto the branch chosen in Step 2, using the mapping table in `${CLAUDE_PLUGIN_ROOT}/skills/architecture/SKILL.md` § Design Process, Step 3 (Map Bounded Contexts to the Topology Branch). Protect the skills library with `permissions` deny-write on the assistant branch.

### Step 5: Topology Selection

Based on Steps 2–4, recommend the pattern that matches the user's answers, choosing among the patterns described in `${CLAUDE_PLUGIN_ROOT}/skills/architecture/SKILL.md` § Agent Topologies (assistant pattern, read-only fan-out, deep-worker hybrid) and showing the matching code skeleton from § Quick Patterns.

### Step 6: Design Components

**For the assistant branch**, define:
1. **Frontal agent**: system prompt (role, workflow, write ownership, `write_todos` threshold)
2. **Skills**: one per bounded context — name, vocabulary, flows, policies
3. **Interrupts**: which tools require approval (`interrupt_on`; note: top-level config is inherited only by declarative subagent dicts, not `CompiledSubAgent`/remote)
4. **Deep workers** (if hybrid): ONE general-purpose read-only worker to start; name, description, read-only tool list

**For the fan-out branch**, define for each worker subagent:
1. **Name**: kebab-case identifier
2. **Description**: when to delegate (clear, specific, no overlap)
3. **Tools**: read-only tools it needs
4. **System Prompt**: role, vocabulary, workflow, summary format it returns

### Step 7: Generate Architecture Document

Save architecture to file with:

```yaml
---
topology: "[assistant | read-only-fan-out | hybrid]"
write_coupling: "[coupled | read-only-parallelizable]"
interaction_regime: "[conversational | autonomous]"  # descriptive only
tool_catalog: "[count / ~tokens; tool search: yes/no]"
created: "[date]"
---

# Agent Architecture: [Name]

## Overview
[Description]

## Episodes and Write Coupling
[Which writes exist, why they are (not) coupled — the topology rationale]

## Frontal Agent
- **Tools**: [list; tool search mechanism if 10+]
- **Interrupts**: [tools requiring approval]

## Skills (bounded contexts)

### [skill-1-name]
- **Vocabulary**: [terms]
- **Policies/flows**: [summary]

## Deep Workers / Worker Subagents (if any)

### [worker-name]
- **Description**: [when to dispatch]
- **Tools**: [read-only list]
- **Economic justification**: [why the episode value pays ~15x]

## Evolution Path
[Next steps: tool design → tool search → skills → workers]
```

### Step 8: Validation

Validate the design against the checklist in `${CLAUDE_PLUGIN_ROOT}/skills/architecture/SKILL.md` § Validation Checklist, and report each item as pass or fail with the fix for each failure.
