---
name: DeepAgents Patterns
description: This skill should be used when the user asks about "agent prompts", "system prompt design", "tool patterns", "anti-patterns", "agent best practices", "subagent prompts", or needs guidance on implementing effective prompts, tools, and avoiding common mistakes in DeepAgents.
---

# DeepAgents Implementation Patterns

Effective patterns for system prompts, tools, and common anti-patterns to avoid.

## System Prompt Structure

Every subagent prompt should include:

```
[Role Definition]
[Context & Vocabulary]
[Workflow/Process]
[Decision Criteria]
[Tool Usage Guidance]
[Escalation/Stopping Criteria]
```

## Prompt Patterns by Agent Type

### Platform Subagent

Self-service, minimal context, reusable.

```python
{
    "name": "data-platform",
    "system_prompt": """You provide data access services.

## Available Services
- Query databases (SQL)
- Load files (CSV, JSON)
- Statistical analysis

## Service Standards
- Respond within 30 seconds
- Return data in JSON format
- Include data quality metrics

## When to Escalate
- Query requires > 1GB processing
- Data quality issues detected"""
}
```

### Domain Specialist

Deep expertise, specific vocabulary.

```python
{
    "name": "risk-analyst",
    "system_prompt": """You assess portfolio risk.

## Domain Context
- 'VaR' = potential loss at confidence level
- 'Volatility' = standard deviation of returns
- 'Beta' = correlation with market

## Workflow
1. Fetch portfolio data
2. Calculate risk metrics (VaR, Volatility, Beta)
3. Compare against benchmarks
4. Generate assessment with recommendations

## Risk Classification
- Low: VaR < 5%, Volatility < 15%
- Medium: VaR 5-15%, Volatility 15-30%
- High: VaR > 15%, Volatility > 30%

## When to Stop
- All metrics calculated
- Risk assessment complete"""
}
```

### Coordinator/Orchestrator

Delegates, doesn't execute.

```python
{
    "name": "support-coordinator",
    "system_prompt": """You coordinate support operations.

## Your Team
- inquiry-handler: Questions, information
- issue-resolver: Problems, complaints
- order-specialist: Orders, tracking

## You Do NOT
- Answer questions directly (delegate)
- Resolve issues yourself (delegate)
- Process orders yourself (delegate)

## You DO
- Understand full context
- Choose right specialist
- Synthesize results
- Recognize when to escalate

## Escalation Criteria
- Customer requests human
- Issue unresolved after 3 attempts
- Refund > $500"""
}
```

## Checkpointer & Human-in-the-Loop

### Enable Persistence

Use `MemorySaver` for conversation persistence and HITL:

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    tools=[...],
    checkpointer=MemorySaver()  # Required for interrupt_on
)

# Use thread_id for conversation persistence
config = {"configurable": {"thread_id": "session-1"}}
result = agent.invoke({"messages": [...]}, config)
```

### Human-in-the-Loop for Sensitive Tools

```python
agent = create_deep_agent(
    tools=[delete_database, read_database],
    checkpointer=MemorySaver(),
    interrupt_on={
        "delete_database": {
            "allowed_decisions": ["approve", "edit", "reject"]
        }
    }
)

# Agent pauses before delete_database, awaits human decision
for event in agent.stream({...}, config, stream_mode="values"):
    if "__interrupt__" in event:
        decision = input("Approve? (approve/reject): ")
        agent.update_state(config, {"decision": decision})
```

## Tool Design Patterns

### Naming Convention

Use `snake_case` for tool names:

```python
@tool
def search_knowledge_base(query: str) -> list[dict]:
    """Search customer support knowledge base."""
    pass
```

### Secure Tools with ToolRuntime (Recommended)

Never pass user identifiers as parameters. Use `ToolRuntime` for context injection:

```python
from dataclasses import dataclass
from langchain.tools import tool, ToolRuntime

@dataclass
class Context:
    user_id: str
    api_key: str

# Bad: user_id as parameter (security risk)
@tool
def get_account_bad(user_id: str) -> str:
    """Insecure: user_id exposed to LLM."""
    pass

# Good: user_id from runtime context
@tool
def get_account_info(runtime: ToolRuntime[Context]) -> str:
    """Get account info using secure runtime context."""
    user_id = runtime.context.user_id  # Injected, not from LLM
    return fetch_from_db(user_id)

# Create agent with context schema
agent = create_deep_agent(
    tools=[get_account_info],
    context_schema=Context
)

# Invoke with context (not visible to LLM)
result = agent.invoke(
    {"messages": [...]},
    context=Context(user_id="user_123", api_key="sk-...")
)
```

### Parameter Design

```python
@tool
def process_refund(
    amount: float,                    # Required, with units implied
    reason: str = "customer_request"  # Optional with default
) -> dict:
    """Process customer refund.

    Args:
        amount: Refund amount in USD
        reason: Reason for refund

    Returns:
        Refund confirmation with processing time
    """
    pass
```

### Return Values

Always return structured data:

```python
return {
    "status": "success",
    "data": {...},
    "metadata": {"processing_time": 0.5}
}
```

## Security Model

DeepAgents uses "trust the LLM" model. Implement security at tool/sandbox level:

- **Never** expose user IDs, API keys, or credentials as tool parameters
- **Always** use `ToolRuntime` for context injection
- **Configure** `interrupt_on` for destructive operations
- **Sandbox** agent execution for untrusted tasks

## Anti-Patterns to Avoid

### 1. God Agent (50+ tools)

```python
# Bad
agent = create_deep_agent(tools=[tool1, tool2, ..., tool60])

# Good: Group into platform subagents
agent = create_deep_agent(
    subagents=[
        {"name": "search-platform", "tools": [t1, t2, t3]},
        {"name": "analysis-platform", "tools": [t4, t5, t6]}
    ]
)
```

### 2. Unclear Boundaries

```python
# Bad: Ambiguous descriptions
{"name": "data-handler", "description": "Handles data"}
{"name": "data-processor", "description": "Processes data"}

# Good: Distinct responsibilities
{"name": "data-ingestion", "description": "Loads from external sources"}
{"name": "data-transformation", "description": "Cleans and validates"}
```

### 3. Parallel Decision-Making

```python
# Bad: Conflicting choices
# UI designer picks Material, dev implements Tailwind

# Good: Sequential with handoff
{"name": "design-lead", "description": "Defines design system FIRST"}
{"name": "implementer", "description": "Implements using documented system"}
```

### 4. Vocabulary Collision

```python
# Bad: "Revenue" means different things
marketing: "Revenue = ad-attributed sales"
finance: "Revenue = gross sales"

# Good: Explicit vocabulary in each context
{"system_prompt": "In marketing: Revenue = attributed sales..."}
{"system_prompt": "In finance: Revenue = total gross sales..."}
```

### 5. Premature Decomposition

```python
# Bad: 4 subagents for weekly email
agent = create_deep_agent(subagents=[planning, execution, monitoring, reporting])

# Good: Simple task = simple agent
agent = create_deep_agent(tools=[query_data, send_email])
```

## Prompt Checklist

Before finalizing a prompt:

- [ ] Role clearly defined
- [ ] Domain vocabulary specified
- [ ] Workflow/process outlined
- [ ] Decision criteria explicit
- [ ] Tool usage guided
- [ ] Stopping criteria clear
- [ ] Escalation conditions defined

## Tool Checklist

Before finalizing tools:

- [ ] `snake_case` naming
- [ ] Clear docstring with Args/Returns
- [ ] Explicit required parameters
- [ ] Sensible defaults for optional params
- [ ] Structured return values
- [ ] Error handling included

## Additional Resources

### Reference Files

For comprehensive patterns and examples:

- **`references/prompt-patterns.md`** - 5 prompt patterns with templates
- **`references/tool-patterns.md`** - Complete tool design guide
- **`references/anti-patterns.md`** - 10 anti-patterns with fixes

### Validation

Use `/validate-agent` to check for anti-patterns in your agent code.
