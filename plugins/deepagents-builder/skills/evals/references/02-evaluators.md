# Evaluator Catalog & Scoring

Complete reference for all evaluator types, when to use each, and how to compose them.

## Trajectory Match Evaluators

Deterministic comparison of expected vs actual tool call sequences. Free, fast, no LLM needed.

### Strict Mode

Exact sequence match. The agent must call the same tools in the same order.

```python
from agentevals.trajectory import check_trajectory

result = check_trajectory(
    expected=["lookup_order", "check_refund_policy", "process_refund"],
    actual=actual_tool_calls,
    mode="strict",
)
assert result.passed, f"Expected exact sequence, got: {actual_tool_calls}"
```

**When to use**: Well-defined workflows where tool order matters (e.g., must check policy before processing refund).

### Unordered Mode

All expected tools must be called, but order doesn't matter.

```python
result = check_trajectory(
    expected=["search_products", "check_inventory", "get_pricing"],
    actual=actual_tool_calls,
    mode="unordered",
)
```

**When to use**: Parallel information gathering where the agent may fetch data in any order.

### Subsequence Mode

Expected tools must appear as a subsequence within the actual trajectory. The agent may call additional tools.

```python
result = check_trajectory(
    expected=["lookup_order", "process_refund"],
    actual=["lookup_order", "check_refund_policy", "process_refund", "send_email"],
    mode="subsequence",
)
# Passes — lookup_order and process_refund appear in order within actual
```

**When to use**: Agents that add optional steps (logging, verification) that vary between runs.

## LLM-as-Judge Evaluators

For nuanced evaluation where deterministic checks aren't enough.

### Standard Trajectory Accuracy

```python
from agentevals.trajectory import create_trajectory_llm_as_judge
from agentevals.trajectory import TRAJECTORY_ACCURACY_PROMPT

evaluator = create_trajectory_llm_as_judge(
    prompt=TRAJECTORY_ACCURACY_PROMPT,
    model="openai:o3-mini",
)

score = evaluator(
    expected=reference_trajectory,
    actual=actual_trajectory,
)
# score.score: float 0.0-1.0
# score.reasoning: str explanation
```

### Custom Domain Prompts

Write prompts specific to your domain:

```python
SUPPORT_EVAL_PROMPT = """
You are evaluating a customer support agent. Score the trajectory on:
1. Did the agent resolve the customer's issue?
2. Did the agent ask for approval before sensitive operations?
3. Was the response empathetic and professional?
4. Did the agent avoid unnecessary tool calls?

Score 1.0 if all criteria met, 0.5 for partial, 0.0 for failure.
Explain your reasoning.
"""

evaluator = create_trajectory_llm_as_judge(
    prompt=SUPPORT_EVAL_PROMPT,
    model="openai:o3-mini",
)
```

### Model Selection

| Context | Model | Cost | Quality |
|---------|-------|------|---------|
| Dev inner loop | `gpt-4.1-mini` | $ | Good enough for iteration |
| Pre-merge gate | `o3-mini` | $$ | High quality judgments |
| Complex reasoning | `o3-mini` | $$ | Best for nuanced evaluation |

Don't use the same strong model for both simulated users and judge — it doubles cost with marginal benefit.

## Custom Code Evaluators

Programmatic assertions for domain-specific checks.

### Turn Count

```python
def eval_max_turns(result, scenario):
    """Agent must complete within turn budget."""
    max_turns = scenario.get("success_criteria", {}).get("max_turns", 10)
    if isinstance(scenario.get("success_criteria"), list):
        for c in scenario["success_criteria"]:
            if isinstance(c, dict) and "max_turns" in c:
                max_turns = c["max_turns"]
    assistant_turns = len([m for m in result["messages"] if m["role"] == "assistant"])
    return assistant_turns <= max_turns
```

### Token Efficiency

```python
def eval_token_efficiency(result, max_tokens=5000):
    """Agent must stay within token budget."""
    total_tokens = result.get("metrics", {}).get("total_tokens", 0)
    return total_tokens <= max_tokens
```

### Content Assertions

```python
def eval_response_contains(result, scenario):
    """Final response must contain expected phrases."""
    for criteria in scenario.get("success_criteria", []):
        if isinstance(criteria, dict) and "response_contains" in criteria:
            final_response = result["messages"][-1]["content"].lower()
            for phrase in criteria["response_contains"]:
                if phrase.lower() not in final_response:
                    return False
    return True
```

### Escalation Correctness

```python
def eval_escalation(result, scenario):
    """Agent escalated when it should (and didn't when it shouldn't)."""
    tool_calls = [tc["name"] for tc in result.get("all_tool_calls", [])]
    should_escalate = scenario.get("should_escalate", False)

    if should_escalate:
        return "escalate_to_human" in tool_calls
    else:
        return "escalate_to_human" not in tool_calls
```

### `signal_task_complete` Check

Cross-ref: [Patterns — signal_task_complete](../../patterns/SKILL.md)

```python
def eval_signal_task_complete(result):
    """Agent must explicitly signal completion."""
    tool_calls = [tc["name"] for tc in result.get("all_tool_calls", [])]
    return "signal_task_complete" in tool_calls
```

This makes Full Turn assertions unambiguous — assert the tool was called instead of heuristic "done" detection.

## Operation Level Evaluators

Cross-ref: [Tool Design — Operation Levels](../../tool-design/SKILL.md) (Principle 8)

### Level 1-2: Simple Tool Call Assertions

Read and create operations — just verify the right tool was called.

```python
def eval_level_1_2(result, scenario):
    """Verify correct tool selection for read/create operations."""
    expected = scenario.get("expected_tools", [])
    actual = [tc["name"] for tc in result.get("tool_calls", [])]
    return all(e in actual for e in expected)
```

### Level 3-4: `pending_confirmation` Flow

Cross-ref: [Tool Design — Delegated Confirmations](../../tool-design/SKILL.md) (Principle 9)

Test the full confirmation flow: invoke → `pending_confirmation` → confirm → completed.

```python
def eval_pending_confirmation_flow(result, scenario):
    """Test that Level 3-4 tools go through confirmation."""
    tool_calls = result.get("all_tool_calls", [])

    # Find the sensitive tool call
    sensitive_tool = scenario.get("sensitive_tool")
    if not sensitive_tool:
        return True

    # Check: tool returned pending_confirmation
    for tc in tool_calls:
        if tc["name"] == sensitive_tool:
            response = tc.get("result", {})
            if response.get("status") != "pending_confirmation":
                return False  # Should have returned pending, not executed directly

    # Check: confirmation tool was called after approval
    confirm_tool = f"confirm_{sensitive_tool}"
    tool_names = [tc["name"] for tc in tool_calls]
    if confirm_tool in tool_names:
        # Verify order: sensitive_tool before confirm_tool
        sensitive_idx = tool_names.index(sensitive_tool)
        confirm_idx = tool_names.index(confirm_tool)
        return confirm_idx > sensitive_idx

    return False
```

### Level 5: `interrupt_on` Rejection Handling

Test that the agent handles rejection gracefully when a human rejects a sensitive operation.

```python
def eval_interrupt_rejection(result, scenario):
    """Agent handles rejection without executing the operation."""
    if scenario.get("approval") != "reject":
        return True

    # After rejection, the sensitive tool should NOT appear again
    sensitive_tool = scenario.get("sensitive_tool")
    tool_calls_after_rejection = result.get("tool_calls_after_approval", [])
    return sensitive_tool not in [tc["name"] for tc in tool_calls_after_rejection]
```

## Idempotency Evaluator

Cross-ref: [Tool Design — Idempotency Keys](../../tool-design/SKILL.md) (Principle 10)

```python
def eval_idempotency(agent, scenario):
    """Retry with same idempotency key → same result, no re-execution."""
    # First call
    result1 = agent.invoke({"messages": scenario["turns"]})
    key = result1.get("idempotency_key")

    # Second call with same key
    result2 = agent.invoke({
        "messages": scenario["turns"],
        "idempotency_key": key,
    })

    # Should return same result without re-executing
    assert result2.get("status") == "already_processed"
    assert result2.get("data") == result1.get("data")
```

## Error Response Evaluator

Cross-ref: [Tool Design — Error Responses](../../tool-design/SKILL.md) (Principle 4)

```python
def eval_error_suggestions(result, scenario):
    """When a tool fails, response contains correct remediation suggestions."""
    tool_calls = result.get("all_tool_calls", [])

    for tc in tool_calls:
        response = tc.get("result", {})
        if response.get("error"):
            # Error response must have suggestions
            suggestions = response.get("suggestions", [])
            if not suggestions:
                return False

            # Agent should mention suggestions in its response
            final_response = result["messages"][-1]["content"].lower()
            mentioned = any(s.lower() in final_response for s in suggestions)
            if not mentioned:
                return False

    return True
```

## Tool Graph Evaluator

Cross-ref: [Tool Design — Available Actions](../../tool-design/SKILL.md) (Principle 7)

```python
def eval_tool_graph(result, scenario):
    """After each tool call, available_actions matches expected next tools."""
    expected_graph = scenario.get("expected_tool_graph", {})

    for tc in result.get("all_tool_calls", []):
        tool_name = tc["name"]
        response = tc.get("result", {})
        available = [a["tool"] for a in response.get("available_actions", [])]

        if tool_name in expected_graph:
            expected_next = expected_graph[tool_name]
            for expected in expected_next:
                if expected not in available:
                    return False

    return True
```

## Routing Evaluator (Multi-Agent)

For systems with 3+ subagents, verify the coordinator routes correctly.

```python
def eval_routing_accuracy(results, scenarios):
    """Measure routing accuracy across all scenarios."""
    correct = 0
    total = 0

    for result, scenario in zip(results, scenarios):
        expected_subagent = scenario.get("expected_subagent")
        if not expected_subagent:
            continue

        total += 1
        delegations = [
            tc for tc in result.get("tool_calls", [])
            if tc["name"].startswith("delegate_to_")
        ]

        if any(expected_subagent in d["name"] for d in delegations):
            correct += 1

    accuracy = correct / total if total > 0 else 1.0
    return accuracy

# Assert: routing accuracy > 90%
assert eval_routing_accuracy(results, scenarios) > 0.90
```

## Hierarchical Evaluation Pattern

For multi-agent systems, evaluate at two levels.

### Coordinator Evaluation

Tests routing and delegation decisions:

```python
def test_coordinator_routing(coordinator_agent, routing_scenarios):
    """Test coordinator routes to correct subagents."""
    for scenario in routing_scenarios:
        result = coordinator_agent.invoke({
            "messages": [{"role": "user", "content": scenario["input"]}]
        })

        delegations = [tc["name"] for tc in result.get("tool_calls", [])]
        expected = scenario["expected_subagent"]
        assert any(expected in d for d in delegations), (
            f"Expected delegation to {expected}, got {delegations}"
        )
```

### Per-Subagent Evaluation

Tests each subagent in isolation using its own `evals/`:

```python
def test_billing_subagent(billing_agent, billing_scenarios):
    """Test billing subagent handles billing-specific scenarios."""
    for scenario in billing_scenarios:
        result = billing_agent.invoke({
            "messages": [{"role": "user", "content": scenario["turns"][0]["user"]}]
        })
        # Apply billing-specific evaluators
        assert eval_response_contains(result, scenario)
        assert eval_signal_task_complete(result)
```

### Combined Hierarchical Eval

```python
def test_e2e_with_hierarchy(coordinator, scenarios):
    """Full system test: coordinator + subagents."""
    for scenario in scenarios:
        # Step 1: Coordinator routes
        result = coordinator.invoke({"messages": scenario["messages"]})
        assert eval_routing(result, scenario), "Routing failed"

        # Step 2: Check subagent execution
        subagent_result = result.get("subagent_result", {})
        assert eval_response_contains(subagent_result, scenario), "Subagent failed"
        assert eval_max_turns(subagent_result, scenario), "Too many turns"
```

## Decision Tree: Which Evaluator Should I Use?

```
Start
  │
  ├── Do you know the exact tool sequence?
  │   ├── Yes, exact order matters → Trajectory Match (strict)
  │   ├── Yes, but order doesn't matter → Trajectory Match (unordered)
  │   └── Partially, agent may add extra tools → Trajectory Match (subsequence)
  │
  ├── Is the evaluation nuanced / subjective?
  │   ├── Yes → LLM-as-Judge
  │   │   ├── General trajectory quality → TRAJECTORY_ACCURACY_PROMPT
  │   │   └── Domain-specific quality → Custom prompt
  │   └── No → Custom Code Evaluator
  │
  ├── What specific property are you testing?
  │   ├── Turn count → eval_max_turns
  │   ├── Token usage → eval_token_efficiency
  │   ├── Response content → eval_response_contains
  │   ├── Escalation logic → eval_escalation
  │   ├── Task completion signal → eval_signal_task_complete
  │   ├── Confirmation flow → eval_pending_confirmation_flow
  │   ├── Rejection handling → eval_interrupt_rejection
  │   ├── Retry safety → eval_idempotency
  │   ├── Error remediation → eval_error_suggestions
  │   └── Tool graph navigation → eval_tool_graph
  │
  └── Multi-agent system?
      ├── 2 agents → Trajectory Match on coordinator is enough
      ├── 3+ agents → Add Routing Evaluator
      └── Complex hierarchy → Hierarchical Evaluation Pattern
```

## Composing Evaluators

Run multiple evaluators on the same scenario for comprehensive scoring:

```python
def run_all_evaluators(result, scenario):
    """Run all applicable evaluators and return composite score."""
    scores = {}

    # Always run
    scores["trajectory"] = check_trajectory(
        expected=scenario.get("expected_tools", []),
        actual=[tc["name"] for tc in result.get("tool_calls", [])],
        mode="subsequence",
    ).passed

    scores["response"] = eval_response_contains(result, scenario)
    scores["turns"] = eval_max_turns(result, scenario)

    # Conditional
    if scenario.get("should_signal_complete"):
        scores["completion"] = eval_signal_task_complete(result)

    if scenario.get("expected_subagent"):
        scores["routing"] = eval_routing(result, scenario)

    # Composite: all must pass
    all_passed = all(scores.values())
    return {"passed": all_passed, "scores": scores}
```

## Metric Thresholds Linked to Evolution Red Flags

Cross-ref: [Evolution — Red Flags](../../evolution/SKILL.md)

| Red Flag | Eval Metric | Threshold | Action |
|----------|-------------|-----------|--------|
| Tool confusion | Tool selection accuracy | < 80% | Simplify tool descriptions, reduce tool count |
| Context overflow | Context overflow rate | > 5% | Split into subagents, reduce tool descriptions |
| Inconsistent results | Scenario pass rate | < 90% | Add deterministic checks, review prompt |
| Slow responses | Avg latency | > 60s | Optimize tool chains, cache results |
| High escalation | Escalation rate | > 15% | Expand agent capabilities, adjust thresholds |

When a metric crosses its threshold, it's a signal to apply [Evolution refactoring patterns](../../evolution/SKILL.md) (Extract Subagent, Split Agent, etc.).
