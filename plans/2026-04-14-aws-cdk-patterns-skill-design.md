# AWS CDK Patterns Skill — Design Spec

**Date:** 2026-04-14
**Author:** spuli + Claude (brainstorming session)
**Status:** Design approved, pending implementation plan

## Context

Writing AWS CDK infrastructure in TypeScript repeatedly runs into the same decisions, the same deployment errors, and the same fixes. The goal of this skill is to capture a validated, opinionated architecture for CDK applications — hexagonal Lambdas inside DDD modules, a two-stack split, shared utilities, and a gotchas catalog — in a reference skill that Claude can retrieve and apply when writing CDK code.

The skill must be self-contained: runnable in any workspace on any machine, with no dependencies on local project documentation. Patterns are replicated in the skill body, not linked out.

## Goals

1. Provide a validated, opinionated architecture for CDK applications in TypeScript (hexagonal + DDD + two-stack).
2. Document construct patterns for the most common use cases (serverless API, auth stack, static site, database stack).
3. Centralize cross-cutting shared utilities (`parseBody`, `createResponse`, `withCors`, `validateEnv`, secrets loading) so they are referenced instead of re-documented in every use case.
4. Catalog known gotchas with symptom → root cause → fix lookup.
5. Be discoverable via Claude Search Optimization (CSO) when writing CDK code.
6. Follow the `superpowers:writing-skills` TDD methodology for reference skills.

## Scope

**In scope:**

- AWS CDK v2 in TypeScript (not Python, not SAM, not Terraform).
- Hexagonal architecture (ports and adapters) applied to Lambda functions.
- Domain-Driven Design module structure for bounded contexts.
- Two-stack architecture (backend + frontend) when applicable.
- Shared infrastructure constructs (Cognito, API Gateway, Event Bus, Audit Log, Monitoring).
- Shared utilities for CORS, body parsing, env validation, secrets loading, standardized API responses.
- Four concrete use cases: serverless API, auth stack, static site, database.
- Deploy workflow fundamentals (pre-deploy checklist, stage/suffix system, CloudFront domain registration, basic rollback).
- Gotchas catalog with symptom → root cause → fix lookup.

**Out of scope:**

- AWS services beyond those in the reference files (SQS/SNS/Step Functions deep dives, ECS/Fargate, EKS, Kinesis, Redshift). Can be added later as additional reference files if they become common.
- Advanced deployment strategies: blue/green, canary, feature flags, CodeDeploy-backed Lambda aliases. Documented as a known limitation in the deploy workflow file.
- CDK Python, AWS SAM, Serverless Framework, Terraform.
- CI/CD pipeline setup (GitHub Actions, CodePipeline).
- Observability deep dives (CloudWatch alarms config, X-Ray sampling strategies).
- Cost estimation.

## Opinionation level

The skill is **opinionated by default** on architecture: hexagonal + DDD modules + two-stack is presented as the recommended pattern for any non-trivial CDK application. The rationale and tradeoffs are documented, so readers can understand when to deviate.

**Explicit exception:** For extra-simple applications (a single Lambda, a small utility endpoint, a prototype), the handler may contain all the logic directly. The hexagonal split introduces overhead that is not worth it below a certain complexity threshold. The skill documents this exception explicitly so readers do not apply the pattern dogmatically.

For every other decision (single-table vs. multi-table DynamoDB, stateful/stateless separation, etc.) the skill documents the decision tree and does not prescribe a single answer.

## Placement

New plugin `dev-patterns` under `plugins/dev-patterns/`. The plugin acts as an umbrella for cross-cutting reference skills that do not belong to a specific workflow plugin.

Initial content: one skill (`aws-cdk-patterns`). Future skills planned but out of scope for this spec: `dynamodb-design`, `expo-react-native`.

Registered in the repo-root `marketplace.json` alongside the existing three plugins.

## Plugin structure

```
plugins/dev-patterns/
├── .claude-plugin/
│   └── plugin.json
├── README.md
├── scripts/
│   └── test-skill.sh
├── tests/
│   └── scenarios.txt
└── skills/
    └── aws-cdk-patterns/
        ├── SKILL.md
        └── references/
            ├── 00-architecture.md
            ├── 01-serverless-api.md
            ├── 02-auth-stack.md
            ├── 03-static-site.md
            ├── 04-database.md
            ├── 05-shared-utilities.md
            └── 06-deploy-workflow.md
```

### `plugin.json`

```json
{
  "name": "dev-patterns",
  "version": "1.0.0",
  "description": "Cross-cutting development patterns and gotchas for common tech stacks. Starts with AWS CDK; designed to grow with additional reference skills (dynamodb-design, expo-react-native).",
  "author": { "name": "spuli" },
  "keywords": ["patterns", "aws", "cdk", "infrastructure", "reference"]
}
```

### README.md (~50 lines)

- Purpose of the plugin.
- Current skills: `aws-cdk-patterns`.
- Roadmap: `dynamodb-design`, `expo-react-native` (future).
- Installation instructions.
- Testing instructions (point to `scripts/test-skill.sh`).

## SKILL.md format

### Frontmatter

```yaml
---
name: AWS CDK Patterns
description: Use when writing AWS CDK code in TypeScript — starting a new CDK project, building serverless APIs with Lambda and DynamoDB, adding authentication with Cognito, hosting a single-page app on S3 and CloudFront, designing DynamoDB access patterns, writing Lambda handlers, or running CDK deploys. Provides a recommended hexagonal + DDD architecture, validated construct patterns, shared utilities, and a catalog of known gotchas.
---
```

**CSO notes:**

- Describes triggering conditions only, no workflow summary (per `superpowers:writing-skills`).
- Mentions TypeScript explicitly to avoid false-positive triggers from CDK Python code.
- Enumerates the triggering situations: new project, use cases, writing handlers, running deploys.
- "Validated construct patterns" and "known gotchas" anchor the value without describing the workflow.

### Body structure (~140 lines, 1,000-1,400 words)

```markdown
# AWS CDK Patterns

Reference skill for building AWS infrastructure with CDK v2 in TypeScript.
Recommends a hexagonal architecture with DDD modules, documents construct
patterns for common use cases, and catalogs known gotchas.

## Decision tree

| Task | Start with |
|------|------------|
| Starting a new CDK project | `00-architecture.md` (required) |
| Adding a Lambda to an existing project | `00-architecture.md` + `01-serverless-api.md` |
| Adding authentication (Google Sign-In) | `02-auth-stack.md` |
| Hosting a SPA with custom domain | `03-static-site.md` |
| Designing DynamoDB access patterns | `04-database.md` |
| "How do I parse a body / validate env / CORS?" | `05-shared-utilities.md` |
| Pre-deploy checklist / rollback / stages | `06-deploy-workflow.md` |

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

Read `00-architecture.md` for the full pattern, including the exception for
extra-simple applications where a single handler is acceptable.

## Reference index

1. **`00-architecture.md`** — Hexagonal + DDD module structure, two-stack split, shared infrastructure constructs, cross-module communication patterns. Required reading for any new CDK project.
2. **`01-serverless-api.md`** — Lambda + DynamoDB + API Gateway applied inside the hexagonal pattern.
3. **`02-auth-stack.md`** — Cognito User Pool with Google federated identity.
4. **`03-static-site.md`** — S3 + CloudFront + OAC for SPA hosting, including CloudFront domain registration for CORS and Cognito callbacks.
5. **`04-database.md`** — Aurora Serverless v2 with scale-to-zero, DynamoDB access patterns (single-table vs. multi-table decision tree, atomic uniqueness, identity-verified updates, TTL).
6. **`05-shared-utilities.md`** — Response helpers (`createResponse`, `withCors`), body parsing (`parseBody`), environment validation (`validateEnv`), secrets loading with cold-start cache, standardized `ApiResponse<T>` and `ErrorCodes`.
7. **`06-deploy-workflow.md`** — Pre-deploy checklist, stage and suffix system, CloudFront domain registration in `cdk.json` context, basic rollback strategy, and documented limitations.
```

## Reference file format

Every reference file follows the same structure:

```markdown
# [Use case name]

**Builds:** [1 sentence describing what infrastructure this creates]
**When to use:** [Trigger conditions]
**Prerequisites:** [Which other reference files to read first, if any]

## Contents

1. **Architecture** — Resources in this pattern and their relationships
2. **Template** — Full copy-paste CDK code with inline gotcha comments
3. **Gotchas catalog** — Symptom → root cause → fix lookup table
4. **Deployment notes** — First-time setup, order dependencies, profile config
5. **Verification** — Commands to confirm the stack works post-deploy
6. **Further reading** — Official AWS docs for services in this pattern

## Architecture
...

## Template

[TypeScript CDK code with inline "// GOTCHA: <symptom> — <fix>" comments
 at the exact lines where known issues occur]

## Gotchas catalog

| Symptom | Root cause | Fix |
|---------|------------|-----|
| [literal error message or observable behavior] | [why it happens] | [what to do] |

## Deployment notes
...

## Verification
...

## Further reading
...
```

**Design decisions:**

- **Gotchas appear in two places** (inline as code comments and as a bottom-of-file lookup table). Intentional redundancy: inline catches issues during writing; the table supports "I have an error, find the fix fast" search.
- **TOC at the top** (~10 lines) for intra-file navigation. Does not duplicate content — just names sections with 1-line descriptions.
- **Writing style: imperative/infinitive**. No second person ("you should"). No narrative ("what happened in X project was…"). Per `plugin-dev:skill-development` best practices.
- **Target size per file:** 200-500 lines / 1,500-4,000 words. Within the recommended 2,000-5,000 word range for reference files.
- **Self-contained:** No links to external project documentation. All patterns replicated in the skill.

## Content plan per reference file

### `00-architecture.md` — Hexagonal + DDD + two-stack

**Purpose:** Foundational pattern for organizing a CDK project. Required reading for any new CDK application.

**Sections:**

1. **When to apply this architecture**
   - Applies to any non-trivial application.
   - **Exception:** For extra-simple applications (a single Lambda, a small utility endpoint, a short-lived prototype), the handler may contain all the logic directly. The hexagonal split introduces overhead that is not worth it below a certain complexity threshold. Skip ports/adapters and put the domain logic in the handler itself. Still apply the shared utilities (`05-shared-utilities.md`) and the cross-cutting principles.
   - Threshold heuristics: if the handler is longer than ~50 lines, touches more than one external system, or is expected to grow, refactor to hexagonal.

2. **Hexagonal architecture for Lambda functions**
   - Four layers per module:
     - **Handlers** — Thin entry points. Translate Lambda events (API Gateway, SQS, EventBridge) to domain calls. Wrap with `withCors()`. Never touch AWS SDK directly.
     - **Services** — Domain logic. Pure TypeScript. Depend on port interfaces, not on concrete AWS clients.
     - **Ports** — TypeScript interfaces defining contracts with external systems (data store, storage, other services, event bus).
     - **Adapters** — Concrete implementations of ports using AWS SDK or third-party clients.
   - Dependency injection pattern: constructor injection with sensible defaults.
     ```typescript
     export class OrderService {
       constructor(
         private readonly orderPort: OrderPort = new OrderAdapter(),
         private readonly eventPort: EventPort = new EventAdapter(),
       ) {}
     }
     ```
   - Test strategy per layer:
     - Service tests mock ports via constructor injection. Pure unit tests, no AWS mocks.
     - Adapter tests mock AWS SDK clients directly (`@aws-sdk/client-mock`).
     - Handler tests mock the service.

3. **DDD module structure**
   - Each bounded context is a self-contained module under `modules/{domain}/`.
   - Module directory layout:
     ```
     modules/{domain}/
     ├── src/
     │   ├── handlers/       # Lambda entry points ({name}.handler.ts)
     │   ├── services/       # Business logic ({name}.service.ts)
     │   ├── ports/          # Interfaces for adapters
     │   ├── adapters/       # External integrations (DynamoDB, S3, HTTP clients)
     │   └── types.ts        # Zod schemas for domain types
     ├── infra/
     │   ├── {domain}.module.ts    # CDK construct (tables, lambdas, routes, permissions)
     │   └── index.ts
     └── tests/
     ```
   - Module infra construct owns its tables, lambdas, routes, and permissions. Shared resources (Cognito, API Gateway, Event Bus) are injected as props by the main stack.
   - Decision tree for "new Lambda" vs. "new module":
     - New Lambda in an existing bounded context → add handler + service + ports/adapters to the existing module.
     - New bounded context → create a new module directory.

4. **Two-stack architecture (backend + frontend)**
   - **Backend stack** — Cognito, API Gateway, Lambdas, DynamoDB, Secrets, EventBridge. Exports Cognito client ID, API URL, table names, and endpoint values as CloudFormation outputs.
   - **Frontend stack** — S3 + CloudFront + `config.json`. Consumes backend outputs to generate a runtime config file that the SPA fetches on load. Solves the chicken-and-egg problem where the frontend needs the Cognito client ID at build time — instead, it fetches a static `config.json` generated during deploy.
   - **When stateful/stateless split applies:** Only when instance-backed resources are present (Aurora Serverless v2, RDS, EC2, OpenSearch Domain, ElastiCache cluster). For a 100% serverless architecture (DynamoDB + Lambda + S3 + Cognito + API Gateway + Secrets Manager), keep everything in a single backend stack.
   - Deployment order: backend first, frontend second. Frontend depends on backend outputs.

5. **Shared infrastructure constructs**
   - `CognitoConstruct` — User Pool, app client, hosted UI domain.
   - `ApiGatewayConstruct` — REST API with Cognito authorizer, CORS preflight.
   - `LambdaLayerConstruct` — Pre-bundled shared dependencies (DynamoDB SDK, Zod, UUID, Secrets Manager SDK). Every `NodejsFunction` uses the layer plus an external modules list to avoid duplicate bundling. Significant deployment speedup.
   - `AuditLogConstruct` — Cross-module audit log table.
   - `EventBusConstruct` — EventBridge bus for cross-module events.
   - `MonitoringConstruct` — CloudWatch dashboards and alarms per Lambda.
   - Constructs are instantiated once in the main stack and passed to each module as props.

6. **Cross-module communication patterns**
   - **Preferred:** IAM-authenticated REST calls between modules using SigV4 signing. Preserves bounded context boundaries. Example: module A calls module B's exposed API (via a `MODULE_B_API_ENDPOINT` env var) instead of reading module B's DynamoDB table directly.
   - **Acceptable for reads:** Read-only table grants for tightly coupled cross-cutting reads (e.g., a module that needs to validate a time window from another module's data).
   - **Shared writes:** All modules write to the audit log table.
   - **Shared kernel types:** Cross-domain types defined in `shared/types/domain.ts`. Modules re-export from shared — never import types directly from another module's `src/types.ts`.
   - **Events:** Modules publish to the event bus without knowing consumers (loose coupling).

**Gotchas in this file:**

- "Module import loop" → a module is importing types directly from another module's `src/types.ts`. Fix: move the shared type to `shared/types/` and re-export.
- Handler touching AWS SDK directly → the hexagonal split was skipped. If the complexity warrants it, refactor to ports/adapters.
- Service tests requiring AWS credentials → the service is not actually decoupled from its adapters. Verify constructor injection is used.

### `01-serverless-api.md` — Lambda + DynamoDB + API Gateway

**Prerequisites:** `00-architecture.md`, `05-shared-utilities.md`

**Sections:**

1. **Architecture** — Lambda handler → service → port → DynamoDB adapter, exposed via API Gateway REST method with Cognito authorizer.
2. **Template** — Full module structure with:
   - `handlers/api.handler.ts` using `withCors()` and `createResponse()`.
   - `services/{feature}.service.ts` with constructor injection.
   - `ports/{feature}.port.ts` defining the data contract.
   - `adapters/{feature}.adapter.ts` implementing the port with DynamoDB SDK.
   - `infra/{domain}.module.ts` CDK construct with:
     - `Table` definition (PAY_PER_REQUEST, PITR, GSIs per access pattern).
     - `NodejsFunction` (ARM64, Node 20, esbuild, source maps, shared layer, external modules list).
     - Explicit `LogGroup` with `RetentionDays`.
     - `table.grantReadWriteData(fn)` for IAM permissions.
     - API Gateway route and Cognito authorizer wiring.
3. **Lambda bundling config** — `minify: true`, `sourceMap: true`, `NODE_OPTIONS: '--enable-source-maps'`, `externalModules: LAYER_EXTERNAL_MODULES`.
4. **Gotchas catalog:**
   - Lambda concurrency quota default (10) → request increase proactively. Document the quota request procedure.
   - N+1 presigned URL generation in loops → batch or stream.
   - Handler touches AWS SDK directly → hexagonal split was skipped; refactor if complexity warrants.
   - Service test needs AWS credentials → service is not using constructor injection; refactor.
   - `process.env.TABLE_NAME || ''` silently passing empty string → use `validateEnv()` from `05-shared-utilities.md`.
   - Cold start latency high → check bundle size, confirm ARM64, confirm shared layer is used.
   - Lambdas in VPC vs. outside VPC (NAT Gateway cost implication).

### `02-auth-stack.md` — Cognito with Google Federated Identity

**Prerequisites:** `00-architecture.md`, `05-shared-utilities.md`

**Sections:**

1. **Architecture** — `UserPool` + `UserPoolIdentityProviderGoogle` + `UserPoolClient` + `UserPoolDomain`. Google client secret stored in Secrets Manager. Callback URLs configured per environment from CDK context.
2. **Template** — `CognitoConstruct` CDK construct showing full wiring.
3. **Gotchas catalog:**
   - "Identity provider does not exist" on first deploy → missing `client.node.addDependency(googleProvider)`.
   - `removalPolicy` default `RETAIN` leaves orphaned pools → use `isProd ? RETAIN : DESTROY`.
   - **Never edit Cognito via AWS Console.** Only deploy changes via CDK. Console edits revert silently on the next deploy.
   - Cookie security: set-cookie and clear-cookie must use identical attributes (`Secure`, `SameSite`, `Path`, `HttpOnly`). Browsers will not clear a cookie if the clear response has different attributes. Use a shared config to generate both.
   - Callback URLs per environment — frontend needs the Cognito domain and client ID at runtime. Solved by the two-stack architecture: backend exports Cognito values, frontend deploy generates `config.json` (see `00-architecture.md`).
   - Google OAuth secret stored in Secrets Manager and loaded at Lambda runtime, never at CDK synth time.

### `03-static-site.md` — S3 + CloudFront + OAC

**Prerequisites:** `00-architecture.md`

**Sections:**

1. **Architecture** — S3 `Bucket` + CloudFront distribution + Origin Access Control (OAC, not legacy OAI) + Route53 `ARecord` + ACM certificate in us-east-1.
2. **Template** — Frontend stack CDK code including the `config.json` generator that reads backend stack outputs.
3. **CloudFront domain registration pattern** — register each deployment's CloudFront domain in `cdk.json` context so CORS origins, Cognito callback URLs, and logout URLs are configured automatically on re-deploy. Workflow:
   1. First deploy produces a CloudFront domain (e.g., `d1234abcxyz.cloudfront.net`).
   2. Add it to `cdk.json` under `context.cloudfrontDomains[suffix]`.
   3. Re-deploy — CORS, callbacks, and logout URLs now include the CloudFront origin.
   4. Commit the `cdk.json` change so the domain persists.
4. **Post-deploy step** — `aws s3 sync` + CloudFront invalidation.
5. **Gotchas catalog:**
   - "Access denied from bucket policy" → `websiteIndexDocument` set alongside `blockPublicAccess` creates a conflict. Use OAC only; do not configure S3 website features.
   - ACM certificate must be in `us-east-1` for CloudFront, regardless of the backend region.
   - CloudFront invalidation is not sufficient for service-worker-cached assets → version the service worker or add a cache-busting query param.
   - First deploy produces a new CloudFront domain that is not yet in the CORS allowlist → add to `cdk.json` and re-deploy before expecting cross-origin calls to work.

### `04-database.md` — Aurora Serverless v2 + DynamoDB access patterns

**Prerequisites:** `00-architecture.md`

**Sections:**

1. **Aurora Serverless v2 patterns**
   - `DatabaseCluster` with `minCapacity: 0` (scale-to-zero).
   - Data API enabled so Lambdas connect without VPC (avoids NAT Gateway cost).
   - `DatabaseSecret` with optional rotation.
   - Binary `isProd` branching for `deletionProtection` and `backupRetention`.
2. **DynamoDB decision tree: single-table vs. multi-table**
   - Single-table: homogeneous access patterns, tightly related data, cost-minimized footprint, cross-entity queries.
   - Multi-table: clear bounded contexts (one table per aggregate root), offline/online sync with distinct per-domain semantics, distinct retention per domain, team ownership boundaries, distinct scaling characteristics.
   - Neither is universally correct. Document both with templates.
3. **DynamoDB patterns from the hexagonal architecture:**
   - Billing: `PAY_PER_REQUEST`.
   - PITR (Point-in-Time Recovery) enabled for tables with `RETAIN` removal policy.
   - `TTL` configured via `expires_at` attribute for ephemeral data (sessions, OTPs).
   - One GSI per access pattern (not one GSI for "lots of queries").
   - Removal policy: `RETAIN` for production data, `DESTROY` for ephemeral data.
4. **Atomic uniqueness pattern (critical)**
   - For globally unique values (email, phone number, referral code), use a dedicated lookup table with the unique value as the primary key, and write with `attribute_not_exists` condition.
   - **Never rely on GSI query + separate write** — GSI reads are eventually consistent and create a race window where two concurrent writers can both pass the uniqueness check.
   - Template code showing the condition expression pattern.
5. **Identity-verified updates pattern**
   - When updating array items by index, include an identity check in the `ConditionExpression`: `tasks[N].task_id = :expectedTaskId`. Prevents corrupted updates if concurrent writes reorder the array.
6. **Cursor-based pagination pattern.**
7. **Gotchas catalog:**
   - Aurora scale-to-zero requires PostgreSQL 16.3+.
   - Aurora auto-pauses after 5 minutes of inactivity (expected behavior).
   - Cross-stack exports: never set `env.account`/`env.region` default in props → causes replacement on unrelated deploys.
   - DynamoDB TTL is off by default — must be explicitly enabled.
   - Orphaned S3 images when a DynamoDB record referencing a blob is deleted → pattern: DynamoDB Stream → Lambda cleanup.
   - Race condition on uniqueness check using GSI → use the dedicated lookup table pattern instead.

### `05-shared-utilities.md` — Cross-cutting shared utilities

**Prerequisites:** None (can be read independently)

**Sections:**

1. **Why centralize utilities**
   - Handlers, services, and adapters all use the same small set of utilities. Centralizing them prevents duplication, silent inconsistencies (e.g., two CORS implementations), and documentation drift.
   - Organize as `shared/utils/` and `shared/types/` in the CDK project.

2. **`parseBody(body, schema)`** — Zod-based request body parsing
   - Never use `JSON.parse(body || '{}')` — it silently accepts malformed JSON and skips validation.
   - `parseBody` returns `{ success, data | error }`, never throws.
   - Template code + usage example from a handler.

3. **`createResponse(status, body, event)` and `withCors()` wrapper**
   - `createResponse` wraps the return value with standardized headers (CORS, security headers, request ID).
   - `withCors()` is a handler decorator that applies `createResponse` to every return path, including thrown errors.
   - **Rule:** Always pass `event` to `createResponse()`. Every response path (success AND error) must include `event` so the CORS origin header matches the request origin. Omitting `event` causes the fallback to localhost, breaking production.
   - **Rule:** CORS is allowlist-based, never wildcard. `getCorsOrigin(requestOrigin)` validates against the `ALLOWED_ORIGINS` env var.
   - Template code for `withCors`, `getCorsOrigin`, `createResponse`.

4. **`ApiResponse<T>` and `ErrorCodes`**
   - Standardized response envelope: `{ success: boolean, data?: T, error?: { code: string; message: string } }`.
   - `ErrorCodes` enum with ~30 standardized values (`UNAUTHORIZED`, `INVALID_INPUT`, `RATE_LIMIT_EXCEEDED`, etc.).
   - **Rule:** Never define local `createResponse` or `ApiResponse<T>` in handler files. Always import from `shared/`.

5. **`validateEnv(['VAR1', 'VAR2'] as const)`** — environment variable validation
   - Fails fast at cold start if any required var is missing or empty.
   - Returns a typed object (TypeScript `as const` inference).
   - **Rule:** Never use `process.env.X || ''` — it silently passes empty strings downstream and fails with obscure errors later.
   - Template code.

6. **Secrets loading pattern**
   - Pass `SECRET_ARN` as env var in CDK. Load the secret at Lambda runtime using `GetSecretValueCommand`, parse once, cache at module scope across cold starts.
   - **Rule:** Never read `process.env` in CDK infra files for secret values. It bakes them into CloudFormation templates as empty strings at synth time.
   - Template code for the cold-start cache pattern.

7. **Security headers**
   - Every response includes `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` (HSTS), `Cache-Control`, `X-Request-Id`.
   - Applied automatically by `createResponse`.

8. **Gotchas catalog:**
   - Local `ApiResponse<T>` or `createResponse` in a handler → import from shared.
   - Missing `event` in `createResponse(status, body)` → CORS falls back to localhost, breaking production.
   - `JSON.parse(body)` without Zod validation → use `parseBody`.
   - `process.env.X || ''` → use `validateEnv`.
   - Secret value embedded as empty string in CloudFormation template → secret was read at CDK synth time; refactor to load at Lambda runtime with cold-start cache.
   - Set-cookie and clear-cookie with mismatched attributes → browser will not clear the cookie.

### `06-deploy-workflow.md` — Pre-deploy, stages, and rollback

**Sections:**

1. **Pre-deploy checklist (mandatory, not suggested)**
   1. `cdk diff` — review every affected resource.
   2. Verify `--profile <project>` is set. Never use the default profile.
   3. Verify no hardcoded secrets appear in the diff.
   4. `git status` clean, or intentionally dirty with awareness.

2. **Stage and suffix system**
   - Stages: `dev`, `staging`, `prod`.
   - `dev` stage requires a suffix (`dev-alice`, `dev-bob`) to avoid collisions between developers deploying concurrently.
   - Suffix is passed via CDK context: `cdk deploy --all -c stage=dev -c suffix=alice`.
   - Validated in `bin/app.ts` at synth time so invalid combinations fail early.

3. **Stack separation decision tree**
   - **Stateful/Stateless separation applies only when instance-backed resources are present** (Aurora Serverless v2, RDS, EC2, OpenSearch Domain, ElastiCache cluster). In those cases, separating compute from stateful resources prevents accidental replacement on compute deploys.
   - **For 100% serverless architectures** (DynamoDB + Lambda + S3 + Cognito + API Gateway + Secrets Manager), keep everything in a single backend stack. Only separate frontend (S3 + CloudFront) because of cross-region ACM cert constraints and distinct lifecycle.

4. **Two-stack deploy workflow**
   - Build the frontend first so the frontend stack can upload `dist/` to S3.
   - Deploy both stacks with `cdk deploy --all`.
   - Backend exports (Cognito IDs, API URL, table names) feed into frontend `config.json` generation.

5. **CloudFront domain registration**
   - See `03-static-site.md` for the full workflow. Summary: first deploy produces a domain; register it in `cdk.json` context; re-deploy so CORS, Cognito callbacks, and logout URLs include it.

6. **Binary `isProd` branching**
   - Concrete example showing memory sizes, retention periods, and deletion protection varying only along the `isProd` axis.
   - Exception: compliance requirements (SOC2 staging parity) can justify multi-tier branching.

7. **Rollback**
   > **Scope of this skill:** Covers only the basic rollback pattern (checkout previous commit → redeploy). Advanced deployment strategies (blue/green, canary, feature flags, CodeDeploy-backed Lambda aliases) are **out of scope** for this version. When those are needed, consult AWS CodeDeploy documentation directly or future iterations of this skill.
   - Basic pattern: `git checkout <previous-commit>` → `cdk deploy --all` with the same stage/suffix.
   - Pre-condition: the previous commit must be a known-good state. Document the snapshot discipline (tag known-good deploys) for safer rollbacks.

8. **Windows/PowerShell note**
   - AWS CLI from bash shell hangs on Windows — use `powershell.exe -Command "aws ..."` instead.

9. **Gotchas catalog:**
   - "Unable to resolve AWS account" → missing `--profile`.
   - Stack replacement from silent `env` changes → use stable env vars for `account`/`region`.
   - "Export cannot be removed" → cross-stack refs must be deployed in dependency order. Remove the consumer first, then the producer.
   - Frontend deploy failing because `dist/` is empty → build the frontend before `cdk deploy --all`.

## Cross-cutting content

Several patterns appear in multiple reference files (e.g., `validateEnv` is used in every handler template). The convention is:

- **Full template and explanation** lives in `05-shared-utilities.md`.
- **Usage example** in other files (e.g., `01-serverless-api.md`) shows the utility applied, without re-documenting it.
- Gotchas for the utility live in `05-shared-utilities.md`. Other files may cross-reference them in their own gotchas catalog using the format: "see `05-shared-utilities.md` gotcha: <entry>".

## Content sourcing strategy

Patterns are written from scratch to be generic and reusable, not copied from any specific project. When memory files and architecture notes conflict with current library state, the current state wins, and the memory is treated as potentially outdated.

All AWS CDK v2 construct signatures and API references validated against `mcp__plugin_context7_context7__query-docs` for `aws-cdk-lib` during implementation. Conflicts are flagged and resolved before writing the final reference file.

No patterns are copied from proprietary code. The skill is self-contained: any reader on any machine can follow the patterns without access to external documentation.

## Testing approach (RED-GREEN-REFACTOR for reference skills)

Testing uses `claude -p` (non-interactive mode) with `--plugin-dir` isolation. Reference skills are tested on **retrieval** (does Claude find and load the correct reference file?) and **application** (does the final response contain the correct pattern or gotcha?).

### Scenarios (9 total, Spanish + English)

Located in `plugins/dev-patterns/tests/scenarios.txt`:

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

**Scenario notes:**

- Scenarios 1 and 6 test the discovery of `00-architecture.md` as the entry point for new projects.
- Scenario 4 tests the atomic uniqueness pattern in `04-database.md` (must not recommend GSI query + separate write).
- Scenario 5 tests the discovery of `05-shared-utilities.md`.
- Scenario 9 is the anti-dogma test: a correct answer does **not** recommend separating DynamoDB/Cognito/Secrets from compute in a purely serverless architecture. A skill that blindly prescribes stateful/stateless fails this scenario.

### RED phase (baseline — no skill)

```bash
# Isolated workspace, all skills disabled
mkdir -p /tmp/cdk-skill-test
cd /tmp/cdk-skill-test

claude -p --disable-slash-commands "<scenario prompt>" \
  > /tmp/test-results/red/scenario-NN.txt
```

**Implementation note:** `--disable-slash-commands` is documented as "Disable all skills" in `claude -p --help`. Verify during implementation that this flag disables automatic skill discovery (description matching), not only slash-invoked skills. If it only disables slash invocation, the RED phase must use an alternative isolation strategy — for example, running `claude -p` from a workspace with `--setting-sources project` and an empty project-local settings file, which would prevent the user-level plugin set from loading. Validate before writing the scenarios file.

### GREEN phase (only dev-patterns loaded)

```bash
claude -p \
  --plugin-dir /c/Users/spuli/code/claude-skills/plugins/dev-patterns \
  --setting-sources project \
  "<scenario prompt>" \
  > /tmp/test-results/green/scenario-NN.txt
```

**Why these flags:**

- `--plugin-dir` loads only `dev-patterns` for the session.
- `--setting-sources project` ignores user-level plugin config, ensuring no other installed plugins interfere.
- Workspace is `/tmp/cdk-skill-test` so there is no ambient `CLAUDE.md` or memory bleeding into context.

**Success criteria per scenario:**

- GREEN response mentions the correct pattern or gotcha (e.g., scenario 3 mentions `client.node.addDependency(googleProvider)`; scenario 4 mentions dedicated lookup table with `attribute_not_exists`).
- GREEN response does not hallucinate generic patterns when a specific gotcha applies.
- GREEN response is clearly better than RED. If RED and GREEN are comparable, the scenario is not a useful test and should be replaced.

### REFACTOR phase (adversarial gap testing)

After GREEN passes, add adversarial scenarios:

- Ambiguous query that could apply to 2 files (e.g., "how do I log errors in my Lambda?" applies to both `01-serverless-api.md` and `06-deploy-workflow.md`). The skill must route correctly.
- Non-canonical terminology (e.g., "gateway de API" instead of "API Gateway"). The trigger must still fire.
- Out-of-scope query (e.g., "SQS queue patterns"). The skill must recognize the gap and not fabricate content.

Iterate until all scenarios pass.

### Automation

Script: `plugins/dev-patterns/scripts/test-skill.sh`

Runs RED and GREEN phases for every scenario in `tests/scenarios.txt`, writes output to a timestamped results directory, and produces diffs. No judgment is automated — a human reviews the diffs to confirm success criteria.

## Implementation sequencing (Option B: full upfront)

Single implementation pass producing all components:

1. Create plugin structure and `plugin.json`.
2. Write `SKILL.md` with frontmatter, decision tree, cross-cutting principles, architecture pointer, and reference index.
3. Write `00-architecture.md` first — everything else cross-references it.
4. Write `05-shared-utilities.md` second — `01`, `02`, `04` depend on it for their templates.
5. Write `01-serverless-api.md`, `02-auth-stack.md`, `03-static-site.md`, `04-database.md`, `06-deploy-workflow.md` in any order.
6. Validate every CDK v2 API call and construct signature against context7 docs during writing.
7. Write `scripts/test-skill.sh` and `tests/scenarios.txt`.
8. Register plugin in `marketplace.json`.
9. Run RED phase (baseline capture) and confirm `--disable-slash-commands` behavior.
10. Run GREEN phase, review diffs, iterate until all 9 scenarios pass.
11. Run REFACTOR phase with adversarial scenarios; patch skill as needed.
12. Commit to feature branch, push, open PR.

## Open questions resolved during brainstorming

- **Scope: gotchas only, patterns only, or both?** → Both, combined into use-case files.
- **Organization: by service, by use case, or split?** → By use case, with gotchas embedded in each file, plus a foundational architecture file.
- **Content source?** → Written from scratch for portability; validated against context7 AWS CDK docs.
- **Placement?** → New `dev-patterns` plugin, registered in `marketplace.json`.
- **Implementation pace?** → Full upfront (all 7 files at once).
- **Language?** → Skill in English (consistency with other plugins); tests in both Spanish and English.
- **Single-table design as universal?** → No. Both single-table and multi-table are documented with a decision tree.
- **Stateful/stateless as universal?** → No. Applies only when instance-backed resources are present.
- **Rollback scope?** → Basic only; advanced strategies documented as out of scope.
- **Hexagonal architecture as mandatory or recommended?** → Highly recommended as the default. Explicit exception for extra-simple applications (single handler, small utility, short-lived prototype) where the overhead outweighs the benefit.
- **Self-contained vs. linking to external docs?** → Self-contained. All patterns replicated in the skill body. No references to specific projects or private documentation.

## Explicit non-goals

- This skill does not prescribe a specific project layout outside of the module structure under `modules/{domain}/`. Monorepo vs. polyrepo, src layout, and similar decisions are orthogonal.
- This skill does not cover CI/CD pipeline setup (GitHub Actions, CodePipeline). Can be added as a future reference file.
- This skill does not cover observability deep dives (alarm thresholds, X-Ray sampling, log insights queries).
- This skill does not include cost estimates or cost optimization strategies.
- This skill does not document AWS services beyond the ones in the reference files. Services used in passing (e.g., EventBridge in `00-architecture.md`) are referenced at the level needed to understand the cross-module communication pattern, not exhaustively.
