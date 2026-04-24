# Claude Skills Marketplace

Personal marketplace of plugins, skills, and commands for Claude Code.

## Available Plugins

| Plugin | Description | Components |
|--------|-------------|------------|
| **[deepagents-builder](plugins/deepagents-builder)** | Build AI agents with LangChain's DeepAgents | 6 skills, 14 commands, 6 agents |
| **[dev-patterns](plugins/dev-patterns)** | Cross-cutting reference patterns for common tech stacks (AWS CDK + DynamoDB design + Expo / React Native) | 3 skills |
| **[digital-marketing](plugins/digital-marketing)** | Digital marketing campaigns with Chrome automation | 1 skill |
| **[linkedin-ai-voice](plugins/linkedin-ai-voice)** | LinkedIn AI thought leadership content | 1 skill |

## Installation

### Add Marketplace to Claude Code (Recommended)

```bash
# Add this marketplace from GitHub
/plugin marketplace add spulido99/claude-toolkit

# Then install any plugin
/plugin install deepagents-builder@spuli-plugins
/plugin install dev-patterns@spuli-plugins
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

### dev-patterns

Reference patterns and gotchas for common tech stacks. Progressive disclosure: a lean `SKILL.md` routes Claude to detailed reference files loaded only when needed.

**Skills (3):**
- `aws-cdk-patterns` — Opinionated architecture for AWS CDK v2 in TypeScript. Hexagonal Lambdas inside DDD modules, two-stack backend/frontend split, construct patterns for serverless APIs, Cognito with Google federated identity, S3 + CloudFront SPA hosting, Aurora Serverless v2 (scale-to-zero) and DynamoDB runtime patterns (atomic uniqueness with `TransactWriteCommand`, identity-verified updates, cursor pagination), shared utilities (`parseBody`, `withCors`, `validateEnv`, secrets loading with cold-start cache), a deploy workflow (pre-deploy checklist, stage/suffix system, CloudFront domain registration), and a gotchas catalog.
- `dynamodb-design` — Stack-agnostic methodology for designing DynamoDB schemas from access patterns. Six-step design process (inventory → classify → base keys → GSIs → validate → single-vs-multi) with greenfield/extension/migration branches, partition and sort key design, GSI projection-cost tradeoffs, adjacency list and hierarchical patterns, hot-partition mitigation (write sharding), item-size limits and S3 offload, cost modeling, optimistic locking, atomic and sharded counters, batch-ops `UnprocessedItems` retry, `TransactWriteCommand` beyond uniqueness, DynamoDB Streams with idempotent Lambda consumers and DynamoDB Streams vs EventBridge Pipes decision tree, schema evolution without downtime (add/remove GSI, attribute rename, single↔multi splits with dual-write + shadow reads), local testing (DynamoDB Local, testcontainers, LocalStack), and a gotchas catalog. Cross-references `aws-cdk-patterns/04-database.md` for the three canonical runtime patterns with full TypeScript.
- `expo-react-native` — End-to-end patterns for Expo / React Native apps in TypeScript. Managed workflow with dev client escape hatch, DDD feature-slice architecture, navigation with Expo Router (typed routes, deep linking, auth-gated stacks), state and data (Zustand + TanStack Query, MMKV persistence, offline-first sync), auth and networking (Cognito Hosted UI with `expo-auth-session` + PKCE, secure token storage, API client patterns integrating `aws-cdk-patterns` backend + `dynamodb-design` pagination), native modules and EAS Build/Submit release workflow (channels, OTA updates, provisioning), cross-platform web target (Metro + RN Web, shared vs platform-split components), performance and testing (FlatList tuning, Reanimated 3, Jest + React Native Testing Library, Maestro E2E, Detox tradeoffs), i18n and accessibility (`i18n-js`, RTL, screen reader support), observability (Sentry, analytics, crash-free sessions), monetization (RevenueCat, store compliance), and a gotchas catalog. Cross-references `aws-cdk-patterns/02-auth-stack.md` and `dynamodb-design/01-modeling.md` for backend contracts.

**Reference files — `aws-cdk-patterns` (7):** `00-architecture`, `01-serverless-api`, `02-auth-stack`, `03-static-site`, `04-database`, `05-shared-utilities`, `06-deploy-workflow`

**Reference files — `dynamodb-design` (8):** `00-methodology`, `01-modeling`, `02-scaling`, `03-write-correctness`, `04-streams-cdc`, `05-evolution`, `06-testing-local-dev`, `07-gotchas`

**Reference files — `expo-react-native` (11):** `00-architecture`, `01-navigation`, `02-state-and-data`, `03-auth-and-networking`, `04-native-and-release`, `05-cross-platform-web`, `06-performance-and-testing`, `07-i18n-and-accessibility`, `08-observability`, `09-monetization`, `10-gotchas`

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
