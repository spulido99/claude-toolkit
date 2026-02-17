# Anti-Pattern Catalog

Common mistakes in deep agent design and how to fix them.

## Anti-Pattern 1: Parallel Decision-Making Subagents

**Symptom**: Multiple subagents work simultaneously and make incompatible choices.

**Example**:
```python
# ❌ BAD: Both work in parallel without coordination
subagents = [
    {"name": "ui-designer", "tools": [figma, sketch]},
    {"name": "frontend-dev", "tools": [react, vue]}
]
# Result: Designer chooses Material UI, dev implements Tailwind
```

**Fix**: Sequential execution or shared context
```python
# ✅ GOOD: Sequential with explicit handoff
subagents = [
    {
        "name": "design-lead",
        "description": "Defines design system FIRST, documents choices",
        "tools": [design_tools]
    },
    {
        "name": "implementation-engineer",
        "description": "Implements using documented design system",
        "tools": [code_tools],
        # Receives design decisions via file system
    }
]
```

## Anti-Pattern 2: God Agent

**Symptom**: Single agent with > 30 tools, poor tool selection.

**Example**:
```python
# ❌ BAD: Cognitive overload
main_agent = create_react_agent(
    tools=[
        web_search, db_query, email, slack, jira, github,
        s3, lambda, ec2, rds, api_1, api_2, ... api_50
    ]
)
```

**Fix**: Platform subagents
```python
# ✅ GOOD: Grouped capabilities
agent = create_react_agent(
    subagents=[
        {"name": "search-platform", "tools": [web, db, docs]},
        {"name": "communication-platform", "tools": [email, slack]},
        {"name": "devops-platform", "tools": [jira, github, aws]},
        {"name": "integration-platform", "tools": [api_1...api_50]}
    ]
)
```

## Anti-Pattern 3: Unclear Boundaries

**Symptom**: Overlapping responsibilities, confusion about routing.

**Example**:
```python
# ❌ BAD: Ambiguous descriptions
subagents = [
    {"name": "data-handler", "description": "Handles data"},
    {"name": "data-processor", "description": "Processes data"},
    {"name": "data-manager", "description": "Manages data"}
]
```

**Fix**: Clear, specific boundaries
```python
# ✅ GOOD: Distinct, measurable responsibilities
subagents = [
    {
        "name": "data-ingestion",
        "description": "Loads data from external sources (API, DB, files) into staging"
    },
    {
        "name": "data-transformation",
        "description": "Cleans, validates, and transforms data in staging to analytics format"
    },
    {
        "name": "data-quality",
        "description": "Monitors data quality metrics and generates alerts"
    }
]
```

## Anti-Pattern 4: Premature Decomposition

**Symptom**: Complex multi-agent system for simple problem.

**Example**:
```python
# ❌ BAD: Over-engineered for MVP
agent = create_react_agent(
    subagents=[
        {"name": "planning-agent"},
        {"name": "execution-agent"},
        {"name": "monitoring-agent"},
        {"name": "reporting-agent"}
    ]
)
# Task: Send a weekly email report
```

**Fix**: Start simple
```python
# ✅ GOOD: Single agent sufficient
agent = create_react_agent(
    tools=[query_data, generate_report, send_email]
)
# Add subagents only when cognitive load becomes problem
```

## Anti-Pattern 5: Leaky Abstractions

**Symptom**: Implementation details exposed in agent design.

**Example**:
```python
# ❌ BAD: Technical implementation focus
subagents = [
    {"name": "postgres-agent"},
    {"name": "redis-agent"},
    {"name": "s3-agent"}
]
```

**Fix**: Capability focus
```python
# ✅ GOOD: Business capability focus
subagents = [
    {"name": "user-data-platform", "tools": [postgres, redis]},
    {"name": "asset-storage-platform", "tools": [s3, cloudfront]}
]
```

## Anti-Pattern 6: Context Pollution

**Symptom**: Subagent context bleeds into main agent, defeating purpose.

**Example**:
```python
# ❌ BAD: Subagent returns massive context
def research_subagent(query):
    # Returns 50,000 tokens of research notes
    return massive_detailed_research
# Main agent context now polluted
```

**Fix**: Summarize at boundary
```python
# ✅ GOOD: Subagent returns concise summary
def research_subagent(query):
    # Conducts research, saves details to files
    save_to_file("/research/detailed_notes.md", full_research)
    # Returns only executive summary
    return create_summary(full_research, max_tokens=500)
```

## Anti-Pattern 7: Vocabulary Collision

**Symptom**: Same term means different things in different subagents.

**Example**:
```python
# ❌ BAD: "Revenue" has different meanings
marketing_agent: "Revenue = ad spend generating sales"
finance_agent: "Revenue = gross sales"
# Leads to miscommunication
```

**Fix**: Explicit bounded contexts
```python
# ✅ GOOD: Each context defines vocabulary
marketing_agent = {
    "system_prompt": """In marketing context:
    'Revenue' = attributed sales from campaign
    'Cost' = ad spend + overhead
    'ROI' = (Revenue - Cost) / Cost"""
}

finance_agent = {
    "system_prompt": """In finance context:
    'Revenue' = total gross sales
    'Cost' = COGS + operating expenses
    'Profit' = Revenue - Cost"""
}
```

## Anti-Pattern 8: One-Time Subagent

**Symptom**: Subagent created for single use, overhead not justified.

**Example**:
```python
# ❌ BAD: Subagent used once
calculator = {
    "name": "tax-calculator",
    "description": "Calculates sales tax",
    "tools": [tax_api]
}
# Used: 1 time
# Overhead: subagent spawning, context management
```

**Fix**: Direct tool use or library
```python
# ✅ GOOD: Simple tool in main agent
agent = create_react_agent(
    tools=[calculate_tax]  # Simple function, no subagent needed
)
```

## Anti-Pattern 9: Implicit Dependencies

**Symptom**: Subagents depend on each other in undocumented ways.

**Example**:
```python
# ❌ BAD: Hidden dependency
data_loader  # Expects data in format from data_cleaner
data_cleaner  # Expects schema from data_validator
# Dependencies not explicit
```

**Fix**: Explicit contracts
```python
# ✅ GOOD: Documented interfaces
data_loader = {
    "input_contract": "JSON with fields: id, timestamp, value",
    "output_contract": "DataFrame with validated schema"
}

data_cleaner = {
    "input_contract": "DataFrame from data_loader",
    "output_contract": "Cleaned DataFrame, outliers in /logs/"
}
```

## Anti-Pattern 10: No Evolution Path

**Symptom**: Agent architecture can't adapt to growth.

**Example**:
```python
# ❌ BAD: Hardcoded, inflexible
agent = create_react_agent(
    subagents=[agent1, agent2, agent3]  # Can't add more easily
)
```

**Fix**: Configuration-driven
```python
# ✅ GOOD: Configurable, scalable
config = load_agent_config("config.yaml")

agent = create_react_agent(
    subagents=[
        build_subagent(spec) for spec in config["subagents"]
    ]
)
# Easy to add/remove/modify subagents
```

## Anti-Pattern 11: Agent-as-Router

**Symptom**: Using agent intelligence only to route requests rather than take meaningful action.

**Example**:
```python
# ❌ BAD: Agent just classifies and routes
system_prompt = """Classify the user request and call the appropriate API:
- billing questions → call billing_api
- support questions → call support_api
- order questions → call orders_api"""
# Wastes agent intelligence on simple routing
```

**Fix**: Let agents take meaningful actions
```python
# ✅ GOOD: Agent handles the task end-to-end
system_prompt = """Handle customer requests:
- Answer billing questions using account data
- Resolve support issues by checking status and applying fixes
- Process orders with validation and confirmation
- Escalate complex issues with full context summary"""
```

## Anti-Pattern 12: Build-Then-Add-Agent

**Symptom**: Creating traditional features first, then exposing them as monolithic tools.

**Example**:
```python
# ❌ BAD: Monolithic feature exposed to agent
@tool
def generate_report(report_type: str) -> str:
    """Generate the specified report."""
    # 500 lines of logic agent can't influence or customize
    if report_type == "sales":
        return generate_sales_report()
    elif report_type == "inventory":
        return generate_inventory_report()
```

**Fix**: Design atomic tools from the start
```python
# ✅ GOOD: Agent composes the workflow
tools = [
    query_metrics,       # Agent chooses what to query
    aggregate_data,      # Agent decides grouping
    format_as_table,     # Agent picks format
    export_report,       # Agent chooses destination
]
# New report types = new prompts, not new code
```

## Anti-Pattern 13: Workflow-Shaped Tools

> **Relation to #12**: This is the tool-level manifestation of Anti-Pattern 12 (Build-Then-Add-Agent). #12 addresses system architecture; #13 addresses individual tool design. Both stem from not designing for agent composability.

**Symptom**: Tools bundle decision logic instead of being atomic primitives.

**Example**:
```python
# ❌ BAD: Tool makes all decisions internally
@tool
def smart_process_order(order: dict) -> dict:
    """Validates, checks inventory, calculates shipping, processes payment."""
    if not validate(order):
        return {"error": "invalid"}
    if not check_inventory(order):
        return {"error": "out of stock"}
    shipping = calculate_shipping(order)
    payment = process_payment(order, shipping)
    # Agent can't handle partial success, offer alternatives, or retry steps
    return {"success": True}
```

**Fix**: Keep tools atomic, let agent compose
```python
# ✅ GOOD: Agent controls the workflow
@tool
def validate_order(order: dict) -> dict:
    """Validate order structure and business rules."""

@tool
def check_inventory(items: list) -> dict:
    """Check stock availability for items."""

@tool
def calculate_shipping(address: dict, weight: float) -> dict:
    """Calculate shipping options and costs."""

@tool
def process_payment(amount: float, method: str) -> dict:
    """Process payment transaction."""

# Agent can: retry failed steps, skip optional steps,
# handle partial inventory, offer alternatives, customize flow
```

## Anti-Pattern 14: Orphan UI Actions

**Symptom**: Users can do things through UI that agents cannot achieve through tools.

**Example**:
```python
# ❌ BAD: UI has bulk actions with no agent equivalent
# Web UI: "Select all → Archive" (1 click, 100 items)
# Agent tools:
tools = [archive_item]  # Only single-item operation
# Agent must call archive_item() 100 times, or simply cannot do it
```

**Fix**: Ensure parity between UI and agent capabilities
```python
# ✅ GOOD: Agent has equivalent power
tools = [
    archive_item,              # Single item (atomic)
    archive_items_by_ids,      # Batch by selection
    archive_items_by_filter,   # Batch by criteria (most powerful)
]
# Agent can now match or exceed UI efficiency
```

## Anti-Pattern 15: Context Starvation

**Symptom**: Agent lacks knowledge of available resources and capabilities.

**Example**:
```python
# ❌ BAD: Agent doesn't know what's available
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[query_db, send_email, generate_report],
    prompt="You are a helpful assistant."
)
# Agent doesn't know: which DBs exist, email templates, report formats
# Results in constant clarification questions or wrong assumptions
```

**Fix**: Provide resource inventory in the system prompt
```python
# ✅ GOOD: Agent knows its resources via detailed prompt
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[query_db, send_email, generate_report],
    prompt="""You are a helpful assistant.

## Available Resources
- Databases: users_db, orders_db, analytics_db
- Email templates: /templates/welcome.html, /templates/receipt.html
- Report formats: PDF (default), CSV, JSON
- API limits: 100 requests/minute"""
)
```

---

## Anti-Pattern 16: Artificial Capability Limits

**Symptom**: Vague restrictions that prevent legitimate use cases without adding security.

**Example**:
```python
# ❌ BAD: Vague, overly restrictive
system_prompt = """You are a support agent.
DO NOT:
- Access sensitive data
- Make changes to accounts
- Process refunds over $50
- Do anything risky"""
# What counts as "sensitive"? "risky"? Agent becomes overly cautious.
```

**Fix**: Use `interrupt_on` for specific controls
```python
# ✅ GOOD: Specific controls with human approval
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-20250514",
    system_prompt="You are a support agent with full capabilities.",
    tools=[process_refund, delete_account, change_subscription, ...],
    checkpointer=MemorySaver(),
    interrupt_on={
        "tool": {"allowed_decisions": ["approve", "reject", "modify"]},
    },
)
# Agent can do anything, but sensitive actions pause for human approval
# No vague restrictions—clear, auditable controls
```

---

## Anti-Pattern 17: Using Low-Level API When High-Level is Appropriate

**Symptom**: Using `create_react_agent` (low-level, being deprecated) when `create_deep_agent` provides the needed functionality with less boilerplate.

**Example**:
```python
# ❌ BAD: Low-level API for a task that needs planning, subagents, and backends
from langgraph.prebuilt import create_react_agent

researcher = create_react_agent(
    model="openai:gpt-4o",
    tools=[web_search],
    prompt="You research topics.",
)

writer = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[write_doc],
    prompt="You write documents.",
)

# Manual agent-as-tool composition
coordinator = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[researcher, writer],
    prompt="Coordinate research and writing.",
    interrupt_before=["write_doc"],
)
# Missing: planning, filesystem backend, auto-summarization, AGENTS.md
```

**Fix**: Use `create_deep_agent` with native subagent dicts
```python
# ✅ GOOD: High-level API with built-in planning, backends, and subagents
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-20250514",
    system_prompt="Coordinate research and writing.",
    tools=[],
    subagents=[
        {"name": "researcher", "model": "openai:gpt-4o", "tools": [web_search], "system_prompt": "You research topics."},
        {"name": "writer", "tools": [write_doc], "system_prompt": "You write documents."},
    ],
    backend=FilesystemBackend("./workspace"),
    skills=["planning", "summarization"],
    interrupt_on={"tool": {"allowed_decisions": ["approve", "reject"]}},
)
```

**Reference**: See [API Cheatsheet](api-cheatsheet.md) for the complete API hierarchy.

---

## Anti-Pattern 18: Opaque Tool Responses

**Symptom**: Tools return raw data without context, forcing the agent to guess what to do next.

**Example**:
```python
# ❌ BAD: Raw data, no navigation, no formatted output
@tool
def get_balance(account_id: str) -> dict:
    """Get account balance."""
    return {"balance": 5000000, "currency": "PYG"}
# Agent doesn't know: what to show user, what to do next, how to format
```

**Fix**: Rich responses with navigation
```python
# ✅ GOOD: Structured response with context and navigation
@tool
def get_account_balances(include_details: bool = False) -> dict:
    """Consulta saldos de todas las cuentas.

    Usar cuando el usuario pregunte:
    - 'cuanto tengo?'
    - 'mi saldo'
    """
    return {
        "data": {"balance": 5000000, "currency": "PYG"},
        "formatted": "Saldo disponible: Gs. 5.000.000",
        "available_actions": ["get_transactions", "transfer_funds"],
        "message_for_user": "Tu saldo es Gs. 5.000.000"
    }
```

**Reference**: See [Tool Design](../../tool-design/SKILL.md) for the complete response pattern.

---

## Anti-Pattern 19: CRUD Tool Names

**Symptom**: Tools named after HTTP methods or database operations instead of business domain operations.

**Example**:
```python
# ❌ BAD: Generic CRUD naming — agent can't distinguish purpose
tools = [
    get_resource,       # Get what? From where?
    create_resource,    # Create what kind?
    update_resource,    # Update which aspect?
    delete_resource,    # Delete what? Is it reversible?
]
```

**Fix**: Domain-semantic naming
```python
# ✅ GOOD: Names describe business operations
tools = [
    get_account_balances,    # Clear: returns balances
    create_investment,       # Clear: opens investment
    update_account_alias,    # Clear: changes alias
    cancel_transfer,         # Clear: cancels transfer (not "delete")
]
```

**Key insight**: If you need to explain what the tool does beyond its name, the name needs improvement.

---

## Detection Checklist

Run through this checklist to identify anti-patterns (19 total):

**Classic Anti-Patterns (1-10):**
- [ ] Can subagents make conflicting decisions? (#1 Parallel Decision-Making)
- [ ] Does main agent have > 30 tools? (#2 God Agent)
- [ ] Is it unclear when to use each subagent? (#3 Unclear Boundaries)
- [ ] Are there subagents used only once? (#8 One-Time Subagent)
- [ ] Do subagents share tool assignments? (#5 Leaky Abstractions)
- [ ] Does vocabulary conflict across contexts? (#7 Vocabulary Collision)
- [ ] Is context still overflowing despite subagents? (#6 Context Pollution)
- [ ] Are there implicit dependencies? (#9 Implicit Dependencies)
- [ ] Is the architecture inflexible? (#10 No Evolution Path)
- [ ] Would a simple script work better? (#4 Premature Decomposition)

**Agent-Native Anti-Patterns (11-19):**
- [ ] Can agents do everything users can via UI? (#14 Orphan UI Actions)
- [ ] Are custom tools atomic, or do they bundle workflows? (#13 Workflow-Shaped Tools)
- [ ] Could a new feature be added via prompt alone? (#12 Build-Then-Add-Agent)
- [ ] Is the agent taking meaningful actions or just routing? (#11 Agent-as-Router)
- [ ] Does the agent know its available resources? (#15 Context Starvation)
- [ ] Are restrictions specific and enforceable via `interrupt_on`? (#16 Artificial Limits)
- [ ] Using `create_deep_agent` when planning/subagents/backends are needed? (#17 Low-Level API)
- [ ] Tool responses include `formatted` + `available_actions`? (#18 Opaque Responses)
- [ ] Tool names are domain-semantic, not generic CRUD? (#19 CRUD Names)
