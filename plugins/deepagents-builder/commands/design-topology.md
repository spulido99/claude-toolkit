---
name: design-topology
description: Interactive guide to design agent topology based on business capabilities and Team Topologies principles.
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
argument-hint: "[domain/use-case]"
---

# Design Agent Topology

Guide the user through designing an optimal agent topology using Team Topologies principles.

## Workflow

### Step 1: Understand the Domain

Ask the user:

1. **What is the main purpose?** What will this agent system do?
2. **What tools/APIs?** What external systems will it interact with?

### Step 2: Tool Count Assessment

Ask the user to estimate tool count:

- **< 10 tools**: Recommend Simple Stream-Aligned (single agent)
- **10-30 tools**: Recommend Platform-Supported
- **> 30 tools**: Recommend Domain-Specialized or Hierarchical

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

### Step 4: Topology Selection

Based on analysis, recommend one of:

**Pattern 1: Simple Stream-Aligned**
- Single agent, no subagents
- < 10 tools
- Linear workflows

**Pattern 2: Platform-Supported**
- Platform subagents group related tools
- 10-30 tools
- Self-service consumption

**Pattern 3: Domain-Specialized**
- Subagents mirror business domains
- Distinct bounded contexts
- > 30 tools

**Pattern 4: Hierarchical**
- Multiple orchestration levels
- Enterprise complexity
- Mirrors org structure

### Step 5: Design Subagents

For each subagent, define:

1. **Name**: kebab-case identifier
2. **Description**: When to use this subagent (clear, specific)
3. **Tools**: Which tools it needs
4. **System Prompt**: Role, vocabulary, workflow, stopping criteria

### Step 6: Interaction Mode

Define how subagents interact:

| Mode | When to Use |
|------|-------------|
| X-as-a-Service | Stable, self-service consumption |
| Collaboration | Discovery phase, intensive back-and-forth |
| Facilitation | Knowledge transfer, temporary |

### Step 7: Generate Architecture Document

Save architecture to file with:

```yaml
---
topology: "[pattern-name]"
tool_count: [estimated]
created: "[date]"
---

# Agent Architecture: [Name]

## Overview
[Description]

## Subagents

### [subagent-1-name]
- **Description**: [when to use]
- **Tools**: [list]
- **Bounded Context**: [vocabulary]

### [subagent-2-name]
...

## Interaction Patterns
[How subagents communicate]

## Evolution Path
[Next steps for scaling]
```

### Step 8: Validation

Check for common issues:

- [ ] No overlapping responsibilities
- [ ] Clear routing decisions
- [ ] Appropriate cognitive load (3-10 tools per agent)
- [ ] Business stakeholders would recognize structure
- [ ] No anti-patterns (God Agent, Unclear Boundaries, etc.)
