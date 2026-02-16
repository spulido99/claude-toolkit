# Business Capability Mapping for Agents

Step-by-step guide to map business capabilities to subagent architecture.

## Overview

Business capabilities represent **what** an organization can do. Subagents should mirror these capabilities to create natural, maintainable agent architectures.

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

## Step 3: Map to Subagent Topology

### Mapping Rules

| Business Pattern | Agent Pattern | Rationale |
|------------------|---------------|-----------|
| Single capability | No subagent | Main agent sufficient |
| 2-3 related capabilities | Platform subagent | Group for reuse |
| Distinct bounded contexts | Specialized subagents | Isolation needed |
| Hierarchical capabilities | Nested subagents | Mirror structure |

### Example: E-commerce Agent

```python
# Capability: Customer Support
# Bounded Context: Support Operations

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-20250514",
    system_prompt="You coordinate customer support operations...",
    
    subagents=[
        # Capability: Customer Inquiry
        {
            "name": "inquiry-handler",
            "description": "Answers customer questions about products, orders, and policies",
            "system_prompt": """You handle customer inquiries. In your context:
            - 'Customer' = person making purchase
            - 'Inquiry' = question needing answer
            - 'Knowledge Base' = FAQ and help docs""",
            "tools": [kb_search, order_lookup, policy_docs]
        },
        
        # Capability: Issue Resolution  
        {
            "name": "issue-resolver",
            "description": "Diagnoses and resolves customer problems and complaints",
            "system_prompt": """You resolve customer issues. In your context:
            - 'Issue' = problem preventing satisfaction
            - 'Resolution' = fix or compensation
            - 'Escalation' = route to specialist""",
            "tools": [diagnostic_tools, refund_process, ticket_system]
        },
        
        # Capability: Order Management (different bounded context!)
        {
            "name": "order-specialist",
            "description": "Manages order modifications, cancellations, and tracking",
            "system_prompt": """You manage orders. In your context:
            - 'Order' = purchase transaction
            - 'Status' = current fulfillment stage
            - 'Modification' = change before shipping""",
            "tools": [order_api, tracking_api, warehouse_system]
        }
    ]
)
```

## Step 4: Validate Mapping

### Validation Checklist

✅ **Capability Coverage**
- Are all critical capabilities represented?
- Are there gaps in coverage?

✅ **Boundary Clarity**
- Can you explain when to use each subagent?
- Is there overlap between subagents?

✅ **Vocabulary Consistency**
- Does each subagent have consistent terminology?
- Are there conflicting definitions?

✅ **Cognitive Load**
- Does each subagent have 3-10 tools?
- Is the main agent overloaded?

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
