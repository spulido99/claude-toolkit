---
name: DeepAgents Evaluation
description: This skill should be used when the user asks to "evaluate agents", "test agent performance", "benchmark agents", "debug agents", "trace agent execution", "use Harbor", "integrate LangSmith", or needs guidance on testing, evaluating, and debugging deep agent systems.
---

# DeepAgents Evaluation & Testing

Evaluate, test, and debug deep agents using Harbor benchmarks and LangSmith observability.

## Evaluation Landscape

Deep agents require specialized evaluation approaches:

| Challenge | Solution |
|-----------|----------|
| Stateful execution | Fresh environment per test |
| Long-running tasks | Sandbox isolation |
| Complex success criteria | Bespoke test logic |
| Non-deterministic outputs | Trajectory logging |

## Harbor Framework

Harbor is DeepAgents' evaluation framework for running agents on challenging benchmarks.

### Key Features

- **Sandbox environments**: Docker, Modal, Daytona, E2B
- **Automatic test execution**: Runs and verifies tests
- **Reward scoring**: 0.0 to 1.0 based on pass rate
- **Trajectory logging**: ATIF format for analysis

### Installation

```bash
pip install harbor
```

### Running Benchmarks

```bash
# Run via Docker (1 task)
uv run harbor run \
  --agent-import-path deepagents_harbor:DeepAgentsWrapper \
  --dataset terminal-bench@2.0 \
  -n 1 \
  --jobs-dir jobs/terminal-bench \
  --env docker

# Run via Daytona (10 tasks)
uv run harbor run \
  --agent-import-path deepagents_harbor:DeepAgentsWrapper \
  --dataset terminal-bench@2.0 \
  -n 10 \
  --jobs-dir jobs/terminal-bench \
  --env daytona
```

### Terminal Bench 2.0

90+ tasks across domains:

| Domain | Example Tasks |
|--------|---------------|
| Software Engineering | git-multibranch, sqlite-with-gcov |
| Security | path-tracing (reverse-engineering) |
| Gaming | chess-best-move |
| Biology | Bioinformatics pipelines |

## LangSmith Integration

LangSmith provides tracing and observability for continuous improvement.

### Improvement Cycle

```
DeepAgents → Harbor → LangSmith → Analyze → Improve → Repeat
```

### Setting Up Tracing

```bash
# Option 1: Experiments (side-by-side comparison)
export LANGSMITH_EXPERIMENT="deepagents-baseline-v1"
make run-terminal-bench-daytona

# Option 2: Development (simpler project view)
export LANGSMITH_PROJECT="deepagents-development"
make run-terminal-bench-daytona
```

### Debugging with langsmith-fetch

```bash
# Install langsmith-fetch CLI
pip install langsmith-fetch

# Fetch traces for analysis
langsmith-fetch --project deepagents-development
```

## Testing Strategies

### 1. Single-Step Evals

Validate decision-making in specific scenarios. Token efficient.

```python
def test_tool_selection():
    """Test agent selects correct tool for task."""
    agent = create_deep_agent(
        model="anthropic:claude-sonnet-4-5-20250929",
        tools=[search, analyze, report],
    )

    result = agent.invoke({
        "messages": [{"role": "user", "content": "Search for AI trends"}]
    }, max_steps=1)

    # Assert correct tool was selected
    assert "search" in result["tool_calls"][0]["name"]
```

### 2. Full Turn Testing

Test assertions about agent's end state.

```python
def test_research_output():
    """Test agent produces complete research report."""
    agent = create_deep_agent(
        model="anthropic:claude-sonnet-4-5-20250929",
        tools=[search, write_file],
    )

    result = agent.invoke({
        "messages": [{"role": "user", "content": "Research and save findings"}]
    })

    # Assert file was created
    assert "/research_report.md" in result.get("files", {})
```

### 3. Multi-Turn Conversations

Simulate realistic user interactions.

```python
def test_multi_turn_interaction():
    """Test multi-turn conversation flow."""
    agent = create_deep_agent()

    # Turn 1: Initial request
    result1 = agent.invoke({
        "messages": [{"role": "user", "content": "Start research on AI"}]
    })

    # Turn 2: Follow-up
    result2 = agent.invoke({
        "messages": result1["messages"] + [
            {"role": "user", "content": "Focus on LLMs specifically"}
        ]
    })

    assert "LLM" in result2["messages"][-1].content
```

### 4. Environment Isolation

Create temp directory for each test.

```python
import tempfile
import os

def test_with_isolation():
    """Run agent in isolated environment."""
    with tempfile.TemporaryDirectory() as tmpdir:
        os.chdir(tmpdir)
        agent = create_deep_agent()
        result = agent.invoke({...})
        # Assert on files created in tmpdir
```

## Metrics to Track

### Performance Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Task Success Rate | % tasks completed correctly | > 80% |
| Token Efficiency | Tokens per successful task | Minimize |
| Latency | Time to complete task | < 60s typical |
| Error Rate | % tasks with errors | < 10% |

### Quality Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Tool Selection Accuracy | Correct tool for task | > 90% |
| Subagent Utilization | Usage of subagents | Balanced |
| Context Overflow | % runs exceeding context | < 5% |
| Escalation Rate | Tasks requiring human | < 15% |

## Mocking Strategies

Avoid costs and instability of live services:

```python
from unittest.mock import patch

def test_with_mocked_api():
    """Test with mocked external API."""
    with patch('tavily.TavilyClient.search') as mock_search:
        mock_search.return_value = {"results": [...]}

        agent = create_deep_agent(tools=[internet_search])
        result = agent.invoke({...})

        mock_search.assert_called_once()
```

## Debugging Workflow

### 1. Enable Tracing

```python
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_PROJECT"] = "my-agent-debug"
```

### 2. Run Agent

```python
result = agent.invoke({"messages": [...]})
```

### 3. Analyze in LangSmith

- View full execution trace
- Identify bottlenecks
- Analyze tool selection
- Review subagent delegations

### 4. Use Polly (AI Assistant)

LangSmith's AI assistant helps:
- Analyze agent behavior
- Identify improvement areas
- Suggest prompt optimizations

## Best Practices

### Testing Checklist

- [ ] Test each tool in isolation
- [ ] Test subagent delegation
- [ ] Test error handling paths
- [ ] Test context overflow scenarios
- [ ] Test multi-turn conversations
- [ ] Mock external services
- [ ] Use environment isolation

### Evaluation Checklist

- [ ] Define success criteria per task type
- [ ] Set up Harbor with appropriate sandbox
- [ ] Enable LangSmith tracing
- [ ] Track key metrics over time
- [ ] A/B test prompt variations
- [ ] Regular benchmark runs

## Additional Resources

### Related Skills

- **[Quickstart](../quickstart/SKILL.md)** - Getting started with DeepAgents
- **[Architecture](../architecture/SKILL.md)** - Agent topologies and bounded contexts
- **[Patterns](../patterns/SKILL.md)** - System prompts, tool design, anti-patterns
- **[Evolution](../evolution/SKILL.md)** - Maturity model and refactoring

### External Resources

- [Evaluating Deep Agents: Our Learnings](https://www.blog.langchain.com/evaluating-deep-agents-our-learnings/)
- [Debugging Deep Agents with LangSmith](https://www.blog.langchain.com/debugging-deep-agents-with-langsmith/)
- [Terminal Bench 2.0 Documentation](https://github.com/langchain-ai/deepagents/tree/master/libs/harbor)
