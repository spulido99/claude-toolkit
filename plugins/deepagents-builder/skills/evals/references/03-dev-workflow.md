# Developer Workflow & Operations

Detailed reference for the day-to-day EDD workflow: snapshot testing, smoke runs, failure investigation, cost management, and production trace mining.

## Snapshot Testing Setup

### Directory Structure

```
evals/
  __snapshots__/
    track_order_happy_path.json
    refund_happy_path.json
    upgrade_plan_happy_path.json
    ...
  datasets/
    support-agent.yaml
  .results/
    latest.json
    history/
      2026-02-19T10-30.json
      2026-02-18T14-22.json
  conftest.py
  eval-config.yaml
```

### Snapshot JSON Format

Each scenario generates a snapshot file at `evals/__snapshots__/{scenario_name}.json`:

```json
{
  "scenario": "track_order_happy_path",
  "recorded_at": "2026-02-19T10:30:00Z",
  "agent_hash": "a1b2c3d4",
  "compare_mode": "structural",
  "trajectory": [
    {"role": "user", "content": "Where is my order #1234?"},
    {"role": "assistant", "tool_calls": [{"name": "lookup_order", "args": {"order_id": "1234"}}]},
    {"role": "tool", "name": "lookup_order", "content": "{\"status\": \"shipped\", \"tracking\": \"1Z999AA\"}"},
    {"role": "assistant", "content": "Your order #1234 has been shipped. Tracking: 1Z999AA."}
  ],
  "metrics": {
    "turns": 2,
    "tool_calls": 1,
    "total_tokens": 1847
  }
}
```

**`agent_hash`**: Hash of the agent's system prompt + tool names. When it changes (prompt edit, tool added/removed), all snapshots are marked stale. `/eval-status` reports staleness.

### Three Comparison Modes

Configured in `evals/eval-config.yaml`:

```yaml
snapshot:
  compare_mode: structural   # structural | strict | semantic
  ignore_fields:
    - tool_call_id            # Always random
    - timestamps              # Always different
    - message_id              # Internal IDs
```

**Structural (default)**: Compares tool call names, argument keys, and turn count. Ignores exact argument values and response wording. Best for most scenarios — catches regressions without over-fitting to non-deterministic output.

**Strict**: Compares full tool calls including argument values and response structure. Use for well-defined workflows where exact behavior matters (financial operations, compliance flows).

**Semantic**: Compares only tool call names and success criteria. Ignores turn count and argument structure. Use for exploratory agents where the path varies but the outcome should be stable.

### `eval-config.yaml` Full Example

```yaml
snapshot:
  compare_mode: structural
  ignore_fields:
    - tool_call_id
    - timestamps
    - message_id

smoke:
  model: "openai:gpt-4.1-mini"
  timeout_seconds: 30

full:
  judge_model: "openai:o3-mini"
  simulated_user_model: "openai:gpt-4.1-mini"
  max_concurrent: 5
  timeout_seconds: 120

results:
  keep_history: 20           # Number of historical runs to keep
  directory: ".results"
```

## Smoke Testing

### Tagging Scenarios

Tag 5-10 critical scenarios as `@smoke`:

```yaml
- name: track_order_happy_path
  tags: [smoke, e2e]
  # ...

- name: refund_happy_path
  tags: [smoke, e2e]
  # ...
```

### Running Smoke Tests

```bash
# Run only smoke-tagged scenarios
pytest evals/ -m smoke

# With verbose output
pytest evals/ -m smoke -v

# With cheap model judge
pytest evals/ -m smoke --model openai:gpt-4.1-mini
```

Smoke tests should complete in under 2 minutes for 10 scenarios. Run after every agent change.

## Full Eval Review

### Manual Gate Process

Full eval review is a manual gate before merging. It runs the entire dataset with Tier 2 simulated users and a strong LLM judge.

```bash
# Run full evaluation
pytest evals/ --full --judge-model openai:o3-mini

# Compare against baseline
pytest evals/ --full --compare baseline-v1.2
```

### Cached Baselines

To avoid re-evaluating unchanged scenarios:

1. Compute `agent_hash` for current agent state
2. Compare against hash stored in each snapshot
3. Skip scenarios where hash matches (agent didn't change)
4. Only re-evaluate scenarios with stale snapshots

This optimization is significant for large datasets (50+ scenarios) where full eval can cost $10-15.

### Experiment Comparison

Use LangSmith experiments for side-by-side comparison of agent versions:

```bash
# Run two experiments
LANGSMITH_EXPERIMENT="v1.2-baseline" pytest evals/ --full
LANGSMITH_EXPERIMENT="v1.3-new-prompt" pytest evals/ --full

# Compare in LangSmith dashboard
```

Cross-ref: [Evolution — Level 5](../../evolution/SKILL.md) for A/B testing prompts.

## Failure Investigation UX

Three progressive levels of failure analysis.

### Level 1: Pass/Fail (Always Shown)

```
✓ 11 passed | ✗ 1 failed | ~ 2 changed

FAILED: refund_after_shipping
  Expected tools: [lookup_order, check_refund_policy, process_refund]
  Actual tools:   [lookup_order, escalate_to_human]
  → /eval --report for diff | /eval --diagnose for analysis
```

### Level 2: Diff Report (`/eval --report`)

```
═══ refund_after_shipping ═══

Turn 1: ✓ User message matched
Turn 2: ✓ lookup_order called correctly
Turn 3: ✗ DIVERGED
  Expected: check_refund_policy(order_id="1234")
  Actual:   escalate_to_human(reason="refund amount exceeds threshold")

  Tool call diff:
  - check_refund_policy  ← expected
  + escalate_to_human    ← actual

Turn 4: ✗ MISSING
  Expected: process_refund(order_id="1234", amount=49.99)
  Actual:   (no more tool calls)
```

### Level 3: LLM Diagnostic (`/eval --diagnose`)

```
═══ Diagnosis: refund_after_shipping ═══

Root cause: The agent's system prompt has a refund threshold of $50.
The test scenario has a refund amount of $49.99, which is under the
threshold, but the agent escalated anyway.

Possible causes:
1. The threshold comparison uses ">=" instead of ">" (off-by-one)
2. The agent is using a stale cached value for the threshold

Suggested fixes:
1. Check the system prompt for the refund threshold logic
2. Update the comparison: amount > threshold (not >=)
3. If threshold changed intentionally, update the scenario's
   expected_tools to include escalate_to_human
```

## Eval Results Persistence

### `evals/.results/latest.json`

```json
{
  "run_at": "2026-02-19T10:30:00Z",
  "duration_seconds": 45,
  "mode": "snapshot",
  "agent_hash": "a1b2c3d4",
  "total": 47,
  "passed": 45,
  "failed": 1,
  "changed": 1,
  "failures": [
    {
      "scenario": "refund_after_shipping",
      "reason": "unexpected tool: escalate_to_human",
      "expected_tools": ["check_refund_policy", "process_refund"],
      "actual_tools": ["escalate_to_human"]
    }
  ],
  "changes": [
    {
      "scenario": "track_order_happy_path",
      "diff": "turn 3: added verify_address tool call"
    }
  ],
  "by_tag": {
    "smoke": { "total": 12, "passed": 12 },
    "e2e": { "total": 23, "passed": 22 },
    "edge_case": { "total": 8, "passed": 7 },
    "multi_agent": { "total": 4, "passed": 4 }
  }
}
```

### History Directory

Historical runs are saved to `evals/.results/history/` with timestamp-based filenames. Keep the last 20 runs (configurable in `eval-config.yaml`).

### Gitignore Convention

Add to `.gitignore`:

```
evals/.results/
```

Results are machine-specific and should not be committed. Snapshots (`evals/__snapshots__/`) **are** committed — they're the source of truth.

## Cost Management

### Model Selection by Context

| Context | Simulated User | Judge | Cost/scenario |
|---------|---------------|-------|---------------|
| Snapshot (Tier 1) | N/A (scripted) | N/A (diff) | $0 |
| Smoke | N/A (scripted) | `gpt-4.1-mini` | ~$0.01 |
| Full | `gpt-4.1-mini` | `o3-mini` | ~$0.15-0.30 |

### Cost Reduction Strategies

1. **Tag aggressively**: Use `@smoke` to keep the quick-check set small (5-10 scenarios)
2. **Cache baselines**: Skip scenarios where `agent_hash` hasn't changed
3. **Tier 1 first**: Only run Tier 2 when Tier 1 passes
4. **Selective full runs**: Only run `--full` on scenarios affected by the change
5. **Model budget**: Use `gpt-4.1-mini` for both simulated user and judge during development; upgrade judge to `o3-mini` only for pre-merge

## Agent Discovery

### `conftest.py` Convention — Single Agent

```python
# evals/conftest.py
import pytest
from agent import create_agent

@pytest.fixture
def agent():
    """Create a fresh agent instance per test."""
    return create_agent()
```

### `conftest.py` Convention — Multi-Agent

```python
# evals/conftest.py (top-level, for E2E tests)
import pytest
from agents.coordinator.agent import create_agent as create_coordinator
from agents.billing.agent import create_agent as create_billing
from agents.shipping.agent import create_agent as create_shipping

@pytest.fixture
def coordinator():
    return create_coordinator()

@pytest.fixture
def billing_agent():
    return create_billing()

@pytest.fixture
def shipping_agent():
    return create_shipping()

@pytest.fixture(params=["coordinator", "billing", "shipping"])
def any_agent(request):
    """Parameterized fixture for running shared scenarios across agents."""
    factories = {
        "coordinator": create_coordinator,
        "billing": create_billing,
        "shipping": create_shipping,
    }
    return factories[request.param]()
```

### Auto-Detection by `/design-evals`

The command detects agent entry points by searching for:

1. `create_agent()` in `agent.py`, `main.py`, `src/agent.py`
2. `create_deep_agent()` in the same locations
3. `agents/*/agent.py` for multi-agent projects

If not found, it asks the user for the module path and generates `conftest.py` accordingly.

## Multi-Agent Directory Layout

### Convention A: Single Agent (Default)

```
project/
  agent.py                   # Exposes create_agent()
  evals/
    datasets/
      main.yaml              # All scenarios
    __snapshots__/
    conftest.py              # Single agent fixture
    eval-config.yaml
    .results/
```

### Convention B: Multi-Agent Project

```
project/
  agents/
    coordinator/
      agent.py               # Exposes create_agent()
      evals/                  # Coordinator-level tests (routing)
        datasets/
          routing.yaml
        __snapshots__/
        conftest.py           # Coordinator fixture
    billing/
      agent.py
      evals/                  # Billing-specific tests
        datasets/
          billing.yaml
        __snapshots__/
        conftest.py           # Billing fixture
    shipping/
      agent.py
      evals/
        datasets/
          shipping.yaml
        __snapshots__/
        conftest.py
  evals/                      # E2E integration tests
    datasets/
      e2e.yaml
    __snapshots__/
    conftest.py               # All agent fixtures
    eval-config.yaml
    .results/
```

Each bounded context ([Architecture](../../architecture/SKILL.md)) gets its own `evals/` directory. The top-level `evals/` tests the system as a whole — coordinator routing + subagent execution.

`/design-evals` detects the project structure and scaffolds the appropriate convention.

## Dataset Drift

### When to Re-record Snapshots

Re-record when:
- System prompt changed
- Tool added, removed, or renamed
- Tool behavior changed (different response format)
- Subagent added or restructured
- `agent_hash` differs from snapshot hash

### Review Changed Snapshots Workflow

1. Run `/eval` — changed scenarios show as `~ changed`
2. Run `/eval-update` to review each change interactively
3. For each changed snapshot:
   - View the diff (old vs new trajectory)
   - **Accept**: Update snapshot to new trajectory (intentional change)
   - **Reject**: Keep old snapshot (scenario stays FAILED until agent is fixed)

## Production Trace Mining

### Trace Middleware Setup

Enable local trace saving for production conversations:

```python
import json
import os

def trace_middleware(state, config):
    """Save traces to local files for eval mining."""
    trace_dir = "traces/"
    os.makedirs(trace_dir, exist_ok=True)
    thread_id = config.get("configurable", {}).get("thread_id", "unknown")
    with open(f"{trace_dir}/{thread_id}.json", "w") as f:
        json.dump(state["messages"], f, default=str)
    return state
```

### Local Trace Format

Local traces use the same message format as snapshots:

```json
[
  {"role": "user", "content": "Where is my order #1234?"},
  {"role": "assistant", "tool_calls": [{"name": "lookup_order", "args": {"order_id": "1234"}}]},
  {"role": "tool", "name": "lookup_order", "content": "{...}"},
  {"role": "assistant", "content": "Your order has been shipped..."}
]
```

### `/add-scenario --from-trace` Workflow

**From local trace file:**

```
/add-scenario --from-trace ./traces/conv_abc123.json
```

1. Load the trace file
2. Display the conversation
3. Ask: "What should the expected behavior be?"
4. Convert to scenario YAML with `expected_tools`, `mock_responses`, and `success_criteria`
5. Append to existing dataset file

**From LangSmith (if configured):**

```
/add-scenario --from-trace langsmith:run_id_abc123
```

1. Fetch trace via LangSmith SDK (`LANGSMITH_API_KEY` required)
2. Same conversion workflow as local traces

## Mocking Strategies

### External Service Mocks

Use `unittest.mock.patch` for services not covered by `mock_responses` in scenario YAML:

```python
from unittest.mock import patch

def test_with_mocked_api(agent):
    """Test with mocked external API."""
    with patch('tavily.TavilyClient.search') as mock_search:
        mock_search.return_value = {"results": [
            {"title": "Result 1", "content": "..."},
        ]}

        result = agent.invoke({
            "messages": [{"role": "user", "content": "Search for AI trends"}]
        })

        mock_search.assert_called_once()
```

### When to Use Each Mocking Strategy

| Strategy | When to use |
|----------|-------------|
| `mock_responses` in YAML | Default. For tools defined in the agent. |
| `unittest.mock.patch` | For external SDKs/APIs not in the agent's tool list. |
| Real services | Only for integration tests with dedicated test accounts. |

## Debugging with LangSmith

### Tracing Setup

```python
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_PROJECT"] = "my-agent-debug"
```

### Analysis Tips

1. **View full execution trace** — See every tool call, response, and decision
2. **Identify bottlenecks** — Find slow tool calls or excessive retries
3. **Analyze tool selection** — See which tools the agent considered
4. **Review subagent delegations** — Trace the routing decisions

### Experiments for A/B Testing

Cross-ref: [Evolution — Level 5](../../evolution/SKILL.md)

```python
# Compare two prompt versions
os.environ["LANGSMITH_EXPERIMENT"] = "prompt-v1"
# Run eval suite...

os.environ["LANGSMITH_EXPERIMENT"] = "prompt-v2"
# Run same eval suite...

# Compare in LangSmith dashboard: side-by-side metrics
```

## Refactoring Regression Workflow

Cross-ref: [Evolution — Refactoring Patterns](../../evolution/SKILL.md)

Before and after any refactoring (Extract Subagent, Split Agent, Merge Agent):

1. **Before**: Run `/eval` and capture baseline results
2. **Refactor**: Apply the change
3. **After**: Run `/eval` again
4. **Compare**: If pass rate drops, the refactoring broke something
5. **Investigate**: Use `/eval --report` or `/eval --diagnose` on failures
6. **Fix or revert**: Address the regression before merging

```bash
# Step 1: Baseline
pytest evals/ --full > baseline_results.txt

# Step 2: Refactor...

# Step 3: Post-refactor
pytest evals/ --full > refactored_results.txt

# Step 4: Compare
diff baseline_results.txt refactored_results.txt
```

Evals are the regression gate for refactoring. If the eval suite is comprehensive, you can refactor with confidence.
