# Tool Definition Patterns

Best practices for defining tools in deep agents.

## Core Principles

1. **Consistent naming**: Use `snake_case`
2. **Clear descriptions**: Explain purpose and use cases
3. **Explicit schemas**: Define all parameters clearly
4. **Default values**: Support optional parameters
5. **Required fields**: Mark mandatory parameters

## AI-Friendly Response Pattern

Tools should return structured responses with navigation:

```python
@tool
def get_account_balances(include_details: bool = False) -> dict:
    """Consulta saldos de todas las cuentas.

    Usar cuando el usuario pregunte:
    - 'cuanto tengo?'
    - 'mi saldo'

    Args:
        include_details: Incluir numero de cuenta y tipo
    """
    return {
        "data": [...],
        "formatted": "Tus cuentas:\n  - Cuenta PYG: Gs. 5.000.000",
        "available_actions": ["get_transactions", "transfer_funds"],
        "message_for_user": "Tus cuentas:\n  - Cuenta PYG: Gs. 5.000.000"
    }
```

See [Tool Design Skill](../../tool-design/SKILL.md) for complete AI-friendly tool design principles.

## CRITICAL: Security with ToolRuntime

**Never expose user IDs, API keys, or credentials as tool parameters.** The LLM can pass ANY value to tool parameters — this is a security vulnerability.

Use `ToolRuntime` from `langchain.tools` to inject secure context invisible to the LLM. This replaces the deprecated `InjectedState` and `InjectedStore` patterns.

### INSECURE: User ID as Parameter

```python
@tool
def get_user_data(user_id: str) -> dict:
    """Get user profile data."""
    # DANGER: LLM can pass ANY user_id, accessing other users' data!
    return fetch_from_db(user_id)

@tool
def send_email(api_key: str, to: str, body: str) -> bool:
    """Send email using provided API key."""
    # DANGER: API key exposed to LLM, can be logged or leaked!
    return send_via_api(api_key, to, body)
```

### SECURE: ToolRuntime Context Injection

```python
import os
from dataclasses import dataclass
from langchain.tools import tool, ToolRuntime
from deepagents import create_deep_agent

@dataclass
class SecureContext:
    user_id: str      # Current authenticated user
    api_key: str      # Service credentials
    tenant_id: str    # Multi-tenant isolation

@tool
def get_user_data(
    runtime: ToolRuntime[SecureContext],  # Invisible to LLM
) -> dict:
    """Get current user's profile data."""
    # SAFE: user_id from runtime context, not controllable by LLM
    user_id = runtime.context.user_id
    return fetch_from_db(user_id)

@tool
def send_email(
    to: str,
    body: str,
    runtime: ToolRuntime[SecureContext],  # Invisible to LLM
) -> bool:
    """Send email to specified recipient."""
    # SAFE: API key from context, user_id for audit
    return send_via_api(
        api_key=runtime.context.api_key,
        from_user=runtime.context.user_id,
        to=to,
        body=body
    )

# Create agent with context schema
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are an email assistant.",
    tools=[get_user_data, send_email],
    context_schema=SecureContext,
)

# Invoke with secure context (invisible to LLM)
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Send an email to john@example.com"}]},
    context=SecureContext(
        user_id="user_123",
        api_key=os.environ["SERVICE_API_KEY"],
        tenant_id="tenant_abc",
    ),
)
```

### Security Checklist

- [ ] No user identifiers as tool parameters
- [ ] No API keys/tokens as tool parameters
- [ ] Use `ToolRuntime` for sensitive context injection
- [ ] Use `interrupt_on` for destructive operations

### Preventing Context Leakage

Even with ToolRuntime, context can leak through error messages, logging, or return values:

```python
# BAD: Context leaks in error message
raise ValueError(f"Failed for user {runtime.context.user_id}")

# GOOD: Generic error, context in audit logs only
raise ValueError("Operation failed. Check audit logs for details.")

# BAD: Echoing context back to LLM
return {"user_id": runtime.context.user_id, "data": result}

# GOOD: Only return necessary data
return {"data": result}
```

## CRITICAL: Shell/Execute Tool Security

The built-in `shell` and `execute` tools are **extremely dangerous** for customer-facing agents. They enable:

- Command injection attacks
- File system read/write access
- Network access and data exfiltration
- Privilege escalation
- Container/sandbox escape

### Recommendation for Customer-Facing Agents

**Option 1: Disable Entirely (Recommended)**

Do not include `shell` or `execute` in your tools list for customer-facing agents.

**Option 2: Command Allowlisting**

If shell access is required, implement strict allowlisting:

```python
import shlex
import subprocess
from langchain.tools import tool, ToolRuntime
from typing import Annotated

ALLOWED_COMMANDS = ["ls", "cat", "grep", "wc", "head", "tail"]
BLOCKED_ARGS = ["--", "-c", "|", ";", "&", ">", "<", "`", "$"]

@tool
def safe_execute(
    command: str,
    runtime: ToolRuntime[SecureContext],  # Invisible to LLM
) -> dict:
    """Execute allowlisted commands only in sandboxed environment."""
    # Parse command safely
    try:
        cmd_parts = shlex.split(command)
    except ValueError as e:
        return {"error": f"Invalid command syntax: {e}"}

    if not cmd_parts:
        return {"error": "Empty command"}

    # Check command is allowlisted
    if cmd_parts[0] not in ALLOWED_COMMANDS:
        return {"error": f"Command not allowed: {cmd_parts[0]}"}

    # Check for dangerous arguments
    for arg in cmd_parts[1:]:
        for blocked in BLOCKED_ARGS:
            if blocked in arg:
                return {"error": f"Blocked argument pattern: {blocked}"}

    # Run in restricted sandbox
    try:
        result = subprocess.run(
            cmd_parts,
            capture_output=True,
            timeout=30,
            cwd="/sandbox",           # Restricted directory
            env={},                   # No environment inheritance
            user=65534,               # nobody UID
        )
        # TODO: Validate that resolved paths from cmd_parts stay within /sandbox
        # Use os.path.realpath() to resolve symlinks before checking prefix
        return {
            "stdout": result.stdout.decode()[:10000],  # Limit output size
            "stderr": result.stderr.decode()[:1000],
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out after 30 seconds"}
    except Exception as e:
        return {"error": f"Execution failed: {type(e).__name__}"}
```

**Option 3: Containerized Execution**

For maximum isolation, run commands in ephemeral containers with memory limits, no network access, and read-only filesystem. Use the Docker SDK (`docker-py`) or a sandboxing service like E2B, Modal, or Daytona.

### Shell Security Checklist

- [ ] `shell`/`execute` tools disabled for customer-facing agents
- [ ] If required: command allowlist implemented
- [ ] If required: dangerous argument patterns blocked
- [ ] If required: sandboxed execution environment
- [ ] If required: no environment variable inheritance
- [ ] If required: timeout configured
- [ ] If required: output size limited
- [ ] If required: network access disabled

## Pattern 1: Simple Tool

```python
from langchain.tools import tool

@tool
def search_products(query: str, max_results: int = 10) -> list[dict]:
    """Search product catalog for matching items.

    Args:
        query: Search terms (product name, category, or keywords)
        max_results: Maximum number of results to return (default: 10)

    Returns:
        List of products with id, name, price, description

    Example:
        search_products("wireless headphones", max_results=5)
    """
    # Implementation
```

## Pattern 2: Complex Tool with Nested Parameters

```python
@tool
def create_marketing_campaign(
    name: str,
    budget: float,
    duration_days: int = 30,
    targeting: dict | None = None
) -> dict:
    """Create a new marketing campaign with budget allocation.

    Args:
        name: Unique campaign name
        budget: Total budget in USD (minimum 100)
        duration_days: Campaign duration (default: 30, max: 365)
        targeting: Optional dict with age_range, interests, locations

    Returns:
        Campaign confirmation with ID and status
    """
```

## Pattern 3: Tool with Enum Values

```python
@tool
def analyze_sentiment(
    text: str,
    model: Literal["basic", "advanced", "multilingual"] = "basic"
) -> dict:
    """Analyze sentiment of text.

    Args:
        text: Text to analyze
        model: Analysis model to use
            - basic: Fast, English only
            - advanced: More accurate, English only
            - multilingual: Supports multiple languages

    Returns:
        {
            "sentiment": "positive" | "negative" | "neutral",
            "confidence": 0.0-1.0,
            "details": {...}
        }
    """
```

## Pattern 4: Tool with Validation

```python
@tool
def process_refund(
    order_id: str,
    amount: float,
    reason: str
) -> dict:
    """Process customer refund with validation.

    Args:
        order_id: Order ID (format: ORD-XXXXXX)
        amount: Refund amount in USD (must be <= order total)
        reason: Refund reason (customer_request, defective_product, etc.)

    Returns:
        {
            "refund_id": str,
            "status": "approved" | "pending" | "rejected",
            "message": str
        }

    Raises:
        ValueError: If order_id invalid or amount exceeds order total
    """
    if not order_id.startswith("ORD-"):
        raise ValueError(f"Invalid order_id format: {order_id}")

    # Additional validation...
```

## Tool Naming Conventions

| Type | Convention | Examples |
|------|------------|----------|
| Query/Fetch | `get_*`, `fetch_*`, `retrieve_*` | get_user_data, fetch_orders |
| Create | `create_*`, `add_*`, `insert_*` | create_campaign, add_product |
| Update | `update_*`, `modify_*`, `change_*` | update_inventory, modify_price |
| Delete | `delete_*`, `remove_*`, `cancel_*` | delete_account, remove_item |
| Search | `search_*`, `find_*`, `query_*` | search_products, find_users |
| Calculate | `calculate_*`, `compute_*` | calculate_tax, compute_metrics |
| Validate | `validate_*`, `check_*`, `verify_*` | validate_address, check_inventory |
| Send/Notify | `send_*`, `notify_*`, `email_*` | send_notification, email_receipt |

## Documentation Best Practices

### Good Tool Description

```python
"""Search customer database for users matching criteria.

Searches across name, email, phone, and custom fields. Supports
pagination for large result sets. Returns users with basic profile
data; use get_user_details() for complete information.

Args:
    query: Search terms (name, email, phone, or keywords)
    filters: Optional filters (signup_date, status, tags)
    limit: Maximum results (default: 50, max: 1000)
    offset: Pagination offset (default: 0)

Returns:
    {
        "users": [{"id", "name", "email", "created_at"}, ...],
        "total": int,
        "has_more": bool
    }

Example:
    search_users("john@example.com")
    search_users("premium", filters={"status": "active"}, limit=100)
"""
```

### Poor Tool Description

```python
"""Search for users."""  # Too vague
```

## Error Handling Patterns

```python
@tool
def api_call_with_retry(endpoint: str, max_retries: int = 3) -> dict:
    """Call external API with automatic retry logic.

    Handles common failures:
    - Transient network errors (auto-retry)
    - Rate limiting (exponential backoff)
    - Invalid credentials (immediate fail)

    Returns error dict if all retries exhausted:
    {"error": str, "code": str, "retries_attempted": int}
    """
```

## Tool Composition Patterns

### Pattern: Domain Shortcut (alongside atomic tools)

> **Note**: This is a convenience shortcut, not a replacement for atomic tools. Always provide the atomic primitives alongside shortcuts so the agent can compose custom flows. See [Anti-Pattern #13](anti-patterns.md) for why workflow-shaped tools that *replace* atomic tools are harmful.

```python
# Atomic tools (always available)
tools = [validate_data, perform_analysis, store_results]

# PLUS a convenience shortcut for the most common workflow
@tool
def analyze_and_store(data: dict) -> dict:
    """Shortcut: validate, analyze, and store in one call.

    For custom flows, use validate_data, perform_analysis,
    and store_results individually.
    """
```

### Pattern: Tool Family

```python
# Related tools with consistent interface
@tool
def db_query_sql(query: str, params: dict = {}) -> list[dict]:
    """Execute parameterized SQL query. Use ? placeholders for dynamic values. WARNING: Never concatenate user input into queries."""

@tool
def db_query_nosql(collection: str, filter: dict) -> list[dict]:
    """Execute NoSQL query on document database."""

@tool
def db_query_graph(cypher: str) -> list[dict]:
    """Execute Cypher query on graph database."""
```

## Performance Considerations

### Pattern: Async Tool

```python
import asyncio
from langchain.tools import tool

@tool
async def batch_process_items(items: list[str]) -> list[dict]:
    """Process multiple items in parallel for better performance.

    Processes up to 10 items concurrently. For > 100 items,
    consider using batch_process_large_set() instead.
    """
    tasks = [process_single_item(item) for item in items[:10]]
    return await asyncio.gather(*tasks)
```

### Pattern: Cached Tool

```python
from functools import lru_cache

@tool
@lru_cache(maxsize=100)
def get_static_reference_data(data_type: str) -> dict:
    """Fetch static reference data (cached for performance).

    Data types: countries, currencies, timezones, industries
    Cache size: 100 entries
    Cache TTL: Session-based (cleared on agent restart)
    """
```

## Tool Organization

### By Domain

```python
# Customer domain tools
tools_customer = [
    get_customer,
    search_customers,
    create_customer,
    update_customer
]

# Order domain tools
tools_order = [
    get_order,
    create_order,
    update_order_status,
    calculate_order_total
]

# Assign to subagents
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="Coordinate customer and order operations.",
    tools=[],
    subagents=[
        {"name": "customer-agent", "tools": tools_customer, "system_prompt": "Handle customers."},
        {"name": "order-agent", "tools": tools_order, "system_prompt": "Handle orders."},
    ],
)
```

### By Access Level

```python
# Read-only tools (safe, no approval needed)
tools_readonly = [
    get_data,
    search_records,
    calculate_metrics
]

# Write tools (require approval)
tools_write = [
    create_record,
    update_record,
    delete_record
]

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You manage records.",
    tools=tools_readonly + tools_write,
    interrupt_on={
        "tool": {"allowed_decisions": ["approve", "reject", "modify"]},
    },
)
```

## Testing Tools

```python
def test_search_products():
    """Test tool with various inputs."""
    # Normal case
    results = search_products("laptop", max_results=5)
    assert len(results) <= 5
    assert all("id" in r for r in results)

    # Edge cases
    assert search_products("") == []  # Empty query
    assert search_products("xyz123nonexistent") == []  # No results

    # Parameter validation
    with pytest.raises(ValueError):
        search_products("laptop", max_results=-1)
```

## Tool Definition Checklist

- Consistent `snake_case` naming
- Clear, comprehensive description
- All parameters documented
- Return type specified
- Defaults for optional parameters
- Required parameters marked
- Examples provided
- Error conditions documented
- Performance characteristics noted
- Related tools cross-referenced
