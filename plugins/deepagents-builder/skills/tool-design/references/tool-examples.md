# Tool Examples

Real-world examples from a 32-tool banking/fintech catalog. Each example demonstrates multiple AI-Friendly Tool Design principles in a complete, production-ready tool definition.

---

## Example 1: `get_account_balances`

**Level 1 (Read) | Domain: cuentas | No confirmation required**

```python
from langchain.tools import tool
from typing import Optional


@tool
def get_account_balances(include_details: bool = False) -> dict:
    """
    Consulta los saldos de todas las cuentas del usuario.
    Retorna saldo disponible, saldo contable y moneda para cada cuenta.

    Operation Level: 1 (Read - no side effects)

    Usar cuando el usuario pregunte:
    - 'cuanto tengo?'
    - 'mi saldo'
    - 'cuanta plata tengo'
    - 'ver mis cuentas'
    - 'balance de cuenta'

    Args:
        include_details: Si true, incluye numero de cuenta y tipo. Default: false

    Returns:
        Saldos por cuenta con available_actions para siguientes pasos.
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
            "Tus cuentas:\n"
            + "\n".join(
                f"  - Cuenta {d['currency']}: Gs. {d['available_balance']:,.0f} disponible"
                for d in data
            )
            + f"\n  Total PYG: Gs. {total_pyg:,.0f}"
        ),
        "formatted_spoken": (
            f"Tenes {len(data)} cuentas. "
            f"Tu saldo total disponible en guaranies es {total_pyg:,.0f} guaranies."
        ),
        "available_actions": [
            {
                "tool": "get_account_details",
                "params": {"account_id": data[0]["id"]},
                "label": "Ver detalle de cuenta",
                "description": "Informacion completa de la cuenta: titular, apertura, configuracion"
            },
            {
                "tool": "get_transactions",
                "params": {"account_id": data[0]["id"], "limit": 10},
                "label": "Ver movimientos recientes",
                "description": "Ultimas 10 transacciones de la cuenta"
            },
            {
                "tool": "transfer_funds",
                "params": {"from_account": data[0]["id"]},
                "label": "Transferir fondos",
                "description": "Transferir dinero desde esta cuenta"
            }
        ],
        "message_for_user": (
            "Tus cuentas:\n"
            + "\n".join(
                f"  - Cuenta {d['currency']}: Gs. {d['available_balance']:,.0f} disponible"
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
| **Natural Language Compatibility** | Trigger phrases in Spanish matching real user queries |
| **Rich Response Semantics** | `formatted`, `formatted_spoken`, `message_for_user`, and `data` all present |
| **Available Actions** | Three contextual next steps with pre-filled params |
| **Operation Level** | Declared as Level 1 (Read) — no confirmation needed |
| **Sensible Defaults** | `include_details=False` keeps response lean by default |

---

## Example 2: `transfer_funds`

**Level 4 (Financial) | Domain: transferencias | Requires user confirmation**

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
    Transfiere fondos entre cuentas del usuario o a terceros.
    Requiere confirmacion del usuario antes de ejecutar.

    Operation Level: 4 (Financial - requiere confirmacion del usuario)

    Usar cuando el usuario diga:
    - 'transferir plata'
    - 'enviar dinero'
    - 'pasar fondos'
    - 'mandar plata a [nombre]'
    - 'mover dinero entre cuentas'

    Args:
        amount: Monto a transferir. Formato: {"value": decimal, "currency": "PYG"}.
                Ejemplo: {"value": 500000, "currency": "PYG"}
        from_account: ID de cuenta origen. Formato: ACC-XXXXXXXX.
        to_account: ID de cuenta destino. Formato: ACC-XXXXXXXX.
        description: Concepto o descripcion de la transferencia. Opcional.
        idempotency_key: Clave unica UUID para prevenir duplicados.
                         Si se omite, se genera automaticamente.
                         Si se reutiliza, retorna el resultado original.

    Returns:
        Estado pending_confirmation con detalles para que el usuario apruebe.
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
                f"Esta transferencia ya fue procesada. "
                f"Referencia: {existing['reference']}."
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
                f"Transferir {amount['currency']} {amount['value']:,.0f} "
                f"de {from_name} a {to_name}"
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
            f"Quiero transferir Gs. {amount['value']:,.0f} "
            f"de {from_name} a {to_name}. "
            f"{'Sin comision. ' if fee['value'] == 0 else f'Comision: Gs. {fee[\"value\"]:,.0f}. '}"
            f"Confirmas?"
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
| **Trigger Phrases** | Spanish trigger phrases matching real user language |
| **Confirmation Flow** | Includes `confirmation_method` and `cancel_method` tools |

---

## Example 3: `get_investments`

**Level 1 (Read) | Domain: inversiones | No confirmation required**

```python
from langchain.tools import tool
from typing import Optional


@tool
def get_investments(include_projections: bool = False) -> dict:
    """
    Consulta las inversiones activas del usuario.
    Retorna tipo de inversion, monto, tasa, plazo y vencimiento.

    Operation Level: 1 (Read - no side effects)

    Usar cuando el usuario pregunte:
    - 'mis inversiones'
    - 'cuanto tengo invertido'
    - 'ver mis plazos fijos'
    - 'rendimiento de mis inversiones'
    - 'cuando vencen mis inversiones'

    Args:
        include_projections: Si true, incluye proyeccion de ganancia al vencimiento
                            y tasa efectiva anual. Default: false

    Returns:
        Lista de inversiones activas con detalles y available_actions.
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
    lines = ["Tus inversiones activas:"]
    for d in data:
        line = (
            f"  - {d['type']}: Gs. {d['principal']['value']:,.0f} "
            f"al {d['annual_rate']}% anual, "
            f"vence {d['maturity_date']}"
        )
        if include_projections and "projected_earnings" in d:
            line += f" (ganancia proyectada: Gs. {d['projected_earnings']['value']:,.0f})"
        lines.append(line)
    lines.append(f"  Total invertido: Gs. {total_invested:,.0f}")

    return {
        "status": "success",
        "data": data,
        "formatted": "\n".join(lines),
        "formatted_spoken": (
            f"Tenes {len(data)} inversiones activas "
            f"por un total de {total_invested:,.0f} guaranies. "
            + (
                f"La proxima vence el {data[0]['maturity_date']}."
                if data else ""
            )
        ),
        "available_actions": [
            {
                "tool": "get_investment_details",
                "params": {"investment_id": data[0]["id"]} if data else {},
                "label": "Ver detalle de inversion",
                "description": "Informacion completa incluyendo historial de rendimiento"
            },
            {
                "tool": "create_investment",
                "params": {},
                "label": "Crear nueva inversion",
                "description": "Crear un nuevo plazo fijo o inversion"
            },
            {
                "tool": "simulate_investment",
                "params": {},
                "label": "Simular inversion",
                "description": "Calcular rendimiento proyectado antes de invertir"
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
| **Natural Language** | Trigger phrases in Spanish: "mis inversiones", "cuanto tengo invertido" |
| **Metadata** | Includes `cache_ttl_seconds: 300` (investment data changes less frequently) |

---

## Example 4: `create_investment`

**Level 4 (Financial) | Domain: inversiones | Requires user confirmation**

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
    investment_type: Literal["plazo_fijo", "cda"] = "plazo_fijo",
    idempotency_key: str = None
) -> dict:
    """
    Crea una nueva inversion (plazo fijo o CDA) con fondos de una cuenta.
    Requiere confirmacion del usuario antes de ejecutar.

    Operation Level: 4 (Financial - requiere confirmacion del usuario)

    Usar cuando el usuario diga:
    - 'quiero invertir'
    - 'crear plazo fijo'
    - 'hacer una inversion'
    - 'poner plata a plazo fijo'
    - 'invertir [monto] a [plazo] dias'

    Args:
        amount: Monto a invertir. Formato: {"value": decimal, "currency": "PYG"}.
                Ejemplo: {"value": 10000000, "currency": "PYG"}.
                Minimo: {"value": 1000000, "currency": "PYG"}.
        from_account: ID de cuenta origen de fondos. Formato: ACC-XXXXXXXX.
        term_days: Plazo en dias. Valores permitidos: 30, 60, 90, 180, 360.
        auto_renew: Si true, la inversion se renueva automaticamente al vencimiento.
                    Default: true.
        investment_type: Tipo de inversion. "plazo_fijo" o "cda" (Certificado de
                        Ahorro). Default: "plazo_fijo".
        idempotency_key: Clave unica UUID para prevenir duplicados.
                         Si se omite, se genera automaticamente.

    Returns:
        Estado pending_confirmation con detalles de la inversion propuesta.
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
                f"Esta inversion ya fue creada. "
                f"Referencia: {existing['reference']}."
            )
        }

    # --- Validate ---
    if amount["value"] < 1000000:
        return {
            "status": "error",
            "error": {
                "code": "MINIMUM_AMOUNT",
                "message": f"El monto minimo de inversion es Gs. 1.000.000. Intentaste con Gs. {amount['value']:,.0f}.",
                "remediation": "Ingresa un monto igual o superior a Gs. 1.000.000.",
                "suggestions": [
                    {
                        "tool": "simulate_investment",
                        "reason": "Simular con un monto mayor para ver rendimiento",
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
                "message": f"Plazo {term_days} dias no disponible. Plazos validos: 30, 60, 90, 180, 360.",
                "remediation": "Elegir uno de los plazos disponibles.",
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
                    f"Saldo insuficiente. Disponible: Gs. {balance['available']:,.0f}. "
                    f"Requerido: Gs. {amount['value']:,.0f}."
                ),
                "remediation": "Reducir el monto o usar otra cuenta con saldo suficiente.",
                "suggestions": [
                    {
                        "tool": "get_account_balances",
                        "reason": "Ver saldos de todas las cuentas",
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
                f"Crear {investment_type} por Gs. {amount['value']:,.0f} "
                f"a {term_days} dias al {rate}% anual"
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
            f"Crear {investment_type} por Gs. {amount['value']:,.0f} "
            f"a {term_days} dias.\n"
            f"Tasa: {rate}% anual.\n"
            f"Ganancia estimada: Gs. {projected_earnings:,.0f}.\n"
            f"Vencimiento: {maturity_date}.\n"
            f"Renovacion automatica: {'Si' if auto_renew else 'No'}.\n"
            f"Fondos desde: {from_name}.\n"
            f"Confirmas?"
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
| **Documented Enums** | `investment_type: Literal["plazo_fijo", "cda"]` and `term_days` constraints documented |
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
| Trigger phrases in Spanish | All examples |
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
