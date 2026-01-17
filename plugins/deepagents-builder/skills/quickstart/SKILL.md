---
name: DeepAgents Quickstart
description: This skill should be used when the user asks to "start a deepagent project", "create a new agent", "quickstart agent", "simple agent example", "get started with deepagents", or needs a quick introduction to building agents with LangChain's DeepAgents framework. Provides minimal setup and basic patterns for rapid prototyping.
---

# DeepAgents Quickstart

Build production-ready deep agents with planning, context management, and subagent delegation in minutes.

## What is DeepAgents?

DeepAgents is a Python library from LangChain that implements patterns from Claude Code, Deep Research, and Manus. It provides:

- **Planning tools** (`write_todos`) - Break complex tasks into steps
- **File system** - Manage context with `read_file`, `write_file`, `edit_file`
- **Subagents** - Delegate tasks with isolated context
- **Auto-summarization** - Handle conversations exceeding 170K tokens

## Installation

```bash
pip install deepagents
```

## Quick Start

### Minimal Agent

```python
from deepagents import create_deep_agent

# Default model is claude-sonnet-4-5-20250929
agent = create_deep_agent()

result = agent.invoke({
    "messages": [{"role": "user", "content": "Research AI trends"}]
})

# Access response
print(result["messages"][-1].content)
```

### Agent with Custom Tools

```python
from deepagents import create_deep_agent
from langchain_core.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

agent = create_deep_agent(
    model="claude-sonnet-4-5-20250929",  # or "anthropic:claude-sonnet-4-20250514"
    tools=[search_web],
    system_prompt="You are a research assistant."
)
```

### Agent with Subagents

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="claude-sonnet-4-5-20250929",
    system_prompt="You coordinate research projects.",
    subagents=[
        {
            "name": "researcher",
            "description": "Conducts in-depth research on topics",
            "system_prompt": "You are an expert researcher.",
            "tools": [search_web],
            "model": "openai:gpt-4o"  # Optional: different model per subagent
        }
    ]
)
```

## Built-in Tools (Automatic)

Every agent automatically includes:

| Tool | Purpose |
|------|---------|
| `write_todos` | Create task lists |
| `read_todos` | View current tasks |
| `ls` | List directory contents |
| `read_file` | Read file content |
| `write_file` | Create/overwrite files |
| `edit_file` | Exact string replacements |
| `glob` | Find files by pattern |
| `grep` | Search text in files |
| `task` | Delegate to subagents |

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

## Cognitive Load Guidelines

Choose architecture based on tool count:

| Tools | Architecture |
|-------|-------------|
| < 10 | Single agent, no subagents |
| 10-30 | Platform subagents (group by capability) |
| > 30 | Domain-specialized subagents |

## Common Patterns

### Research Agent

```python
agent = create_deep_agent(
    system_prompt="""You conduct comprehensive research.
    1. Plan research steps with write_todos
    2. Search for information
    3. Save findings to files
    4. Synthesize into final report""",
    tools=[search_tool]
)
```

### Customer Support Agent

```python
agent = create_deep_agent(
    system_prompt="You coordinate customer support.",
    subagents=[
        {"name": "inquiry-handler", "description": "Answers questions"},
        {"name": "issue-resolver", "description": "Resolves problems"},
        {"name": "order-specialist", "description": "Manages orders"}
    ]
)
```

## Model Configuration

```python
from langchain.chat_models import init_chat_model

# Claude (default)
model = init_chat_model("anthropic:claude-sonnet-4-20250514")

# OpenAI
model = init_chat_model("openai:gpt-4-turbo")

# Google
from langchain_google_genai import ChatGoogleGenerativeAI
model = ChatGoogleGenerativeAI(model="gemini-3-pro")

agent = create_deep_agent(model=model)
```

## Next Steps

After basic setup, explore:

- **Architecture skill**: Design agent topologies and bounded contexts
- **Patterns skill**: System prompts, tool design, anti-patterns
- **Evolution skill**: Maturity model and refactoring strategies

Use `/design-topology` command for guided architecture design.
