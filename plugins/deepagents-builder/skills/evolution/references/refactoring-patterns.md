# Refactoring Patterns for Agent Evolution

Patterns for evolving deep agent architectures as requirements change.

## When to Refactor

**Triggers:**
- Cognitive load > 30 tools per agent
- Subagent utilization < 20% (rarely used)
- Context overflow despite subagents
- New business capabilities emerging
- Frequent tool selection errors
- Slow task execution

## Pattern 1: Extract Platform

**Problem:** Main agent overloaded with tool management

**Before:**
```python
agent = create_deep_agent(
    tools=[
        # 15 data tools
        db_query, file_read, api_call, ...
        # 12 analysis tools
        calculate, visualize, report, ...
        # 18 communication tools
        email, slack, sms, ...
    ]
)
```

**After:**
```python
agent = create_deep_agent(
    tools=[coordination_tools],
    subagents=[
        {"name": "data-platform", "tools": [db, file, api]},
        {"name": "analysis-platform", "tools": [calc, viz, report]},
        {"name": "comms-platform", "tools": [email, slack, sms]}
    ]
)
```

**Steps:**
1. Group tools by capability (data, analysis, communication)
2. Create platform subagent for each group
3. Test tool delegation
4. Measure cognitive load reduction

## Pattern 2: Split Bounded Context

**Problem:** Single subagent serving multiple domains with conflicting vocabularies

**Before:**
```python
customer_agent = {
    "name": "customer-handler",
    "tools": [
        support_kb, ticket_system,  # Support context
        lead_scoring, crm_update,   # Sales context
        email_campaigns, segments    # Marketing context
    ]
}
```

**After:**
```python
subagents = [
    {
        "name": "customer-support",
        "system_prompt": "In support: 'customer' = person with issue...",
        "tools": [support_kb, ticket_system]
    },
    {
        "name": "sales-operations",
        "system_prompt": "In sales: 'customer' = prospect or lead...",
        "tools": [lead_scoring, crm_update]
    },
    {
        "name": "marketing-engagement",
        "system_prompt": "In marketing: 'customer' = segment member...",
        "tools": [email_campaigns, segments]
    }
]
```

**Steps:**
1. Identify vocabulary conflicts
2. Map to business capabilities
3. Define bounded contexts
4. Split subagent
5. Update routing logic

## Pattern 3: Merge Underutilized Subagents

**Problem:** Too many subagents, each used rarely

**Before:**
```python
subagents = [
    {"name": "email-sender", "tools": [send_email]},  # Used 2% of time
    {"name": "slack-poster", "tools": [post_slack]},  # Used 3% of time
    {"name": "sms-sender", "tools": [send_sms]},      # Used 1% of time
]
```

**After:**
```python
subagents = [
    {
        "name": "notification-platform",
        "tools": [send_email, post_slack, send_sms]
    }
]
```

**Steps:**
1. Measure subagent utilization
2. Identify low-usage subagents (< 10%)
3. Group by capability
4. Merge into single platform
5. Monitor cognitive load

## Pattern 4: Promote to Main Agent

**Problem:** Subagent used in 90%+ of tasks

**Before:**
```python
agent = create_deep_agent(
    subagents=[
        {"name": "core-processor", "tools": [...]},  # Used 95% of time
        {"name": "occasional-helper", "tools": [...]}
    ]
)
```

**After:**
```python
agent = create_deep_agent(
    tools=[...],  # core-processor tools promoted
    subagents=[
        {"name": "occasional-helper", "tools": [...]}
    ]
)
```

**Steps:**
1. Track subagent usage
2. Identify always-used subagent
3. Promote tools to main agent
4. Test performance

## Pattern 5: Extract Specialist

**Problem:** Platform subagent has one complex, specialized tool

**Before:**
```python
data_platform = {
    "name": "data-platform",
    "tools": [
        simple_query,
        simple_transform,
        complex_ml_model,  # Requires specialized expertise
        simple_export
    ]
}
```

**After:**
```python
subagents = [
    {
        "name": "data-platform",
        "tools": [simple_query, simple_transform, simple_export]
    },
    {
        "name": "ml-specialist",
        "description": "Complex ML modeling and prediction",
        "tools": [complex_ml_model, model_training, model_eval]
    }
]
```

**Steps:**
1. Identify tools requiring deep expertise
2. Extract into specialist subagent
3. Define clear delegation criteria
4. Document when to use specialist vs. platform

## Pattern 6: Add Enabling Agent

**Problem:** Repeated capability gaps, learning curve

**Before:**
```python
# Main agent repeatedly struggles with research methodology
agent = create_deep_agent(
    tools=[research_tools]  # Used incorrectly
)
```

**After:**
```python
agent = create_deep_agent(
    tools=[research_tools],
    subagents=[
        {
            "name": "research-advisor",
            "description": "Provides research methodology guidance",
            "system_prompt": "You teach research methods...",
            "tools": [methodology_guides, templates, examples]
        }
    ]
)
```

**Steps:**
1. Identify recurring skill gaps
2. Create enabling subagent
3. Use temporarily until capability established
4. Remove once no longer needed

## Pattern 7: Hierarchical Decomposition

**Problem:** Domain too complex for single level

**Before:**
```python
agent = create_deep_agent(
    subagents=[
        {"name": "operations", "tools": [50+ tools]}  # Too many
    ]
)
```

**After:**
```python
operations_agent = {
    "name": "operations",
    "tools": [coordination_tools],
    "subagents": [
        {"name": "inventory", "tools": [...]},
        {"name": "fulfillment", "tools": [...]},
        {"name": "shipping", "tools": [...]}
    ]
}

agent = create_deep_agent(
    subagents=[operations_agent, sales_agent, finance_agent]
)
```

**Steps:**
1. Identify overloaded subagent
2. Map sub-capabilities
3. Create nested structure
4. Define delegation rules

## Pattern 8: Sequential to Parallel

**Problem:** Independent tasks executed sequentially (slow)

**Before:**
```python
# Tasks executed one at a time
system_prompt = """
1. Research topic A
2. Research topic B  
3. Research topic C
4. Synthesize findings
"""
```

**After:**
```python
# Parallel execution with coordination
subagents = [
    {"name": "researcher-a", "description": "Research topic A"},
    {"name": "researcher-b", "description": "Research topic B"},
    {"name": "researcher-c", "description": "Research topic C"},
    {"name": "synthesizer", "description": "Combine all findings"}
]

# Orchestrator delegates A, B, C in parallel
# Then synthesizer combines results
```

**Steps:**
1. Identify independent subtasks
2. Create subagents for parallel work
3. Add synthesizer subagent
4. Measure time savings
5. ⚠️ WARNING: Ensure no conflicting decisions

## Pattern 9: Configuration Externalization

**Problem:** Hard to modify agent structure

**Before:**
```python
# Hardcoded structure
agent = create_deep_agent(
    subagents=[
        {"name": "agent1", ...},
        {"name": "agent2", ...}
    ]
)
```

**After:**
```python
# Configuration-driven
config = yaml.load("agent_config.yaml")

agent = create_deep_agent(
    model=config["model"],
    system_prompt=config["prompt"],
    subagents=[
        build_subagent(spec) for spec in config["subagents"]
    ]
)
```

**agent_config.yaml:**
```yaml
model: anthropic:claude-sonnet-4-20250514
prompt: You coordinate...
subagents:
  - name: data-platform
    tools: [db_query, file_read]
  - name: analysis-platform
    tools: [calculate, visualize]
```

**Steps:**
1. Extract configuration
2. Build factory functions
3. Version control config
4. Enable A/B testing

## Refactoring Checklist

Before refactoring:
- [ ] Measure current performance (baseline)
- [ ] Document current structure
- [ ] Identify specific problem
- [ ] Choose appropriate pattern

During refactoring:
- [ ] Make incremental changes
- [ ] Test after each change
- [ ] Keep old version for rollback
- [ ] Update documentation

After refactoring:
- [ ] Measure new performance
- [ ] Compare to baseline
- [ ] Update team knowledge
- [ ] Monitor for regressions

## Migration Strategy

**Recommended: Incremental replacement.** Add new subagents alongside existing ones, route traffic gradually, and remove old ones when confident. Avoid rebuilding the entire architecture at once.

## Testing Refactored Agents

```python
def test_refactored_agent():
    # Same inputs should produce similar outputs
    old_result = old_agent.invoke(test_input)
    new_result = new_agent.invoke(test_input)
    
    assert semantic_similarity(old_result, new_result) > 0.8
    assert new_result.tokens < old_result.tokens  # Efficiency
    assert new_result.time < old_result.time       # Performance
```

## Common Pitfalls

❌ Refactoring without metrics
❌ Big bang rewrite
❌ Not testing after changes
❌ Optimizing before profiling
❌ Adding complexity unnecessarily
❌ Not documenting changes
❌ No rollback plan

## Success Metrics

Track these before and after refactoring:

- **Token efficiency**: Tokens per successful task
- **Time to completion**: Seconds per task
- **Success rate**: Successful tasks / total
- **Cognitive load**: Tools per agent
- **Utilization**: Subagent usage frequency
- **Error rate**: Failed tasks / total

Target improvements:
- 20-40% reduction in tokens
- 30-50% reduction in time
- Maintain or improve success rate
