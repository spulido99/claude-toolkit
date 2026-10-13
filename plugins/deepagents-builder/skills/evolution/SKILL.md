---
name: DeepAgents Evolution
description: Maturity model and refactoring patterns for deepagents agents. Use when assessing an existing agent's architecture or planning its refactor to the next level.
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

## Assessment

Score the 16 items (0-5 each, max 80) with the anchored rubric in [Maturity Model](references/maturity-model.md) § Maturity Assessment, map the total to a level with the same section, and check the red flags for that level in § Red Flags by Level.

## Refactoring Patterns

Pick the pattern that matches the problem (disclosure first, subagents last) and follow its before/after code and steps in [Refactoring Patterns](references/refactoring-patterns.md).

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
