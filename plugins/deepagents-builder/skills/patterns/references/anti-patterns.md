# Anti-Pattern Catalog

Common mistakes in deep agent design and how to fix them.

## Anti-Pattern 1: Parallel Decision-Making Subagents

**Symptom**: Multiple subagents work simultaneously and make incompatible choices.

**Example**:
```python
# ❌ BAD: Both work in parallel without coordination
subagents = [
    {"name": "ui-designer", "tools": [figma, sketch]},
    {"name": "frontend-dev", "tools": [react, vue]}
]
# Result: Designer chooses Material UI, dev implements Tailwind
```

**Fix**: Sequential execution or shared context
```python
# ✅ GOOD: Sequential with explicit handoff
subagents = [
    {
        "name": "design-lead",
        "description": "Defines design system FIRST, documents choices",
        "tools": [design_tools]
    },
    {
        "name": "implementation-engineer",
        "description": "Implements using documented design system",
        "tools": [code_tools],
        # Receives design decisions via file system
    }
]
```

## Anti-Pattern 2: God Agent

**Symptom**: Single agent with 50+ tools, poor tool selection.

**Example**:
```python
# ❌ BAD: Cognitive overload
main_agent = create_deep_agent(
    tools=[
        web_search, db_query, email, slack, jira, github,
        s3, lambda, ec2, rds, api_1, api_2, ... api_50
    ]
)
```

**Fix**: Platform subagents
```python
# ✅ GOOD: Grouped capabilities
agent = create_deep_agent(
    subagents=[
        {"name": "search-platform", "tools": [web, db, docs]},
        {"name": "communication-platform", "tools": [email, slack]},
        {"name": "devops-platform", "tools": [jira, github, aws]},
        {"name": "integration-platform", "tools": [api_1...api_50]}
    ]
)
```

## Anti-Pattern 3: Unclear Boundaries

**Symptom**: Overlapping responsibilities, confusion about routing.

**Example**:
```python
# ❌ BAD: Ambiguous descriptions
subagents = [
    {"name": "data-handler", "description": "Handles data"},
    {"name": "data-processor", "description": "Processes data"},
    {"name": "data-manager", "description": "Manages data"}
]
```

**Fix**: Clear, specific boundaries
```python
# ✅ GOOD: Distinct, measurable responsibilities
subagents = [
    {
        "name": "data-ingestion",
        "description": "Loads data from external sources (API, DB, files) into staging"
    },
    {
        "name": "data-transformation",
        "description": "Cleans, validates, and transforms data in staging to analytics format"
    },
    {
        "name": "data-quality",
        "description": "Monitors data quality metrics and generates alerts"
    }
]
```

## Anti-Pattern 4: Premature Decomposition

**Symptom**: Complex multi-agent system for simple problem.

**Example**:
```python
# ❌ BAD: Over-engineered for MVP
agent = create_deep_agent(
    subagents=[
        {"name": "planning-agent"},
        {"name": "execution-agent"},
        {"name": "monitoring-agent"},
        {"name": "reporting-agent"}
    ]
)
# Task: Send a weekly email report
```

**Fix**: Start simple
```python
# ✅ GOOD: Single agent sufficient
agent = create_deep_agent(
    tools=[query_data, generate_report, send_email]
)
# Add subagents only when cognitive load becomes problem
```

## Anti-Pattern 5: Leaky Abstractions

**Symptom**: Implementation details exposed in agent design.

**Example**:
```python
# ❌ BAD: Technical implementation focus
subagents = [
    {"name": "postgres-agent"},
    {"name": "redis-agent"},
    {"name": "s3-agent"}
]
```

**Fix**: Capability focus
```python
# ✅ GOOD: Business capability focus
subagents = [
    {"name": "user-data-platform", "tools": [postgres, redis]},
    {"name": "asset-storage-platform", "tools": [s3, cloudfront]}
]
```

## Anti-Pattern 6: Context Pollution

**Symptom**: Subagent context bleeds into main agent, defeating purpose.

**Example**:
```python
# ❌ BAD: Subagent returns massive context
def research_subagent(query):
    # Returns 50,000 tokens of research notes
    return massive_detailed_research
# Main agent context now polluted
```

**Fix**: Summarize at boundary
```python
# ✅ GOOD: Subagent returns concise summary
def research_subagent(query):
    # Conducts research, saves details to files
    save_to_file("/research/detailed_notes.md", full_research)
    # Returns only executive summary
    return create_summary(full_research, max_tokens=500)
```

## Anti-Pattern 7: Vocabulary Collision

**Symptom**: Same term means different things in different subagents.

**Example**:
```python
# ❌ BAD: "Revenue" has different meanings
marketing_agent: "Revenue = ad spend generating sales"
finance_agent: "Revenue = gross sales"
# Leads to miscommunication
```

**Fix**: Explicit bounded contexts
```python
# ✅ GOOD: Each context defines vocabulary
marketing_agent = {
    "prompt": """In marketing context:
    'Revenue' = attributed sales from campaign
    'Cost' = ad spend + overhead
    'ROI' = (Revenue - Cost) / Cost"""
}

finance_agent = {
    "prompt": """In finance context:
    'Revenue' = total gross sales
    'Cost' = COGS + operating expenses
    'Profit' = Revenue - Cost"""
}
```

## Anti-Pattern 8: One-Time Subagent

**Symptom**: Subagent created for single use, overhead not justified.

**Example**:
```python
# ❌ BAD: Subagent used once
calculator = {
    "name": "tax-calculator",
    "description": "Calculates sales tax",
    "tools": [tax_api]
}
# Used: 1 time
# Overhead: subagent spawning, context management
```

**Fix**: Direct tool use or library
```python
# ✅ GOOD: Simple tool in main agent
agent = create_deep_agent(
    tools=[calculate_tax]  # Simple function, no subagent needed
)
```

## Anti-Pattern 9: Implicit Dependencies

**Symptom**: Subagents depend on each other in undocumented ways.

**Example**:
```python
# ❌ BAD: Hidden dependency
data_loader  # Expects data in format from data_cleaner
data_cleaner  # Expects schema from data_validator
# Dependencies not explicit
```

**Fix**: Explicit contracts
```python
# ✅ GOOD: Documented interfaces
data_loader = {
    "input_contract": "JSON with fields: id, timestamp, value",
    "output_contract": "DataFrame with validated schema"
}

data_cleaner = {
    "input_contract": "DataFrame from data_loader",
    "output_contract": "Cleaned DataFrame, outliers in /logs/"
}
```

## Anti-Pattern 10: No Evolution Path

**Symptom**: Agent architecture can't adapt to growth.

**Example**:
```python
# ❌ BAD: Hardcoded, inflexible
agent = create_deep_agent(
    subagents=[agent1, agent2, agent3]  # Can't add more easily
)
```

**Fix**: Configuration-driven
```python
# ✅ GOOD: Configurable, scalable
config = load_agent_config("config.yaml")

agent = create_deep_agent(
    subagents=[
        build_subagent(spec) for spec in config["subagents"]
    ]
)
# Easy to add/remove/modify subagents
```

## Detection Checklist

Run through this checklist to identify anti-patterns:

- [ ] Can subagents make conflicting decisions?
- [ ] Does main agent have > 30 tools?
- [ ] Is it unclear when to use each subagent?
- [ ] Are there subagents used only once?
- [ ] Do subagents share tool assignments?
- [ ] Does vocabulary conflict across contexts?
- [ ] Is context still overflowing despite subagents?
- [ ] Are there implicit dependencies?
- [ ] Is the architecture inflexible?
- [ ] Would a simple script work better?
