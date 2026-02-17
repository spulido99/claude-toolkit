# Deepagents Builder Plugin - Mejoras v2

**Fecha**: 2026-02-17
**Estado**: Aprobado
**Plugin**: `plugins/deepagents-builder/`

---

## Contexto

El plugin deepagents-builder guia la creacion de agentes con LangGraph/LangChain. Tras usarlo en un proyecto real (uendi-paridad-app, financial_coach), se identificaron 3 ejes de mejora:

1. APIs y patrones de codigo generado estaban desactualizados
2. Faltaba soporte para disenar y generar tools con principios AI-friendly
3. No habia forma de probar agentes interactivamente

## Eje 1: Nuevo Skill `tool-design` + Agente `tool-architect`

### Skill: `skills/tool-design/SKILL.md`

Contiene los principios de diseno de tools extraidos de:
- AI-Friendly API Design & MCP Best Practices
- Arquitectura Agent Native (Ueno Bank)
- Catalogo de Tools Uendi (ejemplo real de 32 tools)

**Principios incluidos**:
1. Semantica clara - nombres descriptivos de dominio, no CRUD generico
2. Compatibilidad con lenguaje natural - search-first, busqueda por atributos humanos
3. Tipos estructurados - JSON Schema explicito con constraints
4. Errores accionables - codigo especifico + remediation + suggestions
5. Terminologia consistente - un termino por concepto
6. Semantica rica - `formatted`, `formatted_spoken`, contexto
7. Available actions - cada respuesta incluye acciones posibles
8. Niveles de operacion - 5 niveles (Lectura -> Irreversible) con scopes
9. Confirmaciones delegadas - biometria/push/OTP para nivel 3+
10. Idempotency keys - para operaciones transaccionales

**Archivos de referencia**:
- `references/ai-friendly-principles.md` - principios de API Design
- `references/agent-native-principles.md` - principios de arquitectura
- `references/tool-quality-checklist.md` - checklist de verificacion
- `references/tool-examples.md` - ejemplos del catalogo Uendi

**Triggers**: "disenar tools", "crear tools para agente", "tool design", "API to tools", "definir herramientas"

### Agente: `agents/tool-architect/AGENT.md`

Agente proactivo que diseña y genera tools. Flujo:

1. **Discovery** - pregunta sobre dominio, APIs existentes, objetivos del agente
2. **Mapping** - mapea capabilities -> tools, aplica niveles, define bounded contexts
3. **Design** - genera spec de cada tool con name, description (con triggers), inputSchema, response pattern
4. **Generation** - produce codigo en Python o MCP segun el caso:
   - **Python**: `@tool` decorator + patron `formatted/available_actions/message_for_user`, organizado por dominio
   - **MCP**: tool definitions JSON + handlers opcionales
5. **Verification** - ejecuta checklist de calidad

**Tools del agente**: Glob, Grep, Read, Write, AskUserQuestion

### Patron de generacion Python

```python
# domains/{dominio}/tools.py
from langchain_core.tools import tool
from typing import Optional

@tool
def tool_name(param: type = default) -> dict:
    """
    Descripcion clara de que hace la tool.

    Usar cuando el usuario diga:
    - 'trigger frase 1'
    - 'trigger frase 2'

    Args:
        param: Descripcion del parametro
    """
    return {
        "data": {...},
        "formatted": "Texto legible para el agente",
        "available_actions": ["next_tool_1", "next_tool_2"],
        "message_for_user": "Texto para mostrar al usuario"
    }

TOOLS = [tool_name, ...]
```

### Patron de generacion MCP

```json
{
  "name": "tool_name",
  "description": "Descripcion con triggers de uso",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param": {
        "type": "string",
        "description": "Descripcion clara del parametro"
      }
    }
  }
}
```

---

## Eje 2: Correccion de API en Skills Existentes

### Hallazgos de la investigacion (Feb 2026)

| Concepto | Correcto (actual) | Incorrecto (deprecated) |
|---|---|---|
| Funcion | `create_react_agent` v2 o `langchain.agents.create_agent` | v1 sin especificar |
| System prompt | `prompt=` | `state_modifier=`, `message_modifier=` |
| Contexto runtime | `context_schema=` | `config_schema=` |
| Formato modelo | `"provider:model"` string | Solo objetos |
| Subagentes | Agent as tool, `langgraph-supervisor` | SubAgentMiddleware |
| Hooks | `pre_model_hook` / `post_model_hook` (v2) | - |
| Middleware | `middleware=` (en `create_agent`) | - |

### Skills a actualizar

**`quickstart/SKILL.md`**:
- Formato modelo: `"provider:model"`
- `create_react_agent` con `version="v2"`, `prompt=`
- `context_schema=` (no `config_schema=`)
- Subagentes via "agent as tool" pattern
- Checkpointer: MemorySaver para dev
- Incluir patron de chat interactivo en template

**`patterns/SKILL.md` y referencias**:
- tool-patterns.md: imports correctos, `@tool` de `langchain_core.tools`, `InjectedState`, `InjectedStore`
- anti-patterns.md: agregar patrones incorrectos comunes
- **Nuevo**: `references/api-cheatsheet.md` con API correcta y vigente

### Nueva referencia: `patterns/references/api-cheatsheet.md`

Contenido:
- Firma actual de `create_react_agent` (v2)
- Firma de `create_agent` (langchain.agents)
- Patron "agent as tool" para subagentes
- `langgraph-supervisor` para supervisor pattern
- Formatos de modelos
- Checkpointers disponibles
- Parametros deprecados -> reemplazos

---

## Eje 3: Command `/add-interactive-chat`

### Command: `commands/add-interactive-chat.md`

Genera un archivo `chat.py` adaptado al agente del usuario.

**Flujo**:
1. Detecta la funcion de creacion del agente en el repo
2. Genera `chat.py` con:
   - Import del agente existente
   - `MemorySaver` con thread management
   - Loop interactivo (salir, nuevo, cambiar usuario)
   - Logging de tool calls con params
   - Context injection si usa `context_schema`
3. Instrucciones de uso

**Patron de logging**:
```
Tu: Cuanto tengo en mi cuenta?
   Tool: get_account_balances(include_details=False)
   Response: 2 cuentas encontradas
Coach: Tus cuentas son...
```

### Integracion en Quickstart

El quickstart actualizado incluye un `chat.py` basico como parte del scaffold inicial.

---

## Componentes nuevos (resumen)

| Componente | Tipo | Ubicacion |
|---|---|---|
| tool-design | Skill | `skills/tool-design/SKILL.md` + `references/` |
| tool-architect | Agent | `agents/tool-architect/AGENT.md` |
| add-interactive-chat | Command | `commands/add-interactive-chat.md` |
| api-cheatsheet | Reference | `skills/patterns/references/api-cheatsheet.md` |

## Componentes actualizados

| Componente | Cambios |
|---|---|
| quickstart/SKILL.md | API correcta, chat template, context_schema |
| patterns/SKILL.md | API correcta, nuevos patrones |
| patterns/references/tool-patterns.md | InjectedState, InjectedStore, imports |
| patterns/references/anti-patterns.md | Patrones deprecados |

## Orden de implementacion sugerido

1. `api-cheatsheet.md` (base de referencia para todo lo demas)
2. `tool-design` skill + referencias
3. `tool-architect` agent
4. Actualizar `quickstart` y `patterns`
5. `add-interactive-chat` command
