# Plan: Refactor DeepAgents Builder Skills

## Overview

Comprehensive review and improvement of all skills in `plugins/deepagents-builder/` to align with official DeepAgents API documentation and best practices.

## Source References

- **DeepAgents README**: https://github.com/langchain-ai/deepagents
- **DeepAgents CLI**: https://github.com/langchain-ai/deepagents/blob/master/libs/deepagents-cli/README.md
- **Context7 Documentation**: /langchain-ai/deepagents

## Identified Issues

### 1. API Inconsistencies

| Issue | Current State | Correct API |
|-------|---------------|-------------|
| Model format | Mixed: `claude-sonnet-4-5-20250929` and `anthropic:claude-sonnet-4-20250514` | Use `anthropic:claude-sonnet-4-20250514` format consistently |
| Backend parameter | `FilesystemBackend(root_dir="/")` | Correct, but missing other backends |
| Memory parameter | Documented but incomplete | Add `store` parameter for long-term memory |

### 2. Missing Built-in Tools

Current quickstart lists 9 tools, but official docs show more:

| Current | Missing |
|---------|---------|
| write_todos, read_todos | ✅ |
| ls, read_file, write_file, edit_file, glob, grep | ✅ |
| task | ✅ |
| - | `execute` (sandboxed shell) |
| - | `shell` (local commands) |
| - | `web_search` (external search) |
| - | `fetch_url` (URL fetching) |

### 3. Missing Backend Documentation

Official backends not documented:
- `StateBackend` - Default, ephemeral in-memory
- `FilesystemBackend` - Local disk access
- `StoreBackend` - Persistent cross-conversation
- `CompositeBackend` - Hybrid routing

### 4. AGENTS.md Incomplete in prompt-patterns.md

The file-first approach with AGENTS.md is documented in architecture but missing from `patterns/references/prompt-patterns.md`.

### 5. ToolRuntime Security Pattern Underemphasized

`tool-patterns.md` doesn't prominently feature `ToolRuntime` for secure context injection.

---

## Implementation Plan

### Phase 1: Fix quickstart/SKILL.md

**File:** `plugins/deepagents-builder/skills/quickstart/SKILL.md`

#### 1.1 Update Model Format
```python
# Change from:
model="claude-sonnet-4-5-20250929"

# To:
model="anthropic:claude-sonnet-4-20250514"
```

#### 1.2 Update Built-in Tools Table

```markdown
| Tool | Purpose |
|------|---------|
| `write_todos` | Create structured task lists |
| `read_todos` | View current tasks |
| `ls` | List directory contents |
| `read_file` | Read file content |
| `write_file` | Create/overwrite files |
| `edit_file` | Exact string replacements |
| `glob` | Find files by pattern |
| `grep` | Search text in files |
| `execute` | Run commands in sandbox |
| `shell` | Run local shell commands |
| `web_search` | Search the web |
| `fetch_url` | Fetch URL content |
| `task` | Delegate to subagents |
```

#### 1.3 Add Backends Section

```markdown
## Backend Configuration

Control how filesystem operations work:

| Backend | Purpose | Persistence |
|---------|---------|-------------|
| `StateBackend` | Default, in-memory | Ephemeral (conversation) |
| `FilesystemBackend` | Local disk access | Permanent |
| `StoreBackend` | Cross-conversation memory | Persistent |
| `CompositeBackend` | Hybrid routing | Mixed |
```

---

### Phase 2: Fix architecture/SKILL.md

**File:** `plugins/deepagents-builder/skills/architecture/SKILL.md`

#### 2.1 Fix Model Format in Examples

All examples should use `anthropic:claude-sonnet-4-20250514` format.

#### 2.2 Add CompositeBackend for Long-Term Memory

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    store=InMemoryStore(),
    backend=CompositeBackend(
        default=StateBackend(),
        routes={"/memories/": StoreBackend()},
    ),
    memory=["./.deepagents/AGENTS.md"],
    system_prompt="You have persistent memory in /memories/"
)
```

---

### Phase 3: Fix patterns/SKILL.md

**File:** `plugins/deepagents-builder/skills/patterns/SKILL.md`

#### 3.1 Fix Model Format

Update all code examples to use consistent model format.

#### 3.2 Enhance ToolRuntime Section

Already has ToolRuntime but ensure it's prominently featured as security best practice.

---

### Phase 4: Fix patterns/references/prompt-patterns.md

**File:** `plugins/deepagents-builder/skills/patterns/references/prompt-patterns.md`

#### 4.1 Add AGENTS.md Section

```markdown
## File-First Prompts with AGENTS.md

Instead of hardcoding all context in `system_prompt`, use `AGENTS.md` files:

### Benefits
- Persistent across sessions
- Agent can self-update via `edit_file`
- Separates role (code) from context (file)
- Version controllable

### Pattern: Minimal system_prompt + Rich AGENTS.md

```python
agent = create_deep_agent(
    memory=[
        "~/.deepagents/AGENTS.md",      # Global preferences
        "./.deepagents/AGENTS.md",      # Project context
    ],
    system_prompt="You are a support coordinator."  # Just the role
)
```

### AGENTS.md Structure

```markdown
# Agent Context

## Domain Vocabulary
- 'Ticket' = customer inquiry
- 'Resolution' = issue fix

## Workflow
1. Classify incoming request
2. Route to appropriate specialist
3. Synthesize results

## Escalation Criteria
- Customer requests human
- Issue unresolved after 3 attempts
```
```

---

### Phase 5: Fix patterns/references/tool-patterns.md

**File:** `plugins/deepagents-builder/skills/patterns/references/tool-patterns.md`

#### 5.1 Add ToolRuntime Security Section (Prominent)

```markdown
## Security: ToolRuntime Context Injection

**CRITICAL**: Never expose user IDs, API keys, or credentials as tool parameters.

### ❌ INSECURE: User ID as Parameter

```python
@tool
def get_user_data(user_id: str) -> dict:
    """LLM can pass ANY user_id - security vulnerability!"""
    return fetch_from_db(user_id)
```

### ✅ SECURE: ToolRuntime Context

```python
from dataclasses import dataclass
from langchain.tools import tool, ToolRuntime

@dataclass
class SecureContext:
    user_id: str
    api_key: str

@tool
def get_user_data(runtime: ToolRuntime[SecureContext]) -> dict:
    """User ID injected from runtime - not controllable by LLM."""
    return fetch_from_db(runtime.context.user_id)

agent = create_deep_agent(
    tools=[get_user_data],
    context_schema=SecureContext
)

# Invoke with secure context (invisible to LLM)
result = agent.invoke(
    {"messages": [...]},
    context=SecureContext(user_id="user_123", api_key="sk-...")
)
```
```

---

### Phase 6: Fix patterns/references/anti-patterns.md

**File:** `plugins/deepagents-builder/skills/patterns/references/anti-patterns.md`

#### 6.1 Add Anti-Pattern: Context Starvation

```markdown
## Anti-Pattern 15: Context Starvation

**Symptom**: Agent lacks knowledge of available resources and capabilities.

**Example**:
```python
# ❌ BAD: Agent doesn't know what's available
agent = create_deep_agent(
    tools=[query_db, send_email, generate_report],
    system_prompt="You are a helpful assistant."
)
# Agent doesn't know: which DBs exist, email templates, report formats
```

**Fix**: Provide resource inventory in AGENTS.md
```python
# ✅ GOOD: Agent knows its resources
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Contains resource inventory
    tools=[query_db, send_email, generate_report],
    system_prompt="You are a helpful assistant."
)

# .deepagents/AGENTS.md:
# ## Available Resources
# - Databases: users_db, orders_db, analytics_db
# - Email templates: /templates/welcome.html, /templates/receipt.html
# - Report formats: PDF, CSV, JSON
```
```

#### 6.2 Add Anti-Pattern: Artificial Capability Limits

```markdown
## Anti-Pattern 16: Artificial Capability Limits

**Symptom**: Vague restrictions that prevent legitimate use cases.

**Example**:
```python
# ❌ BAD: Vague, overly restrictive
system_prompt = """You are a support agent.
DO NOT:
- Access sensitive data
- Make changes to accounts
- Process refunds over $50"""
# What counts as "sensitive"? Agent becomes overly cautious.
```

**Fix**: Use `interrupt_on` for specific controls
```python
# ✅ GOOD: Specific controls with human approval
agent = create_deep_agent(
    checkpointer=MemorySaver(),
    interrupt_on={
        "process_refund": {"allowed_decisions": ["approve", "reject"]},
        "delete_account": {"allowed_decisions": ["approve", "reject"]},
    },
    system_prompt="You are a support agent with full capabilities."
)
# Agent can do anything, but sensitive actions require approval
```
```

---

### Phase 7: Update evals/SKILL.md

**File:** `plugins/deepagents-builder/skills/evals/SKILL.md`

#### 7.1 Verify Harbor and LangSmith References

Ensure examples use correct API and latest patterns.

---

### Phase 8: Update evolution/SKILL.md

**File:** `plugins/deepagents-builder/skills/evolution/SKILL.md`

#### 8.1 Fix Model Format in Examples

Update all code examples to use consistent model format.

---

## Files to Modify

| File | Changes |
|------|---------|
| `skills/quickstart/SKILL.md` | Model format, tools table, add backends |
| `skills/architecture/SKILL.md` | Model format, add CompositeBackend example |
| `skills/patterns/SKILL.md` | Model format consistency |
| `skills/patterns/references/prompt-patterns.md` | Add AGENTS.md section |
| `skills/patterns/references/tool-patterns.md` | Add prominent ToolRuntime section |
| `skills/patterns/references/anti-patterns.md` | Add #15 Context Starvation, #16 Artificial Limits |
| `skills/evals/SKILL.md` | Verify API accuracy |
| `skills/evolution/SKILL.md` | Model format consistency |

## Verification

After implementation:
1. All model references use `anthropic:claude-sonnet-4-20250514` format
2. Built-in tools table includes all 13 tools
3. Backend types documented with examples
4. AGENTS.md pattern in prompt-patterns.md
5. ToolRuntime security prominent in tool-patterns.md
6. Anti-patterns #15 and #16 added
7. All code examples are runnable

## Source Attribution

Based on:
- DeepAgents official documentation (Context7)
- Agent-native principles from Every.to
- LangChain best practices
