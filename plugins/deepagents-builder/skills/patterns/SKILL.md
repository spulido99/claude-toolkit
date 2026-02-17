---
name: DeepAgents Patterns
description: This skill should be used when the user asks about "agent prompts", "system prompt design", "tool patterns", "anti-patterns", "agent best practices", "subagent prompts", or needs guidance on implementing effective prompts, tools, and avoiding common mistakes in DeepAgents.
---

# DeepAgents Implementation Patterns

Effective patterns for system prompts, tools, and common anti-patterns to avoid.

## System Prompt Structure

Every agent prompt should include:

```
[Role Definition]
[Context & Vocabulary]
[Workflow/Process]
[Decision Criteria]
[Tool Usage Guidance]
[Escalation/Stopping Criteria]
```

### `prompt=` parameter vs `context_schema` runtime context

Both provide instructions/context to the agent, but serve different purposes:

| Use `prompt=` parameter for | Use `context_schema` runtime context for |
|----------------------------|----------------------------------------|
| Core role definition | Per-request dynamic context |
| Hardcoded behavior | User-specific data (IDs, keys) |
| Subagent-specific logic | Session-specific settings |
| Static workflows | Runtime-injected variables |

**Context-driven approach** (recommended for production):

```python
from langgraph.prebuilt import create_react_agent
from langgraph.prebuilt import InjectedState
from dataclasses import dataclass
from typing import Annotated
from langchain_core.tools import tool

@dataclass
class AgentContext:
    tenant_id: str
    preferences: dict

@tool
def get_tenant_config(
    state: Annotated[dict, InjectedState],
) -> dict:
    """Get tenant-specific configuration from injected state."""
    return load_config(state.get("tenant_id"))

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[get_tenant_config],
    prompt="You are a support coordinator.",  # Static role
    context_schema=AgentContext,              # Dynamic context
)

result = agent.invoke(
    {"messages": [...]},
    context=AgentContext(tenant_id="t_123", preferences={"lang": "en"}),
)
```

The `prompt=` parameter defines the agent's static role and behavior. The `context_schema` injects per-request dynamic context accessible via `InjectedState` in tools.

> **Security Note**: Runtime context via `context_schema` is injected server-side and never exposed to the LLM as tool parameters. For customer-facing agents, see [Security for Customer-Facing Agents](#security-for-customer-facing-agents) to prevent prompt injection attacks.

## Prompt Patterns by Agent Type

> **Note**: The `system_prompt` key in the example config dicts below maps to the `prompt=` parameter when calling `create_react_agent`.

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

Delegates, doesn't execute. Uses the "agent as tool" pattern where subagents become tools for the parent:

```python
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

# Create specialist agents
inquiry_handler = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[kb_search, get_faq],
    prompt="You answer customer questions using the knowledge base.",
    name="inquiry-handler",
)

issue_resolver = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[lookup_issue, create_ticket],
    prompt="You resolve customer issues and create support tickets.",
    name="issue-resolver",
)

order_specialist = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[track_order, process_return],
    prompt="You handle order tracking and returns.",
    name="order-specialist",
)

# Parent coordinator uses subagents as tools
coordinator = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[inquiry_handler, issue_resolver, order_specialist],
    prompt="""You coordinate support operations.

## You Do NOT
- Answer questions directly (delegate to inquiry-handler)
- Resolve issues yourself (delegate to issue-resolver)
- Process orders yourself (delegate to order-specialist)

## You DO
- Understand full context
- Choose right specialist
- Synthesize results
- Recognize when to escalate

## Escalation Criteria
- Customer requests human
- Issue unresolved after 3 attempts
- Refund > $500""",
)
```

## Checkpointer & Human-in-the-Loop

### Enable Persistence

Use `MemorySaver` for conversation persistence and HITL:

```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    checkpointer=MemorySaver()  # Required for interrupt_before
)

# Use thread_id for conversation persistence
config = {"configurable": {"thread_id": "session-1"}}
result = agent.invoke({"messages": [...]}, config)
```

### Human-in-the-Loop for Sensitive Tools

```python
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[delete_database, read_database],
    checkpointer=MemorySaver(),
    interrupt_before=["delete_database"],  # Pause before destructive ops
)

# Agent pauses before delete_database, awaits human decision
config = {"configurable": {"thread_id": "session-1"}}
for event in agent.stream({"messages": [...]}, config, stream_mode="values"):
    if "__interrupt__" in event:
        # Review and approve or reject
        decision = input("Approve? (y/n): ")
        if decision == "y":
            agent.invoke(None, config)  # Resume execution
```

### Completion Signals

For task tracking, add an explicit signal tool:

```python
@tool
def signal_task_complete(task_id: str, summary: str) -> dict:
    """Explicitly signal task completion with summary."""
    return {"status": "completed", "task_id": task_id, "summary": summary}
```

**Avoid** heuristic completion detection (checking for "done" in responses). Explicit signals are reliable; pattern matching is fragile.

## Tool Design Patterns

### Naming Convention

Use `snake_case` for tool names:

```python
@tool
def search_knowledge_base(query: str) -> list[dict]:
    """Search customer support knowledge base."""
    pass
```

### Secure Tools with `context_schema` + `InjectedState` (Recommended)

Never pass user identifiers as parameters. Use `context_schema` with `InjectedState` for context injection:

```python
import os
from dataclasses import dataclass
from typing import Annotated
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from langgraph.prebuilt import InjectedState

@dataclass
class SecureContext:
    user_id: str
    api_key: str

# Bad: user_id as parameter (security risk)
@tool
def get_account_bad(user_id: str) -> str:
    """Insecure: user_id exposed to LLM."""
    pass

# Good: user_id from injected state context
@tool
def get_account_info(
    state: Annotated[dict, InjectedState],
) -> str:
    """Get account info using injected state."""
    # Access context from state - not visible to LLM
    user_id = state.get("user_id")
    return fetch_from_db(user_id)

# Create agent with context schema
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[get_account_info],
    context_schema=SecureContext,
)

# Invoke with context (not visible to LLM)
result = agent.invoke(
    {"messages": [...]},
    context=SecureContext(user_id="user_123", api_key=os.environ["SERVICE_API_KEY"]),
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

## Tool Granularity Principle

Custom tools should be atomic primitives, not workflow bundles. Let the agent compose them.

### Bad: Workflow-Shaped Tool

```python
@tool
def handle_customer_request(request: str) -> str:
    """Analyzes request, routes to department, executes action, sends response."""
    # Decision logic buried in tool—agent can't adapt
    category = analyze(request)
    if category == "billing":
        return billing_workflow(request)
    elif category == "support":
        return support_workflow(request)
    # Agent has no visibility or control
```

### Good: Atomic Primitives

```python
@tool
def classify_request(request: str) -> dict:
    """Classify customer request type and extract key details."""

@tool
def get_relevant_articles(category: str, keywords: list[str]) -> list[dict]:
    """Fetch knowledge base articles for category."""

@tool
def send_response(message: str, channel: str) -> bool:
    """Send response through specified channel."""

# Agent composes: classify -> get_articles -> formulate answer -> send
# Agent can skip steps, retry failures, or handle edge cases creatively
```

### Domain Tools as Shortcuts, Not Gates

Preserve atomic tools alongside domain-specific conveniences:

```python
tools = [
    query_database,           # Atomic: any query
    insert_record,            # Atomic: any table
    update_record,            # Atomic: any update
    # PLUS domain shortcuts
    get_customer_orders,      # Convenience: common query
    create_support_ticket,    # Convenience: common workflow
]
# Agent can use shortcuts for speed OR compose primitives for novel tasks
```

## Security Model

LangGraph uses a secure-by-default model. Implement security at tool/context level:

- **Never** expose user IDs, API keys, or credentials as tool parameters
- **Always** use `context_schema` + `InjectedState` for context injection
- **Configure** `interrupt_before` for destructive operations
- **Sandbox** agent execution for untrusted tasks

## Security for Customer-Facing Agents

When deploying agents to end users, the key risk is **Prompt Injection** -- a malicious user tricks the agent into performing unintended actions or leaking sensitive data.

**Recommended mitigation**: Use `context_schema` for per-user isolation and `InjectedState` to keep sensitive data out of LLM-visible parameters. Combine with `interrupt_before` for destructive operations.

```python
from langgraph.prebuilt import create_react_agent, InjectedState
from langgraph.checkpoint.memory import MemorySaver
from dataclasses import dataclass
from typing import Annotated
from langchain_core.tools import tool

@dataclass
class UserContext:
    user_id: str
    permissions: list[str]

@tool
def get_user_data(
    state: Annotated[dict, InjectedState],
) -> dict:
    """Get user data using injected context - user_id never exposed to LLM."""
    user_id = state.get("user_id")
    return fetch_user_data(user_id)

@tool
def delete_user_data(
    state: Annotated[dict, InjectedState],
    confirmation: str,
) -> dict:
    """Delete user data - requires human approval via interrupt."""
    if "admin" not in state.get("permissions", []):
        return {"error": "insufficient permissions"}
    return perform_deletion(state.get("user_id"))

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[get_user_data, delete_user_data],
    context_schema=UserContext,
    checkpointer=MemorySaver(),
    interrupt_before=["delete_user_data"],  # Human approval required
)

# Each user gets isolated context
result = agent.invoke(
    {"messages": [...]},
    context=UserContext(user_id="user_456", permissions=["read"]),
    config={"configurable": {"thread_id": "user_456_session"}},
)
```

### Security Checklist for Production

- [ ] Sensitive data injected via `context_schema`, never as tool parameters
- [ ] User context is isolated per-user (not shared)
- [ ] `interrupt_before` configured for destructive operations
- [ ] Rate limiting on agent invocations
- [ ] Tool permissions scoped per user role

For complete mitigation strategies (4 strategies), content validation, rate limiting, and audit logging implementations, see **[`references/security-patterns.md`](references/security-patterns.md)**.

## Anti-Patterns to Avoid

The most common mistakes: God Agent (> 30 tools in one agent), Unclear Boundaries (overlapping subagent responsibilities), Parallel Decision-Making (conflicting choices), Vocabulary Collision (same term means different things), and Premature Decomposition (over-splitting simple tasks).

For the complete catalog of 16 anti-patterns with code examples and fixes, see **[`references/anti-patterns.md`](references/anti-patterns.md)**.

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

- **[API Cheatsheet](references/api-cheatsheet.md)** - Current LangGraph API quick reference
- **[Prompt Patterns](references/prompt-patterns.md)** - 5 prompt patterns with templates
- **[Tool Patterns](references/tool-patterns.md)** - Complete tool design guide
- **[Anti-Patterns](references/anti-patterns.md)** - 16 anti-patterns with fixes
- **[Security Patterns](references/security-patterns.md)** - Security strategies for customer-facing agents

### Related Skills

- **[Quickstart](../quickstart/SKILL.md)** - Getting started with DeepAgents
- **[Architecture](../architecture/SKILL.md)** - Agent topologies and bounded contexts
- **[Evolution](../evolution/SKILL.md)** - Maturity model and refactoring
- **[Evals](../evals/SKILL.md)** - Testing and benchmarking
- **[Tool Design](../tool-design/SKILL.md)** - AI-friendly tool design principles

### Validation

Use `/validate-agent` to check for anti-patterns in your agent code.
