# dev-patterns

Cross-cutting reference patterns and gotchas for common tech stacks. Each skill uses progressive disclosure: a lean `SKILL.md` routes Claude to detailed reference files, loaded only when needed.

## Skills included

### `aws-cdk-patterns`

Opinionated architecture for AWS CDK v2 in TypeScript. Builds on a recommended hexagonal + DDD structure, documents construct patterns for the most common use cases, and catalogs known gotchas with symptom → root cause → fix lookup tables in every reference file.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Starting a new CDK project | `00-architecture.md` |
| Adding a Lambda + DynamoDB endpoint | `00-architecture.md` + `01-serverless-api.md` |
| Adding Google Sign-In | `02-auth-stack.md` |
| Hosting a SPA with custom domain | `03-static-site.md` |
| Designing DynamoDB or Aurora access patterns | `04-database.md` |
| `parseBody` / `validateEnv` / CORS helpers | `05-shared-utilities.md` |
| Pre-deploy checklist / rollback / stages | `06-deploy-workflow.md` |

**Key topics covered:**

- Hexagonal Lambda modules (handler / service / port / adapter) inside DDD bounded contexts
- Two-stack backend + frontend split, with `config.json` bridge and CloudFront domain registration
- Shared infrastructure constructs (`CognitoConstruct`, `ApiGatewayConstruct`, `LambdaLayerConstruct` — full Docker-bundled example included, `AuditLogConstruct`, `EventBusConstruct`, `MonitoringConstruct`) injected through a typed `SharedInfra` prop
- `stackSuffix` naming pattern so two developers can deploy to the same AWS account without resource-name collisions
- Cognito User Pool with Google federated identity using `clientSecretValue: SecretValue` (no `unsafeUnwrap`)
- S3 + CloudFront + OAC SPA hosting (not OAI), SPA routing via `errorResponses`, the two-deploy CloudFront domain registration bootstrap
- Aurora Serverless v2 with scale-to-zero (current supported PostgreSQL minors) and Data API
- DynamoDB single-table vs multi-table decision tree, atomic uniqueness via `TransactWriteCommand` + lookup table, identity-verified updates, opaque base64 cursor pagination
- `parseBody` (Zod), `createResponse`, `withCors` that enforces CORS/security headers over any handler value, `validateEnv` (fail-fast, typed), `loadSecret` with cold-start cache, standardized `ApiResponse<T>` and `ErrorCodes`
- Pre-deploy checklist (`cdk diff`, profile verification, secret scanning with `gitleaks`/`trufflehog`, git tagging), stage + suffix system, binary `isProd` branching, basic rollback via deploy tags
- Construct-level testing with `aws-cdk-lib/assertions` (`Template.fromStack`, `hasResourceProperties`, `allResourcesProperties`, `Match.absent`) as a 4th layer alongside service / adapter / handler tests

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
