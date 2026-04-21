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

### `dynamodb-design`

Stack-agnostic methodology for designing DynamoDB schemas from access patterns. Complements `aws-cdk-patterns` (which owns CDK provisioning and three canonical runtime patterns — atomic uniqueness, identity-verified updates, cursor pagination); this skill owns the upstream modeling work. Cross-references are bidirectional: `aws-cdk-patterns/04-database.md` §2 links here for the single-table vs multi-table decision tree, and the write-correctness reference here links to the CDK skill for the three runtime patterns with full TypeScript.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Designing a new schema from scratch | `00-methodology.md` + `01-modeling.md` |
| Adding a new access pattern to an existing table | `00-methodology.md` + `01-modeling.md` |
| Migrating a schema without downtime | `05-evolution.md` |
| Hot partition or throttling | `02-scaling.md` |
| Optimistic locking, atomic counters, batch ops | `03-write-correctness.md` |
| Wiring DynamoDB Streams or CDC | `04-streams-cdc.md` |
| Running DynamoDB locally for tests | `06-testing-local-dev.md` |
| Diagnosing a production symptom | `07-gotchas.md` |

**Key topics covered:**

- Six-step design methodology (inventory access patterns → classify → base keys → GSIs → validate → single-vs-multi) with greenfield / extension / migration branches and a worked e-commerce example
- Partition and sort key design, composite patterns, sort-key prefix conventions, key overloading and entity discrimination
- GSI design with projection-cost tradeoffs (`KEYS_ONLY` / `INCLUDE` / `ALL`), sparse indexes, adjacency list and hierarchical patterns
- Hot partition mitigation (write sharding, calendar-based sharding), item-size limits (400 KB hard limit, 1 KB WCU / 4 KB RCU boundaries), S3 offload with item pointers
- Cost modeling (`PAY_PER_REQUEST` vs `PROVISIONED` breakeven), GSI write amplification, auto-scaling behavior
- Optimistic locking with a `version` attribute, atomic counters, N-shard sharded counters, `BatchGet`/`BatchWrite` `UnprocessedItems` retry loops, `TransactWriteCommand` for multi-item atomic updates (money-transfer example)
- DynamoDB Streams view types, idempotent Lambda consumers with `eventID` dedup, OpenSearch projection example, DynamoDB Streams vs EventBridge Pipes decision tree
- Schema evolution without downtime — item versioning, live GSI backfill, attribute rename, dual-write + shadow reads + percentage rollout cutover, single↔multi table splits and consolidations
- Local testing with DynamoDB Local, testcontainers (`GenericContainer`), and LocalStack (for Streams + Lambda), per-access-pattern tests covering happy path + race + retry-cap-exceeded
- Gotchas catalog with 53 symptom → cause → fix rows across Design, Throughput, Write semantics, Streams, Evolution, Testing, and Expressions

## Installation

This plugin is part of the `claude-skills` marketplace. Install via Claude Code plugin marketplace or clone the repo and point Claude Code at the plugin directory.

## Testing the skills

Each skill ships with its own RED/GREEN test harness. Pick the variant for your shell and point it at the skill you want to validate:

**`aws-cdk-patterns` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\scripts\test-skill.ps1
```

**`aws-cdk-patterns` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/scripts/test-skill.sh
```

**`dynamodb-design` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\skills\dynamodb-design\scripts\test-skill.ps1
```

**`dynamodb-design` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.sh
```

All variants run the same two phases for every scenario in the matching `tests/scenarios.txt`:

- **RED** — `claude -p --disable-slash-commands <prompt>` (baseline without any skill loaded)
- **GREEN** — `claude -p --plugin-dir <plugin> --add-dir <plugin> --setting-sources project <prompt>` (the skill loaded in isolation, reference files readable)

Per-scenario outputs and unified diffs are written to a timestamped directory (`/tmp/<skill>-skill-test-<ts>/` on Unix, `$env:TEMP\<skill>-skill-test-<ts>\` on Windows). A human reviews the diffs against the success criteria in the design spec.

**IMPORTANT:** Do not run these scripts from inside an active Claude Code session. `claude -p` spawned recursively from another Claude Code session deadlocks on interactive prompts. Use a plain terminal.
