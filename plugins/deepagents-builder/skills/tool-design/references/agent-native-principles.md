# Agent-Native Architecture Principles

Architecture patterns for designing systems where AI agents are first-class consumers. These principles ensure that tools, APIs, and workflows are optimized for autonomous agent operation, not just adapted from human-facing interfaces.

---

## 1. Available Actions Pattern

Every tool response **MUST** include `available_actions` — a list of tools that make sense as logical next steps given the current state. This creates an **implicit navigation graph** that guides the agent through multi-step workflows without hardcoded orchestration.

### Why It Matters

Without available actions, the agent must reason from scratch about what to do next after every tool call. This increases latency, token consumption, and error probability. With available actions, the agent has a curated menu of contextually appropriate next steps.

### Response Pattern

```python
return {
    "data": { ... },
    "formatted": "Human-readable summary",
    "available_actions": [
        {
            "tool": "get_transactions",
            "params": {"account_id": "ACC-12345678", "limit": 10},
            "label": "View recent transactions",
            "description": "See the last 10 transactions on this account"
        },
        {
            "tool": "transfer_funds",
            "params": {"from_account": "ACC-12345678"},
            "label": "Transfer funds",
            "description": "Move money from this account to another"
        }
    ],
    "message_for_user": "Here are your balances. What would you like to do next?"
}
```

### Tool Graph

Available actions create a navigable graph structure:

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

transfer_funds (pending_confirmation)
    |
    +--> confirm_transfer
    +--> cancel_pending_operation
    +--> get_account_balances
```

### Dynamic Actions Based on State

Available actions should be **contextual** — only show actions that are valid given the current state:

```python
available_actions = []

# Always available
available_actions.append({
    "tool": "get_transactions",
    "params": {"account_id": account_id},
    "label": "View transactions"
})

# Only if balance > 0
if total_balance > 0:
    available_actions.append({
        "tool": "transfer_funds",
        "params": {"from_account": account_id},
        "label": "Transfer funds"
    })

# Only if no alert already set
if not has_balance_alert:
    available_actions.append({
        "tool": "set_balance_alert",
        "params": {"account_id": account_id},
        "label": "Set low-balance alert"
    })
```

---

## 2. Operation Levels

Every tool must be classified by its **impact level** to determine what confirmation is required before execution. This classification is the foundation of safe autonomous operation.

### 5-Level Classification

| Level | Category | Description | Side Effects | Confirmation Required | Example Tools |
|-------|----------|-------------|-------------|----------------------|---------------|
| **1** | Read | Retrieve data | None | No confirmation | `get_account_balances`, `search_transactions`, `find_customer` |
| **2** | Create / List | Create new resources, list data | Low impact, reversible | No confirmation | `create_support_ticket`, `list_accounts`, `add_contact` |
| **3** | Update | Modify existing resources | Moderate impact | App confirmation (agent asks user) | `change_shipping_address`, `update_profile`, `rename_account` |
| **4** | Financial | Money movement, charges | High impact | Biometric / OTP / User explicit approval | `transfer_funds`, `process_refund`, `create_investment` |
| **5** | Irreversible | Cannot be undone | Permanent | Multi-factor + delay | `close_account`, `delete_all_data`, `terminate_contract` |

### Guidelines for Level Assignment

- **Level 1**: The tool only reads data. Calling it twice produces the same result. No state changes.
- **Level 2**: The tool creates something new but the creation is low-stakes (a support ticket, a note, a tag). Usually reversible.
- **Level 3**: The tool modifies existing data. The modification is not financial but could affect the user's experience (address change, profile update).
- **Level 4**: The tool involves money movement, charges, or financial commitments. Even small amounts get Level 4.
- **Level 5**: The tool performs an action that **cannot be reversed** by any means. Data deletion, account closure, contract termination.

### Mapping to Agent Frameworks

```python
# DeepAgents interrupt_on pattern
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You handle all operations.",
    tools=all_tools,
    interrupt_on={
        "tool": {"allowed_decisions": ["approve", "reject", "modify"]},
    },
)
```

---

## 3. Delegated Confirmations

For operations at **Level 3 and above**, the tool should NOT execute immediately. Instead, it returns a `pending_confirmation` status with full details for the agent to present to the user. Actual confirmation happens through a separate channel.

### Why Delegate?

- The agent can preview the operation details before execution
- The user sees exactly what will happen and can approve, modify, or cancel
- For Level 4+ operations, confirmation can require biometric/OTP through the app
- Creates an audit trail: who approved what, when, through which channel

### Confirmation Flow

```
1. Agent calls tool (e.g., transfer_funds)
2. Tool returns status: "pending_confirmation" with details
3. Agent presents details to user: "Transfer $150 to Savings. Proceed?"
4. User approves (in chat, via push notification, via biometric)
5. Agent calls confirmation tool (e.g., confirm_transfer)
6. Tool executes and returns final result
```

### Pending Confirmation Response

```python
{
    "status": "pending_confirmation",
    "confirmation": {
        "operation": "transfer_funds",
        "summary": "Transfer USD 150.00 from Main Checking to Joint Savings",
        "details": {
            "amount": {"value": 150.00, "currency": "USD"},
            "from_account": "ACC-12345678",
            "from_account_name": "Main Checking",
            "to_account": "ACC-87654321",
            "to_account_name": "Joint Savings",
            "estimated_arrival": "2025-01-16",
            "fee": {"value": 0.00, "currency": "USD"}
        },
        "confirmation_method": {
            "tool": "confirm_transfer",
            "params": {
                "transfer_id": "TXN-20250115-001",
                "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
            }
        },
        "cancel_method": {
            "tool": "cancel_pending_operation",
            "params": {"operation_id": "TXN-20250115-001"}
        },
        "expires_at": "2025-01-15T11:00:00Z"
    },
    "message_for_user": "I'd like to transfer $150.00 from Main Checking to Joint Savings. No fees apply. Shall I proceed?"
}
```

### Confirmation by Level

| Level | Confirmation Channel | UX Pattern |
|-------|---------------------|------------|
| 3 (Update) | Chat confirmation | Agent asks "Shall I proceed?" in conversation |
| 4 (Financial) | Biometric / OTP | App push notification or OTP code required |
| 5 (Irreversible) | Multi-factor + delay | Biometric + OTP + 24h cooling period |

---

## 4. Rich Semantics

Every tool response must include multiple representations of the result to support different consumption channels (text chat, voice, UI, programmatic).

### Standard Response Envelope

```python
{
    # Structured data for programmatic use
    "data": {
        "account_id": "ACC-12345678",
        "balances": [
            {"type": "checking", "available": {"value": 2500.00, "currency": "USD"}},
            {"type": "savings", "available": {"value": 15000.00, "currency": "USD"}}
        ]
    },

    # Pre-formatted text for the agent to display
    "formatted": "Account ACC-12345678 balances:\n- Checking: $2,500.00\n- Savings: $15,000.00\n- Total: $17,500.00",

    # Voice-optimized version (no symbols, spelled-out numbers)
    "formatted_spoken": "Your checking account has twenty-five hundred dollars and your savings has fifteen thousand dollars. Your total is seventeen thousand five hundred dollars.",

    # Suggested message for the agent to relay to the user
    "message_for_user": "Here are your current balances. Would you like to see recent transactions or make a transfer?",

    # Structured data — raw
    "data": { ... },

    # Next steps
    "available_actions": [ ... ]
}
```

### Field Purposes

| Field | Consumer | Purpose |
|-------|----------|---------|
| `data` | Agent logic, downstream tools | Raw structured data for programmatic use |
| `formatted` | Text chat, logs | Pre-formatted human-readable text |
| `formatted_spoken` | Voice assistants | Optimized for TTS (no symbols, spelled-out numbers) |
| `message_for_user` | Agent | Suggested response the agent can relay directly |
| `available_actions` | Agent | Menu of next steps |

### Why Multiple Formats?

- **`formatted`** saves the agent from formatting data into text (reduces hallucination)
- **`formatted_spoken`** prevents voice assistants from saying "dollar sign two five zero zero"
- **`message_for_user`** gives the agent a ready-made response, reducing latency
- **`data`** lets the agent perform calculations or pass values to other tools

---

## 5. Idempotency

All transactional operations (Level 3+) must support **UUID-based idempotency keys** to prevent duplicate execution from retries, network issues, or agent loops.

### How It Works

1. Agent generates a UUID before the first call: `550e8400-e29b-41d4-a716-446655440000`
2. Agent passes it as `idempotency_key` parameter
3. Backend stores the key with the operation result
4. If the same key is sent again, the backend returns the **original result** without re-executing

### Rules

| Rule | Description |
|------|-------------|
| **Format** | UUID v4 or deterministic `{operation}-{entity_id}-{timestamp}` |
| **Scope** | Per-tool, per-user |
| **TTL** | 24 hours minimum for financial operations |
| **Collision behavior** | Return original result, do NOT execute again |
| **Agent responsibility** | Generate key before first call, reuse on retries |
| **Status on collision** | Return `"status": "already_processed"` with original data |

### Implementation Pattern

```python
@tool
def transfer_funds(amount: dict, from_account: str, to_account: str,
                   idempotency_key: str = None) -> dict:
    key = idempotency_key or generate_uuid()

    # Check for existing operation with this key
    existing = lookup_by_idempotency_key(key)
    if existing:
        return {
            "status": "already_processed",
            "data": existing,
            "message_for_user": f"This transfer was already processed. Reference: {existing['reference']}."
        }

    # Process new transfer
    result = execute_transfer(amount, from_account, to_account, key)
    return {
        "status": "pending_confirmation",
        "idempotency_key": key,
        ...
    }
```

---

## 6. Bounded Contexts

Tools are organized by **business domain**. Each domain has its own vocabulary, its own tools file, and its own `TOOLS` list export. This prevents naming collisions and keeps tool catalogs manageable.

### Domain Organization

```
domains/
  cuentas/             # Accounts domain
    tools.py           # get_account_balances, get_account_details, find_account
    schemas.py         # Account, Balance types
    formatters.py      # format_balances, format_account_details

  transferencias/      # Transfers domain
    tools.py           # transfer_funds, confirm_transfer, get_transfer_status
    schemas.py         # Transfer, Money types
    formatters.py      # format_transfer_summary

  inversiones/         # Investments domain
    tools.py           # get_investments, create_investment, simulate_investment
    schemas.py         # Investment, Term types
    formatters.py      # format_investment_summary

  soporte/             # Support domain
    tools.py           # create_support_ticket, get_ticket_status
    schemas.py         # Ticket types
    formatters.py      # format_ticket_summary
```

### Rules for Bounded Contexts

- **Max 10 tools per domain**: If a domain exceeds 10 tools, split it into sub-domains
- **Each domain exports a `TOOLS` list**: `TOOLS = [tool1, tool2, ...]`
- **Shared types go in a common `schemas.py`**: Money, PaginatedRequest, etc.
- **Domain-specific vocabulary**: Each domain can define terms specific to its context
- **No cross-domain tool calls**: Tools in one domain should not directly call tools in another

### Agent Registration

```python
from domains.cuentas.tools import TOOLS as cuentas_tools
from domains.transferencias.tools import TOOLS as transferencias_tools
from domains.inversiones.tools import TOOLS as inversiones_tools

# Flat registration (all tools available to one agent)
agent = create_agent(tools=cuentas_tools + transferencias_tools + inversiones_tools)

# Or domain-isolated sub-agents
agent = create_agent(
    subagents=[
        {"name": "cuentas", "tools": cuentas_tools},
        {"name": "transferencias", "tools": transferencias_tools},
        {"name": "inversiones", "tools": inversiones_tools},
    ]
)
```

---

## 7. Parity Principle

The agent must be able to do **everything** users can do through the UI. No orphan UI actions — every button, form, and workflow in the app must have a corresponding tool.

### Why Parity Matters

- Users expect the agent to be a complete interface, not a limited one
- Orphan actions force users to switch between agent and UI, breaking the flow
- Incomplete tool coverage reduces agent adoption and trust

### Audit Process

1. **Enumerate all UI actions**: List every button, form, link, and workflow in the application
2. **Map to tools**: For each UI action, identify the corresponding tool
3. **Identify gaps**: Any UI action without a tool is a gap
4. **Prioritize by frequency**: Close gaps in order of user frequency

### Parity Matrix Example

| UI Action | Tool | Status |
|-----------|------|--------|
| View balances | `get_account_balances` | Covered |
| Transfer between own accounts | `transfer_funds` | Covered |
| Transfer to third party | `transfer_to_third_party` | Covered |
| Pay credit card | `pay_credit_card` | Covered |
| View transaction history | `get_transactions` | Covered |
| Dispute a charge | `dispute_transaction` | Covered |
| Download statement | `export_transactions` | Covered |
| Change password | N/A | Gap (security-sensitive, intentionally excluded) |
| Enable notifications | `update_notification_preferences` | Covered |

### Acceptable Gaps

Some actions are intentionally excluded from agent access:

- **Authentication changes**: Password reset, MFA setup (security-sensitive)
- **Legal agreements**: Terms acceptance (requires user's direct action)
- **Identity verification**: KYC/AML processes (regulatory requirement)

Document these exclusions explicitly so they don't appear as oversights.
