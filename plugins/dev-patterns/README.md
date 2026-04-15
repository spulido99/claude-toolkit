# dev-patterns

Cross-cutting development patterns and gotchas for common tech stacks.

## Skills included

- **`aws-cdk-patterns`** — Recommended hexagonal + DDD architecture for AWS CDK v2 in TypeScript, with validated construct patterns for serverless APIs, auth stacks, static sites, and databases. Includes shared utilities and a gotchas catalog.

## Roadmap (future skills)

- `dynamodb-design` — Access pattern design and single-table vs. multi-table decision framework.
- `expo-react-native` — PWA gotchas, navigation patterns, and state management for Expo projects.

## Installation

This plugin is part of the `claude-skills` marketplace. Install via Claude Code plugin marketplace or clone the repo and point Claude Code at the plugin directory.

## Testing the skill

Run the test harness to validate skill retrieval and application:

```bash
./plugins/dev-patterns/scripts/test-skill.sh
```

The script runs RED (baseline without skill) and GREEN (with skill loaded) phases for every scenario in `tests/scenarios.txt` and writes a diff for each scenario to a timestamped results directory. A human reviews the diffs against the success criteria in the design spec.
