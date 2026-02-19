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

```python
# User asks: "Send weekly stakeholder updates every Friday"
# Agent CREATIVELY composes tools not originally designed for this:
tools = [query_db, aggregate_metrics, generate_summary, send_email]

# Agent figures out a workflow:
# 1. Query project metrics from database
# 2. Aggregate into weekly summary
# 3. Generate human-readable report
# 4. Email to stakeholder list
# No "create_weekly_report" tool needed—agent composes existing tools!
```

### 5. Improvement Over Time

Applications enhance through accumulated context (`AGENTS.md`) and prompt refinement—not code rewrites.

```markdown
# Example: Agent learns from user feedback

## Before feedback
Agent generates text-only reports.

## User feedback
"Include chart images in reports"

## Agent updates AGENTS.md:
### Learned Preferences
- Reports should include visual charts
- Use generate_chart tool before send_email
- Chart style: bar charts for comparisons, line charts for trends
```

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
    backend=FilesystemBackend(root_dir="./"),  # Scope to project directory
    memory=[
        "~/.deepagents/AGENTS.md",      # Global preferences
        "./.deepagents/AGENTS.md",      # Project-specific context
    ],
    system_prompt="You are a project assistant."  # Minimal, AGENTS.md has the rest
)
```

> **Security Warning**: Never use `root_dir="/"` — it grants the agent read/write access to your entire filesystem. Always scope to the project directory or a dedicated workspace.

**Two levels of AGENTS.md:**

| File | Purpose |
|------|---------|
| `~/.deepagents/AGENTS.md` | Global: personality, style, universal preferences |
| `./.deepagents/AGENTS.md` | Project: architecture, conventions, team guidelines |

**Global AGENTS.md example** (`~/.deepagents/AGENTS.md`):

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

**For internal/trusted agents only:** The agent can update these files using `edit_file` when learning new preferences or receiving feedback. By default, treat `AGENTS.md` as read-only.

> **Security Note**: Writable `AGENTS.md` is appropriate for internal/trusted agents only. For customer-facing agents, see the [Security for Customer-Facing Agents](../patterns/SKILL.md#security-for-customer-facing-agents) section in patterns/SKILL.md to prevent Persistent Prompt Injection attacks.

### Long-Term Memory with CompositeBackend

For persistent memory across conversations, use `CompositeBackend` to route specific paths to durable storage:

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

agent = create_deep_agent(
    store=store,
    backend=CompositeBackend(
        default=StateBackend(),                         # Ephemeral by default
        routes={"/memories/": StoreBackend(store=store)},  # Persistent for /memories/
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
Clear domain boundaries?
  |-- Yes --> Domain-Specialized subagents
  |-- No --> Continue
         |
         v
     How many tools?
       |-- < 10 --> Single agent (no subagents)
       |-- 10-30 --> Platform subagents (group by capability)
       |-- > 30 --> Hierarchical decomposition
```

### Additional Decision Factors

Beyond tool count and domain boundaries, consider:

| Factor | Single Agent | Subagents |
|--------|--------------|-----------|
| **Latency** | Need sub-100ms response | Can tolerate delegation overhead |
| **Failure isolation** | All-or-nothing acceptable | Need independent failure domains |
| **Cost** | Token budget limited | Can afford summarization overhead |
| **Observability** | Simple tracing sufficient | Need per-domain visibility |

> **Note**: The 10/30 tool thresholds align with cognitive load research (7±2 items). Adjust based on tool complexity—10 simple tools may be fine, while 5 complex tools might warrant decomposition.

### Token Economy Considerations

Each subagent call creates a new LLM context (system prompt + task + tool schemas). Keep in mind:

| Pattern | Token Impact |
|---------|-------------|
| Each subagent delegation | ~2,000-5,000 tokens overhead per call |
| Hierarchical nesting (N levels) | N x single-call latency minimum |
| Parallel subagents | Multiplies cost by number of parallel agents |
| Large system prompts on high-frequency agents | Repeated on every API call |

**Tip**: Use the AGENTS.md file-first approach to load context once at session start rather than repeating it in every system prompt.

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

### Related Skills

For detailed patterns and implementation guidance:

- **[Patterns](../patterns/SKILL.md)** - Implementation patterns for prompts, tools, and security
- **[Anti-Patterns](../patterns/references/anti-patterns.md)** - 16 anti-patterns with fixes
- **[Quickstart](../quickstart/SKILL.md)** - Quick start guide with code examples
- **[Evolution](../evolution/SKILL.md)** - Maturity model and refactoring strategies
- **[Evals](../evals/SKILL.md)** - Evals-Driven Development — validate bounded contexts, measure token efficiency, hierarchical multi-agent evaluation

### Commands

Use `/design-topology` for interactive architecture design.
