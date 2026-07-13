---
name: design-topology
description: Interactive guide to design agent topology based on write coupling — single frontal agent (assistant pattern) by default, subagents only for read-only parallelizable work.
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
argument-hint: "[domain/use-case]"
---

# Design Agent Topology

Guide the user through designing an agent topology. The first-order decision variable is **write coupling** (see the architecture skill's [assistant pattern](../skills/architecture/references/assistant-pattern.md) and [topology patterns](../skills/architecture/references/topology-patterns.md)) — never tool count, never the interaction regime.

## Workflow

### Step 1: Understand the Domain

Ask the user:

1. **What is the main purpose?** What will this agent system do?
2. **What tools/APIs?** What external systems will it interact with?

### Step 2: Episodes and Write Coupling (first bifurcation)

Ask the user to describe the **episodes** — units of work between human input and result (a conversational turn, or a full autonomous run) — then ask, in this order:

**Question 1 — Are the episode's writes coupled?**
Do the writes (transactions, file edits, state changes, messages sent) depend on decisions made in the same thread?

- **Yes (coupled writes)** → **Assistant pattern**: a single frontal agent owns the conversation and every write. Long horizon is handled with summarization/context compression, not by splitting the agent. Skip to Question 2; deep workers may still be composed for read-heavy sub-episodes.
- **No — the delegable work is read-only and parallelizable** → apply the economic test before leaving this bifurcation:

  **Question 1b — Does the episode value pay the ~15x overhead?**
  Multi-agent systems cost ~15x the tokens of a single agent (Anthropic). Is each episode valuable enough (broad research, large-scale analysis) to pay that?

  - **Yes** → read-only fan-out (orchestrator–workers): parallel read-only subagents, writes concentrated in the lead agent.
  - **No** → stay with the assistant pattern.

**Question 2 — What is the interaction regime?**
Conversational (constant HITL, short turns) or autonomous (long episodes without HITL)? This is **descriptive** — it configures the recipe, never the topology (that was decided by Question 1):

- Conversational → `interrupt_on` for sensitive tools, background deep workers for read-heavy episodes.
- Autonomous → heavier summarization/context compression; still single-agent if writes are coupled (Devin-style).

**Question 3 — How large is the tool catalog?**
Estimate tools and definition size. If the catalog has overlap or ambiguous names → **tool design first** (consolidate/rename). If it reaches **10+ tools or >10k tokens of definitions** → **tool search / deferred loading** in the single agent (in deepagents 0.6, compose via `middleware=` with `ProviderToolSearchMiddleware` or `LLMToolSelectorMiddleware`; keep built-ins non-deferred). Never split into subagents because of catalog size.

### Step 3: Capability Mapping

Guide through capability decomposition:

1. List all business capabilities the agent needs
2. Group related capabilities
3. Identify distinct vocabularies (bounded contexts)

Present as tree structure:

```
Capabilities
├── [Capability Group 1]
│   ├── Sub-capability A
│   └── Sub-capability B
└── [Capability Group 2]
    ├── Sub-capability C
    └── Sub-capability D
```

### Step 4: Domain Bounds

Map the bounded contexts found in Step 3 onto the branch chosen in Step 2:

- **Assistant branch** (coupled writes): package each bounded context as a **skill** (SKILL.md with progressive disclosure — vocabulary, flows, policies). Do NOT create a subagent per domain. Protect the skills library with `permissions` deny-write.
- **Read-only fan-out branch**: bounded contexts may become read-only worker subagents, one per independent investigation area. Writes stay in the lead agent.

### Step 5: Topology Selection

Based on Steps 2–4, recommend one of:

**Pattern 1: Assistant Pattern (default)**
- Single frontal deep agent, flat tools (+ tool search for large catalogs)
- Bounded contexts as skills; HITL via interrupts; summarization for long horizon
- Choose when writes are coupled — regardless of tool count or regime

**Pattern 2: Read-Only Fan-Out (orchestrator–workers)**
- Parallel read-only worker subagents, writes concentrated in the lead
- Choose only when work is read-only, parallelizable, and the episode value pays ~15x

**Pattern 3: Hybrid (composition, not a third regime)**
- Frontal conversational agent + background deep workers for read-heavy episodes
- The frontal agent keeps the conversation and every write

### Step 6: Design Components

**For the assistant branch**, define:
1. **Frontal agent**: system prompt (role, workflow, write ownership, `write_todos` threshold)
2. **Skills**: one per bounded context — name, vocabulary, flows, policies
3. **Interrupts**: which tools require approval (`interrupt_on`; note: top-level config is inherited only by declarative subagent dicts, not `CompiledSubAgent`/remote)
4. **Deep workers** (if hybrid): ONE general-purpose read-only worker to start; name, description, read-only tool list

**For the fan-out branch**, define for each worker subagent:
1. **Name**: kebab-case identifier
2. **Description**: when to delegate (clear, specific, no overlap)
3. **Tools**: read-only tools it needs
4. **System Prompt**: role, vocabulary, workflow, summary format it returns

### Step 7: Generate Architecture Document

Save architecture to file with:

```yaml
---
topology: "[assistant | read-only-fan-out | hybrid]"
write_coupling: "[coupled | read-only-parallelizable]"
interaction_regime: "[conversational | autonomous]"  # descriptive only
tool_catalog: "[count / ~tokens; tool search: yes/no]"
created: "[date]"
---

# Agent Architecture: [Name]

## Overview
[Description]

## Episodes and Write Coupling
[Which writes exist, why they are (not) coupled — the topology rationale]

## Frontal Agent
- **Tools**: [list; tool search mechanism if 10+]
- **Interrupts**: [tools requiring approval]

## Skills (bounded contexts)

### [skill-1-name]
- **Vocabulary**: [terms]
- **Policies/flows**: [summary]

## Deep Workers / Worker Subagents (if any)

### [worker-name]
- **Description**: [when to dispatch]
- **Tools**: [read-only list]
- **Economic justification**: [why the episode value pays ~15x]

## Evolution Path
[Next steps: tool design → tool search → skills → workers]
```

### Step 8: Validation

Check for common issues:

- [ ] All write-capable tools live in a single agent (no fragmented coupled writes)
- [ ] No subagent exists merely because the catalog grew (tool search covers 10+ tools)
- [ ] Every subagent is read-only, parallelizable, and economically justified (~15x test)
- [ ] Bounded contexts are skills (assistant branch), each with distinct vocabulary
- [ ] Long horizon addressed with summarization, not agent splitting
- [ ] Interaction regime only configured the recipe (interrupts/summarization/workers)
- [ ] No anti-patterns (God Agent = large catalog without disclosure, Unclear Boundaries, etc.)
