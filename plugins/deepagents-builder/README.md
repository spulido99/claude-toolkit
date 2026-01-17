# DeepAgents Builder

Build production-ready AI agents with LangChain's DeepAgents framework. This plugin provides comprehensive guidance for designing, implementing, testing, and evolving deep agent systems.

## Features

- **5 Specialized Skills**: Progressive guidance from quickstart to advanced architecture
- **3 Interactive Commands**: Scaffolding, topology design, and validation
- **2 Expert Agents**: Architecture design and code review
- **Team Topologies Integration**: Business-aligned agent architectures
- **Security Best Practices**: ToolRuntime, checkpointers, human-in-the-loop

## Installation

```bash
# Add to your Claude Code plugins
claude --plugin-dir /path/to/deepagents-builder
```

## Skills

### quickstart
Getting started with DeepAgents. Basic setup, minimal examples, when to use.
- Triggers: "start deepagent project", "new agent", "quickstart"

### architecture
Design agent topologies using Team Topologies principles.
- Triggers: "design topology", "agent architecture", "bounded context"

### patterns
System prompts, tool design, security, anti-patterns.
- Triggers: "agent prompts", "tool patterns", "anti-patterns", "checkpointer"

### evolution
Maturity model, refactoring strategies, scaling.
- Triggers: "improve agent", "agent maturity", "refactor"

### evals
Testing, benchmarking with Harbor, LangSmith integration.
- Triggers: "evaluate agents", "benchmark", "test agent", "debug"

## Commands

### `/new-sdk-app [name]`
Create a new DeepAgents project with scaffolding, dependencies, and example code.

### `/design-topology [domain]`
Interactive guide to design optimal agent topology based on requirements.

### `/validate-agent [file]`
Analyze agent code for anti-patterns, security issues, and best practices.

## Agents

### agent-architect
Designs deep agent architectures based on requirements. Proactively activated when users need help with architecture decisions.

### code-reviewer
Reviews DeepAgents code for anti-patterns, security vulnerabilities, and best practices compliance.

## Quick Start

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="claude-sonnet-4-5-20250929",
    system_prompt="You are a helpful assistant.",
    tools=[your_tools],
    checkpointer=MemorySaver()
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Hello!"}]
})
```

## Key Concepts

### Cognitive Load Guidelines

| Tools | Architecture |
|-------|-------------|
| < 10 | Single agent |
| 10-30 | Platform subagents |
| > 30 | Domain-specialized |

### Agent Topologies

- **Stream-Aligned**: Main orchestrator
- **Platform**: Reusable capabilities
- **Complicated Subsystem**: Specialized expertise
- **Enabling**: Temporary assistance

### Security Best Practices

```python
from langchain.tools import tool, ToolRuntime

@tool
def secure_tool(runtime: ToolRuntime[Context]) -> str:
    """Use ToolRuntime for sensitive data."""
    user_id = runtime.context.user_id  # Not exposed to LLM
    return fetch_data(user_id)
```

## Resources

- [DeepAgents Documentation](https://docs.langchain.com/oss/python/deepagents/overview)
- [DeepAgents GitHub](https://github.com/langchain-ai/deepagents)
- [LangSmith for Debugging](https://www.blog.langchain.com/debugging-deep-agents-with-langsmith/)
- [Evaluation Guide](https://www.blog.langchain.com/evaluating-deep-agents-our-learnings/)

## Example

See `scripts/create_customer_service_agent.py` for a complete multi-subagent example.

## License

MIT
