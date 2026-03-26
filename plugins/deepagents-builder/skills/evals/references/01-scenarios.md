# Scenario Design & Dataset Creation

Detailed reference for designing eval scenarios, structuring datasets, and converting JTBD into executable test suites.

## JTBD → Scenario Mapping

### Template: Narrative → Structured

Start with a narrative job description, then convert to structured YAML.

**Step 1: Identify the Job**
```
Job: [What the user wants to accomplish]
Actor: [Who is performing the action]
Trigger: [What the user says to start]
```

**Step 2: Map Scenarios**

For each job, define at minimum:
- 1 happy path (the golden flow)
- 1 edge case (unusual but valid input)
- 1 failure scenario (what should NOT happen)

**Step 3: Structure as YAML**

```yaml
- job: [Job statement]
  actor: [Actor]
  trigger: "[Trigger phrase]"
  scenarios:
    - name: [snake_case_name]
      tags: [smoke, e2e]
      turns:
        - user: "[User message]"
        - expected_tools: [tool_name]
          mock_responses:
            tool_name:
              key: value
        - user: "[Follow-up message]"
        - expected_tools: [another_tool]
          mock_responses:
            another_tool:
              key: value
      success_criteria:
        - judge_criteria: "Agent confirmed the expected outcome"
        - max_turns: N
```

### Assertion Types: When to Use Each

> **Default to `judge_criteria`.** Agents reformulate everything — a scenario expecting `response_contains: ["shipped"]` will break when the agent says "Your package is on its way." Use `response_contains` only for exact values like IDs, reference numbers, and URLs that the agent must echo verbatim.

| Assertion | Use when | Example |
|-----------|----------|---------|
| `judge_criteria` **(default)** | Checking semantic meaning of response. Agent may rephrase. | `"Agent confirmed the refund and gave reference number"` |
| `response_contains` | Checking for exact values that cannot be rephrased (IDs, URLs, tracking codes) | `["REF-ABC123", "1Z999AA"]` |
| `not_contains` | Deterministic check that exact forbidden terms are absent | `["password", "SSN", "credit_card"]` |
| `security_judge_criteria` | Semantic check that forbidden concepts are absent even when paraphrased | `"Agent must not reveal internal system architecture"` |
| `no_tools` | Agent must not call certain tools | `[delete_account, escalate_to_human]` |
| `max_turns` | Agent must complete within turn budget | `5` |
| `signal_task_complete` | Agent must explicitly signal completion | `true` |

`judge_criteria` uses a cheap LLM (e.g., `gpt-4.1-mini` or `claude-haiku`) to evaluate whether the agent's response satisfies the criteria. Cost: ~$0.001-0.005 per assertion. Use `temperature=0` for reproducibility.

## Full E2E Example: Support Agent

Three JTBD → 8 scenarios for a customer support agent.

### JTBD 1: Track Order

```yaml
- job: Track order status
  actor: Customer
  trigger: "Where is my order?"
  scenarios:
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
      success_criteria:
        - judge_criteria: "Agent informed the user their order has been shipped and provided tracking info"
        - response_contains: ["1Z999AA10123456784"]  # Tracking number must be exact
        - max_turns: 2

    - name: track_order_not_found
      tags: [edge_case]
      turns:
        - user: "Where is my order #9999?"
        - expected_tools: [lookup_order]
          mock_responses:
            lookup_order:
              error: "not_found"
              message: "No order found with ID #9999"
      success_criteria:
        - judge_criteria: "Agent informed the user that the order was not found and asked for alternative information"
        - no_tools: [update_order, process_refund]

    - name: track_order_no_id
      tags: [edge_case]
      turns:
        - user: "Where is my order?"
      success_criteria:
        - judge_criteria: "Agent asked the user to provide their order number"
        - no_tools: [lookup_order]
```

### JTBD 2: Request Refund

```yaml
- job: Request a refund
  actor: Customer
  trigger: "I want a refund"
  scenarios:
    - name: refund_happy_path
      tags: [smoke, e2e]
      turns:
        - user: "I want a refund for order #1234"
        - expected_tools: [lookup_order]
          mock_responses:
            lookup_order:
              status: "delivered"
              total: 49.99
              refund_eligible: true
        - expected_tools: [process_refund]
          mock_responses:
            process_refund:
              status: "pending_confirmation"
              amount: 49.99
          interrupt: true
        - approval: approve
        - expected_tools: [confirm_refund]
          mock_responses:
            confirm_refund:
              status: "completed"
              reference: "REF-ABC123"
      success_criteria:
        - judge_criteria: "Agent confirmed the refund was processed successfully"
        - response_contains: ["REF-ABC123"]  # Reference number must be exact
        - signal_task_complete: true

    - name: refund_rejected_by_human
      tags: [edge_case]
      turns:
        - user: "Refund order #5678"
        - expected_tools: [lookup_order]
          mock_responses:
            lookup_order:
              status: "delivered"
              total: 299.99
              refund_eligible: true
        - expected_tools: [process_refund]
          mock_responses:
            process_refund:
              status: "pending_confirmation"
              amount: 299.99
          interrupt: true
        - approval: reject
      success_criteria:
        - judge_criteria: "Agent informed the user that the refund could not be processed due to rejection"
        - no_tools: [confirm_refund]
```

### JTBD 3: Change Subscription

```yaml
- job: Change subscription plan
  actor: Subscriber
  trigger: "Change my plan"
  scenarios:
    - name: upgrade_plan_happy_path
      tags: [e2e]
      turns:
        - user: "Upgrade me to the Pro plan"
        - expected_tools: [get_current_plan]
          mock_responses:
            get_current_plan:
              plan: "Basic"
              price: 9.99
        - expected_tools: [change_plan]
          mock_responses:
            change_plan:
              status: "pending_confirmation"
              new_plan: "Pro"
              new_price: 29.99
              prorated_charge: 15.00
          interrupt: true
        - approval: approve
        - expected_tools: [confirm_plan_change]
          mock_responses:
            confirm_plan_change:
              status: "completed"
              effective_date: "2026-02-19"
      success_criteria:
        - judge_criteria: "Agent confirmed the plan was upgraded to Pro"
        - max_turns: 5

    - name: downgrade_not_available
      tags: [edge_case]
      turns:
        - user: "Switch me to the Free plan"
        - expected_tools: [get_current_plan]
          mock_responses:
            get_current_plan:
              plan: "Basic"
              price: 9.99
        - expected_tools: [change_plan]
          mock_responses:
            change_plan:
              error: "downgrade_restricted"
              message: "Free plan not available for accounts with active integrations"
              suggestions:
                - "Remove integrations first"
                - "Contact support for exceptions"
      success_criteria:
        - judge_criteria: "Agent explained that the Free plan is not available due to active integrations and suggested alternatives"
```

## Dataset File Format

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["job", "actor", "trigger", "scenarios"],
    "properties": {
      "job": { "type": "string" },
      "actor": { "type": "string" },
      "trigger": { "type": "string" },
      "scenarios": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["name", "turns"],
          "properties": {
            "name": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
            "tags": { "type": "array", "items": { "type": "string" } },
            "history": {
              "type": "array",
              "description": "Prior conversation turns that set up context for this scenario",
              "items": {
                "type": "object",
                "properties": {
                  "role": { "enum": ["user", "assistant"] },
                  "content": { "type": "string" }
                },
                "required": ["role", "content"]
              }
            },
            "turns": {
              "type": "array",
              "items": {
                "oneOf": [
                  { "type": "object", "properties": { "user": { "type": "string" } }, "required": ["user"] },
                  {
                    "type": "object",
                    "properties": {
                      "expected_tools": { "type": "array", "items": { "type": "string" } },
                      "mock_responses": { "type": "object" },
                      "interrupt": { "type": "boolean" }
                    },
                    "required": ["expected_tools"]
                  },
                  {
                    "type": "object",
                    "properties": { "approval": { "enum": ["approve", "reject"] } },
                    "required": ["approval"]
                  }
                ]
              }
            },
            "success_criteria": {
              "type": "array",
              "items": {
                "oneOf": [
                  { "type": "object", "properties": { "judge_criteria": { "type": "string" } } },
                  { "type": "object", "properties": { "response_contains": { "type": "array", "items": { "type": "string" } } } },
                  { "type": "object", "properties": { "not_contains": { "type": "array", "items": { "type": "string" } } } },
                  { "type": "object", "properties": { "security_judge_criteria": { "type": "string" } } },
                  { "type": "object", "properties": { "max_turns": { "type": "integer" } } },
                  { "type": "object", "properties": { "no_tools": { "type": "array", "items": { "type": "string" } } } },
                  { "type": "object", "properties": { "signal_task_complete": { "type": "boolean" } } }
                ]
              }
            },
            "simulated_user_prompt": { "type": "string" },
            "max_turns": { "type": "integer" }
          }
        }
      }
    }
  }
}
```

## Scripted User Patterns

### Happy Path

Linear flow, all tools succeed, user is cooperative.

```yaml
turns:
  - user: "Clear request with all needed info"
  - expected_tools: [main_tool]
    mock_responses:
      main_tool: { status: "success", data: "..." }
```

### Edge Case

Unusual but valid input that tests boundary conditions.

```yaml
turns:
  - user: "Request with missing or ambiguous info"
  - expected_tools: []  # Agent should ask for clarification, not call tools
success_criteria:
  - judge_criteria: "Agent asked the user for clarification or missing information"
```

### Error Handling

Tool returns an error — agent should recover gracefully.

```yaml
turns:
  - user: "Normal request"
  - expected_tools: [some_tool]
    mock_responses:
      some_tool:
        error: "service_unavailable"
        message: "External service is down"
        suggestions:
          - "Try again in a few minutes"
          - "Use alternative_tool instead"
success_criteria:
  - judge_criteria: "Agent informed the user the service is unavailable and suggested trying again later"
  - no_tools: [dangerous_fallback_tool]
```

### Multi-Turn with Approval

Tests `interrupt_on` HITL flows with `approval` steps.

```yaml
turns:
  - user: "Request that requires approval"
  - expected_tools: [sensitive_tool]
    mock_responses:
      sensitive_tool:
        status: "pending_confirmation"
        details: { ... }
    interrupt: true
  - approval: approve  # or reject
  - expected_tools: [confirmation_tool]
    mock_responses:
      confirmation_tool: { status: "completed" }
```

## Conversation History (Multi-Turn Context)

The `history` field provides prior conversation turns that the agent needs to understand the current user message. The eval runner pre-loads these as the conversation state before executing the scenario's `turns`.

### When to Use `history`

- User message references something from a prior turn ("Actually, can you change...")
- User responds to an agent prompt ("Yes", "No", "Si dale")
- Scenario tests mid-conversation behavior, not conversation start
- **Rule of thumb**: If the user's first `turns` message would be ambiguous to a fresh agent, add `history`

### Example: Mid-Conversation Address Change

```yaml
- name: change_address_after_lookup
  tags: [e2e]
  history:
    - role: user
      content: "Where is my order #1234?"
    - role: assistant
      content: "Your order #1234 has been shipped via UPS. Tracking: 1Z999AA. ETA: Feb 21."
  turns:
    - user: "Actually, can you change the delivery address to 456 Oak Ave?"
    - expected_tools: [update_order]
      mock_responses:
        update_order:
          status: "pending_confirmation"
          changes: { address: "456 Oak Ave" }
      interrupt: true
    - approval: approve
  success_criteria:
    - judge_criteria: "Agent confirmed the address change to 456 Oak Ave"
```

### Example: Confirmation Response

```yaml
- name: cedula_verified
  tags: [e2e]
  history:
    - role: assistant
      content: "Tu cedula esta en el sistema. Quieres que la verifique?"
  turns:
    - user: "Si dale, verifica"
    - expected_tools: [verify_cedula]
      mock_responses:
        verify_cedula:
          status: "verified"
          name: "Juan Perez"
  success_criteria:
    - judge_criteria: "Agent confirmed the cedula was verified successfully"
```

Without `history`, the agent has no context for "Si dale, verifica" and may not know which tool to call.

## Simulated User Prompt Engineering (Tier 2)

For Tier 2 simulated users, write personas that produce realistic behavior:

```yaml
simulated_user_prompt: |
  You are a frustrated customer who ordered a laptop 3 weeks ago.
  The tracking says "in transit" but it hasn't moved in 5 days.
  You want answers and may ask for a refund if the issue isn't resolved.
  You are impatient but not rude.
  You have your order number: #7890.
```

**Tips**:
- Include emotional state (frustrated, confused, in a hurry)
- Provide context the user would have (order number, account info)
- Define escalation behavior (when the user gets more demanding)
- Keep it concise — 3-5 sentences

## Tool Mock Patterns

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
    suggestions:
      - "Check the order number"
      - "Try searching by email"
```

### `pending_confirmation` Flow

Tests the [Delegated Confirmations pattern](../../tool-design/SKILL.md) (Principle 9):

```yaml
mock_responses:
  transfer_funds:
    status: "pending_confirmation"
    details:
      from: "ACC-12345678"
      to: "ACC-87654321"
      amount: { value: 500.00, currency: "USD" }
    message_for_user: "Please confirm: Transfer $500.00 from checking to savings?"
```

## Boundary Testing from Escalation Criteria

Test exact thresholds defined in the agent's escalation criteria ([Patterns — Escalation](../../patterns/SKILL.md)):

```yaml
# Refund $99 → auto-approve (under threshold)
- name: refund_under_threshold
  tags: [boundary]
  turns:
    - user: "Refund my order, it was $99"
    - expected_tools: [process_refund]
      mock_responses:
        process_refund: { status: "completed", amount: 99.00 }
  success_criteria:
    - no_tools: [escalate_to_human]

# Refund $101 → escalate (over threshold)
- name: refund_over_threshold
  tags: [boundary]
  turns:
    - user: "Refund my order, it was $101"
    - expected_tools: [escalate_to_human]
  success_criteria:
    - judge_criteria: "Agent escalated to a human supervisor for review"
```

## Multi-Tenant Test Scenarios

Test access control using `ToolRuntime`/`context_schema` ([Patterns — ToolRuntime](../../patterns/SKILL.md)):

```yaml
# Same scenario, different user contexts
- name: access_own_account
  tags: [security]
  context:
    user_id: "user_123"
    account_id: "ACC-12345678"
  turns:
    - user: "Show my balance"
    - expected_tools: [get_account_balances]
      mock_responses:
        get_account_balances: { balance: 1500.00 }

- name: access_other_account_denied
  tags: [security]
  context:
    user_id: "user_123"
    account_id: "ACC-99999999"
  turns:
    - user: "Show balance for ACC-99999999"
    - expected_tools: [get_account_balances]
      mock_responses:
        get_account_balances:
          error: "access_denied"
          message: "You don't have access to this account"
  success_criteria:
    - judge_criteria: "Agent informed the user they don't have access to the requested account"
```

## Trigger Phrase → Scenario Derivation

Use the trigger phrases from your tool docstrings ([Tool Design — Principle 1](../../tool-design/SKILL.md)) to generate scenarios:

```python
# Tool docstring says: Trigger phrases: "check my balance", "how much do I have"
# → Generate scenarios for each trigger phrase:
```

```yaml
- name: trigger_check_balance
  tags: [tool_selection]
  turns:
    - user: "Check my balance"
    - expected_tools: [get_account_balances]

- name: trigger_how_much
  tags: [tool_selection]
  turns:
    - user: "How much do I have?"
    - expected_tools: [get_account_balances]
```

This tests that the agent's tool selection accuracy matches the designed trigger phrases.

## Anti-Patterns

### Too Simple

```yaml
# BAD: Single turn, no edge cases, no failure scenarios
- name: lookup_order
  turns:
    - user: "Look up order"
    - expected_tools: [lookup_order]
```

Missing: What if the order doesn't exist? What if the user doesn't provide an ID? What happens after lookup?

### Too Coupled to Implementation

```yaml
# BAD: Testing exact tool arguments instead of outcomes
success_criteria:
  - tool_args_exact: { "account_id": "ACC-12345678", "limit": 10, "offset": 0 }
```

Better: Test that the right tool was called and the response contains expected info. Implementation details (arg values) change frequently.

### Missing Failure Scenarios

```yaml
# BAD: Only happy paths, no error handling
scenarios:
  - name: track_order
  - name: refund_order
  - name: change_plan
```

Add failure scenarios: tool errors, invalid input, escalation, rejection flows.

### Literal Assertions on Rephrased Content

```yaml
# BAD: Agent will say "Your package is on its way" not "shipped"
success_criteria:
  - response_contains: ["shipped"]

# GOOD: Semantic check for meaning, literal check only for exact values
success_criteria:
  - judge_criteria: "Agent informed user the order has been shipped"
  - response_contains: ["1Z999AA10123456784"]  # Tracking number must be exact
```

Use `response_contains` only for values the agent must echo verbatim (IDs, reference numbers, tracking codes, URLs).

### No Diversity in User Behavior

```yaml
# BAD: All users say the exact same thing
- user: "Track my order #1234"
- user: "Track my order #5678"
- user: "Track my order #9012"
```

Better: Vary phrasing ("Where's my package?", "When will order #1234 arrive?", "I need to check on a delivery"). This tests tool selection robustness.
