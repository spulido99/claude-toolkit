# Revisión adversarial — Skill de Tool Design

**Fecha:** 2026-06-12
**Alcance:** `plugins/deepagents-builder/skills/tool-design/SKILL.md` + sus 4 referencias (`ai-friendly-principles.md`, `agent-native-principles.md`, `tool-quality-checklist.md`, `tool-examples.md`), más los archivos que dependen de ellos (`tool-patterns.md`, `tool-status.md`).
**Método:** se contrastó cada afirmación del skill contra fuentes primarias de la industria: guía oficial de Anthropic ("Writing effective tools for agents", docs de tool use, "Building effective agents"), la spec de MCP (revisiones 2025-03-26 → 2025-11-25), docs de OpenAI y Gemini, prácticas de Stripe/Google/PayPal, OWASP LLM Top 10 y papers publicados sobre degradación por tamaño de catálogo y aleatoriedad de LLMs.

---

## Veredicto general

El núcleo del skill está **bien sustentado**: ~7 de los 11 principios coinciden con guía documentada de al menos dos vendors. Pero el skill mezcla tres tipos de contenido sin distinguirlos:

1. **Práctica estándar de la industria** (claridad semántica, errores accionables, tipos estructurados, identidad inyectada, idempotencia).
2. **Convenciones propias que funcionan pero no son estándar** (`available_actions`, `message_for_user`, niveles 1-5, trigger phrases). Estas se presentaban como obligatorias ("MUST", "Required: Yes") cuando son apuestas de diseño propias — válidas, pero deben presentarse como tales y con sus trade-offs (costo en tokens, superficie de prompt injection).
3. **Errores objetivos** (dinero como float, "list" clasificado como escritura, el ejemplo de `interrupt_on` que no mapea nada, UUIDs de idempotencia generados por el LLM).

El gap más grande: el skill **no decía nada de eficiencia de tokens** — el tema al que Anthropic dedica más espacio en su guía — y su envelope obligatorio empujaba en la dirección contraria (la misma información repetida 3-4 veces por respuesta).

---

## 1. Lo que está bien sustentado (mantener tal cual)

| Afirmación del skill | Evidencia |
|---|---|
| **P1 — Nombres por operación de dominio, no CRUD/HTTP** | Anthropic: "input parameters should be unambiguously named"; OpenAI: funciones "obvias e intuitivas"; convergencia total. |
| **P2 — Descripciones detalladas como mecanismo principal de routing** | Anthropic docs: "Provide extremely detailed descriptions. This is by far the most important factor in tool performance… at least 3-4 sentences". El caso SWE-bench (SOTA tras refinar descripciones) lo confirma. |
| **P2 — Search-first / resolver entidades por atributos humanos** | Anthropic: resolver UUIDs a lenguaje semántico "significantly improves Claude's precision… by reducing hallucinations". |
| **P3 — JSON Schema con `enum`, `pattern`, `minimum`** | OpenAI: "use enums… to make invalid states unrepresentable" + strict mode; Gemini: "use enum fields… instead of putting the set of values into the description". |
| **P4 — Errores accionables con remediación** | Anthropic: "prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks". El array `suggestions` con tool calls concretos es extensión propia, pero va en la dirección correcta. |
| **P5 — Un término por concepto, snake_case, cursor opaco** | Anthropic (consistencia y nombres no ambiguos); MCP spec: paginación por cursor opaco es normativa ("Clients MUST treat cursors as opaque tokens"). |
| **P10 — Idempotencia en operaciones transaccionales** | Stripe: `Idempotency-Key`, UUID v4, TTL 24h — el skill replica el diseño casi exacto. (Con una corrección sobre *quién* genera la llave, ver §4.) |
| **P11 — Identidad/credenciales nunca como parámetros** | OWASP LLM01; MCP security best practices (confused deputy, token passthrough: "MCP servers MUST NOT accept any tokens that were not explicitly issued for the MCP server"). Es de lo más sólido del skill. |
| **Bounded contexts / catálogos pequeños / subagentes a partir de ~15 tools** | Ahora con evidencia fuerte: OpenAI recomienda <20 funciones activas; Gemini 10-20 máximo; Anthropic: la selección "degrades significantly once you exceed 30–50 available tools"; paper arXiv 2605.24660: degradación no lineal de 7-85% al crecer el catálogo. **El "max 10 por dominio" del skill resultó conservador y correcto.** |
| **Granularidad — merge de pasos sin valor intermedio** | Anthropic: consolidar `schedule_event` en vez de `list_users`+`list_events`+`create_event`; OpenAI: "combine functions that are always called in sequence". El ejemplo `loans_prepare_request` del skill es exactamente este patrón. |

---

## 2. Lo que le sobra / afirmaciones sin evidencia externa

Estas prácticas **nos funcionan** (eso también es evidencia — de primera mano), pero el skill las presentaba como estándar cuando no lo son. Se recalibraron de "obligatorio" a "patrón propio recomendado con trade-offs":

### 2.1 `available_actions` obligatorio en cada respuesta (P7)

- **Estado en la industria:** nicho/emergente. Existe como propuesta académica (arXiv 2605.10555 "Agent-First Tool APIs" propone un array `next_actions`) y en ensayos tipo "HATEOAS for agents" (Nordic APIs, blogs). **Ningún vendor de primera línea lo recomienda**; la spec MCP no tiene ningún campo equivalente (los únicos campos de resultado son `content`, `structuredContent`, `isError`).
- **Argumento en contra (Anthropic):** "include only the fields Claude needs to reason about its next step. Bloated responses waste context." Un menú boilerplate en cada respuesta es contexto de baja señal cuando el siguiente paso ya es inferible del catálogo.
- **Argumento de seguridad (OWASP LLM01 / Willison):** los tool results son datos no confiables. Un protocolo donde el agente obedece instrucciones embebidas en resultados convierte datos en instrucciones *por diseño* — el canal exacto de la inyección indirecta. Aceptable con servers first-party confiables; inaceptable como patrón generalizado con servers de terceros.
- **Dónde SÍ aporta valor (nuestro caso de uso):** cuando las acciones válidas dependen del **estado** que solo el backend conoce (transfer pendiente → `confirm`/`cancel`; balance cero → no ofrecer transfer). Eso el catálogo estático no lo expresa.
- **Cambio aplicado:** MUST → recomendado **cuando las acciones dependen del estado**; máximo ~3; omitible en tools terminales/de lectura simple; nota de costo de tokens y de confianza.

### 2.2 `message_for_user` y `formatted_spoken` como campos requeridos (P6)

- Ningún vendor ni la spec MCP los menciona. Anthropic asume que **el modelo, no el tool, es dueño del fraseo hacia el usuario**. En los propios ejemplos del skill, `message_for_user` era literalmente igual a `formatted` (duplicación pura).
- MCP tiene un mecanismo sancionado para contenido dirigido al usuario: annotations de audiencia (`"audience": ["user"]`) sobre content blocks — no un string suelto.
- **Cambio aplicado:** `message_for_user` pasa a opcional (útil solo cuando el fraseo correcto requiere conocimiento del backend, p.ej. lenguaje regulatorio exacto); `formatted_spoken` solo para canales de voz (ya estaba así en el checklist, ahora también en el SKILL).

### 2.3 Niveles de operación 1-5 (P8)

- Invención propia. La industria usa la taxonomía de MCP `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, spec 2025-03-26) y delega el gating al cliente ("Hosts must obtain explicit user consent before invoking any tool").
- **No se eliminó**: los 5 niveles son más expresivos que 4 booleans (distinguen financiero de irreversible) y mapean bien a `interrupt_on`. Pero un nivel en prosa dentro del docstring es **invisible para los clientes MCP**, cuyas UIs de seguridad leen annotations.
- **Cambio aplicado:** se mantienen los niveles como taxonomía interna y se añade el **mapeo obligatorio a ToolAnnotations** al generar MCP, con la nota de la spec de que las annotations son hints no confiables.

### 2.4 Listas de trigger phrases en docstrings (P2)

- Ningún vendor recomienda listas enumeradas de frases. Anthropic pide prosa: cuándo usar **y cuándo no** ("when it should be used (and when it shouldn't)"); para tool search pide "semantic keywords", no frases literales.
- Riesgo práctico: listas largas de coloquialismos inflan el contexto y envejecen mal.
- **Cambio aplicado:** se acotan a 3-5 frases de alto valor + se añade el requisito que sí es estándar y faltaba: **describir cuándo NO usar el tool** y los límites frente a tools vecinos.

### 2.5 Afirmaciones puntuales sin sustento

| Afirmación | Veredicto |
|---|---|
| "Longer descriptions = better routing. A 3-line description outperforms a 1-line description" | Sobre-generalización. Lo documentado es "detalladas y de alta señal" (3-4+ frases), no "más largo = mejor". Las descripciones consumen contexto en cada turno. Reformulado. |
| "Mixed casing… raises parameter-error rates" | Plausible, sin fuente. Se mantiene como regla (es gratis y consistente con todos los vendors) pero sin la afirmación causal. |
| "Max 15 parameters" (checklist) | Sin fuente y demasiado laxo: OpenAI sugiere strict mode y schemas simples; el cookbook de o-series considera <20 args "in-distribution" pero los ejemplos de vendors rondan 1-5. Cambiado a "apunta a ≤7, divide en >15". |
| "TTL 24 hours minimum" para idempotency keys | Stripe usa exactamente 24h — coincide, se mantiene con cita. |

---

## 3. Lo que le falta (gaps vs. industria) — añadido

### 3.1 Eficiencia de tokens (el gap más grande)

Anthropic dedica una sección entera: paginación, filtrado, truncado con defaults sensatos, y el parámetro **`response_format: "concise" | "detailed"`** (su ejemplo de Slack: 206 → 72 tokens, ~⅓). Claude Code trunca respuestas a 25k tokens por defecto. El skill no decía nada, y su envelope empujaba a duplicar contenido.
**Añadido:** subsección de presupuesto de tokens en P6 + checks en el checklist (defaults de paginación, truncado con instrucciones de recuperación, `response_format` para tools de lectura pesada, no duplicar el mismo contenido entre campos del envelope).

### 3.2 MCP moderno: annotations, outputSchema, elicitation

El patrón de generación MCP del skill estaba desactualizado frente a la spec:
- **`ToolAnnotations`** (2025-03-26) — ver §2.3.
- **`outputSchema` + `structuredContent`** (2025-06-18): la forma oficial de devolver datos estructurados ("Servers MUST provide structured results that conform to this schema") — exactamente lo que el campo `data` del envelope intenta hacer ad-hoc.
- **Elicitation** (2025-06-18): el mecanismo in-protocol para pedir confirmación/input al usuario a mitad de operación — la alternativa estándar al baile prepare/confirm de dos tools.
**Añadido:** los tres al MCP Generation Pattern y a `ai-friendly` #6.

### 3.3 Redundancia de confirmación P8 + P9 (sin resolver → ahora explícita)

El skill mandaba **dos capas simultáneas**: el tool devuelve `pending_confirmation` (P9) **y** el framework interrumpe con `interrupt_on` (P8). Resultado: el usuario confirma dos veces la misma operación. Ninguna fuente externa valida la doble capa; MCP delega la confirmación al cliente.
**Añadido:** regla explícita — elegir **una** capa por deployment. `pending_confirmation` (portable, con audit trail, funciona en cualquier cliente) o HITL del framework/cliente (más simple, menos tools). La doble capa solo para Level 5.

### 3.4 Namespacing por prefijo

Anthropic: "prefix names with the service (e.g., `github_list_prs`)" y para tool search "Use consistent namespacing… so that search queries naturally surface the right tool group". El skill tenía bounded contexts pero sus ejemplos mezclaban estilos (`loans_simulate` con prefijo vs `transfer_funds` sin él) sin criterio explícito.
**Añadido:** guía de prefijo por dominio cuando el catálogo cruza dominios, con la nota honesta de Anthropic: prefix vs suffix "effects vary by LLM" — validar con evals propios.

### 3.5 Parity matizada

"Todo botón de la UI = un tool" choca con la guía de consolidación de Anthropic ("A common error… tools that merely wrap existing software functionality or API endpoints") y con los límites de catálogo. La paridad correcta es de **outcomes** (todo lo que el usuario puede *lograr*), no 1:1 con endpoints/botones — un `get_customer_context` puede cubrir tres pantallas.
**Añadido:** matiz en `agent-native` #7 y en el checklist.

### 3.6 Menores

- **Tool search / deferral dinámico** para catálogos grandes (Anthropic, OpenAI): mencionado en Bounded Contexts.
- **`input_examples`** (campo del API de Anthropic para ejemplos validados): mencionado en P2 de `ai-friendly`.
- **Evals como loop central**: el skill ya tenía `/design-evals` en el workflow; se reforzó la conexión (Anthropic: prototipo → eval → iterar; métricas: errores de tool, llamadas redundantes, tokens).

---

## 4. Bugs y contradicciones internas — corregidos

| # | Bug | Corrección |
|---|---|---|
| 1 | **Dinero como `value: float`.** Stripe (enteros en unidad menor), Google (`units`+`nanos`, jamás float), PayPal (string decimal): nadie usa IEEE-754. Bug real documentado: float de 1.23 → cobro de €1 (erpnext #10645). El skill convertía un anti-patrón clásico en regla. | Canon: **string decimal** (`"value": "150.00"`) o enteros en unidad menor. Schemas y tipos actualizados; los ejemplos en PYG (moneda sin decimales) siguen siendo enteros válidos. |
| 2 | **Level 2 mezclaba "Create" con "List"** — listar es lectura (Level 1) bajo cualquier taxonomía; `list_accounts` aparecía como Level 2. | List → Level 1. Level 2 = solo creación de bajo riesgo. |
| 3 | **El ejemplo de `interrupt_on` no mapeaba niveles**: `interrupt_on={"tool": {...}}` configura un tool literalmente llamado "tool" (el resto del plugin usa nombres reales: `{"delete_db": {...}}`). El texto prometía "mapeo de niveles" que el código no hacía. | Ejemplo corregido: dict por nombre de tool, solo Level 3+ listados. |
| 4 | **Idempotency keys generadas por el agente** ("Agent responsibility: Generate key before first call"). Stripe exige entropía real del *caller* — y el caller con entropía es el harness, no el modelo: los LLMs son generadores pseudo-aleatorios pésimos (arXiv 2502.19965: GPT-4o responde "7" 92/100 veces) y tienden a repetir UUIDs memorizados. Ironía: los docs del skill usaban `550e8400-e29b-41d4-a716-446655440000`, el UUID de ejemplo más famoso de internet. | Regla invertida: **el tool/framework genera la llave** en la primera llamada y la devuelve; el agente solo la *reutiliza* en retries. En el flujo prepare/confirm, el `transfer_id` del confirm ya cumple ese rol. |
| 5 | **Clave `"data"` duplicada** en el dict del envelope de `agent-native` #4 (la segunda pisaba la primera). | Eliminada. |
| 6 | **Enum de currency `["USD","EUR","MXN"]`** mientras todos los ejemplos reales usan PYG. | `PYG` incluido. |
| 7 | **`tool-patterns.md` mostraba `available_actions` como lista de strings** (`["get_transactions"]`) vs. la forma objeto del skill. | Alineado a la forma objeto. |
| 8 | **Duplicación masiva SKILL ↔ referencias** (tabla de terminología, envelope, ejemplos de available_actions aparecen 2-3 veces). Riesgo de divergencia silenciosa — esta revisión encontró que ya habían divergido (bug 7). | No resuelto estructuralmente (sería un refactor mayor); documentado como tema abierto §6. |

---

## 5. Tabla resumen de afirmaciones evaluadas

| Afirmación | Veredicto | Acción |
|---|---|---|
| P1 Semantic clarity sobre CRUD | ✅ Estándar | Mantener |
| P2 Descripciones detalladas | ✅ Estándar | Mantener + añadir "cuándo NO usar" |
| P2 Trigger phrases enumeradas | ⚠️ Convención propia | Acotar a 3-5 |
| P2 "Longer = better routing" | ❌ Sobre-generalización | Reformular |
| P2 Search-first | ✅ Estándar | Mantener |
| P3 Tipos estructurados + JSON Schema | ✅ Estándar | Mantener |
| P3 Money con `value: float` | ❌ Anti-patrón | String decimal / unidad menor |
| P4 Errores accionables | ✅ Estándar | Mantener |
| P4 Array `suggestions` con params | ⚠️ Extensión propia razonable | Mantener, marcar como propia |
| P5 Terminología consistente | ✅ Estándar | Mantener |
| P6 Envelope data/formatted | ✅ Razonable | Mantener |
| P6 `message_for_user` requerido | ❌ Sin evidencia + duplicación | Opcional |
| P6 `formatted_spoken` | ⚠️ Solo voz | Opcional (ya era) |
| P6 (ausente) token efficiency | ❌ Gap | Añadido |
| P7 `available_actions` MUST | ⚠️ Nicho, sin adopción mainstream | Recomendado si state-dependent, ≤3 |
| P8 Niveles 1-5 | ⚠️ Taxonomía propia útil | Mantener + mapear a ToolAnnotations |
| P8 List como Level 2 | ❌ Error de taxonomía | Level 1 |
| P8 Ejemplo `interrupt_on` | ❌ Bug | Corregido |
| P9 pending_confirmation | ⚠️ Patrón propio sólido (estilo Stripe) | Mantener + regla de una sola capa + mencionar elicitation |
| P10 Idempotencia | ✅ Estándar (Stripe) | Mantener |
| P10 Agente genera UUID | ❌ Contra evidencia | Framework genera, agente reutiliza |
| P11 Secure parameters | ✅ Estándar (OWASP/MCP) | Mantener |
| Bounded contexts ≤10/dominio | ✅ Ahora con evidencia | Mantener + active set ≤20 |
| Parity 1:1 con UI | ⚠️ Choca con consolidación | Paridad de outcomes |
| Granularidad merge/split | ✅ Estándar | Mantener |
| Checklist max 15 params | ⚠️ Demasiado laxo | Apuntar ≤7 |
| MCP pattern sin annotations/outputSchema | ❌ Desactualizado | Añadidos |

---

## 6. Temas abiertos para discusión (no aplicados)

1. **¿Eliminar `available_actions` de tools Level-1 simples y medir?** La forma honesta de zanjar el debate es un A/B con `/design-evals`: mismo catálogo con y sin menú de acciones, comparar tasa de éxito, número de llamadas y tokens. Si el delta no justifica el costo por respuesta, recortar.
2. **Refactor de duplicación SKILL ↔ referencias.** El SKILL.md (1000 líneas) repite bloques enteros de las referencias. Propuesta: SKILL = doctrina + punteros; referencias = detalle. Reduce divergencias como las encontradas aquí.
3. **¿Adoptar `response_format` como parámetro estándar del catálogo?** Anthropic lo recomienda para tools de lectura pesada. Encajaría como fila nueva en la tabla de terminología (P5).
4. **`docs/mcp-tool-design-guide.md` (y la presentación HTML) quedaron desincronizados** — son derivados del skill y repiten los puntos corregidos aquí (float money, MUST de available_actions, agente genera UUID). Sincronizar en un pase aparte.
5. **Migrar el envelope `data` a `outputSchema`/`structuredContent`** cuando el target es MCP puro, en vez de JSON-en-texto.

---

## 7. Cambios aplicados en esta revisión

- `SKILL.md`: dinero como string decimal; P6 reescrito con opcionalidad real + subsección de token efficiency; P7 recalibrado (MUST→condicional, ≤3, notas de costo/confianza); P8 con mapeo a ToolAnnotations y ejemplo de `interrupt_on` corregido; P9 con regla de una sola capa de confirmación + elicitation; P10 con generación de llave en el framework; List→Level 1; namespacing y active-set en catálogo; parity matizada; MCP pattern con `annotations` y `outputSchema`.
- `references/ai-friendly-principles.md`: claim de longitud reformulado; "cuándo NO usar"; `input_examples`; money sin float; MCP #6 actualizado (annotations, outputSchema, elicitation).
- `references/agent-native-principles.md`: bug del `data` duplicado; #1 recalibrado; List→L1 en #2 + nota de annotations; #3 una-capa + elicitation; #5 generación de llave; #7 paridad de outcomes; evidencia de catálogo en #6.
- `references/tool-quality-checklist.md`: money sin float; envelope con opcionalidad; checks nuevos de token budget, annotations MCP, "cuándo NO usar"; params ≤7 preferido.
- `references/tool-examples.md`: nota sobre PYG/decimales y sobre quién genera la idempotency key.
- `commands/tool-status.md`: pass conditions de P6/P7 sincronizadas con el checklist.
- `skills/patterns/references/tool-patterns.md`: forma de `available_actions` alineada.
- Versión del plugin: `1.3.1` → `1.4.0` (plugin.json + marketplace.json).
