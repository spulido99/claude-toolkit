---
name: DeepAgents Architecture
description: This skill should be used when the user asks to "design agent topology", "plan agent architecture", "create bounded contexts", "map business capabilities to agents", "organize subagents", or needs guidance on structuring multi-agent systems. Provides Team Topologies principles applied to AI agents.
---

# DeepAgents Architecture Design

Design production-ready agent architectures using Team Topologies principles.

## Core Principles

### 1. Capability-First Design

Design subagents based on **business capabilities**, not technical implementation.

```python
# Good: Capability-focused
{"name": "market-analyst", "description": "Analyzes market trends"}

# Bad: Implementation-focused
{"name": "postgres-agent", "description": "Queries PostgreSQL"}
```

### 2. Context Isolation (Bounded Contexts)

Each subagent operates within its own vocabulary and mental model.

```python
subagents = [
    {
        "name": "support-agent",
        "system_prompt": """In support context:
        - 'Ticket' = customer inquiry
        - 'Resolution' = issue fix
        - 'Escalation' = route to specialist"""
    },
    {
        "name": "billing-agent",
        "system_prompt": """In billing context:
        - 'Invoice' = payment request
        - 'Credit' = account adjustment
        - 'Subscription' = recurring charge"""
    }
]
```

### 3. Cognitive Load Management

| Tools | Recommended Architecture |
|-------|--------------------------|
| < 10 | Single agent, no subagents |
| 10-30 | Platform subagents (capability groups) |
| > 30 | Domain-specialized subagents |

## Agent Topologies

Based on Team Topologies, map to these agent types:

### Stream-Aligned (Main Orchestrator)

Primary agent that coordinates the workflow and delegates to specialists.

```python
agent = create_deep_agent(
    system_prompt="You coordinate customer operations...",
    subagents=[support, billing, orders]  # Delegates work
)
```

### Platform (Reusable Capabilities)

Self-service capabilities consumed by other agents.

```python
{
    "name": "data-platform",
    "description": "Provides data access services",
    "tools": [db_query, api_fetch, file_parse]
}
```

### Complicated Subsystem (Specialized Expertise)

Deep domain expertise requiring isolation.

```python
{
    "name": "risk-analyst",
    "description": "Calculates financial risk metrics",
    "system_prompt": "Expert in VaR, volatility, Sharpe ratio...",
    "tools": [risk_calculator, market_data]
}
```

### Enabling (Temporary Assistance)

Knowledge transfer, then steps back.

```python
{
    "name": "methodology-advisor",
    "description": "Teaches research methods",
    "system_prompt": "Guide others to self-sufficiency..."
}
```

## Topology Selection

```
Start
  |
  v
How many tools?
  |-- < 10 --> Simple: Single agent
  |-- 10-30 --> Platform: Group by capability
  |-- > 30 --> Continue
         |
         v
    Clear domain boundaries?
      |-- Yes --> Domain-Specialized
      |-- No --> Hierarchical Decomposition
```

## Design Process

### Step 1: Map Business Capabilities

```
Enterprise Capabilities
├── Customer Management
│   ├── Support
│   └── Retention
├── Order Fulfillment
│   ├── Processing
│   └── Shipping
└── Financial Operations
    ├── Billing
    └── Refunds
```

### Step 2: Define Bounded Contexts

For each capability, identify:
- Unique vocabulary
- Required expertise
- Can evolve independently?

### Step 3: Design Subagent Topology

Map capabilities to subagents:

| Business Pattern | Agent Pattern |
|------------------|---------------|
| Single capability | No subagent needed |
| 2-3 related capabilities | Platform subagent |
| Distinct bounded contexts | Specialized subagents |
| Hierarchical capabilities | Nested subagents |

### Step 4: Define Interaction Modes

```python
interactions = {
    "x-as-a-service": "Self-service consumption",
    "collaboration": "Temporary intensive work",
    "facilitation": "One-time knowledge transfer"
}
```

## Quick Patterns

### Pattern 1: Simple Stream-Aligned

```python
# < 10 tools, linear workflows
agent = create_deep_agent(
    tools=[search, summarize, report],
    system_prompt="You are a research assistant..."
)
```

### Pattern 2: Platform-Supported

```python
# 10-30 tools, clear capability groups
agent = create_deep_agent(
    subagents=[
        {"name": "data-platform", "tools": [db, api, files]},
        {"name": "analysis-platform", "tools": [stats, ml, viz]}
    ]
)
```

### Pattern 3: Domain-Specialized

```python
# > 30 tools, distinct business domains
agent = create_deep_agent(
    subagents=[
        {"name": "billing-specialist", "tools": [billing_api]},
        {"name": "support-specialist", "tools": [ticket_system]},
        {"name": "fulfillment-specialist", "tools": [warehouse_api]}
    ]
)
```

## Validation Checklist

Before finalizing architecture:

- [ ] Clear subagent boundaries (no overlap)
- [ ] Business capability alignment
- [ ] Distinct vocabularies per context
- [ ] Appropriate cognitive load (3-10 tools per agent)
- [ ] Stakeholders recognize the structure

## Additional Resources

### Reference Files

For detailed patterns and step-by-step guidance:

- **`references/topology-patterns.md`** - 6 topology patterns with examples
- **`references/capability-mapping.md`** - Complete capability mapping process

### Commands

Use `/design-topology` for interactive architecture design.
Use `/map-capabilities` to map business capabilities to agents.
