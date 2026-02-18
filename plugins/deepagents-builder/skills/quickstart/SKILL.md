---
name: DeepAgents Quickstart
description: This skill should be used when the user asks to "start a deepagent project", "create a new agent", "quickstart agent", "simple agent example", "get started with deepagents", or needs a quick introduction to building agents with LangChain's DeepAgents framework. Provides minimal setup and basic patterns for rapid prototyping.
---

# DeepAgents Quickstart

Build production-ready deep agents with planning, context management, and subagent delegation in minutes.

## What is DeepAgents?

DeepAgents (`langchain-ai/deepagents`) is a high-level framework for building agentic applications with planning, filesystem backends, subagent orchestration, and auto-summarization built in. The core function is `create_deep_agent`, which provides:

- **Planning & summarization** — Built-in skills for structured reasoning and context management
- **Subagent delegation** — Define subagents as dicts, compiled into `CompiledSubAgent` instances
- **Filesystem backends** — `FilesystemBackend`, `StateBackend`, `StoreBackend`, `CompositeBackend`
- **AGENTS.md memory** — Declarative agent memory pattern for capability awareness and context persistence
- **Built-in tools** — `write_todos`, `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep`, `execute`, `task`
- **Human-in-the-loop** — Rich `interrupt_on` configuration for tool approval

## Installation

```bash
pip install deepagents
```

## Quick Start

### Minimal Agent

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a helpful research assistant.",
    tools=[],
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Research AI trends"}]
})
print(result["messages"][-1].content)
```

### Agent with Custom Tools

```python
from deepagents import create_deep_agent
from langchain.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    tools=[search_web],
    system_prompt="You are a research assistant.",
)
```

### Agent with Subagents

Define subagents as dicts — the framework compiles them into `CompiledSubAgent` instances:

```python
from deepagents import create_deep_agent

# Subagents defined as dicts (native pattern)
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You coordinate research projects. Delegate research to the researcher and writing to the writer.",
    tools=[],
    subagents=[
        {
            "name": "researcher",
            "model": "openai:gpt-4o",
            "tools": [search_web],
            "system_prompt": "You are an expert researcher. Summarize findings concisely.",
        },
        {
            "name": "writer",
            "tools": [write_document],
            "system_prompt": "You write clear, structured documents.",
        },
    ],
)
```

### Agent with Backend and Memory

Use `FilesystemBackend` for file-first agents and `AGENTS.md` for declarative memory:

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a project assistant.",
    tools=[],
    backend=FilesystemBackend(root_dir="./workspace"),
    memory=["./AGENTS.md"],
    skills=["./skills/"],              # Load SKILL.md files from directory
    checkpointer=MemorySaver(),
)

# Invoke with thread persistence
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Set up the project structure"}]},
    config={"configurable": {"thread_id": "project-1"}},
)
```

## Built-in Tools

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

> **Security Tip**: Use `interrupt_on` on dangerous tools to require human confirmation before execution. Use `ToolRuntime` from `langchain.tools` to inject user identity and permissions as secure context, rather than embedding user IDs in tool parameters.

## When to Use DeepAgents

### Use DeepAgents When:

- Tasks require 5+ tool calls
- Need to break complex tasks into subtasks
- Managing large context (research, analysis)
- Delegating to specialized subagents
- Building production agent systems

### Don't Use DeepAgents When:

- Simple linear tasks (< 5 tool calls)
- MVP/prototyping phase
- Deterministic workflows (use scripts)
- Single-purpose automation

## Common Patterns

### Research Agent

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="""You conduct comprehensive research.
    1. Plan research steps
    2. Search for information
    3. Synthesize into final report""",
    tools=[search_tool],
    backend=FilesystemBackend(root_dir="./research"),
    skills=["./skills/"],
)
```

### Customer Support Agent

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You coordinate customer support. Route inquiries to the appropriate specialist.",
    tools=[],
    subagents=[
        {
            "name": "inquiry-handler",
            "tools": [knowledge_base_tool],
            "system_prompt": "You answer customer questions accurately.",
        },
        {
            "name": "issue-resolver",
            "tools": [ticketing_tool],
            "system_prompt": "You resolve customer problems.",
        },
        {
            "name": "order-specialist",
            "tools": [order_tool],
            "system_prompt": "You manage customer orders.",
        },
    ],
    checkpointer=MemorySaver(),
    interrupt_on={"tool": {"allowed_decisions": ["approve", "reject"]}},
)
```

## Model Configuration

```python
from langchain.chat_models import init_chat_model

# Claude (recommended)
model = init_chat_model("anthropic:claude-sonnet-4-5-20250929")

# OpenAI
model = init_chat_model("openai:gpt-4o")

# Google
model = init_chat_model("google_genai:gemini-2.0-flash")

agent = create_deep_agent(model=model, system_prompt="...", tools=[...])
```

## Interactive Chat Console

Test your agent interactively with tool call logging:

```python
# chat.py
import uuid
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

def create_my_agent():
    return create_deep_agent(
        model="anthropic:claude-sonnet-4-5-20250929",
        tools=[...],
        system_prompt="Your system prompt here.",
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
```

Use `/add-interactive-chat` to generate a chat console tailored to your specific agent.

## Next Steps

After basic setup, explore:

- **[Architecture](../architecture/SKILL.md)**: Design agent topologies and bounded contexts
- **[Patterns](../patterns/SKILL.md)**: System prompts, tool design, anti-patterns
- **[Tool Design](../tool-design/SKILL.md)**: Best practices for designing AI-friendly agent tools
- **[Evals](../evals/SKILL.md)**: Testing, benchmarking, and debugging
- **[Evolution](../evolution/SKILL.md)**: Maturity model and refactoring strategies
- **[API Cheatsheet](../patterns/references/api-cheatsheet.md)**: Quick reference for `create_deep_agent` parameters

### Commands

- `/new-sdk-app` - Scaffold a new DeepAgents project with dependencies and examples
- `/add-interactive-chat` - Generate an interactive chat console for your agent
- `/design-topology` - Interactive guide to design optimal agent topology
- `/validate-agent` - Check agent code for anti-patterns and security issues
