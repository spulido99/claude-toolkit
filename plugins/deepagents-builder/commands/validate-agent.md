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

Check for each anti-pattern:

#### God Agent
- **Check**: Count tools in main agent
- **Flag if**: > 30 tools without subagents
- **Severity**: High
- **Fix**: Group into platform subagents

#### Unclear Boundaries
- **Check**: Subagent descriptions
- **Flag if**: Ambiguous or overlapping descriptions
- **Severity**: Medium
- **Fix**: Make descriptions specific and distinct

#### Parallel Decision-Making
- **Check**: Subagents that could conflict
- **Flag if**: Multiple subagents can make incompatible choices
- **Severity**: High
- **Fix**: Sequential execution with handoff

#### Vocabulary Collision
- **Check**: System prompts for conflicting terms
- **Flag if**: Same term used differently across agents
- **Severity**: Medium
- **Fix**: Explicit vocabulary in each bounded context

#### One-Time Subagent
- **Check**: Subagent with 1-2 tools
- **Flag if**: Subagent overhead not justified
- **Severity**: Low
- **Fix**: Move tools to main agent

#### Premature Decomposition
- **Check**: Total task complexity vs agent complexity
- **Flag if**: Complex architecture for simple task
- **Severity**: Medium
- **Fix**: Simplify to single agent

### Step 4: Security Validation

Check for security issues:

#### User IDs as Parameters
- **Check**: Tool parameters for `user_id`, `account_id`, etc.
- **Flag if**: Sensitive IDs exposed to LLM
- **Severity**: High
- **Fix**: Use ToolRuntime for context injection

#### Missing Checkpointer
- **Check**: Checkpointer configuration
- **Flag if**: Using interrupt_on without checkpointer
- **Severity**: High
- **Fix**: Add MemorySaver() checkpointer

#### No HITL for Destructive Tools
- **Check**: Tools that delete, modify, or send
- **Flag if**: Destructive tools without interrupt_on
- **Severity**: Medium
- **Fix**: Add interrupt_on for sensitive operations

### Step 5: Best Practices Check

#### Tool Naming
- **Check**: Tool function names
- **Flag if**: Not snake_case
- **Severity**: Low

#### Docstrings
- **Check**: Tool docstrings
- **Flag if**: Missing or incomplete
- **Severity**: Low

#### Return Types
- **Check**: Tool return values
- **Flag if**: Unstructured returns
- **Severity**: Low

#### System Prompt Structure
- **Check**: Prompt completeness
- **Flag if**: Missing role, workflow, or stopping criteria
- **Severity**: Medium

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
  /tool-status — Per-tool quality scores (10-principle checklist + eval coverage)
  /assess      — Full 80-point maturity assessment with next-level path
  /evolve      — Guided refactoring to improve architecture
```
