# Mock Strategies for Agent Evals

Comprehensive reference for mocking external dependencies in eval scenarios, from tool-level mocks to API-client-level mocks for multi-agent systems.

## Strategy 1: Tool-Level Mocks (Default)

The eval runner intercepts tool calls and returns `mock_responses` from the scenario YAML instead of executing the real tool.

### Simple Return

```yaml
mock_responses:
  lookup_order:
    status: "shipped"
    tracking: "1Z999AA10123456784"
```

### Error Response

```yaml
mock_responses:
  lookup_order:
    error: "not_found"
    message: "No order found"
```

### Pending Confirmation Flow

```yaml
mock_responses:
  transfer_funds:
    status: "pending_confirmation"
    details: { from: "ACC-123", to: "ACC-456", amount: 500.00 }
```

### When Tool-Level Mocks Work

- Single-agent architectures
- Agent directly calls tools
- Tool responses are simple JSON

### When Tool-Level Mocks Break

- Supervisor/subagent architectures where the supervisor delegates via an API client
- Tools that call other tools internally
- Tools that use external SDKs (Tavily, Stripe, SendGrid)

## Strategy 2: API-Client-Level Mocks (Multi-Agent)

### The Problem

In supervisor/subagent architectures (DeepAgents, CrewAI, LangGraph), the supervisor doesn't call tools directly. It delegates to subagents via an API client (HTTP, gRPC, LangGraph invoke). Tool-level mocking (`mock_responses` in YAML) doesn't intercept these calls because the mock fires at the wrong layer.

```
Supervisor Agent
  └─ calls api_client.invoke("billing", messages=[...])
       └─ Billing Subagent
            └─ calls process_refund(order_id="1234")

mock_responses: {process_refund: ...}  ← Never fires! The supervisor
                                          never calls process_refund directly.
```

### The Solution: Mock the API Client

Mock the client the supervisor uses to call subagents, not the subagent's tools:

```python
from unittest.mock import patch, MagicMock

def test_supervisor_routes_to_billing(supervisor_agent):
    """Mock the API client the supervisor uses to call billing subagent."""
    mock_client = MagicMock()
    mock_client.invoke.return_value = {
        "messages": [{"role": "assistant", "content": "Refund processed. REF-ABC123"}],
        "tool_calls": [{"name": "process_refund", "args": {"amount": 49.99}}],
    }

    with patch('agents.coordinator.api_client', mock_client):
        result = supervisor_agent.invoke({
            "messages": [{"role": "user", "content": "I want a refund for order #1234"}]
        })

    # Verify supervisor routed to billing
    mock_client.invoke.assert_called_once()
    call_args = mock_client.invoke.call_args
    assert "refund" in str(call_args).lower()
```

### What to Verify

Check which API endpoints/subagents were called, not which tools were called. The supervisor's job is routing, not tool execution.

## Strategy 3: External SDK Mocks

For third-party SDKs (Tavily, Stripe, SendGrid) that aren't in the agent's tool list, mock the SDK client directly:

```python
from unittest.mock import patch

def test_with_mocked_tavily(agent):
    with patch('tavily.TavilyClient.search') as mock_search:
        mock_search.return_value = {"results": [
            {"title": "Result 1", "content": "AI trends 2026"},
        ]}
        result = agent.invoke({
            "messages": [{"role": "user", "content": "Search for AI trends"}]
        })
        mock_search.assert_called_once()
```

## Decision Matrix

| Architecture | Mock Strategy | What to mock | How to verify |
|-------------|---------------|-------------|---------------|
| Single agent | Tool-level (`mock_responses`) | Tool return values in YAML | `expected_tools` in scenario |
| Multi-agent (supervisor) | API-client-level (`unittest.mock.patch`) | The client the supervisor uses to call subagents | Assert which subagent was called |
| Agent + external SDK | SDK-level (`unittest.mock.patch`) | The SDK client (Tavily, Stripe, etc.) | Assert SDK method was called with expected args |
| Integration test | No mocks | Use test accounts / sandbox APIs | Assert actual results |

## Advanced Mock Patterns

### `_raise` Directive for Exception Simulation

Simulate infrastructure failures (not just application errors). The eval runner raises the specified exception instead of returning a response:

```yaml
mock_responses:
  lookup_order:
    _raise: "ConnectionTimeout"
    _message: "Service timed out after 30s"
```

Tests agent error recovery for infrastructure failures like network timeouts, DNS resolution errors, and service outages.

### Per-Turn `mock_responses`

For scenarios where the same tool returns different results on different calls (e.g., polling, retries, state changes):

```yaml
turns:
  - user: "Check my order status"
  - expected_tools: [check_status]
    mock_responses:
      check_status: { status: "processing" }
  - user: "Check again"
  - expected_tools: [check_status]
    mock_responses:
      check_status: { status: "shipped", tracking: "1Z999AA" }
```

Each turn's `mock_responses` overrides the scenario-level defaults for that turn only.

### Smart Route-Aware Mocking

For supervisors that route to different subagents, create mock factories that return subagent-specific responses:

```python
def create_subagent_mocks():
    """Factory that returns different mock responses per subagent."""
    responses = {
        "billing": {"messages": [{"role": "assistant", "content": "Refund processed"}]},
        "shipping": {"messages": [{"role": "assistant", "content": "Package tracked"}]},
        "support": {"messages": [{"role": "assistant", "content": "Ticket created"}]},
    }

    def mock_invoke(subagent_name, *args, **kwargs):
        return responses.get(subagent_name, {
            "messages": [{"role": "assistant", "content": "Unknown subagent"}]
        })

    return mock_invoke
```

Usage in tests:

```python
def test_supervisor_routes_correctly(supervisor_agent):
    mock_invoke = create_subagent_mocks()

    with patch('agents.coordinator.api_client.invoke', side_effect=mock_invoke):
        result = supervisor_agent.invoke({
            "messages": [{"role": "user", "content": "Where is my package?"}]
        })

    # The factory lets you assert routing without caring about tool internals
```
