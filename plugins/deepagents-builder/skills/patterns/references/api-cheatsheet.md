# DeepAgents API Cheatsheet

Canonical API reference for DeepAgents and the LangChain agent ecosystem. All skills and commands in this plugin MUST align to the patterns documented here. When in doubt, this file is the single source of truth.

---

## API Hierarchy

| Level | Function | Package | Prompt Param | Use Case |
|-------|----------|---------|--------------|----------|
| **High** | `create_deep_agent` | `deepagents` | `system_prompt=` | Planning, filesystem, subagents, auto-summarization built-in |
| **Mid** | `create_agent` | `langchain.agents` | `system_prompt=` | Custom middleware, custom state |
| **Low** | `create_react_agent` | `langgraph.prebuilt` | `prompt=` | Basic ReAct loop (legacy, being deprecated) |

---

## 1. Agent Creation

### `create_deep_agent` (Primary — Recommended)

The high-level API with planning, filesystem backends, subagent orchestration, and auto-summarization built in.

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a helpful research assistant.",
    tools=[search, calculate],
    subagents=[
        {"name": "researcher", "tools": [web_search], "system_prompt": "You research topics."},
        {"name": "writer", "tools": [write_doc], "system_prompt": "You write documents."},
    ],
    backend=FilesystemBackend(root_dir="./workspace"),
    memory=["./AGENTS.md"],
    skills=["./skills/"],              # Load SKILL.md files from directory
    middleware=[logging_middleware],
    interrupt_on={"tool": {"allowed_decisions": ["approve", "reject", "modify"]}},
    checkpointer=checkpointer,
    store=store,
)
```

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | `str` | Model identifier in `"provider:model"` format |
| `system_prompt` | `str` | System prompt for the agent |
| `tools` | `list` | List of tools (functions decorated with `@tool`) |
| `subagents` | `list[dict]` | Subagent definitions as dicts (see §5) |
| `backend` | `Backend` | Persistence backend (`FilesystemBackend`, `StateBackend`, `StoreBackend`, `CompositeBackend`) |
| `memory` | `list[str]` | List of file paths for persistent context, e.g. `["./AGENTS.md"]` (see §8) |
| `skills` | `list[str]` | Directory paths containing SKILL.md files for on-demand loading |
| `middleware` | `list[Callable]` | Middleware functions that run on each step |
| `interrupt_on` | `dict` | HITL configuration for tool approval (see §7) |
| `checkpointer` | `Checkpointer` | Persistence backend for conversation state |
| `store` | `BaseStore` | Key-value store for persistent memory |

### `create_agent` (Mid-Level Alternative)

From `langchain.agents`, provides custom middleware and state management without the high-level features.

```python
from langchain.agents import create_agent

agent = create_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=[search, calculate],
    system_prompt="You are a helpful assistant.",
    middleware=[logging_middleware, auth_middleware],
)
```

### `create_react_agent` (Legacy / Low-Level)

> **Deprecation Notice**: `create_react_agent` from `langgraph.prebuilt` is a low-level API being deprecated in favor of `create_deep_agent`. Use only when you need direct control over the ReAct loop and cannot use higher-level APIs.

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=[search, calculate],
    prompt="You are a helpful assistant.",  # Note: prompt=, not system_prompt=
    checkpointer=checkpointer,
)
```

---

## 2. Model Format

Always use the `"provider:model"` string format. Do NOT instantiate model objects directly.

```python
# Correct: string format
model = "anthropic:claude-sonnet-4-5-20250929"
model = "openai:gpt-4o"
model = "google_genai:gemini-2.0-flash"

# Also correct: init_chat_model for advanced configuration
from langchain.chat_models import init_chat_model

model = init_chat_model(
    "anthropic:claude-sonnet-4-5-20250929",
    temperature=0.7,
    max_tokens=4096,
)
```

**Common provider prefixes:**

| Provider | Prefix | Example |
|----------|--------|---------|
| Anthropic | `anthropic:` | `"anthropic:claude-sonnet-4-5-20250929"` |
| OpenAI | `openai:` | `"openai:gpt-4o"` |
| Google | `google_genai:` | `"google_genai:gemini-2.0-flash"` |

---

## 3. Tool Definition

### Basic Tool

```python
from langchain.tools import tool

@tool
def search_products(query: str, max_results: int = 10) -> list[dict]:
    """Search product catalog by name or category.

    Args:
        query: Search terms
        max_results: Maximum results to return
    """
    return db.search(query, limit=max_results)
```

### ToolRuntime: Secure Context Injection

Use `ToolRuntime` to inject runtime context (user identity, credentials, tenant info) into tools without exposing it as LLM-visible parameters. This replaces the deprecated `InjectedState` and `InjectedStore`.

```python
from typing import Annotated
from langchain.tools import tool, ToolRuntime

@tool
def get_user_data(
    runtime: ToolRuntime[SecureContext],  # Invisible to LLM
) -> dict:
    """Get current user's profile data."""
    user_id = runtime.context.user_id
    return fetch_from_db(user_id)

@tool
def save_preference(
    key: str,
    value: str,
    runtime: ToolRuntime[SecureContext],  # Invisible to LLM
) -> str:
    """Save a user preference."""
    runtime.store.put(("preferences", runtime.context.user_id), key, {"value": value})
    return f"Saved preference: {key}"
```

**`ToolRuntime` provides:**

| Attribute | Description |
|-----------|-------------|
| `runtime.context` | The typed context object (from `context_schema` or backend) |
| `runtime.store` | Access to the persistent key-value store |
| `runtime.state` | Access to the current agent state (messages, etc.) |

---

## 4. Context Schema

Use a dataclass or Pydantic model to define runtime context that is invisible to the LLM but accessible via `ToolRuntime` in tools.

```python
from dataclasses import dataclass
from deepagents import create_deep_agent

@dataclass
class UserContext:
    user_id: str
    tenant_id: str
    permissions: list[str]

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=[get_user_data, update_profile],
    system_prompt="You are a user account assistant.",
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

---

## 5. Subagent Patterns

### Subagent Dicts (Recommended)

The native pattern for `create_deep_agent`. Define subagents as dicts — the framework compiles them into `CompiledSubAgent` instances with proper lifecycle management.

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You coordinate research and writing tasks.",
    tools=[],
    subagents=[
        {
            "name": "researcher",
            "model": "openai:gpt-4o",
            "tools": [web_search, arxiv_search],
            "system_prompt": "You are an expert researcher. Search thoroughly and return findings.",
        },
        {
            "name": "writer",
            "tools": [write_document],
            "system_prompt": "You write clear, structured documents.",
        },
    ],
)
```

**Subagent dict fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `str` | Yes | Unique identifier for the subagent |
| `system_prompt` | `str` | Yes | System prompt defining role and behavior |
| `tools` | `list` | No | Tools available to the subagent |
| `model` | `str` | No | Model override (inherits parent if omitted) |
| `description` | `str` | No | Description for parent's routing decisions |
| `backend` | `Backend` | No | Subagent-specific backend |

### CompiledSubAgent

When you need programmatic access to compiled subagents:

```python
from deepagents import create_deep_agent, CompiledSubAgent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="Coordinator.",
    subagents=[...],
)

# Access compiled subagents
for subagent in agent.subagents:
    print(f"{subagent.name}: {type(subagent)}")  # CompiledSubAgent
```

### Supervisor Pattern

Use `create_supervisor` for explicit orchestration with routing control (mid-level alternative).

```python
from langgraph_supervisor import create_supervisor

supervisor = create_supervisor(
    model="anthropic:claude-sonnet-4-5-20250929",
    agents=[researcher, writer],
    prompt="Route research tasks to researcher, writing tasks to writer.",
)
```

---

## 6. Backends

Backends manage persistent state (files, data, context) for agents.

| Backend | Use Case | Description |
|---------|----------|-------------|
| `FilesystemBackend` | File-first agents | Read/write files in a workspace directory |
| `StateBackend` | In-memory state | Volatile state within a session |
| `StoreBackend` | Key-value persistence | Persistent key-value store |
| `CompositeBackend` | Production | Combines multiple backends |

```python
from deepagents.backends import FilesystemBackend, CompositeBackend, StoreBackend

# File-first agent with workspace
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You manage project files.",
    tools=[],
    backend=FilesystemBackend(root_dir="./workspace"),
)

# Production: composite backend
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="Production agent.",
    tools=[],
    backend=CompositeBackend([
        FilesystemBackend(root_dir="./workspace", read_only=True),
        StoreBackend(store),
    ]),
)
```

---

## 7. Human-in-the-Loop

### `interrupt_on` (DeepAgents)

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a support agent with full capabilities.",
    tools=[process_refund, delete_account, read_data],
    checkpointer=MemorySaver(),
    interrupt_on={
        "tool": {
            "allowed_decisions": ["approve", "reject", "modify"],
        }
    },
)

# Agent pauses before sensitive tools, awaits human decision
config = {"configurable": {"thread_id": "session-1"}}
for event in agent.stream({"messages": [...]}, config, stream_mode="values"):
    if "__interrupt__" in event:
        decision = input("Approve? (approve/reject/modify): ")
        agent.invoke(None, config)  # Resume execution
```

### Checkpointers

| Checkpointer | Use Case | Import |
|--------------|----------|--------|
| `MemorySaver` | Development / testing | `from langgraph.checkpoint.memory import MemorySaver` |
| `PostgresSaver` | Production | `from langgraph.checkpoint.postgres import PostgresSaver` |
| `SqliteSaver` | Local production | `from langgraph.checkpoint.sqlite import SqliteSaver` |

---

## 8. AGENTS.md Memory Pattern

`create_deep_agent` supports an `AGENTS.md` file for declarative memory — agent capabilities, context, and history described in markdown.

```markdown
# AGENTS.md

## researcher
- Role: Research specialist
- Tools: web_search, arxiv_search
- Strengths: Deep technical research, citation tracking
- Limitations: Cannot write final reports

## writer
- Role: Document specialist
- Tools: write_document, format_markdown
- Strengths: Clear, structured writing
- Limitations: Cannot search the web
```

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You coordinate research projects.",
    subagents=[...],
    memory=["./AGENTS.md"],  # Agent reads/updates this file
)
```

The agent uses AGENTS.md for:
- **Auto-summarization**: Summarizes completed work into memory
- **Capability awareness**: Knows what each subagent can do
- **Context persistence**: Maintains knowledge across sessions

---

## 9. Built-in Tools

Every `create_deep_agent` automatically includes these tools via default middleware:

| Tool | Middleware | Description |
|------|-----------|-------------|
| `write_todos` | Planning | Create structured task lists |
| `read_todos` | Planning | View current tasks |
| `ls` | Filesystem | List directory contents |
| `read_file` | Filesystem | Read file content with pagination |
| `write_file` | Filesystem | Create or overwrite files |
| `edit_file` | Filesystem | Exact string replacements |
| `glob` | Filesystem | Find files matching patterns |
| `grep` | Filesystem | Search text in files |
| `execute` | Filesystem | Run commands in sandbox (if backend supports it) |
| `task` | SubAgent | Delegate to subagents with isolated contexts |

```python
# Built-in tools are automatic — no opt-in needed
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a coding assistant.",
    tools=[custom_tool],  # Your custom tools are added alongside built-ins
)
```

---

## 10. Invocation

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

## 11. Deprecated to Current Migration

| Deprecated | Current | Notes |
|------------|---------|-------|
| `from langgraph.prebuilt import create_react_agent` | `from deepagents import create_deep_agent` | High-level API is now primary |
| `prompt=` | `system_prompt=` | Parameter renamed in `create_deep_agent` and `create_agent` |
| `state_modifier=` / `message_modifier=` | `system_prompt=` | Legacy prompt parameters |
| `config_schema=` | `context_schema=` | Runtime context injection |
| `InjectedState` / `InjectedStore` | `ToolRuntime` | Secure context injection in tools |
| `from langchain_core.tools import tool` | `from langchain.tools import tool` | Consolidated import path |
| `interrupt_before=["tool_name"]` | `interrupt_on={"tool": {"allowed_decisions": [...]}}` | Richer HITL control |
| Agent-as-tool (only pattern) | `subagents=` dicts + `CompiledSubAgent` | Native subagent support |
| `pip install langgraph langchain-core langchain-anthropic` | `pip install deepagents` | Single package |
| Model as object only | `"provider:model"` string | String format is standard |
| `version="v1"` | `version="v2"` (now default) | v2 is default, no need to specify |

### Migration Example

```python
# DEPRECATED (do not use)
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=[...],
    prompt="You are a helpful assistant.",
    interrupt_before=["dangerous_tool"],
)

# CURRENT (use this)
from deepagents import create_deep_agent
from langchain.tools import tool, ToolRuntime

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=[...],
    system_prompt="You are a helpful assistant.",
    interrupt_on={"tool": {"allowed_decisions": ["approve", "reject"]}},
)
```

---

## Related Resources

- **`tool-patterns.md`** — Tool definition patterns and security with ToolRuntime
- **`security-patterns.md`** — Security patterns with backends and AGENTS.md protection
- **`anti-patterns.md`** — 19 common mistakes to avoid
- **`prompt-patterns.md`** — System prompt patterns for subagents
