# dynamodb-design skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `dynamodb-design` skill under `plugins/dev-patterns/` that teaches Claude how to design a DynamoDB schema from access patterns, with cross-references to `aws-cdk-patterns/04-database.md` for provisioning and the three canonical runtime patterns.

**Architecture:** Theme-oriented, progressive disclosure. Lean `SKILL.md` routes Claude to 8 topic references (methodology, modeling, scaling, write-correctness, streams/CDC, evolution, testing/local-dev, gotchas). Mirror the `aws-cdk-patterns` testing harness. Cross-references bidirectional with `aws-cdk-patterns/04-database.md`.

**Tech Stack:** Markdown reference files. TypeScript code snippets using `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-dynamodb-streams`. PowerShell 7+ and Bash for the test harness. Every SDK call verified against current docs via **context7** before committing.

**Source of truth:** `plans/2026-04-21-dynamodb-design-skill-design.md`

---

## Working conventions (apply to every task)

- **Language:** English for all skill content (matches `aws-cdk-patterns`).
- **Code style:** Explicit imports, no `any`, no elided error handling, units annotated (`ms`, `bytes`, `RCU`, `WCU`).
- **SDK verification:** Before committing any TS snippet that uses `@aws-sdk/lib-dynamodb` or sibling packages, resolve the library ID via `mcp__context7__resolve-library-id` and fetch current usage via `mcp__context7__query-docs`. Prefer the v3 modular SDK (`@aws-sdk/lib-dynamodb` DocumentClient wrappers: `GetCommand`, `PutCommand`, `QueryCommand`, `UpdateCommand`, `DeleteCommand`, `TransactWriteCommand`, `BatchGetCommand`, `BatchWriteCommand`).
- **Cross-reference format:** relative paths with the anchor name:
  - From this skill to CDK skill: `../../aws-cdk-patterns/references/04-database.md` + section name.
  - From CDK skill back to this skill: `../../dynamodb-design/references/01-modeling.md` (added only in Task 11).
- **Commit cadence:** one commit per task. Message format: `feat(dynamodb-design): <summary>` or `docs(dynamodb-design): <summary>`.
- **Do not auto-push.** User explicitly confirms before any `git push`.

---

## Task 1: Scaffold directory + SKILL.md

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/SKILL.md`
- Create (empty placeholders): `plugins/dev-patterns/skills/dynamodb-design/references/.gitkeep`, `plugins/dev-patterns/skills/dynamodb-design/scripts/.gitkeep`, `plugins/dev-patterns/skills/dynamodb-design/tests/.gitkeep`

- [ ] **Step 1: Create directory skeleton**

```bash
mkdir -p plugins/dev-patterns/skills/dynamodb-design/references \
         plugins/dev-patterns/skills/dynamodb-design/scripts \
         plugins/dev-patterns/skills/dynamodb-design/tests
touch plugins/dev-patterns/skills/dynamodb-design/references/.gitkeep \
      plugins/dev-patterns/skills/dynamodb-design/scripts/.gitkeep \
      plugins/dev-patterns/skills/dynamodb-design/tests/.gitkeep
```

- [ ] **Step 2: Write SKILL.md**

Mirror the frontmatter convention of `plugins/dev-patterns/skills/aws-cdk-patterns/SKILL.md`: `name: dynamodb-design` (lowercase, hyphens — not spaces), description optimized for Claude Search Optimization without a workflow summary.

Content:

```markdown
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
```

- [ ] **Step 3: Verify SKILL.md loads cleanly**

Run: `cat plugins/dev-patterns/skills/dynamodb-design/SKILL.md | head -40`
Expected: Frontmatter parses, routing table readable.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/
git commit -m "feat(dynamodb-design): scaffold skill directory and SKILL.md router"
```

---

## Task 2: Write `00-methodology.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/00-methodology.md`

- [ ] **Step 1: Draft outline**

Sections:
1. Purpose + prerequisites header (matches `aws-cdk-patterns` reference file format)
2. Contents (numbered TOC)
3. The six-step design process (inventory → classify → base keys → GSIs → validate → single-vs-multi)
4. JTBD branches: Greenfield / Extension / Migration — each as a subsection routing to the relevant downstream reference
5. Worked example: e-commerce (users, orders, order-items, reviews) — inventory table → final key shape for single-table and multi-table variants
6. Anti-patterns (mini-section): CRUD-labeled patterns, designing keys before patterns, skipping the item-size check
7. Further reading (links to modeling, scaling, evolution; plus the AWS Developer Guide)

- [ ] **Step 2: Verify methodology claims via context7**

Fetch current DynamoDB best-practices docs to confirm the methodology aligns with AWS's own guidance (especially around GSI overloading and key design):

```
mcp__context7__resolve-library-id("aws dynamodb")
mcp__context7__query-docs for "best practices design access patterns"
```

Note: this step verifies conceptual alignment only; no TS code in this file.

- [ ] **Step 3: Write the file**

Write `00-methodology.md` following the outline. Target length: ~400-600 lines. Code blocks only for the worked-example access-pattern inventory table and the final keys (plain text / markdown tables, no SDK calls).

- [ ] **Step 4: Spot-check cross-references**

Run: `grep -E '\(\.\./|\(references/|04-database\.md' plugins/dev-patterns/skills/dynamodb-design/references/00-methodology.md`
Expected: All cross-references use the conventions in "Working conventions". Fix any that don't.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/00-methodology.md
git commit -m "feat(dynamodb-design): add 00-methodology.md"
```

---

## Task 3: Write `01-modeling.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/01-modeling.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents (TOC)
3. Single-table vs multi-table decision tree (**canonical home** — CDK skill will link here after Task 11)
4. Partition key design — cardinality, distribution, caller-provided vs system-generated
5. Sort key design — composite patterns, prefix schemes (`ORDER#<id>`, `USER#<id>#ORDER#<id>`), `begins_with` queries
6. Key overloading / entity discrimination — `entity_type` attribute, sort-key prefix conventions, Stream routing implications
7. GSI design — PK/SK selection, projection types (`KEYS_ONLY` / `INCLUDE` / `ALL`) with concrete byte-cost examples, sparse indexes for filtering
8. Adjacency list / hierarchical patterns — one-to-many, many-to-many, hierarchical containment in a single table
9. Cross-reference: atomic uniqueness lookup-table pattern → `aws-cdk-patterns/references/04-database.md` §4
10. Verification — `aws dynamodb describe-table` sanity checks on keys and GSIs
11. Further reading

- [ ] **Step 2: Verify SDK calls via context7 for the Query/GetItem snippets**

```
mcp__context7__query-docs for "@aws-sdk/lib-dynamodb QueryCommand KeyConditionExpression begins_with"
mcp__context7__query-docs for "@aws-sdk/lib-dynamodb GetCommand"
```

- [ ] **Step 3: Write the file**

Target ~600-900 lines. Code blocks for: Query with sort-key prefix, GetItem, GSI definition (CDK-free — just the JSON-ish DynamoDB shape for `describe-table` output), projection-cost walk-through.

- [ ] **Step 4: Spot-check cross-references and anchor names**

Run: `grep -nE '04-database|aws-cdk-patterns' plugins/dev-patterns/skills/dynamodb-design/references/01-modeling.md`
Expected: at least one cross-reference to `aws-cdk-patterns/references/04-database.md` §4 for atomic uniqueness.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/01-modeling.md
git commit -m "feat(dynamodb-design): add 01-modeling.md"
```

---

## Task 4: Write `02-scaling.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/02-scaling.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents (TOC)
3. Hot partitions — symptoms (CloudWatch `ThrottledRequests`, `UserErrors`), detection via contributor insights, mitigation (write sharding with suffix `#0`..`#N`, calendar-based sharding)
4. Item size — 400KB hard limit, WCU/RCU boundaries (1KB write, 4KB eventually-consistent read, 4KB strongly-consistent read), split-item strategies, S3 offload with pointer attribute
5. Cost modeling — `PAY_PER_REQUEST` vs `PROVISIONED` breakeven formula, RCU/WCU budgeting per access pattern, GSI write amplification (each non-`KEYS_ONLY` GSI adds a full write cost)
6. Auto scaling — where it helps, where it lags (minute-granularity adaptation), reservation vs on-demand economics
7. Gotchas (subset of the global catalog — just scaling-related)
8. Verification — CloudWatch queries for throttled requests and partition skew
9. Further reading

- [ ] **Step 2: Verify cost math assumptions via context7**

```
mcp__context7__query-docs for "dynamodb on-demand vs provisioned pricing RCU WCU"
mcp__context7__query-docs for "dynamodb hot partition adaptive capacity"
```

Confirm numbers: is adaptive capacity still the default? What's the current RCU/WCU cost per million?

- [ ] **Step 3: Write the file**

Target ~500-700 lines. Include at least one full breakeven calculation with numbers and one contributor-insights screenshot description.

- [ ] **Step 4: Verify CloudWatch query syntax**

The verification section uses `aws cloudwatch get-metric-statistics`. Validate command syntax manually.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/02-scaling.md
git commit -m "feat(dynamodb-design): add 02-scaling.md"
```

---

## Task 5: Write `03-write-correctness.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/03-write-correctness.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents
3. Optimistic locking — `version` attribute, `ConditionExpression: version = :expected`, bounded retry loop, cross-reference to identity-verified updates
4. Atomic counters — `ADD :delta` on a numeric attribute, when it's safe (low contention), when it breaks (hot item)
5. Sharded counters — N-shard pattern, writer randomization, periodic roll-up for reads, eventual-consistency implications
6. Batch operations — `BatchGetCommand` / `BatchWriteCommand` 25-item cap, `UnprocessedItems` retry loop with exponential backoff, partial-failure semantics, when to prefer `TransactWriteCommand`
7. `TransactWriteCommand` beyond uniqueness — multi-item atomic updates, cross-table transactions, 100-item / 4MB limits, 2x write cost
8. Cross-references (with one-paragraph summaries, NOT duplicate code):
   - Atomic uniqueness: → `aws-cdk-patterns/references/04-database.md` §4
   - Identity-verified updates: → `aws-cdk-patterns/references/04-database.md` §5
   - Cursor pagination: → `aws-cdk-patterns/references/04-database.md` §6
9. Gotchas (write-correctness subset)
10. Verification — concurrent-write test harness template
11. Further reading

- [ ] **Step 2: Verify SDK calls via context7**

```
mcp__context7__query-docs for "@aws-sdk/lib-dynamodb UpdateCommand ConditionExpression"
mcp__context7__query-docs for "@aws-sdk/lib-dynamodb BatchWriteCommand UnprocessedItems"
mcp__context7__query-docs for "@aws-sdk/lib-dynamodb TransactWriteCommand"
```

Confirm: argument shapes, `UnprocessedItems` return field, `TransactionCanceledException` import path.

- [ ] **Step 3: Write the file**

Target ~700-900 lines. Full TS implementations for: optimistic locking loop, sharded counter (writer + reader), `UnprocessedItems` retry with exponential backoff.

- [ ] **Step 4: Verify error-class import paths match current SDK**

Run: `grep -rE 'from "@aws-sdk/client-dynamodb"' plugins/dev-patterns/skills/dynamodb-design/references/03-write-correctness.md`
Expected: only exception types (`TransactionCanceledException`, `ConditionalCheckFailedException`) imported from `@aws-sdk/client-dynamodb`; commands come from `@aws-sdk/lib-dynamodb`.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/03-write-correctness.md
git commit -m "feat(dynamodb-design): add 03-write-correctness.md"
```

---

## Task 6: Write `04-streams-cdc.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/04-streams-cdc.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents
3. When to use Streams — CDC to downstream systems (OpenSearch, audit log, S3 projection, cache invalidation, cross-region replication)
4. Stream view types — `NEW_IMAGE` / `OLD_IMAGE` / `NEW_AND_OLD_IMAGES` / `KEYS_ONLY` with decision guidance and cost/bandwidth tradeoffs
5. Lambda consumers — `LambdaEventSource` event source mapping, `BatchSize`, `ParallelizationFactor`, `MaximumRetryAttempts`, bisect-on-error
6. Idempotency — at-least-once semantics mean consumers must tolerate redelivery; use `eventID` as idempotency key, store processed IDs in a TTL-ed item
7. Streams vs EventBridge Pipes — Pipes for filter+enrich+route without Lambda; Streams+Lambda for custom processing; decision tree
8. Error handling — on-failure destinations (SQS DLQ, SNS), stream-level retries, how failed records affect downstream processing order
9. Gotchas — 24h retention, consumer-lag metric (`IteratorAge`), shard splits on table scaling
10. Verification — `aws dynamodbstreams describe-stream`, CloudWatch `IteratorAge` check
11. Further reading

- [ ] **Step 2: Verify Streams API via context7**

```
mcp__context7__query-docs for "@aws-sdk/client-dynamodb-streams DescribeStreamCommand"
mcp__context7__query-docs for "dynamodb streams lambda event source mapping parallelization factor"
mcp__context7__query-docs for "aws eventbridge pipes dynamodb streams source"
```

Confirm: event shape Lambda receives, `ParallelizationFactor` current max, EventBridge Pipes filter/enrich current capabilities.

- [ ] **Step 3: Write the file**

Target ~500-700 lines. Full TS for: idempotent Lambda consumer with `eventID` dedup table, bisect-on-error handler, OpenSearch projection sketch.

- [ ] **Step 4: Spot-check consumer event shape**

Run: `grep -n 'DynamoDBRecord\|StreamRecord\|eventID' plugins/dev-patterns/skills/dynamodb-design/references/04-streams-cdc.md`
Expected: event shape matches current AWS Lambda types for DynamoDB Streams.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/04-streams-cdc.md
git commit -m "feat(dynamodb-design): add 04-streams-cdc.md"
```

---

## Task 7: Write `05-evolution.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/05-evolution.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents
3. Schema versioning — `schema_version` attribute on every item, forward-compatible writes, backward-compatible reads, when to bump
4. Adding a GSI to a live table — backfill cost (AWS-managed, no downtime; writes incur 2x cost during `Backfilling`), `IndexStatus` monitoring, handler-level check that the GSI is `ACTIVE` before querying it
5. Removing a GSI — cost implications, silent-fallback-to-Scan risk, deprecation flag in code before removal
6. Renaming an attribute — dual-write + copy script template + cutover
7. Splitting a table (single → multi) — reverse migration pattern with shadow reads
8. Consolidating tables (multi → single) — re-keying strategy, backfill script template
9. Cutover strategies — dual-write with feature flag, shadow reads, percentage-based rollout, rollback criteria
10. Gotchas (evolution subset)
11. Verification — `describe-table` IndexStatus, percentage-rollout metric
12. Further reading

- [ ] **Step 2: Verify claims via context7**

```
mcp__context7__query-docs for "dynamodb add global secondary index backfill"
mcp__context7__query-docs for "dynamodb schema migration patterns"
```

Confirm: is on-demand backfill still free of throughput cost on the reads side? What's the current `IndexStatus` state machine?

- [ ] **Step 3: Write the file**

Target ~500-700 lines. Full TS for: dual-write helper, migration script skeleton with bounded parallelism, feature-flag-gated reader.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/05-evolution.md
git commit -m "feat(dynamodb-design): add 05-evolution.md"
```

---

## Task 8: Write `06-testing-local-dev.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/06-testing-local-dev.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents
3. DynamoDB Local — Docker image, standalone JAR, in-memory vs file-backed, limitations (no Streams, no global tables, PITR is a no-op)
4. Testcontainers — the `@testcontainers/dynamodb` / equivalent Node packages, Jest/Vitest integration, teardown patterns
5. LocalStack — when it beats DynamoDB Local (Streams + Lambda locally), free vs Pro tier differences, resource-creation drift from the real service
6. Access-pattern tests — one test per access pattern, exercise the *exact* query shape the production handler runs (not a simplified mock); assert on both happy path and constraint-violation path (`ConditionalCheckFailedException`)
7. Test data seeding — `BatchWriteCommand` helper, deterministic IDs, snapshot-stable timestamps (`faker.setSeed`, fixed `Date.now`)
8. Cross-reference: construct-level assertion tests → `aws-cdk-patterns/references/00-architecture.md` §testing
9. Gotchas — port collisions, stale container state between test runs, Streams no-op in DynamoDB Local
10. Verification — `npm test` exit code + coverage target
11. Further reading

- [ ] **Step 2: Verify current testcontainers DynamoDB support via context7**

```
mcp__context7__query-docs for "testcontainers node dynamodb"
mcp__context7__query-docs for "localstack dynamodb streams lambda"
```

Confirm: current package names, Docker image tags, known breakages.

- [ ] **Step 3: Write the file**

Target ~400-600 lines. Full TS for: DynamoDB Local harness in Jest, testcontainers setup, access-pattern test example using the `createUser` transaction from `03-write-correctness.md`.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/06-testing-local-dev.md
git commit -m "feat(dynamodb-design): add 06-testing-local-dev.md"
```

---

## Task 9: Write `07-gotchas.md`

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/references/07-gotchas.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents (TOC with symptom categories)
3. Gotchas table — one row per issue: **Symptom | Root cause | Fix**. Minimum coverage:
   - GSI returns stale data after write (eventual consistency, no `ConsistentRead` on GSIs)
   - `Scan` slows as table grows (move to Query + GSI or segmented scan)
   - `BatchWrite` silently drops items (`UnprocessedItems` not retried)
   - Hot partition throttling only in synthetic load tests (uneven seed distribution)
   - Item exceeds 400KB (attribute accretion; fix: S3 offload or item split)
   - Streams consumer lag spikes (`IteratorAge` high; raise `ParallelizationFactor` or rebalance shards)
   - TTL not deleting items (ISO 8601 string instead of Unix epoch integer)
   - `TransactWriteCommand` fails with `TransactionCanceledException` (inspect `CancellationReasons`, map index to domain error)
   - `ValidationException: ExpressionAttributeNames` mismatch (reserved-word collision, e.g. `status`, `name`, `count`)
   - DynamoDB Local Streams no-op (use LocalStack for Streams tests)
   - Single Query with 100+ `ExpressionAttributeValues` (split or redesign)
   - GSI projection cost blow-up (`ALL` projection on a wide table with heavy GSI reads)
   - Adaptive capacity masks a hot partition (observed as lower-than-expected throttles but high latency)
   - `BatchGet` returns fewer items than requested (fan-out + `UnprocessedKeys` retry)
   - `ConditionalCheckFailedException` on unique email retry (client must treat as success if the prior write landed)
4. Cross-reference to `aws-cdk-patterns/references/04-database.md` §7 for CDK-side gotchas (Aurora, table-definition, cross-stack exports)
5. Further reading

- [ ] **Step 2: Verify each gotcha's current behavior via context7 where uncertain**

```
mcp__context7__query-docs for "dynamodb reserved words expression attribute names"
mcp__context7__query-docs for "dynamodb adaptive capacity behavior"
```

- [ ] **Step 3: Write the file**

Target ~300-500 lines. Structured as a dense table — this is a lookup reference, not a tutorial.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/references/07-gotchas.md
git commit -m "feat(dynamodb-design): add 07-gotchas.md"
```

---

## Task 10: Testing harness (scripts + scenarios)

**Files:**
- Create: `plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.ps1`
- Create: `plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.sh`
- Create: `plugins/dev-patterns/skills/dynamodb-design/tests/scenarios.txt`
- Modify: `plugins/dev-patterns/skills/dynamodb-design/scripts/.gitkeep` and `tests/.gitkeep` — delete (replaced by real files)

- [ ] **Step 1: Copy harness from `aws-cdk-patterns` as the baseline**

Read `plugins/dev-patterns/skills/aws-cdk-patterns/scripts/test-skill.ps1` and `test-skill.sh` and copy verbatim to the new location. Update variable names (`aws-cdk-skill-test-` → `dynamodb-design-skill-test-`) and plugin paths.

- [ ] **Step 2: Write `tests/scenarios.txt`**

Exactly seven scenarios, one per line (no trailing blank):

```
Design a DynamoDB schema for a task manager with users, projects, tasks, and comments. List access patterns first, then derive keys.
How do I add a "list orders by status" access pattern to an existing orders table? The current keys are pk=USER#<id>, sk=ORDER#<created_at>.
I need to migrate from a status-index GSI to sort-key prefixes without downtime. Describe the cutover.
My DynamoDB writes throttle under synthetic load tests but run fine in production. What is the likely cause and fix?
Implement a sharded counter for daily page views that a hot article would otherwise overwhelm.
Wire a DynamoDB Stream to a Lambda that projects item changes into OpenSearch. The consumer must be idempotent.
Add optimistic locking to a user-profile update endpoint so a stale write cannot silently clobber a newer one.
```

- [ ] **Step 3: Adapt PowerShell script**

The .ps1 script runs RED (no skill loaded) and GREEN (skill loaded via `--plugin-dir` + `--add-dir` + `--setting-sources project`) for each scenario, writes per-scenario outputs and unified diffs to `$env:TEMP\dynamodb-design-skill-test-<timestamp>\`. Keep the "do not run inside an active Claude Code session" warning at the top.

- [ ] **Step 4: Adapt bash script**

Same as PowerShell, output to `/tmp/dynamodb-design-skill-test-<timestamp>/`.

- [ ] **Step 5: Syntax-check both scripts**

Run:
```bash
bash -n plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.sh
pwsh -NoProfile -Command '$null = [scriptblock]::Create((Get-Content plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.ps1 -Raw))'
```
Expected: both exit 0.

- [ ] **Step 6: Remove placeholder `.gitkeep` files and commit**

```bash
rm plugins/dev-patterns/skills/dynamodb-design/scripts/.gitkeep \
   plugins/dev-patterns/skills/dynamodb-design/tests/.gitkeep
git add plugins/dev-patterns/skills/dynamodb-design/scripts/ \
        plugins/dev-patterns/skills/dynamodb-design/tests/
git commit -m "feat(dynamodb-design): add RED/GREEN test harness and scenarios"
```

---

## Task 11: Trim `aws-cdk-patterns/04-database.md` §2 and add back-link

**Files:**
- Modify: `plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md`

- [ ] **Step 1: Read the current §2 to confirm scope of the change**

Open the file and locate the "## Section 2: DynamoDB — single-table vs multi-table decision tree" heading.

- [ ] **Step 2: Replace §2 body with a 1-paragraph summary + back-link**

Replace the full §2 content (currently ~20 lines of decision criteria) with:

```markdown
## Section 2: DynamoDB — single-table vs multi-table decision tree

Choosing between single-table (one table, all entities in a bounded context share composite keys) and multi-table (one table per entity type) is a modeling decision, not a CDK decision. The canonical decision tree — including per-criterion guidance on ownership, sync semantics, TTL divergence, and scaling characteristics — lives in `../../../dynamodb-design/references/01-modeling.md` §single-table-vs-multi-table. Summary: prefer single-table when all entities belong to one tightly coupled aggregate with 5-10 homogeneous access patterns; prefer multi-table when bounded contexts have distinct ownership, divergent TTL or retention, or independent scaling characteristics. Neither is universally correct.

The construct patterns in §3 and the runtime patterns in §4-6 work identically in both shapes — this section only flags the decision.
```

- [ ] **Step 3: Verify the relative path resolves**

Run:
```bash
realpath plugins/dev-patterns/skills/aws-cdk-patterns/references/../../../dynamodb-design/references/01-modeling.md 2>/dev/null || \
  ls plugins/dev-patterns/skills/dynamodb-design/references/01-modeling.md
```
Expected: the file exists (Task 3 created it).

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/04-database.md
git commit -m "docs(aws-cdk-patterns): trim 04-database §2, link to dynamodb-design/01-modeling"
```

---

## Task 12: Update `plugins/dev-patterns/README.md`

**Files:**
- Modify: `plugins/dev-patterns/README.md`

- [ ] **Step 1: Read the current README structure**

Identify the `aws-cdk-patterns` section and mirror its shape for `dynamodb-design`.

- [ ] **Step 2: Add a new `### dynamodb-design` section after `### aws-cdk-patterns`**

Content:

```markdown
### `dynamodb-design`

Stack-agnostic methodology for designing DynamoDB schemas from access patterns. Complements `aws-cdk-patterns` (which owns CDK provisioning and three canonical runtime patterns); this skill owns the upstream modeling work.

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

- Six-step design methodology (inventory access patterns → classify → base keys → GSIs → validate → single-vs-multi) with greenfield / extension / migration branches
- Partition and sort key design, composite patterns, sort-key prefix conventions, key overloading and entity discrimination
- GSI design with projection-cost tradeoffs (`KEYS_ONLY` / `INCLUDE` / `ALL`), sparse indexes, adjacency list and hierarchical patterns
- Hot partition mitigation (write sharding, calendar-based sharding), item-size limits (400KB hard limit, 1KB WCU / 4KB RCU boundaries), S3 offload with item pointers
- Cost modeling (`PAY_PER_REQUEST` vs `PROVISIONED` breakeven), GSI write amplification, auto-scaling behavior
- Optimistic locking with a `version` attribute, atomic counters, N-shard sharded counters, `BatchWriteCommand` `UnprocessedItems` retry loop, `TransactWriteCommand` for multi-item atomic updates
- DynamoDB Streams view types, idempotent Lambda consumers with `eventID` dedup, DynamoDB Streams vs EventBridge Pipes decision tree
- Schema evolution without downtime — item versioning, live GSI backfill, attribute rename, dual-write + percentage rollout cutover
- Local testing with DynamoDB Local, testcontainers, and LocalStack; per-access-pattern tests
- Cross-references to `aws-cdk-patterns/references/04-database.md` for atomic uniqueness (`TransactWriteCommand` + lookup table), identity-verified updates, and cursor pagination (full TypeScript implementations live there)

Test with the harness in `plugins/dev-patterns/skills/dynamodb-design/scripts/` (RED/GREEN scenarios same pattern as `aws-cdk-patterns`).
```

- [ ] **Step 3: Update the "Skills included" heading count in the intro** if one exists. Check the first section of the README for phrasing like "Skills included" and update accordingly.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/README.md
git commit -m "docs(dev-patterns): add dynamodb-design skill to plugin README"
```

---

## Task 13: Update root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the plugin table**

Change the `dev-patterns` row in the "Available Plugins" table. Current value: `| **[dev-patterns](plugins/dev-patterns)** | ... | 1 skill |`. New value: `| **[dev-patterns](plugins/dev-patterns)** | Cross-cutting reference patterns for common tech stacks (AWS CDK + DynamoDB design) | 2 skills |`.

- [ ] **Step 2: Add a `dynamodb-design` detail section under `### dev-patterns`**

Mirror the format of the existing `aws-cdk-patterns` detail block. Include: one-paragraph description, reference file list (`00-methodology`, `01-modeling`, `02-scaling`, `03-write-correctness`, `04-streams-cdc`, `05-evolution`, `06-testing-local-dev`, `07-gotchas`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add dynamodb-design to root README"
```

---

## Task 14: Run harness + review diffs + iterate

**Files:** (may modify any reference file based on findings)

- [ ] **Step 1: Run the test harness on Unix**

```bash
./plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.sh
```
Expected: exits 0, output directory printed with RED/GREEN outputs + diffs per scenario.

- [ ] **Step 2: Run the test harness on Windows (PowerShell)**

```powershell
.\plugins\dev-patterns\skills\dynamodb-design\scripts\test-skill.ps1
```
Expected: same as above.

**Reminder**: do NOT run the harness from inside an active Claude Code session — `claude -p` spawned recursively deadlocks on interactive prompts. Launch a plain terminal.

- [ ] **Step 3: Review diffs against the success criteria in the spec**

For each of the seven scenarios in `tests/scenarios.txt`, open the unified diff between RED and GREEN output. Success criteria per scenario:

1. **Schema design** — GREEN produces an access-pattern inventory table before any key design; RED jumps to keys with no inventory.
2. **Extension** — GREEN correctly distinguishes GSI vs key-overloading vs separate table; RED defaults to GSI without analysis.
3. **Migration** — GREEN describes dual-write + shadow reads + percentage cutover; RED describes a risky single-step migration.
4. **Throttling diagnosis** — GREEN suggests uneven seed distribution as the diagnosis; RED blames throughput config.
5. **Sharded counter** — GREEN implements N-shard writer + roll-up reader with correct retry; RED uses a single-item `ADD`.
6. **Streams projection** — GREEN includes an idempotency key based on `eventID`; RED omits it or uses a weaker dedup.
7. **Optimistic locking** — GREEN uses `version` + `ConditionExpression` + bounded retry; RED either skips the retry or uses unbounded retry.

- [ ] **Step 4: Record scenarios where GREEN did not meaningfully improve RED**

If ≥ 2 scenarios fail to show improvement, the skill needs edits. Identify which reference file is the weak link (based on scenario → file mapping) and plan targeted fixes.

- [ ] **Step 5: Iterate**

For each weak scenario: edit the relevant reference file, re-run just that scenario (`bash scripts/test-skill.sh -s <n>` if the harness supports selective runs; otherwise re-run all and look at the one row), re-review.

- [ ] **Step 6: Commit the fixes and note results**

```bash
git add plugins/dev-patterns/skills/dynamodb-design/
git commit -m "fix(dynamodb-design): improve <file> for <scenario> weakness"
```

- [ ] **Step 7: Final status summary**

Write a short summary comment to stdout: which scenarios passed GREEN review on the first run, which required iteration, and which reference files were edited. This is the completion signal.

---

## Self-Review (post-write, pre-execution)

- [x] Every spec section has at least one task. §3 integration → Task 11. §4 structure → Tasks 1-9. §5 per-ref → Tasks 2-9. §6 code conventions → applied throughout. §7 harness → Task 10. §8 README updates → Tasks 12-13. §9 success criteria → Task 14.
- [x] No "TBD" / "implement later" / "add error handling" placeholders.
- [x] Cross-reference paths are consistent and resolvable.
- [x] Commit messages follow a single convention (`feat(dynamodb-design):` / `docs(dynamodb-design):` / `docs(aws-cdk-patterns):` / `docs:` for root README).
- [x] Test harness (Task 10) comes before docs that depend on it (Tasks 12-13 mention the harness) and before the iteration task (Task 14) that runs it.

---

## Execution options

Plan complete and saved to `plans/2026-04-21-dynamodb-design-skill-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Tasks 2-9 (reference file writing) are the most token-intensive. Subagent-driven is likely the better fit: each reference file gets a dedicated subagent with fresh context and the spec + this plan loaded, reducing the risk of context compression mid-skill.
