# The Assistant Pattern (Default)

The canonical shape of a deep conversational agent — and the **default topology** for any agent whose episodes contain coupled writes. This is the pattern behind Claude, ChatGPT, Bank of America's Erica, and Klarna's assistant.

It is still a *deep* agent: deep is a property of the episode (planning, many tool calls, long horizon), not of the number of agents. What makes it the assistant pattern is that **one single frontal agent talks to the user and owns the write thread**.

## When to Use

Use the assistant pattern whenever the answer to the first topology question is "writes are coupled":

- The writes in an episode depend on decisions made in the same thread (conversation turns, implicit decisions during a coding run, a transfer that depends on the balance just checked).
- The agent is conversational (HITL, short turns) — or autonomous but write-coupled (Devin-style: long coding runs with no HITL are still single-agent, because they write).

Do NOT reach for subagents because the tool catalog grew, because the horizon is long, or because the agent is "complex". Those have cheaper cures inside the single agent (tool search, summarization, skills). Subagents are reserved for **read-only, parallelizable** work whose episode value pays the ~15x token overhead of multi-agent systems (Anthropic's figure from their multi-agent research).

## The Recipe (deepagents 0.6)

One frontal deep agent, composed of:

1. **Flat tools** on the frontal agent — all write-capable tools stay here, in one thread.
2. **Tool search / deferred loading** when the catalog reaches 10+ tools or >10k tokens of definitions (Anthropic's documented thresholds).
3. **HITL via interrupts** (`interrupt_on`) for sensitive/destructive tools.
4. **Bounded contexts packaged as skills** (`skills=`) — domain vocabulary, flows, and policies with progressive disclosure, not subagent-per-domain.
5. **Summarization for the long horizon** (`SummarizationMiddleware`, on by default) — long episodes are handled by compressing context, never by splitting the agent.
6. **Deep workers dispatched in background** for read-heavy, parallelizable episodes — the hybrid is a *composition* of the assistant pattern with the read-only branch, not a third regime.

The **interaction regime** (conversational vs autonomous) is a descriptive property: it configures this recipe (how aggressive the interrupts, how much summarization, whether deep workers run in background), but it never decides topology — write coupling does.

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import MemorySaver
from langchain.agents.middleware import LLMToolSelectorMiddleware
# or: from langchain.agents.middleware import ProviderToolSearchMiddleware

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="""You are the banking assistant. You alone talk to the
    user and execute every write (transfers, payments, account changes).

    Use write_todos only for episodes with 3+ dependent steps.
    Dispatch the research worker only for read-only investigation.""",
    tools=all_tools,  # flat catalog on the frontal agent — writes stay here
    middleware=[
        # Tool search for the large catalog (no native tool search in
        # deepagents 0.6 — compose it via middleware=):
        # Option A (Anthropic/OpenAI server-side deferred loading):
        # ProviderToolSearchMiddleware(),
        # Option B (provider-agnostic fallback):
        LLMToolSelectorMiddleware(max_tools=8),
    ],
    skills=["./skills/"],  # bounded contexts as SKILL.md, 3-layer progressive disclosure
    subagents=[
        {
            # ONE general-purpose read-only deep worker for read-heavy episodes
            "name": "research-worker",
            "description": "Read-only research and investigation. Never writes.",
            "tools": [web_search, read_docs, search_transactions],  # read-only
            "system_prompt": "You investigate and return a concise summary.",
        }
    ],
    backend=FilesystemBackend(root_dir="./workspace"),
    memory=["./AGENTS.md"],  # memory files, always-on; durable if their backend is
    checkpointer=MemorySaver(),  # required for interrupts
    interrupt_on={
        # Inherited ONLY by declarative subagent dicts —
        # NOT by CompiledSubAgent or remote subagents.
        "execute_transfer": {"allowed_decisions": ["approve", "edit", "reject"]},
        "close_account": {"allowed_decisions": ["approve", "reject"]},
    },
)
```

### Recipe notes (verified against deepagents 0.6)

- **No native tool search in deepagents 0.6.** Compose it via `middleware=`:
  - `ProviderToolSearchMiddleware` — server-side tool search / deferred loading on Anthropic and OpenAI models. Preferred when available.
  - `LLMToolSelectorMiddleware` — provider-agnostic fallback that pre-selects relevant tools with an LLM call. Known caveats: it can select tools outside the provided list (langchain #33651) and its internal selection call leaks into streams (langchain #34139).
  - Keep the built-ins (filesystem, task, todos) **non-deferred** — the agent must always see them.
- **`skills=` is native** with 3-layer progressive disclosure: the skill index costs one line of context, metadata loads on match, and the SKILL.md body is read only on demand. This is the canonical way to separate domain responsibilities in a single agent.
- **The skills library is a prompt-injection surface.** Protect it with `permissions` deny-write over the skills directory (absolute-glob deny-write in interrupt mode requires deepagents >= 0.6.8).
- **`memory=` points at memory files** (`AGENTS.md` by convention, any paths in practice) **injected always-on at session start**; the agent can update them with `edit_file`. Persistence is a property of the backend serving those paths: `StateBackend` → thread-scoped, `FilesystemBackend` → on disk, a `StoreBackend` route in a `CompositeBackend` → durable DB/store across conversations — the agent sees plain files either way.
- **`SummarizationMiddleware` is on by default** in `create_deep_agent`. Long horizon = summarization/context compression, never agent splitting.
- **Subagents are stateless in messages but SHARE the filesystem/backend with the parent.** Delegation isolates the message context, not the files — do not rely on a file quarantine that does not exist.
- **Top-level `interrupt_on` is inherited only by declarative subagent dicts**, not by `CompiledSubAgent` instances or remote subagents. If a worker is compiled or remote, configure its interrupts explicitly.
- **`write_todos` with an instructed threshold** — tell the agent when planning is worth it (e.g. 3+ dependent steps) so trivial turns don't pay the planning overhead.

## Deep Workers in Background (the Hybrid)

When a conversational frontal agent needs heavy read-only work (research, codebase exploration, document analysis), it dispatches a **deep worker**: an autonomous, typically read-heavy and parallelizable episode running in background while the frontal agent keeps the conversation and the write thread.

This hybrid is modeled as **composition of the two branches** — assistant pattern (frontal, writes) + read-only fan-out (workers) — not as a third interaction regime. The frontal agent is not an "orchestrator" in the multi-agent-LLM sense: it is the assistant, temporarily delegating reads.

Economic test before adding workers: multi-agent costs ~15x the tokens of a single agent (Anthropic). Dispatch deep workers only when the episode's value pays that overhead — broad research does; a balance lookup does not.

## Archetypes

| Assistant | Regime | Shape |
|-----------|--------|-------|
| Claude / ChatGPT | Conversational | Frontal agent, flat tools + tool search, skills, background deep workers (research/code) |
| Erica (Bank of America) | Conversational | Single frontal agent over a large banking tool catalog |
| Klarna | Conversational | Single frontal agent handling support end-to-end |
| Devin (contrast) | Autonomous | Still single-agent — writes are coupled across the whole run; long horizon handled by context compression |

## What This Pattern Replaces

Older guidance split agents by tool count (">30 tools → subagents by domain"). That was wrong: tool selection degradation past 30-50 tools motivates **tool search**, not subagents. Splitting a write-coupled assistant into stateless subagents loses the conversational thread and multiplies token cost (~15x). See the [anti-patterns catalog](../../patterns/references/anti-patterns.md) (God Agent, redefined) and the topology flowchart in [topology-patterns.md](topology-patterns.md).
