# Tool Examples

Real-world examples from a 32-tool banking/fintech catalog. Each example demonstrates multiple AI-Friendly Tool Design principles in a complete, production-ready tool definition.

---

## Example 1: `get_account_balances`

**Level 1 (Read) | Domain: accounts | No confirmation required**

```python
from langchain.tools import tool
from typing import Optional


@tool
def get_account_balances(include_details: bool = False) -> dict:
    """
    Retrieve balances for all user accounts.
    Returns available balance, book balance, and currency for each account.

    Operation Level: 1 (Read - no side effects)

    Use when the user says:
    - 'check my balance'
    - 'how much do I have'
    - 'how much money do I have'
    - 'see my accounts'
    - 'account balance'

    Args:
        include_details: If true, include account number and type. Default: false

    Returns:
        Balances by account with available_actions for next steps.
    """
    # --- Implementation ---
    accounts = fetch_user_accounts()
    balances = [get_balance(acc) for acc in accounts]

    # --- Build response ---
    data = []
    for acc, bal in zip(accounts, balances):
        entry = {
            "id": acc["id"],
            "currency": bal["currency"],
            "available_balance": bal["available"],
            "book_balance": bal["book"]
        }
        if include_details:
            entry["account_number"] = acc["number"]
            entry["account_type"] = acc["type"]
        data.append(entry)

    total_pyg = sum(b["available"] for b in balances if b["currency"] == "PYG")

    return {
        "status": "success",
        "data": data,
        "formatted": (
            "Your accounts:\n"
            + "\n".join(
                f"  - {d['currency']} Account: Gs. {d['available_balance']:,.0f} available"
                for d in data
            )
            + f"\n  Total PYG: Gs. {total_pyg:,.0f}"
        ),
        "formatted_spoken": (
            f"You have {len(data)} accounts. "
            f"Your total available balance in guaranies is {total_pyg:,.0f} guaranies."
        ),
        "available_actions": [
            {
                "tool": "get_account_details",
                "params": {"account_id": data[0]["id"]},
                "label": "View account details",
                "description": "Full account info: holder, opening date, settings"
            },
            {
                "tool": "get_transactions",
                "params": {"account_id": data[0]["id"], "limit": 10},
                "label": "View recent transactions",
                "description": "Last 10 transactions on this account"
            },
            {
                "tool": "transfer_funds",
                "params": {"from_account": data[0]["id"]},
                "label": "Transfer funds",
                "description": "Transfer money from this account"
            }
        ],
        "message_for_user": (
            "Your accounts:\n"
            + "\n".join(
                f"  - {d['currency']} Account: Gs. {d['available_balance']:,.0f} available"
                for d in data
            )
        ),
        "metadata": {
            "as_of": datetime.utcnow().isoformat(),
            "cache_ttl_seconds": 60
        }
    }
```

### Principles Demonstrated

| Principle | How |
|-----------|-----|
| **Semantic Clarity** | Name `get_account_balances` describes exact domain operation |
| **Natural Language Compatibility** | Trigger phrases matching real user queries |
| **Rich Response Semantics** | `formatted`, `formatted_spoken`, `message_for_user`, and `data` all present |
| **Available Actions** | Three contextual next steps with pre-filled params |
| **Operation Level** | Declared as Level 1 (Read) — no confirmation needed |
| **Sensible Defaults** | `include_details=False` keeps response lean by default |

---

## Example 2: `transfer_funds`

**Level 4 (Financial) | Domain: transfers | Requires user confirmation**

```python
from langchain.tools import tool
from typing import Optional
import uuid


@tool
def transfer_funds(
    amount: dict,
    from_account: str,
    to_account: str,
    description: str = "",
    idempotency_key: str = None
) -> dict:
    """
    Transfer funds between user accounts or to third parties.
    Requires user confirmation before executing.

    Operation Level: 4 (Financial - requires user confirmation)

    Use when the user says:
    - 'transfer money'
    - 'send funds'
    - 'move funds'
    - 'send money to [name]'
    - 'move money between accounts'

    Args:
        amount: Amount to transfer. Format: {"value": decimal, "currency": "PYG"}.
                Example: {"value": 500000, "currency": "PYG"}
        from_account: Source account ID. Format: ACC-XXXXXXXX.
        to_account: Destination account ID. Format: ACC-XXXXXXXX.
        description: Transfer concept or description. Optional.
        idempotency_key: Unique UUID key to prevent duplicates.
                         If omitted, one is generated automatically.
                         If reused, returns the original result.

    Returns:
        A pending_confirmation status with details for user approval.
    """
    # --- Generate idempotency key if not provided ---
    key = idempotency_key or str(uuid.uuid4())

    # --- Check for duplicate ---
    existing = lookup_by_idempotency_key(key)
    if existing:
        return {
            "status": "already_processed",
            "data": existing,
            "message_for_user": (
                f"This transfer has already been processed. "
                f"Reference: {existing['reference']}."
            )
        }

    # --- Validate inputs ---
    validation = validate_transfer(amount, from_account, to_account)
    if not validation["valid"]:
        return {
            "status": "error",
            "error": {
                "code": validation["error_code"],
                "message": validation["error_message"],
                "remediation": validation["remediation"],
                "suggestions": validation.get("suggestions", [])
            }
        }

    # --- Fetch account names for display ---
    from_name = get_account_name(from_account)
    to_name = get_account_name(to_account)
    fee = calculate_transfer_fee(amount, from_account, to_account)

    # --- Return pending confirmation (do NOT execute) ---
    transfer_id = generate_transfer_id()

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
                "fee": fee
            },
            "confirmation_method": {
                "tool": "confirm_transfer",
                "params": {
                    "transfer_id": transfer_id,
                    "idempotency_key": key
                }
            },
            "cancel_method": {
                "tool": "cancel_pending_operation",
                "params": {"operation_id": transfer_id}
            },
            "expires_at": (datetime.utcnow() + timedelta(minutes=30)).isoformat()
        },
        "message_for_user": (
            f"Transfer Gs. {amount['value']:,.0f} "
            f"from {from_name} to {to_name}. "
            f"{'No fee. ' if fee['value'] == 0 else f'Fee: Gs. {fee[\"value\"]:,.0f}. '}"
            f"Shall I proceed?"
        ),
        "metadata": {
            "idempotency_key": key,
            "transfer_id": transfer_id
        }
    }
```

### Principles Demonstrated

| Principle | How |
|-----------|-----|
| **Semantic Clarity** | `transfer_funds` — clear business operation |
| **Structured Types** | `amount` as `{"value": N, "currency": "X"}` — not a bare float |
| **Delegated Confirmation** | Returns `pending_confirmation` — does NOT execute directly |
| **Idempotency** | `idempotency_key` parameter with duplicate detection |
| **Actionable Errors** | Validation errors include `code`, `message`, `remediation`, `suggestions` |
| **Operation Level** | Declared as Level 4 (Financial) in docstring |
| **Trigger Phrases** | Trigger phrases matching real user language |
| **Confirmation Flow** | Includes `confirmation_method` and `cancel_method` tools |

---

## Example 3: `get_investments`

**Level 1 (Read) | Domain: investments | No confirmation required**

```python
from langchain.tools import tool
from typing import Optional


@tool
def get_investments(include_projections: bool = False) -> dict:
    """
    Retrieve the user's active investments.
    Returns investment type, amount, rate, term, and maturity date.

    Operation Level: 1 (Read - no side effects)

    Use when the user says:
    - 'my investments'
    - 'how much do I have invested'
    - 'see my fixed deposits'
    - 'investment returns'
    - 'when do my investments mature'

    Args:
        include_projections: If true, include projected earnings at maturity
                            and effective annual rate. Default: false

    Returns:
        List of active investments with details and available_actions.
    """
    # --- Implementation ---
    investments = fetch_user_investments()

    data = []
    for inv in investments:
        entry = {
            "id": inv["id"],
            "type": inv["type"],
            "currency": inv["currency"],
            "principal": {"value": inv["principal"], "currency": inv["currency"]},
            "annual_rate": inv["rate"],
            "term_days": inv["term_days"],
            "start_date": inv["start_date"],
            "maturity_date": inv["maturity_date"],
            "auto_renew": inv["auto_renew"],
            "status": inv["status"]
        }
        if include_projections:
            entry["projected_earnings"] = {
                "value": calculate_earnings(inv),
                "currency": inv["currency"]
            }
            entry["effective_annual_rate"] = calculate_effective_rate(inv)
            entry["days_remaining"] = days_until_maturity(inv)
        data.append(entry)

    total_invested = sum(d["principal"]["value"] for d in data)

    # --- Build formatted output ---
    lines = ["Your active investments:"]
    for d in data:
        line = (
            f"  - {d['type']}: Gs. {d['principal']['value']:,.0f} "
            f"at {d['annual_rate']}% annual, "
            f"matures {d['maturity_date']}"
        )
        if include_projections and "projected_earnings" in d:
            line += f" (projected earnings: Gs. {d['projected_earnings']['value']:,.0f})"
        lines.append(line)
    lines.append(f"  Total invested: Gs. {total_invested:,.0f}")

    return {
        "status": "success",
        "data": data,
        "formatted": "\n".join(lines),
        "formatted_spoken": (
            f"You have {len(data)} active investments "
            f"totaling {total_invested:,.0f} guaranies. "
            + (
                f"The next one matures on {data[0]['maturity_date']}."
                if data else ""
            )
        ),
        "available_actions": [
            {
                "tool": "get_investment_details",
                "params": {"investment_id": data[0]["id"]} if data else {},
                "label": "View investment details",
                "description": "Full information including performance history"
            },
            {
                "tool": "create_investment",
                "params": {},
                "label": "Create new investment",
                "description": "Create a new fixed deposit or investment"
            },
            {
                "tool": "simulate_investment",
                "params": {},
                "label": "Simulate investment",
                "description": "Calculate projected returns before investing"
            }
        ],
        "message_for_user": "\n".join(lines),
        "metadata": {
            "as_of": datetime.utcnow().isoformat(),
            "cache_ttl_seconds": 300
        }
    }
```

### Principles Demonstrated

| Principle | How |
|-----------|-----|
| **Semantic Clarity** | `get_investments` — domain-specific, not `get_resources` |
| **Sensible Defaults** | `include_projections=False` keeps response lean; user can opt in |
| **Rich Response Semantics** | `formatted`, `formatted_spoken`, and `data` all present with different representations |
| **Available Actions** | Three next steps: details, create new, simulate — covering view/action/plan |
| **Structured Types** | `principal` as Money object `{"value": N, "currency": "X"}` |
| **Natural Language** | Trigger phrases: "my investments", "how much do I have invested" |
| **Metadata** | Includes `cache_ttl_seconds: 300` (investment data changes less frequently) |

---

## Example 4: `create_investment`

**Level 4 (Financial) | Domain: investments | Requires user confirmation**

```python
from langchain.tools import tool
from typing import Optional, Literal
import uuid


@tool
def create_investment(
    amount: dict,
    from_account: str,
    term_days: int,
    auto_renew: bool = True,
    investment_type: Literal["fixed_deposit", "cd"] = "fixed_deposit",
    idempotency_key: str = None
) -> dict:
    """
    Create a new investment (fixed deposit or CD) using funds from an account.
    Requires user confirmation before executing.

    Operation Level: 4 (Financial - requires user confirmation)

    Use when the user says:
    - 'I want to invest'
    - 'create a fixed deposit'
    - 'make an investment'
    - 'put money in a fixed deposit'
    - 'invest [amount] for [term] days'

    Args:
        amount: Amount to invest. Format: {"value": decimal, "currency": "PYG"}.
                Example: {"value": 10000000, "currency": "PYG"}.
                Minimum: {"value": 1000000, "currency": "PYG"}.
        from_account: Source account ID for funds. Format: ACC-XXXXXXXX.
        term_days: Term in days. Allowed values: 30, 60, 90, 180, 360.
        auto_renew: If true, investment auto-renews at maturity.
                    Default: true.
        investment_type: Investment type. "fixed_deposit" or "cd" (Certificate of
                        Deposit). Default: "fixed_deposit".
        idempotency_key: Unique UUID key to prevent duplicates.
                         If omitted, one is generated automatically.

    Returns:
        A pending_confirmation status with proposed investment details.
    """
    # --- Generate idempotency key if not provided ---
    key = idempotency_key or str(uuid.uuid4())

    # --- Check for duplicate ---
    existing = lookup_by_idempotency_key(key)
    if existing:
        return {
            "status": "already_processed",
            "data": existing,
            "message_for_user": (
                f"This investment has already been created. "
                f"Reference: {existing['reference']}."
            )
        }

    # --- Validate ---
    if amount["value"] < 1000000:
        return {
            "status": "error",
            "error": {
                "code": "MINIMUM_AMOUNT",
                "message": f"The minimum investment amount is Gs. 1,000,000. You tried with Gs. {amount['value']:,.0f}.",
                "remediation": "Enter an amount equal to or greater than Gs. 1,000,000.",
                "suggestions": [
                    {
                        "tool": "simulate_investment",
                        "reason": "Simulate with a higher amount to see returns",
                        "params": {"amount": {"value": 1000000, "currency": "PYG"}, "term_days": term_days}
                    }
                ]
            }
        }

    if term_days not in [30, 60, 90, 180, 360]:
        return {
            "status": "error",
            "error": {
                "code": "INVALID_TERM",
                "message": f"Term of {term_days} days not available. Valid terms: 30, 60, 90, 180, 360.",
                "remediation": "Choose one of the available terms.",
                "suggestions": []
            }
        }

    # --- Calculate rate and projections ---
    rate = get_investment_rate(investment_type, term_days, amount)
    projected_earnings = calculate_projected_earnings(amount, rate, term_days)
    maturity_date = calculate_maturity_date(term_days)
    from_name = get_account_name(from_account)
    balance = get_available_balance(from_account)

    # --- Validate sufficient funds ---
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
                        "params": {}
                    }
                ]
            }
        }

    # --- Return pending confirmation (do NOT execute) ---
    investment_id = generate_investment_id()

    return {
        "status": "pending_confirmation",
        "confirmation": {
            "operation": "create_investment",
            "summary": (
                f"Create {investment_type} for Gs. {amount['value']:,.0f} "
                f"at {term_days} days at {rate}% annual"
            ),
            "details": {
                "investment_type": investment_type,
                "amount": amount,
                "from_account": from_account,
                "from_account_name": from_name,
                "term_days": term_days,
                "annual_rate": rate,
                "projected_earnings": {
                    "value": projected_earnings,
                    "currency": amount["currency"]
                },
                "maturity_date": maturity_date,
                "auto_renew": auto_renew
            },
            "confirmation_method": {
                "tool": "confirm_investment",
                "params": {
                    "investment_id": investment_id,
                    "idempotency_key": key
                }
            },
            "cancel_method": {
                "tool": "cancel_pending_operation",
                "params": {"operation_id": investment_id}
            },
            "expires_at": (datetime.utcnow() + timedelta(minutes=30)).isoformat()
        },
        "message_for_user": (
            f"Create {investment_type} for Gs. {amount['value']:,.0f} "
            f"at {term_days} days.\n"
            f"Rate: {rate}% annual.\n"
            f"Estimated earnings: Gs. {projected_earnings:,.0f}.\n"
            f"Maturity: {maturity_date}.\n"
            f"Auto-renewal: {'Yes' if auto_renew else 'No'}.\n"
            f"Funds from: {from_name}.\n"
            f"Shall I proceed?"
        ),
        "metadata": {
            "idempotency_key": key,
            "investment_id": investment_id
        }
    }
```

### Principles Demonstrated

| Principle | How |
|-----------|-----|
| **Structured Types** | `amount` as Money `{"value": N, "currency": "X"}`, `projected_earnings` also as Money |
| **Delegated Confirmation** | Returns `pending_confirmation` — does NOT create investment directly |
| **Idempotency** | `idempotency_key` with duplicate detection and `already_processed` response |
| **Actionable Errors** | Three distinct error cases (minimum amount, invalid term, insufficient funds) each with `code`, `message`, `remediation`, `suggestions` |
| **Documented Enums** | `investment_type: Literal["fixed_deposit", "cd"]` and `term_days` constraints documented |
| **Operation Level** | Declared as Level 4 (Financial) requiring user confirmation |
| **Confirmation Flow** | `confirmation_method` with `confirm_investment` and `cancel_method` with `cancel_pending_operation` |
| **Rich Display** | `message_for_user` with multi-line summary showing rate, earnings, maturity, and auto-renewal |

---

## Pattern Summary

Across all 4 examples, observe these consistent patterns:

| Pattern | Applied In |
|---------|-----------|
| Standard response envelope (`data`, `formatted`, `available_actions`, `message_for_user`) | All examples |
| Operation level in docstring | All examples |
| Trigger phrases in user's language | All examples |
| Money as `{"value": N, "currency": "X"}` | Examples 2, 3, 4 |
| `pending_confirmation` for Level 4 | Examples 2, 4 |
| `idempotency_key` for transactional tools | Examples 2, 4 |
| Actionable error responses | Examples 2, 4 |
| `formatted_spoken` for voice | Examples 1, 3 |
| Sensible defaults | All examples |
| Dynamic `available_actions` | All examples |

### When to Use Each Pattern

- **Level 1 tools** (Examples 1, 3): Focus on rich formatting and available actions. No confirmation needed.
- **Level 4 tools** (Examples 2, 4): Focus on validation, confirmation flow, and idempotency. Never execute directly.
- **All tools**: Always include trigger phrases, operation level, and standard response envelope.
