# AWS CDK Patterns Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `dev-patterns` plugin with the `aws-cdk-patterns` skill — 7 reference files, a SKILL.md, a test harness, and RED/GREEN/REFACTOR validation — based on the design spec at `plans/2026-04-14-aws-cdk-patterns-skill-design.md`.

**Architecture:** New plugin under `plugins/dev-patterns/`. Skill uses progressive disclosure (lean SKILL.md + references loaded as needed). Content is self-contained and generic. Testing uses `claude -p` with `--plugin-dir` isolation and `--disable-slash-commands` for baseline.

**Tech Stack:** Markdown (SKILL.md + references), JSON (plugin.json, marketplace.json), Bash (test-skill.sh), YAML frontmatter, context7 MCP for CDK API validation.

**Source of truth:** `plans/2026-04-14-aws-cdk-patterns-skill-design.md` (the design spec). When this plan references "the spec", it means that file. All content decisions are documented there.

---

## Phase 1: Plugin scaffolding

### Task 1: Create plugin structure and manifests

**Files:**
- Create: `plugins/dev-patterns/.claude-plugin/plugin.json`
- Create: `plugins/dev-patterns/README.md`
- Create: `plugins/dev-patterns/scripts/` (empty directory marker)
- Create: `plugins/dev-patterns/tests/` (empty directory marker)
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/` (empty directory marker)
- Modify: `.claude-plugin/marketplace.json` (add dev-patterns entry)

- [ ] **Step 1: Create directory structure**

Run:
```bash
mkdir -p plugins/dev-patterns/.claude-plugin
mkdir -p plugins/dev-patterns/scripts
mkdir -p plugins/dev-patterns/tests
mkdir -p plugins/dev-patterns/skills/aws-cdk-patterns/references
```

Expected: all directories exist. Verify with `ls plugins/dev-patterns/`.

- [ ] **Step 2: Write plugin.json**

Create `plugins/dev-patterns/.claude-plugin/plugin.json`:

```json
{
  "name": "dev-patterns",
  "version": "1.0.0",
  "description": "Cross-cutting development patterns and gotchas for common tech stacks. Starts with AWS CDK; designed to grow with additional reference skills (dynamodb-design, expo-react-native).",
  "author": { "name": "spuli" },
  "keywords": ["patterns", "aws", "cdk", "infrastructure", "reference"]
}
```

- [ ] **Step 3: Write README.md**

Create `plugins/dev-patterns/README.md`:

```markdown
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
```

- [ ] **Step 4: Register plugin in marketplace.json**

Read `.claude-plugin/marketplace.json` to see the existing structure, then add a new plugin entry for `dev-patterns` following the exact format of the existing three plugins (deepagents-builder, digital-marketing, linkedin-ai-voice). The entry must include the same fields and pattern as the existing entries.

- [ ] **Step 5: Verify the marketplace JSON is valid**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json', 'utf-8')); console.log('valid')"
```

Expected output: `valid`

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('plugins/dev-patterns/.claude-plugin/plugin.json', 'utf-8')); console.log('valid')"
```

Expected output: `valid`

- [ ] **Step 6: Commit**

```bash
git add plugins/dev-patterns/ .claude-plugin/marketplace.json
git commit -m "$(cat <<'EOF'
feat(dev-patterns): scaffold plugin with aws-cdk-patterns skill structure

Creates the dev-patterns plugin as an umbrella for cross-cutting reference
skills. Starts with empty aws-cdk-patterns skill directory — content is
added in subsequent commits. Registered in marketplace.json.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Test infrastructure (before any skill content)

### Task 2: Validate `--disable-slash-commands` flag behavior

**Context:** The spec's RED phase relies on `--disable-slash-commands` disabling **all** skill discovery (not only slash invocation). This must be verified before writing the test scenarios. If the flag only disables slash commands, the RED phase needs an alternative isolation strategy.

**Files:** None created in this task. This is an experiment that informs the test script.

- [ ] **Step 1: Pick a known skill to probe**

Choose an existing skill with a description that should trigger automatically for a generic prompt. A good candidate is `superpowers:brainstorming` — its description is specific enough to trigger when the prompt mentions feature design. Any skill with a well-known trigger works.

- [ ] **Step 2: Probe with the flag enabled**

From a clean temporary workspace:

```bash
mkdir -p /tmp/cdk-skill-flag-test
cd /tmp/cdk-skill-flag-test
claude -p --disable-slash-commands "I want to brainstorm how to design a new feature for my app. Walk me through it." \
  > /tmp/flag-test-disabled.txt
```

- [ ] **Step 3: Probe without the flag**

Same workspace, same prompt:

```bash
claude -p "I want to brainstorm how to design a new feature for my app. Walk me through it." \
  > /tmp/flag-test-enabled.txt
```

- [ ] **Step 4: Compare outputs**

Run:
```bash
diff /tmp/flag-test-disabled.txt /tmp/flag-test-enabled.txt
```

**Decision criteria:**
- If the "enabled" version mentions the brainstorming skill workflow (sections, visual companion, design approval gate) AND the "disabled" version does not, the flag disables auto-discovery. Proceed with the spec's original plan.
- If both versions behave similarly (no brainstorming workflow triggered in either), the flag only affects slash invocation. Use the alternative strategy in Step 5.

- [ ] **Step 5: Alternative strategy if the flag is insufficient**

If Step 4 shows the flag does not disable auto-discovery, update the RED phase approach in the test script to use an empty plugin directory plus project-local settings:

```bash
# Alternative RED strategy
mkdir -p /tmp/empty-plugin-dir
claude -p --plugin-dir /tmp/empty-plugin-dir --setting-sources project "<prompt>"
```

Verify this alternative by repeating Step 2-4 with the alternative command. If this also fails to isolate, document the finding and proceed with whichever approach produces the cleanest baseline — the goal is that RED is systematically worse than GREEN, not that RED has literally zero skill influence.

- [ ] **Step 6: Document the finding in the test script header**

Whichever approach works, add a comment at the top of `test-skill.sh` (written in Task 4) explaining the choice and linking to this experiment. No commit yet — the finding is used in Task 4.

### Task 3: Write scenarios.txt

**Files:**
- Create: `plugins/dev-patterns/tests/scenarios.txt`

- [ ] **Step 1: Write the 9 scenarios**

Create `plugins/dev-patterns/tests/scenarios.txt`:

```
Estoy empezando un proyecto CDK nuevo para un backend serverless. Cómo organizo el código de mis Lambdas?
Estoy haciendo un CDK stack con Lambda + DynamoDB. Cómo defino los LogGroups?
Mi Cognito con Google federated identity tira "Identity provider does not exist". Qué hago?
Quiero garantizar unicidad de email en DynamoDB. Cómo lo hago sin race conditions?
Cómo parseo el body de un request Lambda de forma segura?
Starting a new CDK project with several domain modules. How should I structure it?
Setting up an S3 + CloudFront static site and getting "Access denied from bucket policy" — what's wrong?
Preparing a cdk deploy to prod. Give me the pre-deploy checklist.
I want to separate my CDK stack into stateful and stateless. How should I split resources?
```

One scenario per line. No blank lines between. No leading/trailing whitespace on any line.

- [ ] **Step 2: Verify the file**

Run:
```bash
wc -l plugins/dev-patterns/tests/scenarios.txt
```

Expected: `9 plugins/dev-patterns/tests/scenarios.txt`

- [ ] **Step 3: Commit**

```bash
git add plugins/dev-patterns/tests/scenarios.txt
git commit -m "$(cat <<'EOF'
test(dev-patterns): add 9 retrieval scenarios for aws-cdk-patterns

Mixed Spanish and English scenarios covering architecture discovery,
gotchas, shared utilities, atomic uniqueness, and the anti-dogma test
for stateful/stateless separation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4: Write test-skill.sh

**Files:**
- Create: `plugins/dev-patterns/scripts/test-skill.sh`

- [ ] **Step 1: Write the script**

Create `plugins/dev-patterns/scripts/test-skill.sh`:

```bash
#!/usr/bin/env bash
# Test harness for aws-cdk-patterns skill retrieval.
#
# Runs 9 scenarios from tests/scenarios.txt in two phases:
#   RED   — without the skill loaded (baseline)
#   GREEN — with only dev-patterns loaded via --plugin-dir
#
# Writes per-scenario results + diffs to a timestamped results directory.
# A human reviews the diffs against success criteria in the design spec.
#
# Isolation strategy: RED phase uses --disable-slash-commands (verified to
# disable auto-discovery during Task 2 of the implementation plan). If that
# check fails on a given environment, fall back to --plugin-dir /tmp/empty-dir.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/dev-patterns"
SCENARIOS_FILE="$PLUGIN_DIR/tests/scenarios.txt"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="/tmp/aws-cdk-skill-test-$TIMESTAMP"
WORKSPACE="/tmp/aws-cdk-skill-workspace-$TIMESTAMP"

mkdir -p "$RESULTS_DIR"/{red,green,diff}
mkdir -p "$WORKSPACE"

if [[ ! -f "$SCENARIOS_FILE" ]]; then
  echo "Error: scenarios file not found at $SCENARIOS_FILE" >&2
  exit 1
fi

if [[ ! -d "$PLUGIN_DIR/skills/aws-cdk-patterns" ]]; then
  echo "Error: aws-cdk-patterns skill directory not found at $PLUGIN_DIR/skills/aws-cdk-patterns" >&2
  exit 1
fi

mapfile -t SCENARIOS < "$SCENARIOS_FILE"

echo "Running ${#SCENARIOS[@]} scenarios"
echo "Results: $RESULTS_DIR"
echo "Workspace: $WORKSPACE"
echo ""

cd "$WORKSPACE"

for i in "${!SCENARIOS[@]}"; do
  idx=$(printf "%02d" $((i+1)))
  prompt="${SCENARIOS[$i]}"
  echo "=== Scenario $idx ==="
  echo "Prompt: $prompt"

  echo "  RED phase..."
  claude -p --disable-slash-commands "$prompt" \
    > "$RESULTS_DIR/red/scenario-$idx.txt" 2>&1 || true

  echo "  GREEN phase..."
  claude -p \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    "$prompt" \
    > "$RESULTS_DIR/green/scenario-$idx.txt" 2>&1 || true

  diff -u \
    "$RESULTS_DIR/red/scenario-$idx.txt" \
    "$RESULTS_DIR/green/scenario-$idx.txt" \
    > "$RESULTS_DIR/diff/scenario-$idx.diff" 2>&1 || true

  red_bytes=$(wc -c < "$RESULTS_DIR/red/scenario-$idx.txt")
  green_bytes=$(wc -c < "$RESULTS_DIR/green/scenario-$idx.txt")
  echo "  RED:   $red_bytes bytes"
  echo "  GREEN: $green_bytes bytes"
  echo ""
done

echo "All scenarios complete."
echo "Review diffs at: $RESULTS_DIR/diff/"
```

- [ ] **Step 2: Make the script executable**

Run:
```bash
chmod +x plugins/dev-patterns/scripts/test-skill.sh
```

- [ ] **Step 3: Verify the script runs with error handling**

Run without the skill content (it should fail with a clear error because skill files do not exist yet):

```bash
plugins/dev-patterns/scripts/test-skill.sh
```

Expected: script exits with a clear error about missing skill directory files, or runs the scenarios against an empty skill and produces near-identical RED/GREEN output. Either outcome is acceptable at this point — the script works end-to-end.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/scripts/test-skill.sh
git commit -m "$(cat <<'EOF'
test(dev-patterns): add test-skill.sh RED/GREEN harness

Runs every scenario in tests/scenarios.txt with and without the
dev-patterns plugin loaded, produces per-scenario diffs for human review.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5: Run RED phase baseline (before any skill content)

**Context:** Capture the baseline behavior before the skill exists, so there is a clear artifact to compare against. At this point the skill directory is empty, so both RED and GREEN should produce similar output — the baseline is still meaningful because it documents what Claude knows without the skill.

**Files:** None modified. Produces `/tmp/aws-cdk-skill-test-<timestamp>/red/` artifacts.

- [ ] **Step 1: Run the test harness**

Run:
```bash
plugins/dev-patterns/scripts/test-skill.sh
```

Expected: script runs to completion, prints "All scenarios complete", and reports a results directory path.

- [ ] **Step 2: Record the baseline directory path**

Save the results directory path. Example: `/tmp/aws-cdk-skill-test-20260414-100000`. Reference it in the iteration phase (Task 15+) to compare against the post-skill GREEN phase.

- [ ] **Step 3: Inspect one baseline response**

Run:
```bash
cat /tmp/aws-cdk-skill-test-<timestamp>/red/scenario-01.txt
```

Expected: Claude produced some generic answer from training data. Note whether it mentions hexagonal architecture, DDD modules, or the shared utilities. This is the baseline to beat.

- [ ] **Step 4: No commit**

RED baseline lives in `/tmp` intentionally. Do not commit test artifacts — the scenarios and script are the reproducible parts; artifacts are regenerated each run.

---

## Phase 3: Write the skill content

**Writing order (enforced by dependencies):**

1. `SKILL.md` draft (Task 6) — reference index fills in as files are written.
2. `00-architecture.md` (Task 7) — foundational, everything else references it.
3. `05-shared-utilities.md` (Task 8) — utilities referenced by 01, 02, 04.
4. `01-serverless-api.md` (Task 9).
5. `02-auth-stack.md` (Task 10).
6. `03-static-site.md` (Task 11).
7. `04-database.md` (Task 12).
8. `06-deploy-workflow.md` (Task 13).
9. `SKILL.md` finalization (Task 14).

**Content source of truth:** Every task in this phase pulls its content from the corresponding "Content plan per reference file" section of the design spec (`plans/2026-04-14-aws-cdk-patterns-skill-design.md`). The spec is authoritative for what goes in each file. This plan is authoritative for how and in what order.

**Context7 validation rule:** Before writing any CDK construct template in a reference file, verify the current API surface via `mcp__plugin_context7_context7__query-docs` for the `aws-cdk-lib` library. If the memory-based pattern conflicts with current library state, use current library state and add a note in the implementation log (not in the skill itself).

### Task 6: Draft SKILL.md (frontmatter + body structure)

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md`

- [ ] **Step 1: Write the complete SKILL.md**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md`:

```markdown
---
name: AWS CDK Patterns
description: Use when writing AWS CDK code in TypeScript — starting a new CDK project, building serverless APIs with Lambda and DynamoDB, adding authentication with Cognito, hosting a single-page app on S3 and CloudFront, designing DynamoDB access patterns, writing Lambda handlers, or running CDK deploys. Provides a recommended hexagonal + DDD architecture, validated construct patterns, shared utilities, and a catalog of known gotchas.
---

# AWS CDK Patterns

Reference skill for building AWS infrastructure with CDK v2 in TypeScript.
Recommends a hexagonal architecture with DDD modules, documents construct
patterns for common use cases, and catalogs known gotchas.

## Decision tree

| Task | Start with |
|------|------------|
| Starting a new CDK project | `references/00-architecture.md` (required) |
| Adding a Lambda to an existing project | `references/00-architecture.md` + `references/01-serverless-api.md` |
| Adding authentication (Google Sign-In) | `references/02-auth-stack.md` |
| Hosting a SPA with custom domain | `references/03-static-site.md` |
| Designing DynamoDB access patterns | `references/04-database.md` |
| "How do I parse a body / validate env / CORS?" | `references/05-shared-utilities.md` |
| Pre-deploy checklist / rollback / stages | `references/06-deploy-workflow.md` |

## Cross-cutting principles

Apply to every CDK stack regardless of use case:

- Always run `cdk diff` before `cdk deploy`. No exceptions.
- Always define `LogGroup` explicitly with a retention period. CDK-managed log groups default to infinite retention, which accumulates cost and compliance risk.
- Load secrets at Lambda runtime via Secrets Manager, never at CDK synth time.
- Validate all environment variables at cold start using a dedicated helper — never fall back to `process.env.X || ''`.
- Validate all API inputs with Zod at the handler boundary before calling the domain layer.
- Prefer binary `isProd` branching over multi-tier staging (unless compliance requires otherwise).
- Never run AWS CLI or CDK commands without the `--profile <project>` flag.

## Architecture at a glance

For non-trivial applications, organize CDK projects using hexagonal architecture
inside DDD modules, with a two-stack split (backend + frontend).

Read `references/00-architecture.md` for the full pattern, including the
exception for extra-simple applications where a single handler is acceptable.

## Reference index

1. **`references/00-architecture.md`** — Hexagonal + DDD module structure, two-stack split, shared infrastructure constructs, cross-module communication patterns. Required reading for any new CDK project.
2. **`references/01-serverless-api.md`** — Lambda + DynamoDB + API Gateway applied inside the hexagonal pattern.
3. **`references/02-auth-stack.md`** — Cognito User Pool with Google federated identity.
4. **`references/03-static-site.md`** — S3 + CloudFront + OAC for SPA hosting, including CloudFront domain registration for CORS and Cognito callbacks.
5. **`references/04-database.md`** — Aurora Serverless v2 with scale-to-zero, DynamoDB access patterns (single-table vs. multi-table decision tree, atomic uniqueness, identity-verified updates, TTL).
6. **`references/05-shared-utilities.md`** — Response helpers (`createResponse`, `withCors`), body parsing (`parseBody`), environment validation (`validateEnv`), secrets loading with cold-start cache, standardized `ApiResponse<T>` and `ErrorCodes`.
7. **`references/06-deploy-workflow.md`** — Pre-deploy checklist, stage and suffix system, CloudFront domain registration in `cdk.json` context, basic rollback strategy, and documented limitations.
```

- [ ] **Step 2: Verify word count is within target**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md
```

Expected: between 600 and 1,400 words (target from the spec is 1,000-1,400).

- [ ] **Step 3: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md
git commit -m "$(cat <<'EOF'
feat(dev-patterns): add aws-cdk-patterns SKILL.md

Provides frontmatter with CSO-optimized description, decision tree,
cross-cutting principles, and reference index. Reference files added
in subsequent commits.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7: Write `00-architecture.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/00-architecture.md`

**Content source:** Design spec section "Content plan per reference file → `00-architecture.md` — Hexagonal + DDD + two-stack". All 6 sections (When to apply, Hexagonal architecture, DDD module structure, Two-stack architecture, Shared infrastructure constructs, Cross-module communication patterns) and the embedded gotchas.

- [ ] **Step 1: Context7 validation for CDK constructs referenced in this file**

Query context7 for `aws-cdk-lib` to confirm the current API for:
- `NodejsFunction` (aws-lambda-nodejs)
- `Table` (aws-dynamodb)
- `UserPool`, `UserPoolClient` (aws-cognito)
- `RestApi`, `CognitoUserPoolsAuthorizer` (aws-apigateway)
- `EventBus` (aws-events)

Run:
```
mcp__plugin_context7_context7__query-docs with library "aws-cdk-lib", query "NodejsFunction bundling options"
```

Repeat for each construct. If any API has changed since the patterns in the spec, use the current API and note the change in the implementation log.

- [ ] **Step 2: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/00-architecture.md` with the structure defined in the spec's content plan for `00-architecture.md`. The file must include:

- **Header** with Builds / When to use / Prerequisites.
- **Contents** TOC with 6 section names, each with a 1-line description.
- **Section 1 — When to apply this architecture** — threshold heuristics, explicit exception for extra-simple applications (handler can contain all logic directly). Exception criteria: handler < ~50 lines, touches at most one external system, not expected to grow.
- **Section 2 — Hexagonal architecture for Lambda functions** — four layers (handlers, services, ports, adapters), constructor injection pattern with a full TypeScript code example showing `OrderService` with optional port defaults, test strategy per layer.
- **Section 3 — DDD module structure** — directory layout template, module infra construct ownership, decision tree for "new Lambda" vs. "new module".
- **Section 4 — Two-stack architecture** — backend/frontend split rationale, chicken-and-egg problem solved by `config.json` generation, stateful/stateless decision tree (only applies to instance-backed resources), deployment order.
- **Section 5 — Shared infrastructure constructs** — CognitoConstruct, ApiGatewayConstruct, LambdaLayerConstruct, AuditLogConstruct, EventBusConstruct, MonitoringConstruct. Each with a 1-sentence description and instantiation pattern.
- **Section 6 — Cross-module communication patterns** — preferred pattern (SigV4 IAM API calls), acceptable reads (grantReadData), shared writes (audit log), shared kernel types, events. Use generic module names (module A, module B), not project-specific names.
- **Gotchas catalog** — at minimum the 3 gotchas from the spec (module import loop, handler touching AWS SDK, service test requiring AWS credentials).
- **Further reading** — link to AWS CDK v2 official docs for any constructs referenced.

Writing style: imperative/infinitive form. No second person. No narrative examples. Follow the reference file format from the spec.

- [ ] **Step 3: Self-review against the spec**

Read the spec's "Content plan per reference file → `00-architecture.md`" section. For each sub-section listed, confirm it exists in the file. For each gotcha listed, confirm it is in the catalog. For the "highly recommended but not mandatory" framing, confirm it is present in Section 1.

- [ ] **Step 4: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/00-architecture.md
```

Expected: 2,500-4,000 words (target from the spec).

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/00-architecture.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 00-architecture.md

Foundational reference for CDK projects — hexagonal + DDD modules,
two-stack split, shared infrastructure constructs, and cross-module
communication patterns. Explicit exception for extra-simple applications.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 8: Write `05-shared-utilities.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/05-shared-utilities.md`

**Content source:** Design spec section "Content plan per reference file → `05-shared-utilities.md` — Cross-cutting shared utilities".

- [ ] **Step 1: Context7 validation**

Query context7 for Zod API and AWS SDK `GetSecretValueCommand` current signature. Confirm any code in the templates matches the current libraries.

- [ ] **Step 2: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/05-shared-utilities.md` with the structure from the spec. The file must include all 8 sections:

1. **Why centralize utilities** — rationale, location convention.
2. **`parseBody(body, schema)`** — full TypeScript template + usage example. Return type is `{ success: true, data: T } | { success: false, error: string }`. Uses Zod's `safeParse` under the hood.
3. **`createResponse(status, body, event)` and `withCors()` wrapper** — full templates. `withCors` is a higher-order function that wraps an async handler. `createResponse` accepts the event and computes CORS headers via `getCorsOrigin`. Rules: always pass `event`, allowlist-based, never wildcard.
4. **`ApiResponse<T>` and `ErrorCodes`** — type definition + enum with the documented ~30 codes. Rule: never define local versions.
5. **`validateEnv(['VAR1', 'VAR2'] as const)`** — full template with TypeScript generic that preserves the input tuple type in the return value. Fails fast at cold start if any var is missing.
6. **Secrets loading pattern** — template for module-scope cache + `loadSecrets()` function using `GetSecretValueCommand`. Pass `SECRET_ARN` env var. Never read secrets at CDK synth time.
7. **Security headers** — list of headers added automatically by `createResponse` (`X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Cache-Control`, `X-Request-Id`).
8. **Gotchas catalog** — 6 gotchas from the spec.

All templates are full TypeScript code, compilable as-is if the reader pastes them into a project with `aws-sdk`, `zod`, and `@types/aws-lambda` installed.

- [ ] **Step 3: Self-review against the spec**

For each of the 8 sections, confirm content matches the spec. For the 6 gotchas, confirm they are in the catalog.

- [ ] **Step 4: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/05-shared-utilities.md
```

Expected: 2,000-2,800 words.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/05-shared-utilities.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 05-shared-utilities.md

Centralizes cross-cutting utilities: parseBody (Zod), withCors/createResponse,
validateEnv, secrets loading with cold-start cache, ApiResponse<T> type
and ErrorCodes enum. Referenced by 01, 02, and 04.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 9: Write `01-serverless-api.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/01-serverless-api.md`

**Content source:** Design spec section "Content plan per reference file → `01-serverless-api.md` — Lambda + DynamoDB + API Gateway".

**Prerequisites acknowledged:** This file assumes `00-architecture.md` and `05-shared-utilities.md` have been read. Templates use hex architecture and shared utilities without re-documenting them.

- [ ] **Step 1: Context7 validation**

Query context7 for `aws-cdk-lib` constructs: `NodejsFunction`, `Table`, `RestApi`, `CognitoUserPoolsAuthorizer`, `LayerVersion`. Confirm the bundling options, GSI syntax, and Cognito authorizer wiring.

- [ ] **Step 2: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/01-serverless-api.md` with:

- **Header** with Builds / When to use / Prerequisites (`00-architecture.md`, `05-shared-utilities.md`).
- **Contents TOC**.
- **Section 1 — Architecture** — Lambda handler → service → port → DynamoDB adapter, exposed via API Gateway REST method with Cognito authorizer.
- **Section 2 — Template** — Full module showing:
  - `handlers/api.handler.ts` using `withCors()` and `createResponse()`, delegating to service.
  - `services/orders.service.ts` with constructor injection (`OrderPort`, `EventPort`).
  - `ports/order.port.ts` defining the interface.
  - `adapters/order.adapter.ts` implementing the port with DynamoDB SDK.
  - `infra/orders.module.ts` CDK construct with Table (PAY_PER_REQUEST, PITR, GSI), NodejsFunction (ARM64, Node 20, source maps, shared layer, external modules list), explicit LogGroup with retention, `table.grantReadWriteData(fn)`, API Gateway route + Cognito authorizer.
- **Section 3 — Lambda bundling config** — esbuild options, shared layer usage, `NODE_OPTIONS: '--enable-source-maps'`.
- **Section 4 — Gotchas catalog** — 7 gotchas from the spec (Lambda concurrency quota, N+1 presigned URLs, handler touching AWS SDK, service test needing AWS, `process.env.X || ''`, cold start latency, Lambdas in/out VPC).
- **Section 5 — Deployment notes** — permission grants, API Gateway stage deployment, first-time Cognito client ID injection.
- **Section 6 — Verification** — sample `curl` command with IAM auth, sample `aws dynamodb get-item` to confirm persistence.
- **Section 7 — Further reading** — AWS CDK v2 docs for `aws-lambda-nodejs`, `aws-dynamodb`, `aws-apigateway`.

- [ ] **Step 3: Self-review against the spec**

For each section in the spec's content plan for this file, confirm coverage.

- [ ] **Step 4: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/01-serverless-api.md
```

Expected: 2,000-3,000 words.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/01-serverless-api.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 01-serverless-api.md

Lambda + DynamoDB + API Gateway applied inside the hexagonal pattern.
Full module template (handler/service/port/adapter/infra), bundling
config with shared layer, and gotchas catalog.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 10: Write `02-auth-stack.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md`

**Content source:** Design spec section "Content plan per reference file → `02-auth-stack.md`".

- [ ] **Step 1: Context7 validation**

Query context7 for `aws-cognito` constructs: `UserPool`, `UserPoolIdentityProviderGoogle`, `UserPoolClient`, `UserPoolDomain`. Confirm the dependency pattern between Google IdP and client.

- [ ] **Step 2: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md` with:

- **Header** with Builds / When to use / Prerequisites (`00-architecture.md`, `05-shared-utilities.md`).
- **Contents TOC**.
- **Section 1 — Architecture** — UserPool (federated-only, no password policy) + UserPoolIdentityProviderGoogle + UserPoolClient + UserPoolDomain. Google client secret in Secrets Manager.
- **Section 2 — Template** — `CognitoConstruct` full TypeScript CDK code. Includes:
  - `UserPool` with `selfSignUpEnabled: false`, `signInAliases: { email: true }`, `removalPolicy: isProd ? RETAIN : DESTROY`.
  - Google secret from Secrets Manager via `cdk.SecretValue.secretsManager('google-oauth')`.
  - `UserPoolIdentityProviderGoogle` construct.
  - `UserPoolClient` with `supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE]`, OAuth2 code flow, callback URLs from context.
  - `client.node.addDependency(googleProvider)` (explicit dependency — without this, first deploy fails).
- **Section 3 — Gotchas catalog** — all gotchas from the spec: identity provider does not exist, removalPolicy default, never edit via Console, cookie security, callback URLs per env, Google OAuth secret loaded at runtime.
- **Section 4 — Deployment notes** — first-time Google OAuth credentials setup (store in Secrets Manager), callback URL configuration in the Google Cloud Console.
- **Section 5 — Verification** — Cognito hosted UI test, token exchange verification.
- **Section 6 — Further reading** — AWS CDK v2 docs for `aws-cognito`, Google OAuth integration docs.

- [ ] **Step 3: Self-review against the spec**

- [ ] **Step 4: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md
```

Expected: 1,500-2,500 words.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 02-auth-stack.md

Cognito with Google federated identity — UserPool, IdP, Client, Domain,
explicit dependency ordering, secrets from Secrets Manager, cookie
security rules, and gotchas.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 11: Write `03-static-site.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/03-static-site.md`

**Content source:** Design spec section "Content plan per reference file → `03-static-site.md`".

- [ ] **Step 1: Context7 validation**

Query context7 for `aws-cdk-lib` constructs: `Bucket`, `Distribution` (aws-cloudfront), `OriginAccessControl`, `ARecord` + `CloudFrontTarget` (aws-route53-targets), `Certificate` (aws-certificatemanager).

- [ ] **Step 2: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/03-static-site.md` with:

- **Header** with Builds / When to use / Prerequisites (`00-architecture.md`).
- **Contents TOC**.
- **Section 1 — Architecture** — S3 Bucket (blockPublicAccess BLOCK_ALL) + CloudFront with OAC + Route53 A record + ACM certificate in us-east-1.
- **Section 2 — Template** — Frontend stack with:
  - Bucket construct.
  - CloudFront Distribution with OAC (not legacy OAI).
  - Route53 A record alias.
  - ACM certificate (us-east-1 requirement documented).
  - `config.json` generator that reads backend stack outputs (Cognito IDs, API URL) and writes a `config.json` file deployed to the S3 bucket as part of the stack.
- **Section 3 — CloudFront domain registration pattern** — 4-step workflow:
  1. First deploy produces a CloudFront domain.
  2. Add to `cdk.json` under `context.cloudfrontDomains[suffix]`.
  3. Re-deploy — CORS, callbacks, logout URLs now include the CloudFront origin.
  4. Commit the `cdk.json` change.
  - Include example `cdk.json` snippet.
- **Section 4 — Post-deploy step** — `aws s3 sync dist/ s3://BUCKET --delete` + CloudFront invalidation command.
- **Section 5 — Gotchas catalog** — 4 gotchas from the spec: "Access denied from bucket policy" (websiteIndexDocument conflict), ACM certificate in us-east-1, service worker cache versioning, first deploy CORS allowlist.
- **Section 6 — Deployment notes** — CORS, Cognito callback registration via `cdk.json` context, frontend build must run before `cdk deploy --all`.
- **Section 7 — Verification** — curl the CloudFront URL, verify `config.json` is served.
- **Section 8 — Further reading** — AWS CDK v2 docs for `aws-cloudfront`, OAC guide.

- [ ] **Step 3: Self-review against the spec**

- [ ] **Step 4: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/03-static-site.md
```

Expected: 1,500-2,000 words.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/03-static-site.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 03-static-site.md

S3 + CloudFront + OAC for SPA hosting. Includes CloudFront domain
registration pattern via cdk.json context, config.json generator
for runtime frontend config, and gotchas catalog.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 12: Write `04-database.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md`

**Content source:** Design spec section "Content plan per reference file → `04-database.md`".

- [ ] **Step 1: Context7 validation**

Query context7 for `aws-rds` `DatabaseCluster`, `aws-dynamodb` `Table` + GSI + TTL, Aurora Serverless v2 scale-to-zero configuration. Verify PostgreSQL 16.3+ requirement for scale-to-zero.

- [ ] **Step 2: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md` with:

- **Header** with Builds / When to use / Prerequisites (`00-architecture.md`).
- **Contents TOC**.
- **Section 1 — Aurora Serverless v2 patterns** — DatabaseCluster template with `minCapacity: 0`, Data API enabled, DatabaseSecret with optional rotation, binary isProd branching for deletionProtection and backupRetention.
- **Section 2 — DynamoDB decision tree: single-table vs. multi-table** — decision tree with criteria for each, recommendation guidance, no universal answer.
- **Section 3 — DynamoDB patterns** — billing PAY_PER_REQUEST, PITR for RETAIN tables, TTL for ephemeral data, one GSI per access pattern, removal policy conventions. Include full Table construct code example.
- **Section 4 — Atomic uniqueness pattern (critical)** — dedicated lookup table with the unique value as PK, write with `attribute_not_exists` condition expression. Full TypeScript code showing the DynamoDB SDK call with `ConditionExpression`. Explicit warning: never use GSI query + separate write.
- **Section 5 — Identity-verified updates pattern** — when updating array items by index, include identity check in ConditionExpression. Full code example.
- **Section 6 — Cursor-based pagination pattern** — full code example using LastEvaluatedKey.
- **Section 7 — Gotchas catalog** — 6 gotchas from the spec (Aurora PG version, auto-pause, cross-stack exports, TTL off by default, orphaned S3 images, uniqueness race condition).
- **Section 8 — Verification** — sample DynamoDB and Aurora queries to confirm schema.
- **Section 9 — Further reading** — AWS CDK v2 docs for `aws-rds`, `aws-dynamodb`.

- [ ] **Step 3: Self-review against the spec**

Special attention to the atomic uniqueness section — this is the most critical pattern in the file and is tested directly by scenario 4.

- [ ] **Step 4: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md
```

Expected: 2,500-3,500 words.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 04-database.md

Aurora Serverless v2 with scale-to-zero, DynamoDB single-table vs.
multi-table decision tree, atomic uniqueness via dedicated lookup
table, identity-verified updates, cursor-based pagination, and gotchas.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 13: Write `06-deploy-workflow.md`

**Files:**
- Create: `plugins/dev-patterns/skills/aws-cdk-patterns/references/06-deploy-workflow.md`

**Content source:** Design spec section "Content plan per reference file → `06-deploy-workflow.md`".

- [ ] **Step 1: Write the file**

Create `plugins/dev-patterns/skills/aws-cdk-patterns/references/06-deploy-workflow.md` with:

- **Header** with Builds / When to use / Prerequisites (`00-architecture.md`, `03-static-site.md`).
- **Contents TOC**.
- **Section 1 — Pre-deploy checklist (mandatory, not suggested)** — 4 steps: `cdk diff`, verify `--profile`, verify no hardcoded secrets, verify git state. Each step with a code example.
- **Section 2 — Stage and suffix system** — dev/staging/prod, dev requires suffix, validation in `bin/app.ts` with code example.
- **Section 3 — Stack separation decision tree** — stateful/stateless only applies to instance-backed resources, 100% serverless keeps everything in one backend stack.
- **Section 4 — Two-stack deploy workflow** — frontend build first, `cdk deploy --all`, order of operations.
- **Section 5 — CloudFront domain registration** — cross-reference to `03-static-site.md` with a summary.
- **Section 6 — Binary isProd branching** — concrete code example with memory sizes, retention, deletionProtection.
- **Section 7 — Rollback** — scope note (basic only, no blue/green), basic checkout + redeploy pattern, snapshot discipline.
- **Section 8 — Windows/PowerShell note** — AWS CLI from bash hangs, use powershell.exe.
- **Section 9 — Gotchas catalog** — 4 gotchas: "Unable to resolve AWS account", stack replacement from env changes, "Export cannot be removed", empty dist.
- **Section 10 — Further reading** — AWS CDK v2 deployment docs, CodeDeploy docs link (for advanced strategies).

- [ ] **Step 2: Self-review against the spec**

- [ ] **Step 3: Verify word count**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/references/06-deploy-workflow.md
```

Expected: 2,000-2,800 words.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/06-deploy-workflow.md
git commit -m "$(cat <<'EOF'
feat(aws-cdk-patterns): add 06-deploy-workflow.md

Pre-deploy checklist, stage/suffix system, stack separation decision
tree, two-stack deploy workflow, CloudFront domain registration
summary, binary isProd branching, basic rollback, and Windows gotcha.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 14: Verify SKILL.md index is complete

**Files:**
- Modify: `plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md` (verify only, no content changes expected)

- [ ] **Step 1: Re-read SKILL.md**

Confirm all 7 reference files are listed in the "Reference index" section and the "Decision tree" routes correctly to each.

- [ ] **Step 2: Verify every reference file exists**

Run:
```bash
ls plugins/dev-patterns/skills/aws-cdk-patterns/references/
```

Expected output includes all 7 files: `00-architecture.md`, `01-serverless-api.md`, `02-auth-stack.md`, `03-static-site.md`, `04-database.md`, `05-shared-utilities.md`, `06-deploy-workflow.md`.

- [ ] **Step 3: No commit**

If SKILL.md was correct at creation time, no changes are needed.

---

## Phase 4: Test and iterate

### Task 15: Run GREEN phase

**Files:** None modified. Produces `/tmp/aws-cdk-skill-test-<timestamp>/green/` artifacts and diffs.

- [ ] **Step 1: Run the test harness**

Run:
```bash
plugins/dev-patterns/scripts/test-skill.sh
```

Expected: script runs to completion. Both RED and GREEN outputs are captured. Diffs are written per scenario.

- [ ] **Step 2: Record the results directory**

Save the path. Example: `/tmp/aws-cdk-skill-test-20260414-120000`. Use it in Steps 3-4.

- [ ] **Step 3: Review each scenario's GREEN output against success criteria**

For each of the 9 scenarios, open `green/scenario-NN.txt` and check against the corresponding success criterion from the spec:

| # | Scenario | Success criterion (what GREEN must mention) |
|---|----------|----------------------------------------------|
| 01 | "Proyecto CDK nuevo — cómo organizo Lambdas" | Hexagonal architecture, DDD modules, references `00-architecture.md` |
| 02 | "Lambda + DynamoDB — LogGroups" | Explicit LogGroup with RetentionDays, references `01-serverless-api.md` or cross-cutting principles |
| 03 | "Cognito Google — Identity provider does not exist" | `client.node.addDependency(googleProvider)`, references `02-auth-stack.md` |
| 04 | "Unicidad de email en DynamoDB sin race conditions" | Dedicated lookup table with `attribute_not_exists`, warning against GSI query + write, references `04-database.md` |
| 05 | "Parsear body de forma segura" | `parseBody` with Zod schema, warning against `JSON.parse`, references `05-shared-utilities.md` |
| 06 | "Starting new CDK project with domain modules" | Hexagonal + DDD + two-stack, references `00-architecture.md` |
| 07 | "S3 + CloudFront Access denied" | `websiteIndexDocument` conflict with OAC, references `03-static-site.md` |
| 08 | "Pre-deploy checklist" | 4-step checklist (`cdk diff`, `--profile`, secrets, git status), references `06-deploy-workflow.md` |
| 09 | "Separate into stateful/stateless" | Stateful/stateless applies only to instance-backed resources; for 100% serverless, keep in one stack |

Mark each scenario as PASS or FAIL.

- [ ] **Step 4: Identify failure modes**

For each FAIL, identify the root cause:

- **Trigger failure** — the skill was not loaded (description too narrow, workspace mismatch).
- **Routing failure** — the skill loaded but Claude read the wrong reference file.
- **Content failure** — the right reference file was loaded but it is missing the required pattern or gotcha.
- **Ambiguity** — Claude loaded the right file but the response is vague.

Write the failure diagnosis to `/tmp/aws-cdk-skill-test-<timestamp>/analysis.md`.

### Task 16: Iterate on skill files based on GREEN failures

**Files:** Modify any of the skill files based on the diagnosis from Task 15.

**This task is a loop.** Repeat until all 9 scenarios pass.

- [ ] **Step 1: For each failing scenario, apply a targeted fix**

- **Trigger failure** — update SKILL.md `description` field to include the keywords from the failing prompt. Rerun just that scenario.
- **Routing failure** — update the SKILL.md decision tree or add keyword hooks in the relevant reference file header.
- **Content failure** — update the reference file content to cover the missing pattern or gotcha.
- **Ambiguity** — add explicit guidance to the relevant reference file.

Each fix is a separate commit so that the iteration history is traceable:

```bash
git add <changed files>
git commit -m "fix(aws-cdk-patterns): <specific fix for scenario N>"
```

- [ ] **Step 2: Re-run the failing scenario only**

Use the test script with a one-off scenario override, or run `claude -p` directly:

```bash
claude -p \
  --plugin-dir "$(pwd)/plugins/dev-patterns" \
  --setting-sources project \
  "<scenario prompt>" \
  > /tmp/one-off-green.txt

cat /tmp/one-off-green.txt
```

- [ ] **Step 3: Confirm the fix and move to the next failing scenario**

Once all 9 scenarios pass, proceed to Task 17.

### Task 17: Run REFACTOR phase (adversarial scenarios)

**Files:** None modified in this task. Produces additional test results.

- [ ] **Step 1: Define 3 adversarial scenarios**

Append to `plugins/dev-patterns/tests/scenarios.txt`:

```
Cómo logueo errores en mi Lambda?
Configurar un gateway de API en CDK — tengo que usar REST o HTTP API?
Cómo configuro SQS con mis lambdas?
```

Scenario 10 is intentionally ambiguous (could route to `01-serverless-api.md` or `06-deploy-workflow.md`).
Scenario 11 uses non-canonical Spanish terminology ("gateway de API") to test trigger robustness.
Scenario 12 is out-of-scope (SQS is not in any reference file); the skill must recognize the gap without fabricating content.

- [ ] **Step 2: Run the test harness again**

```bash
plugins/dev-patterns/scripts/test-skill.sh
```

- [ ] **Step 3: Review GREEN outputs for scenarios 10-12**

Success criteria:

- **Scenario 10:** GREEN response routes to one of the reference files (not vague). Picks a specific file and gives concrete guidance.
- **Scenario 11:** GREEN response still triggers the skill despite non-canonical terminology, and returns content from `01-serverless-api.md`.
- **Scenario 12:** GREEN response acknowledges SQS is not covered by this skill and redirects appropriately (to official AWS docs), without fabricating a pattern.

- [ ] **Step 4: Iterate on failures (same loop as Task 16)**

Apply targeted fixes to the skill files for any adversarial scenario failures. Commit each fix.

- [ ] **Step 5: Commit the expanded scenarios file**

```bash
git add plugins/dev-patterns/tests/scenarios.txt
git commit -m "$(cat <<'EOF'
test(dev-patterns): add 3 adversarial scenarios for refactor phase

Ambiguous routing, non-canonical terminology, and out-of-scope query
scenarios to stress-test the skill.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Finalize

### Task 18: Final verification

- [ ] **Step 1: Confirm all files exist**

Run:
```bash
find plugins/dev-patterns -type f | sort
```

Expected files:
- `plugins/dev-patterns/.claude-plugin/plugin.json`
- `plugins/dev-patterns/README.md`
- `plugins/dev-patterns/scripts/test-skill.sh`
- `plugins/dev-patterns/tests/scenarios.txt`
- `plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/00-architecture.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/01-serverless-api.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/03-static-site.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/05-shared-utilities.md`
- `plugins/dev-patterns/skills/aws-cdk-patterns/references/06-deploy-workflow.md`

- [ ] **Step 2: Confirm marketplace.json entry**

Run:
```bash
node -e "const m = JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf-8')); console.log(m.plugins.map(p => p.name || p).join('\n'))"
```

Expected: output includes `dev-patterns` alongside the other three plugins.

- [ ] **Step 3: Run final full test harness**

```bash
plugins/dev-patterns/scripts/test-skill.sh
```

Expected: all 12 scenarios (9 original + 3 adversarial) pass against success criteria. Review any remaining diffs and confirm GREEN is systematically better than RED.

- [ ] **Step 4: Verify total word count for the skill**

Run:
```bash
wc -w plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md plugins/dev-patterns/skills/aws-cdk-patterns/references/*.md
```

Expected: SKILL.md is 600-1,400 words; each reference file is within its target range (see the spec's size table).

### Task 19: Push and open PR

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feature/improve-evals-skill
```

Note: this plan assumes continuing on the current branch `feature/improve-evals-skill` where the design spec and plan were committed. If a new branch is desired for the implementation itself, create it before Task 1 and adjust.

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "feat(dev-patterns): add aws-cdk-patterns reference skill" --body "$(cat <<'EOF'
## Summary

- Add new `dev-patterns` plugin as an umbrella for cross-cutting reference skills.
- First skill: `aws-cdk-patterns` with 7 reference files covering hexagonal + DDD architecture, serverless API, auth stack, static site, database patterns, shared utilities, and deploy workflow.
- Test harness with 12 retrieval scenarios (9 original + 3 adversarial) using `claude -p` with `--plugin-dir` isolation.
- Register new plugin in `marketplace.json`.

See `plans/2026-04-14-aws-cdk-patterns-skill-design.md` for the full design spec and `plans/2026-04-14-aws-cdk-patterns-skill-plan.md` for the implementation plan.

## Test plan

- [ ] Run `plugins/dev-patterns/scripts/test-skill.sh` and confirm all scenarios pass success criteria
- [ ] Verify `marketplace.json` loads correctly in Claude Code
- [ ] Manually trigger the skill with a real CDK question in a new Claude Code session and confirm the correct reference file is loaded

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Capture the URL for the hand-off summary.

---

## Self-review notes

This plan covers every section of the design spec:

- **Plugin scaffolding** → Task 1
- **Flag verification** → Task 2 (the spec's open implementation note)
- **Scenarios + test script** → Tasks 3, 4
- **RED baseline** → Task 5
- **SKILL.md** → Task 6
- **All 7 reference files** → Tasks 7-13
- **GREEN phase** → Task 15
- **Iteration loop** → Task 16
- **REFACTOR phase** → Task 17
- **Finalization and PR** → Tasks 18, 19

**Dependencies respected:** `00-architecture.md` before `01/02/04`; `05-shared-utilities.md` before `01/02/04` (because those files reference it for templates); SKILL.md written as a draft first so tests can trigger it.

**No placeholders:** Every step contains the actual content, command, or explicit pointer to the spec section. The reference file tasks point to the spec's content plan rather than inlining 20k words of markdown, which is a deliberate structural choice — the spec is authoritative for content and the plan is authoritative for workflow.

**Type consistency:** Method signatures and construct names in this plan match the spec's content plan (e.g., `client.node.addDependency(googleProvider)`, `attribute_not_exists`, `validateEnv`).
