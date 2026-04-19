---
name: aws-cdk-patterns
description: Use when writing AWS CDK code in TypeScript — starting a new CDK project, building serverless APIs with Lambda and DynamoDB, adding authentication with Cognito, hosting a single-page app on S3 and CloudFront, designing DynamoDB access patterns, writing Lambda handlers, or running CDK deploys.
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
