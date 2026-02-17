# Security Patterns for Customer-Facing Agents

When deploying agents to end users, additional security measures are required beyond the base security model.

## Shared Mutable State Protection

The pattern "agent can update shared context via tools" is **dangerous for customer-facing agents**. This creates a **Persistent Prompt Injection** vulnerability:

```
Malicious user -> Tricks agent -> Writes to shared context
-> Malicious content persists -> Affects ALL future sessions
```

## Mitigation Strategies

### Strategy 1: Use `context_schema` for User-Specific Context (Recommended)

Instead of shared mutable state, inject user-specific context via `context_schema`. This ensures each user's context is isolated and immutable from the agent's perspective.

```python
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel

class UserContext(BaseModel):
    user_id: str
    tenant_id: str
    permissions: list[str]
    preferences: dict

# Production: context is injected per-request, not shared
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    prompt="You are a helpful assistant. Use the provided context to personalize responses.",
    context_schema=UserContext,
)

# Invoke with user-specific context
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Hello"}]},
    config={"configurable": {"user_id": "u123", "tenant_id": "t456", "permissions": ["read"], "preferences": {}}},
)
```

### Strategy 2: Separate User Memory from System Context

```python
from langgraph.prebuilt import create_react_agent
from pydantic import BaseModel

class UserMemoryContext(BaseModel):
    user_id: str
    system_instructions: str  # Read-only system context
    user_preferences: dict    # Per-user, isolated

# System context is injected as read-only via context_schema
# User preferences are isolated per-user
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[...],
    prompt="""You can remember user preferences via the provided tools.
    NEVER attempt to modify system instructions.""",
    context_schema=UserMemoryContext,
)
```

### Strategy 3: Human Approval for Sensitive Operations

```python
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[edit_file, write_file, safe_remember],
    checkpointer=MemorySaver(),
    interrupt_before=["edit_file", "write_file"],
)
```

### Strategy 4: Content Validation Wrapper

> **Note**: Regex validation is a defense-in-depth measure, not a primary control. Sophisticated attacks can bypass pattern matching. Always combine with Strategy 1 (`context_schema` isolation) for production deployments.

```python
import os
import re
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState
from typing import Annotated

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
def safe_remember(key: str, value: str, state: Annotated[dict, InjectedState]) -> dict:
    """Safely store user preference with validation."""
    if not validate_key(key):
        return {"error": "Invalid key: path characters not allowed", "stored": False}

    if not validate_memory_content(value):
        return {"error": "Content validation failed", "stored": False}

    base_path = f"/user_memory/{state.get('user_id')}"
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
from langgraph.prebuilt import InjectedState
from typing import Annotated

RATE_LIMIT = {}
MAX_REQUESTS_PER_MINUTE = 10

def rate_limited(func):
    @wraps(func)
    def wrapper(*args, state: Annotated[dict, InjectedState] = None, **kwargs):
        user_id = state.get("user_id")
        now = time.time()

        if user_id not in RATE_LIMIT:
            RATE_LIMIT[user_id] = []

        RATE_LIMIT[user_id] = [t for t in RATE_LIMIT[user_id] if now - t < 60]

        if len(RATE_LIMIT[user_id]) >= MAX_REQUESTS_PER_MINUTE:
            return {"error": "Rate limit exceeded", "retry_after": 60}

        RATE_LIMIT[user_id].append(now)
        return func(*args, state=state, **kwargs)
    return wrapper
```

## Audit Logging

```python
import logging
import hashlib
from datetime import datetime
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState
from typing import Annotated

audit_logger = logging.getLogger("agent.audit")

@tool
def safe_remember(key: str, value: str, state: Annotated[dict, InjectedState]) -> dict:
    audit_logger.info({
        "event": "memory_write",
        "user_id": state.get("user_id"),
        "tenant_id": state.get("tenant_id", "default"),
        "key": key,
        "value_hash": hashlib.sha256(value.encode()).hexdigest(),
        "timestamp": datetime.utcnow().isoformat(),
    })
    # ... validation and write operation
```

## Security Checklist for Production

Before deploying customer-facing agents:

- [ ] System context injected via `context_schema` (not shared mutable state)
- [ ] User context is isolated per-user via `context_schema`
- [ ] System instructions separated from user preferences
- [ ] `interrupt_before` configured for sensitive tools
- [ ] Content validation for any user-writable memory
- [ ] Audit logging for all modifications
- [ ] Rate limiting on memory operations
- [ ] Regular review of stored user memories

## System vs User Context Architecture

| Context Type | Mechanism | Writeable | Shared |
|-------------|-----------|-----------|--------|
| System Prompt | `prompt=` parameter | No | All users |
| User Context | `context_schema` | No (injected per-request) | Per-user |
| User Preferences | Custom tool + store | Yes (validated) | Per-user |
| Session State | Checkpointer | Yes | Per-session |

## Anti-Pattern: Shared Writable Context

```python
# DANGEROUS: All users can modify shared state
agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[edit_file],  # Agent can modify shared context!
)
# One malicious user compromises ALL future sessions

# SAFE: User context isolated via context_schema
from pydantic import BaseModel

class UserContext(BaseModel):
    user_id: str
    preferences: dict

agent = create_react_agent(
    model="anthropic:claude-sonnet-4-20250514",
    tools=[safe_remember],  # Validated tools only
    context_schema=UserContext,  # Per-user isolation
)
```
