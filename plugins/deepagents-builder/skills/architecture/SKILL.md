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

## Agent-Native Principles

Design applications where agents are first-class citizens, not add-ons.

### 1. Parity

Whatever users can do through the UI, agents should achieve through tools.

```python
# ❌ BAD: UI has features agent cannot access
ui_features = ["bulk_delete", "export_csv", "advanced_filters"]
agent_tools = [delete_single_item]  # Missing capabilities

# ✅ GOOD: Full parity
agent_tools = [delete_items, export_data, search_with_filters]
```

### 2. Granularity

Tools should be atomic primitives. Features emerge from agents composing tools in loops—not bundled workflows.

```python
# ❌ BAD: Workflow bundled into single tool
@tool
def handle_order(order_id: str) -> str:
    """Validates, processes payment, ships, and emails."""
    # Agent can't customize or retry individual steps

# ✅ GOOD: Atomic primitives
tools = [validate_order, process_payment, create_shipment, send_notification]
# Agent composes and handles failures at each step
```

### 3. Composability

With atomic tools and parity, create new features by writing prompts—no code changes needed.

```python
# New "rush order" feature = prompt change, not code
system_prompt = """For rush orders:
1. validate_order with priority=high
2. process_payment immediately
3. create_shipment with express=True
4. send_notification with urgency=high"""
```

### 4. Emergent Capability

Agents accomplish unanticipated tasks by composing tools creatively. Design for discovery, not restriction.

### 5. Improvement Over Time

Applications enhance through accumulated context (`AGENTS.md`) and prompt refinement—not code rewrites.

## Data Architecture

### When to Use Files vs Databases

| Use Files For | Use Databases For |
|--------------|-------------------|
| Content users should read/edit | High-volume structured data |
| Configuration (version control) | Complex relational queries |
| Agent-generated reports | Ephemeral session state |
| Large text/markdown content | Data requiring indexes |

### Context Management with AGENTS.md

`AGENTS.md` files are **injected into the system prompt** at session start via the `memory` parameter. This is the file-first approach to providing persistent context.

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    backend=FilesystemBackend(root_dir="/"),
    memory=[
        "~/.deepagents/AGENTS.md",      # Global preferences
        "./.deepagents/AGENTS.md",      # Project-specific context
    ],
    system_prompt="You are a project assistant."  # Minimal, AGENTS.md has the rest
)
```

**Two levels of AGENTS.md:**

| File | Purpose |
|------|---------|
| `~/.deepagents/agent/AGENTS.md` | Global: personality, style, universal preferences |
| `.deepagents/AGENTS.md` | Project: architecture, conventions, team guidelines |

**Global AGENTS.md example** (`~/.deepagents/agent/AGENTS.md`):

```markdown
# Global Preferences

## Communication Style
- Tone: Professional, concise
- Format output as Markdown tables when showing data
- Always cite sources for claims

## Universal Coding Preferences
- Use type hints in Python
- Prefer functional patterns where appropriate
- Write tests for new functionality
```

**Project AGENTS.md example** (`.deepagents/AGENTS.md`):

```markdown
# Project Context

## Architecture
- FastAPI backend in /api
- React frontend in /web
- PostgreSQL database

## Conventions
- API endpoints follow REST naming
- Use Pydantic for validation
- Run `pytest` before committing

## Available Resources
- /data/reports/ - Historical reports
- /config/sources.json - Approved data sources
```

The agent can update these files using `edit_file` when learning new preferences or receiving feedback.

### Long-Term Memory with CompositeBackend

For persistent memory across conversations, use `CompositeBackend` to route specific paths to durable storage:

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    store=InMemoryStore(),
    backend=CompositeBackend(
        default=StateBackend(),                    # Ephemeral by default
        routes={"/memories/": StoreBackend()},     # Persistent for /memories/
    ),
    memory=["./.deepagents/AGENTS.md"],
    system_prompt="You have persistent memory. Write to /memories/ to remember across sessions."
)
```

| Path | Backend | Persistence |
|------|---------|-------------|
| `/memories/*` | StoreBackend | Cross-conversation |
| Everything else | StateBackend | Conversation only |

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
