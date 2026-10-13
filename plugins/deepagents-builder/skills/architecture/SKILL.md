---
name: DeepAgents Architecture
description: "Topology reference for deepagents agents: write coupling decides between one frontal agent (assistant pattern, the default) and read-only subagents; bounded contexts packaged as skills; business-capability mapping. Use when deciding how many agents to build, whether to add a subagent, or how to split domains."
---

# DeepAgents Architecture Design

Design production-ready agent architectures. Topology is decided by **write coupling** (ADR: coupled writes → a single frontal agent writes — the assistant pattern; subagents only for read-only, parallelizable work whose episode value pays the ~15x token overhead).

## Core Principles

### 1. Capability-First Design

Design subagents based on **business capabilities**, not technical implementation.

```python
# Good: Capability-focused
{"name": "market-analyst", "description": "Analyzes market trends"}

# Bad: Implementation-focused
{"name": "postgres-agent", "description": "Queries PostgreSQL"}
```

### 2. Context Isolation (Bounded Contexts)

Each subagent operates within its own vocabulary and mental model.

```python
subagents = [
    {
        "name": "support-agent",
        "system_prompt": """In support context:
        - 'Ticket' = customer inquiry
        - 'Resolution' = issue fix
        - 'Escalation' = route to specialist"""
    },
    {
        "name": "billing-agent",
        "system_prompt": """In billing context:
        - 'Invoice' = payment request
        - 'Credit' = account adjustment
        - 'Subscription' = recurring charge"""
    }
]
```

### 3. Write Coupling Decides Topology

The first-order decision variable is **write coupling**, not tool count:

| Episode shape | Recommended Architecture |
|---------------|--------------------------|
| Writes are coupled (depend on decisions in the same thread) | **Assistant pattern**: single frontal agent owns all writes |
| Delegable work is read-only and parallelizable, episode value pays ~15x tokens | Read-only fan-out (orchestrator–workers) |
| Conversational frontal + heavy read-only sub-episodes | Hybrid: composition of the two (frontal agent + background deep workers) |

Large tool catalogs (10+ tools or >10k tokens of definitions) are handled with **tool search / deferred loading** inside the single agent — never with subagents by catalog size. Long horizon is handled with summarization/context compression, not by splitting the agent. See [Assistant Pattern](references/assistant-pattern.md).

## Agent-Native Principles

Design applications where agents are first-class citizens, not add-ons. Read [Agent-Native Principles](${CLAUDE_PLUGIN_ROOT}/skills/tool-design/references/agent-native-principles.md) § Catalog-Level Principles (Parity, Granularity, Composability, Emergent Capability, Improvement Over Time) when auditing whether the agent can do everything the UI can and whether tools are sized as atomic primitives, and apply its guidance to the catalog.

## Data Architecture

### When to Use Files vs Databases

| Use Files For | Use Databases For |
|--------------|-------------------|
| Content users should read/edit | High-volume structured data |
| Configuration (version control) | Complex relational queries |
| Agent-generated reports | Ephemeral session state |
| Large text/markdown content | Data requiring indexes |

### Context Management with AGENTS.md

The `memory` parameter points the agent at **memory files** — `AGENTS.md` by convention, any paths in practice — **injected into the system prompt** at session start. The agent can update them with `edit_file`; whether the updates persist per-thread only or across conversations depends on the **backend** serving those paths (a `FilesystemBackend` or a `StoreBackend` route makes them durable — see Long-Term Memory below).

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    backend=FilesystemBackend(root_dir="./"),  # Scope to project directory
    memory=[
        "~/.deepagents/AGENTS.md",      # Global preferences
        "./.deepagents/AGENTS.md",      # Project-specific context
    ],
    system_prompt="You are a project assistant."  # Minimal, AGENTS.md has the rest
)
```

> **Security Warning**: Never use `root_dir="/"` — it grants the agent read/write access to your entire filesystem. Always scope to the project directory or a dedicated workspace.

**Two levels of AGENTS.md:**

| File | Purpose |
|------|---------|
| `~/.deepagents/AGENTS.md` | Global: personality, style, universal preferences |
| `./.deepagents/AGENTS.md` | Project: architecture, conventions, team guidelines |

**Global AGENTS.md example** (`~/.deepagents/AGENTS.md`):

```markdown
# Global Preferences

## Communication Style
- Tone: Professional, concise
- Format output as Markdown tables when showing data
- Always cite sources for claims

## Universal Coding Preferences
- Use type hints in Python
- Prefer functional patterns where appropriate
- Write tests for new functionality
```

**Project AGENTS.md example** (`.deepagents/AGENTS.md`):

```markdown
# Project Context

## Architecture
- FastAPI backend in /api
- React frontend in /web
- PostgreSQL database

## Conventions
- API endpoints follow REST naming
- Use Pydantic for validation
- Run `pytest` before committing

## Available Resources
- /data/reports/ - Historical reports
- /config/sources.json - Approved data sources
```

**For internal/trusted agents only:** The agent can update these files using `edit_file` when learning new preferences or receiving feedback. By default, treat `AGENTS.md` as read-only.

> **Security Note**: Writable `AGENTS.md` is appropriate for internal/trusted agents only. For customer-facing agents, see the [Security for Customer-Facing Agents](${CLAUDE_PLUGIN_ROOT}/skills/patterns/SKILL.md#security-for-customer-facing-agents) section in patterns/SKILL.md to prevent Persistent Prompt Injection attacks.

### Long-Term Memory with CompositeBackend

For persistent memory across conversations, use `CompositeBackend` to route specific paths to durable storage. Memory files listed in `memory=` can themselves live under a durable route (e.g. `memory=["/memories/AGENTS.md"]`) — the agent sees plain files while the store persists them in a DB:

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

agent = create_deep_agent(
    store=store,
    backend=CompositeBackend(
        default=StateBackend(),                         # Ephemeral by default
        routes={"/memories/": StoreBackend(store=store)},  # Persistent for /memories/
    ),
    memory=["./.deepagents/AGENTS.md"],
    system_prompt="You have persistent memory. Write to /memories/ to remember across sessions."
)
```

| Path | Backend | Persistence |
|------|---------|-------------|
| `/memories/*` | StoreBackend | Cross-conversation |
| Everything else | StateBackend | Conversation only |

## Agent Topologies

The two branches, plus their composition (see [Topology Patterns](references/topology-patterns.md)):

### Assistant Pattern (default)

One frontal deep agent that talks to the user and owns every write. Flat tools (+ tool search when the catalog reaches 10+ tools / >10k tokens of definitions), bounded contexts as skills, HITL via interrupts, summarization for the long horizon. Archetypes: Claude, ChatGPT, Erica, Klarna. Full recipe: [Assistant Pattern](references/assistant-pattern.md).

```python
agent = create_deep_agent(
    system_prompt="You are the assistant. You alone execute the writes...",
    tools=all_tools,
    skills=["./skills/"],
)
```

### Read-Only Fan-Out (orchestrator–workers)

For read-only, parallelizable work whose episode value pays the ~15x token overhead. Workers only read and return summaries; the lead agent keeps the writes.

```python
{
    "name": "market-researcher",
    "description": "Read-only market investigation, returns a summary",
    "tools": [market_data, competitor_analysis]  # read-only
}
```

### Deep Worker (composition, not a third regime)

An autonomous, read-heavy, parallelizable episode dispatched in background from a conversational frontal agent. The hybrid = assistant pattern + read-only fan-out, composed.

```python
{
    "name": "research-worker",
    "description": "Read-only deep investigation dispatched in background",
    "tools": read_only_tools
}
```

> Subagents are stateless in messages but **share the filesystem/backend with the parent** — delegation isolates the message context, not the files.

## Topology Decision

Ask these questions in this order. Write coupling decides the topology; tool count and the interaction regime never do. First have the user describe the **episodes** — units of work between human input and result (a conversational turn, or a full autonomous run).

```
Start: describe the episodes
  |
  v
1. Are the episode's writes coupled?
   |-- Yes --> Assistant pattern (single frontal agent writes)
   |            Long horizon? -> summarization, not splitting
   |            Read-heavy sub-episodes? -> background deep workers (composition)
   |-- No (read-only, parallelizable) --> Continue
          |
          v
2. Does the episode value pay the ~15x multi-agent token overhead?
   |-- No  --> stay single-agent (assistant pattern)
   |-- Yes --> read-only fan-out (orchestrator-workers)
          |
          v
3. Catalog at 10+ tools or >10k tokens of definitions?
   --> tool search / deferred loading (never subagents by catalog size)
          |
          v
4. Interaction regime (conversational vs autonomous)?
   --> configures the recipe (interrupts, summarization, deep workers)
       — never decides the topology
```

**Question 1 — Are the episode's writes coupled?** Do the writes (transactions, file edits, state changes, messages sent) depend on decisions made in the same thread? If yes, use the assistant pattern: a single frontal agent owns the conversation and every write; long horizon is handled with summarization/context compression, not by splitting the agent, and deep workers may still be composed for read-heavy sub-episodes. If no, the delegable work is read-only and parallelizable: continue to Question 2.

**Question 2 — Does the episode value pay the ~15x overhead?** Multi-agent systems cost ~15x the tokens of a single agent (Anthropic). If each episode is valuable enough (broad research, large-scale analysis) to pay that, use read-only fan-out: parallel read-only subagents, writes concentrated in the lead agent. If not, stay with the assistant pattern.

**Question 3 — How large is the tool catalog?** Estimate the number of tools and the size of their definitions. If the catalog has overlap or ambiguous names, do tool design first (consolidate/rename). If it reaches 10+ tools or >10k tokens of definitions, use tool search / deferred loading in the single agent (in deepagents 0.6, compose via `middleware=` with `ProviderToolSearchMiddleware` or `LLMToolSelectorMiddleware`; keep built-ins non-deferred). Never split into subagents because of catalog size.

**Question 4 — What is the interaction regime?** Conversational (constant HITL, short turns) or autonomous (long episodes without HITL). The regime is descriptive: it configures the recipe (see Step 4 of the Design Process), never the topology decided by Question 1.

### Additional Decision Factors

Beyond write coupling and domain boundaries, consider:

| Factor | Single Agent | Subagents |
|--------|--------------|-----------|
| **Latency** | Need sub-100ms response | Can tolerate delegation overhead |
| **Failure isolation** | All-or-nothing acceptable | Need independent failure domains |
| **Cost** | Token budget limited | Episode value pays the ~15x token overhead |
| **Observability** | Simple tracing sufficient | Need per-domain visibility |

> **Note**: Tool-selection quality degrades past 30-50 tools — that is the motivation for **tool search** (10+ tools or >10k tokens of definitions, Anthropic's thresholds), not for subagents. Anti-pattern to avoid: splitting a write-coupled agent because the catalog grew.

### Token Economy Considerations

Each subagent call creates a new LLM context (system prompt + task + tool schemas). Keep in mind:

| Pattern | Token Impact |
|---------|-------------|
| Each subagent delegation | ~2,000-5,000 tokens overhead per call |
| Hierarchical nesting (N levels) | N x single-call latency minimum |
| Parallel subagents | Multiplies cost by number of parallel agents |
| Large system prompts on high-frequency agents | Repeated on every API call |

**Tip**: Use the AGENTS.md file-first approach to load context once at session start rather than repeating it in every system prompt.

## Design Process

### Step 1: Map Business Capabilities

```
Enterprise Capabilities
├── Customer Management
│   ├── Support
│   └── Retention
├── Order Fulfillment
│   ├── Processing
│   └── Shipping
└── Financial Operations
    ├── Billing
    └── Refunds
```

### Step 2: Define Bounded Contexts

For each capability, identify:
- Unique vocabulary
- Required expertise
- Can evolve independently?

### Step 3: Map Bounded Contexts to the Topology Branch

| Business Pattern | Assistant branch (coupled writes) | Read-only fan-out branch |
|------------------|-----------------------------------|--------------------------|
| Single capability | Flat tools on the frontal agent | — |
| Distinct bounded contexts | One **skill** per context (SKILL.md, progressive disclosure) | One read-only worker per independent area |
| Growing catalog (10+ tools) | Tool search / deferred loading | Tool search inside each worker |
| Read-heavy sub-episodes | Background deep workers (composition) | Parallel workers, writes stay in the lead |

### Step 4: Configure the Recipe from the Interaction Regime

The interaction regime (conversational vs autonomous) is descriptive — it configures the recipe, never the topology:

| Regime | Recipe configuration |
|--------|----------------------|
| Conversational | `interrupt_on` for sensitive tools; background deep workers for read-heavy episodes |
| Autonomous | Heavier summarization/context compression; still single-agent if writes are coupled (Devin-style) |

## Quick Patterns

### Pattern 1: Assistant Pattern (default — coupled writes)

```python
# Single frontal agent owns the writes; tool search for large catalogs;
# bounded contexts as skills; summarization handles the long horizon.
agent = create_deep_agent(
    tools=all_tools,                          # flat catalog, writes stay here
    middleware=[LLMToolSelectorMiddleware()], # tool search (10+ tools)
    skills=["./skills/"],                     # domain bounds as skills
    interrupt_on={"execute_transfer": {"allowed_decisions": ["approve", "reject"]}},
    checkpointer=MemorySaver(),
    system_prompt="You are the assistant. You alone own the write thread...",
)
```

### Pattern 2: Read-Only Fan-Out (parallelizable reads, ~15x justified)

```python
# Workers only read; the lead agent keeps every write.
agent = create_deep_agent(
    tools=[synthesize, write_report],
    subagents=[
        {"name": "market-researcher", "tools": [market_data]},      # read-only
        {"name": "literature-researcher", "tools": [arxiv_search]}, # read-only
    ]
)
```

### Pattern 3: Hybrid (composition of 1 + 2)

```python
# Conversational frontal agent + ONE general-purpose read-only deep worker
agent = create_deep_agent(
    tools=write_and_action_tools,
    subagents=[
        {"name": "research-worker", "description": "Read-only deep investigation",
         "tools": read_only_tools}
    ]
)
```

## Validation Checklist

Before finalizing architecture:

- [ ] Topology matches write coupling (coupled writes → single frontal agent; subagents only for read-only parallelizable work that pays ~15x)
- [ ] All write-capable tools live in a single agent (no fragmented coupled writes)
- [ ] No subagent exists merely because the catalog grew; 10+ tools (or >10k tokens of definitions) → tool search / deferred loading in place
- [ ] Every subagent is read-only, parallelizable, and passes the ~15x test
- [ ] Bounded contexts packaged as skills (assistant branch), distinct vocabularies per context, no vocabulary collisions
- [ ] Long horizon addressed with summarization, not agent splitting
- [ ] Interaction regime only configured the recipe (interrupts/summarization/workers)
- [ ] No anti-patterns (God Agent = large catalog without disclosure or name/description overlap, Unclear Boundaries, Premature Decomposition)
- [ ] Business capability alignment
- [ ] Stakeholders recognize the structure
- [ ] New subagent description tested for routing ambiguity against all existing descriptions
- [ ] Eval scenarios planned for new subagent capabilities (`/add-scenario`)

## Additional Resources

### Related Skills

For detailed patterns and implementation guidance:

- **[Assistant Pattern](references/assistant-pattern.md)** - The default topology: single frontal agent, tool search, skills, deep workers
- **[Topology Patterns](references/topology-patterns.md)** - All topology patterns with the write-coupling flowchart
- **[Patterns](${CLAUDE_PLUGIN_ROOT}/skills/patterns/SKILL.md)** - Implementation patterns for prompts, tools, and security
- **[Anti-Patterns](${CLAUDE_PLUGIN_ROOT}/skills/patterns/references/anti-patterns.md)** - anti-patterns with fixes
- **[Quickstart](${CLAUDE_PLUGIN_ROOT}/skills/quickstart/SKILL.md)** - Quick start guide with code examples
- **[Evolution](${CLAUDE_PLUGIN_ROOT}/skills/evolution/SKILL.md)** - Maturity model and refactoring strategies
- **[Evals](${CLAUDE_PLUGIN_ROOT}/skills/evals/SKILL.md)** - Evals-Driven Development — validate bounded contexts, measure token efficiency, hierarchical multi-agent evaluation

### Commands

| Command | Purpose |
|---------|---------|
| `/design-topology` | Interactive full architecture design from scratch |
| `/add-subagent` | Add a single subagent to an existing architecture (incremental) |
| `/add-tool` | Add a single tool to an existing catalog |
| `/validate-agent` | Full architecture scan for anti-patterns |
| `/evolve` | Guided architecture evolution and refactoring |
| `/assess` | Assess agent maturity level |

**Incremental subagent workflow**: Use `/add-subagent` when you already have a running agent and want to expand it with a new capability. It analyzes the existing topology, designs a new subagent matching your conventions, checks for routing ambiguity, and inserts the code — without redesigning the full architecture.
