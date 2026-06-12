# Tool Examples

Two canonical examples from a banking/fintech catalog: a **Level 1 read tool** and a **Level 4 financial tool**. Together they demonstrate the 11 principles in complete, production-shaped implementations. (Helper functions like `fetch_user_accounts` or `stage_transfer` represent your backend — note none of them take the caller's identity as a tool parameter: user scoping comes from the framework context, per Principle 11.)

---

## Example 1: `get_account_balances` — Level 1 (Read)

**Domain: accounts | No confirmation required**

```python
from datetime import datetime, timezone
from langchain.tools import tool


@tool
def get_account_balances(account_id: str = None, include_details: bool = False) -> dict:
    """
    Retrieve balances for user accounts: available balance, book balance, and currency.

    Operation Level: 1 (Read - no side effects)

    Use when the user asks about money available in their accounts —
    e.g. 'check my balance', 'how much do I have', 'see my accounts'.
    Do NOT use for transaction history (use search_transactions) or
    investment positions (use get_investments).

    Args:
        account_id: Account to query. Format: ACC-XXXXXXXX.
                    If omitted, returns balances for all user accounts.
        include_details: If true, include account type. Default: false

    Returns:
        Standard envelope: balances per account in `data`, display text in `formatted`.
    """
    # --- Implementation ---
    accounts = fetch_user_accounts(account_id)

    # --- Build response data (Money objects, consistent terminology) ---
    data = []
    for acc in accounts:
        bal = get_balance(acc)
        entry = {
            "account_id": acc["id"],
            "currency": bal["currency"],
            "available_balance": {"value": bal["available"], "currency": bal["currency"]},
            "book_balance": {"value": bal["book"], "currency": bal["currency"]},
        }
        if include_details:
            entry["account_type"] = acc["type"]
        data.append(entry)

    total_pyg = sum(
        e["available_balance"]["value"] for e in data if e["currency"] == "PYG"
    )

    response = {
        "status": "success",
        "data": data,
        "formatted": (
            "Your accounts:\n"
            + "\n".join(
                f"  - {e['currency']} Account: Gs. {e['available_balance']['value']:,.0f} available"
                for e in data
            )
            + f"\n  Total PYG: Gs. {total_pyg:,.0f}"
        ) if data else "You have no active accounts.",
        "metadata": {
            "as_of": datetime.now(timezone.utc).isoformat(),
            "cache_ttl_seconds": 60,
        },
    }

    # available_actions only when there is server state the catalog can't
    # express (Principle 7). A static "you could transfer or search" menu
    # is omitted — the agent already has the full catalog.
    pending = get_pending_operations(account_id)
    if pending:
        response["available_actions"] = [
            {
                "tool": "cancel_pending_operation",
                "params": {"operation_id": op["id"]},
                "label": f"Cancel pending {op['type']} ({op['summary']})",
            }
            for op in pending
        ]

    return response
```

### Principles Demonstrated

| Principle | How |
|-----------|-----|
| **1 — Semantic Clarity** | Name `get_account_balances` describes the exact domain operation |
| **2 — Natural Language Compatibility** | When-to-use phrasings AND explicit "Do NOT use" boundaries with sibling tools |
| **3 — Structured Types** | Balances as Money objects `{"value": N, "currency": "X"}` |
| **5 — Consistent Terminology** | `account_id`, `include_details` — catalog-standard names |
| **6 — Rich Response Semantics** | High-signal: `data` + `formatted`, no duplicated representations |
| **7 — Available Actions** | Included only when carrying server state (pending operations); omitted otherwise |
| **8 — Operation Level** | Declared as Level 1 (Read) — no confirmation needed |

---

## Example 2: `transfer_funds` — Level 4 (Financial)

**Domain: transfers | Stages and returns pending_confirmation — never executes directly**

```python
from datetime import datetime, timedelta, timezone
from typing import Literal
from langchain.tools import tool


@tool
def transfer_funds(
    amount: dict,
    from_account: str,
    to_account: str,
    transfer_type: Literal["own_accounts", "third_party"] = "own_accounts",
    description: str = "",
    idempotency_key: str = None,
) -> dict:
    """
    Transfer funds between user accounts or to third parties.
    Stages the transfer and returns a confirmation request — never executes directly.

    Operation Level: 4 (Financial - requires user confirmation)

    Use when the user wants to move money — e.g. 'transfer money',
    'send funds', 'send money to [name]'.
    Do NOT use for credit card payments (use pay_credit_card) or
    scheduled/recurring transfers (use schedule_recurring_transfer).

    Args:
        amount: Amount to transfer. Format: {"value": decimal, "currency": "PYG"}.
                Example: {"value": 500000, "currency": "PYG"}
        from_account: Source account ID. Format: ACC-XXXXXXXX.
        to_account: Destination account ID. Format: ACC-XXXXXXXX.
        transfer_type: "own_accounts" (between the user's accounts) or
                       "third_party" (to another person). Default: "own_accounts".
        description: Transfer concept. Optional. Stored and displayed as free
                     text — never interpreted.
        idempotency_key: Only pass the key returned by a previous
                         pending_confirmation (safe retry). Omit on first
                         call — the tool generates one and returns it.

    Returns:
        pending_confirmation with details, or an actionable error.
    """
    # --- Idempotency (Principle 10): server-generated key, echoed by the agent ---
    key = idempotency_key or new_server_key()

    existing = lookup_by_idempotency_key(key)
    if existing:
        return {
            "status": "already_processed",
            "data": existing,
            "formatted": (
                f"This transfer was already processed. "
                f"Reference: {existing['reference']}."
            ),
        }

    # --- Validation: concrete, actionable error cases (Principle 4) ---
    if amount["value"] < MINIMUM_TRANSFER:
        return {
            "status": "error",
            "error": {
                "code": "AMOUNT_BELOW_MINIMUM",
                "message": (
                    f"The minimum transfer is Gs. {MINIMUM_TRANSFER:,.0f}. "
                    f"You tried Gs. {amount['value']:,.0f}."
                ),
                "remediation": "Ask the user for an amount at or above the minimum.",
                "suggestions": [],
            },
        }

    if not account_exists(to_account):
        return {
            "status": "error",
            "error": {
                "code": "ACCOUNT_NOT_FOUND",
                "message": f"No account found with ID '{to_account}'.",
                "remediation": "Verify the account ID or search the recipient by name.",
                "suggestions": [
                    {
                        "tool": "find_contact",
                        "reason": "Search the recipient by name to get the correct account ID",
                        "params": {"name": "<recipient name>"},
                    }
                ],
            },
        }

    balance = get_available_balance(from_account)
    if balance["available"] < amount["value"]:
        return {
            "status": "error",
            "error": {
                "code": "INSUFFICIENT_FUNDS",
                "message": (
                    f"Insufficient funds. Available: Gs. {balance['available']:,.0f}. "
                    f"Required: Gs. {amount['value']:,.0f}."
                ),
                "remediation": "Reduce the amount or use another account with sufficient funds.",
                "suggestions": [
                    {
                        "tool": "get_account_balances",
                        "reason": "View balances for all accounts",
                        "params": {},
                    }
                ],
            },
        }

    # --- Stage the transfer (Principle 9): do NOT execute ---
    from_name = get_account_name(from_account)
    to_name = get_account_name(to_account)
    fee = calculate_transfer_fee(amount, transfer_type)
    transfer_id = stage_transfer(amount, from_account, to_account, key)

    fee_text = "No fee." if fee["value"] == 0 else f"Fee: Gs. {fee['value']:,.0f}."

    return {
        "status": "pending_confirmation",
        "confirmation": {
            "operation": "transfer_funds",
            "summary": (
                f"Transfer {amount['currency']} {amount['value']:,.0f} "
                f"from {from_name} to {to_name}"
            ),
            "details": {
                "amount": amount,
                "from_account": from_account,
                "from_account_name": from_name,
                "to_account": to_account,
                "to_account_name": to_name,
                "description": description,
                "estimated_arrival": calculate_arrival_date(),
                "fee": fee,
            },
            # Server state the catalog can't express — exactly what
            # available_actions / confirmation_method exist for (Principle 7)
            "confirmation_method": {
                "tool": "confirm_transfer",
                "params": {"transfer_id": transfer_id, "idempotency_key": key},
            },
            "cancel_method": {
                "tool": "cancel_pending_operation",
                "params": {"operation_id": transfer_id},
            },
            "expires_at": (
                datetime.now(timezone.utc) + timedelta(minutes=30)
            ).isoformat(),
        },
        "formatted": (
            f"Transfer Gs. {amount['value']:,.0f} from {from_name} to {to_name}. "
            f"{fee_text} Shall I proceed?"
        ),
        "metadata": {"idempotency_key": key, "transfer_id": transfer_id},
    }
```

### Principles Demonstrated

| Principle | How |
|-----------|-----|
| **1 — Semantic Clarity** | `transfer_funds` — clear business operation |
| **2 — Natural Language Compatibility** | When-to-use phrasings + "Do NOT use" boundaries (`pay_credit_card`, `schedule_recurring_transfer`) |
| **3 — Structured Types** | `amount` as Money object; `transfer_type` as `Literal` enum |
| **4 — Actionable Errors** | Three concrete error cases, each with `code`, `message`, `remediation`, `suggestions` |
| **6 — Rich Response Semantics** | `description` treated as free text, never interpreted (untrusted content rule) |
| **7 — Available Actions** | `confirmation_method` / `cancel_method` carry server state (transfer_id, key, expiry) |
| **8 — Operation Level** | Declared as Level 4 (Financial) in the docstring |
| **9 — Delegated Confirmations** | Stages the operation; returns `pending_confirmation` — never executes directly |
| **10 — Idempotency** | Server-generated key, returned in `confirmation_method.params` for the agent to echo |

---

## Pattern Summary

| Pattern | Example 1 (Level 1) | Example 2 (Level 4) |
|---------|--------------------|---------------------|
| High-signal envelope (`data` + `formatted`) | Yes | Yes |
| Operation level in docstring | Yes | Yes |
| When-to-use + Do-NOT-use boundaries | Yes | Yes |
| Money as `{"value": N, "currency": "X"}` | Yes | Yes |
| Contextual `available_actions` (state-only) | Pending operations | Confirmation/cancel methods |
| Staging + `pending_confirmation` | — | Yes |
| Server-emitted `idempotency_key` | — | Yes |
| Actionable error responses | — | Yes (3 cases) |
| `Literal` enums for constrained params | — | Yes |

### When to Use Each Pattern

- **Level 1-2 tools** (Example 1): lean response, opt-in detail flags, `available_actions` only for genuine server state. No confirmation, no idempotency key.
- **Level 3+ tools** (Example 2): validate with actionable errors, stage the operation, return `pending_confirmation` with server-issued idempotency key. Never execute directly.
- **All tools**: operation level in the docstring, when/when-not boundaries, structured types, catalog-consistent terminology.
