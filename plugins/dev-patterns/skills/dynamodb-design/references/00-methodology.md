# Methodology

**Builds:** A repeatable six-step design process for DynamoDB schemas — access-pattern inventory, classification, key derivation, GSI placement, constraint validation, and single-table vs multi-table decision.
**When to use:** Starting a schema from scratch (greenfield), adding a new access pattern to an existing table (extension), or redesigning an existing schema for migration (migration). All three JTBDs are branches of this single workflow.
**Prerequisites:** None. This file is the backbone; every other reference in this skill routes back to it. For CDK provisioning of the resulting table, see `../../aws-cdk-patterns/references/04-database.md` §3.

## Contents

1. **The six-step design process** — end-to-end methodology from blank page to a validated key shape.
2. **Step 1: Inventory access patterns** — table format, ubiquitous language, classification columns.
3. **Step 2: Classify each pattern** — five pattern classes and their key-design implications.
4. **Step 3: Derive base-table keys** — frequency-driven PK/SK selection; reachability validation.
5. **Step 4: Add GSIs** — one GSI per unserved pattern; GSI vs overloading vs separate table decision.
6. **Step 5: Validate against constraints** — item size (400 KB hard limit), hot partitions, RCU/WCU cost per pattern, consistency requirements.
7. **Step 6: Decide single-table vs multi-table** — pointer to `01-modeling.md`.
8. **JTBD branches** — greenfield, extension, migration entry points.
9. **Worked example** — e-commerce domain: users, orders, order-items, reviews, through all six steps.
10. **Anti-patterns** — four failure modes that invalidate the process.
11. **Further reading** — cross-links within the skill and to AWS documentation.

---

## Section 1: The six-step design process

DynamoDB schema design is access-pattern-first. The table structure is determined by the queries it must serve — not by the entity shapes in a normalized relational model. The six steps below enforce that order: access patterns come first, key structure follows, infrastructure (GSIs) follows that, and validation comes last. Skipping or reordering steps is the root cause of most DynamoDB redesigns.

```
Step 1 → Inventory access patterns
Step 2 → Classify each pattern
Step 3 → Derive base-table keys
Step 4 → Add GSIs for unserved patterns
Step 5 → Validate against constraints
Step 6 → Decide single-table vs multi-table  →  01-modeling.md
```

The process is linear on the first pass. When validation (Step 5) reveals a constraint violation — a hot partition, an item that approaches the 400 KB size limit, or a per-pattern cost that exceeds budget — you loop back to Step 3 or Step 4 and revise. The loop terminates when all patterns are served and all constraints are satisfied.

---

## Section 2: Step 1 — Inventory access patterns

Before touching a partition key, write down every operation the application must perform against this data. Use the **ubiquitous language of the domain**, not CRUD labels. "Fetch order for checkout screen" is a precise access pattern. "Get order" is not — it omits the caller (checkout), the consistency requirement (probably strongly consistent at payment time), and the latency budget. Imprecision here propagates into all downstream steps.

### Access-pattern table format

Produce a table with these five columns for every pattern. No pattern is too obvious to record; omissions force a redesign later.

| Operation | Entity | Frequency | Latency budget (ms) | Consistency need |
|---|---|---|---|---|
| Fetch order for checkout confirmation screen | Order | High — triggered on every purchase | ≤ 50 ms | Strong — payment must see the latest state |

**Column definitions:**

- **Operation** — a verb phrase naming the use case from the application's perspective.
- **Entity** — the DynamoDB item type(s) returned or written.
- **Frequency** — relative traffic tier (High / Medium / Low / Rare) plus a qualitative trigger. Use a rough request-per-second estimate when one is available (for example, "High — ~200 rps at peak").
- **Latency budget (ms)** — the end-to-end budget allocated to the database call for this operation. Drives the choice of eventually consistent (cheaper) vs strongly consistent (2× cost for reads) and influences whether a GSI or a base-table Query is acceptable.
- **Consistency need** — Strong or Eventual. Strong reads are only available on the base table (`ConsistentRead: true` on `GetItem` and `Query`). GSIs are always eventually consistent — `ConsistentRead` is not supported on a GSI. Any pattern that requires strong consistency must be served by the base table; it cannot be served by a GSI alone.

### Naming discipline

Two common naming failures:

1. **CRUD labels** ("create order", "update order") — these conflate the operation name with the HTTP verb and lose the access-pattern context. The methodology depends on access-pattern names to drive key design; labels like "create" carry no information about what the key must look like.
2. **Vague entity scope** ("get stuff for user") — a pattern that does not name the returned entity cannot be classified in Step 2.

Name patterns so that a new team member reading the inventory table alone understands who calls it, what data it returns, and in what context.

---

## Section 3: Step 2 — Classify each pattern

After the inventory is complete, classify each pattern into one of five classes. The classification determines which DynamoDB operation will serve the pattern (GetItem, Query, Scan — Scan is almost never the right answer for a production pattern) and therefore what the key design must look like.

### Five pattern classes

**Lookup** — a point read that fetches a single item by its complete primary key (partition key only, or partition + sort key). Served by `GetItem`. Key implication: the item's partition key must equal the lookup value (or a prefixed derivative of it, for example `USER#<userId>`). This is the cheapest and fastest operation class; route the highest-frequency point reads here.

**Collection** — a set of items sharing a partition key, optionally filtered or ordered by sort key. Served by `Query` with a `KeyConditionExpression` of the form `pk = :v` or `pk = :v AND sk BETWEEN :a AND :b`. Key implication: the partition key must equal the "owner" entity (for example the user or order), and the sort key must encode the collection ordering plus any range the application filters on. A typical sort key pattern is `ENTITY_TYPE#TIMESTAMP` or `ENTITY_TYPE#ID`, enabling `begins_with` and `BETWEEN` range predicates without a Scan.

**Global lookup** — a point read or collection read against an attribute that is not in the base-table primary key. Served by a GSI `Query`. Key implication: the lookup attribute becomes the GSI partition key. GSIs are always eventually consistent; the calling code must be written to tolerate that.

**Aggregation** — a count, sum, or other derived value over a set of items. DynamoDB does not compute aggregations at query time. The only two strategies are: (a) maintain a counter item in the table and update it with each write (atomic `ADD` or `TransactWriteCommand`) — this is efficient for counts but requires write coordination; or (b) fan out aggregations to DynamoDB Streams and maintain a projection item asynchronously (see `04-streams-cdc.md`). Key implication: the counter item's primary key must be reachable at write time from every writer. Aggregation patterns cannot be satisfied by a GSI alone — they require an item specifically designed for the aggregate value.

**Search** — a contains, prefix, or range predicate on an attribute that is not a key (for example, full-text search by order description, wildcard match on product name). DynamoDB does not support full-text search at the database level. This pattern class requires a projection to an external search system (OpenSearch, Typesense, Algolia) via DynamoDB Streams. Key implication: the DynamoDB key design does not need to serve the search predicate; the projection handles it. Document this pattern in the inventory and mark it as "external search projection" so it does not drive GSI or key decisions.

### Classification drives the design

Once every pattern is classified, the distribution across classes reveals the key-design problem to solve:

- Many **Lookup** and **Collection** patterns with the same "owner" entity as the PK → single-table design with a rich sort-key scheme is a strong fit.
- Many **Global lookup** patterns against many different attributes → either a large number of GSIs (up to 20 per table) or multi-table design where each table's base-table key matches a different lookup attribute.
- Any **Aggregation** pattern → plan for a counter item or a Streams projection from the start; do not try to bolt it on later.
- Any **Search** pattern → plan the Streams projection pipeline as part of the schema design, not as a follow-on task.

---

## Section 4: Step 3 — Derive base-table keys

The base-table partition key (PK) and sort key (SK) together define the one query path that DynamoDB can serve with a strongly consistent `GetItem` or `Query`. Choose them by finding the single Lookup or Collection pattern that:

1. Has the highest frequency — or, when frequencies are equal, the most demanding latency budget.
2. Requires strong consistency (because GSIs cannot serve strong reads, this pattern has no fallback).

That pattern's required access shape becomes the PK/SK. Every other pattern is then evaluated for reachability:

- Can it be served by a `Query` on the base table with a sort-key range predicate? If yes, no GSI is needed.
- If not, it becomes a candidate for Step 4.

### Reachability validation

For each pattern that is not the base-table driver, write down the access expression it requires. The format is a DynamoDB `KeyConditionExpression` in prose:

| Pattern | Required expression | Served by base table? |
|---|---|---|
| Fetch order for confirmation (base driver) | `pk = ORDER#<orderId>` | Yes — this is the driver |
| Fetch line items for order | `pk = ORDER#<orderId> AND sk begins_with ITEM#` | Yes — same PK, sort-key range |
| List orders for user | `gsi1_pk = USER#<userId> AND gsi1_sk begins_with ORDER#` | No — needs GSI1 |
| Fetch order by tracking code | `pk = TRACKING#<trackingCode>` | No — different PK shape, needs a second lookup item or GSI |
| List reviews for product | `pk = PRODUCT#<productId> AND sk begins_with REVIEW#` | No — different PK entity type; needs GSI or the product partition to be the base-table driver for a separate table |

This table is the deliverable for Step 3. A pattern that cannot be expressed as a base-table `KeyConditionExpression` on the existing PK/SK moves to Step 4.

### When no sort key is needed

Some tables have only a partition key — no sort key. This is correct when every pattern is a Lookup (point read by a single attribute) and no pattern needs a collection or range predicate. A user-sessions table where every access is "fetch session by session ID" does not benefit from a sort key. Adding a sort key to serve a hypothetical future pattern that does not yet exist is premature — a GSI can be added when the pattern materialises, and it is easier to add a GSI to a live table than to remove or change a sort key (which requires a table rebuild).

### Key naming conventions

Use opaque, prefixed composite keys. The partition key is named `pk` and the sort key is named `sk` throughout this skill. Values use a prefix convention: `USER#<userId>`, `ORDER#<orderId>`, `REVIEW#<reviewId>`. The prefix is an entity discriminator — it prevents accidental key collisions between entity types when using single-table design and enables sort-key range queries of the form `sk begins_with REVIEW#` to return all reviews under a user partition.

Never use a raw user-supplied value as a partition key without a prefix. A user ID like `12345` is indistinguishable from an order ID that happens to also be `12345`. Prefixes make the key space unambiguous and enable entity-type discrimination in DynamoDB Streams consumers.

---

## Section 5: Step 4 — Add GSIs

For every pattern that is not served by the base-table keys, add a Global Secondary Index (GSI). Add exactly one GSI per distinct, unserved access pattern. Stop when all patterns are covered.

### GSI design rules

- **One GSI per access pattern.** Do not combine two unrelated patterns into one GSI by packing different entities' PK shapes into a shared attribute. When the two patterns' data sets grow independently, the GSI partition key becomes uneven and one pattern's data crowds the other's. When either pattern changes its query shape in the future, the GSI cannot be refactored without a dual-write migration.
- **GSI partition key must have high cardinality.** A GSI partition key with low cardinality (for example, `status` with values `ACTIVE` / `INACTIVE`) creates hot GSI partitions. DynamoDB throttles GSI partitions independently from the base-table partition. A status attribute with 80% of items as `ACTIVE` means 80% of writes land on a single GSI partition. The fix is a composite GSI key: `ACTIVE#<date>` or `ACTIVE#<shardId>`.
- **GSI projection type.** `ProjectionType.ALL` is the safe default — it includes every attribute in the GSI and avoids a second base-table fetch to retrieve un-projected attributes. `ProjectionType.KEYS_ONLY` or `ProjectionType.INCLUDE` reduce GSI storage and GSI write cost (each base-table write fans out to every GSI covering that item), but they require a second `GetItem` fetch when the query needs non-projected attributes. Use `KEYS_ONLY` or `INCLUDE` only when the query genuinely needs only a subset of attributes and the volume of writes justifies the optimization.
- **GSI write amplification.** Every write to a base-table item that affects a GSI-projected attribute triggers a corresponding write to the GSI. A table with 5 GSIs that each project `ALL` attributes multiplies write cost by up to 6× (one base write plus five GSI writes), all billed at 1 WCU per 1 KB. Budget this when projecting `ALL` on a large-item table with many GSIs.
- **GSI limit.** A DynamoDB table supports up to 20 GSIs. If the pattern inventory requires more than 20 GSIs on a single table, the table is trying to serve too many bounded contexts and multi-table design should be evaluated.

### GSI vs key overloading vs separate table

When an unserved pattern could be addressed by multiple approaches, apply this decision:

**Use a GSI when:**
- The pattern is a Global lookup or Collection on a different partition attribute.
- The access is read-oriented (Query on a GSI is always eventually consistent, which is acceptable for most reads).
- The pattern is permanent and bounded — the GSI's key shape will not need to change as the feature evolves.

**Use key overloading (entity discrimination in the sort key) when:**
- The pattern is a Collection on the same partition key as an existing pattern, just restricted to a different entity type.
- A sort-key prefix like `REVIEW#` already serves the entity discriminator role and the `begins_with` predicate covers the query.
- No new GSI is needed — the base-table Query handles it.

**Use a separate table when:**
- The pattern belongs to a different bounded context with distinct ownership, TTL policy, scaling characteristics, or team ownership (the full multi-table decision tree is in `01-modeling.md`).
- The GSI would require a low-cardinality partition key that cannot be made high-cardinality without distorting the base-table schema.
- The two entities' write rates are so different that sharing a table introduces noisy-neighbor throttling risk.

---

## Section 6: Step 5 — Validate against constraints

After the key design and GSI plan are in place, validate the design against four constraint categories before committing to it. A design that passes Step 4 is logically correct but may be operationally unsafe.

### Item size — 400 KB hard limit

DynamoDB imposes a hard limit of 400 KB per item, including attribute names and attribute values. This limit is enforced at write time; writes that would exceed it fail with a `ValidationException`. There is no configuration to raise it.

In practice, the constraint is hit by one of two failure modes:

1. **Attribute accretion** — an item starts small and grows over time as new attributes are added (tags lists, embedded arrays of events, accumulated history). The happy-path item fits easily at 1 KB; after a year of production use the same item is at 380 KB.
2. **Embedded collections** — storing a list of child entities (for example, all line items on an order) as a DynamoDB `List` attribute on the parent item. This works until the parent has 200 line items, at which point the item size approaches the limit.

When a pattern requires retrieving or writing an item that may grow past 400 KB: (a) split the growable content into child items with their own PK/SK, served by a Collection pattern; or (b) store the large payload in S3 and keep only an S3 pointer attribute on the DynamoDB item (URI, size, checksum). Decide this during schema design, not after the first production `ValidationException`.

**Billing boundaries.** A Write Capacity Unit (WCU) covers one write per second for items up to 1 KB; writes larger than 1 KB round up to the next whole KB (a 1.1 KB item costs 2 WCUs). A Read Capacity Unit (RCU) covers one strongly consistent read per second, or two eventually consistent reads per second, for items up to 4 KB; reads larger than 4 KB round up to the next 4 KB. Eventually consistent reads cost 0.5 RCU per 4 KB. Large items are disproportionately expensive: a 100 KB item costs 100 WCUs per write, 25 RCUs per strongly consistent read, or 12.5 RCUs per eventually consistent read.

### Hot partition risk

DynamoDB distributes data across physical partitions by partition key. A partition key value that receives a disproportionate share of traffic (reads or writes) causes a hot partition. The partition's RCU/WCU budget is exhausted regardless of whether the table-level budget is still available, and DynamoDB returns `ProvisionedThroughputExceededException` on `PAY_PER_REQUEST` tables as well (the per-partition limit is separate from the table's burst capacity).

Evaluate each partition key against these risk factors:

- **Cardinality** — a partition key with few distinct values concentrates traffic. A `type` attribute with values `USER`, `ORDER`, `REVIEW` in a single-table design concentrates all `USER` writes on one partition.
- **Temporal skew** — a date-based partition key (`created_date = 2026-04-20`) receives all writes today and zero writes tomorrow. The hot partition follows the calendar.
- **Known traffic concentrations** — a celebrity user, a viral product, or a batch import that targets one partition key value.

Mitigations are documented in `02-scaling.md`. During schema design, flag any partition key that exhibits these risk factors and document the mitigation in the access-pattern table.

### Cost per pattern — RCU/WCU budget

For each access pattern, estimate the RCU or WCU cost of a single execution:

- **GetItem / Query on base table:** RCU cost = ceil(item size in KB / 4) for strong consistency, ceil(item size in KB / 8) for eventual consistency (0.5 RCU per 4 KB, rounded up per 4 KB block). Multiply by frequency to project daily RCU.
- **Query on GSI:** Same RCU formula, always eventually consistent (GSI `ConsistentRead` is not supported).
- **PutItem / UpdateItem / DeleteItem:** WCU cost = ceil(item size in KB / 1). GSI write amplification multiplies this by the number of GSIs whose projected attributes are touched. A 2 KB item written to a table with 3 GSIs all projecting `ALL` costs 4 × ceil(2/1) = 8 WCUs per write.
- **TransactWriteCommand:** Each item in a `TransactItems` array is billed at 2× the normal WCU cost — one for the write itself, one for the transactional coordination overhead. A transaction writing two 1 KB items costs 4 WCUs total. When using `TransactWriteCommand` for high-frequency writes (for example, the atomic uniqueness pattern in `../../aws-cdk-patterns/references/04-database.md` §4), budget the 2× factor explicitly.
- **Projection type impact on write cost:** A GSI with `ProjectionType.KEYS_ONLY` incurs a write only when the item's key attributes change. A GSI with `ProjectionType.ALL` incurs a write on every attribute mutation. For a write-heavy table with large items, switching a non-critical GSI from `ALL` to `INCLUDE` (projecting only the attributes the query actually returns) can halve or quarter the GSI write cost while keeping the query serving its caller correctly.

Patterns with a tight latency budget and a high frequency drive the bulk of the table's throughput. If the projected cost of a single high-frequency pattern exceeds the budget, revisit the item size (strip unused attributes or move them to S3), the GSI projection type (reduce fanout), or the consistency level (downgrade to eventual if the pattern tolerates it).

### Consistency requirements

Mark each pattern in the inventory as Strong or Eventual. Then verify:

- Every Strong pattern is served by the base table (not a GSI).
- Every GSI-served pattern is tolerated by the calling code as eventually consistent. GSI propagation lag is typically under one second, but it is not bounded. A caller that writes to the base table and immediately queries a GSI may see the pre-write state.

If a pattern requires strong consistency but can only be served by a GSI (because the base-table key is already occupied by a higher-frequency driver), the design must be revised: either change the base-table key to serve the strong-consistency pattern, or refactor the pattern to accept eventual consistency.

### When validation fails — loop back

If any validation check reveals a constraint violation, return to the step that produced the violating decision:

- **Item size violation** → Step 3 or Step 4. Restructure the item: split embedded lists into child items (changes the Collection pattern's PK/SK), or move large payloads to S3 (changes the item's attribute set).
- **Hot partition risk** → Step 3. Change the partition key to improve cardinality (add a shard suffix, use a composite attribute). Document the sharding scheme in the access-pattern table. Full sharding patterns are in `02-scaling.md`.
- **Cost over budget** → Step 4. Reduce GSI write amplification by narrowing projection types; reduce read cost by downgrading a strong-consistency read to eventual where tolerable.
- **Strong consistency not servable** → Step 3. Re-evaluate the base-table key selection: if the pattern requiring strong consistency is high enough priority, promote it to the base-table driver and demote the previous driver to a GSI (which means accepting eventual consistency for the demoted pattern).

The loop is typically one or two iterations. A design that requires more than three loops usually has a fundamental mismatch between the access patterns and the entity structure — a signal to revisit the domain model before finalising the schema.

---

## Section 7: Step 6 — Decide single-table vs multi-table

After validating the key design and GSI set against all five constraints, decide whether to place all entities in one table or distribute them across multiple tables. This decision depends on bounded-context boundaries, TTL requirements, team ownership, and scaling characteristics.

The full decision tree — including when single-table collapses multiple bounded contexts safely and when it creates accidental coupling — is in `01-modeling.md`. Step 6 is the concluding step of the methodology; it does not produce a key design, it selects the table shape that best fits the validated design from Steps 1-5.

---

## Section 8: JTBD branches

### Greenfield — designing a schema from scratch

Execute all six steps in order. The access-pattern inventory is the hardest part; resist the temptation to start at Step 3. A common failure mode is sketching a key design based on the entity model ("users have orders, so pk=userId, sk=orderId") and then reverse-engineering access patterns to fit. That produces a schema that serves the patterns someone imagined the system would need, not the patterns the system actually executes.

Deliver the access-pattern inventory to stakeholders for review before writing a single key design. Non-technical stakeholders can validate whether the operation names match the application's real use cases. Catching a missing access pattern before the schema is built costs nothing; catching it after the table is in production costs a full dual-write migration.

**Timebox the inventory.** In a greenfield domain, the inventory can grow indefinitely because every hypothetical future feature suggests a hypothetical future access pattern. Set a timebox: collect patterns for every feature in the current release milestone, plus any explicitly planned features in the next milestone. Features beyond that horizon are speculative — adding GSIs or overloading sort keys for speculative patterns introduces complexity with no present-day benefit. DynamoDB supports up to 20 GSIs; they can be added to a live table (see `05-evolution.md`). Leave headroom.

### Extension — adding a new access pattern to an existing table

Start at Step 1 for the new pattern only. Add the new row to the inventory table. Classify it (Step 2). Check whether the existing base-table keys already serve it — if yes, the extension requires no schema change, only a new query in the application code.

If the existing keys do not serve the new pattern, go directly to Step 4: evaluate GSI vs key overloading vs separate table. Steps 3 (derive base-table keys) and 6 (single vs multi-table) are already decided; do not reopen them for an extension unless the new pattern fundamentally changes the dominant access characteristics of the table.

After choosing the extension strategy, execute Step 5 (validate constraints) for the new pattern. Adding a GSI to a live table triggers an online backfill; the table is fully available during the backfill but write costs are elevated until it completes (the `CONTRIBUTING_INDEXES` CloudWatch metric tracks GSI write amplification during backfill). For the cutover procedures after adding a GSI, see `05-evolution.md`.

### Migration — redesigning an existing schema

Execute the full six-step process on the **target** schema, treating it as a greenfield design. The current schema is the starting point for the access-pattern inventory (the patterns already in production must be covered by the target design), not a constraint on the key design.

After the target design passes validation, the migration itself — dual-write setup, backfill, cutover, and rollback criteria — is the subject of `05-evolution.md`. Do not design the migration cutover strategy in the methodology; keep the two concerns separate.

---

## Section 9: Worked example — e-commerce domain

The domain has four entity types: **users**, **orders**, **order-items**, and **reviews**. The worked example walks all six steps.

### Step 1: Access-pattern inventory

| Operation | Entity | Frequency | Latency budget (ms) | Consistency need |
|---|---|---|---|---|
| Fetch user profile for account settings page | User | Medium — on every login, ~50 rps | ≤ 100 ms | Strong — must show current email |
| Fetch order details for order confirmation screen | Order | High — on every purchase, ~200 rps | ≤ 50 ms | Strong — must reflect current status |
| List orders for a user's order history page | Order | Medium — on every account page view, ~80 rps | ≤ 200 ms | Eventual — stale list is tolerable |
| Fetch all line items for an order detail screen | OrderItem | High — on every order detail view, ~200 rps | ≤ 50 ms | Eventual — tolerable for display |
| Fetch order status by external tracking code | Order | Low — carrier callbacks only, ~5 rps | ≤ 500 ms | Eventual — carrier does not need real-time sync |
| List reviews for a product page | Review | High — product pages load reviews, ~300 rps | ≤ 100 ms | Eventual — acceptable for product pages |
| Fetch a specific review for a moderation workflow | Review | Rare — moderation tooling only | ≤ 500 ms | Eventual |
| Submit new review (write) | Review | Medium — post-purchase, ~30 rps | ≤ 200 ms write | Strong — idempotency requires seeing latest version |
| Fetch user's total spend for analytics dashboard | User (aggregate) | Low — analytics polling, ~2 rps | ≤ 1000 ms | Eventual |
| Fetch count of open orders for fulfilment dashboard | Order (aggregate) | Low — dashboard polling, ~2 rps | ≤ 1000 ms | Eventual |

### Step 2: Classification

| Operation | Class |
|---|---|
| Fetch user profile | Lookup — point read by user ID |
| Fetch order for confirmation | Lookup — point read by order ID |
| List orders for user | Collection — all orders under user |
| Fetch line items for order | Collection — all items under order |
| Fetch order by tracking code | Global lookup — tracking code is not the base PK |
| List reviews for product | Collection — all reviews under product |
| Fetch specific review | Lookup — point read by review ID |
| Submit new review | Lookup (write) — write to known review key |
| User total spend | Aggregation — counter item per user |
| Open order count | Aggregation — counter item for the domain |

### Step 3: Key derivation — two proposals

The two highest-frequency patterns with a strong-consistency requirement are "Fetch order for confirmation" (~200 rps, Strong) and "Fetch line items for order" (~200 rps, Eventual). Because order-items are always fetched together with their parent order, both patterns can be served if the partition key is `ORDER#<orderId>` and the sort key distinguishes the order root item from its line items.

**Proposal A — single-table design**

All four entity types in one table. The partition key is the entity's natural owner aggregate, the sort key discriminates the entity type within the partition.

| Entity | pk | sk | GSI1-pk | GSI1-sk | GSI2-pk | GSI2-sk |
|---|---|---|---|---|---|---|
| User | `USER#<userId>` | `USER#<userId>` | — | — | — | — |
| Order (root item) | `ORDER#<orderId>` | `ORDER#<orderId>` | `USER#<userId>` | `ORDER#<createdAt>` | — | — |
| OrderItem | `ORDER#<orderId>` | `ITEM#<itemId>` | — | — | — | — |
| Review | `PRODUCT#<productId>` | `REVIEW#<reviewId>` | `USER#<userId>` | `REVIEW#<createdAt>` | — | — |
| UserSpend counter | `USER#<userId>` | `COUNTER#SPEND` | — | — | — | — |
| OpenOrders counter | `DOMAIN#COUNTERS` | `COUNTER#OPEN_ORDERS` | — | — | — | — |
| TrackingCode lookup | `TRACKING#<trackingCode>` | `TRACKING#<trackingCode>` | — | — | — | — |

GSI coverage:
- `GSI1`: pk = `USER#<userId>`, sk = `ORDER#<createdAt>` — serves "List orders for user" (Collection, sorted by creation time).
- `GSI1` also serves "List reviews by user" if the user wants their review history, because `USER#<userId>` is already the GSI1 partition key and `REVIEW#<createdAt>` is the sort key on the review item.

"Fetch order by tracking code" is served by a lookup on `pk = TRACKING#<trackingCode>`. The tracking-code item carries the `orderId` as an attribute; the caller makes a second `GetItem` on `ORDER#<orderId>` to fetch the full order. This is a two-step lookup, not a single query; it is acceptable at 5 rps with a 500 ms budget.

**Proposal B — multi-table design**

Each entity type has its own table with a key designed for its primary access pattern.

| Table | pk | sk | GSI1-pk | GSI1-sk |
|---|---|---|---|---|
| Users | `USER#<userId>` | `USER#<userId>` | — | — |
| Orders | `ORDER#<orderId>` | `ORDER#<orderId>` | `USER#<userId>` | `created_at` (ISO 8601) |
| OrderItems | `ORDER#<orderId>` | `ITEM#<itemId>` | — | — |
| Reviews | `PRODUCT#<productId>` | `REVIEW#<reviewId>` | `USER#<userId>` | `created_at` |
| OrdersByTracking | `TRACKING#<trackingCode>` | `TRACKING#<trackingCode>` | — | — |
| Counters | `COUNTER#<counterId>` | `COUNTER#<counterId>` | — | — |

The base-table keys in Proposal B are identical to Proposal A for the primary patterns. The difference is that the entities are in separate tables, so each table's GSI budget, TTL policy, and capacity mode can be tuned independently. The Orders table can have PAY_PER_REQUEST with Contributor Insights enabled for hot-partition detection; the Counters table can be provisioned with predictable WCU if write-sharding is needed.

### Step 4: GSI validation

Both proposals require the same GSIs:
- One GSI on Orders (or in the single-table, on the combined table) for "List orders by user".
- One GSI on Reviews for "List reviews by product" — wait, that is the base-table key in both proposals: `pk = PRODUCT#<productId>`. No GSI needed for that pattern.
- No second GSI is needed for Reviews because "Fetch specific review by review ID" can be served by a Scan-then-filter only if no base-table key matches. In Proposal A, `REVIEW#<reviewId>` is the sort key under `PRODUCT#<productId>`, so a `GetItem` requires knowing the product ID. If the moderation workflow knows only the review ID (not the product ID), a GSI with `pk = REVIEW#<reviewId>` on a sparse attribute is needed. Add it as `GSI2` on the Reviews partition in Proposal A or as a GSI on the Reviews table in Proposal B.

Aggregation patterns (UserSpend counter, OpenOrders counter) require counter items — not GSIs. They are served by `GetItem` on the counter item's primary key.

### Step 5: Validation checklist

| Constraint | Proposal A (single-table) | Proposal B (multi-table) |
|---|---|---|
| Max item size risk | Low — the largest item is Order root with ~20 attributes; estimated max 2 KB per item. OrderItems stored as separate items, not embedded lists. Counter items are tiny. | Same — entities are not embedded. |
| Hot partition risk | Medium — the TrackingCode items (`TRACKING#<trackingCode>`) will receive write bursts during peak ordering periods. At 200 rps of orders, all tracking writes land on different partition keys (one per order), so distribution is good. The UserSpend counter (`USER#<userId>`) receives one write per order per user; not a hot partition unless a single user places thousands of orders per minute. | Same analysis applies per-table. The Orders table has the same distribution profile. |
| Cost — Order fetch (200 rps, ~2 KB item, Strong) | 200 rps × ceil(2/4) RCU = 200 RCU/s | Same |
| Cost — List orders by user (80 rps, 10 orders avg, ~1 KB each, Eventual) | 80 rps × ceil(10 KB / 8) RCU = 80 × 2 = 160 RCU/s on GSI1 | Same for Orders GSI |
| Cost — GSI write amplification (200 rps order writes, 2 KB, 1 GSI covering Order items) | 200 rps × ceil(2/1) WCU × 2 (base + GSI1) = 800 WCU/s | Same |
| Consistency — all Strong patterns on base table | Fetch user profile: base table ✓. Fetch order for confirmation: base table ✓. Submit review (write): write is base-table ✓. | Same per-table |
| GSI limit (max 20) | 2 GSIs total. Well within limit. | 1 GSI per table. Well within limit. |

Both proposals pass validation. The single vs multi-table choice is made in Step 6 using the decision tree in `01-modeling.md`. For this domain, the entities span two distinct product areas (commerce vs content/reviews), have different TTL requirements (orders kept for 7 years for tax compliance; reviews kept indefinitely), and the reviews team is owned by a separate product squad — multi-table is the stronger fit.

One open item from validation: the hot-partition risk on the UserSpend counter item (`USER#<userId>` / `COUNTER#SPEND`) must be mitigated if a single user can place orders at high frequency. In production environments, a purchasing bot or an automated reseller account could drive dozens of writes per second to the same user partition. If this scenario applies, the counter should use a write-sharded design (N shard items under `COUNTER#SPEND#<shardId>`) with a periodic roll-up. The sharding pattern is in `02-scaling.md`; note it in the access-pattern inventory so it is not forgotten during implementation.

---

## Section 10: Anti-patterns

### Labeling access patterns as CRUD verbs

Writing "create order", "read order", "update order", "delete order" in the inventory is not an access-pattern inventory — it is a list of HTTP methods. CRUD labels carry no information about who calls the operation, what consistency the caller requires, how frequently it runs, or what the latency budget is. Key design decisions derived from CRUD labels are derived from nothing. Replace every CRUD label with an operation name that includes the caller context: "Fetch order for payment confirmation (checkout service)", "Expire order after 30-day inactivity (TTL sweep)", "Update order status on carrier callback (logistics webhook)".

### Designing keys before the access-pattern inventory exists

Starting with a key design — even a tentative one — anchors subsequent thinking. Once `pk = userId` is written down, the natural next thought is "sort key = orderId" because orders belong to users. But maybe the dominant access pattern is "fetch order by ID" (no user involved), and `pk = orderId` is the correct base-table key. An early, tentative key design crowds out the correct one. Do not open a key-design sketch until the inventory table has at least a first draft covering every entity type.

### Skipping the item-size check because the happy-path item is small

The 400 KB item-size limit does not constrain new items — it constrains items after months or years of production use. An item that holds a user's settings object, a list of saved addresses, and a list of notification preferences is 500 bytes on day one and 40 KB after the user has 50 saved addresses. The time to discover the limit is during schema design, when a "list of addresses" can be redesigned as child items under `pk = USER#<userId>, sk = ADDRESS#<addressId>`. Discovering the limit in production requires a dual-write migration to split the embedded list into child items — a multi-week effort.

### Reusing a single GSI for two unrelated patterns by overloading its key shape

A GSI whose partition key is named `gsi1_pk` and stores `USER#<userId>` for one entity type and `PRODUCT#<productId>` for another is an overloaded GSI. The intent is to save GSI slots. The result is a GSI where the two entity types' data is mixed in the same key space, making cardinality analysis unreliable, making cost attribution impossible, and making the GSI impossible to remove or refactor independently. When the patterns diverge — one needs a different projection type, one generates ten times more traffic than the other — the overload cannot be undone without a migration. Add a second GSI instead. The limit is 20 GSIs; an overloaded GSI is never worth the complexity cost.

---

## Section 11: Further reading

- `01-modeling.md` — canonical single-table vs multi-table decision tree; partition key design; sort-key prefix schemes; GSI projection tradeoffs; adjacency list patterns.
- `02-scaling.md` — throughput validation in detail: hot-partition detection with Contributor Insights, write sharding, calendar-based PK sharding, item-size cost modeling, PAY_PER_REQUEST vs PROVISIONED breakeven.
- `05-evolution.md` — migration without downtime: dual-write setup, GSI backfill during a live migration, cutover strategies, rollback criteria.
- [Amazon DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) — authoritative reference for all limits, consistency semantics, and API behavior documented in this file.
- Sibling: `../../aws-cdk-patterns/references/04-database.md` §3 — CDK `Table` construct with billing mode, PITR, TTL, and GSI provisioning. §4-6 — atomic uniqueness pattern (`TransactWriteCommand` + lookup table), identity-verified updates, and cursor-based pagination with full TypeScript implementation.
