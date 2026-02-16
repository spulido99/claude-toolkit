# Security Patterns for Customer-Facing Agents

When deploying agents to end users, additional security measures are required beyond the base security model.

## AGENTS.md Write Protection

The pattern "agent can update AGENTS.md via `edit_file`" is **dangerous for customer-facing agents**. This creates a **Persistent Prompt Injection** vulnerability:

```
Malicious user → Tricks agent → Writes to AGENTS.md
→ Malicious content persists → Affects ALL future sessions
```

## Mitigation Strategies

### Strategy 1: Read-Only AGENTS.md (Recommended)

```python
from deepagents import create_deep_agent
import os

# Production: AGENTS.md is read-only, loaded via memory
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Read-only injection
    # Do NOT give edit_file access to AGENTS.md paths
)

# Defense-in-depth: Also protect at filesystem level
os.chmod("./.deepagents/AGENTS.md", 0o444)  # Read-only at OS level
```

For additional enforcement, use path-based restrictions in your backend:

```python
from deepagents.backends import CompositeBackend, StateBackend, ReadOnlyBackend

agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            ".deepagents/": ReadOnlyBackend(),  # Enforced read-only
        },
    ),
)
```

### Strategy 2: Separate User Memory from System Context

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend

# System context: read-only AGENTS.md
# User memory: isolated in /user_memory/ (per-user, not shared)
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # System context (read-only)
    backend=CompositeBackend(
        default=StateBackend(),
        routes={
            "/user_memory/": StoreBackend(),  # User-specific, isolated
        },
    ),
    system_prompt="""You can remember user preferences in /user_memory/.
    NEVER modify files in .deepagents/ directory."""
)
```

### Strategy 3: Human Approval for Context Modifications

```python
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    checkpointer=MemorySaver(),
    interrupt_on={
        "edit_file": {
            "paths": ["**/AGENTS.md", "**/.deepagents/**"],
            "allowed_decisions": ["approve", "reject"]
        },
        "write_file": {
            "paths": ["**/AGENTS.md", "**/.deepagents/**"],
            "allowed_decisions": ["approve", "reject"]
        }
    }
)
```

### Strategy 4: Content Validation Wrapper

> **Note**: Regex validation is a defense-in-depth measure, not a primary control. Sophisticated attacks can bypass pattern matching. Always combine with Strategy 1 (read-only AGENTS.md) for production deployments.

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
def safe_remember(key: str, value: str, runtime: ToolRuntime) -> dict:
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

RATE_LIMIT = {}
MAX_REQUESTS_PER_MINUTE = 10

def rate_limited(func):
    @wraps(func)
    def wrapper(*args, runtime=None, **kwargs):
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

audit_logger = logging.getLogger("deepagents.audit")

@tool
def safe_remember(key: str, value: str, runtime: ToolRuntime) -> dict:
    audit_logger.info({
        "event": "memory_write",
        "user_id": runtime.context.user_id,
        "tenant_id": getattr(runtime.context, "tenant_id", "default"),
        "key": key,
        "value_hash": hashlib.sha256(value.encode()).hexdigest(),
        "timestamp": datetime.utcnow().isoformat(),
    })
    # ... validation and write operation
```

## Security Checklist for Production

Before deploying customer-facing agents:

- [ ] AGENTS.md is read-only (no edit_file access)
- [ ] User memory is isolated per-user (not shared)
- [ ] System context separated from user preferences
- [ ] `interrupt_on` configured for sensitive paths
- [ ] Content validation for any user-writable memory
- [ ] Audit logging for all file modifications
- [ ] Rate limiting on memory operations
- [ ] Regular review of stored user memories

## System vs User Context Architecture

| Context Type | Storage | Writeable | Shared |
|-------------|---------|-----------|--------|
| System Prompt | Code | No | All users |
| AGENTS.md | File | No (prod) | All users |
| User Preferences | StoreBackend | Yes (validated) | Per-user |
| Session State | StateBackend | Yes | Per-session |

## Anti-Pattern: Shared Writable Context

```python
# ❌ DANGEROUS: All users can modify shared AGENTS.md
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],
    tools=[edit_file],  # Agent can modify AGENTS.md!
)
# One malicious user compromises ALL future sessions

# ✅ SAFE: User memory isolated, AGENTS.md read-only
agent = create_deep_agent(
    memory=["./.deepagents/AGENTS.md"],  # Read-only
    backend=CompositeBackend(
        default=StateBackend(),
        routes={f"/users/{user_id}/": StoreBackend()},  # Isolated
    ),
)
```
