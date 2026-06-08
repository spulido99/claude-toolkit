# Deepagents Builder Improvements - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mejorar el plugin deepagents-builder con tool design knowledge, API correcta, y chat interactivo.

**Architecture:** Se crean 4 componentes nuevos (api-cheatsheet, tool-design skill, tool-architect agent, add-interactive-chat command) y se actualizan 4 existentes (quickstart, patterns, tool-patterns, anti-patterns). Todo es markdown dentro de `plugins/deepagents-builder/`.

**Tech Stack:** Claude Code Plugin (markdown skills, agents, commands). Contenido referencia LangGraph/LangChain Python API.

**Design Doc:** `docs/plans/2026-02-17-deepagents-builder-improvements-design.md`

---

### Task 1: Create `api-cheatsheet.md` Reference

Base de referencia para todas las correcciones de API. Los demas tasks dependen de este.

**Files:**
- Create: `plugins/deepagents-builder/skills/patterns/references/api-cheatsheet.md`

**Step 1: Write api-cheatsheet.md**

Create the file with the following content. This is the canonical API reference that all other skills and commands must align to.

```markdown
# LangGraph API Cheatsheet (Feb 2026)

Quick reference for current LangGraph/LangChain API. Use this as the canonical source when generating agent code.

## Agent Creation

### `create_react_agent` (LangGraph)

Primary function for creating ReAct agents. Version 2 is the default since late 2025.

```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",  # "provider:model" string
    tools=[...],
    prompt="You are a helpful assistant.",         # System prompt (NOT state_modifier)
    checkpointer=MemorySaver(),                   # Required for persistence/HITL
)
```

**Key parameters:**
| Parameter | Purpose | Notes |
|-----------|---------|-------|
| `model` | LLM to use | `"provider:model"` string format |
| `tools` | List of tools | `@tool` decorated functions |
| `prompt` | System prompt | Replaces deprecated `state_modifier`, `message_modifier` |
| `checkpointer` | Persistence | `MemorySaver()` for dev, `PostgresSaver`/`SqliteSaver` for prod |
| `context_schema` | Runtime context type | Replaces deprecated `config_schema` |
| `pre_model_hook` | Pre-processing | v2 only, runs before each model call |
| `post_model_hook` | Post-processing | v2 only, runs after each model call |
| `interrupt_before` | HITL breakpoints | List of tool names to pause before |

### `create_agent` (langchain.agents)

Newer alternative with middleware support:

```python
from langchain.agents import create_agent

agent = create_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    prompt="System prompt here.",
    middleware=[MyMiddleware()],  # Custom middleware chain
)
```

## Model Format

Always use `"provider:model"` string format:

```python
# Correct
model = "anthropic:claude-sonnet-4-20250514"
model = "openai:gpt-4o"
model = "google_genai:gemini-2.0-flash"

# Also correct: init_chat_model
from langchain.chat_models import init_chat_model
model = init_chat_model("anthropic:claude-sonnet-4-20250514")
```

## Context Schema (Runtime Context)

Inject runtime context invisible to the LLM:

```python
from dataclasses import dataclass

@dataclass
class UserContext:
    user_id: str
    tenant_id: str

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    context_schema=UserContext,  # NOT config_schema
)

# Invoke with context
result = agent.invoke(
    {"messages": [...]},
    context=UserContext(user_id="123", tenant_id="abc"),
)
```

## Tool Definition

```python
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState, InjectedStore
from typing import Annotated, Optional

# Simple tool
@tool
def search_products(query: str, limit: int = 10) -> dict:
    """Search product catalog.

    Args:
        query: Search terms
        limit: Max results (default: 10)
    """
    return {"data": [...], "formatted": "..."}

# Tool with injected state (invisible to LLM)
@tool
def get_context_info(
    state: Annotated[dict, InjectedState],
) -> str:
    """Access agent state without exposing to LLM."""
    return state["messages"][-1].content

# Tool with injected store (persistent memory)
@tool
def save_preference(
    key: str,
    value: str,
    store: Annotated[Any, InjectedStore],
) -> str:
    """Save user preference to persistent store."""
    store.put(key, value)
    return f"Saved {key}"
```

## Subagent Patterns

### Agent as Tool (recommended for simple delegation)

```python
from langgraph.prebuilt import create_react_agent

# Create specialist agent
specialist = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[specialist_tools],
    prompt="You are a domain specialist.",
)

# Use as tool in parent agent
parent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[specialist],  # Agent used directly as tool
    prompt="Delegate to specialist when needed.",
)
```

### Supervisor Pattern (for complex orchestration)

```python
from langgraph_supervisor import create_supervisor

supervisor = create_supervisor(
    agents=[agent_a, agent_b, agent_c],
    model="anthropic:claude-sonnet-4-20250514",
    prompt="Route tasks to the right agent.",
)
```

## Checkpointers

| Checkpointer | Use Case | Import |
|--------------|----------|--------|
| `MemorySaver` | Development/testing | `from langgraph.checkpoint.memory import MemorySaver` |
| `PostgresSaver` | Production | `from langgraph.checkpoint.postgres import PostgresSaver` |
| `SqliteSaver` | Local production | `from langgraph.checkpoint.sqlite import SqliteSaver` |

## Invocation

```python
import uuid

config = {"configurable": {"thread_id": str(uuid.uuid4())}}

# Simple invoke
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Hello"}]},
    config=config,
)

# With context
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Hello"}]},
    config=config,
    context=UserContext(user_id="123"),
)

# Streaming
for event in agent.stream(
    {"messages": [{"role": "user", "content": "Hello"}]},
    config=config,
    stream_mode="values",
):
    print(event["messages"][-1].content)
```

## Deprecated → Current

| Deprecated | Current Replacement |
|------------|-------------------|
| `state_modifier=` | `prompt=` |
| `message_modifier=` | `prompt=` |
| `config_schema=` | `context_schema=` |
| Model as object only | `"provider:model"` string |
| `SubAgentMiddleware` | Agent as tool or `langgraph-supervisor` |
| `version="v1"` | `version="v2"` (now default) |
```

**Step 2: Verify the file**

Read the file and verify it covers all items from the design doc:
- [x] Firma de `create_react_agent` (v2)
- [x] Firma de `create_agent` (langchain.agents)
- [x] Patron "agent as tool"
- [x] `langgraph-supervisor`
- [x] Formatos de modelos
- [x] Checkpointers disponibles
- [x] Parametros deprecados -> reemplazos

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/skills/patterns/references/api-cheatsheet.md
git commit -m "feat(deepagents-builder): add API cheatsheet reference

Canonical reference for current LangGraph/LangChain API patterns.
Covers create_react_agent v2, model format, context_schema,
subagent patterns, and deprecated parameter mapping."
```

---

### Task 2: Create `tool-design` Skill (SKILL.md)

**Files:**
- Create: `plugins/deepagents-builder/skills/tool-design/SKILL.md`

**Step 1: Write SKILL.md**

```markdown
---
name: AI-Friendly Tool Design
description: This skill should be used when the user asks to "design tools", "create tools for agent", "tool design", "API to tools", "define tools", "convert API to tools", or needs guidance on designing AI-friendly tools for agents. Provides principles from AI-Friendly API Design, Agent Native architecture, and real-world tool catalogs.
---

# AI-Friendly Tool Design

Design tools that agents can discover, understand, and compose naturally. These principles come from AI-Friendly API Design best practices, Agent Native architecture patterns, and real-world tool catalogs with 30+ tools in production.

## Core Principles

### 1. Semantic Clarity Over CRUD

Name tools by what they DO in the domain, not by HTTP methods or database operations.

```python
# Bad: Generic CRUD
@tool
def get_resource(resource_type: str, id: str) -> dict: ...

# Good: Domain-specific semantics
@tool
def get_account_balances(include_details: bool = False) -> dict:
    """Consulta los saldos de todas las cuentas del usuario."""
```

**Rule**: If you need to explain what the tool does beyond its name, the name is wrong.

### 2. Natural Language Compatibility

Design for how humans talk, not how APIs work. Include trigger phrases in docstrings.

```python
@tool
def get_account_balances(include_details: bool = False) -> dict:
    """
    Consulta los saldos de todas las cuentas del usuario.
    Retorna saldo disponible, saldo contable y moneda para cada cuenta.

    Usar cuando el usuario pregunte:
    - 'cuanto tengo?'
    - 'mi saldo'
    - 'cuanta plata tengo'
    - 'balance de mi cuenta'

    Args:
        include_details: Si true, incluye numero de cuenta y tipo. Default: false
    """
```

**Search-first pattern**: Always allow searching by human-friendly attributes (name, alias, description) not just opaque IDs.

### 3. Structured Types with JSON Schema

Every parameter needs explicit type, description, and constraints:

```python
@tool
def create_investment(
    type: str,                              # Required, constrained values
    amount: dict,                           # Structured: {"value": number, "currency": "PYG"}
    term_days: Optional[int] = None,        # Optional with clear semantics
    auto_renew: bool = False,               # Sensible default
    source_account_id: Optional[str] = None # Optional reference
) -> dict:
    """
    Args:
        type: "cda" o "programmed_savings"
        amount: Monto {"value": number, "currency": "PYG"|"USD"}
        term_days: Plazo en dias (para CDA: 30, 90, 180, 360)
        auto_renew: Renovar automaticamente al vencimiento
        source_account_id: Cuenta origen para debitar
    """
```

### 4. Actionable Error Responses

Errors must include: specific code, what went wrong, and what to do next.

```python
# Bad: Generic error
return {"error": "Failed"}

# Good: Actionable error
return {
    "error": {
        "code": "INSUFFICIENT_BALANCE",
        "message": "Saldo insuficiente en cuenta origen",
        "details": {"available": 500000, "required": 1000000},
        "remediation": "Verificar saldo con get_account_balances o usar otra cuenta",
        "suggestions": ["get_account_balances", "get_account_details"]
    }
}
```

### 5. Consistent Terminology

One term per concept across ALL tools in the system:

| Concept | Use | Don't Use |
|---------|-----|-----------|
| Account identifier | `account_id` | `acct_id`, `account`, `id` |
| Money amount | `{"value": N, "currency": "X"}` | raw number, string |
| Date | `YYYY-MM-DD` | timestamp, epoch |
| Pagination | `limit` + `offset` | `page_size`, `page_num` |

### 6. Rich Response Semantics

Every tool response follows the standard pattern:

```python
return {
    "data": {...},                    # Raw structured data
    "formatted": "Texto legible",     # Human-readable for agent context
    "available_actions": [            # What the agent can do next
        "get_account_details",
        "transfer_funds"
    ],
    "message_for_user": "Texto UI"    # Text to show end user
}
```

**Optional extensions:**
- `formatted_spoken`: For voice interfaces (shorter, conversational)
- `metadata`: Processing info (timestamps, pagination)

### 7. Available Actions (Tool Graph)

Every response MUST include `available_actions` — the tools that make sense as next steps. This creates an implicit navigation graph the agent follows:

```
get_account_balances → [get_account_details, get_transactions, transfer_funds]
get_transactions → [get_account_balances, search_contacts, transfer_funds]
transfer_funds → [get_account_balances, get_transactions]
```

### 8. Operation Levels

Classify every tool by impact level:

| Level | Type | Example | Confirmation |
|-------|------|---------|-------------|
| 1 | Read | `get_account_balances` | None |
| 2 | Create/List | `search_contacts` | None |
| 3 | Update | `update_account_alias` | App confirmation |
| 4 | Financial | `transfer_funds` | Biometric/OTP |
| 5 | Irreversible | `close_account` | Multi-factor + delay |

Map to LangGraph's `interrupt_before` for levels 3+.

### 9. Delegated Confirmations

For level 3+ operations, the tool returns `status: "pending_confirmation"` and the actual confirmation happens through a separate channel (app push, OTP, biometric):

```python
return {
    "data": {
        "operation_id": "op-123",
        "status": "pending_confirmation",
        "confirmation_method": "app_push",
        "expires_in": 300,
    },
    "formatted": "Transferencia pendiente de confirmacion en la app.",
    "available_actions": ["get_operation_status"],
    "message_for_user": "Confirma la operacion en tu app."
}
```

### 10. Idempotency Keys

Transactional tools accept an idempotency key to prevent duplicates:

```python
@tool
def transfer_funds(
    from_account: str,
    to_account: str,
    amount: dict,
    idempotency_key: Optional[str] = None,  # Client-generated UUID
) -> dict:
    """If idempotency_key was used before, returns the original result."""
```

## Tool Organization by Domain

Organize tools in bounded contexts by business domain:

```
domains/
  cuentas/
    tools.py        # get_account_balances, get_transactions, etc.
  transferencias/
    tools.py        # transfer_funds, search_contacts, etc.
  inversiones/
    tools.py        # get_investments, create_investment, etc.
```

Each domain file exports a `TOOLS` list:

```python
TOOLS = [get_account_balances, get_account_details, get_transactions, ...]
```

## Python Generation Pattern

The standard pattern for generating LangChain tools:

```python
# domains/{domain}/tools.py
from langchain_core.tools import tool
from typing import Optional

@tool
def tool_name(param: type = default) -> dict:
    """
    Clear description of what the tool does.

    Usar cuando el usuario diga:
    - 'trigger phrase 1'
    - 'trigger phrase 2'

    Args:
        param: Clear parameter description
    """
    # Implementation
    return {
        "data": {...},
        "formatted": "Human-readable text for agent",
        "available_actions": ["next_tool_1", "next_tool_2"],
        "message_for_user": "Text to display to user"
    }

TOOLS = [tool_name, ...]
```

## MCP Generation Pattern

For tools deployed as MCP servers:

```json
{
  "name": "tool_name",
  "description": "Clear description. Use when: trigger phrase 1, trigger phrase 2.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param": {
        "type": "string",
        "description": "Clear parameter description"
      }
    },
    "required": ["param"]
  }
}
```

## Quality Checklist

Before finalizing any tool set, verify against the [Tool Quality Checklist](references/tool-quality-checklist.md).

## References

- **[AI-Friendly Principles](references/ai-friendly-principles.md)** — Core API design principles for AI consumption
- **[Agent Native Principles](references/agent-native-principles.md)** — Architecture patterns for agent-first systems
- **[Tool Quality Checklist](references/tool-quality-checklist.md)** — Verification checklist for tool sets
- **[Tool Examples](references/tool-examples.md)** — Real-world examples from a 32-tool production catalog

## Related

- **[Patterns > Tool Patterns](../patterns/references/tool-patterns.md)** — Implementation patterns (ToolRuntime, security)
- **[Patterns > API Cheatsheet](../patterns/references/api-cheatsheet.md)** — Current LangGraph API reference
```

**Step 2: Verify skill triggers and content**

Read the created file. Verify:
- Frontmatter has correct `name` and `description` with trigger phrases
- All 10 principles from design doc are covered
- References section points to files we'll create in Task 3
- Python and MCP generation patterns match design doc

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/skills/tool-design/SKILL.md
git commit -m "feat(deepagents-builder): add tool-design skill

AI-Friendly tool design principles covering semantic naming,
natural language triggers, structured responses, operation levels,
and generation patterns for Python and MCP."
```

---

### Task 3: Create `tool-design` References (4 files)

**Files:**
- Create: `plugins/deepagents-builder/skills/tool-design/references/ai-friendly-principles.md`
- Create: `plugins/deepagents-builder/skills/tool-design/references/agent-native-principles.md`
- Create: `plugins/deepagents-builder/skills/tool-design/references/tool-quality-checklist.md`
- Create: `plugins/deepagents-builder/skills/tool-design/references/tool-examples.md`

**Step 1: Write `ai-friendly-principles.md`**

Content extracted from the AI-Friendly API Design PDF. Key sections:

- **Semantic Clarity**: API names should describe business operations, not HTTP methods
- **Documentation for LLMs**: Descriptions must include when-to-use triggers, parameter semantics, and response examples
- **Search-First**: Every entity should be findable by human-friendly attributes
- **Error Design**: Errors include code, message, remediation steps, and suggested next tools
- **Consistency**: One term per concept, consistent parameter naming across tools
- **MCP Alignment**: How these principles map to Model Context Protocol tool definitions

**Step 2: Write `agent-native-principles.md`**

Content extracted from the Arquitectura Agent Native PDF. Key sections:

- **Available Actions Pattern**: Every response includes next possible actions
- **Operation Levels**: 5-level classification (Read → Irreversible)
- **Delegated Confirmations**: Biometric/push/OTP for sensitive operations
- **Rich Semantics**: `formatted`, `formatted_spoken`, `message_for_user`
- **Idempotency**: Keys for transactional operations
- **Bounded Contexts**: Domain-organized tool sets

**Step 3: Write `tool-quality-checklist.md`**

```markdown
# Tool Quality Checklist

Run through this checklist before finalizing any tool set.

## Naming & Semantics
- [ ] Names describe domain operations, not CRUD (e.g., `get_account_balances` not `get_resource`)
- [ ] snake_case naming consistently
- [ ] One term per concept across all tools (e.g., always `account_id`, never `acct_id`)
- [ ] No ambiguous abbreviations

## Descriptions & Discovery
- [ ] Each tool has a clear 1-2 sentence description
- [ ] Trigger phrases included ("Usar cuando el usuario diga: ...")
- [ ] All parameters documented with type and constraints
- [ ] Examples provided for complex parameters

## Parameters
- [ ] Money amounts use structured format: `{"value": N, "currency": "X"}`
- [ ] Dates use ISO format: `YYYY-MM-DD`
- [ ] Optional parameters have sensible defaults
- [ ] No user IDs or secrets as parameters (use context injection)
- [ ] Enum values documented in description

## Responses
- [ ] Standard response pattern: `data`, `formatted`, `available_actions`, `message_for_user`
- [ ] `available_actions` includes logical next tools
- [ ] Error responses include code, message, remediation, suggestions
- [ ] No sensitive data leaked in responses

## Operation Levels
- [ ] Each tool classified by level (1-5)
- [ ] Level 3+ tools require confirmation
- [ ] Level 4+ use delegated confirmation (biometric/OTP)
- [ ] Transactional tools support idempotency keys

## Organization
- [ ] Tools grouped by business domain
- [ ] Each domain exports a `TOOLS` list
- [ ] No tool exceeds 15 parameters
- [ ] No domain exceeds 10 tools (split if more)

## Coverage
- [ ] Agent can do everything users can (no orphan UI actions)
- [ ] Batch operations available alongside single-item tools
- [ ] Search/filter tools cover common user queries
```

**Step 4: Write `tool-examples.md`**

Real-world examples from the Uendi 32-tool catalog. Include 3-4 representative examples across domains:

- `get_account_balances` (Level 1, read-only, domain: cuentas)
- `transfer_funds` (Level 4, financial, domain: transferencias)
- `get_investments` (Level 1, with projections, domain: inversiones)
- `create_investment` (Level 4, with confirmation, domain: inversiones)

Show the complete tool definition with docstring, parameters, and response pattern for each.

**Step 5: Verify all 4 files exist**

```bash
ls plugins/deepagents-builder/skills/tool-design/references/
```

Expected: `ai-friendly-principles.md`, `agent-native-principles.md`, `tool-quality-checklist.md`, `tool-examples.md`

**Step 6: Commit**

```bash
git add plugins/deepagents-builder/skills/tool-design/references/
git commit -m "feat(deepagents-builder): add tool-design reference files

Four reference files for the tool-design skill:
- AI-friendly API design principles
- Agent native architecture patterns
- Tool quality verification checklist
- Real-world tool examples from 32-tool catalog"
```

---

### Task 4: Create `tool-architect` Agent

**Files:**
- Create: `plugins/deepagents-builder/agents/tool-architect.md`

**Step 1: Write agent file**

Follow the same frontmatter format as `agents/agent-architect.md`:

```markdown
---
model: sonnet
tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
description: |
  Designs and generates AI-friendly tools for agents. Use this agent proactively when the user needs to create tools for an agent, convert an API to agent tools, or design a tool catalog.

  <example>
  User: I need to create tools for a banking agent
  Action: Use tool-architect to discover requirements, design tools, and generate code
  </example>

  <example>
  User: Convert this REST API into agent tools
  Action: Use tool-architect to map API endpoints to AI-friendly tools
  </example>

  <example>
  User: Design tools for my customer support agent
  Action: Use tool-architect to create domain-organized tool catalog
  </example>
---

# Tool Architect

You are an expert in designing AI-friendly tools for agents. You help users create well-structured, discoverable, and composable tool sets following AI-Friendly API Design and Agent Native architecture principles.

## Your Process

### Phase 1: Discovery

Ask the user about:
1. **Domain**: What business domain do the tools serve?
2. **User goals**: What will end users ask the agent to help with?
3. **Existing APIs**: Are there REST APIs, databases, or services to wrap?
4. **Agent type**: Single agent or multi-agent with domain subagents?
5. **Output format**: Python tools (`@tool` decorator) or MCP tool definitions?

Use AskUserQuestion for each question. Don't ask all at once.

### Phase 2: Capability Mapping

Based on discovery:
1. List all capabilities the agent needs
2. Group into bounded contexts (domains)
3. Assign operation levels (1-5) to each
4. Identify which need confirmation flows
5. Map the tool graph (available_actions connections)

Present the mapping to the user for validation before proceeding.

### Phase 3: Tool Design

For each tool, define:
- **Name**: Domain-semantic snake_case
- **Description**: What it does + trigger phrases
- **Parameters**: With types, constraints, defaults
- **Response pattern**: data, formatted, available_actions, message_for_user
- **Operation level**: 1-5
- **Domain**: Which bounded context

### Phase 4: Code Generation

Generate code based on user's chosen format:

**Python (`@tool` decorator):**
```python
# domains/{domain}/tools.py
from langchain_core.tools import tool
from typing import Optional

@tool
def tool_name(param: type = default) -> dict:
    """
    Description of what the tool does.

    Usar cuando el usuario diga:
    - 'trigger phrase 1'
    - 'trigger phrase 2'

    Args:
        param: Description with constraints
    """
    return {
        "data": {...},
        "formatted": "Human-readable text",
        "available_actions": ["next_tool_1", "next_tool_2"],
        "message_for_user": "Text for end user"
    }

TOOLS = [tool_name, ...]
```

**MCP (JSON definitions):**
```json
{
  "name": "tool_name",
  "description": "Description. Use when: trigger phrase 1, trigger phrase 2.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param": {"type": "string", "description": "Description"}
    },
    "required": ["param"]
  }
}
```

Organize files by domain. Write each domain's tools to a separate file.

### Phase 5: Verification

Run through the quality checklist:
- [ ] Semantic names (not CRUD)
- [ ] Trigger phrases in all descriptions
- [ ] Standard response pattern (data, formatted, available_actions, message_for_user)
- [ ] Operation levels assigned
- [ ] available_actions form coherent graph
- [ ] No sensitive data as parameters
- [ ] Consistent terminology across domains
- [ ] Idempotency keys for transactional tools

Report results and suggest fixes for any failures.

## Key Principles

Reference the tool-design skill for full principles:
1. **Semantic clarity** — domain names, not CRUD
2. **Natural language** — trigger phrases, search-first
3. **Structured types** — explicit schemas
4. **Actionable errors** — code + remediation
5. **Consistent terminology** — one term per concept
6. **Rich semantics** — formatted, available_actions
7. **Operation levels** — 5 levels with appropriate confirmations
8. **Idempotency** — for transactional operations

## Output

Deliver:
1. **Domain map** with tool inventory per domain
2. **Generated code** files organized by domain
3. **Tool graph** showing available_actions connections
4. **Verification report** from quality checklist
```

**Step 2: Verify frontmatter format**

Read the file. Verify:
- `model: sonnet` matches other agents
- `tools` list is correct (Read, Write, Glob, Grep, AskUserQuestion)
- `description` includes examples like `agent-architect.md`
- Agent process has 5 phases matching design doc

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/agents/tool-architect.md
git commit -m "feat(deepagents-builder): add tool-architect agent

Proactive agent that designs and generates AI-friendly tools.
5-phase process: discovery, mapping, design, generation, verification.
Supports Python @tool and MCP output formats."
```

---

### Task 5: Update `quickstart/SKILL.md`

Fix API patterns and add interactive chat template.

**Files:**
- Modify: `plugins/deepagents-builder/skills/quickstart/SKILL.md`

**Step 1: Fix API patterns throughout the file**

Key changes to make:

1. **Replace `create_deep_agent` with `create_react_agent`** — The quickstart currently uses a fictional `create_deep_agent` function. Replace with the actual `create_react_agent` from `langgraph.prebuilt`.

2. **Fix imports** — Change from `from deepagents import create_deep_agent` to `from langgraph.prebuilt import create_react_agent`.

3. **Fix model format** — Ensure all model references use `"provider:model"` string format.

4. **Fix system prompt parameter** — Use `prompt=` not `system_prompt=`.

5. **Fix context schema** — Use `context_schema=` not `config_schema=`.

6. **Fix subagent pattern** — Use "agent as tool" pattern instead of dict-based subagents.

7. **Add checkpointer to all examples** — Use `MemorySaver()` consistently.

8. **Update installation** — Change from `pip install deepagents` to correct packages.

9. **Add Interactive Chat section** with a basic `chat.py` template after the Common Patterns section.

10. **Add reference to API Cheatsheet** in Next Steps section.

Here are the specific edits:

**Edit: Installation section**
Replace `pip install deepagents` with:
```bash
pip install langgraph langchain-core langchain-anthropic
```

**Edit: Minimal Agent**
```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    prompt="You are a helpful research assistant.",
    tools=[],
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Research AI trends"}]
})
print(result["messages"][-1].content)
```

**Edit: Agent with Custom Tools**
```python
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[search_web],
    prompt="You are a research assistant.",
)
```

**Edit: Agent with Subagents** — Replace dict-based subagents with "agent as tool":
```python
from langgraph.prebuilt import create_react_agent

# Create specialist as standalone agent
researcher = create_react_agent(
    model="openai:gpt-4o",
    tools=[search_web],
    prompt="You are an expert researcher. Summarize findings concisely.",
    name="researcher",
)

# Use specialist as tool in parent agent
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[researcher],  # Agent used as tool
    prompt="You coordinate research projects. Delegate research to the researcher tool.",
)
```

**Edit: Replace `backend=FilesystemBackend` section** — Remove the AGENTS.md/memory section since that's specific to the fictional `deepagents` library. Replace with `context_schema` pattern:

```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from dataclasses import dataclass

@dataclass
class ProjectContext:
    project_name: str
    preferences: dict

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    prompt="You are a project assistant.",
    context_schema=ProjectContext,
    checkpointer=MemorySaver(),
)

result = agent.invoke(
    {"messages": [...]},
    context=ProjectContext(project_name="my-project", preferences={"format": "markdown"}),
)
```

**Edit: Model Configuration section**
```python
from langchain.chat_models import init_chat_model

# Claude (recommended)
model = init_chat_model("anthropic:claude-sonnet-4-20250514")

# OpenAI
model = init_chat_model("openai:gpt-4o")

# Google
model = init_chat_model("google_genai:gemini-2.0-flash")

agent = create_react_agent(model=model, tools=[...])
```

**Edit: Add new section before "Next Steps" — Interactive Chat Console**

```markdown
## Interactive Chat Console

Test your agent interactively with tool call logging:

```python
# chat.py
import uuid
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

def create_my_agent():
    return create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        tools=[...],
        prompt="Your system prompt here.",
        checkpointer=MemorySaver(),
    )

def main():
    agent = create_my_agent()
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    print("Chat with your agent (type 'exit' to quit, 'new' for new thread)")
    while True:
        user_input = input("\nYou: ").strip()
        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "salir"):
            break
        if user_input.lower() in ("new", "nuevo"):
            thread_id = str(uuid.uuid4())
            config = {"configurable": {"thread_id": thread_id}}
            print(f"  New thread: {thread_id[:8]}...")
            continue

        result = agent.invoke(
            {"messages": [{"role": "user", "content": user_input}]},
            config=config,
        )

        # Log tool calls
        for msg in result["messages"]:
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    args = ", ".join(f"{k}={v!r}" for k, v in tc["args"].items())
                    print(f"  Tool: {tc['name']}({args})")

        print(f"\nAgent: {result['messages'][-1].content}")

if __name__ == "__main__":
    main()
` ``

Use `/add-interactive-chat` to generate a chat console tailored to your specific agent.
```

**Edit: Update Built-in Tools table** — Since we're moving away from `deepagents` library, update the table to reflect LangGraph's actual built-in capabilities. Remove references to `write_todos`, `read_todos`, `ls`, etc. that are specific to the fictional library.

**Edit: Update Next Steps** — Add reference to api-cheatsheet and tool-design:

```markdown
## Next Steps

After basic setup, explore:

- **[Architecture](../architecture/SKILL.md)**: Design agent topologies and bounded contexts
- **[Patterns](../patterns/SKILL.md)**: System prompts, tool design, anti-patterns
- **[Tool Design](../tool-design/SKILL.md)**: AI-friendly tool design principles
- **[Evals](../evals/SKILL.md)**: Testing, benchmarking, and debugging
- **[Evolution](../evolution/SKILL.md)**: Maturity model and refactoring strategies
- **[API Cheatsheet](../patterns/references/api-cheatsheet.md)**: Current LangGraph API reference

### Commands

- `/new-sdk-app` - Scaffold a new agent project with dependencies and examples
- `/design-topology` - Interactive guide to design optimal agent topology
- `/validate-agent` - Check agent code for anti-patterns and security issues
- `/add-interactive-chat` - Generate an interactive chat console for testing your agent
```

**Step 2: Read and verify the updated file**

Verify all `create_deep_agent` references are replaced, all model formats are correct, and the chat section is properly integrated.

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/skills/quickstart/SKILL.md
git commit -m "fix(deepagents-builder): update quickstart with correct LangGraph API

Replace create_deep_agent with create_react_agent from langgraph.prebuilt.
Fix model format, prompt parameter, context_schema, subagent pattern.
Add interactive chat console template."
```

---

### Task 6: Update `patterns/SKILL.md`

Fix API patterns and add references to new components.

**Files:**
- Modify: `plugins/deepagents-builder/skills/patterns/SKILL.md`

**Step 1: Fix API patterns**

Key changes:

1. **Replace `create_deep_agent` with `create_react_agent`** throughout the file.

2. **Fix imports** — All code samples should use:
   ```python
   from langgraph.prebuilt import create_react_agent
   from langgraph.checkpoint.memory import MemorySaver
   from langchain_core.tools import tool
   ```

3. **Fix system prompt parameter** — Replace `system_prompt=` with `prompt=` in all `create_react_agent` calls.

4. **Fix subagent pattern** — Replace dict-based subagents with "agent as tool" pattern in all examples.

5. **Fix `system_prompt` vs `AGENTS.md` table** — Update to `prompt` vs runtime context.

6. **Fix ToolRuntime pattern** — Update the ToolRuntime section to use `context_schema=` and `context=` parameter (not `config_schema=`).

7. **Add link to api-cheatsheet** in Additional Resources section.

8. **Add link to tool-design skill** in Related Skills section.

**Step 2: Verify changes**

Read the updated file. Search for any remaining `create_deep_agent`, `system_prompt=`, `config_schema=` references that should have been replaced.

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/skills/patterns/SKILL.md
git commit -m "fix(deepagents-builder): update patterns skill with correct LangGraph API

Replace create_deep_agent with create_react_agent, fix prompt parameter,
update subagent pattern to agent-as-tool, fix ToolRuntime context_schema."
```

---

### Task 7: Update `patterns/references/tool-patterns.md`

Add InjectedState, InjectedStore patterns and fix imports.

**Files:**
- Modify: `plugins/deepagents-builder/skills/patterns/references/tool-patterns.md`

**Step 1: Fix imports and add injection patterns**

Key changes:

1. **Fix ToolRuntime imports** — Replace:
   ```python
   from langchain.tools import tool, ToolRuntime
   ```
   With:
   ```python
   from langchain_core.tools import tool
   from langgraph.prebuilt import InjectedState, InjectedStore
   from typing import Annotated
   ```

2. **Replace ToolRuntime pattern with InjectedState/InjectedStore** — The ToolRuntime pattern in the current file should be updated to use the actual LangGraph injection pattern:

   ```python
   from langchain_core.tools import tool
   from langgraph.prebuilt import InjectedState
   from typing import Annotated

   @tool
   def get_user_data(
       state: Annotated[dict, InjectedState],  # Invisible to LLM
   ) -> dict:
       """Get current user's profile data."""
       user_id = state["user_id"]  # From injected state
       return fetch_from_db(user_id)
   ```

3. **Add AI-Friendly response pattern section** — Add a new section near the top for the standard response pattern from tool-design:

   ```python
   ## AI-Friendly Response Pattern

   Tools should return structured responses with navigation:

   ```python
   @tool
   def get_account_balances(include_details: bool = False) -> dict:
       """Consulta saldos de todas las cuentas."""
       return {
           "data": [...],
           "formatted": "Tus cuentas:\n  - Cuenta PYG: Gs. 5.000.000",
           "available_actions": ["get_transactions", "transfer_funds"],
           "message_for_user": "Tus cuentas:\n  - Cuenta PYG: Gs. 5.000.000"
       }
   ```

   See [Tool Design Skill](../../tool-design/SKILL.md) for complete principles.
   ```

4. **Update `create_deep_agent` references** to `create_react_agent`.

5. **Fix context_schema usage** in the secure tools section.

**Step 2: Verify no broken references**

Read the updated file. Verify imports are consistent and no `ToolRuntime` references remain.

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/skills/patterns/references/tool-patterns.md
git commit -m "fix(deepagents-builder): update tool-patterns with InjectedState/InjectedStore

Replace ToolRuntime with InjectedState/InjectedStore from langgraph.prebuilt.
Add AI-friendly response pattern section. Fix all imports."
```

---

### Task 8: Update `patterns/references/anti-patterns.md`

Add deprecated API anti-patterns.

**Files:**
- Modify: `plugins/deepagents-builder/skills/patterns/references/anti-patterns.md`

**Step 1: Add new anti-patterns**

Add 3 new anti-patterns at the end, before the Detection Checklist:

**Anti-Pattern 17: Deprecated API Usage**

```python
# Bad: Using deprecated parameters
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    state_modifier="You are helpful.",     # DEPRECATED
    config_schema=MyContext,               # DEPRECATED
)

# Good: Current API
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    prompt="You are helpful.",             # Current
    context_schema=MyContext,              # Current
)
```

**Anti-Pattern 18: Opaque Tool Responses**

```python
# Bad: Raw data, no navigation
@tool
def get_balance(account_id: str) -> dict:
    return {"balance": 5000000}

# Good: Rich response with navigation
@tool
def get_account_balances() -> dict:
    return {
        "data": {"balance": 5000000},
        "formatted": "Saldo: Gs. 5.000.000",
        "available_actions": ["get_transactions", "transfer_funds"],
        "message_for_user": "Tu saldo es Gs. 5.000.000"
    }
```

**Anti-Pattern 19: CRUD Tool Names**

```python
# Bad: Generic CRUD naming
tools = [get_resource, create_resource, update_resource, delete_resource]

# Good: Domain-semantic naming
tools = [get_account_balances, create_investment, update_account_alias, cancel_transfer]
```

**Step 2: Update Detection Checklist**

Add to the "Agent-Native Anti-Patterns" section of the checklist:

```markdown
- [ ] Using current API parameters? (prompt=, context_schema=) (Deprecated API)
- [ ] Tool responses include formatted + available_actions? (Opaque Responses)
- [ ] Tool names are domain-semantic, not CRUD? (CRUD Names)
```

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/skills/patterns/references/anti-patterns.md
git commit -m "feat(deepagents-builder): add deprecated API and tool design anti-patterns

Add anti-patterns 17-19: deprecated API usage, opaque tool responses,
CRUD tool names. Update detection checklist."
```

---

### Task 9: Create `add-interactive-chat` Command

**Files:**
- Create: `plugins/deepagents-builder/commands/add-interactive-chat.md`

**Step 1: Write command file**

Follow the same frontmatter format as `commands/new-sdk-app.md`:

```markdown
---
name: add-interactive-chat
description: Generate an interactive chat console (chat.py) for testing your agent with tool call logging, thread management, and optional context injection.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - Bash
argument-hint: "[agent-module-path]"
---

# Add Interactive Chat Console

Generate a `chat.py` file for interactively testing your agent from the terminal. Shows tool calls with parameters and supports thread management.

## Workflow

### Step 1: Detect Agent

If agent module path provided in arguments, use it directly. Otherwise:

1. Search for agent creation functions in the project:
   ```
   Grep for: "create_react_agent\|create_agent\|def create_.*agent"
   ```
2. If multiple found, ask user which one to use
3. If none found, ask user for the module path and function name

Extract:
- **Import path**: e.g., `from src.agent import create_my_agent`
- **Function name**: e.g., `create_my_agent`
- **Has context_schema**: Check if the agent uses `context_schema=`
- **Has checkpointer**: Check if a checkpointer is already configured

### Step 2: Determine Features

Ask the user which features to include:

1. **Context injection** (if context_schema detected): Include user context switching?
2. **Verbose logging**: Show full tool call parameters or summary only?
3. **Multi-user**: Support switching between test users?

### Step 3: Generate `chat.py`

Write the file adapted to the detected agent. Base template:

```python
"""Interactive chat console for testing your agent."""
import uuid
import sys

# --- Agent import (detected from project) ---
from {agent_module} import {agent_function}

def format_tool_call(tool_call: dict) -> str:
    """Format a tool call for display."""
    name = tool_call["name"]
    args = tool_call.get("args", {})
    args_str = ", ".join(f"{k}={v!r}" for k, v in args.items())
    return f"  Tool: {name}({args_str})"

def format_tool_response(msg) -> str:
    """Format tool response summary."""
    content = str(msg.content) if hasattr(msg, 'content') else str(msg)
    if len(content) > 100:
        content = content[:100] + "..."
    return f"  Response: {content}"

def main():
    # Create agent
    agent = {agent_function}()
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    # Context (if context_schema detected)
    {context_block}

    print(f"Agent ready. Thread: {thread_id[:8]}...")
    print("Commands: 'exit' | 'new' (new thread) | 'user <id>' (switch user)")
    print("-" * 50)

    while True:
        try:
            user_input = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "salir"):
            print("Bye!")
            break
        if user_input.lower() in ("new", "nuevo"):
            thread_id = str(uuid.uuid4())
            config = {"configurable": {"thread_id": thread_id}}
            print(f"  New thread: {thread_id[:8]}...")
            continue
        {user_switch_block}

        try:
            result = agent.invoke(
                {"messages": [{"role": "user", "content": user_input}]},
                config=config,
                {context_invoke}
            )

            # Log tool calls
            for msg in result["messages"]:
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    for tc in msg.tool_calls:
                        print(format_tool_call(tc))
                if hasattr(msg, "name") and msg.name:  # ToolMessage
                    print(format_tool_response(msg))

            # Print agent response
            final = result["messages"][-1].content
            print(f"\nAgent: {final}")

        except Exception as e:
            print(f"\n  Error: {e}")

if __name__ == "__main__":
    main()
```

**Adaptations by detected features:**

- **With context_schema**: Add context creation at top, include `context=` in invoke, add user switching command
- **Without checkpointer**: Wrap the agent creation to add `MemorySaver()` checkpointer
- **Multi-user**: Add user ID management and switching

### Step 4: Verify

After writing the file:
1. Read it back to confirm syntax
2. Show the user the generated file path
3. Provide run instructions:
   ```
   python chat.py
   ```

### Step 5: Usage Instructions

Print to user:
```
Chat console generated at: {path}/chat.py

Run it:
  python chat.py

Commands in chat:
  exit/quit/salir  - Exit
  new/nuevo        - Start new conversation thread
  user <id>        - Switch test user (if context enabled)

Tool calls are logged automatically:
  You: What's my balance?
    Tool: get_account_balances(include_details=False)
    Response: 2 accounts found
  Agent: Your accounts are...
```
```

**Step 2: Verify command format**

Read the file. Verify frontmatter matches `new-sdk-app.md` format (name, description, allowed-tools, argument-hint).

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/commands/add-interactive-chat.md
git commit -m "feat(deepagents-builder): add interactive chat command

/add-interactive-chat generates a chat.py console for testing agents.
Auto-detects agent function, supports context injection, tool call
logging, and thread management."
```

---

### Task 10: Update `new-sdk-app.md` Command

Add chat.py to scaffold and fix API patterns.

**Files:**
- Modify: `plugins/deepagents-builder/commands/new-sdk-app.md`

**Step 1: Fix API patterns**

Replace all `create_deep_agent` with `create_react_agent`. Fix:
- Import: `from langgraph.prebuilt import create_react_agent`
- Parameter: `prompt=` instead of `system_prompt=`
- Subagent pattern: agent as tool instead of dict
- Model format: already uses string format (OK)

**Step 2: Add chat.py to project structure**

Update the directory structure to include `chat.py`:

```
{project-name}/
├── src/
│   └── {project_name}/
│       ├── __init__.py
│       ├── agent.py
│       ├── tools.py
│       ├── prompts.py
│       └── chat.py         # <-- NEW
├── tests/
│   └── test_agent.py
├── pyproject.toml
├── README.md
└── .env.example
```

**Step 3: Add chat.py template generation**

After the `.env.example` section, add chat.py generation:

```python
# src/{project_name}/chat.py
"""Interactive chat console for testing your agent."""
import uuid
from .agent import create_agent  # or create_research_agent, etc.
from langgraph.checkpoint.memory import MemorySaver

def main():
    agent = create_agent()
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    print("Chat with your agent (type 'exit' to quit, 'new' for new thread)")
    while True:
        user_input = input("\nYou: ").strip()
        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit"):
            break
        if user_input.lower() == "new":
            thread_id = str(uuid.uuid4())
            config = {"configurable": {"thread_id": thread_id}}
            print(f"  New thread: {thread_id[:8]}...")
            continue

        result = agent.invoke(
            {"messages": [{"role": "user", "content": user_input}]},
            config=config,
        )

        for msg in result["messages"]:
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    args = ", ".join(f"{k}={v!r}" for k, v in tc["args"].items())
                    print(f"  Tool: {tc['name']}({args})")

        print(f"\nAgent: {result['messages'][-1].content}")

if __name__ == "__main__":
    main()
```

**Step 4: Update setup instructions** to include chat:

```bash
# Chat with your agent
python -m {project_name}.chat
```

**Step 5: Fix pyproject.toml dependencies**

```toml
dependencies = [
    "langgraph>=0.3.0",
    "langchain-core>=0.3.0",
    "langchain-anthropic>=0.3.0",
    "python-dotenv>=1.0.0",
]
```

**Step 6: Commit**

```bash
git add plugins/deepagents-builder/commands/new-sdk-app.md
git commit -m "fix(deepagents-builder): update new-sdk-app with correct API and chat template

Replace create_deep_agent with create_react_agent, fix prompt parameter,
add chat.py to scaffold, fix dependencies."
```

---

### Task 11: Update `plugin.json` and README

**Files:**
- Modify: `plugins/deepagents-builder/.claude-plugin/plugin.json`
- Modify: `plugins/deepagents-builder/README.md`

**Step 1: Update plugin.json description**

Add mention of tool design capability:

```json
{
  "name": "deepagents-builder",
  "version": "1.1.0",
  "description": "Build production-ready AI agents with LangGraph. Provides skills for architecture design, AI-friendly tool design, implementation patterns, interactive testing, and evolution strategies.",
  "author": {
    "name": "spuli"
  },
  "keywords": ["deepagents", "langchain", "langgraph", "ai-agents", "multi-agent", "architecture", "tool-design"]
}
```

**Step 2: Update README.md**

Read the current README and update it to mention:
- New tool-design skill
- New tool-architect agent
- New /add-interactive-chat command
- API cheatsheet reference
- Updated LangGraph API patterns

**Step 3: Commit**

```bash
git add plugins/deepagents-builder/.claude-plugin/plugin.json plugins/deepagents-builder/README.md
git commit -m "docs(deepagents-builder): update plugin metadata and README for v1.1

Add tool-design skill, tool-architect agent, interactive chat command,
and API cheatsheet to documentation. Bump version to 1.1.0."
```

---

## Summary

| Task | Component | Type | Dependencies |
|------|-----------|------|-------------|
| 1 | api-cheatsheet.md | Create reference | None |
| 2 | tool-design/SKILL.md | Create skill | None |
| 3 | tool-design/references/* | Create 4 references | Task 2 |
| 4 | tool-architect.md | Create agent | Task 2 |
| 5 | quickstart/SKILL.md | Update skill | Task 1 |
| 6 | patterns/SKILL.md | Update skill | Task 1 |
| 7 | tool-patterns.md | Update reference | Task 1 |
| 8 | anti-patterns.md | Update reference | Task 1 |
| 9 | add-interactive-chat.md | Create command | None |
| 10 | new-sdk-app.md | Update command | Task 1 |
| 11 | plugin.json + README | Update metadata | All above |

**Parallel groups:**
- Tasks 1, 2, 9 can run in parallel (no dependencies)
- Tasks 3, 4 depend on Task 2
- Tasks 5, 6, 7, 8, 10 depend on Task 1
- Task 11 runs last
