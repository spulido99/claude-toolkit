# Agent Architecture Maturity Model

Assess and evolve your deep agent architecture through maturity levels.

Maturity measures **engineering discipline — context, tools, and evals — orthogonal to topology**. More subagents is NOT more maturity: a single agent with skills and evals can be Level 3-4, while a multi-agent system without evals or telemetry is Level 1. Topology is decided by write coupling (see [architecture/references/assistant-pattern.md](../../architecture/references/assistant-pattern.md)); maturity scores how well the chosen topology fits and how disciplined the engineering around it is.

## Level 1: Initial (Ad-Hoc)

**Characteristics:**
- Large tool catalog with no disclosure mechanism (no tool search, no skills)
- Overlapping tool names and descriptions
- No planning or context management
- No evals, no telemetry — regardless of how many subagents exist
- Frequent tool selection errors, high token usage per task

**Example:**
```python
agent = create_deep_agent(
    tools=[get_resource, get_data, fetch_resource, ...]  # overlapping, all loaded up front
)
# Equally Level 1: five subagents, zero evals, zero telemetry
```

**Symptoms:**
- Agent confused about which tool to use
- Context window overflows
- Inconsistent results
- Long execution times

**Next Step:** Identify bounded contexts and package them as skills; consolidate/rename overlapping tools (tool design)

---

## Level 2: Managed (Basic Structure)

**Characteristics:**
- Bounded contexts identified and packaged as skills (SKILL.md with progressive disclosure)
- Tool catalog consolidated (tool design applied: no overlapping names)
- Basic planning (to-do lists with an instructed threshold)
- Topology roughly matches write coupling (writes concentrated in one agent)

**Example:**
```python
agent = create_deep_agent(
    tools=consolidated_tools,
    skills=["./skills/"],  # one SKILL.md per bounded context
)
```

**Improvements:**
- Reduced tool-selection errors
- Domain vocabulary lives in skills, loaded on demand
- Writes stay in one thread

**Gaps:**
- No disclosure mechanism for a still-growing catalog
- Contracts implicit
- No evals yet

**Next Step:** Add tool search for the 10+ catalog, make contracts explicit, document vocabularies

---

## Level 3: Defined (Disclosed & Contracted)

**Characteristics:**
- Tool search / deferred loading operating for large catalogs (10+ tools or >10k tokens of definitions)
- Explicit contracts between components (tool inputs/outputs, skill scopes, worker summaries)
- Topology explicitly justified by write coupling; any subagents are read-only, parallelizable, and pass the ~15x economic test
- Documented vocabularies per bounded context
- File system / summarization for context management

**Example:**
```python
agent = create_deep_agent(
    tools=consolidated_tools,
    middleware=[LLMToolSelectorMiddleware()],  # or ProviderToolSearchMiddleware
    skills=["./skills/"],
    interrupt_on={...},
    checkpointer=MemorySaver(),
)
# Single agent — and can score Level 3-4 with skills + evals
```

**Improvements:**
- Clear responsibilities without fragmenting writes
- Disclosure keeps the context lean
- Business alignment

**Gaps:**
- Limited metrics
- Eval coverage partial

**Next Step:** Build the eval suites and telemetry

---

## Level 4: Measured (Optimized)

**Characteristics:**
- Eval suites running: tool-selection accuracy, HITL/interrupt flows, disclosure behavior
- Telemetry tracked: cache hit rate, latency, tokens per episode
- Metrics drive refactoring decisions
- Automated regression testing (EDD workflow active)

**Metrics:**
- Tokens per episode
- Cache hit rate
- Latency per turn / per episode
- Tool selection accuracy
- Error rate: failed tasks/total
- For any subagents: utilization and per-episode token multiple (does the value still pay ~15x?)

**Improvements:**
- Data-driven decisions
- Regressions caught by evals
- Cost and latency under control

**Gaps:**
- Still requires manual design
- Limited self-adaptation

**Next Step:** Implement evolutionary architecture

---

## Level 5: Optimizing (Evolutionary)

**Characteristics:**
- Self-organizing agent ecosystem
- Automatic capability detection
- Continuous optimization based on telemetry
- A/B testing different recipes (disclosure thresholds, summarization settings)

**This is an aspirational target.** No framework currently provides fully automatic agent evolution. Achieve this incrementally by combining Level 4 metrics with configuration-driven architectures and A/B testing (see [Refactoring Patterns](refactoring-patterns.md)).

---

## Maturity Assessment

Score your agent architecture (0-5 for each):

### Structure
- [ ] Topology fit (0: contradicts write coupling, 5: matches ADR — coupled writes in one agent, subagents read-only and ~15x-justified)
- [ ] Bounded contexts as skills (0: none, 5: every domain packaged with progressive disclosure)
- [ ] Business capability alignment (0: random, 5: perfect mapping)
- [ ] Explicit contracts (0: implicit, 5: documented inputs/outputs for tools, skills, workers)

### Operations
- [ ] Planning integration (0: none, 5: instructed thresholds, adaptive)
- [ ] Context management (0: overflows, 5: summarization/compression tuned for the horizon)
- [ ] Disclosure (0: full catalog always loaded, 5: tool search + skills disclosure operating)
- [ ] Error handling (0: crashes, 5: graceful recovery)

### Measurement
- [ ] Telemetry (0: none, 5: cache/latency/tokens-per-episode tracked)
- [ ] Eval coverage (0: none, 5: tool-selection, HITL, and disclosure suites running)
- [ ] Documentation (0: none, 5: complete)
- [ ] Monitoring (0: none, 5: real-time)

### Evolution
- [ ] Refactoring capability (0: rigid, 5: easy changes)
- [ ] Learning from usage (0: static, 5: adapts)
- [ ] Experimentation (0: none, 5: A/B testing)
- [ ] Feedback loops (0: none, 5: automated)

**Total Score (max 80):**
- 0-20: Level 1 (Initial)
- 21-40: Level 2 (Managed)
- 41-60: Level 3 (Defined)
- 61-80: Level 4+ (Measured/Optimizing)

## Migration Paths

### Level 1 → Level 2

1. Apply tool design: consolidate and rename overlapping tools
2. Identify bounded contexts and **package them as skills** (SKILL.md per context — NOT subagents)
3. Instruct a planning threshold (`write_todos` for 3+ dependent steps)
4. Verify writes are concentrated in one agent

### Level 2 → Level 3

1. Add tool search / deferred loading for the 10+ catalog (`middleware=` in deepagents 0.6)
2. Make contracts explicit (tool inputs/outputs, skill scopes)
3. Document vocabularies per bounded context
4. Justify topology against write coupling; apply the ~15x test to any subagent
5. Configure the recipe from the regime (interrupts, summarization)

### Level 3 → Level 4

1. Build eval suites: tool-selection, HITL/interrupts, disclosure behavior
2. Implement telemetry: cache hit rate, latency, tokens per episode
3. Establish the EDD loop (baseline before refactoring, regression after)
4. Track subagent economics (per-episode token multiple)

### Level 4 → Level 5

1. Automate telemetry-driven optimization
2. Externalize configuration
3. Enable A/B testing of recipes
4. Implement feedback loops

## Red Flags by Level

**Level 1:**
🚩 Context window constantly overflowing
🚩 Agent can't decide which tool to use
🚩 Execution takes > 5 minutes for simple tasks

**Level 2:**
🚩 Skills exist but the full catalog still loads up front (no disclosure)
🚩 Subagents created because the catalog grew
🚩 Still getting context overflow

**Level 3:**
🚩 Business users don't recognize structure
🚩 Vocabulary conflicts between bounded contexts
🚩 Subagents that write in a thread coupled with the frontal agent

**Level 4:**
🚩 Metrics not driving decisions
🚩 Performance not improving over time
🚩 Testing manually intensive

## Success Indicators

**Level 2:** Overlap eliminated; domain vocabulary loads on demand
**Level 3:** Lean context per episode; stakeholders recognize the structure
**Level 4:** Eval suites green in CI; tokens-per-episode trending down
**Level 5:** Automatic adaptation, improving metrics

## Tools for Assessment

1. **Disclosure Check**
```python
def check_disclosure(agent):
    catalog_size = len(agent.tools)
    has_tool_search = any("ToolSearch" in type(m).__name__ or "ToolSelector" in type(m).__name__
                          for m in agent.middleware)
    has_skills = bool(agent.skills)
    return {
        "catalog_size": catalog_size,
        "needs_disclosure": catalog_size >= 10,
        "disclosure_present": has_tool_search or has_skills,
    }
```

2. **Topology Fit Check**
```python
def check_topology_fit(agent):
    # For each subagent: does it hold write-capable tools?
    # Coupled writes in a subagent = topology mismatch (ADR-0001)
    # Also: is each subagent's episode value worth ~15x tokens?
    return fit_report
```

3. **Business Alignment Check**
```python
def check_business_alignment(agent, business_capabilities):
    # Compare skills/workers to business capability map
    # Identify gaps and overlaps
    return alignment_report
```
