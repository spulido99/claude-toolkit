---
name: Evals-Driven Development
description: This skill should be used when the user asks to "evaluate agents", "test agent", "create eval dataset", "design evals", "benchmark agent", "debug agent", "run evals", or needs guidance on testing, evaluating, and iterating on deep agent systems using an evals-driven approach.
---

# Evals-Driven Development (EDD)

Evals-Driven Development is to agents what TDD is to code. Define what your agent should do *before* (or alongside) building it, then iterate until it does.

```
JTBD → Scenarios → Dataset → Evaluate → Improve
  ↑                                        |
  └──────────── new scenarios ─────────────┘
```

**Adaptive entry point**: EDD works whether you have an existing agent or are starting from scratch.
- **Existing agent**: Read its tools, subagents, and prompts to generate scenarios from current behavior.
- **Greenfield**: Define JTBD and scenarios first. The dataset becomes your spec — build the agent to pass it.

**Getting started**: Run `/design-evals` to scaffold your eval suite interactively.

## Step 1: Define Scenarios from JTBD

Every eval starts from a **Job-To-Be-Done** — what your agent's end-user wants to accomplish. You don't need to know the JTBD framework; just answer: *"What does your user want to get done?"*

### Narrative First (Low Friction)

Start by describing scenarios in plain language:

```
Job: "Customer wants to track their order and change delivery address"
Happy path: Ask for order → agent looks it up → user asks to change address →
            agent requests approval → human approves → agent confirms
Edge case:  Order not found → agent asks for alternative info
Failure:    Agent changes address without approval
```

### Structured YAML (When Ready for Automation)

The narrative converts to a structured format the eval system can execute:

```yaml
- job: Track and modify order
  actor: Customer
  trigger: "Where is my order?"
  scenarios:
    - name: happy_path_track_and_modify
      tags: [smoke, e2e]
      turns:
        - user: "Where is my order #1234?"
        - expected_tools: [lookup_order]
          mock_responses:
            lookup_order:
              status: "shipped"
              tracking: "1Z999AA10123456784"
              eta: "2026-02-21"
        - user: "Change delivery to 123 Main St"
        - expected_tools: [update_order]
          mock_responses:
            update_order:
              status: "pending_confirmation"
              changes: { address: "123 Main St" }
          interrupt: true
        - approval: approve
        - expected_tools: []
      success_criteria:
        - response_contains: ["address updated", "123 Main St"]
        - max_turns: 5

    - name: order_not_found
      tags: [edge_case]
      turns:
        - user: "Where is my order #9999?"
        - expected_tools: [lookup_order]
          mock_responses:
            lookup_order:
              error: "not_found"
              message: "No order found with ID #9999"
      success_criteria:
        - response_contains: ["not found", "order number"]
        - no_tools: [update_order]
```

**Key fields**:
- `mock_responses`: Tool return values for Tier 1 scripted tests — the eval runner intercepts tool calls and returns these instead of calling real services. If the agent calls a tool not in `expected_tools`, the test fails immediately (contract test).
- `approval`: Handles `interrupt_on` HITL flows — the eval runner auto-responds with `approve` or `reject` when the agent pauses for human decision. Test both paths. (Cross-ref: [Patterns — interrupt_on](../patterns/SKILL.md))
- `tags`: Organize scenarios for selective runs (`@smoke`, `@e2e`, `@edge_case`, `@error_handling`, `@multi_agent`).

See [`references/01-scenarios.md`](references/01-scenarios.md) for full templates, E2E examples, and anti-patterns.

## Step 2: Build Your Dataset

### Local-First Storage

Datasets live as YAML/JSON files in `evals/datasets/`. Version-controlled, PR-reviewable, zero external dependencies.

```
evals/
  datasets/
    support-agent.yaml       # Scenario definitions
  __snapshots__/             # Trajectory snapshots (auto-generated)
  .results/                  # Run results (gitignored)
    latest.json
    history/
  conftest.py                # Agent discovery fixture
  eval-config.yaml           # Snapshot comparison + eval settings
```

### Agent Discovery Convention

The eval system finds your agent through a `conftest.py` fixture:

```python
# evals/conftest.py (scaffolded by /design-evals)
import pytest
from agent import create_agent  # Convention: project exposes create_agent()

@pytest.fixture
def agent():
    """Create a fresh agent instance per test."""
    return create_agent()
```

`/design-evals` auto-detects the entry point by searching for `create_agent` or `create_deep_agent` in `agent.py`, `main.py`, or `src/agent.py`. If not found, it asks for the module path.

For multi-agent projects:

```python
@pytest.fixture(params=["coordinator", "billing", "shipping"])
def agent(request):
    """Create named agent for multi-agent testing."""
    return create_agent(request.param)
```

### Two Tiers of User Simulation

**Tier 1 — Scripted (Default)**

Fixed turn sequences from your YAML dataset. Deterministic, free, fast. Used for the dev inner loop.

```python
import yaml
import pytest

def load_scenarios(path="evals/datasets/support-agent.yaml"):
    with open(path) as f:
        data = yaml.safe_load(f)
    # Flatten: each job has multiple scenarios
    return [s for job in data for s in job["scenarios"]]

@pytest.mark.parametrize("scenario", load_scenarios(), ids=lambda s: s["name"])
def test_scenario(scenario, agent):
    """Run a scripted scenario against the agent."""
    thread_id = f"test-{scenario['name']}"
    for turn in scenario["turns"]:
        if "user" in turn:
            result = agent.invoke(
                {"messages": [{"role": "user", "content": turn["user"]}]},
                config={"configurable": {"thread_id": thread_id}},
            )
        elif "expected_tools" in turn:
            actual_tools = [tc["name"] for tc in result.get("tool_calls", [])]
            for expected in turn["expected_tools"]:
                assert expected in actual_tools, f"Expected {expected}, got {actual_tools}"
        elif "approval" in turn:
            # Auto-respond to interrupt_on pause
            result = agent.invoke(
                {"messages": [{"role": "human", "content": turn["approval"]}]},
                config={"configurable": {"thread_id": thread_id}},
            )
```

**Tier 2 — Simulated (Pre-Merge)**

LLM-powered users via `openevals`. Flexible, handles emergent edge cases. Costs tokens.

```python
from openevals.simulators import create_llm_simulated_user
from openevals.simulation import run_multiturn_simulation

user = create_llm_simulated_user(
    system=scenario.get("simulated_user_prompt", "You are a frustrated customer."),
    model="openai:gpt-4.1-mini",
)

result = run_multiturn_simulation(
    app=wrap_agent(agent),
    user=user,
    max_turns=scenario.get("max_turns", 10),
)
```

### Optional: LangSmith Sync

Sync local datasets to LangSmith for experiment tracking and side-by-side comparison:

```python
from langsmith import Client

client = Client()
dataset = client.create_dataset("support-agent-evals")
for scenario in load_scenarios():
    client.create_example(
        inputs={"turns": scenario["turns"]},
        outputs={"success_criteria": scenario["success_criteria"]},
        dataset_id=dataset.id,
    )
```

## Step 3: Evaluate and Score

Three evaluator categories, from cheapest to most flexible.

### Trajectory Match (Deterministic, Free)

Compare actual tool call sequences against expected trajectories.

```python
from agentevals.trajectory import check_trajectory

# Strict: exact tool sequence match
result = check_trajectory(
    expected=["lookup_order", "update_order", "signal_task_complete"],
    actual=actual_tool_calls,
    mode="strict",
)

# Unordered: all tools present, any order
result = check_trajectory(expected=expected, actual=actual, mode="unordered")

# Subsequence: expected tools appear as subsequence in actual
result = check_trajectory(expected=expected, actual=actual, mode="subsequence")
```

| Mode | Compares | Best for |
|------|----------|----------|
| `strict` | Exact sequence | Well-defined workflows |
| `unordered` | Same tools, any order | Parallel tool execution |
| `subsequence` | Expected appears within actual | Agents that add optional tools |

### LLM-as-Judge (Flexible, Costs Tokens)

For nuanced evaluation where deterministic checks aren't enough:

```python
from agentevals.trajectory import create_trajectory_llm_as_judge
from agentevals.trajectory import TRAJECTORY_ACCURACY_PROMPT

evaluator = create_trajectory_llm_as_judge(
    prompt=TRAJECTORY_ACCURACY_PROMPT,
    model="openai:o3-mini",  # Strong model for pre-merge
)

score = evaluator(
    expected=reference_trajectory,
    actual=actual_trajectory,
)
```

Use cheap models (`gpt-4.1-mini`) during development, strong models (`o3-mini`) for pre-merge gates.

### Custom Code Evaluators (Programmatic)

Write evaluators for domain-specific assertions:

```python
def eval_max_turns(result, scenario):
    """Agent must complete within turn budget."""
    max_turns = scenario["success_criteria"].get("max_turns", 10)
    actual_turns = len([m for m in result["messages"] if m["role"] == "assistant"])
    return actual_turns <= max_turns

def eval_signal_task_complete(result):
    """Agent must explicitly signal completion (not just stop talking)."""
    tool_calls = [tc["name"] for tc in result.get("all_tool_calls", [])]
    return "signal_task_complete" in tool_calls

def eval_no_forbidden_tools(result, scenario):
    """Agent must NOT call forbidden tools."""
    forbidden = scenario["success_criteria"].get("no_tools", [])
    actual = [tc["name"] for tc in result.get("all_tool_calls", [])]
    return not any(t in actual for t in forbidden)
```

Cross-ref: [`signal_task_complete` pattern](../patterns/SKILL.md) makes Full Turn assertions unambiguous — assert the tool was called instead of guessing whether the agent is "done."

### Hierarchical Multi-Agent Evaluation

For systems with 3+ subagents, evaluate at two levels:

**Coordinator level**: Did it route to the correct subagent?

```python
def eval_routing(result, scenario):
    """Coordinator delegated to the expected subagent."""
    expected_subagent = scenario.get("expected_subagent")
    delegations = [tc for tc in result["tool_calls"] if tc["name"].startswith("delegate_")]
    if expected_subagent:
        return any(expected_subagent in d["name"] for d in delegations)
    return True
```

**Subagent level**: Did each subagent execute correctly?

Run subagent-specific scenarios against individual subagents (not the coordinator). Each bounded context ([Architecture](../architecture/SKILL.md)) gets its own `evals/` directory for isolation.

See [`references/02-evaluators.md`](references/02-evaluators.md) for the full evaluator catalog, Operation Level evaluators, idempotency testing, and the "which evaluator?" decision tree.

## Step 4: Dev Workflow

### Snapshot Testing (Default Inner Loop)

First run generates trajectory snapshots. Subsequent runs compare against them — no LLM judge needed.

**Snapshot format** (`evals/__snapshots__/{scenario_name}.json`):

```json
{
  "scenario": "track_order_happy_path",
  "recorded_at": "2026-02-19T10:30:00Z",
  "agent_hash": "a1b2c3",
  "compare_mode": "structural",
  "trajectory": [
    {"role": "user", "content": "Where is my order #1234?"},
    {"role": "assistant", "tool_calls": [{"name": "lookup_order", "args": {"order_id": "1234"}}]},
    {"role": "tool", "name": "lookup_order", "content": "{...}"},
    {"role": "assistant", "content": "Your order #1234 has been shipped..."}
  ],
  "metrics": {
    "turns": 2,
    "tool_calls": 1,
    "total_tokens": 1847
  }
}
```

**Snapshot configuration** (`evals/eval-config.yaml`):

```yaml
snapshot:
  compare_mode: structural   # structural | strict | semantic
  ignore_fields:
    - tool_call_id
    - timestamps
    - message_id
```

| Mode | Compares | Use case |
|------|----------|----------|
| `structural` (default) | Tool call names + arg keys + turn count | Most scenarios — catches regressions without over-fitting |
| `strict` | Full tool calls + args + response structure | Well-defined workflows where exact behavior matters |
| `semantic` | Tool call names only + success criteria | Exploratory agents where path varies but outcome is stable |

The `agent_hash` is a hash of the agent's prompt + tool names. When it changes, snapshots are marked stale in `/eval-status`.

### Smoke Testing (Quick Validation)

Run only `@smoke`-tagged scenarios (5-10 critical paths) with a cheap model as judge:

```bash
pytest evals/ -m smoke
```

### Full Eval Review (Pre-Merge Gate)

Manual gate before merging. Run Tier 2 simulated users + strong LLM judge:

```bash
pytest evals/ --full --model openai:o3-mini
```

Cached baselines: skip scenarios unaffected by changes. Compare experiments between versions.

### Progressive Failure UX

Three levels — choose how deep to go:

1. **Always shown**: pass/fail + trace link (local log or LangSmith)
   ```
   ✓ 11 passed | ✗ 1 failed | ~ 2 changed
   FAILED: refund_after_shipping — unexpected tool: escalate_to_human
   ```

2. **On demand** (`/eval --report`): Expected vs actual trajectory diff
   ```
   Expected: [lookup_order, check_refund_policy, process_refund]
   Actual:   [lookup_order, escalate_to_human]
   Diff at turn 2: expected check_refund_policy, got escalate_to_human
   ```

3. **On demand** (`/eval --diagnose`): LLM analyzes WHY it failed + suggests fixes
   ```
   Diagnosis: Agent escalated because refund amount ($150) exceeds the $100
   threshold in the system prompt. Consider updating the threshold or adding
   a check_refund_policy step before escalation.
   ```

See [`references/03-dev-workflow.md`](references/03-dev-workflow.md) for snapshot setup, cost management, production trace mining, and debugging with LangSmith.

## Step 5: Iterate and Expand

### When to Add Scenarios

- **Production failure** → new regression scenario (tag: `regression`)
- **New feature** → new JTBD → new scenarios
- **Edge case discovered** → scenario added (tag: `edge_case`)
- **Bug report** → scenario that reproduces the bug before fixing

Use `/add-scenario` to add scenarios interactively or `/add-scenario --from-trace <path>` to convert a production trace.

### Scaling Your Dataset

| Stage | Scenarios | Focus |
|-------|-----------|-------|
| Starting | 5-10 | Core happy paths + critical failures |
| Growing | 10-50 | Edge cases, error handling, multi-turn |
| Mature | 50-500 | Full coverage, regression suite, multi-agent |

### Dataset Organization

Use tags to create splits for selective runs:
- `smoke`: 5-10 critical scenarios, always run
- `e2e`: Full end-to-end flows
- `edge_case`: Boundary conditions and unusual inputs
- `error_handling`: Tool failures, API errors
- `multi_agent`: Cross-subagent coordination

### Snapshot Re-recording

When you intentionally change the agent (new prompt, new tool, refactored logic):

1. Run `/eval` — changed scenarios show as `~ changed`
2. Run `/eval-update` — review each change, accept or reject
3. Accepted changes update the snapshot; rejected changes stay as failures

### Production Trace Mining

Manually curate interesting production conversations into eval scenarios:

1. Review traces in local logs or LangSmith (failures, escalations, edge cases)
2. Run `/add-scenario --from-trace <path-or-id>` to convert
3. Annotate with expected behavior and success criteria
4. Low volume but high quality — each mined scenario catches a real-world issue

## Quick Reference

### Evaluator Decision Table

| Question | Evaluator |
|----------|-----------|
| Did the agent call the right tools in the right order? | Trajectory match (strict) |
| Did it call the right tools in any order? | Trajectory match (unordered) |
| Did it call certain tools among others? | Trajectory match (subsequence) |
| Did it handle the conversation well overall? | LLM-as-judge |
| Did it finish within the turn budget? | Custom: max turns |
| Did it explicitly signal completion? | Custom: `signal_task_complete` |
| Did it route to the correct subagent? | Custom: routing evaluator |
| Did the `pending_confirmation` flow work? | Custom: approval flow check |
| Is the tool idempotent on retry? | Custom: idempotency evaluator |

### EDD Checklist

- [ ] Define 2-3 JTBD for your agent's users
- [ ] Write happy path + edge case + failure scenarios per JTBD
- [ ] Add `mock_responses` for all expected tool calls
- [ ] Add `approval` steps for `interrupt_on` flows
- [ ] Run `/eval` to generate initial snapshots
- [ ] Tag 5-10 critical scenarios as `@smoke`
- [ ] Set up `eval-config.yaml` with appropriate `compare_mode`
- [ ] Run smoke tests after every change
- [ ] Run full eval review before merging

### Metrics & Targets

| Metric | Description | Target |
|--------|-------------|--------|
| Task Success Rate | % scenarios passing | > 80% |
| Token Efficiency | Tokens per successful task | Minimize |
| Latency | Time to complete task | < 60s typical |
| Error Rate | % scenarios with errors | < 10% |
| Tool Selection Accuracy | Correct tool for task | > 90% |
| Context Overflow | % runs exceeding context | < 5% |
| Escalation Rate | Tasks requiring human | < 15% |

Cross-ref: [Evolution](../evolution/SKILL.md) Level 4 defines these same metrics as maturity indicators. Red flags (tool confusion, context overflow) map to specific thresholds above.

### Cost & Time Estimates

| Mode | Cost/scenario | Time/scenario | 50 scenarios |
|------|---------------|---------------|--------------|
| Snapshot (Tier 1) | $0 | ~2-5s | ~2-4 min |
| Smoke (Tier 1 + cheap judge) | ~$0.01 | ~5-10s | ~5-8 min |
| Full (Tier 2 + strong judge) | ~$0.15-0.30 | ~30-60s | ~25-50 min, ~$8-15 |

**Guidance**:
- **Dev inner loop**: Always Tier 1 snapshot. Zero cost, fast feedback.
- **Pre-commit sanity**: Smoke (`@smoke` tag, 5-10 scenarios). ~$0.10, 1 min.
- **Pre-merge review**: Full suite. Budget ~$10-15 for 50 scenarios. Run once per PR.
- **Model choice**: Use `gpt-4.1-mini` for simulated users, `o3-mini` for judge. Don't use the same strong model for both — it doubles cost with marginal benefit.

### Multi-Agent Directory Layout

**Convention A: Single agent (default)**
```
project/
  agent.py
  evals/
    datasets/
    __snapshots__/
    conftest.py
    eval-config.yaml
    .results/
```

**Convention B: Multi-agent project**
```
project/
  agents/
    coordinator/
      agent.py
      evals/           # Routing and delegation tests
        datasets/
        __snapshots__/
    billing/
      agent.py
      evals/           # Billing-specific tests
        datasets/
        __snapshots__/
  evals/               # E2E integration tests (full system)
    datasets/
    __snapshots__/
    conftest.py
```

Each bounded context ([Architecture](../architecture/SKILL.md)) gets its own `evals/` for isolation. The top-level `evals/` tests the system as a whole.

## Additional Resources

### Related Skills

- **[Quickstart](../quickstart/SKILL.md)** — Getting started with DeepAgents. Run `/design-evals` after your agent works interactively.
- **[Architecture](../architecture/SKILL.md)** — Bounded contexts map to eval units. Token economy sets metric baselines.
- **[Patterns](../patterns/SKILL.md)** — `signal_task_complete`, `interrupt_on`, escalation criteria — all testable with EDD scenarios.
- **[Tool Design](../tool-design/SKILL.md)** — Operation Levels define testing strategy. `pending_confirmation` and idempotency patterns have dedicated evaluators.
- **[Evolution](../evolution/SKILL.md)** — Level 4 metrics = eval metrics. L3→L4 migration starts with `/design-evals`.

### Commands

- `/design-evals` — Scaffold eval suite from JTBD (interactive)
- `/eval` — Run evals (default: snapshot | `--smoke` | `--full` | `--report` | `--diagnose`)
- `/add-scenario` — Add a single scenario interactively or from a production trace
- `/eval-status` — Dataset health dashboard
- `/eval-update` — Review and accept/reject changed snapshots

### External Resources

- [Evaluating Deep Agents: Our Learnings](https://www.blog.langchain.com/evaluating-deep-agents-our-learnings/)
- [Debugging Deep Agents with LangSmith](https://www.blog.langchain.com/debugging-deep-agents-with-langsmith/)

### Dependencies

- `pytest` — Required: test runner for local eval execution
- `agentevals` — Trajectory evaluation: match + LLM judge
- `openevals` — Optional: multi-turn simulation and LLM-as-judge (Tier 2 only)
- `langsmith` — Optional: experiments, tracing, dataset sync
