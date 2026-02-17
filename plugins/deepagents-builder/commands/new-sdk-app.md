---
name: new-sdk-app
description: Create and setup a new DeepAgents application with scaffolding, dependencies, and example code. Guides through project creation interactively.
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
argument-hint: "[project-name]"
---

# New DeepAgents Application

Guide the user through creating a new DeepAgents project with proper structure and dependencies.

## Workflow

### Step 1: Project Information

If project name not provided in arguments, ask the user:

1. **Project Name**: What should we call this project?
2. **Description**: Brief description of what the agent will do

### Step 2: Agent Type Selection

Ask the user to select the type of agent:

1. **Simple Agent** - Single agent with tools, no subagents
2. **Research Agent** - Agent with web search and file management
3. **Customer Service** - Multi-subagent support system
4. **Custom** - Start minimal and build up

### Step 3: Create Project Structure

Create the following directory structure:

```
{project-name}/
├── src/
│   └── {project_name}/
│       ├── __init__.py
│       ├── agent.py
│       ├── tools.py
│       ├── prompts.py
│       └── chat.py
├── tests/
│   └── test_agent.py
├── pyproject.toml
├── README.md
└── .env.example
```

### Step 4: Generate Files

#### pyproject.toml

```toml
[project]
name = "{project-name}"
version = "0.1.0"
description = "{description}"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.3.0",
    "langchain-core>=0.3.0",
    "langchain-anthropic>=0.3.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

#### src/{project_name}/agent.py (based on type)

**Simple Agent:**
```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from .tools import your_tools
from .prompts import SYSTEM_PROMPT

def create_agent():
    return create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        prompt=SYSTEM_PROMPT,
        tools=your_tools,
        checkpointer=MemorySaver()
    )

if __name__ == "__main__":
    agent = create_agent()
    result = agent.invoke({
        "messages": [{"role": "user", "content": "Hello!"}]
    })
    print(result["messages"][-1].content)
```

**Research Agent:**
```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from .tools import internet_search, think_tool
from .prompts import RESEARCH_PROMPT

def create_research_agent():
    researcher = create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        tools=[internet_search],
        prompt="You are an expert researcher. Search thoroughly.",
        name="researcher",
    )

    return create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        tools=[internet_search, think_tool, researcher],
        prompt=RESEARCH_PROMPT,
        checkpointer=MemorySaver(),
    )
```

**Customer Service:**
```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from .tools import kb_search, order_lookup, process_refund
from .prompts import COORDINATOR_PROMPT, INQUIRY_PROMPT, ISSUE_PROMPT

def create_customer_service_agent():
    # Create specialist agents
    inquiry_handler = create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        tools=[kb_search],
        prompt=INQUIRY_PROMPT,
        name="inquiry-handler",
    )

    issue_resolver = create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        tools=[order_lookup, process_refund],
        prompt=ISSUE_PROMPT,
        name="issue-resolver",
    )

    # Parent uses specialists as tools
    return create_react_agent(
        model="anthropic:claude-sonnet-4-20250514",
        tools=[inquiry_handler, issue_resolver],
        prompt=COORDINATOR_PROMPT,
        checkpointer=MemorySaver(),
        interrupt_before=["process_refund"],
    )
```

#### src/{project_name}/tools.py

Generate appropriate tools based on agent type with:
- `@tool` decorator
- Clear docstrings
- Proper type hints
- InjectedState for secure context injection

#### src/{project_name}/prompts.py

Generate system prompts following the prompt patterns:
- Role definition
- Context & vocabulary
- Workflow
- Decision criteria
- Stopping criteria

#### .env.example

```
ANTHROPIC_API_KEY=your-api-key
LANGSMITH_API_KEY=your-langsmith-key
LANGSMITH_PROJECT=your-project-name
```

#### src/{project_name}/chat.py

```python
# src/{project_name}/chat.py
"""Interactive chat console for testing your agent."""
import uuid
from .agent import create_agent  # adjust based on agent type
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

### Step 5: Setup Instructions

After creating files, provide:

```bash
# Navigate to project
cd {project-name}

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Install dependencies
pip install -e ".[dev]"

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Run agent
python -m {project_name}.agent

# Chat with your agent
python -m {project_name}.chat
```

### Step 6: Next Steps

Suggest:
- Use `/design-topology` to refine agent architecture
- Use `/validate-agent` to check for anti-patterns
- Run tests with `pytest`
- Enable LangSmith tracing for debugging
