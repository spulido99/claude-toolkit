# Guía de Diseño de Tools para MCP

Cómo diseñar tools de MCP que los agentes puedan **descubrir, entender y componer** correctamente. Esta guía es agnóstica al lenguaje: todos los ejemplos usan definiciones MCP en JSON (nombre + descripción + `inputSchema`) y respuestas JSON, aplicables a cualquier SDK (Python, TypeScript, etc.).

> **La idea central:** el modelo no ve tu código. Solo ve el **nombre**, la **descripción** y el **schema** de la tool, y el **JSON que devuelves**. Esas cuatro cosas *son* tu API para el agente — diséñalas con el mismo rigor que una API pública.

---

## Anatomía de una tool MCP

Toda tool MCP se define con tres elementos:

```json
{
  "name": "get_account_balances",
  "description": "Retrieve current balances for all sub-accounts (checking, savings, credit).\n\nOperation Level: 1 (Read)\n\nUse when the user says: \"check my balance\", \"how much do I have\", \"account balance\".",
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

| Elemento | Lo decide | Función para el agente |
|----------|-----------|------------------------|
| `name` | Tú | Cómo el agente **selecciona** la tool entre decenas disponibles |
| `description` | Tú | Cuándo usarla, qué hace, qué devuelve |
| `inputSchema` | Tú | Qué parámetros pasar, con qué tipos y restricciones |
| Respuesta JSON | Tú | Qué hacer con el resultado y cuál es el siguiente paso |

Los 11 principios siguientes cubren cómo diseñar bien cada uno de estos elementos.

---

## Principio 1: Claridad semántica, no CRUD

Nombra las tools por **operación de dominio**, no por método HTTP ni patrón CRUD. El agente selecciona la tool por su nombre y descripción — los nombres genéricos causan confusión y selección incorrecta.

| Nombre malo | Nombre bueno | Por qué |
|-------------|--------------|---------|
| `get_resource` | `get_account_balances` | Especifica dominio y operación |
| `post_data` | `submit_loan_application` | Describe la intención de negocio |
| `update_record` | `change_shipping_address` | Acción clara de cara al usuario |
| `delete_item` | `cancel_subscription` | Consecuencia específica del dominio |

**Regla práctica:** si el nombre de la tool completa la frase *"necesito ___"* de forma natural, está bien nombrada.

**Casing:** nombres de tools, parámetros **y campos de respuesta** van todos en `snake_case` (`loans_simulate`, `installments_quantity`), nunca camelCase (`installmentsQuantity`) ni Header-Case (`Request-Token`). Esto es mecánico: se aplica con linter, no con criterio.

---

## Principio 2: Compatibilidad con lenguaje natural

Las tools deben ser descubribles a través del lenguaje que los usuarios realmente hablan.

### Frases gatillo en la descripción

Incluye en la descripción ejemplos de lo que diría el usuario:

```json
{
  "name": "search_transactions",
  "description": "Search transaction history by description, merchant, or amount.\n\nUse when the user says: \"find a charge\", \"search my transactions\", \"look for a payment\", \"when did I pay\", \"find purchase from [merchant]\".",
  "inputSchema": {
    "type": "object",
    "properties": {
      "account_id": {"type": "string", "description": "Account identifier."},
      "query": {"type": "string", "description": "Natural language search (merchant name, amount, description)."},
      "date_from": {"type": "string", "format": "date", "description": "Start date (YYYY-MM-DD). Defaults to 30 days ago."},
      "date_to": {"type": "string", "format": "date", "description": "End date (YYYY-MM-DD). Defaults to today."}
    },
    "required": ["account_id", "query"]
  }
}
```

### Patrón search-first

Diseña tools para que el agente encuentre entidades por **nombre o alias**, no solo por IDs internos opacos que el usuario nunca conoce:

```json
{
  "name": "find_customer",
  "description": "Find a customer by name, email, or phone number.\n\nUse when the user says: \"find customer\", \"look up [name]\", \"search for client\".\n\nAt least one parameter is required. Returns best matches ranked by confidence. Use the returned customer_id for subsequent operations.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "description": "Full or partial customer name."},
      "email": {"type": "string", "format": "email"},
      "phone": {"type": "string", "description": "Phone in E.164 format: +573001234567."}
    }
  }
}
```

❌ Mal: `get_customer(customer_id)` como única vía de entrada — exige un ID que el usuario no conoce.
✅ Bien: `find_customer` por identificadores naturales primero; el `customer_id` retornado alimenta las demás tools.

---

## Principio 3: Tipos estructurados con JSON Schema

Usa **tipos explícitos y restricciones** en el `inputSchema` en lugar de strings libres. Esto previene errores del agente y permite validar antes de ejecutar.

```json
{
  "name": "transfer_funds",
  "inputSchema": {
    "type": "object",
    "properties": {
      "amount": {
        "type": "object",
        "description": "Money object with value and currency.",
        "properties": {
          "value": {"type": "number", "minimum": 0.01, "description": "Amount to transfer."},
          "currency": {"type": "string", "enum": ["USD", "EUR", "COP"], "description": "ISO 4217 currency code."}
        },
        "required": ["value", "currency"]
      },
      "from_account": {"type": "string", "pattern": "^ACC-[0-9]{8}$", "description": "Source account ID."},
      "to_account": {"type": "string", "pattern": "^ACC-[0-9]{8}$", "description": "Destination account ID."},
      "idempotency_key": {"type": "string", "format": "uuid", "description": "Unique key to prevent duplicate transfers."}
    },
    "required": ["amount", "from_account", "to_account"]
  }
}
```

### Patrones de tipos estándar

| Concepto | ❌ Mal | ✅ Bien |
|----------|-------|--------|
| Dinero | `"amount": {"type": "number"}` (¿USD? ¿centavos?) | Objeto `{"value": N, "currency": "X"}` con enum ISO 4217 |
| Fecha | String libre ("el próximo viernes") | `"format": "date"` → `YYYY-MM-DD` |
| Teléfono | String libre | E.164: `+573001234567` |
| Paginación | `"page": {"type": "integer"}` | `"cursor": {"type": "string"}` (opaco, forward-only) |
| Enum | `"status": {"type": "string"}` | `"enum": ["active", "suspended", "closed"]` |

Aprovecha todo lo que JSON Schema te da: `pattern`, `enum`, `minimum`/`maximum`, `format`, `default`. Cada restricción que declares es un error que el agente no puede cometer.

---

## Principio 4: Errores accionables

Cuando una tool falla, la respuesta debe decirle al agente **qué salió mal y qué hacer a continuación**. Nunca devuelvas strings de error pelados.

```json
// ❌ Mal: el agente no sabe qué hacer
{"error": "Not found"}

// ✅ Bien: error accionable con remediación
{
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

### Schema de error

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `code` | Sí | Código legible por máquina (`UPPER_SNAKE_CASE`) |
| `message` | Sí | Explicación legible por humanos |
| `remediation` | Sí | Qué debe hacer el agente a continuación |
| `details` | No | Contexto adicional del error |
| `suggestions` | No | Llamadas a tools concretas que podrían resolver el problema |

> **Nota MCP:** además del payload de error, marca la respuesta con `isError: true` en el resultado de `tools/call` para que el cliente lo distinga de un resultado exitoso.

---

## Principio 5: Terminología consistente

Usa **un solo término por concepto** en todo el catálogo de tools. Los nombres inconsistentes obligan al agente a aprender sinónimos y aumentan el riesgo de alucinación.

| Concepto | Usar siempre | Nunca usar |
|----------|--------------|------------|
| Identificador de cuenta | `account_id` | `acct_id`, `account_number`, `acct_num` |
| Identificador de cliente | `customer_id` | `client_id`, `user_id`, `cust_id` |
| Monto de dinero | `{"value": N, "currency": "X"}` | `amount: float`, `price: str` |
| Fecha | `YYYY-MM-DD` | `MM/DD/YYYY`, `DD-MM-YYYY`, epoch |
| Timestamp | ISO 8601 (`2026-01-15T10:30:00Z`) | Unix epoch, formatos custom |
| Cursor de paginación | `cursor` | `page_token`, `next_id`, `offset` |
| Query de búsqueda | `query` | `q`, `search_term`, `keyword` |
| Orden | `sort_by`, `sort_order` | `order`, `ordering`, `sort_field` |

**En la práctica:** mantén un **glosario del proyecto** (una tabla como esta, versionada en el repo) y define los tipos compartidos (Money, paginación) **una sola vez** como `$defs` de JSON Schema reutilizados por todas las tools.

```json
{
  "$defs": {
    "money": {
      "type": "object",
      "properties": {
        "value": {"type": "number"},
        "currency": {"type": "string", "description": "ISO 4217"}
      },
      "required": ["value", "currency"]
    },
    "paginated_request": {
      "type": "object",
      "properties": {
        "cursor": {"type": "string"},
        "limit": {"type": "integer", "default": 20, "maximum": 100}
      }
    }
  }
}
```

---

## Principio 6: Respuestas con semántica rica

Toda respuesta debe incluir suficiente contexto para que el agente **actúe sobre el resultado sin llamadas adicionales**. Usa un envelope estándar:

```json
{
  "data": {
    "account_id": "ACC-12345678",
    "balances": [
      {"type": "checking", "available": {"value": 2500.00, "currency": "USD"}},
      {"type": "savings", "available": {"value": 15000.00, "currency": "USD"}}
    ]
  },

  "formatted": "Account ACC-12345678 balances:\n- Checking: $2,500.00\n- Savings: $15,000.00\n- Total: $17,500.00",

  "available_actions": [
    {"tool": "get_transactions", "params": {"account_id": "ACC-12345678"}, "label": "View recent transactions"},
    {"tool": "transfer_funds", "params": {"from_account": "ACC-12345678"}, "label": "Transfer funds"}
  ],

  "message_for_user": "Here are your current balances. Would you like to see recent transactions or make a transfer?",

  "metadata": {
    "as_of": "2026-01-15T10:30:00Z",
    "cache_ttl_seconds": 60
  }
}
```

| Campo | Obligatorio | Propósito |
|-------|-------------|-----------|
| `data` | Sí | Datos estructurados para uso programático |
| `formatted` | Sí | Texto pre-formateado para mostrar (reduce alucinación: el agente no tiene que formatear cifras) |
| `available_actions` | Sí | Próximos pasos posibles (ver Principio 7) |
| `message_for_user` | Sí | Respuesta sugerida para transmitir al usuario |
| `formatted_spoken` | No | Versión optimizada para voz (sin símbolos, números deletreados) |
| `metadata` | No | Timestamps, hints de caché, info de debug |

> **Nota MCP:** declara la forma de `data` en el `outputSchema` de la tool (soportado desde la spec 2025-06) y devuelve el JSON como `structuredContent`. Los clientes que no lo soporten reciben el mismo JSON serializado en el bloque `text`.

---

## Principio 7: Available actions (grafo de tools)

Toda respuesta **debe** incluir `available_actions`: una lista de próximos pasos lógicos. Esto crea un **grafo navegable** que guía al agente a través de workflows multi-paso sin orquestación hardcodeada.

Sin available actions, el agente debe razonar desde cero qué hacer después de cada llamada — más latencia, más tokens, más errores. Con ellas, tiene un menú curado de pasos contextualmente apropiados.

```
get_account_balances
    ├──> get_account_details
    ├──> get_transactions
    └──> transfer_funds

get_transactions
    ├──> get_transaction_details
    ├──> dispute_transaction
    └──> export_transactions

transfer_funds (pending_confirmation)
    ├──> confirm_transfer
    └──> cancel_pending_operation
```

### Acciones dinámicas según el estado

Las acciones deben ser **contextuales** — solo muestra las válidas en el estado actual:

```json
"available_actions": [
  {"tool": "get_transactions", "params": {"account_id": "ACC-12345678"}, "label": "View transactions"},
  // Solo si balance > 0:
  {"tool": "transfer_funds", "params": {"from_account": "ACC-12345678"}, "label": "Transfer funds"},
  // Solo si no hay alerta configurada ya:
  {"tool": "set_balance_alert", "params": {"account_id": "ACC-12345678"}, "label": "Set low-balance alert"}
]
```

Cada acción incluye: `tool` (nombre exacto), `params` (pre-rellenados con lo que ya se sabe), `label` y opcionalmente `description`.

---

## Principio 8: Niveles de operación

Clasifica toda tool por su **nivel de impacto** para determinar qué confirmación requiere. Esta clasificación es la base de la operación autónoma segura.

| Nivel | Categoría | Descripción | Confirmación | Ejemplo |
|-------|-----------|-------------|--------------|---------|
| 1 | Read | Lee datos, sin efectos secundarios | Ninguna | `get_account_balances`, `search_transactions` |
| 2 | Create/List | Crea recursos de bajo riesgo, lista datos | Ninguna | `create_support_ticket`, `list_accounts` |
| 3 | Update | Modifica recursos existentes | El agente confirma en chat | `change_shipping_address`, `update_profile` |
| 4 | Financial | Movimiento de dinero, cobros | Usuario confirma (push/OTP/biometría) | `transfer_funds`, `process_refund` |
| 5 | Irreversible | No se puede deshacer | Aprobación explícita multi-factor + delay | `close_account`, `delete_all_data` |

**Criterios de asignación:**
- **Nivel 1:** solo lee; llamarla dos veces da el mismo resultado.
- **Nivel 2:** crea algo nuevo pero de bajo riesgo y usualmente reversible (ticket, nota, tag).
- **Nivel 3:** modifica datos existentes, no financiero pero afecta la experiencia del usuario.
- **Nivel 4:** involucra dinero. **Incluso montos pequeños son Nivel 4.**
- **Nivel 5:** no se puede revertir por ningún medio.

**Declara el nivel en la descripción** de la tool — es la única forma de que el agente (y el cliente MCP) lo vean:

```json
{
  "name": "transfer_funds",
  "description": "Transfer funds between accounts.\n\nOperation Level: 4 (Financial - requires user confirmation)\n\nUse when the user says: \"transfer money\", \"send funds\"."
}
```

> **Nota MCP:** complementa el nivel con las `annotations` estándar de MCP: `readOnlyHint` (nivel 1), `destructiveHint` (niveles 4–5), `idempotentHint`, `openWorldHint`. Los clientes las usan para decidir qué llamadas requieren aprobación humana.

---

## Principio 9: Confirmaciones delegadas

Las operaciones de **Nivel 3 en adelante** no deben ejecutarse inmediatamente. La tool devuelve `pending_confirmation` con los detalles completos, el agente los presenta al usuario, y la ejecución real ocurre en una **segunda tool** tras la aprobación.

### Flujo

```
1. El agente llama transfer_funds
2. La tool valida y devuelve status: "pending_confirmation" con detalles
3. El agente presenta al usuario: "Transferir $150 a Ahorros. ¿Procedo?"
4. El usuario aprueba (chat, push, biometría — según el nivel)
5. El agente llama confirm_transfer
6. La tool ejecuta y devuelve el resultado final
```

### Respuesta de confirmación pendiente

```json
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
      "estimated_arrival": "2026-01-16",
      "fee": {"value": 0.00, "currency": "USD"}
    },
    "confirmation_method": {
      "tool": "confirm_transfer",
      "params": {
        "transfer_id": "TXN-20260115-001",
        "idempotency_key": "550e8400-e29b-41d4-a716-446655440000"
      }
    },
    "cancel_method": {
      "tool": "cancel_pending_operation",
      "params": {"operation_id": "TXN-20260115-001"}
    },
    "expires_at": "2026-01-15T11:00:00Z"
  },
  "message_for_user": "I'd like to transfer $150.00 from Main Checking to Joint Savings. No fees apply. Shall I proceed?"
}
```

**Por qué delegar:** el usuario ve exactamente qué va a pasar antes de que pase; los niveles 4+ pueden exigir biometría/OTP por un canal separado; y queda un audit trail de quién aprobó qué, cuándo y por dónde.

| Nivel | Canal de confirmación |
|-------|----------------------|
| 3 | Confirmación en chat ("¿Procedo?") |
| 4 | Push en la app / OTP / biometría |
| 5 | Multi-factor + período de espera |

---

## Principio 10: Llaves de idempotencia

Toda tool **transaccional** (Nivel 3+) debe aceptar un parámetro `idempotency_key` para prevenir ejecución duplicada por reintentos, fallos de red o loops del agente.

### Cómo funciona

1. El agente genera un UUID antes de la primera llamada
2. Lo pasa como `idempotency_key`
3. El backend guarda la llave junto con el resultado de la operación
4. Si llega la misma llave de nuevo, el backend devuelve el **resultado original** sin re-ejecutar:

```json
{
  "status": "already_processed",
  "data": { "reference": "REF-88321" },
  "message_for_user": "This transfer was already processed. Reference: REF-88321."
}
```

### Reglas

| Regla | Descripción |
|-------|-------------|
| Formato | UUID v4 o determinístico `{operation}-{entity_id}-{timestamp}` |
| Alcance | Por tool, por usuario |
| TTL | Mínimo 24 horas para operaciones financieras |
| Colisión | Devolver el resultado original, **no** ejecutar de nuevo |
| Responsabilidad del agente | Generar la llave antes de la primera llamada, reusarla en reintentos |

---

## Principio 11: Parámetros seguros

Los parámetros de una tool son **totalmente controlables por el LLM** — puede pasar cualquier valor a cualquier parámetro. Por lo tanto, **ningún secreto, credencial, token ni identidad del llamador puede ser un parámetro.** Eso se inyecta del lado del servidor, invisible al modelo.

Este es un principio de **frontera de confianza**, independiente del tipado (Principio 3): hasta un `user_id: string` perfectamente tipado es inseguro como parámetro, porque el agente podría pasar el ID de *cualquier* usuario y leer sus datos.

### Lo que nunca va en `inputSchema`

| Nunca como parámetro | Por qué | Inyectar en su lugar vía |
|----------------------|---------|--------------------------|
| Identidad del llamador: `user_id`, `customer_id`, `tenant_id` | El agente podría suplantar a cualquier usuario / cruzar tenants | Contexto de auth de la sesión (headers del gateway, p. ej. `x-claims`) |
| Credenciales: `api_key`, `token`, `secret`, `password` | Se loguean o se filtran a través del modelo | Configuración/credenciales del servidor |
| Tokens anti-fraude (attestation de dispositivo, etc.) | Falsificables si el modelo los controla | Header del gateway, ligado al request server-side |

```json
// ❌ Mal: identidad y token como parámetros — el LLM los controla
{
  "name": "disburse_loan",
  "inputSchema": {
    "type": "object",
    "properties": {
      "request_id": {"type": "string"},
      "user_id": {"type": "string"},
      "fraud_token": {"type": "string"}
    }
  }
}

// ✅ Bien: solo el operando es parámetro; identidad + token vienen
// de los headers autenticados de la sesión MCP, resueltos server-side
{
  "name": "loans_disburse",
  "description": "Disburse a confirmed Mini Loan. Operation Level: 4 (Financial).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "request_id": {"type": "string", "description": "Confirmed loan request to disburse."},
      "idempotency_key": {"type": "string", "format": "uuid"}
    },
    "required": ["request_id", "idempotency_key"]
  }
}
```

**La distinción clave:** los identificadores de negocio que el agente legítimamente **descubre y pasa** (un `account_id` devuelto por una tool de búsqueda, un `request_id` de un borrador) sí son parámetros válidos. La línea divisoria es **identidad del llamador / credenciales vs. operandos**.

**Regla MCP:** si está en `inputSchema`, el modelo puede falsificarlo. Identidad y credenciales llegan por la capa de transporte/gateway (OAuth de la sesión MCP, headers como `x-claims`) y se resuelven en el servidor.

---

## Diseño a nivel de catálogo

Los 11 principios anteriores aplican a **una tool**. Tres decisiones adicionales dan forma al catálogo completo:

### Granularidad — una tool = una unidad de intención del usuario

Dimensiona cada tool a una **unidad de intención o decisión del usuario**, no a un endpoint del backend ni a un paso interno. Dos modos de fallo opuestos:

| Fallo | Síntoma | Solución |
|-------|---------|----------|
| **Sobre-fragmentada** | Dos tools siempre se llaman en secuencia y el resultado intermedio no tiene uso independiente (p. ej. un `request_id` que solo sirve para la siguiente llamada) | **Fusionar** en una tool |
| **Sobre-empaquetada** | Una tool esconde pasos que el agente querría componer, saltarse, reintentar o recuperar de forma independiente (validar → verificar stock → pagar) | **Dividir** en primitivas atómicas |

La costura natural es la frontera de `pending_confirmation` (Principio 9): todo lo previo a "listo para ejecutar" suele ser **una** tool de *preparación*, y la ejecución es **una** tool de *ejecución* — sin importar cuántos endpoints haya detrás de cada una.

**Ejemplo:** `loans_create_request` (devuelve solo un `request_id`) + `loans_confirm_request` (calcula los términos finales) deberían ser **una sola** `loans_prepare_request` que devuelva `pending_confirmation` — el `request_id` solo nunca es un punto de parada útil para el agente.

### Bounded contexts — agrupar por dominio

- Agrupa las tools por **dominio de negocio** (`accounts`, `transfers`, `support`), con prefijos consistentes en los nombres si el servidor expone varios dominios (`loans_simulate`, `loans_disburse`).
- **Máximo ~10 tools por dominio.** Si crece más, divide en sub-dominios (o en servidores MCP separados).
- Vocabulario y tipos compartidos (`Money`, paginación) definidos una vez por dominio.

### Paridad — todo lo que hace la UI, lo hace el agente

Toda acción de la UI debe tener una tool correspondiente, o una **exclusión documentada e intencional**. Las acciones huérfanas obligan al usuario a alternar entre agente y app.

| Acción de la UI | Tool | Estado |
|-----------------|------|--------|
| Ver saldos | `get_account_balances` | ✅ Cubierta |
| Transferir | `transfer_funds` | ✅ Cubierta |
| Disputar un cargo | `dispute_transaction` | ✅ Cubierta |
| Cambiar contraseña | N/A | ⚠️ Excluida intencionalmente (seguridad) |

**Exclusiones aceptables** (documéntalas para que no parezcan olvidos): cambios de autenticación (reset de contraseña, MFA), aceptación de términos legales, procesos KYC/AML.

---

## Ejemplo completo: una tool con todos los principios

### Definición

```json
{
  "name": "get_account_balances",
  "description": "Retrieve current balances for all sub-accounts (checking, savings, credit).\n\nOperation Level: 1 (Read)\n\nUse when the user says: \"check my balance\", \"how much do I have\", \"account balance\", \"what's in my account\".\n\nReturns balances by sub-account with available_actions for next steps.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "account_id": {
        "type": "string",
        "description": "The account to query. Format: ACC-XXXXXXXX. Obtain via find_customer or list_accounts.",
        "pattern": "^ACC-[0-9]{8}$"
      }
    },
    "required": ["account_id"]
  },
  "annotations": {
    "readOnlyHint": true
  }
}
```

### Respuesta exitosa

```json
{
  "status": "success",
  "data": {
    "account_id": "ACC-12345678",
    "balances": [
      {"type": "checking", "available": {"value": 2500.00, "currency": "USD"}},
      {"type": "savings", "available": {"value": 15000.00, "currency": "USD"}}
    ],
    "total": {"value": 17500.00, "currency": "USD"}
  },
  "formatted": "Account ACC-12345678 balances:\n- Checking: $2,500.00\n- Savings: $15,000.00\n- Total: $17,500.00",
  "message_for_user": "Here are your current account balances.",
  "available_actions": [
    {
      "tool": "get_transactions",
      "params": {"account_id": "ACC-12345678", "limit": 10},
      "label": "View recent transactions"
    },
    {
      "tool": "transfer_funds",
      "params": {"from_account": "ACC-12345678"},
      "label": "Transfer funds"
    }
  ],
  "metadata": {
    "as_of": "2026-01-15T10:30:00Z",
    "cache_ttl_seconds": 60
  }
}
```

### Respuesta de error

```json
{
  "status": "error",
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "No account found with ID 'ACC-99999999'.",
    "remediation": "Verify the account ID or use find_customer to search by name/email.",
    "suggestions": [
      {"tool": "find_customer", "reason": "Search for the customer to get the correct account ID", "params": {}},
      {"tool": "list_accounts", "reason": "List all accounts for the authenticated user", "params": {}}
    ]
  }
}
```

---

## Checklist de calidad

Verifica cada tool antes de publicarla en el servidor MCP.

### Nombres y semántica
- [ ] El nombre describe una **operación de dominio**, no un verbo CRUD (`get_account_balances`, no `get_resource`) — P1
- [ ] Tool, parámetros **y campos de respuesta** en `snake_case` — P1/P5
- [ ] **Un término por concepto** en todo el catálogo (siempre `account_id`, nunca `acct_id` en algunas tools) — P5
- [ ] Sin abreviaturas ni acrónimos salvo los universales — P1

### Descripción y descubrimiento
- [ ] Resumen de una línea de lo que hace — P2
- [ ] Incluye **frases gatillo** ("Use when the user says: ...") — P2
- [ ] Declara el **Operation Level** — P8
- [ ] Todos los parámetros documentados con tipo, formato, ejemplo y restricciones — P3
- [ ] Hay tool de **búsqueda por identificadores naturales** para cada entidad principal — P2

### Parámetros (`inputSchema`)
- [ ] Dinero en formato estructurado `{"value": N, "currency": "X"}` — nunca floats sueltos — P3
- [ ] Fechas en ISO 8601 — P3
- [ ] Enums documentados con valores permitidos en el schema — P3
- [ ] Defaults sensatos donde aplique (`limit: 20`) — P3
- [ ] **Sin secretos, tokens, credenciales ni identidad del llamador** como parámetros — P11
- [ ] Máximo ~15 parámetros — si hay más, dividir o anidar objetos

### Respuestas
- [ ] Envelope estándar: `data`, `formatted`, `available_actions`, `message_for_user` — P6
- [ ] Errores con `code`, `message`, `remediation` (y `suggestions` cuando aplique) — P4
- [ ] **Sin fugas de datos sensibles** (números de tarjeta completos, documentos, IDs internos de infraestructura)
- [ ] `available_actions` lista los próximos pasos lógicos, contextual al estado — P7

### Operaciones sensibles
- [ ] Nivel de operación asignado (1–5) — P8
- [ ] Tools Nivel 3+ devuelven `pending_confirmation` **antes** de ejecutar — P9
- [ ] Tools Nivel 4+ confirman por canal separado (push, OTP, biometría) — P9
- [ ] Tools transaccionales (Nivel 3+) aceptan `idempotency_key` — P10

### Catálogo (criterio, no checklist mecánica)
- [ ] Cada tool es **una unidad de intención del usuario** — ni sobre-fragmentada ni workflow empaquetado (Granularidad)
- [ ] Tools agrupadas por dominio, ≤10 por dominio (Bounded Contexts)
- [ ] Toda acción de la UI tiene tool o exclusión documentada (Paridad)

---

## Resumen: las 11 reglas en una tabla

| # | Principio | En una frase |
|---|-----------|--------------|
| 1 | Claridad semántica | Nombra por operación de dominio, no por CRUD |
| 2 | Lenguaje natural | Frases gatillo en la descripción; búsqueda por nombre, no solo por ID |
| 3 | Tipos estructurados | JSON Schema con restricciones; nada de strings libres para dinero/fechas/enums |
| 4 | Errores accionables | Todo error trae `code`, `message` y `remediation` |
| 5 | Terminología consistente | Un término por concepto en todo el catálogo |
| 6 | Semántica rica | Envelope `data` + `formatted` + `message_for_user` |
| 7 | Available actions | Toda respuesta lista los próximos pasos posibles |
| 8 | Niveles de operación | Clasifica 1–5 según impacto; decláralo en la descripción |
| 9 | Confirmaciones delegadas | Nivel 3+: preparar → `pending_confirmation` → ejecutar |
| 10 | Idempotencia | Nivel 3+ acepta `idempotency_key`; colisión = resultado original |
| 11 | Parámetros seguros | Identidad y credenciales jamás en `inputSchema` — se inyectan server-side |
