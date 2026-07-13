# Refactoring Patterns for Agent Evolution

Patterns for evolving deep agent architectures as requirements change.

**Ordering rule (the cure ladder):** exhaust the cheap rungs inside the single agent first — (1) tool design (consolidate/rename), (2) disclosure (tool search + skills, Pattern 0) — and extract subagents (Patterns 1, 5, 7) only for **read-only, parallelizable** work whose episode value pays the ~15x multi-agent token overhead. Never split an agent because the catalog grew or the horizon is long (long horizon → summarization).

## When to Refactor

**Triggers:**
- 10+ tools (or >10k tokens of definitions) without tool search/skills
- Overlapping tool names/descriptions (frequent tool selection errors)
- Coupled writes fragmented across subagents
- Subagent utilization < 20% (rarely used)
- Context overflow (fix with summarization/disclosure, not splitting)
- New business capabilities emerging
- Slow task execution

## Pattern 0: Adopt Disclosure (Tool Search + Skills) — first rung

**Problem:** Large catalog with every definition loaded up front; tool selection degrading

**Before:**
```python
agent = create_deep_agent(
    tools=[t1, t2, ..., t25]  # all definitions in context every turn
)
```

**After:**
```python
agent = create_deep_agent(
    tools=[t1, t2, ..., t25],  # same single agent — writes stay in one thread
    middleware=[
        # No native tool search in deepagents 0.6 — compose it:
        # ProviderToolSearchMiddleware(),  # Anthropic/OpenAI server-side
        LLMToolSelectorMiddleware(),       # provider-agnostic fallback
    ],
    skills=["./skills/"],  # bounded contexts as skills, progressive disclosure
)
```

**Steps:**
1. Tool design first: consolidate/rename overlapping tools
2. Add tool search via `middleware=`; keep built-ins (filesystem, task, todos) non-deferred
3. Package bounded contexts as skills (SKILL.md per domain); protect the skills library with `permissions` deny-write
4. Measure tool-selection accuracy and tokens per episode

## Pattern 1: Extract Read-Only Platform

**Problem:** Heavy **read-only, parallelizable** work (research, data gathering) running inline in the frontal agent — after Pattern 0 has been applied and the episode value pays the ~15x overhead

**Before:**
```python
agent = create_deep_agent(
    tools=[
        # action/write tools (stay in the frontal agent)
        send_email, update_record, ...
        # heavy read-only research tools
        web_search, read_docs, market_data, ...
    ]
)
```

**After:**
```python
agent = create_deep_agent(
    tools=[send_email, update_record],  # writes stay in the frontal agent
    subagents=[
        {"name": "research-worker", "tools": [web_search, read_docs]},   # read-only
        {"name": "market-worker", "tools": [market_data]},               # read-only
    ]
)
```

**Steps:**
1. Verify the delegable work is read-only and parallelizable (writes never leave the frontal agent)
2. Verify the episode value pays ~15x tokens
3. Create read-only workers returning concise summaries
4. Remember: workers share the filesystem/backend with the parent (no file quarantine)

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

## Pattern 7: Disclose Inside the Worker

**Problem:** A worker subagent's own catalog has grown large (10+ tools without disclosure)

**Before:**
```python
agent = create_deep_agent(
    subagents=[
        {"name": "research-worker", "tools": [many_read_only_tools]}  # no disclosure
    ]
)
```

**After:**
```python
agent = create_deep_agent(
    subagents=[
        {
            "name": "research-worker",
            "tools": many_read_only_tools,
            "middleware": [LLMToolSelectorMiddleware()],  # disclosure inside the worker
        }
    ]
)
```

**Steps:**
1. Apply the same cure ladder inside the worker: tool design → tool search
2. Do NOT nest more subagents to cope with catalog size — each nesting level multiplies token cost and latency
3. Nest workers only if genuinely independent read-only fan-out remains AND the episode value pays another ~15x hop

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
model: anthropic:claude-sonnet-4-5-20250929
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
- **Disclosure health**: catalog size vs tool search/skills mechanism in place
- **Utilization**: Subagent usage frequency
- **Error rate**: Failed tasks / total

Target improvements:
- 20-40% reduction in tokens
- 30-50% reduction in time
- Maintain or improve success rate
