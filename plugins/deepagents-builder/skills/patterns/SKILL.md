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

### system_prompt vs AGENTS.md

Both provide instructions that become part of the agent's system prompt:

| Use `system_prompt` for | Use `AGENTS.md` (via `memory`) for |
|------------------------|-----------------------------------|
| Core role definition | Persistent preferences |
| Hardcoded behavior | User-adjustable settings |
| Subagent-specific logic | Project context |
| Static workflows | Learnable patterns |

**File-first approach** (recommended for production):

```python
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Context from file
    system_prompt="You are a support coordinator."  # Minimal role
)
```

The content of `AGENTS.md` is injected into the system prompt at session start. The agent can update it using `edit_file` when learning new patterns.

> **Security Note**: Writable `AGENTS.md` is appropriate for internal/trusted agents only. For customer-facing agents, see [Security for Customer-Facing Agents](#security-for-customer-facing-agents) to prevent Persistent Prompt Injection attacks.

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

### Completion Signals

DeepAgents provides `write_todos` for task tracking. For custom completion needs, add an explicit signal tool:

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

### Secure Tools with ToolRuntime (Recommended)

Never pass user identifiers as parameters. Use `ToolRuntime` for context injection:

```python
import os
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
    context=Context(user_id="user_123", api_key=os.environ["SERVICE_API_KEY"])
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

### ❌ Bad: Workflow-Shaped Tool

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

### ✅ Good: Atomic Primitives

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

# Agent composes: classify → get_articles → formulate answer → send
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

DeepAgents uses "trust the LLM" model. Implement security at tool/sandbox level:

- **Never** expose user IDs, API keys, or credentials as tool parameters
- **Always** use `ToolRuntime` for context injection
- **Configure** `interrupt_on` for destructive operations
- **Sandbox** agent execution for untrusted tasks

## Security for Customer-Facing Agents

When deploying agents to end users, the key risk is **Persistent Prompt Injection** — a malicious user tricks the agent into writing adversarial instructions to AGENTS.md, affecting all future sessions.

**Recommended mitigation**: Make AGENTS.md **read-only** in production. Isolate user memory per-user using `StoreBackend`.

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, ReadOnlyBackend

agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Read-only injection
    backend=CompositeBackend(
        default=StateBackend(),
        routes={".deepagents/": ReadOnlyBackend()},  # Enforced read-only
    ),
)
```

### Security Checklist for Production

- [ ] AGENTS.md is read-only (no edit_file access)
- [ ] User memory is isolated per-user (not shared)
- [ ] `interrupt_on` configured for sensitive paths
- [ ] Rate limiting on memory operations

For complete mitigation strategies (4 strategies), content validation, rate limiting, and audit logging implementations, see **[`references/security-patterns.md`](references/security-patterns.md)**.

## Anti-Patterns to Avoid

The most common mistakes: God Agent (50+ tools in one agent), Unclear Boundaries (overlapping subagent responsibilities), Parallel Decision-Making (conflicting choices), Vocabulary Collision (same term means different things), and Premature Decomposition (over-splitting simple tasks).

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

- **`references/prompt-patterns.md`** - 5 prompt patterns with templates
- **`references/tool-patterns.md`** - Complete tool design guide
- **`references/anti-patterns.md`** - 16 anti-patterns with fixes
- **`references/security-patterns.md`** - Security strategies for customer-facing agents

### Validation

Use `/validate-agent` to check for anti-patterns in your agent code.
