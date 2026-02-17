---
name: DeepAgents Quickstart
description: This skill should be used when the user asks to "start a deepagent project", "create a new agent", "quickstart agent", "simple agent example", "get started with deepagents", or needs a quick introduction to building agents with LangChain's DeepAgents framework. Provides minimal setup and basic patterns for rapid prototyping.
---

# DeepAgents Quickstart

Build production-ready deep agents with planning, context management, and subagent delegation in minutes.

## What is DeepAgents?

DeepAgents is a set of patterns and skills built on **LangGraph**, LangChain's framework for building agentic applications. The core function is `create_react_agent` from `langgraph.prebuilt`, which implements LangGraph's agent loop — a cycle of reasoning and tool execution that continues until the agent produces a final response.

It provides:

- **ReAct agent loop** — Automatic reasoning + tool calling via `create_react_agent`
- **Tool composition** — Add any LangChain tool or custom function
- **Agent-as-tool** — Nest agents as tools for subagent delegation
- **Checkpointing** — Persist conversation state with `MemorySaver` or database backends

## Installation

```bash
pip install langgraph langchain-core langchain-anthropic
```

## Quick Start

### Minimal Agent

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

### Agent with Custom Tools

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

### Agent with Subagents

Use the "agent as tool" pattern — create a specialist agent, then pass it as a tool to the parent:

```python
from langgraph.prebuilt import create_react_agent

# Create specialist as standalone agent
researcher = create_react_agent(
    model="openai:gpt-4o",
    tools=[search_web],
    prompt="You are an expert researcher. Summarize findings concisely. Keep responses under 500 tokens.",
    name="researcher",
)

# Use specialist as tool in parent agent
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[researcher],  # Agent used as tool
    prompt="You coordinate research projects. Delegate research to the researcher tool.",
)
```

### Agent with Context and Memory

Use `context_schema` to inject structured context and `checkpointer` for conversation persistence:

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

# Invoke with context (invisible to LLM)
result = agent.invoke(
    {"messages": [...]},
    context=ProjectContext(project_name="my-project", preferences={"format": "markdown"}),
)
```

## Tools in LangGraph

LangGraph agents don't include built-in tools — you provide all tools via the `tools=` parameter. Tools can be:

- **`@tool` decorated functions** — Any Python function with a docstring
- **LangChain tools** — From `langchain-community` or other integrations
- **Other agents** — Using the agent-as-tool pattern shown above

This gives you full control over what your agent can and cannot do.

> **Security Tip**: Use `interrupt_before` on dangerous tools to require human confirmation before execution. Use `context_schema` to pass user identity and permissions as structured context, rather than embedding user IDs in tool parameters.

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
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    prompt="""You conduct comprehensive research.
    1. Plan research steps
    2. Search for information
    3. Synthesize into final report""",
    tools=[search_tool],
)
```

### Customer Support Agent

```python
from langgraph.prebuilt import create_react_agent

# Create specialist agents
inquiry_handler = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[knowledge_base_tool],
    prompt="You answer customer questions accurately.",
    name="inquiry-handler",
)

issue_resolver = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[ticketing_tool],
    prompt="You resolve customer problems.",
    name="issue-resolver",
)

order_specialist = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[order_tool],
    prompt="You manage customer orders.",
    name="order-specialist",
)

# Coordinator delegates to specialists
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[inquiry_handler, issue_resolver, order_specialist],
    prompt="You coordinate customer support. Route inquiries to the appropriate specialist.",
)
```

## Model Configuration

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
```

Use `/add-interactive-chat` to generate a chat console tailored to your specific agent.

## Next Steps

After basic setup, explore:

- **[Architecture](../architecture/SKILL.md)**: Design agent topologies and bounded contexts
- **[Patterns](../patterns/SKILL.md)**: System prompts, tool design, anti-patterns
- **[Tool Design](../tool-design/SKILL.md)**: Best practices for designing agent tools
- **[Evals](../evals/SKILL.md)**: Testing, benchmarking, and debugging
- **[Evolution](../evolution/SKILL.md)**: Maturity model and refactoring strategies
- **[API Cheatsheet](../patterns/references/api-cheatsheet.md)**: Quick reference for `create_react_agent` parameters

### Commands

- `/new-sdk-app` - Scaffold a new DeepAgents project with dependencies and examples
- `/add-interactive-chat` - Generate an interactive chat console for your agent
- `/design-topology` - Interactive guide to design optimal agent topology
- `/validate-agent` - Check agent code for anti-patterns and security issues
