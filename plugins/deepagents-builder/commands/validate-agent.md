---
name: validate-agent
description: Validate a DeepAgents configuration for anti-patterns, security issues, and best practices compliance.
allowed-tools:
  - Read
  - Glob
  - Grep
argument-hint: "[file-path]"
---

# Validate Agent Configuration

Analyze agent code for anti-patterns, security issues, and best practices.

## Workflow

### Step 1: Locate Agent Code

If file path not provided:
1. Search for `agent.py`, `*_agent.py`, or files containing `create_deep_agent`
2. Ask user to confirm which file to validate

### Step 2: Parse Configuration

Extract from the code:
- Model configuration
- Tool definitions
- Subagent configurations
- System prompts
- Checkpointer usage
- interrupt_on configuration

### Step 3: Anti-Pattern Detection

Check the parsed configuration against every anti-pattern in `${CLAUDE_PLUGIN_ROOT}/skills/patterns/references/anti-patterns.md` and record each match with file, line and the fix from the catalog.

Severity: God Agent, Fragmented Writes and Parallel Decision-Making are High. Unclear Boundaries, Vocabulary Collision and Premature Decomposition are Medium. One-Time Subagent is Low. Rate any other match by impact.

### Step 4: Security Validation

Apply the security checks in section 2 of `${CLAUDE_PLUGIN_ROOT}/agents/code-reviewer.md` (user IDs as tool parameters, missing checkpointer with `interrupt_on`, destructive tools without approval) and record each match with its severity and location.

### Step 5: Best Practices Check

Apply the best-practice checks in section 3 of `${CLAUDE_PLUGIN_ROOT}/agents/code-reviewer.md` (tool naming, docstrings, return types, system prompt structure, context schema). A system prompt missing role, workflow or stopping criteria is Medium; the other best-practice findings are Low.

### Step 6: Maturity Assessment

Score the agent architecture (0-5 per category):

| Category | Score | Notes |
|----------|-------|-------|
| Structure | /5 | Subagent boundaries, alignment |
| Operations | /5 | Planning, context management |
| Measurement | /5 | Metrics, testing, docs |
| Evolution | /5 | Flexibility, feedback loops |

**Maturity Level**:
- 0-5: Level 1 (Initial)
- 6-10: Level 2 (Managed)
- 11-15: Level 3 (Defined)
- 16-20: Level 4+ (Measured)

### Step 7: Generate Report

Output validation report:

```
# Agent Validation Report

## Summary
- **File**: [path]
- **Maturity Level**: [level]
- **Issues Found**: [count]

## Critical Issues
[List high severity issues]

## Warnings
[List medium severity issues]

## Suggestions
[List low severity improvements]

## Detailed Findings
[Each issue with location and fix]

## Recommendations
[Next steps to improve]
```

### Step 8: Suggest Deeper Analysis

After the report, add:

```
For deeper analysis:
  /tool-status — Per-tool quality scores (11-principle checklist + eval coverage)
  /assess      — Full 80-point maturity assessment with next-level path
  /evolve      — Guided refactoring to improve architecture
```
