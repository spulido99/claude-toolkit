---
name: AI-Friendly Tool Design
description: This skill should be used when the user asks to "design tools", "create tools for agent", "tool design", "API to tools", "define tools", "convert API to tools", or needs guidance on designing AI-friendly tools for agents. Provides principles from AI-Friendly API Design, Agent Native architecture, and real-world tool catalogs.
---

# AI-Friendly Tool Design

Design tools that agents can discover, understand, and compose effectively. These 10 principles bridge API design with agent-native architecture to produce tools that work seamlessly in LLM-driven workflows.

## Principle 1: Semantic Clarity Over CRUD

Name tools by **domain operation**, not HTTP method or CRUD pattern. The agent selects tools based on name and description — generic names cause confusion and misrouting.

```python
# Bad: Generic CRUD name — agent can't distinguish from dozens of "get" tools
@tool
def get_resource(resource_type: str, resource_id: str) -> dict:
    """Get a resource by type and ID."""
    pass

# Good: Domain-specific name — agent knows exactly when to use it
@tool
def get_account_balances(account_id: str) -> dict:
    """Retrieve current balances for all sub-accounts (checking, savings, credit).

    Usar cuando el usuario diga: "check my balance", "how much do I have",
    "account balance", "what's in my account".

    Returns:
        Balances by sub-account with currency and as-of timestamp.
    """
    pass
```

**Rule of thumb**: If the tool name makes sense as a sentence completion for "I need to ___", it is well-named.

| Bad Name | Good Name | Why |
|----------|-----------|-----|
| `get_resource` | `get_account_balances` | Specifies domain and operation |
| `post_data` | `submit_loan_application` | Describes business intent |
| `update_record` | `change_shipping_address` | Clear user-facing action |
| `delete_item` | `cancel_subscription` | Domain-specific consequence |

## Principle 2: Natural Language Compatibility

Tools must be discoverable through the language users actually speak. Include **trigger phrases** in docstrings and design for **search-first** interaction patterns.

### Trigger Phrases in Docstrings

```python
@tool
def search_transactions(
    account_id: str,
    query: str,
    date_from: str = None,
    date_to: str = None
) -> dict:
    """Search transaction history by description, merchant, or amount.

    Usar cuando el usuario diga: "find a charge", "search my transactions",
    "look for a payment", "when did I pay", "find purchase from [merchant]".

    Args:
        account_id: Account identifier.
        query: Natural language search (merchant name, amount, description).
        date_from: Start date (YYYY-MM-DD). Defaults to 30 days ago.
        date_to: End date (YYYY-MM-DD). Defaults to today.

    Returns:
        Matching transactions with relevance score.
    """
    pass
```

### Search-First Pattern

Design tools so the agent can find entities by **name or alias**, not only by opaque internal IDs.

```python
# Bad: Requires opaque ID the user never knows
@tool
def get_customer(customer_id: str) -> dict:
    """Fetch customer by internal ID."""
    pass

# Good: Search by natural identifiers first
@tool
def find_customer(
    name: str = None,
    email: str = None,
    phone: str = None
) -> dict:
    """Find a customer by name, email, or phone number.

    Usar cuando el usuario diga: "find customer", "look up [name]",
    "search for client".

    At least one parameter is required. Returns best matches ranked
    by confidence. Use the returned customer_id for subsequent operations.
    """
    pass
```

## Principle 3: Structured Types with JSON Schema

Use **explicit types and constraints** instead of free-form strings. This prevents agent errors and enables validation before execution.

### Money as Structured Type

```python
# Bad: Ambiguous — is this USD? Cents or dollars?
@tool
def transfer_funds(amount: float, to_account: str) -> dict:
    pass

# Good: Structured money type with explicit currency
@tool
def transfer_funds(
    amount: dict,       # {"value": 150.00, "currency": "USD"}
    from_account: str,
    to_account: str,
    idempotency_key: str = None
) -> dict:
    """Transfer funds between accounts.

    Args:
        amount: Money object with 'value' (decimal) and 'currency' (ISO 4217).
                Example: {"value": 150.00, "currency": "USD"}
        from_account: Source account ID.
        to_account: Destination account ID.
        idempotency_key: Unique key to prevent duplicate transfers.
    """
    pass
```

### JSON Schema for Tool Parameters

```json
{
  "name": "transfer_funds",
  "parameters": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "object",
        "properties": {
          "value": {"type": "number", "minimum": 0.01},
          "currency": {"type": "string", "enum": ["USD", "EUR", "MXN"], "default": "USD"}
        },
        "required": ["value", "currency"]
      },
      "from_account": {"type": "string", "pattern": "^ACC-[0-9]{8}$"},
      "to_account": {"type": "string", "pattern": "^ACC-[0-9]{8}$"},
      "idempotency_key": {"type": "string", "format": "uuid"}
    },
    "required": ["amount", "from_account", "to_account"]
  }
}
```

### Standard Type Patterns

| Concept | Bad | Good |
|---------|-----|------|
| Money | `amount: float` | `amount: {"value": N, "currency": "X"}` |
| Date | `date: str` ("next Friday") | `date: str` (YYYY-MM-DD) |
| Phone | `phone: str` (free text) | `phone: str` (E.164: +1234567890) |
| Pagination | `page: int` | `cursor: str` (opaque, forward-only) |
| Enum | `status: str` | `status: Literal["active", "suspended", "closed"]` |

## Principle 4: Actionable Error Responses

When a tool fails, the response must tell the agent **what went wrong and what to do next**. Never return bare error strings.

```python
# Bad: Agent has no idea what to do
return {"error": "Not found"}

# Good: Actionable error with remediation
return {
    "status": "error",
    "error": {
        "code": "ACCOUNT_NOT_FOUND",
        "message": "No account found with ID 'ACC-99999999'.",
        "details": {
            "searched_id": "ACC-99999999",
            "search_scope": "active_accounts"
        },
        "remediation": "Verify the account ID or use find_customer to search by name/email.",
        "suggestions": [
            {
                "tool": "find_customer",
                "reason": "Search for the customer to get the correct account ID",
                "params": {"name": "partial name or email"}
            },
            {
                "tool": "list_accounts",
                "reason": "List all accounts for the authenticated user",
                "params": {}
            }
        ]
    }
}
```

### Error Response Schema

Every error must include these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `code` | Yes | Machine-readable error code (UPPER_SNAKE_CASE) |
| `message` | Yes | Human-readable explanation |
| `details` | No | Additional context about the error |
| `remediation` | Yes | What the agent should do next |
| `suggestions` | No | Specific tool calls that might resolve the issue |

## Principle 5: Consistent Terminology

Use **one term per concept** across all tools. Inconsistent naming forces the agent to learn synonyms and increases hallucination risk.

### Terminology Table

| Concept | Always Use | Never Use |
|---------|-----------|-----------|
| Account identifier | `account_id` | `acct_id`, `account_number`, `acct_num` |
| Customer identifier | `customer_id` | `client_id`, `user_id`, `cust_id` |
| Money amount | `{"value": N, "currency": "X"}` | `amount: float`, `price: str` |
| Date | `YYYY-MM-DD` | `MM/DD/YYYY`, `DD-MM-YYYY`, epoch |
| Timestamp | ISO 8601 (`2025-01-15T10:30:00Z`) | Unix epoch, custom formats |
| Pagination cursor | `cursor` | `page_token`, `next_id`, `offset` |
| Search query | `query` | `q`, `search_term`, `keyword` |
| Sort order | `sort_by`, `sort_order` | `order`, `ordering`, `sort_field` |

### Enforcement Pattern

```python
# Define shared types once, reuse everywhere
from typing import TypedDict, Literal

class Money(TypedDict):
    value: float
    currency: str  # ISO 4217

class PaginatedRequest(TypedDict, total=False):
    cursor: str
    limit: int  # Default 20, max 100

class PaginatedResponse(TypedDict):
    data: list
    next_cursor: str | None
    has_more: bool
```

## Principle 6: Rich Response Semantics

Every tool response should include enough context for the agent to **act on the result without additional calls**. Use a standard response envelope.

### Standard Response Pattern

```python
return {
    # Raw data for programmatic use
    "data": {
        "account_id": "ACC-12345678",
        "balances": [
            {"type": "checking", "available": {"value": 2500.00, "currency": "USD"}},
            {"type": "savings", "available": {"value": 15000.00, "currency": "USD"}}
        ]
    },

    # Pre-formatted for direct display to user
    "formatted": (
        "Account ACC-12345678 balances:\n"
        "- Checking: $2,500.00\n"
        "- Savings: $15,000.00\n"
        "- Total: $17,500.00"
    ),

    # What the agent can do next (see Principle 7)
    "available_actions": [
        {"tool": "get_transactions", "params": {"account_id": "ACC-12345678"}, "label": "View recent transactions"},
        {"tool": "transfer_funds", "params": {"from_account": "ACC-12345678"}, "label": "Transfer funds"},
        {"tool": "get_account_details", "params": {"account_id": "ACC-12345678"}, "label": "View account details"}
    ],

    # Suggested message for the agent to relay to the user
    "message_for_user": "Here are your current balances. Would you like to see recent transactions or make a transfer?",

    # Optional: voice-optimized version
    "formatted_spoken": "Your checking account has twenty-five hundred dollars and your savings has fifteen thousand dollars.",

    # Optional: metadata for agent reasoning
    "metadata": {
        "as_of": "2025-01-15T10:30:00Z",
        "cache_ttl_seconds": 60
    }
}
```

### Response Field Reference

| Field | Required | Purpose |
|-------|----------|---------|
| `data` | Yes | Structured data for programmatic use |
| `formatted` | Yes | Pre-formatted text for display |
| `available_actions` | Yes | Next possible tool calls (see Principle 7) |
| `message_for_user` | Yes | Suggested response to relay |
| `formatted_spoken` | No | Voice-optimized version |
| `metadata` | No | Timestamps, cache hints, debug info |

## Principle 7: Available Actions (Tool Graph)

Every tool response **MUST** include `available_actions` — a list of logical next steps. This creates a navigable **tool graph** that guides the agent through multi-step workflows without hardcoded orchestration.

### Tool Graph Example

```
get_account_balances
    |
    +--> get_account_details
    +--> get_transactions
    +--> transfer_funds
    +--> set_balance_alert

get_transactions
    |
    +--> get_transaction_details
    +--> dispute_transaction
    +--> categorize_transaction
    +--> export_transactions

transfer_funds
    |
    +--> get_transfer_status
    +--> cancel_transfer (if pending)
    +--> schedule_recurring_transfer
```

### Implementation Pattern

```python
@tool
def get_account_balances(account_id: str) -> dict:
    """Retrieve current balances for all sub-accounts."""
    balances = fetch_balances(account_id)

    return {
        "data": balances,
        "formatted": format_balances(balances),
        "message_for_user": "Here are your current balances.",
        "available_actions": [
            {
                "tool": "get_account_details",
                "params": {"account_id": account_id},
                "label": "View full account details",
                "description": "See account holder info, opening date, and settings"
            },
            {
                "tool": "get_transactions",
                "params": {"account_id": account_id, "limit": 10},
                "label": "View recent transactions",
                "description": "See the last 10 transactions on this account"
            },
            {
                "tool": "transfer_funds",
                "params": {"from_account": account_id},
                "label": "Transfer funds",
                "description": "Move money from this account to another"
            }
        ]
    }
```

### Dynamic Actions Based on State

```python
available_actions = []

# Always available
available_actions.append({
    "tool": "get_transactions",
    "params": {"account_id": account_id},
    "label": "View transactions"
})

# Conditional: only if balance > 0
if total_balance > 0:
    available_actions.append({
        "tool": "transfer_funds",
        "params": {"from_account": account_id},
        "label": "Transfer funds"
    })

# Conditional: only if alerts not already set
if not has_balance_alert:
    available_actions.append({
        "tool": "set_balance_alert",
        "params": {"account_id": account_id},
        "label": "Set low-balance alert"
    })
```

## Principle 8: Operation Levels

Classify every tool by its **impact level** to determine confirmation requirements. Map these levels to LangGraph's `interrupt_before` for human-in-the-loop control.

### Level Definitions

| Level | Category | Description | Confirmation | Example |
|-------|----------|-------------|-------------|---------|
| 1 | Read | Retrieve data, no side effects | None | `get_account_balances`, `search_transactions` |
| 2 | Create/List | Create new resources, list data | None | `create_support_ticket`, `list_accounts` |
| 3 | Update | Modify existing resources | Agent confirms | `change_shipping_address`, `update_profile` |
| 4 | Financial | Money movement, charges | User confirms | `transfer_funds`, `process_refund` |
| 5 | Irreversible | Cannot be undone | Explicit user approval | `close_account`, `delete_all_data` |

### Mapping to LangGraph interrupt_before

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

# Define tools by level
level_1_tools = [get_account_balances, search_transactions, find_customer]
level_2_tools = [create_support_ticket, list_accounts]
level_3_tools = [change_shipping_address, update_profile]
level_4_tools = [transfer_funds, process_refund]
level_5_tools = [close_account, delete_all_data]

all_tools = level_1_tools + level_2_tools + level_3_tools + level_4_tools + level_5_tools

# Configure interrupt_before for level 3+ tools
agent = create_deep_agent(
    tools=all_tools,
    checkpointer=MemorySaver(),
    interrupt_on={
        # Level 3: Agent confirms with user
        "change_shipping_address": {"allowed_decisions": ["approve", "edit", "reject"]},
        "update_profile": {"allowed_decisions": ["approve", "edit", "reject"]},
        # Level 4: User must explicitly confirm
        "transfer_funds": {"allowed_decisions": ["approve", "reject"]},
        "process_refund": {"allowed_decisions": ["approve", "reject"]},
        # Level 5: User must explicitly approve with reason
        "close_account": {"allowed_decisions": ["approve", "reject"]},
        "delete_all_data": {"allowed_decisions": ["approve", "reject"]},
    }
)
```

### Tool Metadata for Level Declaration

```python
@tool
def transfer_funds(
    amount: dict,
    from_account: str,
    to_account: str,
    idempotency_key: str = None
) -> dict:
    """Transfer funds between accounts.

    Operation Level: 4 (Financial - requires user confirmation)

    Usar cuando el usuario diga: "transfer money", "send funds",
    "move money between accounts".
    """
    pass
```

## Principle 9: Delegated Confirmations

For operations at **Level 3 and above**, the tool should not execute immediately. Instead, return a `pending_confirmation` status with details for the agent to present to the user.

### Confirmation Response Pattern

```python
@tool
def transfer_funds(
    amount: dict,
    from_account: str,
    to_account: str,
    idempotency_key: str = None
) -> dict:
    """Transfer funds between accounts. Level 4: Financial."""

    # Validate inputs first
    validation = validate_transfer(amount, from_account, to_account)
    if not validation["valid"]:
        return {"status": "error", "error": validation["error"]}

    # Return confirmation request — do NOT execute yet
    return {
        "status": "pending_confirmation",
        "confirmation": {
            "operation": "transfer_funds",
            "summary": f"Transfer {amount['currency']} {amount['value']:.2f} from {from_account} to {to_account}",
            "details": {
                "amount": amount,
                "from_account": from_account,
                "from_account_name": "Main Checking",
                "to_account": to_account,
                "to_account_name": "Joint Savings",
                "estimated_arrival": "2025-01-16",
                "fee": {"value": 0.00, "currency": "USD"}
            },
            "confirmation_method": {
                "tool": "confirm_transfer",
                "params": {
                    "transfer_id": "TXN-20250115-001",
                    "idempotency_key": idempotency_key or generate_key()
                }
            },
            "cancel_method": {
                "tool": "cancel_pending_operation",
                "params": {"operation_id": "TXN-20250115-001"}
            },
            "expires_at": "2025-01-15T11:00:00Z"
        },
        "message_for_user": (
            "I'd like to transfer $150.00 from Main Checking to Joint Savings. "
            "The transfer should arrive by January 16. No fees apply. "
            "Shall I proceed?"
        )
    }
```

### Confirmation Execution

```python
@tool
def confirm_transfer(transfer_id: str, idempotency_key: str) -> dict:
    """Execute a previously confirmed transfer.

    Operation Level: 4 (Financial)
    Only call after user explicitly approves the transfer.
    """
    result = execute_transfer(transfer_id, idempotency_key)
    return {
        "status": "completed",
        "data": result,
        "formatted": f"Transfer {transfer_id} completed. Confirmation: {result['confirmation_number']}",
        "message_for_user": f"Done. Your transfer of ${result['amount']['value']:.2f} is confirmed. Reference: {result['confirmation_number']}.",
        "available_actions": [
            {"tool": "get_transfer_status", "params": {"transfer_id": transfer_id}, "label": "Check transfer status"},
            {"tool": "get_account_balances", "params": {"account_id": result['from_account']}, "label": "View updated balances"}
        ]
    }
```

## Principle 10: Idempotency Keys

All **transactional tools** (Level 3+) must accept an `idempotency_key` parameter to prevent duplicate execution from retries, network issues, or agent loops.

```python
@tool
def process_refund(
    order_id: str,
    amount: dict,
    reason: str,
    idempotency_key: str = None
) -> dict:
    """Process a refund for an order.

    Operation Level: 4 (Financial)

    Args:
        order_id: The order to refund.
        amount: Money object {"value": N, "currency": "X"}.
        reason: Reason for the refund.
        idempotency_key: Unique key to prevent duplicate refunds.
                         If omitted, one will be generated.
                         If a refund with this key already exists,
                         the original result is returned.
    """
    key = idempotency_key or f"refund-{order_id}-{generate_uuid()}"

    # Check for existing operation with this key
    existing = lookup_by_idempotency_key(key)
    if existing:
        return {
            "status": "already_processed",
            "data": existing,
            "message_for_user": f"This refund was already processed. Reference: {existing['reference']}."
        }

    # Process new refund
    result = execute_refund(order_id, amount, reason, key)
    return {
        "status": "completed",
        "data": result,
        "idempotency_key": key,
        "message_for_user": f"Refund of {amount['currency']} {amount['value']:.2f} processed. Reference: {result['reference']}.",
        "available_actions": [
            {"tool": "get_refund_status", "params": {"refund_id": result['refund_id']}, "label": "Check refund status"}
        ]
    }
```

### Idempotency Key Rules

| Rule | Description |
|------|-------------|
| Format | UUID v4 or deterministic `{operation}-{entity_id}-{timestamp}` |
| Scope | Per-tool, per-user |
| TTL | 24 hours minimum for financial operations |
| Collision behavior | Return original result, do NOT execute again |
| Agent responsibility | Generate key before first call, reuse on retries |

## Tool Organization by Domain

Organize tools into **domain modules** for maintainability and discoverability.

### Directory Structure

```
domains/
  banking/
    __init__.py
    tools.py           # Exports TOOLS list
    schemas.py         # Shared types (Money, Account, etc.)
    formatters.py      # Response formatting helpers
  support/
    __init__.py
    tools.py
    schemas.py
    formatters.py
  orders/
    __init__.py
    tools.py
    schemas.py
    formatters.py
```

### Domain Module Pattern

```python
# domains/banking/tools.py
from langchain.tools import tool
from .schemas import Money, Account
from .formatters import format_balances, format_transfer

@tool
def get_account_balances(account_id: str) -> dict:
    """Retrieve current balances for all sub-accounts."""
    ...

@tool
def transfer_funds(amount: dict, from_account: str, to_account: str, idempotency_key: str = None) -> dict:
    """Transfer funds between accounts."""
    ...

@tool
def search_transactions(account_id: str, query: str, date_from: str = None, date_to: str = None) -> dict:
    """Search transaction history."""
    ...

# Export all tools for registration
TOOLS = [get_account_balances, transfer_funds, search_transactions]
```

### Agent Registration

```python
from domains.banking.tools import TOOLS as banking_tools
from domains.support.tools import TOOLS as support_tools
from domains.orders.tools import TOOLS as order_tools

agent = create_deep_agent(
    tools=banking_tools + support_tools + order_tools,
    # Or use subagents for domain isolation:
    subagents=[
        {"name": "banking", "tools": banking_tools},
        {"name": "support", "tools": support_tools},
        {"name": "orders", "tools": order_tools},
    ]
)
```

## Python Generation Pattern

Full template for generating a Python tool with all 10 principles applied.

```python
from langchain.tools import tool
from typing import TypedDict, Literal


class Money(TypedDict):
    value: float
    currency: str


@tool
def get_account_balances(account_id: str) -> dict:
    """Retrieve current balances for all sub-accounts (checking, savings, credit).

    Operation Level: 1 (Read)

    Usar cuando el usuario diga: "check my balance", "how much do I have",
    "account balance", "what's in my account".

    Args:
        account_id: The account to query.

    Returns:
        Balances by sub-account with available_actions for next steps.
    """
    # --- Implementation ---
    balances = fetch_balances(account_id)

    # --- Rich Response (Principle 6) ---
    return {
        "status": "success",
        "data": {
            "account_id": account_id,
            "balances": balances,
            "total": sum_balances(balances)
        },
        "formatted": format_balances_table(balances),
        "formatted_spoken": format_balances_spoken(balances),
        "message_for_user": "Here are your current account balances.",

        # --- Tool Graph (Principle 7) ---
        "available_actions": [
            {
                "tool": "get_transactions",
                "params": {"account_id": account_id, "limit": 10},
                "label": "View recent transactions"
            },
            {
                "tool": "transfer_funds",
                "params": {"from_account": account_id},
                "label": "Transfer funds"
            },
            {
                "tool": "get_account_details",
                "params": {"account_id": account_id},
                "label": "View account details"
            }
        ],
        "metadata": {
            "as_of": datetime.utcnow().isoformat(),
            "cache_ttl_seconds": 60
        }
    }
```

## MCP Generation Pattern

JSON tool definition following Model Context Protocol (MCP) format.

```json
{
  "name": "get_account_balances",
  "description": "Retrieve current balances for all sub-accounts (checking, savings, credit).\n\nOperation Level: 1 (Read)\n\nUsar cuando el usuario diga: \"check my balance\", \"how much do I have\", \"account balance\", \"what's in my account\".",
  "inputSchema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The account to query. Format: ACC-XXXXXXXX.",
        "pattern": "^ACC-[0-9]{8}$"
      }
    },
    "required": ["account_id"]
  }
}
```

### MCP Tool with Structured Parameters

```json
{
  "name": "transfer_funds",
  "description": "Transfer funds between accounts.\n\nOperation Level: 4 (Financial - requires user confirmation)\n\nUsar cuando el usuario diga: \"transfer money\", \"send funds\", \"move money between accounts\".",
  "inputSchema": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "object",
        "description": "Money object with value and currency.",
        "properties": {
          "value": {"type": "number", "minimum": 0.01, "description": "Amount to transfer."},
          "currency": {"type": "string", "enum": ["USD", "EUR", "MXN"], "description": "ISO 4217 currency code."}
        },
        "required": ["value", "currency"]
      },
      "from_account": {
        "type": "string",
        "description": "Source account ID.",
        "pattern": "^ACC-[0-9]{8}$"
      },
      "to_account": {
        "type": "string",
        "description": "Destination account ID.",
        "pattern": "^ACC-[0-9]{8}$"
      },
      "idempotency_key": {
        "type": "string",
        "format": "uuid",
        "description": "Unique key to prevent duplicate transfers. Generated if omitted."
      }
    },
    "required": ["amount", "from_account", "to_account"]
  }
}
```

## Quality Checklist

Before shipping a tool, verify against the full quality checklist:

**[`references/tool-quality-checklist.md`](references/tool-quality-checklist.md)**

Quick self-check:

- [ ] Name describes domain operation, not CRUD (Principle 1)
- [ ] Docstring includes trigger phrases (Principle 2)
- [ ] Parameters use structured types with constraints (Principle 3)
- [ ] Errors include code, message, remediation, and suggestions (Principle 4)
- [ ] Terminology matches project-wide glossary (Principle 5)
- [ ] Response includes data, formatted, available_actions, message_for_user (Principle 6)
- [ ] available_actions lists logical next steps (Principle 7)
- [ ] Operation level is declared and mapped to interrupt_before (Principle 8)
- [ ] Level 3+ tools return pending_confirmation first (Principle 9)
- [ ] Transactional tools accept idempotency_key (Principle 10)

## References

- **[AI-Friendly API Principles](references/ai-friendly-principles.md)** - Complete AI-friendly API design reference
- **[Agent-Native Principles](references/agent-native-principles.md)** - Parity, granularity, composability, emergent capability
- **[Tool Quality Checklist](references/tool-quality-checklist.md)** - Full quality verification checklist
- **[Tool Examples](references/tool-examples.md)** - Real-world tool catalog with complete implementations

## Related

- **[Tool Patterns](../patterns/references/tool-patterns.md)** - Design patterns for tool granularity, naming, and security
- **[API Cheatsheet](../patterns/references/api-cheatsheet.md)** - Quick reference for API-to-tool conversion
