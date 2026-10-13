---
name: deepagents-builder
description: Entry point to the deepagents-builder plugin for building Python agents with LangChain's deepagents (`create_deep_agent`). Use when the user names deepagents-builder or deepagents, or wants to start an agent project, decide its topology, design its tools or prompts, write or run its evals, review its code, or assess and evolve it.
---

# deepagents-builder

The map of this plugin. Find the user's task in the table, then load what the row names. Skills and commands load through the Skill tool as `deepagents-builder:<name>`; agents run through the Agent tool as `subagent_type: deepagents-builder:<name>`. Each skill links its own references; read a reference whole when the skill sends you to it, since the rules sit in tables and late sections.

## Stack

- **Language and library:** Python with LangChain's `deepagents` (`create_deep_agent`). The canonical API and version notes live in `${CLAUDE_PLUGIN_ROOT}/skills/patterns/references/api-cheatsheet.md`.
- **Runtime:** the guidance holds on any runtime: local, LangGraph Platform, AWS Bedrock AgentCore, or the team's own server. Take the runtime from the project; none is the default. When the runtime is AgentCore, load `dev-patterns:bedrock-agentcore` for deploying, invoking and tracing the agent there.

## Branches

| The user wants to… | Load | Reference skill |
|---|---|---|
| Start a new agent project | `new-sdk-app` | `quickstart` |
| Design one agent (role, tools, prompt, model) | `design-agent` | `quickstart` |
| Decide topology: one agent or several, bounded contexts, subagents | `design-topology`, then `add-subagent` for each new subagent | `architecture` |
| Design tools, convert an API into tools, check tool quality | `design-tools`, `add-tool`, `tool-status` | `tool-design` |
| Write system prompts, look up the API, avoid anti-patterns | — | `patterns` |
| Define, run, or maintain evals | `design-evals`, `add-scenario`, `eval`, `eval-status`, `eval-update` | `evals` |
| Review agent code | `validate-agent`, or the `code-reviewer` agent | `patterns` |
| Measure maturity or refactor an existing agent | `assess`, `evolve` | `evolution` |
| Try the agent by hand | `add-interactive-chat` | — |

## Delegating

To hand plugin work to a subagent, use the matching agent: `agent-architect` (topology), `tool-architect` (tool catalog), `eval-designer` and `eval-runner` (evals), `code-reviewer` (review), `evolution-guide` (maturity and refactoring). For research by a general-purpose subagent, name the skills it must load in its brief, e.g. "load `deepagents-builder:architecture` with the Skill tool".
