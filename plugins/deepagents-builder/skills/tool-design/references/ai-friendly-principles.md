# AI-Friendly API Design Principles

Reference guide for designing APIs and tools that LLMs can discover, understand, and compose effectively. These principles ensure that every tool in an agent's catalog is maximally useful for autonomous operation.

---

## 1. Semantic Clarity

API names must describe **business operations**, not HTTP methods or CRUD patterns. The LLM selects tools based on name and description — generic names cause confusion and misrouting.

### Why It Matters

When an agent has 30+ tools available, name collision and ambiguity are the primary failure modes. A tool named `get_resource` competes with every other "get" tool. A tool named `get_account_balances` is unambiguous.

### Rules

- Name the tool by what it **does in the business domain**, not how it maps to HTTP
- The name should complete the sentence: "I need to ___"
- Use `snake_case` with a verb prefix that describes the operation

### Examples

| HTTP Endpoint | Bad Tool Name | Good Tool Name | Reason |
|---------------|---------------|----------------|--------|
| `GET /accounts/{id}/balance` | `get_resource` | `get_account_balances` | Specifies domain and operation |
| `POST /loans/applications` | `post_data` | `submit_loan_application` | Describes business intent |
| `PUT /users/{id}/address` | `update_record` | `change_shipping_address` | Clear user-facing action |
| `DELETE /subscriptions/{id}` | `delete_item` | `cancel_subscription` | Domain-specific consequence |
| `GET /transactions?q=...` | `search` | `search_transactions` | Scoped to entity type |
| `POST /payments` | `create_payment` | `process_payment` | Describes what actually happens |

### Anti-Patterns

- **Generic CRUD verbs**: `create_`, `read_`, `update_`, `delete_` without domain context
- **HTTP method leakage**: `post_transfer`, `put_address`
- **Abbreviated names**: `get_acct_bal` instead of `get_account_balances`
- **Implementation details**: `query_postgres_accounts`, `call_swift_api`

---

## 2. Documentation for LLMs

Tool descriptions are not just documentation — they are **the primary decision mechanism** for the LLM. The agent reads the docstring to decide when to call the tool, what parameters to provide, and what to expect back.

### Description Structure

Every tool description must include:

1. **One-line summary**: What the tool does
2. **When-to-use triggers**: Natural language phrases that should activate this tool
3. **Parameter semantics**: What each parameter means, its format, and constraints
4. **Response description**: What the tool returns and how to interpret it
5. **Operation level**: Impact classification (read, create, update, financial, irreversible)

### Template

```python
@tool
def tool_name(param1: str, param2: dict) -> dict:
    """One-line summary of what this tool does.

    Operation Level: N (Category)

    Usar cuando el usuario diga:
    - 'trigger phrase 1'
    - 'trigger phrase 2'
    - 'trigger phrase 3'

    Args:
        param1: Description with format. Example: "ACC-12345678"
        param2: Description with structure. Example: {"value": 100, "currency": "USD"}

    Returns:
        Standard response with data, formatted text, and available_actions.
    """
```

### Trigger Phrase Design

Trigger phrases bridge the gap between how users speak and how tools are named:

- Include **colloquial variations**: "cuanto tengo", "my balance", "how much money"
- Include **partial phrases**: "check balance", "see my account"
- Include **intent synonyms**: "transfer", "send money", "move funds"
- Write them in the **primary language of the users** (e.g., Spanish for LATAM products)

### What LLMs Actually Read

The LLM processes tool descriptions as part of its system prompt. Key behaviors:

- **Longer descriptions = better routing**: A 3-line description outperforms a 1-line description
- **Examples in descriptions improve parameter accuracy**: Showing `"ACC-12345678"` prevents the agent from hallucinating formats
- **Trigger phrases reduce false negatives**: Without them, the agent may miss valid use cases
- **Structured Args sections** help the agent populate parameters correctly

---

## 3. Search-First Design

Every entity must be findable by **human-friendly attributes** (name, email, phone, description), not just opaque internal IDs. Users never know their `customer_id` — the agent needs a way to discover it.

### Pattern: Search Then Act

```
User: "Transfer $100 to Maria"
  1. Agent calls find_contact(name="Maria") -> gets contact_id
  2. Agent calls get_contact_accounts(contact_id=...) -> gets account_id
  3. Agent calls transfer_funds(to_account=...) -> initiates transfer
```

### Rules

- Every domain entity needs a `search_` or `find_` tool
- Search tools accept **multiple optional filters** (name, email, phone, alias)
- At least one filter must be provided (not zero, not all required)
- Results include the **opaque ID** needed for subsequent operations
- Results are ranked by **relevance/confidence**

### Search Tool Template

```python
@tool
def find_customer(
    name: str = None,
    email: str = None,
    phone: str = None
) -> dict:
    """Find a customer by name, email, or phone number.

    At least one parameter is required. Returns best matches
    ranked by confidence. Use the returned customer_id for
    subsequent operations.

    Args:
        name: Full or partial name. Case-insensitive.
        email: Email address. Exact or partial match.
        phone: Phone number in E.164 format (+595981...).
    """
```

### Entities That Need Search Tools

| Entity | Search By | Tool Name |
|--------|-----------|-----------|
| Customer | name, email, phone | `find_customer` |
| Account | alias, number, holder_name | `find_account` |
| Transaction | merchant, description, amount | `search_transactions` |
| Product | name, category, SKU | `search_products` |
| Contact | name, alias, phone | `find_contact` |

---

## 4. Error Design

When a tool fails, the response must tell the agent **what went wrong, why, and what to do next**. Bare error strings like `"Not found"` or `"Error 500"` leave the agent stranded.

### Error Response Structure

```python
{
    "status": "error",
    "error": {
        "code": "ACCOUNT_NOT_FOUND",          # Machine-readable (UPPER_SNAKE_CASE)
        "message": "No account found with ID 'ACC-99999999'.",  # Human-readable
        "details": {                            # Context for debugging
            "searched_id": "ACC-99999999",
            "search_scope": "active_accounts"
        },
        "remediation": "Verify the account ID or use find_customer to search by name.",  # Next step
        "suggestions": [                        # Specific tool calls to try
            {
                "tool": "find_customer",
                "reason": "Search for the correct account",
                "params": {"name": "partial name"}
            }
        ]
    }
}
```

### Required Error Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `code` | Yes | Machine-readable error code (UPPER_SNAKE_CASE) |
| `message` | Yes | Human-readable explanation of what went wrong |
| `remediation` | Yes | What the agent should do next |
| `details` | No | Additional context (searched values, scopes, timestamps) |
| `suggestions` | No | Specific tool calls that might resolve the issue |

### Standard Error Codes

| Code | Meaning | Typical Remediation |
|------|---------|-------------------|
| `ENTITY_NOT_FOUND` | Resource doesn't exist | Use search/find tool |
| `INVALID_PARAMETER` | Bad parameter format | Fix format per description |
| `INSUFFICIENT_FUNDS` | Not enough balance | Check balance first |
| `DUPLICATE_OPERATION` | Idempotency key reused | Return original result |
| `PERMISSION_DENIED` | User lacks access | Explain and suggest alternatives |
| `RATE_LIMITED` | Too many requests | Wait and retry |
| `OPERATION_EXPIRED` | Confirmation window passed | Start operation again |

---

## 5. Consistency

Use **one term per concept** across all tools in the catalog. Inconsistent naming forces the agent to learn synonyms and dramatically increases hallucination and parameter confusion.

### Terminology Table

| Concept | Standard Term | Never Use |
|---------|--------------|-----------|
| Account identifier | `account_id` | `acct_id`, `account_number`, `acct_num` |
| Customer identifier | `customer_id` | `client_id`, `user_id`, `cust_id` |
| Money amount | `{"value": N, "currency": "X"}` | `amount: float`, `price: str` |
| Date | `YYYY-MM-DD` | `MM/DD/YYYY`, `DD-MM-YYYY`, epoch |
| Timestamp | ISO 8601 (`2025-01-15T10:30:00Z`) | Unix epoch, custom formats |
| Pagination cursor | `cursor` | `page_token`, `next_id`, `offset` |
| Search query | `query` | `q`, `search_term`, `keyword` |
| Sort order | `sort_by`, `sort_order` | `order`, `ordering`, `sort_field` |
| Boolean flags | `include_details` | `with_details`, `show_details`, `details` |
| Limit | `limit` | `page_size`, `count`, `max_results` |

### Format Standards

| Type | Format | Example |
|------|--------|---------|
| Money | `{"value": decimal, "currency": "ISO 4217"}` | `{"value": 150.00, "currency": "USD"}` |
| Date | ISO 8601 date | `2025-01-15` |
| Timestamp | ISO 8601 with timezone | `2025-01-15T10:30:00Z` |
| Phone | E.164 | `+14155551234` |
| Currency code | ISO 4217 | `USD`, `EUR`, `PYG` |
| Country code | ISO 3166-1 alpha-2 | `US`, `PY`, `MX` |
| Language | BCP 47 | `es-PY`, `en-US` |
| ID patterns | Prefixed: `{TYPE}-{ID}` | `ACC-12345678`, `TXN-20250115-001` |

### Enforcement Strategy

1. **Define shared types once** in a central `schemas.py`
2. **Import and reuse** across all domain tool files
3. **Review tool PRs** against the terminology table
4. **Lint tool definitions** for non-standard parameter names

```python
# schemas.py — single source of truth
from typing import TypedDict

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

---

## 6. MCP Alignment

These principles map directly to the **Model Context Protocol (MCP)** tool definition format. Understanding the mapping ensures tools work across any MCP-compatible agent framework.

### MCP Tool Definition Structure

```json
{
  "name": "tool_name",
  "description": "Full description with triggers and operation level",
  "inputSchema": {
    "type": "object",
    "properties": { ... },
    "required": [ ... ]
  }
}
```

### Principle-to-MCP Mapping

| Principle | MCP Field | How It Maps |
|-----------|-----------|-------------|
| Semantic Clarity | `name` | Tool name IS the semantic identifier |
| Documentation for LLMs | `description` | Full docstring becomes description. Include triggers, operation level, examples |
| Search-First | N/A (tool design) | Manifest search tools alongside entity tools |
| Error Design | N/A (response) | Error structure in tool output, not in schema |
| Consistency | `inputSchema.properties` | Parameter names, types, and formats standardized |
| Structured Types | `inputSchema` | JSON Schema with `type`, `enum`, `pattern`, `minimum` |

### MCP Description Best Practices

```json
{
  "name": "get_account_balances",
  "description": "Retrieve current balances for all sub-accounts (checking, savings, credit).\n\nOperation Level: 1 (Read - no confirmation needed)\n\nUsar cuando el usuario diga: \"check my balance\", \"how much do I have\", \"cuanto tengo\", \"mi saldo\".\n\nReturns balances by sub-account with currency and as-of timestamp.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The account to query. Format: ACC-XXXXXXXX.",
        "pattern": "^ACC-[0-9]{8}$"
      },
      "include_details": {
        "type": "boolean",
        "description": "If true, include account holder name and opening date. Default: false.",
        "default": false
      }
    },
    "required": ["account_id"]
  }
}
```

### Key Observations

- **`description` does heavy lifting**: It is the primary mechanism for tool routing. Invest in quality descriptions.
- **`inputSchema` prevents errors**: JSON Schema constraints (`pattern`, `enum`, `minimum`) catch malformed parameters before execution.
- **`required` guides the agent**: Clearly separating required from optional parameters helps the agent decide what to ask the user for.
- **Default values reduce friction**: Tools with sensible defaults (e.g., `include_details: false`, `limit: 20`) let the agent call with minimal parameters.
