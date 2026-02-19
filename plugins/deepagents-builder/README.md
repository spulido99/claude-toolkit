# DeepAgents Builder

Build production-ready AI agents with LangGraph. This plugin provides skills, agents, and commands for designing, implementing, testing, and evolving agent systems.

## Day-to-Day Usage for AI Engineers

The plugin follows an **Evals-Driven Development (EDD)** workflow: define what success looks like first, build to pass those evals, then iterate. Here's how a typical day looks:

### Starting a new agent project

```
/new-sdk-app my-agent
```

Scaffolds the project with dependencies, agent code, prompts, tools, and a chat console. After scaffolding, follow the suggested EDD workflow:

```
/design-topology       → Define agent architecture (if multi-agent)
/design-tools          → Create AI-friendly tool catalog
/add-interactive-chat  → Test the agent manually
/design-evals          → Create eval scenarios from JTBD (start early)
```

### Designing tools

When your agent needs new capabilities:

```
/design-tools                              → Full catalog from scratch
/add-tool                                  → Add one tool interactively
/add-tool --from-api api/openapi.yaml#/endpoint  → Convert an API endpoint
/tool-status                               → Quality dashboard (10-principle scores + eval coverage)
```

The workflow cycles: design tools → check quality → fix issues → add eval scenarios.

### Testing with evals

EDD is the core loop. Every change should be validated:

```
/design-evals          → Scaffold eval suite from jobs-to-be-done
/add-scenario          → Add a single scenario (interactive or from trace)
/eval                  → Run evals (snapshot | --smoke | --full | --report | --diagnose)
/eval-status           → Dataset health dashboard
/eval-update           → Review changed snapshots
```

Run `/eval` before and after any refactoring to catch regressions.

### Validating and evolving

As the agent grows, assess its architecture and evolve it:

```
/validate-agent        → Quick anti-pattern and security check
/assess                → Full 80-point maturity assessment (4 categories, 5 levels)
/evolve                → Guided refactoring to the next maturity level
```

`/assess` tells you where you are. `/evolve` walks you through specific refactoring patterns (extract platform, split bounded context, merge subagents, etc.) with before/after scoring.

### Typical workflow in one session

```
# Morning: working on a banking agent
/assess src/agent.py                → Level 2, score 35/80
/evolve src/agent.py                → Recommends "Extract Platform" pattern
                                       Guides step-by-step, re-scores after

# After refactoring
/eval                               → Verify no regressions
/tool-status                        → Check tool quality scores
/add-tool                           → Add new "dispute_transaction" tool
/add-scenario                       → Create eval scenario for the new tool
/eval --smoke                       → Quick smoke test
```

## Skills

| Skill | Description | Key Commands |
|-------|-------------|--------------|
| **quickstart** | Getting started with DeepAgents | `/new-sdk-app` |
| **architecture** | Agent topologies and bounded contexts | `/design-topology` |
| **patterns** | System prompts, tool design, anti-patterns | — |
| **tool-design** | AI-friendly tool design (10 principles) | `/design-tools`, `/add-tool`, `/tool-status` |
| **evals** | Evals-Driven Development workflow | `/design-evals`, `/eval`, `/add-scenario`, `/eval-status`, `/eval-update` |
| **evolution** | Maturity model and refactoring | `/assess`, `/evolve` |

## Agents

| Agent | Description |
|-------|-------------|
| **agent-architect** | Designs agent topologies based on business capabilities and Team Topologies |
| **code-reviewer** | Reviews agent code for anti-patterns, security issues, and best practices |
| **tool-architect** | Designs and generates AI-friendly tool catalogs (full or incremental mode) |
| **eval-designer** | Creates eval scenarios from JTBD with happy path, edge case, and failure coverage |
| **eval-runner** | Executes eval suites, generates snapshots, diagnoses failures |
| **evolution-guide** | Assesses agent maturity (80-point scoring) and guides architecture refactoring |

## Commands

### Build

| Command | Description |
|---------|-------------|
| `/new-sdk-app` | Scaffold a new DeepAgents project |
| `/design-topology` | Interactive guide to design agent topology |
| `/design-tools` | Design a complete AI-friendly tool catalog |
| `/add-tool` | Add a single tool to an existing catalog |
| `/add-interactive-chat` | Generate an interactive chat console |

### Test (EDD)

| Command | Description |
|---------|-------------|
| `/design-evals` | Scaffold eval suite from jobs-to-be-done |
| `/eval` | Run evals (snapshot, --smoke, --full, --report, --diagnose) |
| `/add-scenario` | Add eval scenario interactively or from trace |
| `/eval-status` | Eval dataset health dashboard |
| `/eval-update` | Review changed eval snapshots |

### Validate & Evolve

| Command | Description |
|---------|-------------|
| `/validate-agent` | Check agent code for anti-patterns and security issues |
| `/tool-status` | Tool quality dashboard (10-principle scoring + eval coverage) |
| `/assess` | Architecture maturity assessment (80-point, 4 categories) |
| `/evolve` | Guided refactoring to next maturity level |

## Key References

- `skills/patterns/references/api-cheatsheet.md` — Canonical API reference for `create_deep_agent`
- `skills/tool-design/references/tool-quality-checklist.md` — 10-principle quality checklist for tools
- `skills/evolution/references/maturity-model.md` — Complete 5-level maturity model
- `skills/evolution/references/refactoring-patterns.md` — 9 refactoring patterns

## License

MIT
