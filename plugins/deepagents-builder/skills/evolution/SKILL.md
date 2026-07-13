---
name: DeepAgents Evolution
description: This skill should be used when the user asks to "improve agent architecture", "assess agent maturity", "refactor agents", "evolve agent system", "scale agent architecture", or needs guidance on measuring, improving, and evolving deep agent systems over time.
---

# DeepAgents Architecture Evolution

Assess, measure, and evolve agent architectures through maturity levels.

Maturity measures **engineering discipline — context, tools, and evals — orthogonal to topology**. A single agent with skills and evals can be Level 3-4; a multi-agent system without evals or telemetry is Level 1. Topology itself is decided by write coupling (see the [architecture skill](../architecture/SKILL.md)).

## Maturity Model Overview

| Level | Name | Characteristics |
|-------|------|-----------------|
| 1 | Initial | Large catalog with no disclosure, overlapping tools, no evals/telemetry |
| 2 | Managed | Bounded contexts packaged as skills, tool design applied, basic planning |
| 3 | Defined | Tool search operating, explicit contracts, topology justified by write coupling |
| 4 | Measured | Eval suites (tool-selection, HITL, disclosure) + telemetry driving decisions |
| 5 | Optimizing | Self-organizing, auto-optimization, A/B testing |

## Level Descriptions

### Level 1: Initial (Ad-Hoc)

**Symptoms:**
- Large tool catalog, no disclosure mechanism (no tool search, no skills)
- Overlapping tool names/descriptions; agent confused about tool selection
- Context window overflows
- No evals, no telemetry — even if the system has many subagents

```python
# Level 1 example — regardless of topology
agent = create_deep_agent(tools=[get_resource, get_data, fetch_resource, ...])
```

**Next step:** Tool design (consolidate/rename), package bounded contexts as skills

### Level 2: Managed (Basic Structure)

**Symptoms:**
- Bounded contexts identified and packaged as skills (progressive disclosure)
- Catalog consolidated, no overlapping names
- Basic planning (todos with instructed threshold)
- Writes concentrated in one agent

```python
# Level 2 example
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=consolidated_tools,
    skills=["./skills/"],
)
```

**Next step:** Tool search for the 10+ catalog, explicit contracts, documented vocabularies

### Level 3: Defined (Disclosed & Contracted)

**Symptoms:**
- Tool search / deferred loading operating (10+ tools or >10k tokens of definitions)
- Explicit contracts (tool inputs/outputs, skill scopes, worker summaries)
- Topology justified by write coupling; any subagents read-only and ~15x-justified
- File system / summarization for context management

```python
# Level 3 example — a single agent with skills can sit here (or Level 4 with evals)
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=consolidated_tools,
    middleware=[LLMToolSelectorMiddleware()],  # or ProviderToolSearchMiddleware
    skills=["./skills/"],
)
```

**Next step:** Build eval suites and telemetry

> **Tip**: Use `/design-evals` to scaffold your first eval dataset. This is the key step in reaching Level 4 (Measured).

### Level 4: Measured (Optimized)

**Symptoms:**
- Eval suites running: tool-selection accuracy, HITL/interrupt flows, disclosure behavior
- Telemetry tracked and driving decisions
- Automated regression testing (EDD workflow)

**Metrics to track:**
- Tokens per episode
- Cache hit rate
- Latency (per turn / per episode)
- Tool selection accuracy
- Subagent economics (does the episode value still pay ~15x?)

**Next step:** Implement evolutionary architecture

### Level 5: Optimizing (Evolutionary)

**Symptoms:**
- Self-organizing ecosystem
- Automatic capability detection
- Continuous optimization from telemetry

## Migration Paths

### Level 1 → 2: Package Bounds as Skills

1. Apply tool design: consolidate and rename overlapping tools
2. Identify bounded contexts and **package them as skills** (SKILL.md per context — NOT subagents)
3. Instruct a planning threshold (`write_todos` for 3+ dependent steps)
4. Verify writes are concentrated in one agent

### Level 2 → 3: Disclosure and Contracts

1. Add tool search / deferred loading (`middleware=` with `ProviderToolSearchMiddleware` or `LLMToolSelectorMiddleware`)
2. Make contracts explicit
3. Document vocabularies per bounded context
4. Justify topology against write coupling (~15x test for any subagent)

### Level 3 → 4: Measurement

1. Build eval suites: tool-selection, HITL/interrupts, disclosure behavior
2. Implement telemetry: cache hit rate, latency, tokens per episode
3. Establish the EDD loop (baseline before refactoring, regression after)

### Level 4 → 5: Automation

1. Automate telemetry-driven optimization
2. Externalize configuration
3. Enable A/B testing of recipes
4. Implement feedback loops

## Assessment Checklist

Score 0-5 for each (total 80 possible):

### Structure (20 points)
- [ ] Topology fit (matches write coupling; subagents read-only and ~15x-justified)
- [ ] Bounded contexts as skills
- [ ] Business capability alignment
- [ ] Explicit contracts

### Operations (20 points)
- [ ] Planning integration
- [ ] Context management (summarization for long horizon)
- [ ] Disclosure (tool search / progressive disclosure operating)
- [ ] Error handling

### Measurement (20 points)
- [ ] Telemetry (cache, latency, tokens per episode)
- [ ] Eval coverage (tool-selection, HITL, disclosure suites)
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
- Skills exist but the full catalog still loads up front
- Subagents created because the catalog grew
- Still context overflow

### Level 3 Red Flags
- Business users don't recognize structure
- Vocabulary conflicts
- Subagents holding coupled writes

### Level 4 Red Flags
- Metrics not driving decisions
- Performance not improving
- Manual testing only

## Refactoring Patterns

### Adopt Disclosure (first rung for large catalogs)

When the catalog reaches 10+ tools without tool search/skills:

```python
# Before: 25 tools, all definitions loaded every turn
agent = create_deep_agent(tools=[t1, ..., t25])

# After: same single agent, disclosure added
agent = create_deep_agent(
    tools=[t1, ..., t25],
    middleware=[LLMToolSelectorMiddleware()],  # or ProviderToolSearchMiddleware
    skills=["./skills/"],
)
```

### Extract Read-Only Worker

Only when read-only parallelizable work remains after tool design + disclosure, and the episode value pays ~15x:

```python
# Before: frontal agent doing heavy research inline
agent = create_deep_agent(tools=[*action_tools, web_search, read_docs])

# After: read-only deep worker; writes stay in the frontal agent
agent = create_deep_agent(
    tools=action_tools,
    subagents=[{"name": "research-worker", "tools": [web_search, read_docs]}]
)
```

### Inline Subagent

When a subagent isn't justified (used once, or fragments coupled writes):

```python
# Before: subagent holding a coupled write
subagents=[{"name": "payment-executor", "tools": [execute_payment]}]

# After: tool back in the frontal agent's thread
tools=[execute_payment]
```

### Merge Subagents

When workers are too granular:

```python
# Before: 10 tiny read-only workers
subagents=[{"name": "a", "tools": [t1]}, ...]

# After: consolidated workers
subagents=[
    {"name": "research-worker", "tools": [t1, t2, t3]},
]
```

## Additional Resources

### Reference Files

- **[Maturity Model](references/maturity-model.md)** - Complete maturity model with metrics
- **[Refactoring Patterns](references/refactoring-patterns.md)** - Detailed refactoring techniques

### Related Skills

- **[Quickstart](../quickstart/SKILL.md)** - Getting started with DeepAgents
- **[Architecture](../architecture/SKILL.md)** - Topology by write coupling, assistant pattern, bounded contexts
- **[Patterns](../patterns/SKILL.md)** - System prompts, tool design, anti-patterns
- **[Evals](../evals/SKILL.md)** - Evals-Driven Development with JTBD scenarios, trajectory evaluation, and snapshot testing

### Commands

- `/assess` — Run the 80-point maturity assessment with level determination and next-level recommendations
- `/evolve` — Guided refactoring to the next maturity level (interactive, step-by-step, with EDD checkpoints)
- `/validate-agent` — Quick anti-pattern and security check (simplified scoring)
