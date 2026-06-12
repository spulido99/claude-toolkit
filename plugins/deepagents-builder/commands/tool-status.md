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

### Step 2: Score Each Tool (11-Principle Checklist)

The **[Tool Quality Checklist](../skills/tool-design/references/tool-quality-checklist.md)** is the authoritative source for what each principle means and which are critical — this step does not restate the principles. It only encodes the **static-analysis pass condition** that turns each principle into one point of the 0–10 score. If a principle's definition changes, update the checklist first, then sync the matching pass condition below.

For each tool, award one point per principle whose pass condition holds (static analysis, no execution needed):

| # | Principle | Static-analysis pass condition |
|---|-----------|--------------------------------|
| 1 | Semantic name & casing | Function name is not a bare `get_`/`post_`/`update_`/`delete_` prefix without a domain noun, **and** every parameter name is `snake_case` (flag camelCase like `installmentsQuantity` or Header-Case like `Incognia-Request-Token`) |
| 2 | Trigger phrases | Docstring contains "when the user says" or multiple quoted trigger phrases |
| 3 | Structured types | Money params use `dict` not `float`, with `value` as a decimal string (never IEEE-754 float); date params mention ISO format |
| 4 | Actionable errors | Error returns include `code` and `remediation` fields |
| 5 | Consistent terminology | Same param names across tools in the same domain (e.g. always `account_id`, not mixed) |
| 6 | Standard response | Returns a dict with `data` (plus `formatted` where data isn't trivially readable); no field duplicates another's content; responses that can grow have pagination/limit/truncation defaults |
| 7 | Tool graph | `available_actions` present where next steps are **state-dependent** (confirmation flows, conditional actions); terminal or simple-read tools pass without it |
| 8 | Operation level | Docstring contains `Operation Level:`; MCP definitions also carry matching `annotations` (`readOnlyHint`/`destructiveHint`/`idempotentHint`) |
| 9 | Confirmation flow | Level 3+ tools return `pending_confirmation` **or** are covered by framework HITL (`interrupt_on`) — one layer, not both |
| 10 | Idempotency | Level 3+ tools accept an `idempotency_key` parameter, generated server-side when omitted and returned in the response |
| 11 | Secure parameters | No parameter is caller identity or a credential: fails if any parameter name is `user_id`, `customer_id`, `tenant_id`, or matches `*token*`, `*key*`, `*secret*`, `*password*`, `*credential*` (these must be framework-injected, never LLM-controllable) |

Score: count of passing checks out of 11.

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
  {domain1}:  {n} tools | Quality: {avg}/11 | L1:{n} L2:{n} L3:{n} L4:{n}
  {domain2}:  {n} tools | Quality: {avg}/11 | L1:{n} L2:{n}

Per-Tool Scores:
  ✓ {tool_name}          11/11  [{n} eval scenarios]
  ✓ {tool_name}          10/11  [{n} eval scenarios]
  ~ {tool_name}           7/11  [0 eval scenarios] ⚠
  ✗ {tool_name}           3/11  [0 eval scenarios] ⚠

Legend: ✓ = 9+/11 (pass)  ~ = 6-8/11 (warning)  ✗ = <6/11 (fail)

Eval Coverage: {n}/{total} tools have scenarios ({missing} missing)
⚠ Tools without evals: {list}
  → Run /add-scenario to add coverage

Manual review (not scored — catalog-level judgment): Granularity · Bounded Contexts · Parity

Overall: {pct}% tools pass (≥ 9/11) | {pct}% have eval coverage
```

If any tools score below 9/11, add specific improvement suggestions:

```
Improvement Suggestions:
  {tool_name} (7/11):
    - Missing: Trigger phrases in docstring (Principle 2)
    - Missing: available_actions in response (Principle 7)
    - Missing: Operation level declaration (Principle 8)
    - Risk:    'user_id' is a parameter — inject via framework (Principle 11)
```

### Step 5: Flag Catalog-Level Dimensions (Not Scored)

The 11-principle score is **static, per-tool analysis only**. Three catalog-level principles require judgment and are deliberately excluded from the score — always surface them for manual review so the dashboard never reads as "everything is covered":

- **Granularity** — are any two tools always called in sequence where the intermediate result has no standalone use (merge candidate)? Does any tool bundle steps the agent should compose, skip, or retry (split candidate)?
- **Bounded Contexts** — any domain with more than 10 tools?
- **Parity** — any UI action with no corresponding tool?

These map to the [Catalog-Level Design](../skills/tool-design/SKILL.md#catalog-level-design) section of the skill.

## References

- **[AI-Friendly Tool Design](../skills/tool-design/SKILL.md)** — The 11 principles this dashboard scores against.
- **[Tool Quality Checklist](../skills/tool-design/references/tool-quality-checklist.md)** — Full, authoritative quality verification checklist.
