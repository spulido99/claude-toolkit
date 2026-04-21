# Gotchas Catalog

**Builds:** Nothing — this is a pure lookup reference. Scan by symptom to find root cause and fix.

**When to use:** When a DynamoDB access-pattern or runtime behavior is surprising, wrong, slow, or
expensive. Start from the Symptom column; follow the Fix to the relevant deeper reference file.

**Prerequisites:** None specific. This file intentionally duplicates key gotcha rows from other
reference files in this skill — redundancy is the point for a symptom-first lookup catalog.

---

## Contents

1. [Design](#section-1-design) — key-shape mistakes, scan cost, over-filtered queries.
2. [Throughput](#section-2-throughput) — hot partitions, adaptive capacity, projection cost,
   cold-start burst.
3. [Write semantics](#section-3-write-semantics) — `BatchWrite` silent drops, transaction failure
   inspection, idempotent retries, timeout ambiguity.
4. [Streams](#section-4-streams) — consumer lag, view-type cost, dedup scope, TRIM_HORIZON false
   alarms, out-of-order events.
5. [Evolution](#section-5-evolution) — schema-version downgrade, migration cost spikes,
   partition-key changes via `UpdateItem`.
6. [Testing](#section-6-testing) — DynamoDB Local Streams no-op, TTL non-deletion, shared-DB
   flag, CI startup race.
7. [Expressions](#section-7-expressions) — reserved-word collisions, duplicate value names,
   filter-expression RCU waste, silent REMOVE no-ops.
8. [Cross-reference: CDK-side gotchas](#section-8-cross-reference-cdk-side-gotchas)
9. [Further reading](#section-9-further-reading)

---

## Section 1: Design

> Quick scan: Wrong key shape is the most expensive class of mistake — it requires a full
> table rebuild to fix. Validate all access patterns against the key schema in Step 5 of
> `00-methodology.md` before writing the first item.

| Symptom | Root cause | Fix |
|---|---|---|
| GSI returns stale data immediately after a write that just completed. | GSI reads are always eventually consistent. `ConsistentRead: true` is not supported on GSIs; passing the flag raises `ValidationException`. | If strong consistency is required, read from the base table with `ConsistentRead: true` and a direct key lookup. Otherwise accept sub-second propagation delay and retry on miss if freshness is critical. See `01-modeling.md` §4. |
| `Scan` becomes slow and expensive as the table grows to millions of items. | `Scan` reads every item in the table, consuming one RCU per 4 KB regardless of whether items match your filter. Cost and latency scale linearly with table size. | Redesign the access pattern to use `Query` against the base table or a GSI. If a one-off `Scan` is truly necessary (e.g., a migration), use parallel `Scan` with multiple segments and impose a rate limit; accept the cost. See `00-methodology.md` §2. |
| A single `Query` call passes 100+ values in `ExpressionAttributeValues` to filter by a long list of IDs. | The pattern is filtering in the query instead of designing keys for the access pattern. `ExpressionAttributeValues` has a 100-entry limit; beyond that the call fails with `ValidationException`. | Split into multiple `BatchGetItem` calls if you have explicit keys, or redesign with a GSI whose key directly serves the pattern. See `01-modeling.md` §3. |
| Item not found by `GetItem` even though a `PutItem` just returned 200. | A GSI-only lookup was used immediately after a write, but the GSI had not yet propagated (eventual consistency). Or: the wrong PK/SK value was derived due to a casing, type, or composite-key delimiter mismatch. | For freshness: read from the base table immediately after write. For key mismatch: log the raw PK/SK values passed and compare to what `PutItem` stored. Enforce casing and delimiter conventions in a shared key-builder utility. |
| Paginating with `LastEvaluatedKey` drops items or returns duplicates. | Items were written or deleted between pages, shifting the partition boundary. OR `ExclusiveStartKey` was not passed back verbatim — e.g., deserialized to a plain string instead of the DynamoDB-typed map. | Pass `LastEvaluatedKey` as an opaque object; do not transform it. Accept that inserts or deletes between pages cause slight inconsistency — document this as known behavior for the access pattern. See `05-evolution.md` §3. |
| Two access patterns both query by different attributes; a single GSI serves neither well. | Each GSI can only serve patterns whose filter matches its PK/SK exactly. A GSI with a `status` PK and a `created_at` SK cannot serve both "all items for a tenant by date" and "all ACTIVE items globally" without a full-index scan on one of them. | Add a second GSI, or use an overloaded SK strategy (e.g., `GSI1SK = TENANT#{tenantId}#DATE#{date}`). Validate every access pattern against every GSI in the access-pattern inventory before creating the schema. See `00-methodology.md` §4. |
| `Query` with `ScanIndexForward: false` (descending) returns items in ascending order. | `ScanIndexForward` controls sort direction only within a single partition. If the SK is not a comparable type (e.g., it is a UUID string instead of an ISO 8601 timestamp), lexicographic sort order does not match chronological order. | Use sort keys that sort correctly lexicographically (ISO 8601 timestamps, zero-padded numeric strings, epoch seconds stored as Number). Avoid UUIDs as sort keys when order matters. See `01-modeling.md` §2. |
| `GetItem` returns an item with only partial attributes; expected attributes are missing. | Attributes not projected into a GSI are absent when reading from that GSI. The base-table item has all attributes; the GSI item only has what was projected. | Read from the base table for full fidelity. If the GSI must return extra attributes, change the projection to `INCLUDE` and add the missing attribute names, then rebuild the GSI. |
| `Query` returns 0 items on a GSI but the items exist in the base table. | The GSI is sparse: items without the GSI PK attribute are not projected into the GSI. Items that were written before the GSI attribute was added also do not appear. | Write the GSI key attribute on every item that should be queryable via the GSI. Back-fill existing items with a migration script. See `05-evolution.md` §2. |

---

## Section 2: Throughput

> Quick scan: Throttling from hot partitions is the most common throughput failure. Always check
> Contributor Insights first — table-level `ThrottledRequests` hides item-level skew because
> adaptive capacity suppresses visible throttles while latency silently increases.

| Symptom | Root cause | Fix |
|---|---|---|
| Hot-partition throttling visible under load tests but not in production. | Seed data had uneven PK distribution — many test items share the same PK — which production traffic would not reproduce. | Reseed with production-representative PK cardinality. Use a script that generates PK values from the production distribution (uniform, power-law, etc.). Validate by checking Contributor Insights during the load test. |
| `ThrottledRequests` metric is low, but item-level read/write latency is elevated. | Adaptive capacity is absorbing the hot partition by automatically reallocating unused capacity from cooler partitions. Throttles are suppressed, but per-item latency rises as writes queue while capacity rebalances. | Enable Contributor Insights (`THROTTLED_KEYS` mode) to surface the hot partition key. Adaptive capacity helps but does not eliminate hot-partition cost — it only borrows slack from neighboring partitions. Redesign the PK to spread load (e.g., add a shard suffix). See `02-scaling.md` §2. |
| GSI storage and write costs are unexpectedly high with heavy GSI read traffic. | GSI was created with `ALL` projection on a wide-item table. Every base-table write replicates the full item into the GSI, multiplying both storage and write cost proportionally to item width. | Reduce the projection to `KEYS_ONLY` or `INCLUDE` listing only the attributes the GSI caller actually reads. Rebuilding the GSI is a delete-and-recreate operation; plan for downtime or a shadow GSI cutover. |
| First few hundred writes to a new PAY_PER_REQUEST table are throttled. | DynamoDB allocates on-demand capacity per partition elastically. A cold table starts with minimal partitions; until partitions auto-scale, the table throttles on an initial burst. | Warm the table before the traffic spike: write a low volume of dummy items across diverse PKs for several minutes to trigger partition splits. Alternatively, maintain a steady-state background write rate. |
| Write throughput degrades briefly after a large, rapid partition split. | Splitting a hot partition temporarily moves items to new partition nodes, creating a brief per-partition unavailability window. Writes to those items may be throttled or delayed during the move. | Avoid triggering large partition splits under production load. Pre-split by writing items across the full PK keyspace before ramping traffic. |
| PROVISIONED table throttles after a traffic spike even though `TargetTrackingScaling` is enabled. | Auto-scaling reacts to sustained utilization, not instantaneous spikes. The CloudWatch metric evaluation period is 1 minute; provisioned capacity cannot increase fast enough to absorb a burst that peaks within seconds. | Pre-provision capacity for known traffic events. Use PAY_PER_REQUEST for unpredictable burst shapes. DynamoDB provides 5 minutes of accumulated burst capacity per partition; sustained high traffic beyond that throttles. See `02-scaling.md` §1. |
| Adding a new GSI to a large table takes hours and read capacity is degraded during the operation. | GSI backfill reads every item in the table at provisioned read capacity. On a large table with low read provisioning, backfill can take hours, and the backfill competes with application reads. | Temporarily increase read capacity before initiating GSI creation if the table is under production read load. Monitor GSI status via `DescribeTable` and track `IndexStatus` transitioning from `CREATING` to `ACTIVE` before routing traffic. |
| Item-level latency spikes on a table that consistently reads under 10% of provisioned capacity. | Low average utilization hides per-partition imbalance. If 90% of reads target the same 5% of partitions, those partitions are hot even though table-level metrics look healthy. | Enable Contributor Insights in `ACCESSED_AND_THROTTLED_KEYS` mode, not just `THROTTLED_KEYS`, to surface access skew before throttling occurs. See `02-scaling.md` §3. |

---

## Section 3: Write semantics

> Quick scan: The two most dangerous silent failures in DynamoDB writes are (1) `BatchWrite`
> unprocessed items that are never retried, and (2) `TransactWrite` cancellations whose
> `CancellationReasons` are never inspected. Both appear as success to the caller.

| Symptom | Root cause | Fix |
|---|---|---|
| `BatchWriteCommand` appears to succeed but some items are missing from the table. | `UnprocessedItems` in the response was not inspected. DynamoDB returns partial success; items that could not be written are returned in `UnprocessedItems` without raising an exception. | Always loop until `UnprocessedItems` is empty. Apply exponential backoff with jitter and a retry cap (e.g., 5 attempts). Raise an error to the caller if items remain unprocessed after max retries. See `03-write-correctness.md` §4. |
| `TransactWriteCommand` throws `TransactionCanceledException` with no actionable message. | The `CancellationReasons` array on the exception was not inspected. Each entry is aligned to the `TransactItems` array index and carries a `Code` identifying the failure (`ConditionalCheckFailed`, `ItemCollectionSizeLimitExceeded`, `ProvisionedThroughputExceeded`, `TransactionConflict`, etc.). | Catch `TransactionCanceledException`, iterate `CancellationReasons`, and map each non-null `Code` to a domain error at its corresponding `TransactItems` index. Never surface a generic transaction failure to the caller. See `03-write-correctness.md` §5. |
| Retrying a failed `TransactWriteCommand` charges double write capacity. | The cancelled transaction still consumed WCUs even though it did not commit. A naive retry consumes again. `TransactWriteItems` supports client-side idempotency via `ClientRequestToken`. | Pass a stable `ClientRequestToken` (a UUID generated once per logical operation, not per attempt). DynamoDB deduplicates requests with the same token within a 10-minute window, returning the original result without re-executing the writes. Cap retries regardless. |
| `ConditionalCheckFailedException` is thrown on a retry after a network timeout. | The original write may have succeeded on the server before the connection dropped. The condition on retry (`attribute_not_exists(pk)` or `version = :expected`) then fails because the item already exists at the new state. | Treat timeout + subsequent `ConditionalCheckFailedException` as a possibly-already-succeeded write. Re-read the item to verify current state before deciding whether to surface an error or treat the operation as complete. Never assume failure from a timeout alone. |
| `PutItem` with `attribute_not_exists(pk)` condition silently overwrites an existing item in some code paths. | A code path omitted the `ConditionExpression` (e.g., a raw `PutItem` used for upsert vs. the guarded create). Both go through the same table; the missing condition is invisible at the call site. | Wrap creation and upsert in distinct helper functions with the condition baked in. Add an integration test that attempts to create a duplicate and asserts `ConditionalCheckFailedException`. |
| Optimistic-locking version number is not incremented during a concurrent burst; stale writes succeed. | `UpdateItem` used `SET version = :newVersion` (absolute assignment) instead of an atomic conditional increment. Concurrent writers both read version N and both succeed because the condition was evaluated before either write committed. | Use `version = :expected` in `ConditionExpression` and `SET version = version + :one` in `UpdateExpression`. Both operations must be in the same `UpdateItem` call to be atomic. See `03-write-correctness.md` §1. |
| `DeleteItem` silently no-ops when the item does not exist; downstream logic assumes deletion succeeded. | `DeleteItem` is idempotent by default: deleting a non-existent item returns success without an error. If the caller needs to distinguish "deleted" from "was not there", the default behavior is misleading. | Add `ConditionExpression: "attribute_exists(pk)"` to `DeleteItem` if the item must exist. Catch `ConditionalCheckFailedException` and map it to a domain `NOT_FOUND` error. See `03-write-correctness.md` §5. |
| `TransactWriteCommand` with 26 items fails with `ValidationException: too many operations`. | `TransactWriteItems` supports a maximum of 100 operations per transaction (as of 2024). Earlier documentation and some SDKs cited 25; this has been raised. However, all items in a transaction must still reside in the same region. Cross-region transactions are not supported. | Keep transactions under 100 items. If your pattern requires more, redesign using separate smaller transactions with compensating logic, or reconsider whether the atomicity boundary is correct. |

---

## Section 4: Streams

> Quick scan: Streams gotchas split into two categories — consumer performance (`IteratorAge`,
> `ParallelizationFactor`) and correctness (dedup scope, `OldImage` nullability, out-of-order
> delivery). Both require different fixes; diagnose which category applies first.

| Symptom | Root cause | Fix |
|---|---|---|
| Lambda `IteratorAge` metric spikes; stream consumer falls behind during write bursts. | Insufficient `ParallelizationFactor` for the Lambda event source mapping, OR shard hot-spotting — many writes to one base-table partition concentrate on one shard, which has a single iterator and no internal parallelism. | Raise `ParallelizationFactor` up to 10. If lag persists at 10, the root cause is partition hot-spotting — rebalance writes across more base-table PKs to distribute across more shards. See `04-streams-cdc.md` §3. |
| Streams cost is higher than expected for a simple project-to-search fanout. | Stream view type is `NEW_AND_OLD_IMAGES`. Both images are replicated and read from the stream even though the consumer only needs the new state. The view type approximately doubles stream read cost vs. `NEW_IMAGE`. | Use `NEW_IMAGE` for project-to-search, search-index sync, and audit-log fanout patterns. Reserve `NEW_AND_OLD_IMAGES` for diff logic (e.g., detecting which fields changed between writes). |
| Deduplication logic using `eventID` causes collision errors across two tables that share the same consumer. | `eventID` is unique within a single stream, not globally across streams or tables. Two different tables can emit records with identical `eventID` values. | Prefix the dedup key with the table name: `${tableName}:${eventID}`. Store the composite key in your dedup store (e.g., a DynamoDB dedup table with TTL). |
| `IteratorAge` spikes immediately after deploying a new Lambda consumer at `TRIM_HORIZON`. | Expected behavior: `TRIM_HORIZON` starts the iterator at the oldest record in the 24-hour retention window. The consumer replays up to 24 hours of accumulated history before catching up to real-time. | Not an outage. Tune the `IteratorAge` alarm to require sustained elevation (e.g., > 5 minutes above threshold) rather than a single-point spike. If replaying history is undesirable, use `LATEST` as the starting position for new consumers. |
| Stream events arrive out of order for the same item even though writes were sequential. | Within a shard, Lambda retries failed batches before advancing the iterator. Parallel shard processing also allows cross-shard re-ordering for items that span shard boundaries during a split. | Design consumers to be idempotent and order-tolerant. Use the `SequenceNumber` from the stream record for ordering when strict order matters. Do not assume stream consumers deliver events in exact write order across retry scenarios. |
| `OldImage` is null in `NEW_AND_OLD_IMAGES` records for newly created items. | A `NEW_AND_OLD_IMAGES` record for an `INSERT` event has no previous state. The `OldImage` field is absent (not null) in the event record for item creation. | Guard diff logic with a check for the DynamoDB event name (`INSERT`, `MODIFY`, `REMOVE`) before accessing `OldImage`. Treat missing `OldImage` as "no previous state" rather than as an error. |
| Stream consumer processes the same event multiple times even though it deduplicates by `eventID`. | Lambda may deliver a batch more than once if the function times out or throws without returning a successful response. The `eventID` dedup check happens inside the function, but the batch is re-delivered before the check can run. | Implement dedup at the item-processing level, not at the batch level. Store processed `eventID` keys in DynamoDB with TTL slightly longer than the stream's 24-hour retention. Check before processing, not after. See `04-streams-cdc.md` §4. |

---

## Section 5: Evolution

> Quick scan: Schema evolution mistakes are expensive because they often require full-table
> migrations to fix. Validate version-handling logic with both old-format and new-format items
> before deploying any writer change. See `05-evolution.md` for the full migration playbook.

| Symptom | Root cause | Fix |
|---|---|---|
| Deploying a new schema version breaks readers that have not yet been updated. | Each schema version bump requires all active readers to handle every version still in the wild. If a reader does not handle the new version format, it fails on migrated items. | Bump `schemaVersion` only for breaking changes. Deploy readers that handle both old and new versions before migrating any items. Plan to back-migrate older items or tolerate them indefinitely. See `05-evolution.md` §2. |
| A migration script run against a PAY_PER_REQUEST table causes a large unexpected cost spike. | Scanning at full speed on PAY_PER_REQUEST consumes unbounded on-demand capacity. A full-table scan of a large table can cost hundreds of dollars in a single run. | Add a rate limit: use the `Limit` parameter per `Scan` page and insert a delay between pages (e.g., 100 ms). Alternatively, switch the table to PROVISIONED billing for the migration window, run the migration, then switch back. See `05-evolution.md` §4. |
| `UpdateItem` on an item whose partition key value needs to change creates a second item; the old item persists as an orphan. | `UpdateItem` cannot modify the partition key or sort key. If the wrong key is derived, `UpdateItem` silently creates a new item at the new key and leaves the original orphaned — no error is raised. | Use `TransactWriteCommand` with `Put` for the new key and `Delete` for the old key in a single atomic operation. See `05-evolution.md` §3 and `03-write-correctness.md` §5. |
| Back-migration script adds a new attribute to every item, but some items still lack it after the script completes. | Items written concurrently during the migration window bypassed the migration code path (they came from the old writer without the new attribute). | Coordinate migration with a feature flag: disable old writers or dual-write during the migration window. After the script completes, verify coverage with a targeted `Scan` counting items where the new attribute is absent. |
| Renaming an attribute breaks reads against a GSI that projected the old attribute name. | Attribute rename requires migrating every item. A GSI that projects the old name will continue to serve results with the old name until items are migrated; items migrated to the new name are absent from the GSI. | Treat attribute rename as a two-phase migration: (1) write both old and new attribute names during the transition; (2) migrate all items; (3) remove the old attribute name from writers; (4) rebuild the GSI if the projected attribute name changed. See `05-evolution.md` §3. |
| Schema-version downgrade is attempted after a botched deployment; readers see items they cannot parse. | Lower-version readers cannot parse higher-version items. DynamoDB has no schema enforcement — any reader can read any item regardless of `schemaVersion`. | There is no safe in-place downgrade. Either forward-fix all new-format items with a hotfix writer, or restore from a point-in-time backup. Plan for this by keeping schema changes backward-compatible (additive only) whenever possible. |

---

## Section 6: Testing

> Quick scan: DynamoDB Local is not a complete DynamoDB emulator. It accurately emulates key
> operations (GetItem, PutItem, Query, condition expressions) but silently skips TTL deletion and
> returns no-op responses for Streams. Know which behaviors are faked before trusting test results.

| Symptom | Root cause | Fix |
|---|---|---|
| Streams-based tests against `amazon/dynamodb-local` return empty iterators or never receive events. | `amazon/dynamodb-local` does not implement DynamoDB Streams. The Streams API endpoints exist but return empty data or no-op responses. | Use **LocalStack** for Streams integration tests. Keep DynamoDB Local for non-Streams access-pattern tests (query shape, condition expressions, GSI projection). See `06-testing-local-dev.md` §2. |
| Test items with a past `expires_at` value are not deleted during test runs against DynamoDB Local. | DynamoDB Local recognizes the TTL attribute and stores it, but does not run the background TTL deletion process. Items never expire in local mode. | Assert that `expires_at` is set to the correct epoch-seconds value — do not assert on deletion. For tests that require post-TTL state, manually delete the item or mock time. |
| Each test function sees an empty table even though a sibling test just seeded data. | `amazon/dynamodb-local` was started without the `-sharedDb` flag. Each AWS access key sees a separate isolated in-memory database. Test functions that use different credential configurations each get their own empty DB. | Pass `-sharedDb` when starting DynamoDB Local, or pin the same `AWS_ACCESS_KEY_ID` value across all test fixtures. See `06-testing-local-dev.md` §1. |
| Tests pass locally but fail in CI with `ResourceNotFoundException` on the table name. | The local DynamoDB instance starts up asynchronously; the test suite begins before table creation completes. | Add a health-check wait step in CI before running tests: poll `ListTables` until the expected table name appears, or use a `docker compose --wait` / `wait-for-it` pattern. See `06-testing-local-dev.md` §3. |
| Integration tests are slow because every test function creates and deletes the table. | Table creation and deletion adds 1–2 seconds per test function against DynamoDB Local. | Create the table once per test suite (beforeAll / module scope) and truncate data between tests with targeted `DeleteItem` calls or a batch-delete helper. See `06-testing-local-dev.md` §4. |
| Unit tests that mock `DynamoDBDocumentClient` pass, but integration tests against DynamoDB Local fail with type errors. | DynamoDB Local enforces strict attribute typing. A mock that returns plain JavaScript objects does not enforce that numbers are stored as numbers (not strings), booleans as booleans, etc. | Use `DynamoDBDocumentClient` (not raw `DynamoDBClient`) in tests to benefit from automatic marshalling. Add schema-validation assertions in the integration suite to catch type coercion bugs early. |
| GSI query in tests returns items in a different order than production. | DynamoDB Local does not guarantee the same internal sort order as the production service for non-SK orderings. If the test asserts on absolute item position in a result set, it may pass locally and fail in staging. | Never assert on the absolute position of items in a DynamoDB `Query` result unless the SK defines a deterministic sort order. Sort the result set in application code before asserting on order-sensitive logic. |

---

## Section 7: Expressions

> Quick scan: Most expression errors are either (a) reserved-word collisions (fix with
> `ExpressionAttributeNames`) or (b) filter expressions consuming unexpected RCU (fix by
> moving the filter into the key condition or a GSI key). Both are caught early with integration
> tests that assert on consumed capacity.

| Symptom | Root cause | Fix |
|---|---|---|
| `ValidationException: Invalid expression: attribute name is a reserved word`. | An attribute name collides with a DynamoDB reserved word. Common offenders: `status`, `name`, `count`, `type`, `user`, `data`, `key`, `size`, `delete`, `set`, `list`, `map`, `value`, `timestamp`, `date`, `index`, `table`, `schema`, `hash`, `range`, `token`, `source`, `target`, `id`, `role`, `number`, `order`, `comment`, `select`, `by`, `in`. The full list contains hundreds of words; see the AWS DynamoDB Developer Guide reserved-word appendix linked in §9. | Use an `#attr` placeholder in every expression that references the reserved word and map it via `ExpressionAttributeNames: { "#attr": "status" }`. Apply this defensively to any short, common English word used as an attribute name. |
| `ValidationException: Value provided in ExpressionAttributeNames unused in expressions`. | An `ExpressionAttributeNames` entry was defined but is no longer referenced in any expression after a refactor. DynamoDB rejects unused entries. | Keep `ExpressionAttributeNames` in sync with the expression string. Remove any entry whose placeholder no longer appears in `KeyConditionExpression`, `FilterExpression`, `UpdateExpression`, or `ConditionExpression`. |
| `ValidationException: Value provided in ExpressionAttributeValues duplicates an already defined value`. | Two different values in the same call share the same placeholder name (e.g., two `:status` entries added by separate helper functions). | Use distinct placeholder names (`:v1`, `:v2`, or semantically named variants like `:statusActive`, `:statusInactive`). Generate placeholder names programmatically when building expressions dynamically. |
| `FilterExpression` is correct but the call consumes far more RCUs than expected for the items returned. | `FilterExpression` applies after `KeyConditionExpression` has already consumed read capacity. Every item scanned by the key condition costs RCU — filtered-out items are not free. A poorly selective filter on a large key range reads and discards the majority of items. | Move the filter into `KeyConditionExpression` if the filter attribute is the sort key. Otherwise design a GSI whose PK or SK encodes the filter value so the pattern becomes a targeted key query rather than a filtered scan. See `01-modeling.md` §4. |
| `UpdateExpression` REMOVE clause appears to succeed but the attribute reappears on the next read. | The `REMOVE` clause targeted the wrong attribute name (typo or aliasing mismatch). DynamoDB does not raise an error if the named attribute does not exist — it no-ops silently. | Use `ReturnValues: "ALL_NEW"` on the `UpdateItem` call during development to inspect the full item state after every update. Add an integration-test assertion that the removed attribute is absent on the returned item. |
| `ConditionExpression` with `attribute_not_exists` fails on a retry even though the item genuinely does not exist. | `attribute_not_exists(someAttribute)` checks whether the named attribute is absent on the item, not whether the item itself is absent. If the wrong attribute name is used, or the item exists with a partial attribute set, the condition evaluates unexpectedly. | Use `attribute_not_exists(pk)` where `pk` is the actual partition key attribute name to test for item non-existence (an item cannot exist without its partition key). For attribute-level checks, name the attribute explicitly and document the intent. |
| `KeyConditionExpression` on a GSI sort key silently returns no items instead of an error when a type mismatch exists. | Using an operator whose value does not match the sort key's data type (e.g., passing a string where the SK is a Number) returns an empty result set with no error. DynamoDB does not raise a type error for key-condition value mismatches in all SDK versions. | Type-check sort-key values against the GSI definition before passing them. An empty result from a key query during development is often a data-type mismatch (e.g., string `"123"` vs. Number `123`), not an access-pattern miss. Log the raw values before the call during development. |
| `UpdateExpression` with `SET` and `REMOVE` in the same call fails with `ValidationException`. | Some SDKs require `SET` and `REMOVE` clauses to be in the same `UpdateExpression` string, separated by a space. Passing them as separate parameters (or concatenating without a space) produces invalid syntax. | Combine clauses in a single string: `"SET #attr = :val REMOVE obsolete_attr"`. Verify the full expression string before sending — log it during integration tests to catch malformed expressions early. |

---

## Section 8: Cross-reference — CDK-side gotchas

This file covers DynamoDB **access-pattern and runtime** gotchas: key design, expression syntax,
stream behavior, write semantics, and local testing. It does not cover CDK provisioning.

CDK provisioning gotchas for DynamoDB (and Aurora Serverless) live in:

**`../../aws-cdk-patterns/references/04-database.md` — Section 7: Gotchas catalog**

That section covers:

- Aurora Serverless v2 `serverlessV2MinCapacity: 0` engine-version requirements
  (Aurora PostgreSQL 13.15+, 14.12+, 15.7+, 16.3+, 17.4+; Aurora MySQL 3.08.0+; earlier minor
  versions silently ignore `serverlessV2MinCapacity: 0`).
- Auto-pause first-query latency (5–15 s after the five-minute idle window) — expected behavior.
- Cross-stack export removal ordering (`Export <name> cannot be removed as it is in use by <stack>`).
- GSI-query-then-write uniqueness race vs. the lookup-table pattern with `attribute_not_exists`
  (see §4 of that file for the atomic pattern).
- DynamoDB TTL misconfiguration: `timeToLiveAttribute` missing from the CDK table definition, or
  `expires_at` stored as an ISO 8601 string instead of Unix epoch seconds (items appear to have
  TTL set but are never deleted by the service).
- Cross-stack export recreation from drifting `env.account` / `env.region` across machines or CI.
- Orphaned S3 objects after DynamoDB item deletion when no Streams cleanup handler is wired.

If a symptom involves a CDK synth error, a CloudFormation deploy failure, or a table/index that
is misconfigured at the infrastructure level, start in that file rather than in this one.

---

## Section 9: Further reading

- `../../aws-cdk-patterns/references/04-database.md` §7 — CDK-side gotchas catalog
  (provisioning, Aurora Serverless, cross-stack exports, TTL at the infrastructure layer).
- `00-methodology.md` — six-step design process; re-run from Step 1 when an access-pattern fix
  is needed.
- `01-modeling.md` — GSI placement, key derivation, overloaded SK patterns, single-table vs
  multi-table tradeoffs.
- `02-scaling.md` — hot-partition diagnosis, adaptive capacity limits, Contributor Insights modes.
- `03-write-correctness.md` — `BatchWrite` retry loops, `TransactWriteCommand` inspection,
  optimistic locking, atomic counters.
- `04-streams-cdc.md` — stream view types, `ParallelizationFactor`, dedup patterns,
  `IteratorAge` alarms.
- `05-evolution.md` — schema versioning, migration cost control, PK-change transactions,
  backward-compatibility strategy.
- `06-testing-local-dev.md` — DynamoDB Local setup and limitations, LocalStack Streams,
  TTL behavior in test, CI startup race patterns.
- [AWS DynamoDB Developer Guide — Reserved words in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html) —
  full reserved-word list; consult before naming any attribute.
- [AWS DynamoDB Developer Guide — Using transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) —
  `ClientRequestToken` idempotency window (10 minutes), `CancellationReasons` array structure,
  and `Code` values (`ConditionalCheckFailed`, `ItemCollectionSizeLimitExceeded`, etc.).
- [AWS DynamoDB Developer Guide — Adaptive capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/burst-adaptive-capacity.html) —
  how adaptive capacity redistributes throughput across partitions and its limits.
- [AWS DynamoDB Developer Guide — Monitoring with Contributor Insights](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/contributorinsights_tutorial.html) —
  enabling `THROTTLED_KEYS` and `ACCESSED_AND_THROTTLED_KEYS` monitoring modes.
