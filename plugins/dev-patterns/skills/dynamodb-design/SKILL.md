---
name: dynamodb-design
description: Design DynamoDB schemas from access patterns. Covers key design, GSIs, hot-partition mitigation, atomic write patterns (optimistic locking, counters, batch ops), DynamoDB Streams and CDC, schema evolution without downtime, and local testing. Stack-agnostic modeling with TypeScript code examples.
---

# DynamoDB Design

Opinionated patterns for designing a DynamoDB schema: inventory access patterns, derive keys, add GSIs, validate against scaling and cost constraints. Stack-agnostic — for CDK provisioning see `aws-cdk-patterns`.

## When to load each reference

| Task | Reference file |
|------|----------------|
| Designing a new schema from scratch | `references/00-methodology.md` + `references/01-modeling.md` |
| Adding a new access pattern to an existing table | `references/00-methodology.md` (extension branch) + `references/01-modeling.md` |
| Migrating a schema without downtime | `references/05-evolution.md` |
| Throttling or uneven partition usage | `references/02-scaling.md` |
| Optimistic locking, atomic counters, or batch ops | `references/03-write-correctness.md` |
| Wiring DynamoDB Streams or CDC | `references/04-streams-cdc.md` |
| Running DynamoDB locally for tests | `references/06-testing-local-dev.md` |
| Diagnosing a production symptom | `references/07-gotchas.md` |
| Atomic uniqueness, identity-verified updates, cursor pagination (runtime patterns with full TypeScript) | `aws-cdk-patterns/references/04-database.md` §4-6 |

## Conventions

- Code examples use `@aws-sdk/lib-dynamodb` (AWS SDK for JavaScript v3). Patterns translate mechanically to `boto3` (Python), the Go SDK, etc.
- Key schemas use `pk` / `sk` as attribute names with sort-key prefix conventions documented per pattern.
- Every runtime code snippet is paired with a verification command when one applies.

## Further reading

- Sibling skill: `aws-cdk-patterns` — provisioning DynamoDB tables with CDK, Aurora patterns, and the three canonical runtime patterns referenced here.
