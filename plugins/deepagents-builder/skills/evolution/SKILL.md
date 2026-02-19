---
name: DeepAgents Evolution
description: This skill should be used when the user asks to "improve agent architecture", "assess agent maturity", "refactor agents", "evolve agent system", "scale agent architecture", or needs guidance on measuring, improving, and evolving deep agent systems over time.
---

# DeepAgents Architecture Evolution

Assess, measure, and evolve agent architectures through maturity levels.

## Maturity Model Overview

| Level | Name | Characteristics |
|-------|------|-----------------|
| 1 | Initial | Single agent, 40-60+ tools, frequent errors |
| 2 | Managed | 2-4 subagents, basic grouping, some overlap |
| 3 | Defined | Capability-aligned, bounded contexts, documented |
| 4 | Measured | Full topologies, metrics tracked, automated testing |
| 5 | Optimizing | Self-organizing, auto-optimization, A/B testing |

## Level Descriptions

### Level 1: Initial (Ad-Hoc)

**Symptoms:**
- Single agent with 40-60+ tools
- Agent confused about tool selection
- Context window overflows
- Inconsistent results

```python
# Level 1 example
agent = create_deep_agent(tools=[tool1, tool2, ..., tool60])
```

**Next step:** Identify tool groupings, create platform subagents

### Level 2: Managed (Basic Structure)

**Symptoms:**
- 2-4 subagents based on intuition
- Some capability separation
- Overlapping responsibilities
- Basic planning (todos)

```python
# Level 2 example
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    subagents=[
        {"name": "data-agent", "tools": [...]},
        {"name": "api-agent", "tools": [...]}
    ]
)
```

**Next step:** Map business capabilities, define bounded contexts

### Level 3: Defined (Capability-Aligned)

**Symptoms:**
- Subagents map to business capabilities
- Clear bounded contexts
- Documented interaction patterns
- File system for context management

```python
# Level 3 example
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    subagents=[
        {
            "name": "customer-support",
            "system_prompt": "In support context: 'ticket' = inquiry...",
            "tools": [support_kb, ticket_system]
        }
    ]
)
```

**Next step:** Apply Team Topologies, establish metrics

> **Tip**: Use `/design-evals` to scaffold your first eval dataset. This is the key step in reaching Level 4 (Measured).

### Level 4: Measured (Optimized)

**Symptoms:**
- Full Team Topologies (platform, enabling, specialist)
- Defined interaction modes
- Performance metrics tracked
- Automated testing

**Metrics to track:**
- Token efficiency (tokens/task)
- Subagent utilization
- Error rate
- Cognitive load (tools/agent)

**Next step:** Implement evolutionary architecture

### Level 5: Optimizing (Evolutionary)

**Symptoms:**
- Self-organizing ecosystem
- Automatic capability detection
- Dynamic subagent creation
- Continuous optimization

## Migration Paths

### Level 1 → 2: Basic Grouping

1. Group tools by theme (data, communication, analysis)
2. Create 2-3 basic subagents
3. Test with sample tasks
4. Measure cognitive load reduction

### Level 2 → 3: Capability Alignment

1. Map business capabilities
2. Define bounded contexts
3. Redesign subagents around capabilities
4. Document vocabularies
5. Establish interaction patterns

### Level 3 → 4: Measurement

1. Apply Team Topologies
2. Identify platform capabilities
3. Create enabling subagents
4. Implement metrics collection
5. Establish testing framework

### Level 4 → 5: Automation

1. Implement telemetry
2. Build optimization engine
3. Create capability discovery
4. Enable automatic refactoring
5. Implement A/B testing

## Assessment Checklist

Score 0-5 for each (total 80 possible):

### Structure (20 points)
- [ ] Clear subagent boundaries
- [ ] Business capability alignment
- [ ] Bounded context definition
- [ ] Topology variety

### Operations (20 points)
- [ ] Planning integration
- [ ] Context management
- [ ] Tool organization
- [ ] Error handling

### Measurement (20 points)
- [ ] Performance metrics
- [ ] Testing coverage
- [ ] Documentation
- [ ] Monitoring

### Evolution (20 points)
- [ ] Refactoring capability
- [ ] Learning from usage
- [ ] Experimentation
- [ ] Feedback loops

**Score interpretation:**
- 0-20: Level 1 (Initial)
- 21-40: Level 2 (Managed)
- 41-60: Level 3 (Defined)
- 61-80: Level 4+ (Measured/Optimizing)

## Red Flags by Level

### Level 1 Red Flags
- Context constantly overflowing
- Agent can't decide which tool
- Simple tasks take > 5 minutes

### Level 2 Red Flags
- Subagents rarely used
- Unclear routing decisions
- Still context overflow

### Level 3 Red Flags
- Business users don't recognize structure
- Vocabulary conflicts
- Can't add capabilities easily

### Level 4 Red Flags
- Metrics not driving decisions
- Performance not improving
- Manual testing only

## Refactoring Patterns

### Extract Subagent

When main agent is overloaded:

```python
# Before: 15 tools in main
agent = create_deep_agent(tools=[t1, t2, ..., t15])

# After: Extract platform
agent = create_deep_agent(
    tools=[t1, t2, t3],
    subagents=[{"name": "platform", "tools": [t4, ..., t15]}]
)
```

### Inline Subagent

When subagent used only once:

```python
# Before: Subagent for single use
subagents=[{"name": "calculator", "tools": [calc]}]

# After: Tool in main agent
tools=[calc]
```

### Split Subagent

When subagent covers multiple domains:

```python
# Before: Mixed responsibilities
{"name": "data-handler", "tools": [ingest, clean, visualize]}

# After: Separated concerns
{"name": "data-ingestion", "tools": [ingest]},
{"name": "data-visualization", "tools": [visualize]}
```

### Merge Subagents

When subagents are too granular:

```python
# Before: 10 tiny subagents
subagents=[{"name": "a", "tools": [t1]}, ...]

# After: Consolidated platforms
subagents=[
    {"name": "data-platform", "tools": [t1, t2, t3]},
    {"name": "analysis-platform", "tools": [t4, t5, t6]}
]
```

## Additional Resources

### Reference Files

- **[Maturity Model](references/maturity-model.md)** - Complete maturity model with metrics
- **[Refactoring Patterns](references/refactoring-patterns.md)** - Detailed refactoring techniques

### Related Skills

- **[Quickstart](../quickstart/SKILL.md)** - Getting started with DeepAgents
- **[Architecture](../architecture/SKILL.md)** - Agent topologies and bounded contexts
- **[Patterns](../patterns/SKILL.md)** - System prompts, tool design, anti-patterns
- **[Evals](../evals/SKILL.md)** - Evals-Driven Development with JTBD scenarios, trajectory evaluation, and snapshot testing

### Commands

- `/assess` — Run the 80-point maturity assessment with level determination and next-level recommendations
- `/evolve` — Guided refactoring to the next maturity level (interactive, step-by-step, with EDD checkpoints)
- `/validate-agent` — Quick anti-pattern and security check (simplified scoring)
