# Agent Topology Patterns

Detailed patterns for structuring deep agents based on Team Topologies and business architecture principles.

## Pattern 1: Simple Stream-Aligned

**When to use:** Single domain, < 10 tools, linear workflows

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-20250514",
    system_prompt="You are a research assistant...",
    tools=[web_search, summarize, report_writer]
)
```

**Characteristics:**
- No subagents
- Direct tool access
- Low cognitive load
- Fast iteration

## Pattern 2: Platform-Supported

**When to use:** 10-30 tools, clear capability grouping

```python
agent = create_deep_agent(
    system_prompt="You coordinate data analysis projects...",
    subagents=[
        {
            "name": "data-ingestion-platform",
            "description": "Loads data from various sources (DB, API, files)",
            "tools": [db_connector, api_client, file_parser]
        },
        {
            "name": "processing-platform",
            "description": "Transforms and cleans data",
            "tools": [clean, transform, validate]
        },
        {
            "name": "visualization-platform",
            "description": "Creates charts and dashboards",
            "tools": [plot, dashboard, export]
        }
    ]
)
```

**Characteristics:**
- Platform subagents group related capabilities
- Self-service consumption
- Reduces main agent cognitive load
- Reusable across tasks

## Pattern 3: Domain-Specialized

**When to use:** Multiple business domains, distinct vocabularies

```python
agent = create_deep_agent(
    system_prompt="You manage e-commerce operations...",
    subagents=[
        {
            "name": "inventory-manager",
            "description": "Manages product inventory and stock levels",
            "system_prompt": """You manage inventory. In your context:
            - 'Stock' = available units in warehouse
            - 'Reserved' = units in pending orders
            - 'Replenishment' = automatic reorder process""",
            "tools": [check_inventory, update_stock, forecast_demand]
        },
        {
            "name": "order-processor",
            "description": "Processes customer orders and fulfillment",
            "system_prompt": """You process orders. In your context:
            - 'Order' = customer purchase with line items
            - 'Fulfillment' = picking, packing, shipping
            - 'Status' = ordered → processing → shipped → delivered""",
            "tools": [create_order, assign_warehouse, generate_shipping]
        },
        {
            "name": "customer-service",
            "description": "Handles customer inquiries and issues",
            "system_prompt": """You provide customer service. In your context:
            - 'Ticket' = customer inquiry or complaint
            - 'Resolution' = issue fix or customer satisfaction
            - 'Escalation' = route to specialist or manager""",
            "tools": [kb_search, create_ticket, process_refund]
        }
    ]
)
```

**Characteristics:**
- Each subagent is a bounded context
- Separate vocabularies prevent confusion
- Can evolve independently
- Maps to business capabilities

## Pattern 4: Hierarchical Decomposition

**When to use:** Very complex domains, nested capabilities

```python
# Top-level orchestrator
main_agent = create_deep_agent(
    system_prompt="You coordinate enterprise operations...",
    subagents=[sales_department, operations_department, finance_department]
)

# Department-level sub-orchestrator
sales_department = {
    "name": "sales-operations",
    "description": "Manages all sales activities",
    "system_prompt": "You coordinate sales teams...",
    "tools": [crm_access],
    # Can itself have subagents
    "model": "openai:gpt-4o",
    "middleware": [
        SubAgentMiddleware(
            subagents=[
                {"name": "lead-generation", "tools": [...]},
                {"name": "deal-closing", "tools": [...]}
            ]
        )
    ]
}
```

**Characteristics:**
- Multiple levels of orchestration
- Mirrors organizational structure
- High complexity management
- Clear responsibility boundaries

## Pattern 5: Collaboration Mode

**When to use:** Discovery phase, unclear requirements

```python
agent = create_deep_agent(
    system_prompt="""You explore new product opportunities.
    Work collaboratively with research and design subagents during discovery.""",
    subagents=[
        {
            "name": "market-researcher",
            "description": "Investigates market trends and opportunities",
            "tools": [market_data, competitor_analysis]
        },
        {
            "name": "product-designer",
            "description": "Designs product concepts and features",
            "tools": [design_tools, user_testing]
        }
    ]
)

# Interaction mode: Collaboration (temporary, intensive)
# After discovery → transition to X-as-a-Service
```

**Characteristics:**
- Intensive back-and-forth between agents
- Temporary arrangement
- Transitions to platform mode after discovery
- Used for innovation, exploration

## Pattern 6: Enabling Mode

**When to use:** Capability gaps, onboarding, knowledge transfer

```python
agent = create_deep_agent(
    subagents=[
        {
            "name": "research-methodology-advisor",
            "description": "Provides one-time guidance on research best practices",
            "system_prompt": "You teach research methods...",
            "tools": [methodology_templates, example_studies]
        },
        # After transfer, main agent has capability
        # Enabling subagent not needed for subsequent tasks
    ]
)
```

**Characteristics:**
- Temporary assistance
- Knowledge transfer focus
- Moves on after capability established
- Not for ongoing operations

## Interaction Mode Decision Matrix

| Scenario | Interaction Mode | Duration | Example |
|----------|-----------------|----------|---------|
| Stable capability consumption | X-as-a-Service | Permanent | Data platform |
| New feature discovery | Collaboration | Temporary | Product development |
| Skill building | Facilitation | One-time | Research training |
| Complex subsystem | X-as-a-Service | Permanent | Financial calculations |

## Topology Selection Flowchart

> **Note**: This flowchart uses tool count as the primary selector. For an alternative approach that prioritizes domain boundaries first, see [architecture/SKILL.md](../SKILL.md#topology-decision-flow).

```
Start
  ↓
How many tools?
  ├─ < 10 → Simple Stream-Aligned
  ├─ 10-30 → Platform-Supported
  └─ > 30 → Continue
       ↓
Clear domain boundaries?
  ├─ Yes → Domain-Specialized
  └─ No → Continue
       ↓
Hierarchical structure?
  ├─ Yes → Hierarchical Decomposition
  └─ No → Re-evaluate boundaries
```

## Anti-Pattern Warning Signs

❌ Subagent used only once (overhead not justified)
❌ Overlapping tool assignments
❌ Unclear when to use which subagent
❌ Parallel subagents making independent decisions
❌ Context pollution despite subagent isolation

## Evolution Patterns

**Phase 1: MVP**
→ Simple stream-aligned

**Phase 2: Growth**
→ Add platform subagents for tool grouping

**Phase 3: Scale**
→ Domain-specialized subagents emerge

**Phase 4: Enterprise**
→ Hierarchical decomposition for complexity

See `refactoring-patterns.md` for migration strategies.
