# Agent Topology Patterns

Detailed patterns for structuring deep agents. The **first-order decision variable is write coupling**: if the writes in an episode depend on decisions made in the same thread, a single agent writes (assistant pattern). Subagents are reserved for read-only, parallelizable work whose episode value pays the ~15x token overhead of multi-agent systems (Anthropic's figure).

## Pattern 1: Assistant Pattern (Default)

**When to use:** Writes in the episode are coupled — the default for conversational assistants and for autonomous agents that write (Devin-style). This is the pattern behind Claude, ChatGPT, Erica, and Klarna.

**Recipe:** Single frontal deep agent with flat tools; tool search when the catalog reaches 10+ tools or >10k tokens of definitions; HITL via `interrupt_on`; bounded contexts packaged as skills (`skills=`); `SummarizationMiddleware` for the long horizon; deep workers dispatched in background for read-heavy episodes.

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are the assistant. You alone own the write thread...",
    tools=all_tools,                          # flat catalog, writes stay here
    middleware=[LLMToolSelectorMiddleware()], # tool search for large catalogs
    skills=["./skills/"],                     # bounded contexts as skills
    interrupt_on={"execute_transfer": {"allowed_decisions": ["approve", "reject"]}},
    checkpointer=MemorySaver(),
)
```

**Characteristics:**
- One frontal agent talks to the user and executes every write
- Large catalogs handled by tool search / deferred loading, never by splitting
- Long horizon handled by summarization/context compression, never by splitting
- Domain bounds are skills with progressive disclosure, not subagent-per-domain
- The interaction regime (conversational vs autonomous) configures the recipe — interrupts, summarization, background workers — but never decides the topology

**Full recipe and verified deepagents 0.6 details:** see [assistant-pattern.md](assistant-pattern.md).

## Pattern 2: Read-Only Fan-Out (Orchestrator–Workers)

**When to use:** The delegable work is **read-only and parallelizable** (broad research, codebase exploration, multi-source analysis) AND the episode's value pays the ~15x token overhead. This is Anthropic's multi-agent research shape.

```python
agent = create_deep_agent(
    system_prompt="""You coordinate research. Delegate independent read-only
    investigations in parallel; synthesize the summaries yourself.""",
    tools=[synthesize, write_report],  # writes stay in the lead agent
    subagents=[
        {
            "name": "market-researcher",
            "description": "Read-only market and competitor investigation",
            "tools": [market_data, competitor_analysis],  # read-only
        },
        {
            "name": "literature-researcher",
            "description": "Read-only paper and documentation research",
            "tools": [arxiv_search, web_search],  # read-only
        },
    ],
)
```

**Characteristics:**
- Workers never write — the lead agent keeps the write thread
- Workers are stateless in messages but **share the filesystem/backend with the parent** (no file quarantine)
- Each worker returns a concise summary, not raw context
- Economically justified only for high-value episodes (~15x tokens vs single agent)

## Pattern 3: Hybrid — Frontal Agent + Background Deep Workers

**When to use:** A conversational assistant needs heavy read-only work without blocking the conversation.

This is **composition of Patterns 1 and 2, not a third regime**: the frontal agent keeps the conversation and every write; deep workers (read-heavy, parallelizable episodes) run in background and report back summaries.

```python
agent = create_deep_agent(
    system_prompt="""You are the frontal assistant. Handle the conversation
    and all writes yourself. Dispatch research-worker for read-only
    investigations that would take many tool calls.""",
    tools=write_and_action_tools,
    subagents=[
        {
            "name": "research-worker",
            "description": "Read-only deep investigation, returns a summary",
            "tools": read_only_tools,
        }
    ],
)
```

**Characteristics:**
- The frontal agent is not an "orchestrator" — it is the assistant, temporarily delegating reads
- Top-level `interrupt_on` is inherited only by declarative subagent dicts (not `CompiledSubAgent`/remote)
- Apply the same ~15x economic test per dispatched worker

## Pattern 4: Domain Bounds as Skills

**When to use:** Distinct business vocabularies/policies inside a single agent (the assistant branch). This replaces subagent-per-domain for write-coupled agents.

```python
agent = create_deep_agent(
    system_prompt="You manage e-commerce operations end-to-end...",
    tools=all_domain_tools,
    skills=["./skills/"],  # one SKILL.md per bounded context
)
```

```
skills/
├── inventory/SKILL.md    # 'Stock' = available units, 'Reserved' = pending orders...
├── orders/SKILL.md       # 'Fulfillment' = picking, packing, shipping...
└── support/SKILL.md      # 'Ticket' = customer inquiry, escalation policy...
```

**Characteristics:**
- Each SKILL.md carries one bounded context: vocabulary, flows, policies
- 3-layer progressive disclosure (native in deepagents 0.6): index costs one line, body loads on demand
- Writes stay in one thread; no delegation hops, no lost conversational state
- Protect the skills library with `permissions` deny-write (prompt-injection surface)

## Pattern 5: Pipeline Fan-Out (Autonomous Read-Heavy)

**When to use:** Autonomous pipelines whose stages are read-only and independent (ETL analysis, batch document processing, monitoring sweeps).

Same rules as Pattern 2 — the writes (final report, DB commit) concentrate in one agent at the end; the parallel stages only read. If a stage's writes depend on another stage's in-thread decisions, they belong in the same agent.

## Topology Selection Flowchart

```
Start: describe the episodes (unit of work between human input and result)
  ↓
1. Are the episode's writes coupled?
   (do writes depend on decisions made in the same thread?)
  ├─ Yes → ASSISTANT PATTERN (Pattern 1) — a single agent writes
  │         Long horizon? → summarization/context compression, not splitting
  │         Read-heavy sub-episodes? → compose with background deep workers (Pattern 3)
  └─ No (delegable work is read-only and parallelizable) → Continue
       ↓
2. Does the episode's value pay the ~15x token overhead of multi-agent?
  ├─ No  → stay single-agent (Pattern 1)
  └─ Yes → READ-ONLY FAN-OUT (Pattern 2 / Pattern 5)
       ↓
3. Large tool catalog? (10+ tools or >10k tokens of definitions)
   → tool search / deferred loading in the agent that holds the tools
     — never subagents by catalog size
       ↓
4. Interaction regime (conversational vs autonomous)?
   → configures the recipe only: interrupts, summarization depth,
     background deep workers. It never decides the topology.
```

> Historical note: earlier versions of this flowchart selected topology by tool count ("<10 / 10-30 / >30 tools"). That criterion is retired — tool-selection degradation past 30-50 tools motivates **tool search**, not subagents, and splitting a write-coupled agent produces stateless subagents that lose the thread at ~15x the cost.

## Anti-Pattern Warning Signs

❌ Subagents created because the tool catalog grew (cure: tool design → tool search)
❌ Write-capable tools distributed across subagents (coupled writes fragmented)
❌ Subagent used only once (overhead not justified)
❌ Overlapping tool names/descriptions (cure: consolidate/rename — tool design)
❌ Parallel subagents making independent write decisions
❌ Splitting the agent to cope with a long horizon (cure: summarization)
❌ Assuming file isolation between parent and subagents (they share the backend)

## Evolution Patterns

**Phase 1: MVP**
→ Assistant pattern with a small flat catalog

**Phase 2: Growing catalog**
→ Tool design (consolidate/rename), then tool search / deferred loading

**Phase 3: Growing domains**
→ Package bounded contexts as skills with progressive disclosure

**Phase 4: High-value read-heavy episodes**
→ Compose background deep workers (read-only fan-out) where the ~15x pays off

See `refactoring-patterns.md` for migration strategies.
