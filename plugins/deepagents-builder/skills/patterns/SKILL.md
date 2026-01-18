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

When deploying agents to end users, additional security measures are required.

### ⚠️ CRITICAL: AGENTS.md Write Protection

The pattern "agent can update AGENTS.md via `edit_file`" is **dangerous for customer-facing agents**. This creates a **Persistent Prompt Injection** vulnerability:

```
Malicious user → Tricks agent → Writes to AGENTS.md
→ Malicious content persists → Affects ALL future sessions
```

### Mitigation Strategies

#### Strategy 1: Read-Only AGENTS.md (Recommended)

```python
from deepagents import create_deep_agent

# Production: AGENTS.md is read-only, loaded via memory
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Read-only injection
    # Do NOT give edit_file access to AGENTS.md paths
)
```

#### Strategy 2: Separate User Memory from System Context

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend

# System context: read-only AGENTS.md
# User memory: isolated in /user_memory/ (per-user, not shared)
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # System context (read-only)
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            "/user_memory/": StoreBackend(),  # User-specific, isolated
        },
    ),
    system_prompt="""You can remember user preferences in /user_memory/.
    NEVER modify files in .deepagents/ directory."""
)
```

#### Strategy 3: Human Approval for Context Modifications

```python
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    checkpointer=MemorySaver(),
    interrupt_on={
        "edit_file": {
            "paths": ["**/AGENTS.md", "**/.deepagents/**"],
            "allowed_decisions": ["approve", "reject"]
        },
        "write_file": {
            "paths": ["**/AGENTS.md", "**/.deepagents/**"],
            "allowed_decisions": ["approve", "reject"]
        }
    }
)
```

#### Strategy 4: Content Validation Wrapper

```python
import re
from langchain_core.tools import tool

DANGEROUS_PATTERNS = [
    r"ignore.*(?:security|rules|restrictions)",
    r"bypass.*(?:checks|validation)",
    r"always.*(?:approve|allow|permit)",
    r"never.*(?:reject|deny|block)",
]

def validate_memory_content(content: str) -> bool:
    """Check for prompt injection attempts."""
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            return False
    return True

@tool
def safe_remember(key: str, value: str, runtime: ToolRuntime) -> dict:
    """Safely store user preference with validation."""
    if not validate_memory_content(value):
        return {"error": "Content validation failed", "stored": False}

    # Write to user-specific memory, not AGENTS.md
    path = f"/user_memory/{runtime.context.user_id}/{key}.txt"
    write_file(path, value)
    return {"stored": True, "path": path}
```

### Security Checklist for Production

Before deploying customer-facing agents:

- [ ] AGENTS.md is read-only (no edit_file access)
- [ ] User memory is isolated per-user (not shared)
- [ ] System context separated from user preferences
- [ ] `interrupt_on` configured for sensitive paths
- [ ] Content validation for any user-writable memory
- [ ] Audit logging for all file modifications
- [ ] Rate limiting on memory operations
- [ ] Regular review of stored user memories

### Architecture: System vs User Context

| Context Type | Storage | Writeable | Shared |
|-------------|---------|-----------|--------|
| System Prompt | Code | No | All users |
| AGENTS.md | File | No (prod) | All users |
| User Preferences | StoreBackend | Yes (validated) | Per-user |
| Session State | StateBackend | Yes | Per-session |

### Anti-Pattern: Shared Writable Context

```python
# ❌ DANGEROUS: All users can modify shared AGENTS.md
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],
    tools=[edit_file],  # Agent can modify AGENTS.md!
)
# One malicious user compromises ALL future sessions

# ✅ SAFE: User memory isolated, AGENTS.md read-only
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Read-only
    backend=CompositeBackend(
        default=StateBackend(),
        routes={f"/users/{user_id}/": StoreBackend()},  # Isolated
    ),
)
```

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
