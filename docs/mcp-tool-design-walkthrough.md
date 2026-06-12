# Walkthrough: de una API REST a tools MCP bien diseñadas

> Documento complementario de la **[Guía de Diseño de Tools para MCP](mcp-tool-design-guide.md)**. Aquí no se explican los principios — se aplican. Tomamos una API real, la convertimos a tools como lo haría un dev backend por instinto, vemos por qué falla con un agente, y la reconstruimos principio por principio.

Si aún no leíste la sección **"Background: por qué esto no es una API REST"** de la guía, léela primero. Este documento asume que ya entiendes que el consumidor es un modelo probabilístico que lee texto, no código que ejecuta tu contrato.

---

## El escenario

Un banco quiere que su agente conversacional pueda **otorgar micro-préstamos**. El backend ya existe y expone estos endpoints REST:

```
GET  /users/{id}/loan-offers          → ofertas pre-aprobadas para un usuario
POST /loans/requests                  → crea una solicitud (devuelve request_id)
POST /loans/requests/{id}/simulate    → calcula cuotas, tasa, total
POST /loans/requests/{id}/confirm     → confirma términos (devuelve confirmation_id)
POST /loans/requests/{id}/disburse    → desembolsa el dinero a la cuenta
GET  /loans/{id}                       → estado de un préstamo
```

El objetivo: que el usuario pueda decir *"necesito un préstamo de un millón a 12 meses"* y el agente lo lleve de principio a fin de forma segura.

---

## Intento 1: el mapeo directo (lo que sale por instinto)

Un dev backend, sin background en AI, mapea cada endpoint a una tool. Es lo natural: ya existe el endpoint, lo expongo y listo.

```json
[
  {
    "name": "get_loan_offers",
    "description": "Get loan offers for a user.",
    "inputSchema": {
      "type": "object",
      "properties": { "userId": {"type": "string"} },
      "required": ["userId"]
    }
  },
  {
    "name": "create_request",
    "description": "Create a loan request.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "userId": {"type": "string"},
        "amount": {"type": "number"},
        "months": {"type": "number"}
      },
      "required": ["userId", "amount", "months"]
    }
  },
  {
    "name": "simulate",
    "description": "Simulate a loan request.",
    "inputSchema": {
      "type": "object",
      "properties": { "requestId": {"type": "string"} },
      "required": ["requestId"]
    }
  },
  {
    "name": "confirm",
    "description": "Confirm a loan request.",
    "inputSchema": {
      "type": "object",
      "properties": { "requestId": {"type": "string"} },
      "required": ["requestId"]
    }
  },
  {
    "name": "disburse",
    "description": "Disburse a loan.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "requestId": {"type": "string"},
        "authToken": {"type": "string"}
      },
      "required": ["requestId", "authToken"]
    }
  },
  {
    "name": "get_loan",
    "description": "Get a loan by id.",
    "inputSchema": {
      "type": "object",
      "properties": { "loanId": {"type": "string"} },
      "required": ["loanId"]
    }
  }
]
```

Compila. Responde 200. En Postman funciona perfecto. **Con un agente es un desastre.** Veamos exactamente dónde se rompe.

---

## Por qué se rompe — fallo por fallo

Seguimos al agente intentando resolver *"necesito un préstamo de un millón a 12 meses"*:

| # | Qué pasa | Principio violado |
|---|----------|-------------------|
| 1 | El agente ve `create_request`, `confirm`, `simulate`, `get_loan`… nombres genéricos que no gritan "préstamos". Si el catálogo tiene otras tools `create_*`, duda cuál usar. | **P1** Claridad semántica |
| 2 | El usuario dijo "un millón a 12 meses". El agente tiene que adivinar: ¿`amount: 1000000`? ¿`months` o `term`? La descripción "Create a loan request" no ayuda en nada. | **P2** Lenguaje natural |
| 3 | `amount: number` — ¿un millón de qué? ¿pesos, dólares? ¿centavos? El agente pone `1000000` y reza. `months: number` sin mínimo/máximo: nada impide `months: 1200`. | **P3** Tipos estructurados |
| 4 | `create_request` pide `userId`. El agente **no tiene el ID del usuario** — y peor: si lo tuviera, podría poner el de *cualquiera*. Lo mismo `disburse` pide `authToken`, un secreto que el modelo no debería ni ver. | **P11** Parámetros seguros |
| 5 | `create_request` devuelve `{"requestId": "req_abc"}` y nada más. El agente no sabe qué hacer con eso. ¿Simular? ¿Confirmar? Tiene que adivinar el flujo. | **P6 / P7** Respuesta pobre, sin próximos pasos |
| 6 | `create_request` + `simulate` + `confirm` son tres llamadas que *siempre* van juntas, y el `requestId` intermedio no le sirve de nada al usuario. Tres tools donde debería haber una. | **Granularidad** |
| 7 | El agente llama `disburse` directamente. **Desembolsa un millón de pesos sin que nadie confirme.** No hay punto de control. | **P8 / P9** Sin nivel ni confirmación |
| 8 | La red falla, el agente reintenta `disburse`. **Segundo desembolso.** Dos préstamos por la misma intención. | **P10** Sin idempotencia |
| 9 | `disburse` devuelve `{"loanId": "loan_xyz"}`. ¿Salió bien? ¿Cuánto se desembolsó? ¿A qué cuenta? El agente le inventa un resumen al usuario. | **P4 / P6** Respuesta opaca |

Nueve fallos, y ninguno aparece como error en tus logs. El backend respondió 200 a todo. Los fallos viven en la cabeza del agente: tools mal elegidas, parámetros inventados, dinero desembolsado dos veces.

---

## Intento 2: rediseño aplicando los 11 principios

### Paso A — repensar la granularidad (antes de escribir nada)

El error de raíz es mapear 1 endpoint = 1 tool. El agente no piensa en endpoints; piensa en **intenciones del usuario**. ¿Cuáles son las intenciones reales aquí?

1. *"¿Para cuánto califico?"* → ver ofertas
2. *"Quiero un préstamo de X a Y meses"* → preparar y ver los términos finales
3. *"Sí, dale"* → ejecutar el desembolso
4. *"¿Cómo va mi préstamo?"* → consultar estado

Eso son **cuatro tools**, no seis. Los tres endpoints `create → simulate → confirm` colapsan en **una sola** tool de preparación: el `requestId` intermedio nunca es un punto de parada útil para el usuario. La costura natural es el `pending_confirmation` (P9): todo lo previo a "listo para desembolsar" es *una* tool, y el desembolso es *otra*.

```
get_loan_offers        →  intención 1 (Nivel 1: Read)
loans_prepare_request  →  intención 2 (Nivel 1: Read — solo calcula, no compromete)
loans_disburse         →  intención 3 (Nivel 4: Financial — mueve dinero)
get_loan_status        →  intención 4 (Nivel 1: Read)
```

> Nota: fusionar tres endpoints detrás de `loans_prepare_request` **no** viola la composabilidad. No estamos escondiendo una decisión que el agente necesite tomar — `create`, `simulate` y `confirm` son pasos mecánicos internos sin valor independiente para el usuario. Lo que sí mantenemos separado es la decisión real: desembolsar o no.

### Paso B — las tools rediseñadas

#### 1. `get_loan_offers` — la puerta de entrada

```json
{
  "name": "get_loan_offers",
  "description": "Get pre-approved loan offers for the current user (max amount, available terms, rates).\n\nOperation Level: 1 (Read)\n\nUse when the user says: \"do I qualify for a loan\", \"how much can I borrow\", \"loan options\", \"necesito un préstamo\", \"¿para cuánto califico?\".",
  "inputSchema": {
    "type": "object",
    "properties": {}
  },
  "annotations": { "readOnlyHint": true }
}
```

- **P1/P2:** nombre de dominio + frases gatillo en ambos idiomas → el agente la encuentra desde "necesito un préstamo".
- **P11:** **no recibe `userId`.** El usuario es el de la sesión autenticada; el servidor lo resuelve desde el contexto del transporte (OAuth/headers del gateway). El modelo no puede pedir las ofertas de otro.

Respuesta:

```json
{
  "status": "success",
  "data": {
    "offers": [
      {
        "max_amount": {"value": 5000000, "currency": "COP"},
        "available_terms_months": [6, 12, 18, 24],
        "annual_rate_pct": 18.5
      }
    ]
  },
  "formatted": "Estás pre-aprobado para hasta $5.000.000 COP, a 6, 12, 18 o 24 meses, con una tasa del 18,5% anual.",
  "message_for_user": "Estás pre-aprobado para hasta $5.000.000. ¿Por cuánto y a cuántos meses lo quieres?",
  "available_actions": [
    {
      "tool": "loans_prepare_request",
      "params": {},
      "label": "Simular y preparar un préstamo",
      "description": "Calcula las cuotas y términos finales para un monto y plazo"
    }
  ]
}
```

- **P6:** trae `data` + `formatted` (cifras ya formateadas, el agente no las reconstruye) + `message_for_user`.
- **P7:** `available_actions` le dice al agente exactamente qué sigue — no tiene que adivinar el flujo.

#### 2. `loans_prepare_request` — tres endpoints, una intención

```json
{
  "name": "loans_prepare_request",
  "description": "Prepare a loan: calculate installments, rate and total for a given amount and term, and return the final terms for the user to review before disbursing. Does NOT move money.\n\nOperation Level: 1 (Read — only simulates, commits nothing)\n\nUse when the user says: \"quiero un préstamo de X a Y meses\", \"simula un crédito\", \"how much would the payments be\".",
  "inputSchema": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "object",
        "description": "Requested loan amount.",
        "properties": {
          "value": {"type": "number", "minimum": 100000, "description": "Principal requested."},
          "currency": {"type": "string", "enum": ["COP"], "description": "ISO 4217 currency code."}
        },
        "required": ["value", "currency"]
      },
      "term_months": {
        "type": "integer",
        "enum": [6, 12, 18, 24],
        "description": "Repayment term in months. Must be one of the offered terms."
      }
    },
    "required": ["amount", "term_months"]
  },
  "annotations": { "readOnlyHint": true }
}
```

- **P3:** `amount` estructurado con `currency` explícito y `minimum`; `term_months` es un `enum` — el agente **no puede** pedir 1200 meses ni inventar el plazo.
- **P5:** `amount` con la forma `{value, currency}` igual que en `get_loan_offers` → las salidas encajan en las entradas.
- **Granularidad:** una sola llamada hace create+simulate+confirm por dentro.

Respuesta — fíjate que **no desembolsa**, devuelve `pending_confirmation`:

```json
{
  "status": "pending_confirmation",
  "confirmation": {
    "operation": "loans_disburse",
    "summary": "Préstamo de $1.000.000 COP a 12 meses",
    "details": {
      "amount": {"value": 1000000, "currency": "COP"},
      "term_months": 12,
      "monthly_installment": {"value": 91680, "currency": "COP"},
      "annual_rate_pct": 18.5,
      "total_to_repay": {"value": 1100160, "currency": "COP"},
      "disburse_to_account": "ACC-12345678"
    },
    "confirmation_method": {
      "tool": "loans_disburse",
      "params": {
        "request_id": "req_abc123",
        "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
      }
    },
    "expires_at": "2026-06-12T15:30:00Z"
  },
  "formatted": "Préstamo de $1.000.000 a 12 meses:\n- Cuota mensual: $91.680\n- Tasa: 18,5% anual\n- Total a pagar: $1.100.160\n- Se desembolsa a: ACC-12345678",
  "message_for_user": "Tu préstamo de $1.000.000 a 12 meses queda en cuotas de $91.680 (total $1.100.160). ¿Confirmo el desembolso?"
}
```

- **P9:** la tool de preparación **no ejecuta nada irreversible**. Devuelve los términos completos y la "receta" exacta para desembolsar (`confirmation_method`), incluyendo una `idempotency_key` ya generada.
- **P6:** el usuario ve exactamente qué va a pasar antes de que pase.

#### 3. `loans_disburse` — la única tool que mueve dinero

```json
{
  "name": "loans_disburse",
  "description": "Disburse a prepared loan to the user's account. This moves money and cannot be undone. Only call after the user has explicitly approved the terms returned by loans_prepare_request.\n\nOperation Level: 4 (Financial — requires user confirmation)\n\nUse only to execute a confirmation the user already approved.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "request_id": {
        "type": "string",
        "description": "The prepared request to disburse, from loans_prepare_request.",
        "pattern": "^req_[a-z0-9]+$"
      },
      "idempotency_key": {
        "type": "string",
        "format": "uuid",
        "description": "Unique key to prevent duplicate disbursement. Reuse the one from loans_prepare_request on retries."
      }
    },
    "required": ["request_id", "idempotency_key"]
  },
  "annotations": { "destructiveHint": true, "idempotentHint": true }
}
```

- **P8:** Nivel 4 declarado en la descripción + `destructiveHint` → el cliente MCP exige aprobación humana (push/OTP/biometría) antes de ejecutar.
- **P11:** **no recibe `authToken`** ni `userId`. La autorización viaja por la sesión autenticada; el `request_id` es un operando legítimo que el agente descubrió en el paso anterior.
- **P10:** acepta `idempotency_key`. Si la red falla y el agente reintenta, el backend reconoce la llave y devuelve el resultado original — **no desembolsa dos veces**.

Respuesta exitosa:

```json
{
  "status": "completed",
  "data": {
    "loan_id": "loan_xyz789",
    "disbursed": {"value": 1000000, "currency": "COP"},
    "to_account": "ACC-12345678",
    "first_payment_date": "2026-07-12",
    "reference": "REF-2026-0612-001"
  },
  "formatted": "✅ Desembolsado $1.000.000 a la cuenta ACC-12345678. Referencia REF-2026-0612-001. Primer pago: 12 jul 2026.",
  "message_for_user": "Listo, transferí $1.000.000 a tu cuenta. Tu primer pago es el 12 de julio. Referencia: REF-2026-0612-001.",
  "available_actions": [
    {"tool": "get_loan_status", "params": {"loan_id": "loan_xyz789"}, "label": "Ver estado del préstamo"},
    {"tool": "get_account_balances", "params": {"account_id": "ACC-12345678"}, "label": "Ver saldo actualizado"}
  ]
}
```

Y la respuesta ante un reintento con la misma llave (P10 en acción):

```json
{
  "status": "already_processed",
  "data": { "loan_id": "loan_xyz789", "reference": "REF-2026-0612-001" },
  "message_for_user": "Este desembolso ya se procesó. Referencia: REF-2026-0612-001."
}
```

#### 4. `get_loan_status` — cierre del grafo

```json
{
  "name": "get_loan_status",
  "description": "Get the current status of a loan (balance, next payment, installments paid).\n\nOperation Level: 1 (Read)\n\nUse when the user says: \"cómo va mi préstamo\", \"cuánto debo\", \"cuándo es mi próximo pago\", \"loan status\".",
  "inputSchema": {
    "type": "object",
    "properties": {
      "loan_id": {"type": "string", "pattern": "^loan_[a-z0-9]+$", "description": "The loan to query. Obtain from loans_disburse or list the user's loans."}
    },
    "required": ["loan_id"]
  },
  "annotations": { "readOnlyHint": true }
}
```

Con respuesta rica (`data` + `formatted` + `message_for_user` + `available_actions` que ofrezca, p. ej., adelantar un pago).

---

## El flujo completo, lado a lado

**Antes** (6 tools, mapeo de endpoints):

```
Usuario: "necesito un millón a 12 meses"
  → el agente duda entre create_request y otras create_*   (P1)
  → adivina amount: 1000000 (¿COP? ¿USD?) y months: 12     (P2, P3)
  → no tiene userId; lo inventa o falla                     (P11)
  → create_request → {requestId}  ... ¿y ahora qué?         (P6, P7)
  → simulate → confirm → disburse (¡sin confirmar!)         (P8, P9)
  → la red falla, reintenta disburse → DOBLE DESEMBOLSO     (P10)
```

**Después** (4 tools, por intención):

```
Usuario: "necesito un millón a 12 meses"
  → get_loan_offers (sin userId, lo da la sesión)           (P11)
      ↳ available_actions apunta a loans_prepare_request    (P7)
  → loans_prepare_request(amount:{value:1000000,currency:COP}, term_months:12)  (P3)
      ↳ devuelve pending_confirmation con cuotas y total     (P9)
      ↳ "¿Confirmo el desembolso?"                           (P6)
Usuario: "sí"
  → loans_disburse(request_id, idempotency_key)              (P8, P10, P11)
      ↳ completed + available_actions a get_loan_status      (P7)
```

Mismo backend. La diferencia está enteramente en cómo se exponen las tools al agente.

---

## La lección

El backend no cambió ni una línea — los seis endpoints siguen ahí. Lo que cambió es que dejamos de exponerlos como un espejo de la base de datos y empezamos a exponerlos como **un menú de intenciones para un lector que interpreta, no ejecuta**:

1. **Empieza por las intenciones del usuario, no por los endpoints.** Eso define cuántas tools hay y dónde van las costuras.
2. **El schema es tu contención.** Todo lo que no restrinjas, el modelo lo improvisa.
3. **La respuesta es un brief, no un volcado.** Dile al agente qué pasó y qué sigue.
4. **Separa decidir de ejecutar, y blinda lo irreversible.** Niveles, confirmación delegada, idempotencia.
5. **La identidad nunca es un parámetro.** Es la frontera de confianza.

Para revisar tu propio catálogo contra cada principio, usa el **[checklist de calidad](mcp-tool-design-guide.md#checklist-de-calidad)** de la guía.
