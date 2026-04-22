# dynamodb-design skill — Design

**Status:** Draft
**Date:** 2026-04-21
**Plugin:** `dev-patterns`
**Spec author:** Claude (with user oversight)

## 1. Overview

A new skill under the `dev-patterns` plugin that teaches Claude how to **design** a DynamoDB schema from access patterns, independent of any deploy target. Complements — but does not duplicate — the DynamoDB content already in `plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md`, which covers CDK provisioning and three critical runtime patterns (atomic uniqueness, identity-verified updates, cursor pagination).

Skill slug: `dynamodb-design`.

## 2. Jobs-to-be-done

Three JTBDs covered, with a shared methodology backbone:

1. **Greenfield** — Design a schema from scratch for a new bounded context.
2. **Extension** — Add a new access pattern to an existing table (choose GSI vs key overloading vs separate table).
3. **Migration** — Evolve an existing schema without downtime (dual-write, backfill, cutover).

The methodology section (00) handles all three as branches of a single decision flow so there is no duplicated content per JTBD.

## 3. Relationship to `aws-cdk-patterns/04-database.md`

**Principle: cross-reference by default; move canonical ownership only where the content belongs in a different conceptual home.**

- `aws-cdk-patterns/04-database.md` stays as-is. It owns:
  - Aurora Serverless v2 provisioning (unrelated to this skill)
  - `Table` construct with PITR/TTL/GSI (provisioning)
  - Three runtime patterns with full TypeScript code: atomic uniqueness (`TransactWriteCommand` + lookup table), identity-verified updates, cursor-based pagination
  - Single-table vs multi-table decision tree

- `dynamodb-design` references these by pattern name and cross-links to the CDK skill for the TypeScript implementation:
  - `01-modeling.md` mentions the uniqueness lookup-table pattern → "see `aws-cdk-patterns/04-database.md` §4 for the TS implementation"
  - `03-write-correctness.md` mentions identity-verified updates → cross-reference
  - `03-write-correctness.md` mentions cursor pagination → cross-reference
  - The single-table vs multi-table decision tree: **both** skills reference it. `dynamodb-design/01-modeling.md` is the canonical source (part of the modeling workflow); `aws-cdk-patterns/04-database.md` §2 keeps a one-paragraph summary + link back to `dynamodb-design/01-modeling.md`. This is the **only** piece of content that moves canonical ownership — the other three runtime patterns stay canonical in CDK.

After the skill ships, `aws-cdk-patterns/04-database.md` gets a small update (§2 trimmed to a summary + link). No other edits to the CDK skill.

## 4. Skill structure (Theme-oriented, 8 reference files)

```
plugins/dev-patterns/skills/dynamodb-design/
├── SKILL.md                                    # lean router with decision tree
├── references/
│   ├── 00-methodology.md                       # the design process (backbone)
│   ├── 01-modeling.md                          # keys + GSIs + single vs multi-table
│   ├── 02-scaling.md                           # hot partitions + item size + cost
│   ├── 03-write-correctness.md                 # locking, counters, batch ops
│   ├── 04-streams-cdc.md                       # DynamoDB Streams, Pipes, idempotency
│   ├── 05-evolution.md                         # migration without downtime
│   ├── 06-testing-local-dev.md                 # DynamoDB Local, testcontainers, tests
│   └── 07-gotchas.md                           # full catalog
├── scripts/
│   ├── test-skill.ps1                          # Windows harness (mirror of aws-cdk-patterns)
│   └── test-skill.sh                           # Unix harness
└── tests/
    └── scenarios.txt                           # RED/GREEN prompts
```

## 5. Per-reference scope

### SKILL.md (lean router)

Frontmatter: `name: dynamodb-design`, description optimized for Claude Search Optimization (CSO) triggers without workflow summary. Follows `aws-cdk-patterns/SKILL.md` format.

Body: 1-paragraph intro + decision tree table routing by task:

| Task | Reference |
|------|-----------|
| Designing a new schema | `00-methodology.md` + `01-modeling.md` |
| Adding a new access pattern | `00-methodology.md` §extension + `01-modeling.md` |
| Migrating without downtime | `05-evolution.md` |
| Hot partition / throttling | `02-scaling.md` |
| Atomic write (locking, counters, batch) | `03-write-correctness.md` |
| Setting up Streams or CDC | `04-streams-cdc.md` |
| Testing DynamoDB code locally | `06-testing-local-dev.md` |
| Diagnosing a symptom | `07-gotchas.md` |
| Atomic uniqueness, identity-verified updates, cursor pagination | `aws-cdk-patterns/04-database.md` §4-6 |

### 00-methodology.md

The **design process** as a reusable workflow. Structure:

1. **Inventory access patterns** — table of (operation, entity, frequency, latency budget, consistency need). Use the ubiquitous language of the domain, not CRUD labels.
2. **Classify each pattern** — lookup (PK read), collection (PK + sort range), global lookup (secondary attribute), aggregation (count/sum), search (contains/range on non-key attribute).
3. **Derive base-table keys** — strongest-frequency pattern drives PK/SK; validate every other pattern is reachable from the base table or a GSI.
4. **Add GSIs** — one per distinct access pattern not served by the base table. Stop when patterns are exhausted.
5. **Validate against constraints** — item size, hot partition, cost, consistency requirements.
6. **Decide single-table vs multi-table** — pointer to `01-modeling.md`.

JTBD branches:
- **Greenfield**: full workflow above.
- **Extension**: inventory the *new* pattern, then jump to step 4 (GSI vs overloading vs separate table).
- **Migration**: full workflow on the target schema, then pointer to `05-evolution.md` for the cutover.

Includes a worked example (e-commerce: user, order, order-item, review) from inventory → final key shape.

### 01-modeling.md

Covers:
- **Single-table vs multi-table decision tree** (canonical source — CDK skill has summary + link back).
- **Partition key design** — high cardinality, even distribution, caller-provided vs system-generated, never reuse user input for PKs that leak.
- **Sort key design** — composite patterns, prefix schemes (`ORDER#<id>`, `USER#<id>#ORDER#<id>`), begins_with queries.
- **Key overloading / entity discrimination** — `pk`/`sk` reused across entity types, `entity_type` attribute for Stream routing, the sort-key prefix convention.
- **GSI design** — PK/SK selection, projection type tradeoffs (`KEYS_ONLY` / `INCLUDE` / `ALL`) with concrete cost examples, sparse indexes for filtering.
- **Adjacency list / hierarchical patterns** — one-to-many, many-to-many, nested hierarchies in a single table.
- **Cross-reference** to `aws-cdk-patterns/04-database.md` §4 for the uniqueness lookup-table pattern.

### 02-scaling.md

Covers:
- **Hot partitions** — symptoms (throttling, uneven CloudWatch partition metrics), detection via contributor insights, mitigation via write sharding (suffix `#0`..`#N`), calendar-based PK sharding.
- **Item size** — 400KB hard limit, 1KB WCU / 4KB RCU billing boundaries, when to split items, S3 offload pattern with an item-level pointer.
- **Cost modeling** — PAY_PER_REQUEST vs PROVISIONED with a breakeven formula, RCU/WCU budgeting, GSI write amplification.
- **Auto scaling** — when it helps, when it lags traffic spikes, reservation vs on-demand.

### 03-write-correctness.md

Covers:
- **Optimistic locking** — `version` attribute, `ConditionExpression: version = :expected`, retry loop with cap.
- **Atomic counters** — `ADD :delta` on a numeric attribute for low-contention counters.
- **Sharded counters** — N-shard pattern for high-contention counters, periodic roll-up for reads.
- **Batch operations** — `BatchGetCommand` / `BatchWriteCommand` 25-item limit, `UnprocessedItems` retry loop with exponential backoff, partial-failure semantics.
- **TransactWriteCommand beyond uniqueness** — multi-item atomic updates, cross-table transactions, 100-item / 4MB limit, cost model (2x writes billed).
- **Cross-references** to `aws-cdk-patterns/04-database.md` §4-6 for atomic uniqueness, identity-verified updates, cursor pagination.

### 04-streams-cdc.md

Covers:
- **When Streams** — change data capture to downstream systems (search index, audit log, S3 projection, cache invalidation).
- **Stream view types** — `NEW_IMAGE` / `OLD_IMAGE` / `NEW_AND_OLD_IMAGES` / `KEYS_ONLY` with decision guidance.
- **Consumer patterns** — Lambda with `LambdaEventSource`, batch size and parallelization factor, error handling (bisect-on-error, DLQ).
- **Idempotency** — consumer must tolerate redelivery (at-least-once semantics); use `eventID` as idempotency key, store processed IDs in a short-TTL item.
- **Streams vs EventBridge Pipes** — Pipes for filter + enrich + route without a Lambda, Streams + Lambda for custom processing; decision tree.
- **Gotchas** — 24h retention, consumer lag detection, shard splits.

### 05-evolution.md

Covers:
- **Schema evolution** without breaking clients — item-version attribute, forward-compatible writes, backward-compatible reads.
- **Adding a GSI to a live table** — backfill cost, `CONTRIBUTING_INDEXES` metric, 2x write cost during backfill.
- **Removing a GSI** — cost implications, reads that silently fall back to Scan.
- **Renaming an attribute** — dual-write then cutover; copy script template.
- **Splitting a table** (single → multi) — reverse migration pattern.
- **Consolidating tables** (multi → single) — key design for merged access patterns.
- **Cutover strategies** — dual-write with version flag, shadow reads, percentage-based rollout.

### 06-testing-local-dev.md

Covers:
- **DynamoDB Local** — install, in-memory vs file-backed, port config, Docker vs standalone jar, limitations (no Streams, no global tables, PITR no-op).
- **Testcontainers for DynamoDB** — library-managed ephemeral container, integration with Jest / Vitest / Pytest, teardown.
- **LocalStack** — when it's preferable (Streams + Lambda locally); licensing note (open source vs pro tiers).
- **Access-pattern tests** — one test per access pattern, exercise the exact query shape the handler runs in production.
- **Test data seeding** — `BatchWrite` seeding helpers, deterministic IDs for snapshot stability.
- **Cross-reference** to `aws-cdk-patterns/00-architecture.md` for construct-level assertion tests.

### 07-gotchas.md

Symptom → root cause → fix table covering at least:

- GSI returns stale data after write (eventual consistency, no `ConsistentRead` on GSIs)
- `Scan` becomes slow as table grows
- `BatchWrite` silently drops items (UnprocessedItems not retried)
- Hot partition throttling under synthetic load tests only (uneven PK distribution in seed data)
- Item exceeds 400KB (attribute accretion; fix: S3 offload)
- Streams consumer lag spikes (insufficient `ParallelizationFactor` or shard hot-spotting)
- TTL not deleting items (string timestamp instead of Unix epoch integer)
- TransactWrite fails with `TransactionCanceledException` (multiple condition checks; inspect `CancellationReasons`)
- `ValidationException: ExpressionAttributeNames`/`Values` mismatch (attribute name collision with reserved words)
- DynamoDB Local missing Streams for a test that worked locally but fails in LocalStack
- Expression attribute cardinality blowup (a single Query with 100+ filters — split or redesign)

## 6. Code-example conventions

- **Language: TypeScript** with `@aws-sdk/lib-dynamodb` (matches `aws-cdk-patterns`).
- Every code snippet verified against the current `@aws-sdk/lib-dynamodb` and `@aws-sdk/client-dynamodb` / `@aws-sdk/client-dynamodb-streams` APIs via **context7** before committing.
- Each reference file carries a one-line note: "Patterns translate mechanically to Python (`boto3`), Go, etc. — the modeling is language-agnostic; SDK names and argument keys differ."
- Imports explicit, no `any`, no omitted error handling.
- Units documented (`ms`, `bytes`, `RCU`, `WCU`) wherever numeric.

## 7. Testing harness

Mirror `aws-cdk-patterns`:

- `scripts/test-skill.ps1` and `scripts/test-skill.sh` — both run the same two-phase scenario suite (RED: baseline without skill, GREEN: with skill loaded via `--plugin-dir` + `--add-dir` + `--setting-sources project`).
- `tests/scenarios.txt` — one prompt per line, designed to exercise the skill's claims. Candidate scenarios:
  1. "Design a DynamoDB schema for a task manager (users, projects, tasks, comments)."
  2. "How do I add a 'list orders by status' access pattern to an existing orders table?"
  3. "I need to migrate from `status-index` GSI to sort-key prefixes — describe the cutover."
  4. "My DynamoDB writes throttle under load tests but not in prod. Diagnose."
  5. "Implement a sharded counter for daily page views."
  6. "Wire a DynamoDB Stream to a Lambda that projects changes into OpenSearch."
  7. "Add optimistic locking to our user-profile update endpoint."
- Per-scenario outputs + unified diffs written to a timestamped directory. Human reviews diffs against per-scenario success criteria.
- Same "do not run inside an active Claude Code session" warning in README.

## 8. README updates

- `plugins/dev-patterns/README.md` — add a "Skills included" entry for `dynamodb-design` with decision tree excerpt and key topics list, mirroring the `aws-cdk-patterns` format.
- Root `README.md` — update the dev-patterns row ("1 skill" → "2 skills") and add a `dynamodb-design` detail section.
- `aws-cdk-patterns/04-database.md` §2 — trim to a summary paragraph + cross-link to `dynamodb-design/01-modeling.md`.

## 9. Success criteria

Skill is considered done when:

1. All 8 reference files written, each following the `aws-cdk-patterns` format (purpose statement, prerequisites, TOC, sections, gotchas, verification, further reading).
2. Every TypeScript code snippet validated against current AWS SDK v3 via context7.
3. Cross-references to `aws-cdk-patterns/04-database.md` are in place both ways (CDK skill links here for modeling methodology; this skill links to CDK for the 3 runtime patterns).
4. Testing harness runs end-to-end on Windows (ps1) and Unix (sh).
5. RED/GREEN diff review shows measurable improvement on at least 5 of the 7 scenarios.
6. READMEs updated (root + plugin + CDK §2 trimmed).
7. Commit messages follow repo convention; PR merged to `master`.

## 10. Non-goals

- **Not covered**: SQL modeling, general NoSQL theory, non-DynamoDB key-value stores, DAX caching (may come later as its own skill), DynamoDB Global Tables (multi-region replication is out of scope — distinct enough to warrant its own skill later).
- **Not a replacement** for AWS's own DynamoDB Developer Guide. The skill is opinionated shortcuts + known-good patterns, not exhaustive reference.
- **No CDK** provisioning code. Any reader needing to provision the table reads `aws-cdk-patterns/04-database.md` §3.

## 11. Risks

- **Overlap drift**: as DynamoDB evolves, the single vs multi-table decision tree could end up edited in both places. Mitigation: a banner comment at the top of the CDK skill's §2 saying "canonical source: `dynamodb-design/01-modeling.md`; keep this summary in sync."
- **Skill sprawl**: 8 reference files is at the upper end of what a lean SKILL.md can route cleanly. Mitigation: aggressive decision-tree routing in SKILL.md so Claude loads only the relevant ref for a given task.
- **Testing harness false confidence**: scenarios exercise what the skill *claims* to improve, but a human still has to read the diffs. The harness is a regression catcher, not a correctness proof.

## 12. Open questions

None at spec time. Scope, structure, integration with `aws-cdk-patterns`, testing approach, and language conventions are all confirmed.
