---
name: design-tools
description: Design an AI-friendly tool catalog from scratch. Detects agent code, discovers requirements, then generates tools following the 10 principles.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
argument-hint: "[agent-path]"
---

# Design Tool Catalog

Guide the user through designing a complete AI-friendly tool catalog using the tool-architect agent.

## Workflow

### Step 1: Detect Context

Find the project state:

1. **Find agent code**: Search for `create_agent` or `create_deep_agent` in:
   - `agent.py`, `main.py`, `src/**/*.py`
   - Path provided as argument: `$ARGUMENTS`
2. **Find existing tools**: Search for `@tool` in `domains/*/tools.py`, `tools.py`, `*_tools.py`
3. **Find API specs**: Search for `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`

Report findings:
- "Found agent at `src/agent.py` with 3 tools. No existing tool catalog."
- "Found OpenAPI spec at `api/openapi.yaml` with 15 endpoints."
- "No agent code found. We'll design tools from requirements."

### Step 2: Check Existing Catalog

If tools already exist:
1. Show inventory: count, domain groups, operation levels
2. Ask: "You already have N tools. Would you like to:"
   - **Redesign from scratch** — Replace current catalog
   - **Add incrementally** — Use `/add-tool` instead

If user chooses incremental, suggest `/add-tool` and exit.

### Step 3: Trigger Tool Architect

Hand off to the `tool-architect` agent in full mode (Phases 1-5) with context:
- Agent code location and structure (if found)
- API specs (if found)
- Project directory layout
- Any existing tool patterns detected

The tool-architect will:
1. Discover requirements interactively (Phase 1)
2. Map capabilities to domains (Phase 2)
3. Design tool specifications (Phase 3)
4. Generate code (Phase 4)
5. Verify against quality checklist (Phase 5)

### Step 4: Show Summary and EDD Next Steps

After the tool-architect finishes:

```
═══ Tool Catalog Created ═══

Created N tools across M domains:
  {domain1}: {count} tools (L1:{n} L2:{n} L3:{n} L4:{n})
  {domain2}: {count} tools (L1:{n} L2:{n})

Quality: N/N tools pass checklist

Files created:
  domains/{domain1}/tools.py
  domains/{domain1}/schemas.py
  domains/{domain2}/tools.py
  domains/{domain2}/schemas.py

Next steps:
  /tool-status    — Full quality dashboard with per-principle scoring
  /design-evals   — Create eval scenarios for your tools (EDD)
  /validate-agent — Check agent integration with new tools
```
