# Claude Skills Marketplace

Personal marketplace of plugins, skills, and commands for Claude Code.

## Available Plugins

| Plugin | Description | Components |
|--------|-------------|------------|
| **[deepagents-builder](plugins/deepagents-builder)** | Build AI agents with LangChain's DeepAgents | 6 skills, 14 commands, 6 agents |
| **[digital-marketing](plugins/digital-marketing)** | Digital marketing campaigns with Chrome automation | 1 skill |
| **[linkedin-ai-voice](plugins/linkedin-ai-voice)** | LinkedIn AI thought leadership content | 1 skill |

## Installation

### Add Marketplace to Claude Code (Recommended)

```bash
# Add this marketplace from GitHub
/plugin marketplace add spulido99/claude-toolkit

# Then install any plugin
/plugin install deepagents-builder@spuli-plugins
/plugin install digital-marketing@spuli-plugins
/plugin install linkedin-ai-voice@spuli-plugins
```

Or use the interactive plugin manager:
```bash
/plugin
```
Then go to **Discover** tab to browse and install.

### Alternative: Clone and Use Locally

```bash
# Clone the repository
git clone https://github.com/spulido99/claude-toolkit.git

# Add as local marketplace
/plugin marketplace add ./claude-skills

# Or use a specific plugin directly
claude --plugin-dir ./claude-skills/plugins/deepagents-builder
```

### Alternative: Copy to Project

```bash
# Copy plugin to your project
cp -r plugins/deepagents-builder /path/to/your/project/.claude-plugin/
```

## Plugin Details

### deepagents-builder

Build production-ready AI agents with LangChain's DeepAgents framework. Follows an Evals-Driven Development (EDD) workflow.

**Skills (6):**
- `quickstart` — Get started quickly
- `architecture` — Design agent topologies
- `patterns` — Prompts, tools, security
- `tool-design` — AI-friendly tool design (10 principles)
- `evals` — Evals-Driven Development
- `evolution` — Maturity model and refactoring

**Commands (14):** Build (`/new-sdk-app`, `/design-topology`, `/design-tools`, `/add-tool`, `/add-interactive-chat`), Test (`/design-evals`, `/eval`, `/add-scenario`, `/eval-status`, `/eval-update`), Validate & Evolve (`/validate-agent`, `/tool-status`, `/assess`, `/evolve`)

**Agents (6):** `agent-architect`, `code-reviewer`, `tool-architect`, `eval-designer`, `eval-runner`, `evolution-guide`

### digital-marketing

Help users create and manage digital marketing campaigns.

**Skills:**
- Complete marketing workflow guidance

### linkedin-ai-voice

Become a LinkedIn Top Voice on AI topics.

**Skills:**
- Content generation and optimization

## Repository Structure

```
claude-skills/
├── .claude-plugin/
│   └── marketplace.json  # Marketplace definition
├── plugins/
│   ├── deepagents-builder/
│   ├── digital-marketing/
│   └── linkedin-ai-voice/
├── skills/           # Standalone skills
├── commands/         # Standalone commands
└── README.md
```

## Creating Your Own Plugin

1. Create a folder in `plugins/`
2. Add `.claude-plugin/plugin.json` manifest
3. Add your components (skills/, commands/, agents/)
4. Update `marketplace.json`
5. Submit a PR

See [Plugin Development Guide](https://docs.anthropic.com/claude-code/plugins) for details.

## Contributing

1. Fork this repository
2. Create your plugin in `plugins/`
3. Document usage in the plugin's README
4. Update `marketplace.json`
5. Open a PR

## License

MIT
