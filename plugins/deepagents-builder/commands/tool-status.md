---
name: tool-status
description: Show tool catalog quality dashboard — counts by domain, quality scores per tool, principle compliance, and eval coverage.
allowed-tools:
  - Read
  - Glob
  - Grep
argument-hint: ""
---

# Tool Quality Dashboard

Display a quality dashboard for the tool catalog. Lightweight command — no agent needed, static analysis only.

## Workflow

### Step 1: Discover Tools

Find all tools in the project:

1. Search for `@tool` decorated functions in `domains/*/tools.py`, `tools.py`, `*_tools.py`
2. Search for MCP tool definitions in `*.json` files (look for `"inputSchema"`)
3. For each tool, extract:
   - **Name**: Function name or JSON `name` field
   - **Domain**: Parent directory or inferred from name prefix
   - **Operation level**: From docstring `Operation Level: N` pattern
   - **Parameter count**: Number of parameters/properties
   - **Docstring**: Full docstring content

If no tools found:
```
No tools found in this project.
→ Run /design-tools to create a tool catalog.
```
Exit.

### Step 2: Score Each Tool (10-Principle Checklist)

For each tool, check these patterns statically (no execution needed):

| # | Principle | Check | Pass Condition |
|---|-----------|-------|----------------|
| 1 | Semantic name | Function name pattern | Not bare `get_`, `post_`, `update_`, `delete_` prefix without domain |
| 2 | Trigger phrases | Docstring content | Contains "when the user says" or multiple quoted trigger phrases |
| 3 | Structured types | Parameter types | Money params use `dict` not `float`; dates mention ISO format |
| 4 | Actionable errors | Return statements | Error returns include `code` and `remediation` fields |
| 5 | Consistent terminology | Cross-tool comparison | Same param names across tools in same domain (e.g., always `account_id` not mixed) |
| 6 | Standard response | Return structure | Returns dict with `data`, `formatted`, `available_actions`, `message_for_user` |
| 7 | Tool graph | available_actions | `available_actions` present in return value |
| 8 | Operation level | Docstring declaration | Docstring contains `Operation Level:` |
| 9 | Confirmation flow | Return for L3+ | Level 3+ tools return `pending_confirmation` |
| 10 | Idempotency | Parameters for L3+ | Level 3+ tools accept `idempotency_key` parameter |

Score: count of passing checks out of 10.

### Step 3: Check Eval Coverage (EDD Integration)

1. Search for `evals/datasets/*.yaml` and `evals/datasets/*.json`
2. If eval datasets exist:
   - For each scenario, check `expected_tools` field
   - Map each tool to the count of scenarios that reference it
3. If no eval datasets: note that eval coverage is unknown

### Step 4: Display Dashboard

```
═══ Tool Quality Dashboard ═══

Catalog: N tools across M domains

Domain Breakdown:
  {domain1}:  {n} tools | Quality: {avg}/10 | L1:{n} L2:{n} L3:{n} L4:{n}
  {domain2}:  {n} tools | Quality: {avg}/10 | L1:{n} L2:{n}

Per-Tool Scores:
  ✓ {tool_name}          10/10  [{n} eval scenarios]
  ✓ {tool_name}           9/10  [{n} eval scenarios]
  ~ {tool_name}           7/10  [0 eval scenarios] ⚠
  ✗ {tool_name}           3/10  [0 eval scenarios] ⚠

Legend: ✓ = 8+/10 (pass)  ~ = 5-7/10 (warning)  ✗ = <5/10 (fail)

Eval Coverage: {n}/{total} tools have scenarios ({missing} missing)
⚠ Tools without evals: {list}
  → Run /add-scenario to add coverage

Overall: {pct}% tools pass (≥ 8/10) | {pct}% have eval coverage
```

If any tools score below 8/10, add specific improvement suggestions:

```
Improvement Suggestions:
  {tool_name} (7/10):
    - Missing: Trigger phrases in docstring (Principle 2)
    - Missing: available_actions in response (Principle 7)
    - Missing: Operation level declaration (Principle 8)
```
