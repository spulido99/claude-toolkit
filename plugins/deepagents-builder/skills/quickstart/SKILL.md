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

# Default model is anthropic:claude-sonnet-4-20250514
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
    model="anthropic:claude-sonnet-4-20250514",
    tools=[search_web],
    system_prompt="You are a research assistant."
)
```

### Agent with Subagents

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-20250514",
    system_prompt="You coordinate research projects.",
    subagents=[
        {
            "name": "researcher",
            "description": "Conducts in-depth research on topics",
            "system_prompt": "You are an expert researcher. Summarize findings concisely. Keep responses under 500 tokens.",
            "tools": [search_web],
            "model": "openai:gpt-4o"  # Optional: different model per subagent
        }
    ]
)
```

### Agent with AGENTS.md Memory (File-First)

Use `AGENTS.md` files for persistent context that gets injected into the system prompt:

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    backend=FilesystemBackend(root_dir="./"),  # Scope to project directory
    memory=[
        "~/.deepagents/AGENTS.md",      # Global preferences
        "./.deepagents/AGENTS.md",      # Project-specific context
    ],
    system_prompt="You are a project assistant."  # Minimal role definition
)
```

> **Security Warning**: Never use `root_dir="/"` — it grants the agent read/write access to your entire filesystem. Always scope to the project directory or a dedicated workspace.

Create `.deepagents/AGENTS.md` in your project:

```markdown
# Project Context

## Role
Research assistant for market analysis.

## Preferences
- Output format: Markdown tables
- Always cite sources
- Tone: Professional, concise

## Resources
- /data/reports/ - Historical reports
- /config/sources.json - Data sources
```

**For internal/trusted agents only:** The agent can update `AGENTS.md` using `edit_file` when learning new preferences. By default, treat `AGENTS.md` as read-only.

> **Security Note**: Writable `AGENTS.md` is appropriate for internal/trusted agents only. For customer-facing agents, see [Security for Customer-Facing Agents](../patterns/SKILL.md#security-for-customer-facing-agents) to prevent Persistent Prompt Injection attacks.

## Built-in Tools (Automatic)

Every agent automatically includes:

| Tool | Purpose |
|------|---------|
| `write_todos` | Create structured task lists |
| `read_todos` | View current tasks |
| `ls` | List directory contents |
| `read_file` | Read file content |
| `write_file` | Create/overwrite files |
| `edit_file` | Exact string replacements |
| `glob` | Find files by pattern |
| `grep` | Search text in files |
| `execute` | Run commands in sandbox |
| `shell` | Run local shell commands |
| `web_search` | Search the web |
| `fetch_url` | Fetch URL content |
| `task` | Delegate to subagents |

> **Security Warning**: The `shell` and `execute` tools grant direct system access. Disable or restrict them for customer-facing agents. See [Shell Security](../patterns/references/tool-patterns.md#shell-execute-tool-security) for mitigation strategies.

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

- **[Architecture](../architecture/SKILL.md)**: Design agent topologies and bounded contexts
- **[Patterns](../patterns/SKILL.md)**: System prompts, tool design, anti-patterns
- **[Evals](../evals/SKILL.md)**: Testing, benchmarking, and debugging
- **[Evolution](../evolution/SKILL.md)**: Maturity model and refactoring strategies

### Commands

- `/new-sdk-app` - Scaffold a new DeepAgents project with dependencies and examples
- `/design-topology` - Interactive guide to design optimal agent topology
- `/validate-agent` - Check agent code for anti-patterns and security issues
