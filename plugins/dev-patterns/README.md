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

Run the test harness to validate skill retrieval and application. Pick the variant for your shell:

**Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\scripts\test-skill.ps1
```

**Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/scripts/test-skill.sh
```

Both variants run the same two phases for every scenario in `tests/scenarios.txt`:

- **RED** — `claude -p --disable-slash-commands <prompt>` (baseline without any skill loaded)
- **GREEN** — `claude -p --plugin-dir <plugin> --add-dir <plugin> --setting-sources project <prompt>` (dev-patterns loaded in isolation, reference files readable)

Per-scenario outputs and unified diffs are written to a timestamped directory (`/tmp/aws-cdk-skill-test-<ts>/` on Unix, `$env:TEMP\aws-cdk-skill-test-<ts>\` on Windows). A human reviews the diffs against the success criteria in the design spec.

**IMPORTANT:** Do not run these scripts from inside an active Claude Code session. `claude -p` spawned recursively from another Claude Code session deadlocks on interactive prompts. Use a plain terminal.
