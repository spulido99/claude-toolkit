# AI-Friendly API Design Principles

Reference guide for designing APIs and tools that LLMs can discover, understand, and compose effectively. This is the **canonical reference** for Principles 1–5 of the AI-Friendly Tool Design skill, plus MCP alignment. The skill's `SKILL.md` is an index; when the two disagree, this file wins.

---

## Principle 1: Semantic Clarity

API names must describe **business operations**, not HTTP methods or CRUD patterns. The LLM selects tools based on name and description — generic names cause confusion and misrouting.

### Why It Matters

When an agent has 30+ tools available, name collision and ambiguity are the primary failure modes. A tool named `get_resource` competes with every other "get" tool. A tool named `get_account_balances` is unambiguous.

### Rules

- Name the tool by what it **does in the business domain**, not how it maps to HTTP
- The name should complete the sentence: "I need to ___"
- Use `snake_case` with a verb prefix that describes the operation
- **Casing applies beyond the name**: every parameter and response field is also `snake_case` (`installments_quantity`, not `installmentsQuantity`; `request_token`, not `Request-Token`). This is mechanical — enforce it with a linter, not judgment. Terminology consistency (Principle 5) rides on top of this casing rule.

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

## Principle 2: Natural Language Compatibility

Tool descriptions are not just documentation — they are **the primary decision mechanism** for the LLM. The agent reads the description to decide when to call the tool, what parameters to provide, and what to expect back.

### Description Structure

Every tool description must include:

1. **One-line summary**: what the tool does
2. **When to use**: the situations and intents this tool serves
3. **When NOT to use**: limitations, and boundaries with sibling tools (name the tool that DOES cover the case)
4. **Parameter semantics**: what each parameter means, its format, and constraints
5. **Response description**: what the tool returns and how to interpret it
6. **Operation level**: impact classification (read, create, update, financial, irreversible)

### Template

```python
@tool
def tool_name(param1: str, param2: dict) -> dict:
    """One-line summary of what this tool does.

    Operation Level: N (Category)

    Use when the user asks about X — e.g. "trigger phrase 1", "trigger phrase 2".
    Do NOT use for Y (use other_tool) or Z (use another_tool).

    Args:
        param1: Description with format. Example: "ACC-12345678"
        param2: Description with structure. Example: {"value": 100, "currency": "USD"}

    Returns:
        Standard response envelope with data and formatted text.
    """
```

### When / When-Not Design

The **"Do NOT use"** lines are what prevent misrouting between similar tools. For every tool, ask: which sibling tool could the agent confuse this with? Name that boundary explicitly ("Do NOT use for credit card payments — use `pay_credit_card`").

**Trigger phrases** ("check my balance", "how much do I have") are an optional technique: useful when sibling tools overlap and you need to anchor colloquial phrasings, written in the users' primary language. They complement — never replace — the when/when-not prose.

### What LLMs Actually Read

The LLM processes tool descriptions as part of its context. Key behaviors:

- **Aim for 3-4+ sentences per description**: invest in disambiguation and boundaries, not raw length
- **Examples in descriptions improve parameter accuracy**: showing `"ACC-12345678"` prevents the agent from hallucinating formats
- **Explicit "Do NOT use" boundaries reduce misrouting** between sibling tools
- **Structured Args sections** help the agent populate parameters correctly

### Search-First Design

Every entity must be findable by **human-friendly attributes** (name, email, phone, description), not just opaque internal IDs. Users never know their `customer_id` — the agent needs a way to discover it.

```
User: "Transfer $100 to Maria"
  1. Agent calls find_contact(name="Maria") -> gets contact_id
  2. Agent calls get_contact_accounts(contact_id=...) -> gets account_id
  3. Agent calls transfer_funds(to_account=...) -> initiates transfer
```

Rules:

- Every domain entity needs a `search_` or `find_` tool
- Search tools accept **multiple optional filters** (name, email, phone, alias)
- At least one filter must be provided (not zero, not all required)
- Results include the **opaque ID** needed for subsequent operations
- Results are ranked by **relevance/confidence**

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
    subsequent operations. Do NOT use to look up accounts by
    account ID (use get_account_details).

    Args:
        name: Full or partial name. Case-insensitive.
        email: Email address. Exact or partial match.
        phone: Phone number in E.164 format (+595981...).
    """
```

| Entity | Search By | Tool Name |
|--------|-----------|-----------|
| Customer | name, email, phone | `find_customer` |
| Account | alias, number, holder_name | `find_account` |
| Transaction | merchant, description, amount | `search_transactions` |
| Product | name, category, SKU | `search_products` |
| Contact | name, alias, phone | `find_contact` |

---

## Principle 3: Structured Types

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
        idempotency_key: Key returned by a previous pending_confirmation (safe retry).
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
      "idempotency_key": {
        "type": "string",
        "description": "Key returned by a previous pending_confirmation. Omit on first call."
      }
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

### Pagination & Truncation

List-returning tools must bound their output and **say so** — silently truncated results read as complete.

```python
class Page(TypedDict):
    items: list
    next_cursor: str | None   # opaque, forward-only
    has_more: bool
    total_count: int | None   # omit if expensive to compute
```

- The envelope's `data` field holds the `Page` for list results (this replaces the older `PaginatedResponse`, whose top-level `data: list` collided with the envelope's `data`).
- Defaults: `limit: 20`, max 100. Sensible defaults let the agent call with minimal parameters.
- When truncating, announce it in `formatted` with remediation: `"Showing 20 of 143 results — narrow with date_from/date_to or pass next_cursor."`
- **Prefer filters over exhaustive pagination**: agents should narrow the query (date ranges, search terms), not crawl pages. Design search parameters accordingly.

---

## Principle 4: Actionable Errors

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

`suggestions` are server-state-driven `available_actions` for the error path (Principle 7) — derive them from business rules, never from record text content.

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

## Principle 5: Consistent Terminology

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

### Qualify Generic Identifiers by Domain

A bare `id`, `request_id`, `reference`, or `token` is ambiguous the moment **more than one kind** can exist in the catalog. If you have loan requests, transfer requests, and support requests, a field called `request_id` forces the agent to track *which* request it holds and risks passing the wrong one to the wrong tool. Qualify it:

| Bad (ambiguous) | Good (domain-qualified) |
|-----------------|--------------------------|
| `request_id` | `loan_request_id`, `transfer_request_id` |
| `id` (returned by `get_loan`) | `loan_id` |
| `reference` | `payment_reference`, `refund_reference` |
| `token` | `confirmation_token` |

The qualified name travels with the value: `loans_prepare_request` returns a `loan_request_id`, and `loans_disburse` accepts exactly that `loan_request_id` — the agent never has to guess what a generic `request_id` refers to. Stay generic **only** when the concept is truly catalog-wide and single-meaning (`cursor`, `idempotency_key`).

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

class Page(TypedDict):
    items: list
    next_cursor: str | None
    has_more: bool
    total_count: int | None
```

---

## MCP Alignment (Catalog-Level)

These principles map directly to the **Model Context Protocol (MCP)** tool definition format. The spec standardizes several things this skill teaches — use the standard fields, don't reinvent them as prose only.

### Modern MCP Tool Definition

```json
{
  "name": "transfer_funds",
  "description": "Transfer funds between accounts.\n\nOperation Level: 4 (Financial - requires user confirmation)\n\nUse when the user wants to move money — e.g. \"transfer money\", \"send funds\". Do NOT use for credit card payments (use pay_credit_card).",
  "inputSchema": {
    "type": "object",
    "properties": { "...": "..." },
    "required": ["amount", "from_account", "to_account"]
  },
  "annotations": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "status": {"type": "string"},
      "data": {"type": "object"},
      "formatted": {"type": "string"}
    }
  }
}
```

Keep the `Operation Level: N` prose in the description **and** declare `annotations`: the model reads the description; the MCP host reads the annotations.

### Principle-to-MCP Mapping

| Principle | MCP Field | How It Maps |
|-----------|-----------|-------------|
| 1 — Semantic Clarity | `name` | Tool name IS the semantic identifier |
| 2 — Natural Language Compatibility | `description` | When/when-not prose, operation level, examples |
| 3 — Structured Types | `inputSchema` | JSON Schema with `type`, `enum`, `pattern`, `minimum` |
| 4 — Actionable Errors | `isError` + content | Execution failures return `isError: true` with the structured error as content |
| 5 — Consistent Terminology | `inputSchema.properties` | Parameter names, types, and formats standardized |
| 6 — Rich Response Semantics | `outputSchema` / `structuredContent` | Declare the envelope; return it as structured content |
| 8 — Operation Levels | `annotations` | See table below |

### Operation Level → Annotations

| Level | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|-------|---------------|-------------------|------------------|
| 1 Read | `true` | — | `true` |
| 2 Create/List | `false` | `false` | per-tool |
| 3 Update | `false` | case-by-case | `true` (with key) |
| 4 Financial | `false` | `true` | `true` (with key) |
| 5 Irreversible | `false` | `true` | `true` (with key) |

`openWorldHint: true` when the tool reaches outside your closed system (web search, third-party APIs).

**Caveats**: annotations are advisory hints for hosts, **not security boundaries** — the spec says clients must treat them as untrusted unless they come from trusted servers. Clients that ignore them fall back to conservative defaults (`destructiveHint: true`), so declaring them correctly is what makes your Level 1 tools cheap to call. Enforcement still lives in your operation-level confirmation flows (Principles 8–9).

### Errors over MCP

- **Execution failures** (insufficient funds, not found): return `isError: true` with the Principle 4 error structure as the tool result content — the model sees it and can react.
- **Protocol errors** (unknown tool, malformed request): standard JSON-RPC errors — these never reach the model.

### Key Observations

- **`description` does heavy lifting**: it is the primary mechanism for tool routing. Invest in quality descriptions.
- **`inputSchema` prevents errors**: JSON Schema constraints (`pattern`, `enum`, `minimum`) catch malformed parameters before execution.
- **`required` guides the agent**: clearly separating required from optional parameters helps the agent decide what to ask the user for.
- **Default values reduce friction**: tools with sensible defaults (e.g., `include_details: false`, `limit: 20`) let the agent call with minimal parameters.
