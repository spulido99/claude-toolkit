# Guía de Diseño de Tools para MCP

Cómo diseñar tools de MCP que los agentes puedan **descubrir, entender y componer** correctamente. Esta guía es agnóstica al lenguaje: todos los ejemplos usan definiciones MCP en JSON (nombre + descripción + `inputSchema`) y respuestas JSON, aplicables a cualquier SDK (Python, TypeScript, etc.).

> **La idea central:** el modelo no ve tu código. Solo ve el **nombre**, la **descripción** y el **schema** de la tool, y el **JSON que devuelves**. Esas cuatro cosas *son* tu API para el agente — diséñalas con el mismo rigor que una API pública.

> **Para quién es esto:** desarrolladores backend que construyen servidores MCP y no necesariamente conocen AI engineering. No hace falta saber de modelos ni de ML. Sí hace falta entender **quién va a consumir tus tools y cómo razona** — eso es lo que cubre la siguiente sección. Léela antes de los principios: cada principio resuelve un problema concreto que solo tiene sentido cuando entiendes al consumidor.

---

## Background: por qué esto no es una API REST

Todo lo demás en esta guía se deriva de una sola idea. Si la interiorizas, los 11 principios dejan de ser reglas que memorizar y pasan a ser consecuencias obvias.

### Tu API la consume un humano probabilístico, no un programa

Cuando expones una API REST, **otro programador** lee tu documentación, escribe código que arma el request, maneja los errores con `if/else` y los reintentos con una librería. El código es **determinístico**: dada la misma entrada, hace exactamente lo mismo siempre. Si tu doc es ambigua, el dev pregunta, prueba en Postman, y eventualmente lo resuelve **una vez** — y ese código queda fijo.

Un agente MCP es radicalmente distinto. El consumidor es un **modelo de lenguaje (LLM)**: un sistema que, dado un texto, **predice el siguiente texto más probable**. No ejecuta lógica que tú escribiste; *interpreta* lo que lee y *genera* su próxima acción. Piensa en él como un desarrollador junior brillante, increíblemente rápido, que:

- **Nunca leyó tu documentación aparte.** Lo único que conoce de tu tool es el `name`, la `description` y el `inputSchema` que le pasaste — todo junto, como un menú. No hay un README que abra en otra pestaña.
- **Decide en el momento, cada vez.** Ante la misma petición del usuario puede elegir una tool distinta hoy que ayer. No hay código fijo: hay una *decisión probabilística* en cada paso.
- **Si algo es ambiguo, no pregunta — adivina.** Y a veces inventa (esto se llama **alucinación**): se inventa un parámetro, un valor, o llama a una tool que no existe porque "sonaba razonable".
- **No tiene memoria de tu sistema.** Solo sabe lo que está en la conversación actual. Si una tool devuelve un ID opaco, el modelo no tiene una base de datos donde buscarlo; solo puede usar lo que le devolviste en texto.

### Cómo funciona una llamada a tool, mecánicamente

No hay magia. El ciclo es siempre el mismo:

```
1. Tú registras tus tools → el cliente MCP le entrega al modelo la lista
   completa de {name, description, inputSchema} como TEXTO.

2. El usuario dice algo: "¿cuánto tengo en mi cuenta?"

3. El modelo LEE el menú de tools y ELIGE una por su nombre y descripción.
   → Aquí fallan los nombres genéricos (Principio 1) y las descripciones
     sin cuándo-usar / cuándo-no (Principio 2).

4. El modelo GENERA los argumentos como JSON, ajustándose al inputSchema.
   → Aquí fallan los tipos ambiguos (Principio 3). Un schema laxo =
     el modelo rellena con lo que le parece.

5. Tu servidor ejecuta y DEVUELVE JSON.

6. El modelo LEE tu respuesta y decide: ¿terminé? ¿llamo otra tool?
   ¿le respondo al usuario?
   → Aquí fallan las respuestas pobres (Principios 4, 6, 7). Si no le
     dices qué pasó ni qué sigue, tiene que adivinar de nuevo.

7. Vuelve al paso 3 hasta resolver la petición.
```

Cada flecha "→" es un punto donde un buen diseño evita un error y un mal diseño lo provoca. **Los principios no son estética: cada uno tapa una de esas grietas.**

### Las cuatro consecuencias que cambian todo

| En una API REST… | En una tool MCP… | Por qué importa |
|------------------|------------------|-----------------|
| La doc se lee aparte, una vez | La "doc" (name + description) se lee **en cada decisión**, mezclada con decenas de otras tools | Si el nombre no se distingue solo, el modelo elige mal. No hay tiempo de "investigar". |
| El cliente maneja errores con código | El modelo "lee" el error en lenguaje natural y decide qué hacer | `{"error": "not found"}` no le dice nada. Necesita *qué hacer ahora* (Principio 4). |
| El cliente encadena llamadas con código que tú escribiste | El modelo decide el siguiente paso razonando sobre tu respuesta | Si no listas los próximos pasos (Principio 7), reinventa el flujo cada vez — más lento, más caro, más errores. |
| El cliente solo puede mandar lo que el código permite | El modelo puede poner **cualquier valor en cualquier parámetro** | Un `user_id` como parámetro = el modelo puede pedir los datos de *cualquiera* (Principio 11). |

### Por qué un mal diseño cuesta caro (no solo "feo")

Para un dev backend acostumbrado a que "si compila y responde 200, está bien", estos costos son nuevos y reales:

- **Tokens = dinero y latencia.** Cada vez que el modelo tiene que razonar de más (porque no le diste el siguiente paso, o porque tu error no fue claro), consume más tokens y tarda más. Una respuesta rica reemplaza varias rondas de adivinanza.
- **Bucles infinitos.** Si una tool falla sin decir cómo arreglarlo, el modelo puede reintentar lo mismo una y otra vez. Por eso los errores accionables (P4) y la idempotencia (P10) no son opcionales.
- **Errores silenciosos de selección.** No hay un compilador que grite. Si dos tools se llaman parecido, el modelo usa la equivocada y nadie se entera hasta que el usuario se queja.
- **Riesgo de seguridad real.** El modelo es manipulable por el texto del usuario (esto se llama *prompt injection*). Si la identidad viaja como parámetro, un usuario malicioso puede convencer al agente de suplantar a otro. Por eso P11 es una frontera de confianza, no un detalle.

### El cambio de mentalidad, en una frase

> Deja de diseñar para un **programa que ejecuta tu contrato** y empieza a diseñar para un **lector que interpreta tu intención**. Todo lo que reduzca la ambigüedad — nombres claros, tipos estrictos, errores que enseñan, respuestas que guían — hace al agente más confiable. Todo lo que la aumente, lo hace fallar de formas que no verás en los logs.

Con eso en mente, los 11 principios se leen solos. Cada uno empieza por el problema que resuelve.

---

## Anatomía de una tool MCP

Toda tool MCP se define con tres elementos:

```json
{
  "name": "get_account_balances",
  "description": "Retrieve current balances for all sub-accounts (checking, savings, credit).\n\nOperation Level: 1 (Read)\n\nUse when the user asks about available money — e.g. \"check my balance\", \"how much do I have\".\nDo NOT use for transaction history (use search_transactions).",
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

> **Por qué es importante:** el nombre es lo primero —y a veces lo único— que el modelo lee para elegir entre decenas de tools (paso 3 del ciclo). No hay un compilador que avise si elige mal: simplemente llama a la equivocada y el usuario recibe una respuesta incorrecta sin que nadie lo note. Con 5 tools `get_*` genéricas, el modelo *adivina* cuál usar; con nombres que dicen exactamente qué hacen, acierta a la primera. El nombre es tu mecanismo de routing.

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

> **Por qué es importante:** el usuario no habla en nombres de función — dice "¿cuándo pagué el arriendo?", no "invoca search_transactions". El modelo tiene que **tender el puente** entre esa frase y tu tool, y lo hace comparando el texto del usuario con tu descripción. Si pones las frases reales que diría el usuario en la descripción, el match es directo. Y si tu única vía de entrada es un ID interno que el usuario nunca conoce, el agente se queda atascado: no tiene de dónde sacarlo. Las tools de búsqueda son la puerta de entrada a todo el catálogo.

Las tools deben ser descubribles a través del lenguaje que los usuarios realmente hablan.

### Cuándo usar y cuándo NO usar

La descripción dice **cuándo usar** la tool (en el lenguaje del usuario) y **cuándo NO** — nombrando la tool hermana que sí cubre el caso excluido. Las líneas de "Do NOT use" son lo que evita que el modelo confunda tools parecidas; las frases gatillo literales son una técnica opcional que complementa (nunca reemplaza) esa prosa, útil cuando dos tools se solapan:

```json
{
  "name": "search_transactions",
  "description": "Search transaction history by description, merchant, or amount.\n\nUse when the user wants to find past movements — e.g. \"find a charge\", \"when did I pay [merchant]\".\nDo NOT use for current balances (use get_account_balances).",
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
  "description": "Find a customer by name, email, or phone number.\n\nUse when the user refers to a customer by name — e.g. \"look up [name]\", \"search for client\". Do NOT use when you already have the customer_id (use get_customer).\n\nAt least one parameter is required. Returns best matches ranked by confidence. Use the returned customer_id for subsequent operations.",
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

> **Por qué es importante:** el modelo **genera** los argumentos (paso 4 del ciclo), y rellena cualquier hueco que dejes con lo que le parezca más probable. Un `amount: number` no le dice si son dólares o pesos, dólares o centavos — y va a *suponer*. Cada restricción que escribes en el schema (`enum`, `pattern`, `minimum`, `format`) es una decisión que le quitas de las manos y un error que se vuelve imposible. El schema no es documentación: es la barrera de contención. Lo que no restrinjas, el modelo lo improvisa.

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
      "idempotency_key": {"type": "string", "description": "Key returned by a previous pending_confirmation. Echo it on confirm/retries; omit on first call."}
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

> **Por qué es importante:** en una API REST el error lo maneja código con `try/catch`. Aquí lo "maneja" el modelo *leyéndolo* y decidiendo qué hacer. `{"error": "not found"}` no le da nada con qué decidir, así que hace lo peor posible: reintenta lo mismo —a veces en bucle, quemando tokens y tiempo— o le inventa una excusa al usuario. Un error que dice *qué pasó* y *qué hacer ahora* (con tools concretas que sugerir) convierte un callejón sin salida en el siguiente paso del flujo. El error es una instrucción de recuperación, no un reporte de fallo.

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

> **Por qué es importante:** el modelo trata el catálogo entero como un solo texto y aprende patrones de él. Si una tool devuelve `account_id` y otra lo pide como `acct_id`, el modelo tiene que *inferir* que son lo mismo — y a veces falla: pasa el valor al campo equivocado o se inventa el formato. Cada sinónimo es una oportunidad de error que tú creaste gratis. Un término por concepto hace que la salida de una tool encaje sin fricción en la entrada de la siguiente. La consistencia no es prolijidad: es lo que hace que las tools se compongan.

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

### Califica los identificadores genéricos por dominio

Un `id`, `request_id`, `reference` o `token` a secas es **ambiguo** en cuanto puede existir más de un tipo en el catálogo. Si tienes solicitudes de préstamo, de transferencia y de soporte, un campo llamado `request_id` obliga al agente a recordar *cuál* solicitud tiene en la mano — y arriesga que pase la equivocada a la tool equivocada. Califícalo por dominio:

| ❌ Ambiguo | ✅ Calificado por dominio |
|-----------|---------------------------|
| `request_id` | `loan_request_id`, `transfer_request_id` |
| `id` (devuelto por `get_loan`) | `loan_id` |
| `reference` | `payment_reference`, `refund_reference` |
| `token` | `confirmation_token` |

El nombre calificado viaja con el valor: `loans_prepare_request` devuelve un `loan_request_id` y `loans_disburse` acepta exactamente ese `loan_request_id` — el agente nunca tiene que adivinar a qué se refiere un `request_id` genérico. Quédate con el nombre genérico **solo** cuando el concepto es realmente transversal y de un solo significado (`cursor`, `idempotency_key`).

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

> **Por qué es importante:** lo que devuelves es lo único que el modelo "ve" del resultado — y todo lo que no le des, lo va a reconstruir solo, gastando tokens y arriesgando errores. Si devuelves solo datos crudos, el modelo tiene que formatear las cifras él mismo (y puede equivocarse con un número). Pero el costo corre en ambas direcciones: la respuesta es contexto del agente y se **re-lee en cada turno** de la conversación, así que cada campo redundante se paga muchas veces. La respuesta no es un volcado de la base de datos: es un brief de alta señal para el agente.

La respuesta da al agente lo que necesita para **actuar sobre el resultado sin llamadas adicionales** — sin inflar el contexto con representaciones redundantes. Usa un envelope estándar:

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

  "metadata": {
    "as_of": "2026-01-15T10:30:00Z",
    "cache_ttl_seconds": 60
  }
}
```

| Campo | Obligatorio | Propósito |
|-------|-------------|-----------|
| `data` | Sí | Datos estructurados para uso programático |
| `formatted` | Recomendado | Texto pre-formateado para mostrar (reduce alucinación: el agente no tiene que formatear cifras) |
| `available_actions` | Contextual | Solo cuando llevan estado del servidor o un nudge curado (ver Principio 7) |
| `formatted_spoken` | Solo canales de voz | Versión optimizada para voz (sin símbolos, números deletreados) |
| `metadata` | No | Timestamps, hints de caché, info de debug |

Reglas de alta señal:

- **Ningún campo duplica a otro.** Versiones anteriores de este patrón pedían un `message_for_user` además de `formatted`; en la práctica eran el mismo string — una sola representación de display basta.
- **Por defecto, respuestas magras** con flags de detalle opt-in (`include_details: false`).
- **El texto externo es dato, no instrucción**: descripciones de transacciones, memos y nombres de terceros pueden traer cualquier cosa (incluido texto diseñado para manipular al agente). Va dentro de `data`, delimitado donde aparezca en `formatted`, y jamás se usa para derivar acciones.

> **Nota MCP:** declara la forma de `data` en el `outputSchema` de la tool (soportado desde la spec 2025-06) y devuelve el JSON como `structuredContent`. Los clientes que no lo soporten reciben el mismo JSON serializado en el bloque `text`.

---

## Principio 7: Available actions (grafo de tools)

> **Por qué es importante:** el agente ya tiene el catálogo completo de tools en su contexto — repetírselo en cada respuesta no le aporta nada y le cuesta tokens en cada turno. Lo que el catálogo **no puede** decirle es qué es posible *ahora mismo*: que hay una transferencia preparada con el ID `TXN-...` que expira a las 11:00, o que el backend sabe que conviene ofrecerle algo concreto después de este paso. Eso solo puede viajar en la respuesta — y para eso existen las `available_actions`.

`available_actions` se gana sus tokens cuando lleva algo que el catálogo no puede expresar. Tres casos:

| Caso | Regla | Ejemplo |
|------|-------|---------|
| **Estado del servidor** que el catálogo no puede expresar | **Incluir — para esto existe el patrón** | `pending_confirmation` exponiendo `confirm_transfer(transfer_id=...)` con su expiración; `suggestions` en errores |
| **Nudge curado de alto valor** del backend | Incluir deliberadamente | Tras `create_investment`, sugerir `simulate_investment` con un plazo que el backend sabe que rinde mejor |
| **Repetir el catálogo** | **Omitir** | Tras `get_account_balances`, sugerir `transfer_funds` sin params — el agente ya tiene todas las descripciones |

```
transfer_funds (pending_confirmation)
    ├──> confirm_transfer
    └──> cancel_pending_operation

dispute_transaction (pending_confirmation)
    ├──> confirm_dispute
    └──> cancel_pending_operation
```

### Acciones dinámicas según el estado

Las acciones se derivan de **estado del servidor y reglas de negocio** (nunca del contenido textual de los registros — ver Principio 6):

```json
"available_actions": [
  // Solo si hay una operación pendiente en esta cuenta:
  {"tool": "cancel_pending_operation", "params": {"operation_id": "TXN-20260115-001"}, "label": "Cancel pending transfer"},
  // Nudge curado: el backend sabe que hay una tasa promocional disponible:
  {"tool": "simulate_investment", "params": {"term_days": 180}, "label": "Simulate a 180-day investment at the promotional rate"}
]
```

Cada acción incluye: `tool` (nombre exacto), `params` (pre-rellenados con el estado que el agente no podría inferir), `label` y opcionalmente `description`.

---

## Principio 8: Niveles de operación

> **Por qué es importante:** un agente es **autónomo** — puede decidir llamar a `transfer_funds` sin que un humano apriete un botón. Eso es justo lo poderoso y lo peligroso. Sin una clasificación de impacto, leer un saldo y vaciar una cuenta se tratan igual, y el modelo (que es manipulable por el texto del usuario) podría ejecutar algo irreversible por su cuenta. Etiquetar cada tool con su nivel le dice al cliente MCP *cuándo frenar y pedir aprobación humana*. Es el freno de mano de la autonomía: define dónde el agente puede actuar solo y dónde no.

Clasifica toda tool por su **nivel de impacto** para determinar qué confirmación requiere. Esta clasificación es la base de la operación autónoma segura.

| Nivel | Categoría | Descripción | Confirmación | Ejemplo |
|-------|-----------|-------------|--------------|---------|
| 1 | Read | Lee datos, sin efectos secundarios | Ninguna | `get_account_balances`, `search_transactions` |
| 2 | Create/List | Crea recursos de bajo riesgo, lista datos | Ninguna | `create_support_ticket`, `list_accounts` |
| 3 | Update | Modifica recursos existentes | El agente confirma en chat | `change_shipping_address`, `update_profile` |
| 4 | Financial | Movimiento de dinero, cobros | Usuario confirma explícitamente en la conversación | `transfer_funds`, `process_refund` |
| 5 | Irreversible | No se puede deshacer | Confirmación explícita reforzada (reconfirmar un dato + ventana de cancelación) | `close_account`, `delete_all_data` |

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
  "description": "Transfer funds between accounts.\n\nOperation Level: 4 (Financial - requires user confirmation)\n\nUse when the user wants to move money — e.g. \"transfer money\", \"send funds\". Do NOT use for credit card payments (use pay_credit_card)."
}
```

> **Nota MCP:** complementa el nivel con las `annotations` estándar de MCP: `readOnlyHint` (nivel 1), `destructiveHint` (niveles 4–5), `idempotentHint`, `openWorldHint`. Los clientes las usan para decidir qué llamadas requieren aprobación humana.

---

## Principio 9: Confirmaciones delegadas

> **Por qué es importante:** el modelo puede malinterpretar al usuario o ser manipulado para actuar. Si una sola llamada *ejecuta* algo con consecuencias (mover dinero, borrar datos), no hay vuelta atrás cuando se equivoca. Partir la operación en dos —*preparar* (que solo devuelve los detalles para revisar) y *ejecutar* (que corre tras la aprobación)— crea un punto de control donde un humano ve exactamente qué va a pasar antes de que pase. El agente nunca tiene en sus manos un botón de "hazlo ya" para lo irreversible. Separas *decidir* de *ejecutar*, y metes al humano justo en medio.

Las operaciones de **Nivel 3 en adelante** no deben ejecutarse inmediatamente. La tool devuelve `pending_confirmation` con los detalles completos, el agente los presenta al usuario, y la ejecución real ocurre en una **segunda tool** tras la aprobación.

### Flujo

```
1. El agente llama transfer_funds
2. La tool valida y devuelve status: "pending_confirmation" con detalles
3. El agente presenta al usuario: "Transferir $150 a Ahorros. ¿Procedo?"
4. El usuario aprueba explícitamente en la conversación
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
        "idempotency_key": "txn-20260115-001-k7f3"
      }
    },
    "cancel_method": {
      "tool": "cancel_pending_operation",
      "params": {"operation_id": "TXN-20260115-001"}
    },
    "expires_at": "2026-01-15T11:00:00Z"
  },
  "formatted": "I'd like to transfer $150.00 from Main Checking to Joint Savings. No fees apply. Shall I proceed?"
}
```

La `idempotency_key` del `confirmation_method` la **emitió el servidor** al preparar la operación — el agente solo la repite (ver Principio 10).

**Por qué delegar:** el usuario ve exactamente qué va a pasar antes de que pase; la ejecución solo corre tras una aprobación explícita; y queda un audit trail de quién aprobó qué, cuándo y por dónde.

| Nivel | Canal de confirmación |
|-------|----------------------|
| 3 | Confirmación en chat ("¿Procedo?") |
| 4 | Confirmación explícita del usuario en la conversación (el agente presenta el resumen completo y el usuario aprueba) |
| 5 | Confirmación reforzada: el usuario reconfirma un dato clave de la operación + ventana de cancelación antes de ejecutar |

> Si más adelante la app suma canales fuera de banda (OTP, biometría, push), se conectan aquí sin cambiar el diseño de las tools: la tool sigue devolviendo `pending_confirmation` y la ejecución sigue en una segunda tool. Hoy, el canal disponible es la confirmación explícita en la conversación.

---

## Principio 10: Llaves de idempotencia

> **Por qué es importante:** un agente reintenta de formas que el código humano no. Un timeout de red, un error que malinterpretó, o simplemente un bucle de razonamiento pueden hacer que llame a `transfer_funds` dos o tres veces para la *misma* intención del usuario. Sin protección, eso son dos o tres transferencias reales. La llave de idempotencia le dice al backend "esta es la misma operación que ya viste, devuelve el resultado anterior y no la ejecutes de nuevo". Es tu red de seguridad contra la naturaleza repetitiva e impredecible de un agente. Asume que toda llamada con efectos *va* a repetirse.

Toda tool **transaccional** (Nivel 3+) debe aceptar un parámetro `idempotency_key`. La llave la **emite el servidor y el agente solo la repite** — nunca la inventa el modelo: los "UUIDs" que muestrea un LLM son de baja entropía (gravitan hacia ejemplos memorizados), y una colisión de llaves se traga silenciosamente una operación legítima — el peor modo de falla posible para un mecanismo de dedupe en tools financieras.

### Cómo funciona

1. La tool Nivel 3+ **prepara** la operación (Principio 9) y devuelve `pending_confirmation` incluyendo una `idempotency_key` generada server-side (p. ej., derivada del ID de la operación preparada)
2. El agente **repite** esa llave en la llamada de `confirm_*` — y en cualquier reintento. El agente nunca genera llaves
3. El backend guarda la llave junto con el resultado de la operación
4. Si llega la misma llave de nuevo, el backend devuelve el **resultado original** sin re-ejecutar:

```json
{
  "status": "already_processed",
  "data": { "reference": "REF-88321" },
  "formatted": "This transfer was already processed. Reference: REF-88321."
}
```

### Reglas

| Regla | Descripción |
|-------|-------------|
| Formato | String opaco generado por el servidor (p. ej., derivado del ID de la operación preparada) |
| Alcance | Por tool, por usuario |
| TTL | Default sugerido: mínimo 24 horas para operaciones financieras |
| Colisión | Devolver el resultado original con `"status": "already_processed"`, **no** ejecutar de nuevo |
| Responsabilidad del agente | Repetir la llave del `pending_confirmation` en confirm y reintentos — nunca generarla |

---

## Principio 11: Parámetros seguros

> **Por qué es importante:** este es el error de seguridad más fácil de cometer y el más caro. El modelo controla *todos* los parámetros y es manipulable por el texto del usuario (*prompt injection*: un usuario malicioso escribe algo que convence al agente de hacer lo que no debe). Si `user_id` es un parámetro, basta con que el atacante diga "ahora consulta los datos del usuario 4815" para que el agente le entregue datos ajenos — porque para él es solo otro valor que rellenar. La identidad y las credenciales **nunca** pueden depender de algo que el modelo escribe; tienen que venir de la capa de transporte autenticada, donde el modelo no las puede tocar. Regla simple: si está en `inputSchema`, considéralo falsificable.

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
      "loan_request_id": {"type": "string"},
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
      "loan_request_id": {"type": "string", "description": "Confirmed loan request to disburse."},
      "idempotency_key": {"type": "string", "description": "Key returned by loans_prepare_request. Echo it exactly."}
    },
    "required": ["loan_request_id", "idempotency_key"]
  }
}
```

**La distinción clave:** los identificadores de negocio que el agente legítimamente **descubre y pasa** (un `account_id` devuelto por una tool de búsqueda, un `loan_request_id` de un borrador) sí son parámetros válidos. La línea divisoria es **identidad del llamador / credenciales vs. operandos**.

**Regla MCP:** si está en `inputSchema`, el modelo puede falsificarlo. Identidad y credenciales llegan por la capa de transporte/gateway (OAuth de la sesión MCP, headers como `x-claims`) y se resuelven en el servidor.

---

## Diseño a nivel de catálogo

Los 11 principios anteriores aplican a **una tool**. Tres decisiones adicionales dan forma al catálogo completo:

### Granularidad — una tool = una unidad de intención del usuario

Dimensiona cada tool a una **unidad de intención o decisión del usuario**, no a un endpoint del backend ni a un paso interno. Dos modos de fallo opuestos:

| Fallo | Síntoma | Solución |
|-------|---------|----------|
| **Sobre-fragmentada** | Dos tools siempre se llaman en secuencia y el resultado intermedio no tiene uso independiente (p. ej. un `loan_request_id` que solo sirve para la siguiente llamada) | **Fusionar** en una tool |
| **Sobre-empaquetada** | Una tool esconde pasos que el agente querría componer, saltarse, reintentar o recuperar de forma independiente (validar → verificar stock → pagar) | **Dividir** en primitivas atómicas |

La costura natural es la frontera de `pending_confirmation` (Principio 9): todo lo previo a "listo para ejecutar" suele ser **una** tool de *preparación*, y la ejecución es **una** tool de *ejecución* — sin importar cuántos endpoints haya detrás de cada una.

**Ejemplo:** `loans_create_request` (devuelve solo un `loan_request_id`) + `loans_confirm_request` (calcula los términos finales) deberían ser **una sola** `loans_prepare_request` que devuelva `pending_confirmation` — el `loan_request_id` solo nunca es un punto de parada útil para el agente.

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
  "description": "Retrieve current balances for all sub-accounts (checking, savings, credit).\n\nOperation Level: 1 (Read)\n\nUse when the user asks about available money — e.g. \"check my balance\", \"how much do I have\".\nDo NOT use for transaction history (use search_transactions).\n\nReturns balances by sub-account with currency and as-of timestamp.",
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
  "metadata": {
    "as_of": "2026-01-15T10:30:00Z",
    "cache_ttl_seconds": 60
  }
}
```

Nota: sin `available_actions` — es una lectura Nivel 1 y los siguientes pasos estáticos ya viven en el catálogo (Principio 7). Se incluirían solo si hubiera estado del servidor que reportar (p. ej., una operación pendiente sobre esta cuenta).

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
- [ ] Dice **cuándo usar Y cuándo NO usar** (nombrando la tool hermana que cubre el caso excluido) — P2
- [ ] (Técnica opcional) Frases gatillo donde hay tools hermanas que se solapan — P2
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
- [ ] Envelope de alta señal: `data` (obligatorio) + `formatted` (recomendado) — ningún campo duplica a otro — P6
- [ ] Errores con `code`, `message`, `remediation` (y `suggestions` cuando aplique) — P4
- [ ] **Sin fugas de datos sensibles** (números de tarjeta completos, documentos, IDs internos de infraestructura)
- [ ] `available_actions` solo cuando llevan estado del servidor o un nudge curado; se omiten si repetirían el catálogo — P7
- [ ] Acciones y sugerencias derivadas de estado/reglas del servidor, **nunca** del texto de los registros; texto externo delimitado en `formatted` — P6

### Operaciones sensibles
- [ ] Nivel de operación asignado (1–5) — P8
- [ ] Tools Nivel 3+ devuelven `pending_confirmation` **antes** de ejecutar — P9
- [ ] Tools Nivel 4+ exigen confirmación explícita del usuario antes de ejecutar (Nivel 5: confirmación reforzada) — P9
- [ ] Tools transaccionales (Nivel 3+) aceptan `idempotency_key`; la llave la emite el servidor en `pending_confirmation` y el agente solo la repite — P10

### Catálogo (criterio, no checklist mecánica)
- [ ] Cada tool es **una unidad de intención del usuario** — ni sobre-fragmentada ni workflow empaquetado (Granularidad)
- [ ] Tools agrupadas por dominio, ≤10 por dominio (Bounded Contexts)
- [ ] Toda acción de la UI tiene tool o exclusión documentada (Paridad)

---

## Resumen: las 11 reglas en una tabla

| # | Principio | En una frase |
|---|-----------|--------------|
| 1 | Claridad semántica | Nombra por operación de dominio, no por CRUD |
| 2 | Lenguaje natural | Cuándo usar Y cuándo NO en la descripción; búsqueda por nombre, no solo por ID |
| 3 | Tipos estructurados | JSON Schema con restricciones; nada de strings libres para dinero/fechas/enums |
| 4 | Errores accionables | Todo error trae `code`, `message` y `remediation` |
| 5 | Terminología consistente | Un término por concepto en todo el catálogo |
| 6 | Semántica rica | Envelope de alta señal: `data` + `formatted`, sin campos duplicados |
| 7 | Available actions | Solo con estado del servidor o nudge curado; nunca repetir el catálogo |
| 8 | Niveles de operación | Clasifica 1–5 según impacto; decláralo en la descripción |
| 9 | Confirmaciones delegadas | Nivel 3+: preparar → `pending_confirmation` → ejecutar |
| 10 | Idempotencia | Llave emitida por el servidor, repetida por el agente; colisión = resultado original |
| 11 | Parámetros seguros | Identidad y credenciales jamás en `inputSchema` — se inyectan server-side |

---

## Siguiente paso: ver los 11 principios aplicados de punta a punta

Esta guía explica los principios uno por uno. Para verlos **trabajando juntos** sobre un caso real — tomar una API REST de préstamos, exponerla mal (como saldría por instinto), ver por qué se rompe con un agente y reconstruirla principio por principio — lee el walkthrough:

**→ [Walkthrough: de una API REST a tools MCP bien diseñadas](mcp-tool-design-walkthrough.md)**

Es la mejor forma de que un dev backend interiorice el cambio de mentalidad: mismo backend, resultados opuestos, según cómo se diseñen las tools.
