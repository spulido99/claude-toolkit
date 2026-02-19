---
name: add-tool
description: Add a single tool to an existing catalog interactively or from an API endpoint.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[--from-api <openapi-path#endpoint>]"
---

# Add Tool

Add a single tool to an existing tool catalog, matching existing patterns and conventions.

## Workflow

### Step 1: Parse Arguments

Check `$ARGUMENTS` for mode:

- **`--from-api <path#endpoint>`**: Convert a specific API endpoint to a tool. Example: `--from-api api/openapi.yaml#/accounts/{id}/balances`
- **No arguments**: Interactive mode — ask user to describe the tool

### Step 2: Find Existing Catalog

Locate the current tool catalog:

1. Search for `@tool` functions in `domains/*/tools.py`, `tools.py`, `*_tools.py`
2. Search for MCP tool definitions in `*.json` files
3. Parse: tool names, domains, operation levels, parameter patterns, naming conventions

If no catalog found:
```
No existing tool catalog found.
→ Run /design-tools to create a tool catalog from scratch.
```
Exit.

If catalog found, report: "Found N tools across M domains: [list]."

### Step 3a: From API Endpoint

If `--from-api` was provided:

1. **Load OpenAPI spec**: Parse the YAML/JSON file
2. **Extract endpoint**: Find the specified endpoint path and method
3. **Map to tool**: Apply the 10 principles to convert the endpoint:
   - Semantic name from path + operation (not HTTP method)
   - Trigger phrases from description
   - Structured parameters from schema
   - Operation level from method (GET→L1, POST→L2, PUT/PATCH→L3, DELETE→L5)
4. **Show proposed mapping**: Present the tool spec for approval
5. **Ask for adjustments**: Domain assignment, name changes, additional trigger phrases
6. **Generate code**: Match existing catalog format (Python `@tool` or MCP JSON)

### Step 3b: Interactive Mode

If no `--from-api`:

Trigger the `tool-architect` agent in incremental mode (Phase 6):
1. Read existing catalog for patterns (Step 6.1)
2. Gather requirements one question at a time (Step 6.2)
3. Design tool matching existing conventions (Step 6.3)
4. Generate and insert code (Step 6.4)
5. Verify against quality checklist (Step 6.5)

### Step 4: Confirm and Connect to EDD

After the tool is added:

```
Tool '{name}' added to domains/{domain}/tools.py
Operation level: {level}
Quality checklist: PASS ({n}/{n})

Next:
  /add-scenario  — Add eval scenario for this tool (EDD)
  /tool-status   — Full catalog quality dashboard
```
