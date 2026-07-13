# Business Capability Mapping for Agents

Step-by-step guide to map business capabilities to an agent architecture.

## Overview

Business capabilities represent **what** an organization can do. Bounded contexts derived from them map onto the topology branch chosen by write coupling (see [topology-patterns.md](topology-patterns.md)): in the **assistant branch** (coupled writes — the default) each bounded context becomes a **skill** with progressive disclosure; in the **read-only fan-out branch** they may become read-only worker subagents.

## Step 1: Identify Business Capabilities

### Method: Capability Decomposition

Start with high-level business areas:

**Example: E-commerce Company**

```
Enterprise Capabilities
├── Customer Management
│   ├── Customer Acquisition
│   ├── Customer Support
│   └── Customer Retention
├── Product Management
│   ├── Catalog Management
│   ├── Pricing & Promotions
│   └── Inventory Management
├── Order Fulfillment
│   ├── Order Processing
│   ├── Warehouse Operations
│   └── Shipping & Delivery
└── Financial Operations
    ├── Payment Processing
    ├── Refunds & Credits
    └── Financial Reporting
```

### Capability Characteristics

A valid capability must:
1. **Describe "what" not "how"** - "Order Processing" not "Use Shopify API"
2. **Have clear outcomes** - "Successfully processed order"
3. **Be clearly defined** - Shared vocabulary
4. **Be mutually exclusive** - No overlap with other capabilities
5. **Be collectively exhaustive** - Cover all critical areas

## Step 2: Define Bounded Contexts

For each capability, apply the Bounded Context test:

### Test Questions

1. **Linguistic Boundary**: Does it have unique vocabulary?
   - Example: "Revenue" means different things in Marketing vs. Finance

2. **Expertise Boundary**: Does it require specialized knowledge?
   - Example: Risk modeling requires quantitative finance expertise

3. **Evolution Boundary**: Can it evolve independently?
   - Example: Payment processing regulations change separately from shipping

4. **Ownership Boundary**: Is there a natural owner/team?
   - Example: Customer Support owns support tickets

### Bounded Context Patterns

**Pattern A: One Capability = One Context**
```
Capability: Payment Processing
↓
Bounded Context: Payment Processing
└── Vocabulary: transaction, settlement, gateway
```

**Pattern B: Multiple Capabilities = One Context**
```
Capabilities: Catalog + Inventory + Pricing
↓
Bounded Context: Product Management
└── Vocabulary: SKU, stock, price
```

**Pattern C: One Capability = Multiple Contexts**
```
Capability: Customer Management
↓
├── Bounded Context: Support (tickets, issues)
├── Bounded Context: Marketing (campaigns, segments)
└── Bounded Context: Sales (leads, opportunities)
```

## Step 3: Map Bounded Contexts to the Topology

### Mapping Rules

The branch comes from write coupling (ADR / [topology-patterns.md](topology-patterns.md)), then bounded contexts map onto it:

| Business Pattern | Assistant branch (coupled writes — default) | Read-only fan-out branch |
|------------------|---------------------------------------------|--------------------------|
| Single capability | Flat tools on the frontal agent | — |
| Distinct bounded contexts | One **skill** per context (SKILL.md) | One read-only worker per independent area |
| Growing catalog (10+ tools) | Tool search / deferred loading | Tool search inside each worker |
| Read-heavy sub-episodes | Background deep workers (composition) | Parallel workers; writes stay in the lead |

### Example: E-commerce Assistant (coupled writes → skills, not subagents)

A conversational support agent's writes (refunds, order changes, tickets) depend on decisions in the same conversation — so one frontal agent holds every tool, and the bounded contexts become skills:

```python
# Capability: Customer Support — assistant pattern
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You handle customer support end-to-end: inquiries, issues, and orders.",
    tools=[
        kb_search, order_lookup, policy_docs,        # inquiries (read)
        diagnostic_tools, refund_process, ticket_system,  # issues (writes stay here)
        order_api, tracking_api, warehouse_system,   # orders (writes stay here)
    ],
    middleware=[LLMToolSelectorMiddleware()],  # 10+ tools -> tool search
    skills=["./skills/"],
    interrupt_on={"refund_process": {"allowed_decisions": ["approve", "reject"]}},
    checkpointer=MemorySaver(),
)
```

```
skills/
├── inquiries/SKILL.md   # 'Inquiry' = question needing answer; KB usage policy
├── issues/SKILL.md      # 'Issue' = problem; 'Resolution' = fix or compensation; escalation policy
└── orders/SKILL.md      # 'Order' = purchase transaction; 'Modification' = change before shipping
```

Read-only, parallelizable capabilities (e.g. market research across many sources) may instead become worker subagents on the fan-out branch — if the episode value pays the ~15x token overhead.

## Step 4: Validate Mapping

### Validation Checklist

✅ **Capability Coverage**
- Are all critical capabilities represented?
- Are there gaps in coverage?

✅ **Boundary Clarity**
- Can you explain when each skill applies (or when to dispatch each worker)?
- Is there overlap between contexts?

✅ **Vocabulary Consistency**
- Does each bounded context have consistent terminology?
- Are there conflicting definitions?

✅ **Topology Fit & Disclosure**
- Do all coupled writes live in one frontal agent?
- If the catalog is 10+ tools, is tool search / skills disclosure in place?

✅ **Business Alignment**
- Do subagents mirror business organization?
- Would business stakeholders recognize the structure?

### Common Issues

**Issue: Overlapping Responsibilities**
```
❌ Bad: Both "order-manager" and "fulfillment-handler" process orders
✅ Good: Clear separation - "order-manager" creates orders, 
         "fulfillment-handler" picks and ships
```

**Issue: Too Granular**
```
❌ Bad: 15 subagents each with 1-2 tools
✅ Good: 3-5 subagents with grouped capabilities
```

**Issue: Not Aligned with Business**
```
❌ Bad: Technical structure (db-agent, api-agent)
✅ Good: Business structure (billing-agent, support-agent)
```

## Step 5: Define Integration Points

### Context Map

Document how subagents interact:

```python
# Partnership: Equal collaboration
research_agent <-> analysis_agent: "Jointly discover insights"

# Customer-Supplier: Data flow
data_collector -> report_generator: "Provides processed data"

# Shared Kernel: Common components  
common_validation_tools: Used by [billing, orders, refunds]

# Anticorruption Layer: Translation needed
external_api -> internal_model: "Transform API format to internal"
```

### Interaction Modes by Context

```python
interactions = {
    "x-as-a-service": {
        "main" -> "data-platform": "Self-service data queries",
        "main" -> "email-platform": "Send notifications"
    },
    "collaboration": {
        "product-designer" <-> "engineer": "Temporary, discovery phase"
    },
    "facilitation": {
        "enabling-agent" -> "new-analyst": "One-time training"
    }
}
```

## Real-World Examples

### Example 1: SaaS Company

**Capabilities:**
- User Management (auth, profiles, permissions)
- Subscription Management (billing, plans, renewals)
- Feature Usage (metering, analytics, limits)
- Support Operations (tickets, chat, docs)

**Mapping:**
```python
agent = create_deep_agent(
    subagents=[
        {"name": "user-ops-platform", "tools": [auth, profiles, rbac]},
        {"name": "billing-platform", "tools": [stripe, subscriptions, invoices]},
        {"name": "analytics-platform", "tools": [metrics, reports, limits]},
        {"name": "support-specialist", "tools": [zendesk, chat, kb]}
    ]
)
```

### Example 2: Financial Services

**Capabilities:**
- Account Management
- Transaction Processing
- Risk Assessment
- Regulatory Compliance

**Mapping:**
```python
agent = create_deep_agent(
    subagents=[
        {"name": "account-manager", "tools": [account_api, balance]},
        {"name": "transaction-processor", "tools": [payment_gateway, ledger]},
        {"name": "risk-analyst", "tools": [scoring, fraud_detection]},
        {"name": "compliance-checker", "tools": [kyc, aml, reporting]}
    ]
)
```

## Advanced: Capability Maturity

Map capability maturity to agent sophistication:

| Maturity | Capability State | Agent Approach |
|----------|-----------------|----------------|
| Initial | Ad-hoc, reactive | Simple tools in main agent |
| Managed | Some process | Group tools into platform |
| Defined | Documented process | Dedicated subagent |
| Measured | Metrics tracked | Specialized subagent |
| Optimizing | Continuous improvement | Advanced subagent with ML |

## Template

Use this template for new mappings:

```python
# 1. List capabilities
capabilities = [
    "Capability A",
    "Capability B", 
    "Capability C"
]

# 2. Define bounded contexts
contexts = {
    "Context X": ["Capability A", "Capability B"],
    "Context Y": ["Capability C"]
}

# 3. Design subagents
subagents = [
    {
        "name": "context-x-platform",
        "description": "Handles capabilities A and B",
        "system_prompt": "Vocabulary for context X...",
        "tools": [tools_for_A, tools_for_B]
    },
    {
        "name": "context-y-specialist",
        "description": "Handles capability C",
        "system_prompt": "Vocabulary for context Y...",
        "tools": [tools_for_C]
    }
]
```
