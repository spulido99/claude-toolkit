# Agent-Native Architecture Principles

Architecture patterns for designing systems where AI agents are first-class consumers. This is the **canonical reference** for Principles 6–11 of the AI-Friendly Tool Design skill, plus three catalog-level principles (Granularity, Bounded Contexts, Parity). The skill's `SKILL.md` is an index; when the two disagree, this file wins.

---

## Principle 6: Rich Response Semantics

Tool responses should give the agent what it needs to act on the result without extra calls — without padding the context with redundant representations.

### Standard Response Envelope

```python
{
    # REQUIRED: structured data for programmatic use
    "data": {
        "account_id": "ACC-12345678",
        "balances": [
            {"type": "checking", "available": {"value": 2500.00, "currency": "USD"}},
            {"type": "savings", "available": {"value": 15000.00, "currency": "USD"}}
        ]
    },

    # RECOMMENDED: pre-formatted text the agent can display as-is
    "formatted": "Account ACC-12345678 balances:\n- Checking: $2,500.00\n- Savings: $15,000.00\n- Total: $17,500.00",

    # CONTEXTUAL: next steps — only when they carry server state or a curated nudge (Principle 7)
    "available_actions": [ ... ],

    # OPTIONAL: voice-optimized version — only for tools serving voice channels
    "formatted_spoken": "Your checking account has twenty-five hundred dollars and your savings has fifteen thousand dollars.",

    # OPTIONAL: timestamps, cache hints
    "metadata": {"as_of": "2025-01-15T10:30:00Z", "cache_ttl_seconds": 60}
}
```

### Field Reference

| Field | Required | Consumer | Purpose |
|-------|----------|----------|---------|
| `data` | Yes | Agent logic, downstream tools | Raw structured data for programmatic use |
| `formatted` | Recommended | Text chat, logs | Pre-formatted human-readable text (reduces formatting hallucination) |
| `available_actions` | Contextual (Principle 7) | Agent | Next steps the catalog can't express |
| `formatted_spoken` | Voice channels only | Voice assistants | TTS-friendly: no symbols, spelled-out numbers |
| `metadata` | Optional | Agent | Timestamps, cache hints, debug info |

Do **not** add a field that duplicates another representation (earlier versions of this skill required a `message_for_user` field alongside `formatted`; in practice they were the same string — one display representation is enough).

### Token Efficiency

Tool responses are agent context: every field is re-read on every subsequent turn of the conversation, so redundancy compounds.

- Return **high-signal fields only**. If the agent won't act on a field, leave it out of `data`.
- Default to lean responses with opt-in detail flags (`include_details: bool = False`).
- Truncate long collections and **announce the truncation** (`has_more`, `total_count` — see Pagination & Truncation in `ai-friendly-principles.md`, Principle 3).
- Include `formatted_spoken` only when the tool actually serves a voice channel.

### Untrusted Content in Responses

Classify every response field as **server-generated** (balances, IDs, statuses, fees) or **pass-through external text** (transaction descriptions, payment memos, counterparty names — written by third parties).

- External text is **data, not instructions**: a transaction memo can contain anything, including text crafted to manipulate the consuming agent ("ignore previous instructions...").
- Keep external text inside `data` fields, and delimit or label it where it surfaces in `formatted` (e.g. `memo: "<text>"`), so the agent treats it as quoted content.
- `available_actions`, `suggestions`, `confirmation_method`, and `cancel_method` MUST derive from server state and business rules — **never** from the text content of records.

---

## Principle 7: Available Actions (Tool Graph)

`available_actions` is a list of contextually valid next steps included in a tool response. Used well, it carries information the agent **cannot get any other way**; used as a reflex, it restates the catalog and wastes context.

### When to Include `available_actions`

| Case | Rule | Example |
|------|------|---------|
| Server state the catalog can't express | **Include — this is the point of the pattern** | `pending_confirmation` exposing `confirm_transfer(transfer_id=...)` with its expiry; error `suggestions` |
| Curated high-value nudge from the backend | Include deliberately | After `create_investment`, suggest `simulate_investment` with a term the backend knows pays better |
| Restating the catalog | **Omit** | After `get_account_balances`, suggesting `transfer_funds` with no params — the agent already has every tool description |

The agent reads the full tool catalog on every turn. `available_actions` earns its tokens when it carries something the catalog cannot: **state** (what is possible *now*, with which IDs) or **curation** (what is worth doing *next*, decided by the business). A static menu of sibling tools carries neither.

### Response Pattern

```python
return {
    "data": { ... },
    "formatted": "Human-readable summary",
    "available_actions": [
        {
            "tool": "confirm_transfer",
            "params": {"transfer_id": "TXN-20250115-001", "idempotency_key": "srv-key-001"},
            "label": "Confirm this transfer",
            "description": "Executes the staged transfer. Expires at 11:00."
        },
        {
            "tool": "cancel_pending_operation",
            "params": {"operation_id": "TXN-20250115-001"},
            "label": "Cancel"
        }
    ]
}
```

Each entry includes `tool`, pre-filled `params` (the state the agent couldn't infer), a `label`, and optionally a `description`.

### Tool Graph

State-dependent actions create a navigable graph through multi-step workflows:

```
transfer_funds (pending_confirmation)
    |
    +--> confirm_transfer
    +--> cancel_pending_operation

dispute_transaction (pending_confirmation)
    |
    +--> confirm_dispute
    +--> cancel_pending_operation
```

### Dynamic Actions Based on State

Actions must be **contextual** — only valid given the current state, derived from server state (see Untrusted Content rule in Principle 6):

```python
available_actions = []

# Only if there is a pending operation on this account
for op in get_pending_operations(account_id):
    available_actions.append({
        "tool": "cancel_pending_operation",
        "params": {"operation_id": op["id"]},
        "label": f"Cancel pending {op['type']}"
    })

# Curated nudge: backend knows a better rate is available
if better_rate_available(account_id):
    available_actions.append({
        "tool": "simulate_investment",
        "params": {"term_days": 180},
        "label": "Simulate a 180-day investment at the promotional rate"
    })
```

---

## Principle 8: Operation Levels

Every tool must be classified by its **impact level** to determine what confirmation is required before execution. This classification is the foundation of safe autonomous operation.

### 5-Level Classification

| Level | Category | Description | Side Effects | Confirmation Required | Example Tools |
|-------|----------|-------------|-------------|----------------------|---------------|
| **1** | Read | Retrieve data | None | No confirmation | `get_account_balances`, `search_transactions`, `find_customer` |
| **2** | Create / List | Create new resources, list data | Low impact, reversible | No confirmation | `create_support_ticket`, `list_accounts`, `add_contact` |
| **3** | Update | Modify existing resources | Moderate impact | App confirmation (agent asks user) | `change_shipping_address`, `update_profile`, `rename_account` |
| **4** | Financial | Money movement, charges | High impact | Explicit user approval in the conversation | `transfer_funds`, `process_refund`, `create_investment` |
| **5** | Irreversible | Cannot be undone | Permanent | Reinforced confirmation (user re-confirms a key detail) + cancellation window | `close_account`, `delete_all_data`, `terminate_contract` |

### Guidelines for Level Assignment

- **Level 1**: The tool only reads data. Calling it twice produces the same result. No state changes.
- **Level 2**: The tool creates something new but the creation is low-stakes (a support ticket, a note, a tag). Usually reversible.
- **Level 3**: The tool modifies existing data. The modification is not financial but could affect the user's experience (address change, profile update).
- **Level 4**: The tool involves money movement, charges, or financial commitments. Even small amounts get Level 4.
- **Level 5**: The tool performs an action that **cannot be reversed** by any means. Data deletion, account closure, contract termination.

Assign by **impact, not HTTP verb**: a `POST` that moves money is Level 4; a `DELETE` that removes a draft is Level 2-3; a `DELETE` that destroys data irreversibly is Level 5.

### Mapping to DeepAgents `interrupt_on`

`interrupt_on` is a dict **keyed by tool name**. Valid `allowed_decisions`: `"approve"` (execute as proposed), `"edit"` (modify the arguments), `"reject"` (skip execution), `"respond"` (the human's message becomes the tool result). A **checkpointer is required** for human-in-the-loop. API verified against the DeepAgents docs, June 2026: <https://docs.langchain.com/oss/python/deepagents/human-in-the-loop>.

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

# Group tools by operation level
level_1_2_tools = [get_account_balances, search_transactions, find_customer, list_accounts]
level_3_tools   = [change_shipping_address, update_profile]
level_4_5_tools = [transfer_funds, process_refund, close_account]

# Derive the interrupt config from the levels — keyed BY TOOL NAME
interrupt_on = {
    **{t.name: False for t in level_1_2_tools},  # no pause
    **{t.name: {"allowed_decisions": ["approve", "edit", "reject"]} for t in level_3_tools},
    **{t.name: {"allowed_decisions": ["approve", "reject"]} for t in level_4_5_tools},  # no editing amounts mid-flight
}

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You handle all account operations.",
    tools=level_1_2_tools + level_3_tools + level_4_5_tools,
    checkpointer=MemorySaver(),  # REQUIRED for human-in-the-loop
    interrupt_on=interrupt_on,
)
```

---

## Principle 9: Delegated Confirmations

For operations at **Level 3 and above**, the tool should NOT execute immediately. Instead, it **stages** the operation and returns a `pending_confirmation` status with full details for the agent to present to the user. Actual confirmation happens through a separate call.

### Why Delegate?

- The agent can preview the operation details before execution
- The user sees exactly what will happen and can approve, modify, or cancel
- Creates an audit trail: who approved what, when, through which channel
- Out-of-band channels (biometric/OTP/push) can plug in later without changing tool design

### `interrupt_on` vs. Confirmation Tools

These are complementary, not alternatives:

- **`interrupt_on` (Principle 8)** pauses *in the chat client* at the framework level — the default for in-conversation approval in DeepAgents.
- **Confirmation tools (this principle)** add a server-side audit trail, an expiry window, and the seam where out-of-band channels (push, OTP, biometric) plug in later.

Level 3 is usually fine with `interrupt_on` alone; Level 4–5 typically need both.

### Confirmation Flow

```
1. Agent calls tool (e.g., transfer_funds)
2. Tool validates, STAGES the operation, returns status: "pending_confirmation" with details
3. Agent presents details to user: "Transfer $150 to Savings. Proceed?"
4. User approves (in chat, via push notification, via biometric)
5. Agent calls the confirmation tool (e.g., confirm_transfer) echoing the server-issued key
6. Tool executes and returns the final result
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
                # Issued by the server when the operation was staged — the agent echoes it
                "idempotency_key": "txn-20250115-001-k7f3"
            }
        },
        "cancel_method": {
            "tool": "cancel_pending_operation",
            "params": {"operation_id": "TXN-20250115-001"}
        },
        "expires_at": "2025-01-15T11:00:00Z"
    },
    "formatted": "I'd like to transfer $150.00 from Main Checking to Joint Savings. No fees apply. Shall I proceed?"
}
```

### Confirmation by Level

| Level | Confirmation Channel | UX Pattern |
|-------|---------------------|------------|
| 3 (Update) | Chat confirmation | Agent asks "Shall I proceed?" in conversation (or `interrupt_on` pause) |
| 4 (Financial) | Explicit user confirmation in chat | Agent presents the full summary; user explicitly approves before execution |
| 5 (Irreversible) | Reinforced confirmation + delay | User re-confirms a key detail (e.g. restates the amount/name); optional cancellation window before execution |

> If the app later adds out-of-band channels (OTP, biometric, push), they plug in here without changing tool design — the tool still returns `pending_confirmation` and execution still happens in a second tool. Today the available channel is explicit confirmation in the conversation.

---

## Principle 10: Idempotency

All transactional operations (Level 3+) must support idempotency keys to prevent duplicate execution from retries, network issues, or agent loops. The key is **emitted by the server, echoed by the agent** — never invented by the model.

### How It Works

1. The Level 3+ tool **stages** the operation (Principle 9) and returns `pending_confirmation` including an `idempotency_key` it generated server-side (e.g. derived from the pending operation ID).
2. The agent **echoes** that key in the `confirm_*` call — and on any retry. The agent never generates keys.
3. The backend stores the key with the operation result. A repeated key returns the **original result** (`status: "already_processed"`) without re-executing.

Why server-emitted: LLM-sampled "UUIDs" are low-entropy (models gravitate toward memorized examples), and a key collision silently swallows a legitimate operation — the worst possible failure mode for a dedupe mechanism on financial tools.

### Rules

| Rule | Description |
|------|-------------|
| **Format** | Opaque server-generated string (e.g. derived from the staged operation ID) |
| **Scope** | Per-tool, per-user |
| **TTL** | Suggested default: 24 hours minimum for financial operations |
| **Collision behavior** | Return original result with `status: "already_processed"`, do NOT execute again |
| **Agent responsibility** | Echo the key from `pending_confirmation` on confirm and retries — never generate one |

### Implementation Pattern

```python
@tool
def transfer_funds(amount: dict, from_account: str, to_account: str,
                   idempotency_key: str = None) -> dict:
    """Transfer funds between accounts. Level 4: stages and returns pending_confirmation.

    Args:
        idempotency_key: Only pass the key returned by a previous
            pending_confirmation (safe retry). Omit on first call —
            the tool generates one and returns it.
    """
    key = idempotency_key or new_server_key()  # server-side generation

    existing = lookup_by_idempotency_key(key)
    if existing:
        return {
            "status": "already_processed",
            "data": existing,
            "formatted": f"This transfer was already processed. Reference: {existing['reference']}."
        }

    # Stage the operation — do NOT execute yet (Principle 9)
    transfer_id = stage_transfer(amount, from_account, to_account, key)
    return {
        "status": "pending_confirmation",
        "confirmation": {
            # ... summary and details ...
            "confirmation_method": {
                "tool": "confirm_transfer",
                "params": {"transfer_id": transfer_id, "idempotency_key": key}
            }
        }
    }
```

---

## Principle 11: Secure Parameters

Tool parameters are **fully controllable by the LLM** — it can pass any value to any parameter. Therefore **no secret, credential, token, or caller identity may be a parameter.** These are injected by the framework, invisible to the model.

This is a **trust-boundary** principle, independent of data typing (Principle 3): even a perfectly typed `user_id: str` is unsafe as a parameter, because the agent could pass *any* user's ID and read their data. Principle 3 asks "is this value well-typed?"; Principle 11 asks "is the agent allowed to choose this value at all?"

### What Never Goes in a Parameter

| Never a parameter | Why | Inject instead via |
|-------------------|-----|--------------------|
| Caller identity: `user_id`, `customer_id`, `tenant_id` | Agent could impersonate any user / cross tenants | Auth context (`x-claims`, `ToolRuntime`) |
| Credentials: `api_key`, `token`, `secret`, `password` | Logged or leaked through the model | Framework credentials |
| Fraud/anti-abuse tokens (e.g. device attestation) | Spoofable if the model controls them | Framework / gateway header |

Business identifiers the agent legitimately **discovers and passes** (an `account_id` returned by a search tool, a `loan_request_id` from a draft) are fine. The distinction is **caller identity / credentials vs. operands**. (Note the domain-qualified `loan_request_id`, not a bare `request_id` — Principle 5.)

```python
# Bad: identity, credential, and fraud token as parameters — the LLM controls them
@tool
def disburse_loan(loan_request_id: str, user_id: str, incognia_token: str) -> dict:
    ...

# Good: only the operand is a parameter; identity + fraud token injected by framework
from langchain.tools import tool, ToolRuntime

@tool
def loans_disburse(
    loan_request_id: str,
    idempotency_key: str,
    runtime: ToolRuntime[SecureContext],  # invisible to LLM: person_code, fraud token
) -> dict:
    """Disburse a confirmed Mini Loan. Operation Level: 4 (Financial)."""
    person_code = runtime.context.person_code  # from x-claims, not a parameter
    ...
```

**MCP note:** in an MCP server this means identity/credentials/fraud tokens are **never** fields in `inputSchema` — they arrive as gateway headers (e.g. Kong's `x-claims`) and are bound to the request server-side. If it is in `inputSchema`, the model can forge it.

See [Tool Patterns — Security with ToolRuntime](../../patterns/references/tool-patterns.md) for the full injection pattern.

---

## Catalog-Level Principles

These apply to the catalog as a whole, beyond any single tool. They are **not scored per-tool** because they require judgment, not static checks.

### Granularity — One Tool = One Unit of User Intent

Size a tool to a **unit of user intent or decision**, not to a backend endpoint or an internal step. Two failure modes pull in opposite directions:

| Failure | Symptom | Fix |
|---------|---------|-----|
| **Over-fragmented** | Two tools are always called in sequence and the intermediate result has no standalone use to the agent (e.g. a `loan_request_id` you can only pass to the next call) | **Merge** them into one tool |
| **Over-bundled** | One tool hides steps the agent would want to compose, skip, retry, or recover from independently (validate → check stock → pay) | **Split** into atomic primitives ([Anti-Pattern 13](../../patterns/references/anti-patterns.md)) |

These two pulls are not in conflict — they answer different questions:

- **Composability (Anti-Pattern 13):** *Am I hiding a primitive the agent needs to drive its own flow?* If yes → keep separate.
- **Granularity (this principle):** *Is this intermediate step a real user decision, or an artifact of how the backend is split?* If artifact → merge.

> Merging two backend endpoints behind one tool does **not** violate Anti-Pattern 13. #13 forbids hiding decision points the agent needs; it does not require exposing every internal step. The natural seam is the `pending_confirmation` boundary (Principle 9): everything up to "ready to execute" is usually **one** *prepare* tool, and execution is **one** *execute* tool — no matter how many endpoints sit behind each.

**Example:** `loans_create_request` (returns a bare `loan_request_id`) + `loans_confirm_request` (computes the final terms) should be **one** `loans_prepare_request` tool that returns `pending_confirmation` — the `loan_request_id` alone is never a useful stopping point for the agent.

### Bounded Contexts

Tools are organized by **business domain**. Each domain has its own vocabulary, its own tools file, and its own `TOOLS` list export. This prevents naming collisions and keeps tool catalogs manageable.

```
domains/
  accounts/            # Accounts domain
    tools.py           # get_account_balances, get_account_details, find_account
    schemas.py         # Account, Balance types
    formatters.py      # format_balances, format_account_details

  transfers/           # Transfers domain
    tools.py           # transfer_funds, confirm_transfer, get_transfer_status
    schemas.py         # Transfer, Money types
    formatters.py      # format_transfer_summary

  support/             # Support domain
    tools.py           # create_support_ticket, get_ticket_status
    schemas.py         # Ticket types
    formatters.py      # format_ticket_summary
```

Rules:

- **~10 tools per domain (suggested default)**: if a domain grows well past this, split it into sub-domains
- **~15+ tools in one agent**: consider domain subagents instead of one flat catalog (see the `architecture` skill for token-economy trade-offs)
- **Each domain exports a `TOOLS` list**: `TOOLS = [tool1, tool2, ...]`
- **Shared types go in a common `schemas.py`**: Money, Page, PaginatedRequest, etc.
- **Domain-specific vocabulary**: each domain can define terms specific to its context
- **No cross-domain tool calls**: tools in one domain should not directly call tools in another

```python
from domains.accounts.tools import TOOLS as accounts_tools
from domains.transfers.tools import TOOLS as transfers_tools

# Flat registration (all tools available to one agent)
agent = create_agent(tools=accounts_tools + transfers_tools)

# Or domain-isolated sub-agents (15+ tools)
agent = create_agent(
    subagents=[
        {"name": "accounts", "tools": accounts_tools},
        {"name": "transfers", "tools": transfers_tools},
    ]
)
```

### Parity Principle

The agent must be able to do **everything** users can do through the UI. No orphan UI actions — every button, form, and workflow in the app must have a corresponding tool.

Why parity matters:

- Users expect the agent to be a complete interface, not a limited one
- Orphan actions force users to switch between agent and UI, breaking the flow
- Incomplete tool coverage reduces agent adoption and trust

Audit process:

1. **Enumerate all UI actions**: list every button, form, link, and workflow in the application
2. **Map to tools**: for each UI action, identify the corresponding tool
3. **Identify gaps**: any UI action without a tool is a gap
4. **Prioritize by frequency**: close gaps in order of user frequency

| UI Action | Tool | Status |
|-----------|------|--------|
| View balances | `get_account_balances` | Covered |
| Transfer between own accounts | `transfer_funds` | Covered |
| Pay credit card | `pay_credit_card` | Covered |
| Dispute a charge | `dispute_transaction` | Covered |
| Change password | N/A | Gap (security-sensitive, intentionally excluded) |

Acceptable gaps — some actions are intentionally excluded from agent access:

- **Authentication changes**: password reset, MFA setup (security-sensitive)
- **Legal agreements**: terms acceptance (requires user's direct action)
- **Identity verification**: KYC/AML processes (regulatory requirement)

Document these exclusions explicitly so they don't appear as oversights.
