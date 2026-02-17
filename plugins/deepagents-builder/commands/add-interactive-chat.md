---
name: add-interactive-chat
description: Generate an interactive chat console (chat.py) for testing your agent with tool call logging, thread management, and optional context injection.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - Bash
argument-hint: "[agent-module-path]"
---

# Interactive Chat Console Generator

Generate a `chat.py` file adapted to the user's agent for interactive testing with tool call logging, thread management, and optional context injection.

## Workflow

### Step 1: Detect Agent

Locate the agent creation function in the project.

**If module path provided in arguments:**
- Use the provided path directly
- Read the file to extract the function name and detect features

**If no path provided:**
- Search for `create_deep_agent`, `create_react_agent`, or `def create_.*agent` patterns across the project using Grep
- If **multiple matches** found: present them to the user with AskUserQuestion and ask which one to use
- If **no matches** found: ask the user for the module path and function name using AskUserQuestion
- If **one match** found: use it directly

**Extract from the detected agent file:**
- `agent_module`: the Python import path (e.g., `src.myproject.agent`)
- `agent_function`: the function name (e.g., `create_agent`)
- `has_context_schema`: whether the agent uses a `context_schema` parameter
- `has_checkpointer`: whether the agent already creates a `MemorySaver` or other checkpointer
- `has_interrupt_on`: whether the agent uses `interrupt_on` for HITL
- `has_subagents`: whether the agent defines `subagents=` dicts

### Step 2: Determine Features

Ask the user using AskUserQuestion about desired features:

1. **Context injection** (only if `context_schema` detected): "Your agent uses a context_schema. Do you want the chat console to support user context switching? (yes/no)"
2. **Verbose logging**: "Show full tool parameters or summary only? (full/summary)"
3. **Multi-user**: "Support switching between test user IDs during the session? (yes/no)"

### Step 3: Generate chat.py

Write the `chat.py` file at the project root, adapted to the detected agent. Use the following template, applying the adaptations described below.

```python
"""Interactive chat console for testing your agent."""
import uuid
import sys

from langgraph.checkpoint.memory import MemorySaver  # noqa: used if agent needs checkpointer

# --- Agent import (adapted from detection) ---
from {agent_module} import {agent_function}


def format_tool_call(tool_call: dict, verbose: bool = {verbose}) -> str:
    """Format a tool call for display."""
    name = tool_call["name"]
    args = tool_call.get("args", {})
    if verbose:
        args_str = ", ".join(f"{k}={v!r}" for k, v in args.items())
        return f"  \033[36mTool:\033[0m {name}({args_str})"
    else:
        args_summary = ", ".join(args.keys()) if args else "no args"
        return f"  \033[36mTool:\033[0m {name}({args_summary})"


def format_tool_response(msg) -> str:
    """Format tool response summary."""
    content = str(msg.content) if hasattr(msg, "content") else str(msg)
    if len(content) > 200:
        content = content[:200] + "..."
    return f"  \033[33mResult:\033[0m {content}"


def main():
    # --- Agent setup ---
    agent = {agent_function}()

    # --- Thread management ---
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    # {context_setup_block}
    # If context_schema detected:
    #   user_id = "test-user-1"
    #   context = {context_factory}
    #   (included in config or invoke)

    # {user_id_block}
    # If multi-user enabled:
    #   user_id = "test-user-1"

    print(f"\n\033[1mAgent ready.\033[0m Thread: {thread_id[:8]}...")
    print("Commands: 'exit' | 'new' (new thread){user_commands_hint}")
    print("-" * 50)

    while True:
        try:
            user_input = input("\n\033[1mYou:\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "salir"):
            print("Bye!")
            break
        if user_input.lower() in ("new", "nuevo"):
            thread_id = str(uuid.uuid4())
            config["configurable"]["thread_id"] = thread_id
            print(f"  \033[32mNew thread:\033[0m {thread_id[:8]}...")
            continue

        # {user_switch_block}
        # If multi-user enabled:
        #   if user_input.lower().startswith("user "):
        #       user_id = user_input.split(" ", 1)[1].strip()
        #       print(f"  Switched to user: {user_id}")
        #       continue

        # {context_switch_block}
        # If context injection enabled:
        #   if user_input.lower().startswith("context "):
        #       ... update context ...
        #       continue

        try:
            result = agent.invoke(
                {"messages": [{"role": "user", "content": user_input}]},
                config=config,
                # {context_invoke} — if context_schema: context=context
            )

            # Log tool calls and responses
            for msg in result["messages"]:
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    for tc in msg.tool_calls:
                        print(format_tool_call(tc))
                if hasattr(msg, "name") and msg.name:
                    print(format_tool_response(msg))

            # Final agent response
            final = result["messages"][-1].content
            print(f"\n\033[1mAgent:\033[0m {final}")

        except KeyboardInterrupt:
            print("\n  (interrupted)")
            continue
        except Exception as e:
            print(f"\n  \033[31mError:\033[0m {e}")


if __name__ == "__main__":
    main()
```

### Adaptations

Apply the following adaptations when generating the final file:

**With `context_schema` detected and context injection enabled:**
- Add context creation block after agent setup:
  ```python
  user_id = "test-user-1"
  context = {"user_id": user_id}  # Adapt to actual context_schema fields
  ```
- Add `context=context` to `agent.invoke()`
- Add a `context <json>` command for live context switching:
  ```python
  if user_input.lower().startswith("context "):
      import json
      try:
          context = json.loads(user_input.split(" ", 1)[1])
          print(f"  Context updated: {context}")
      except json.JSONDecodeError:
          print("  Invalid JSON. Use: context {\"key\": \"value\"}")
      continue
  ```

**Without checkpointer in agent:**
- Wrap the agent creation to inject a `MemorySaver`:
  ```python
  from langgraph.checkpoint.memory import MemorySaver  # noqa: used if agent needs checkpointer

  # Agent does not include a checkpointer; adding MemorySaver for thread persistence
  agent = {agent_function}(checkpointer=MemorySaver())
  ```
  Or if the function doesn't accept a checkpointer parameter, note this to the user and add `MemorySaver` inline if possible.

**Multi-user enabled:**
- Add `user_id` variable initialization
- Add the `user <id>` command handler:
  ```python
  if user_input.lower().startswith("user "):
      user_id = user_input.split(" ", 1)[1].strip()
      config["configurable"]["user_id"] = user_id
      thread_id = str(uuid.uuid4())
      config["configurable"]["thread_id"] = thread_id
      print(f"  Switched to user: {user_id} (new thread: {thread_id[:8]}...)")
      continue
  ```
- Update the commands hint to include `| 'user <id>'`

**Verbose vs summary logging:**
- Set the `verbose` default in `format_tool_call` based on user preference (`True` for full, `False` for summary)

### Step 4: Verify

After writing the file:

1. Read back `chat.py` to confirm it was written correctly
2. Print the file path to the user
3. Provide run instructions:

```bash
# Run the chat console
python chat.py

# Or with a specific module if needed
python -m chat
```

### Step 5: Usage Instructions

Show the user what to expect:

```
$ python chat.py

Agent ready. Thread: a1b2c3d4...
Commands: 'exit' | 'new' (new thread) | 'user <id>'
--------------------------------------------------

You: What's my balance?
  Tool: get_account_balances(include_details=False)
  Result: 2 accounts found

Agent: You have 2 accounts. Your checking account has $1,234.56 and your savings has $5,678.90.

You: new
  New thread: e5f6g7h8...

You: exit
Bye!
```

### Step 6: Next Steps

Suggest to the user:
- Use `/validate-agent` to check the agent for anti-patterns before testing
- Enable LangSmith tracing (`LANGSMITH_TRACING=true`) for full observability during chat sessions
- Add custom commands to the chat loop for agent-specific testing scenarios
