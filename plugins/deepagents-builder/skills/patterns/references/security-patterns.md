# Security Patterns for Customer-Facing Agents

When deploying agents to end users, additional security measures are required beyond the base security model.

## AGENTS.md Write Protection

The `AGENTS.md` memory pattern is powerful but creates a **Persistent Prompt Injection** vulnerability if agents can write to shared memory:

```
Malicious user -> Tricks agent -> Writes to AGENTS.md
-> Malicious content persists -> Affects ALL future sessions
```

**Protection**: Use `FilesystemBackend` in read-only mode for shared memory, and `CompositeBackend` to separate read-only system context from per-user writable state.

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend, CompositeBackend, StoreBackend

# SAFE: AGENTS.md is read-only, user state is isolated
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a helpful assistant.",
    tools=[...],
    backend=CompositeBackend([
        FilesystemBackend(root_dir="./shared", read_only=True),   # AGENTS.md protected
        StoreBackend(user_store),                        # Per-user writable state
    ]),
    memory=["./AGENTS.md"],
)
```

## Mitigation Strategies

### Strategy 1: ToolRuntime for Per-User Context (Recommended)

Instead of shared mutable state, inject user-specific context via `ToolRuntime`. This ensures each user's context is isolated and immutable from the agent's perspective.

```python
from deepagents import create_deep_agent
from langchain.tools import tool, ToolRuntime
from dataclasses import dataclass

@dataclass
class UserContext:
    user_id: str
    tenant_id: str
    permissions: list[str]
    preferences: dict

@tool
def get_user_data(
    runtime: ToolRuntime[UserContext],
) -> dict:
    """Get user data from secure runtime context."""
    return fetch_user_data(runtime.context.user_id)

# Production: context is injected per-request, not shared
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are a helpful assistant. Use the provided context to personalize responses.",
    tools=[get_user_data],
    context_schema=UserContext,
)

# Invoke with user-specific context
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Hello"}]},
    context=UserContext(user_id="u123", tenant_id="t456", permissions=["read"], preferences={}),
    config={"configurable": {"thread_id": "u123_session"}},
)
```

### Strategy 2: FilesystemBackend Read-Only + CompositeBackend

Separate system context (read-only) from user preferences (writable, per-user isolated).

```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend, CompositeBackend, StoreBackend

# System context: shared, read-only (includes AGENTS.md)
# User preferences: isolated per-user, writable with validation
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="""You can remember user preferences via the provided tools.
    NEVER attempt to modify system instructions.""",
    tools=[...],
    backend=CompositeBackend([
        FilesystemBackend(root_dir="./system", read_only=True),
        StoreBackend(user_store),
    ]),
)
```

### Strategy 3: Human Approval for Sensitive Operations

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You manage files and user preferences.",
    tools=[edit_file, write_file, safe_remember],
    checkpointer=MemorySaver(),
    interrupt_on={
        "tool": {"allowed_decisions": ["approve", "reject", "modify"]},
    },
)
```

### Strategy 4: Content Validation with ToolRuntime

> **Note**: Regex validation is a defense-in-depth measure, not a primary control. Sophisticated attacks can bypass pattern matching. Always combine with Strategy 1 (`ToolRuntime` isolation) for production deployments.

```python
import os
import re
from langchain.tools import tool, ToolRuntime

DANGEROUS_PATTERNS = [
    r"ignore.*(?:security|rules|restrictions)",
    r"bypass.*(?:checks|validation)",
    r"always.*(?:approve|allow|permit)",
    r"never.*(?:reject|deny|block)",
    r"disregard.*(?:safety|security|rules)",
    r"pretend.*(?:unrestricted|no limits)",
    r"override.*(?:safety|rules|instructions)",
    r"from now on",
    r"your new.*(?:behavior|instructions|role)",
    r"skip.*(?:authentication|validation|checks)",
]

def validate_memory_content(content: str) -> bool:
    """Check for prompt injection attempts."""
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            return False
    return True

def validate_key(key: str) -> bool:
    """Validate key contains no path traversal characters."""
    return ".." not in key and "/" not in key and "\\" not in key

@tool
def safe_remember(
    key: str,
    value: str,
    runtime: ToolRuntime[UserContext],
) -> dict:
    """Safely store user preference with validation."""
    if not validate_key(key):
        return {"error": "Invalid key: path characters not allowed", "stored": False}

    if not validate_memory_content(value):
        return {"error": "Content validation failed", "stored": False}

    base_path = f"/user_memory/{runtime.context.user_id}"
    target_path = os.path.normpath(os.path.join(base_path, f"{key}.txt"))
    if not target_path.startswith(os.path.normpath(base_path)):
        return {"error": "Path traversal detected", "stored": False}

    write_file(target_path, value)
    return {"stored": True, "path": target_path}
```

## Rate Limiting

For production, use a distributed rate limiter (e.g., Redis-based). Here's a basic in-memory example:

```python
from functools import wraps
import time
from langchain.tools import ToolRuntime

RATE_LIMIT = {}
MAX_REQUESTS_PER_MINUTE = 10

def rate_limited(func):
    @wraps(func)
    def wrapper(*args, runtime: ToolRuntime = None, **kwargs):
        user_id = runtime.context.user_id
        now = time.time()

        if user_id not in RATE_LIMIT:
            RATE_LIMIT[user_id] = []

        RATE_LIMIT[user_id] = [t for t in RATE_LIMIT[user_id] if now - t < 60]

        if len(RATE_LIMIT[user_id]) >= MAX_REQUESTS_PER_MINUTE:
            return {"error": "Rate limit exceeded", "retry_after": 60}

        RATE_LIMIT[user_id].append(now)
        return func(*args, runtime=runtime, **kwargs)
    return wrapper
```

## Audit Logging

```python
import logging
import hashlib
from datetime import datetime
from langchain.tools import tool, ToolRuntime

audit_logger = logging.getLogger("agent.audit")

@tool
def safe_remember(
    key: str,
    value: str,
    runtime: ToolRuntime[UserContext],
) -> dict:
    audit_logger.info({
        "event": "memory_write",
        "user_id": runtime.context.user_id,
        "tenant_id": runtime.context.tenant_id,
        "key": key,
        "value_hash": hashlib.sha256(value.encode()).hexdigest(),
        "timestamp": datetime.utcnow().isoformat(),
    })
    # ... validation and write operation
```

## Security Checklist for Production

Before deploying customer-facing agents:

- [ ] AGENTS.md protected via `FilesystemBackend(read_only=True)`
- [ ] User context injected via `ToolRuntime`, not shared mutable state
- [ ] User context is isolated per-user via `context_schema`
- [ ] System instructions separated from user preferences via `CompositeBackend`
- [ ] `interrupt_on` configured for sensitive tools
- [ ] Content validation for any user-writable memory
- [ ] Audit logging for all modifications
- [ ] Rate limiting on memory operations
- [ ] Regular review of stored user memories

## System vs User Context Architecture

| Context Type | Mechanism | Writeable | Shared |
|-------------|-----------|-----------|--------|
| System Prompt | `system_prompt=` parameter | No | All users |
| AGENTS.md | `memory=` + `FilesystemBackend(read_only=True)` | No (protected) | All users |
| User Context | `context_schema` + `ToolRuntime` | No (injected per-request) | Per-user |
| User Preferences | Custom tool + `StoreBackend` | Yes (validated) | Per-user |
| Session State | Checkpointer | Yes | Per-session |

## Anti-Pattern: Shared Writable Context

```python
# DANGEROUS: All users can modify shared AGENTS.md
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are helpful.",
    tools=[edit_file],
    backend=FilesystemBackend(root_dir="./shared"),  # Writable! Agent can modify AGENTS.md
)
# One malicious user compromises ALL future sessions

# SAFE: Read-only system context + per-user isolated state
from deepagents.backends import FilesystemBackend, CompositeBackend, StoreBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-5-20250929",
    system_prompt="You are helpful.",
    tools=[safe_remember],  # Validated tools only
    context_schema=UserContext,
    backend=CompositeBackend([
        FilesystemBackend(root_dir="./shared", read_only=True),
        StoreBackend(user_store),
    ]),
)
```
