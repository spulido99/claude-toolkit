# LangGraph/LangChain API Cheatsheet

Canonical API reference for LangGraph and LangChain. All skills and commands in this plugin MUST align to the patterns documented here. When in doubt, this file is the single source of truth.

---

## 1. Agent Creation

### `create_react_agent` (Primary)

The default and recommended way to create agents. v2 is the default since late 2025.

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[search, calculate],
    prompt="You are a helpful research assistant.",
    checkpointer=checkpointer,           # Persistence backend
    context_schema=UserContext,           # Runtime context type (dataclass)
    pre_model_hook=my_pre_hook,           # Runs before each LLM call
    post_model_hook=my_post_hook,         # Runs after each LLM call
    interrupt_before=["sensitive_tool"],  # Pause for human approval
)
```

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | `str` | Model identifier in `"provider:model"` format |
| `tools` | `list` | List of tools (functions, agents-as-tools) |
| `prompt` | `str` | System prompt for the agent |
| `checkpointer` | `Checkpointer` | Persistence backend for conversation state |
| `context_schema` | `type` | Dataclass defining runtime context shape |
| `pre_model_hook` | `Callable` | Hook that runs before each model invocation |
| `post_model_hook` | `Callable` | Hook that runs after each model invocation |
| `interrupt_before` | `list[str]` | Tool names that require human approval before execution |

### `create_agent` (Alternative)

Newer alternative from `langchain.agents` with middleware support.

```python
from langchain.agents import create_agent

agent = create_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[search, calculate],
    prompt="You are a helpful assistant.",
    middleware=[logging_middleware, auth_middleware],
)
```

---

## 2. Model Format

Always use the `"provider:model"` string format. Do NOT instantiate model objects directly.

```python
# Correct: string format
model = "anthropic:claude-sonnet-4-20250514"
model = "openai:gpt-4o"
model = "google_genai:gemini-2.0-flash"

# Also correct: init_chat_model for advanced configuration
from langchain.chat_models import init_chat_model

model = init_chat_model(
    "anthropic:claude-sonnet-4-20250514",
    temperature=0.7,
    max_tokens=4096,
)
```

**Common provider prefixes:**

| Provider | Prefix | Example |
|----------|--------|---------|
| Anthropic | `anthropic:` | `"anthropic:claude-sonnet-4-20250514"` |
| OpenAI | `openai:` | `"openai:gpt-4o"` |
| Google | `google_genai:` | `"google_genai:gemini-2.0-flash"` |

---

## 3. Context Schema (Runtime Context)

Use `context_schema=` to inject runtime context that is invisible to the LLM but accessible to tools and hooks. This replaces the deprecated `config_schema=`.

```python
from dataclasses import dataclass
from langgraph.prebuilt import create_react_agent

@dataclass
class UserContext:
    user_id: str
    tenant_id: str
    permissions: list[str]

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[get_user_data, update_profile],
    prompt="You are a user account assistant.",
    context_schema=UserContext,
)

# Invoke with context
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Show my profile"}]},
    context=UserContext(
        user_id="user_123",
        tenant_id="tenant_abc",
        permissions=["read", "write"],
    ),
)
```

**Important:** Use `context_schema=`, NOT `config_schema=` (deprecated).

---

## 4. Tool Definition

### Basic Tool

```python
from langchain_core.tools import tool

@tool
def search_products(query: str, max_results: int = 10) -> list[dict]:
    """Search product catalog by name or category.

    Args:
        query: Search terms
        max_results: Maximum results to return
    """
    return db.search(query, limit=max_results)
```

### InjectedState: Access Agent State

Use `InjectedState` to let a tool read the agent's current state (message history, etc.) without exposing it as a parameter to the LLM.

```python
from typing import Annotated
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

@tool
def summarize_conversation(
    state: Annotated[dict, InjectedState],  # Invisible to LLM
) -> str:
    """Summarize the current conversation."""
    messages = state["messages"]
    return create_summary(messages)
```

### InjectedStore: Persistent Memory

Use `InjectedStore` to give tools access to a persistent key-value store, invisible to the LLM.

```python
from typing import Annotated
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedStore
from langgraph.store.base import BaseStore

@tool
def save_user_preference(
    key: str,
    value: str,
    store: Annotated[BaseStore, InjectedStore],  # Invisible to LLM
) -> str:
    """Save a user preference for future sessions."""
    store.put(("preferences",), key, {"value": value})
    return f"Saved preference: {key}"

@tool
def get_user_preferences(
    store: Annotated[BaseStore, InjectedStore],  # Invisible to LLM
) -> dict:
    """Retrieve all saved user preferences."""
    items = store.search(("preferences",))
    return {item.key: item.value for item in items}
```

---

## 5. Subagent Patterns

### Agent as Tool (Recommended)

Create a specialist agent and pass it as a tool to the parent agent. This is the simplest and most composable pattern.

```python
from langgraph.prebuilt import create_react_agent

# Create specialist agent
research_agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[web_search, arxiv_search],
    prompt="You are a research specialist. Search thoroughly and return findings.",
)

# Use it as a tool in a parent agent
parent_agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[research_agent, calculator, write_report],
    prompt="You coordinate research tasks. Delegate research to the research tool.",
)
```

### Supervisor Pattern

Use `create_supervisor` for explicit orchestration with routing control.

```python
from langgraph_supervisor import create_supervisor

# Define specialist agents
researcher = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[web_search],
    prompt="You research topics thoroughly.",
)

writer = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[write_document],
    prompt="You write clear, structured documents.",
)

# Create supervisor that routes between them
supervisor = create_supervisor(
    model="anthropic:claude-sonnet-4-20250514",
    agents=[researcher, writer],
    prompt="Route research tasks to researcher, writing tasks to writer.",
)

result = supervisor.invoke(
    {"messages": [{"role": "user", "content": "Research AI trends and write a report"}]},
)
```

---

## 6. Checkpointers

| Checkpointer | Use Case | Import |
|--------------|----------|--------|
| `MemorySaver` | Development / testing | `from langgraph.checkpoint.memory import MemorySaver` |
| `PostgresSaver` | Production | `from langgraph.checkpoint.postgres import PostgresSaver` |
| `SqliteSaver` | Local production / single-node | `from langgraph.checkpoint.sqlite import SqliteSaver` |

```python
# Development
from langgraph.checkpoint.memory import MemorySaver
checkpointer = MemorySaver()

# Production
from langgraph.checkpoint.postgres import PostgresSaver
checkpointer = PostgresSaver(conn_string="postgresql://user:pass@host/db")

# Local production
from langgraph.checkpoint.sqlite import SqliteSaver
checkpointer = SqliteSaver(db_path="./agent_state.db")

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    checkpointer=checkpointer,
)
```

---

## 7. Invocation

### Basic Invoke

```python
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Hello!"}]},
    config={"configurable": {"thread_id": "session_001"}},
)
```

### Invoke with Context

```python
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Show my orders"}]},
    config={"configurable": {"thread_id": "session_001"}},
    context=UserContext(user_id="user_123", tenant_id="t_abc", permissions=["read"]),
)
```

### Streaming

```python
for event in agent.stream(
    {"messages": [{"role": "user", "content": "Analyze this data"}]},
    config={"configurable": {"thread_id": "session_001"}},
):
    if "messages" in event:
        for msg in event["messages"]:
            print(msg.content, end="", flush=True)
```

---

## 8. Deprecated to Current Migration

| Deprecated | Current | Notes |
|------------|---------|-------|
| `state_modifier=` | `prompt=` | System prompt parameter renamed |
| `message_modifier=` | `prompt=` | Also maps to `prompt=` |
| `config_schema=` | `context_schema=` | Runtime context injection |
| Model as object only | `"provider:model"` string | String format is now standard |
| `SubAgentMiddleware` | Agent as tool or `langgraph-supervisor` | Use composable patterns |
| `version="v1"` | `version="v2"` (now default) | v2 is default, no need to specify |

### Migration Example

```python
# DEPRECATED (do not use)
from langchain_anthropic import ChatAnthropic
model = ChatAnthropic(model="claude-sonnet-4-20250514")
agent = create_react_agent(
    model=model,
    tools=[...],
    state_modifier="You are a helpful assistant.",
    config_schema=MyConfig,
    version="v1",
)

# CURRENT (use this)
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    prompt="You are a helpful assistant.",
    context_schema=MyContext,
    # version="v2" is now the default, no need to specify
)
```

---

## Related Resources

- **`tool-patterns.md`** - Tool definition patterns and security
- **`security-patterns.md`** - Security patterns for agents
- **`anti-patterns.md`** - Common mistakes to avoid
- **`prompt-patterns.md`** - System prompt patterns for subagents
