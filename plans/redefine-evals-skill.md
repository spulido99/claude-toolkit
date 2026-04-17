# Spec: Redefine Evals Skill — Evals-Driven Development

## Vision

Transform the evals skill from a passive reference (Harbor + LangSmith docs) into an **active Evals-Driven Development (EDD) workflow** that guides AI engineers from their users' Jobs-To-Be-Done to a high-quality E2E evaluation dataset, iterating incrementally.

**Analogy**: TDD is to code what EDD is to agents.

```
JTBD → Scenarios → E2E Dataset → Agent → Evaluate → Improve → Repeat
         ↑                                              |
         └──────────── new scenarios ──────────────────┘
```

## Principles

1. **JTBD-first**: Every eval starts from a job the agent's end-user wants to accomplish
2. **E2E before unit**: Validate complete flows first, then deepen into tool selection/ordering
3. **Dataset as artifact**: The dataset is as important as the agent code itself
4. **Continuous iteration**: Every production failure becomes a new scenario in the dataset
5. **Local-first**: Datasets live as JSON/YAML files in the repo. LangSmith is optional for advanced experiments/tracing.

## Key Decisions (from interview)

### Entry Point: Adaptive
- If agent exists: use it to inform eval definitions, organize existing behavior into scenarios
- If no agent yet (greenfield): start EDD-pure — define JTBD and scenarios BEFORE building the agent
- The skill detects context and guides accordingly. The loop is always iterative — builds on what exists.

### Dataset Storage: Local-first
- **Primary**: JSON/YAML files in the repo (e.g., `evals/datasets/`)
- **Optional**: LangSmith for experiments, side-by-side comparison, and tracing
- Local datasets enable version control, PR reviews of eval changes, and zero external dependencies

### Multi-Agent Evaluation: Hierarchical
- **Coordinator level**: Did it delegate to the correct subagent?
- **Subagent level**: Did each subagent execute its task correctly?
- **Routing evaluator**: Dedicated evaluator for routing correctness when 3+ subagents exist. For simpler systems, trajectory match already captures delegation.

### User Simulation: Two Tiers
- **Tier 1 — Scripted users** (default): Fixed response sequences defined in the dataset. Deterministic, free, fast. Used for dev inner loop.
- **Tier 2 — Simulated users**: LLM-powered (`create_llm_simulated_user` from `openevals`). Flexible, handles emergent edge cases. Used for pre-merge eval review.
- Users scale from Tier 1 → Tier 2 as their eval suite matures.

### JTBD Template: Progressive
- Start with **narrative** (low friction): user describes what their agent's user wants in natural language
- The skill/agent **guides the user** to produce a well-structured JTBD even if they don't know the framework (2-3 lines of context, no theory)
- When automation is needed, the skill helps convert narrative → **structured YAML** with fields: `job_statement`, `actor`, `trigger`, `success_criteria`, `failure_modes`

### Dev Inner Loop: Snapshot + Smoke
- **Default: Snapshot testing** — First run generates trajectory snapshots (`evals/__snapshots__/*.json`). Subsequent runs compare against snapshots (no LLM judge needed). If trajectory changes, dev decides: regression or intentional improvement.
- **On demand: Smoke subset** — Scenarios tagged `@smoke` (5-10 critical scenarios) run with cheap model as judge for quick validation.
- **Pre-merge: Full eval review** — Manual gate. Run full suite with simulated users (Tier 2) + good LLM judge (o3-mini/gpt-4o). Cached baselines: only re-evaluate scenarios affected by the change.

### Failure UX: Progressive Depth
Three levels, user chooses how deep to go:
1. **Minimal**: pass/fail + trace link (local log or LangSmith). Always shown.
2. **Diff report**: Expected vs actual trajectory side-by-side, with diffs on tool calls, responses, and turns. On demand.
3. **Diagnostic + suggestions**: LLM analyzes WHY it failed and suggests what to change (prompt, tools, etc). On demand, costs tokens.

### Dataset Drift: Manual Re-record
- When agent changes intentionally (new prompt, new tool), existing snapshots may be invalidated
- Dev re-runs affected scenarios and accepts/rejects new trajectories as updated snapshots
- Simple and explicit — no auto-migration magic

### Production Trace Mining: Manual Curation
- Dev reviews production traces manually (in LangSmith or local logs)
- Selects interesting conversations (failures, escalations, edge cases)
- Converts them into eval scenarios in the dataset
- Low volume but high quality

### Language: English
- All files (SKILL.md and references) in English
- Code examples naturally in English
- Consistent with rest of plugin and GitHub audience

---

## Gap Resolutions

### Gap 1: Agent Discovery Contract

The eval system needs a standard way to find, import, and invoke the agent under test.

**Resolution — `evals/conftest.py` with discovery convention:**

```python
# evals/conftest.py (scaffolded by /design-evals)
import pytest
from agent import create_agent  # Convention: agent.py exposes create_agent()

@pytest.fixture
def agent():
    """Create a fresh agent instance per test."""
    return create_agent()
```

**Convention**: The project must expose a `create_agent()` function. `/design-evals` detects the agent entry point by:
1. Looking for `create_agent` or `create_deep_agent` in `agent.py`, `main.py`, or `src/agent.py`
2. If not found, asking the user for the module path
3. Generating `conftest.py` with the correct import

For multi-agent projects, the fixture accepts a name parameter:
```python
@pytest.fixture(params=["coordinator", "billing", "shipping"])
def agent(request):
    return create_agent(request.param)
```

### Gap 2: Tool Mocking in Tier 1

Scripted scenarios define user turns and expected tool calls, but tools need to return data for the agent to continue. Without mock responses, Tier 1 can't run.

**Resolution — Mock responses in scenario YAML:**

```yaml
- name: track_order_happy_path
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
          success: true
          message: "Address updated to 123 Main St"
```

The eval runner intercepts tool calls, returns the mock response, and records the trajectory. The agent never calls real tools during Tier 1 evals.

**Implementation**: The eval runner wraps the agent's tools with a mock layer that:
1. Matches tool call name against `mock_responses`
2. Returns the mock data as the tool result
3. If no mock defined for a tool call, fails the test with "unexpected tool call: {name}"

This also serves as a **contract test** — if the agent calls a tool not in `expected_tools`, the test catches it immediately.

### Gap 3: `interrupt_on` Handling in Automated Evals

When agents use `interrupt_on` for HITL, the agent pauses execution and waits for human approval. In automated tests, this must be resolved programmatically.

**Resolution — `approval` steps in scenario YAML:**

```yaml
turns:
  - user: "Refund order #1234"
  - expected_tools: [process_refund]
    interrupt: true           # Agent will pause here
  - approval: approve         # Eval runner auto-responds with "approve"
  - expected_tools: []        # Agent confirms refund, no more tool calls
```

The eval runner detects the interrupt state and injects the approval/rejection decision from the scenario. This tests both paths:
- `approval: approve` — tests the happy path through the gate
- `approval: reject` — tests that the agent handles rejection gracefully

```yaml
# Test that rejection is handled correctly
- name: refund_rejected_by_human
  tags: [edge_case]
  turns:
    - user: "Refund order #5678"
    - expected_tools: [process_refund]
      interrupt: true
    - approval: reject
  success_criteria:
    - response_contains: ["cannot process", "refund"]
    - no_tools: [process_refund]  # Should NOT execute after rejection
```

**Cross-reference**: patterns/SKILL.md defines `interrupt_on` patterns. tool-design/SKILL.md defines Operation Levels 3-5 that require approval. The evals skill tests both.

### Gap 4: Snapshot Comparison Granularity

Agents are non-deterministic. Snapshot comparison needs configurable granularity to avoid false failures.

**Resolution — Three comparison modes in snapshot config:**

```yaml
# evals/eval-config.yaml
snapshot:
  compare_mode: structural   # Default
  ignore_fields:
    - tool_call_id            # Always random
    - timestamps              # Always different
    - message_id              # Internal IDs
```

| Mode | Compares | Use case |
|------|----------|----------|
| `structural` (default) | Tool call names + arg keys + turn count | Most scenarios — catches regressions without over-fitting |
| `strict` | Full tool calls + args + response structure | Well-defined workflows where exact behavior matters |
| `semantic` | Tool call names only + success criteria | Exploratory agents where path varies but outcome is stable |

**Snapshot file format** (`evals/__snapshots__/{scenario_name}.json`):
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

The `agent_hash` is a hash of the agent's prompt + tool names. When it changes, snapshots are marked stale in `/eval-status`.

### Gap 5: Eval Results Persistence

`/eval-status` needs historical run data. Without persistence, it can only show static dataset info.

**Resolution — `evals/.results/` directory:**

```
evals/
  .results/
    latest.json              # Last run summary
    history/
      2026-02-19T10-30.json  # Historical runs (keep last 20)
```

**`latest.json` format:**
```json
{
  "run_at": "2026-02-19T10:30:00Z",
  "duration_seconds": 45,
  "total": 47,
  "passed": 45,
  "failed": 1,
  "changed": 1,
  "mode": "snapshot",
  "failures": [
    {"scenario": "refund_after_shipping", "reason": "unexpected tool: escalate_to_human"}
  ],
  "changes": [
    {"scenario": "track_order_happy_path", "diff": "turn 3: added verify_address"}
  ]
}
```

`.results/` is gitignored (machine-specific). `/eval-status` reads `latest.json` + dataset files for the dashboard.

### Gap 6: Multi-Agent Directory Convention

Projects with multiple agents need clear eval organization.

**Resolution — Two conventions based on project structure:**

**Convention A: Single agent (default)**
```
project/
  agent.py
  evals/
    datasets/
    __snapshots__/
    conftest.py
    .results/
```

**Convention B: Multi-agent project**
```
project/
  agents/
    coordinator/
      agent.py
      evals/           # Coordinator-level evals (routing, delegation)
        datasets/
        __snapshots__/
    billing/
      agent.py
      evals/           # Subagent-level evals (billing-specific)
        datasets/
        __snapshots__/
  evals/               # E2E integration evals (full system)
    datasets/
    __snapshots__/
    conftest.py        # Fixtures for all agents
```

**Cross-reference**: architecture/SKILL.md defines bounded contexts. Each bounded context (subagent) gets its own `evals/` for isolation. The top-level `evals/` tests the system as a whole — this maps to the hierarchical evaluation strategy.

`/design-evals` detects the project structure and scaffolds accordingly.

### Gap 7: Cross-Skill Integration Points

Evals doesn't exist in isolation — it connects to every other skill in the plugin. These connections need to be explicit.

**Resolution — Bidirectional cross-references:**

See the dedicated **Cross-Skill Integration** section below.

### Gap 8: Local Trace Format for `--from-trace`

`/add-scenario --from-trace` needs traces. If LangSmith is optional, there must be a local option.

**Resolution — Two sources:**

**Source A: LangSmith (if configured)**
```
/add-scenario --from-trace langsmith:run_id_abc123
```
Fetches the trace via LangSmith SDK. Requires `LANGSMITH_API_KEY`.

**Source B: Local trace files (always available)**
```
/add-scenario --from-trace ./traces/conv_abc123.json
```

Local traces are generated by enabling trace logging in the agent:
```python
# In conftest.py or agent setup
import json

def trace_middleware(state, config):
    """Save traces to local files for eval mining."""
    trace_dir = "traces/"
    os.makedirs(trace_dir, exist_ok=True)
    thread_id = config.get("configurable", {}).get("thread_id", "unknown")
    with open(f"{trace_dir}/{thread_id}.json", "w") as f:
        json.dump(state["messages"], f, default=str)
    return state
```

The trace file format matches the snapshot format — same message structure, so conversion is straightforward.

`03-dev-workflow.md` covers the trace middleware setup. `/add-scenario --from-trace` parses either source and presents the conversation for the dev to annotate with expected behavior.

### Gap 9: Cost/Time Estimates for Tier 2

Developers need rough guidance to choose between tiers.

**Resolution — Cost table in Quick Reference (Section 7):**

| Mode | Cost per scenario | Time per scenario | 50 scenarios |
|------|-------------------|-------------------|--------------|
| Snapshot (Tier 1) | $0 | ~2-5s | ~2-4 min |
| Smoke (Tier 1 + cheap judge) | ~$0.01 | ~5-10s | ~5-8 min |
| Full (Tier 2 simulated + strong judge) | ~$0.15-0.30 | ~30-60s | ~25-50 min, ~$8-15 |

**Guidance**:
- **Dev inner loop**: Always Tier 1 snapshot. Zero cost, fast feedback.
- **Pre-commit sanity**: Smoke (@smoke tag, 5-10 scenarios). ~$0.10, 1 min.
- **Pre-merge review**: Full suite. Budget ~$10-15 for 50 scenarios. Run once per PR.
- **Model choice**: Use `gpt-4.1-mini` for simulated users ($), `o3-mini` for judge ($$). Don't use `gpt-4o` for both — it doubles cost with marginal benefit.

Costs are approximate and depend on scenario complexity (turns, response length). These estimates should be validated during implementation and updated in the reference.

---

## Cross-Skill Integration

The evals skill is the **measurement layer** that connects to every other skill. These cross-references must be explicit in both directions.

### ↔ tool-design/SKILL.md

| tool-design concept | Eval connection | Where to document |
|---------------------|-----------------|-------------------|
| **Operation Levels 1-5** | Each level implies a different testing strategy. Level 1-2: simple tool call assertions. Level 3-4: test `pending_confirmation` → confirm flow. Level 5: test `interrupt_on` rejection handling. | SKILL.md Section 4 + `02-evaluators.md` |
| **Delegated Confirmations (`pending_confirmation`)** | Multi-turn test pattern: invoke → `pending_confirmation` response → confirm tool call → assert `completed`. This is a specific scenario template. | `01-scenarios.md` scenario templates |
| **Idempotency Keys** | Test: retry same tool call with same idempotency key → get original result without re-execution. This is a new evaluator pattern not currently covered. | `02-evaluators.md` custom evaluators |
| **Actionable Error `suggestions` field** | Assert: when tool fails, response contains correct remediation suggestion. Tests the tool graph is navigable. | `02-evaluators.md` custom evaluators |
| **Available Actions / Tool Graph (Principle 7)** | Assert: after each tool call, `available_actions` contains the expected next tools. Validates the designed flow is actually followed. | `02-evaluators.md` custom evaluators |
| **Semantic Naming + Trigger Phrases** | Eval: given a natural language request matching a trigger phrase, the agent selects the correct tool. This is tool selection accuracy by design. | `01-scenarios.md` scenario from trigger phrases |

**Bidirectional**: tool-design/SKILL.md should reference evals for "how to verify your tools work as designed."

### ↔ patterns/SKILL.md

| patterns concept | Eval connection | Where to document |
|------------------|-----------------|-------------------|
| **`signal_task_complete` tool** | Makes Full Turn assertions unambiguous. Eval asserts `signal_task_complete` was called (not heuristic "done" detection). | SKILL.md Section 4 |
| **`interrupt_on` HITL flow** | Automated testing of approval/rejection paths. `approval: approve/reject` steps in scenario YAML. | SKILL.md Section 3 (Gap 3 resolution) |
| **Escalation criteria (thresholds)** | Single-step evals at boundary values. E.g., refund $499 → auto-approve, $501 → escalate. Tests the exact threshold. | `01-scenarios.md` boundary scenario template |
| **`ToolRuntime` / `context_schema`** | Multi-tenant test isolation. Run same scenario with different `UserContext` values to test access control. | `01-scenarios.md` multi-tenant testing pattern |
| **System prompt stopping criteria** | If prompt says "stop after 3 attempts", eval asserts agent stops at 3. Stopping criteria become eval assertions. | `02-evaluators.md` custom evaluators |

**Bidirectional**: patterns/SKILL.md should reference evals for "how to verify your patterns behave correctly under edge cases."

### ↔ evolution/SKILL.md

| evolution concept | Eval connection | Where to document |
|-------------------|-----------------|-------------------|
| **Level 4 metrics** (token efficiency, error rate, subagent utilization) | Exactly the metrics the eval system tracks. Evolution defines WHAT to measure, evals defines HOW. | SKILL.md Section 7 Quick Reference |
| **L3 → L4 migration: "Establish testing framework"** | This is the trigger moment for adopting EDD. When a team reaches Level 3, `/design-evals` is the next step. | SKILL.md Section 1 (EDD intro) |
| **Level 5: A/B testing** | LangSmith Experiments enable side-by-side comparison of prompt variations. The eval dataset is the constant; the agent config is the variable. | `03-dev-workflow.md` |
| **Red flags** ("tool confusion", "context overflow", "inconsistent results") | Each red flag maps to a specific eval metric threshold. Tool confusion → tool selection accuracy < 80%. Context overflow → context_overflow_rate > 5%. | `02-evaluators.md` metric thresholds |
| **Refactoring patterns** (Extract/Split/Merge Subagent) | Evals are the regression gate for refactoring. Run before/after each refactoring. If pass rate drops, the refactoring broke something. | `03-dev-workflow.md` refactoring eval workflow |

**Bidirectional**: evolution/SKILL.md should reference evals for "how to measure maturity" and link red flags to specific eval commands.

### ↔ architecture/SKILL.md

| architecture concept | Eval connection | Where to document |
|----------------------|-----------------|-------------------|
| **Bounded contexts** | Each bounded context (subagent) is the unit of isolated testing. Hierarchical eval maps directly to bounded context boundaries. | SKILL.md Section 4 (hierarchical eval) |
| **Cognitive load (3-10 tools/agent)** | If an agent has >10 tools and tool selection accuracy drops, that's measurable evidence to split into subagents. Evals inform architecture decisions. | `02-evaluators.md` |
| **Token economy (2k-5k per subagent call)** | Sets baseline for "Token Efficiency" metric targets. Architecture predicts the budget; evals measure actual spend. | SKILL.md Section 7 Quick Reference |
| **Topology selection → observability needs** | Complex topologies need deeper tracing. Evals + LangSmith tracing validates the topology works as designed. | `03-dev-workflow.md` |

**Bidirectional**: architecture/SKILL.md should reference evals for "how to validate your architecture handles real traffic patterns."

### ↔ quickstart/SKILL.md

| quickstart concept | Eval connection | Where to document |
|--------------------|-----------------|-------------------|
| **Interactive chat console** | The chat console is the manual precursor to automated evals. Same `agent.invoke()` pattern, but interactive. Quickstart → chat console → `/design-evals` → automated evals. | SKILL.md Section 1 (learning progression) |
| **`/new-sdk-app` scaffolding** | Should mention `/design-evals` as a next step after the agent is scaffolded. The `tests/test_agent.py` it generates should link to EDD. | quickstart/SKILL.md "Next Steps" |

**Bidirectional**: quickstart should add a note: "Once your agent works interactively, run `/design-evals` to create automated evaluations."

---

## File Structure

### Main file: `skills/evals/SKILL.md`

**Complete rewrite.** New structure:

#### Section 1: Evals-Driven Development (EDD)
- What EDD is in 3-4 sentences (not academic). Analogy with TDD.
- The loop diagram: JTBD → Scenarios → Dataset → Evaluate → Improve
- Adaptive entry point: works whether you have an agent or not

#### Section 2: Define Scenarios from JTBD (Step 1)
- JTBD in 2-3 lines — just enough to guide the user. No theory.
- The skill guides users through: "What does your agent's user want to accomplish?"
- Progressive template: start narrative, convert to structured when needed
- Narrative example:

```
Job: "Customer wants to track their order and change delivery address"
Happy path: Ask for order → agent looks it up → user asks to change address →
            agent requests approval → human approves → agent confirms
Edge case: Order not found → agent asks for alternative info
Failure: Agent changes address without approval
```

- Structured YAML when ready for automation:

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
        - user: "Change delivery to 123 Main St"
        - expected_tools: [update_order]  # with interrupt_on
        - approval: approve
      success_criteria:
        - response_contains: ["address updated", "123 Main St"]
        - max_turns: 4
    - name: order_not_found
      tags: [edge_case]
      turns:
        - user: "Where is my order #9999?"
        - expected_tools: [lookup_order]
      success_criteria:
        - response_contains: ["not found", "order number"]
        - no_tools: [update_order]
```

#### Section 3: Build Your Dataset (Step 2)
- Dataset format: local JSON/YAML files in `evals/datasets/`
- Two tiers of user simulation:
  - **Tier 1 — Scripted**: Fixed turn sequences from YAML. Deterministic, free.
  - **Tier 2 — Simulated**: LLM-powered users via `openevals`. Flexible, costs tokens.
- How to structure reference trajectories (tool calls, order, expected response)
- Code example: loading local dataset + running with scripted user

```python
import json
import pytest

def load_dataset(path="evals/datasets/support-agent.json"):
    with open(path) as f:
        return json.load(f)

@pytest.mark.parametrize("scenario", load_dataset(), ids=lambda s: s["name"])
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
```

- Code example: Tier 2 with simulated user (for pre-merge)

```python
from openevals.simulators import create_llm_simulated_user
from openevals.simulation import run_multiturn_simulation

user = create_llm_simulated_user(
    system=scenario["simulated_user_prompt"],
    model="openai:gpt-4.1-mini",
)

result = run_multiturn_simulation(
    app=wrap_agent(agent),
    user=user,
    max_turns=scenario["max_turns"],
)
```

- Optional: syncing local dataset to LangSmith for experiments

#### Section 4: Evaluate and Score (Step 3)
- Three evaluator categories:

**Deterministic — Trajectory Match** (fast, free):
- `strict`: Exact tool sequence match
- `unordered`: Correct tools regardless of order
- `subsequence`: Expected tools appear as subsequence in actual trajectory

**LLM-as-Judge** (flexible, costs tokens):
- `create_trajectory_llm_as_judge` with `TRAJECTORY_ACCURACY_PROMPT`
- Custom domain-specific prompts

**Custom Code** (programmatic):
- Response contains required info
- Within turn limit
- Token efficiency
- Correct escalation to human
- (For 3+ subagents) Routing correctness evaluator

- Hierarchical evaluation for multi-agent systems:
  - Coordinator evaluation: correct delegation?
  - Subagent evaluation: correct execution per subagent?
  - Example code for both levels

#### Section 5: Dev Workflow (Step 4)
- **Snapshot testing** (default inner loop):
  - First run: generates `evals/__snapshots__/{scenario_name}.json`
  - Subsequent runs: compare trajectory against snapshot
  - If changed: dev reviews and accepts (update snapshot) or rejects (regression)
  - No LLM judge needed — pure diff comparison
- **Smoke testing** (on demand):
  - `pytest -m smoke` runs only `@smoke` tagged scenarios
  - Uses cheap model as judge for quick validation
- **Full eval review** (pre-merge, manual gate):
  - Run full suite with Tier 2 simulated users + strong LLM judge
  - Cached baselines: skip scenarios unaffected by changes
  - Compare experiments between versions

- **Failure UX** (progressive depth):
  1. **Always**: pass/fail + trace link
  2. **`--report`**: Side-by-side diff of expected vs actual trajectory
  3. **`--diagnose`**: LLM analysis of WHY it failed + suggestions

#### Section 6: Iterate and Expand (Step 5)
- When to add scenarios:
  - Production failure → new regression scenario
  - New feature → new JTBD → new scenarios
  - Edge case discovered → scenario added
- Scaling: 5 → 50 → 500 scenarios
- Dataset splits via tags: `smoke`, `e2e`, `edge_case`, `error_handling`, `multi_agent`
- Dataset versioning: snapshots pinned to git commits
- Re-recording: when agent changes intentionally, re-run affected scenarios and review new snapshots
- Production trace mining: manually curate interesting conversations into new scenarios

#### Section 7: Quick Reference
- Evaluator decision table (when to use each)
- EDD checklist
- Key metrics and targets (kept from current skill)

---

### Reference file: `skills/evals/references/01-scenarios.md`

**Phase 1: Scenario Design & Dataset Creation**

Expanded detail on:
- JTBD → Scenario mapping templates (narrative + structured YAML)
- Full E2E example: 3 JTBD → 8 scenarios for a support agent
- Dataset file format specification (JSON schema)
- Scripted user patterns (happy path, edge case, error, multi-turn)
- Simulated user prompt engineering (how to write good user personas)
- Anti-patterns in scenario design:
  - Scenarios too simple (single turn, no edge cases)
  - Scenarios too coupled to implementation (testing tool names instead of outcomes)
  - Missing failure scenarios
  - No diversity in user behavior

### Reference file: `skills/evals/references/02-evaluators.md`

**Phase 2: Evaluator Catalog & Scoring**

Complete catalog with decision tree:
- **Trajectory match evaluators**: strict, unordered, subsequence — when to use each, code examples
- **LLM-as-judge evaluators**: TRAJECTORY_ACCURACY_PROMPT, custom prompts, model selection (cheap for dev, good for pre-merge)
- **Custom code evaluators**: turn count, token efficiency, content assertions, escalation correctness
- **Routing evaluator** (multi-agent): dedicated evaluator for 3+ subagent systems
- **Hierarchical evaluation pattern**: coordinator eval + per-subagent eval with code example
- Decision tree: "Which evaluator should I use?" flowchart
- Composing evaluators: running multiple evaluators on the same scenario

### Reference file: `skills/evals/references/03-dev-workflow.md`

**Phase 3: Developer Workflow & CI**

Expanded detail on:
- **Snapshot testing setup**: directory structure, snapshot format, update workflow
- **Smoke testing**: tagging scenarios, pytest markers, running subsets
- **Full eval review**: manual gate process, cached baselines strategy, experiment comparison
- **Failure investigation UX**: the 3 progressive levels with code/CLI examples
- **CI/CD integration**: GitHub Actions example for manual eval trigger
- **Cost management**: model selection per context (dev vs pre-merge), caching strategies
- **Dataset drift handling**: when to re-record, how to review changed snapshots
- **Production trace mining**: manual curation workflow from logs/LangSmith to eval scenarios
- Mocking strategies for external services (moved from current skill)
- Debugging with LangSmith tracing (moved from current skill)

---

## Agents

Two agents power the EDD workflow. The skill (`SKILL.md`) is their shared knowledge base — it tells them HOW to do things. The agents DO the things.

### Agent: `eval-designer`

**Triggers**: "design evals", "define scenarios", "create eval dataset", "add scenario"

**What it does**:
- Interviews the user about their agent's JTBD (guided — works even if user doesn't know JTBD framework)
- If agent code exists: reads it to understand tools, subagents, system prompts — uses this to suggest scenarios
- If no agent yet: works from user's description of intended behavior
- Generates scenario YAML (progressive: narrative first, structured when ready)
- Scaffolds `evals/` directory structure on first run
- Can add single scenarios incrementally (not just full design sessions)

**Tools it needs**: Read (agent code), Write (scenario files), AskUserQuestion (interview), Glob/Grep (find agent config)

### Agent: `eval-runner`

**Triggers**: "run evals", "test agent", "check eval results", "eval status"

**What it does**:
- Loads dataset from local files (`evals/datasets/`)
- Runs scenarios against the agent (Tier 1 scripted by default, Tier 2 simulated on demand)
- Manages snapshots (`evals/__snapshots__/`): create, compare, update
- Reports results with progressive failure UX (pass/fail → diff → diagnose)
- For multi-agent: runs hierarchical evaluation (coordinator + per-subagent)
- Shows dataset health stats (coverage, stale snapshots, last run)

**Tools it needs**: Read (datasets, snapshots, agent code), Write (snapshots, reports), Bash (run pytest), Glob (find eval files)

---

## Commands

Commands are the developer's daily interface to EDD. They should feel as natural as `git commit` or `pytest`.

### `/design-evals` — Design eval scenarios from scratch

**When**: Starting a new agent, adding a new JTBD, or bootstrapping evals for an existing agent.

**Flow**:
```
Developer: /design-evals
Agent:     Reads agent code (if exists) to understand tools, subagents, prompts
Agent:     "What does your agent's user want to accomplish? Describe 2-3 jobs."
Developer: "Track orders, request refunds, change subscription plan"
Agent:     Generates scenario YAML for each JTBD (happy path + edge cases)
Agent:     Scaffolds evals/ directory if needed
Agent:     Writes dataset files + initial pytest config
Output:    evals/datasets/support-agent.yaml (12 scenarios)
           evals/conftest.py (agent fixture)
           evals/__snapshots__/ (empty, ready for first run)
```

**Triggers agent**: `eval-designer`

### `/eval` — Run evals (the daily driver)

**When**: After any agent change. The most frequently used command.

**Modes** (via args):
- `/eval` — Default: snapshot comparison. Fast, free, deterministic.
- `/eval --smoke` — Only `@smoke` tagged scenarios. Even faster.
- `/eval --full` — Full suite with Tier 2 simulated users + strong LLM judge. Pre-merge.
- `/eval --report` — Re-run + show diff report for failures.
- `/eval --diagnose` — Re-run + LLM analysis of failures with suggestions.

**Flow (default)**:
```
Developer: /eval
Agent:     Loads evals/datasets/*.yaml
           Runs scenarios against agent (scripted, Tier 1)
           Compares trajectories against evals/__snapshots__/
Output:    ✓ 11 passed | ✗ 1 failed | ~ 2 changed

           FAILED: refund_after_shipping
             Expected: [lookup_order, check_refund_policy, process_refund]
             Actual:   [lookup_order, escalate_to_human]
             → Run /eval --report for diff or /eval --diagnose for analysis

           CHANGED: track_order_happy_path
             Trajectory changed at turn 3 (new tool call added)
             → Run /eval-update to review and accept/reject
```

**Triggers agent**: `eval-runner`

### `/add-scenario` — Add a single scenario

**When**: After a bug report, production incident, or discovered edge case.

**Flow**:
```
Developer: /add-scenario
Agent:     "Describe the scenario. What happened or what should happen?"
Developer: "Customer tried to cancel an order that was already shipped.
            Agent should explain it can't be cancelled but offer a return."
Agent:     Generates scenario YAML with appropriate tags
           Adds to existing dataset file
           "Scenario 'cancel_shipped_order' added with tags [edge_case].
            Run /eval to generate initial snapshot."
```

**Variant**: `/add-scenario --from-trace <thread_id>`
```
Developer: /add-scenario --from-trace conv_abc123
Agent:     Fetches conversation trace (from local logs or LangSmith)
           Converts actual conversation into scenario format
           "I converted the trace into a scenario. The agent escalated at turn 4.
            What should the expected behavior be?"
Developer: "It should have offered a return instead of escalating"
Agent:     Updates scenario with correct expected trajectory
           Adds to dataset with tag [regression]
```

**Triggers agent**: `eval-designer`

### `/eval-status` — Dashboard view

**When**: Quick health check. "How are my evals doing?"

**Flow**:
```
Developer: /eval-status
Output:    Dataset: 47 scenarios
             smoke: 12 | e2e: 23 | edge_case: 8 | multi_agent: 4
           Snapshots: 44 current | 3 stale (agent changed since last snapshot)
           Last run: 45/47 passed (95.7%)
           Coverage: 3/3 JTBD covered
             track_order: 18 scenarios ✓
             refunds: 15 scenarios ✓
             subscriptions: 14 scenarios ✓
```

**Lightweight**: Does not trigger an agent — just reads files and reports stats.

### `/eval-update` — Review changed snapshots

**When**: After intentional agent changes. Snapshots are outdated and need review.

**Flow**:
```
Developer: /eval-update
Agent:     "3 snapshots have changed since last accepted version."

           1/3: track_order_happy_path
           - Turn 3: NEW tool call `verify_address` added before `update_order`
           - Accept this change? [yes/no/diff]

Developer: yes

           2/3: refund_partial_order
           - Turn 2: Tool `process_refund` replaced by `calculate_partial_refund`
           - Accept this change? [yes/no/diff]

Developer: diff
Agent:     [shows full trajectory diff]
Developer: yes

           3/3: cancel_subscription
           - Turn 1: Agent skipped `check_contract_terms` entirely
           - Accept this change? [yes/no/diff]

Developer: no
Agent:     "Marked as regression. Snapshot kept at previous version.
            This scenario will show as FAILED until the agent behavior is fixed."
```

**Triggers agent**: `eval-runner`

---

## Command ↔ Agent ↔ Skill Relationship

```
Commands (user interface)          Agents (execution)           Skill (knowledge)
─────────────────────────          ──────────────────           ─────────────────
/design-evals ──────────────────→  eval-designer  ←──────────  SKILL.md
/add-scenario ──────────────────→  eval-designer                 01-scenarios.md
                                                                 02-evaluators.md
/eval ──────────────────────────→  eval-runner    ←──────────    03-dev-workflow.md
/eval-update ───────────────────→  eval-runner
/eval-status (no agent needed)
```

The skill teaches the agents what good evals look like. The agents execute the workflow. The commands give developers fast access to the right agent at the right moment.

---

## What Gets Removed from Current Skill

| Current Section | Decision | Reason |
|-----------------|----------|--------|
| Harbor Framework (lines 21-56) | **Remove** | Too specific, not part of EDD workflow. Users who need Harbor can find it in deepagents docs. |
| LangSmith Integration (lines 69-99) | **Integrate** into sections 3-5 | Used as optional infrastructure, not a standalone section |
| Generic Testing Strategies (lines 101-182) | **Replace** | New strategies are more specific, actionable, and structured |
| Metrics tables (lines 184-202) | **Keep** in Quick Reference | Still relevant |
| Mocking Strategies (lines 204-220) | **Move** to `03-dev-workflow.md` | Useful but secondary |
| Debugging Workflow (lines 222-250) | **Move** to `03-dev-workflow.md` | Observability, not evaluation |
| Best Practices checklists (lines 252-271) | **Replace** with EDD checklist | New checklist is more actionable |

## Dependencies

- `openevals` — Multi-turn simulation and LLM-as-judge (Tier 2 only)
- `agentevals` — Trajectory evaluation: match + LLM judge
- `langsmith` — Optional: experiments, tracing, dataset sync
- `pytest` — Required: test runner for local eval execution

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| **Skill + References** | | |
| `skills/evals/SKILL.md` | **Rewrite** | Complete EDD workflow (7 sections) |
| `skills/evals/references/01-scenarios.md` | **Create** | Scenario design, JTBD templates, dataset format |
| `skills/evals/references/02-evaluators.md` | **Create** | Evaluator catalog with decision tree |
| `skills/evals/references/03-dev-workflow.md` | **Create** | Inner loop, snapshots, CI, failure UX, trace mining |
| **Agents** | | |
| `agents/eval-designer.md` | **Create** | Agent: JTBD interview, scenario generation, dataset scaffolding |
| `agents/eval-runner.md` | **Create** | Agent: run evals, manage snapshots, failure analysis |
| **Commands** | | |
| `commands/design-evals.md` | **Create** | Command: `/design-evals` — scaffold eval suite from JTBD |
| `commands/eval.md` | **Create** | Command: `/eval` — run evals (default/smoke/full/report/diagnose) |
| `commands/add-scenario.md` | **Create** | Command: `/add-scenario` — add single scenario interactively |
| `commands/eval-status.md` | **Create** | Command: `/eval-status` — dataset health dashboard |
| `commands/eval-update.md` | **Create** | Command: `/eval-update` — review and accept/reject changed snapshots |
| **Plugin manifest** | | |
| `plugin.json` | **Update** | Register new agents and commands |

## Implementation Order

1. `SKILL.md` — Main skill with complete EDD flow (knowledge base for agents)
2. `references/01-scenarios.md` — Templates and dataset format
3. `references/02-evaluators.md` — Evaluator catalog
4. `references/03-dev-workflow.md` — Dev workflow and CI
5. `agents/eval-designer.md` — Agent that powers /design-evals and /add-scenario
6. `agents/eval-runner.md` — Agent that powers /eval and /eval-update
7. `commands/design-evals.md` — Entry point command
8. `commands/eval.md` — Daily driver command
9. `commands/add-scenario.md` — Incremental scenario addition
10. `commands/eval-status.md` — Dashboard command
11. `commands/eval-update.md` — Snapshot review command
12. `plugin.json` — Register everything

## Verification Checklist

After implementation:

### Skill & References
- [ ] Skill guides user from JTBD to functional dataset (with or without existing agent)
- [ ] All code examples use correct APIs (openevals, agentevals, langsmith, pytest)
- [ ] DeepAgent examples use `create_deep_agent` with correct API
- [ ] Recommended model is `anthropic:claude-sonnet-4-5-20250929`
- [ ] There is a complete E2E example a user can copy and run
- [ ] Evaluators cover: trajectory match, LLM-as-judge, custom code, routing
- [ ] Local-first: everything works without LangSmith
- [ ] Snapshot testing flow is documented with directory structure
- [ ] Failure UX has 3 progressive levels
- [ ] Hierarchical multi-agent evaluation is covered
- [ ] Cross-references to other skills (quickstart, patterns, evolution) are correct
- [ ] All content is in English

### Agents
- [ ] `eval-designer` interviews user about JTBD and produces valid scenario YAML
- [ ] `eval-designer` reads existing agent code to inform scenario suggestions
- [ ] `eval-designer` scaffolds evals/ directory on first run
- [ ] `eval-designer` can add single scenarios incrementally
- [ ] `eval-runner` loads local datasets and runs scenarios
- [ ] `eval-runner` manages snapshots (create, compare, update)
- [ ] `eval-runner` reports with progressive failure UX
- [ ] `eval-runner` supports hierarchical multi-agent evaluation

### Commands
- [ ] `/design-evals` works for greenfield and existing agents
- [ ] `/eval` default mode (snapshot) is fast and free
- [ ] `/eval --smoke` runs only tagged subset
- [ ] `/eval --full` runs Tier 2 simulated users
- [ ] `/eval --report` shows trajectory diff
- [ ] `/eval --diagnose` provides LLM analysis with suggestions
- [ ] `/add-scenario` adds to existing dataset interactively
- [ ] `/add-scenario --from-trace` converts production trace to scenario (local files or LangSmith)
- [ ] `/eval-status` shows dataset health without running evals (reads `.results/latest.json`)
- [ ] `/eval-update` lets dev accept/reject changed snapshots interactively

### Gap Resolutions
- [ ] Agent discovery: `conftest.py` with `create_agent()` convention, auto-detected by `/design-evals`
- [ ] Tool mocking: `mock_responses` in scenario YAML, runner intercepts tool calls and returns mocks
- [ ] `interrupt_on`: `approval: approve/reject` steps in scenario YAML, runner auto-responds
- [ ] Snapshot granularity: 3 modes (structural/strict/semantic) configured in `eval-config.yaml`
- [ ] Results persistence: `evals/.results/latest.json` + history, gitignored
- [ ] Multi-agent layout: per-agent `evals/` + top-level E2E `evals/`, scaffolded by `/design-evals`
- [ ] Local traces: trace middleware saves to `traces/` dir, `--from-trace` accepts local files or LangSmith run IDs
- [ ] Cost estimates: table in Quick Reference with per-scenario and per-suite costs by tier

### Cross-Skill Integration
- [ ] tool-design: Operation Levels → testing strategies documented, `pending_confirmation` scenario template, idempotency evaluator
- [ ] patterns: `signal_task_complete` assertion pattern, `interrupt_on` testing, escalation boundary scenarios, `ToolRuntime` multi-tenant testing
- [ ] evolution: Level 4 metrics linked to eval metrics, L3→L4 migration references `/design-evals`, red flags → metric thresholds, refactoring regression workflow
- [ ] architecture: bounded contexts → hierarchical eval units, token economy → metric baselines, topology → tracing depth
- [ ] quickstart: "Next Steps" references `/design-evals`, chat console positioned as precursor to automated evals
- [ ] **Bidirectional**: each referenced skill updated with backlink to evals (can be done in a follow-up PR)
