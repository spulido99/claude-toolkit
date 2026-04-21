# Modeling

**Builds:** The complete key schema for a DynamoDB table — partition keys, sort keys, GSIs, entity discrimination, and hierarchical access patterns. The canonical home of the single-table vs multi-table decision tree.
**When to use:** After completing the access-pattern inventory in `00-methodology.md`, when deriving the concrete key shapes and GSI definitions that will serve those patterns. Also load this file when evaluating a GSI projection type, designing an adjacency list, or deciding between single-table and multi-table.
**Prerequisites:** `00-methodology.md` — the six-step design process that produces the access-pattern inventory and constraint validation that drives every decision in this file.

## Contents

1. **Single-table vs multi-table decision tree** — canonical criteria for each shape; concrete examples.
2. **Partition key design** — cardinality, even distribution, caller-provided vs system-generated PKs, keys that leak.
3. **Sort key design** — composite patterns, prefix conventions, `begins_with` queries, sort direction, when no sort key is needed.
4. **Key overloading / entity discrimination** — `entity_type` attribute, sort-key prefix as discriminator, GSI projection trap, Stream routing.
5. **GSI design** — PK/SK selection, projection types with concrete byte-cost table, sparse indexes, LSI for completeness.
6. **Adjacency list / hierarchical patterns** — one-to-many, many-to-many with inverse GSI, nested hierarchies; social-graph worked example.
7. **Cross-references** — atomic uniqueness; CDK provisioning.
8. **Verification** — `describe-table` sanity checks with example output.
9. **Further reading**.

---

## Section 1: Single-table vs multi-table decision tree

Single-table design collapses every entity in a bounded context into one DynamoDB table with composite keys. Multi-table design gives each entity — or each bounded context — its own table. Both are valid production patterns. Neither is universally correct. Choose based on access patterns, ownership boundaries, TTL requirements, and scaling characteristics — not on convention or folklore.

This section is the canonical source for this decision. `../../aws-cdk-patterns/references/04-database.md` §2 summarises the decision and links back here. If you encounter a summary elsewhere, this file is the authoritative version.

### Choose single-table when

- **All entities belong to one tightly coupled aggregate.** A canonical example is a user and their owned sub-entities: saved addresses, notification preferences, active sessions, and refresh tokens. These items are always created, read, and deleted in the context of the user; they have no independent identity outside the aggregate root. Collapsing them into one table with `pk = USER#<userId>` and sort-key prefixes per sub-entity type is the natural fit.

- **Access patterns are homogeneous and bounded in count** — roughly 5–10 patterns total across all entities in the bounded context. When patterns are few and structurally similar (most are Collection queries on the same partition key), a single PK/SK scheme serves them all without GSI sprawl.

- **Cost optimization on the tail matters.** Fewer tables means fewer minimum provisioning commitments on `PROVISIONED` mode tables, fewer CloudWatch metric streams, and lower account-level baseline cost for low-traffic services. In a `PAY_PER_REQUEST` environment this factor is smaller, but it is non-zero — each additional table adds table-level overhead in DynamoDB Streams, PITR, and CloudWatch.

- **Queries routinely cross entity boundaries and benefit from returning multiple entity types in a single `Query`.** Example: a checkout screen that must show the user's profile, their current cart items, and their default payment method in one round trip. If all three entity types share `pk = USER#<userId>`, a single `Query` with `pk = USER#<userId>` returns all of them, and the client discriminates by `entity_type` attribute or sort-key prefix. One network call replaces three.

**Concrete example (single-table fit):** A SaaS tenant management service stores tenants, their feature flags, and their billing plans. All three entities are always read together on the tenant dashboard, have identical TTL policy (none — retained forever), and are owned by a single team. Single-table with `pk = TENANT#<tenantId>` and sort keys `TENANT#<tenantId>`, `FLAG#<flagName>`, `PLAN#<planId>` is a clean fit.

### Choose multi-table when

- **Multiple bounded contexts have distinct access patterns.** When the inventory from `00-methodology.md` §Section 2 reveals that entity A is always accessed by owner ID and entity B is always accessed by a product SKU, the two entities have different partition structures. Merging them into one table hides the bounded-context boundary and invites accidental coupling — a schema change for one context forces a migration analysis for both.

- **Per-domain offline or online sync semantics differ.** Each domain may have its own sync cursor, conflict resolution strategy, or change-feed subscription. A per-table model makes the sync state independent: the orders domain can replay its entire stream without touching the reviews domain. In a single-table design, the DynamoDB Stream interleaves all entity types, and every consumer must filter for its own entity prefix before processing.

- **TTL or retention diverges by domain.** `timeToLiveAttribute` is a table-level setting — you cannot give one entity a 7-day TTL and another entity no TTL in the same table without adding an `expires_at` attribute to every item and leaving it null for "keep forever" items (which is messy and creates a consistency risk if an item is accidentally written with `expires_at` set). A separate table per TTL policy is cleaner.

- **Team ownership boundaries differ.** When two teams own two domains, two tables make responsibility concrete. A team cannot accidentally break the other team's access patterns through a GSI schema change, an item-size growth, or a partition-key cardinality choice. DynamoDB IAM policies can be scoped to individual tables, enforcing the ownership boundary at the infrastructure level.

- **Scaling characteristics diverge significantly.** One entity is hot and bursts to thousands of writes per second; another entity is cold and receives a few writes per day. In a single table, the hot entity's adaptive capacity behavior and throttling events appear in the same table metrics as the cold entity's, making hot-partition diagnosis harder. Separate tables keep capacity mode, Contributor Insights, and alarm thresholds independent per entity.

- **Divergent GSI requirements approach the 20-GSI limit.** DynamoDB supports up to 20 GSIs per table (verify in the current AWS DynamoDB service quotas page before relying on this number — it has historically been 20 and has not changed as of this writing). If the combined access patterns of two domains require 12 GSIs each, a single table cannot accommodate both; multi-table is required.

**Concrete example (multi-table fit):** An e-commerce platform has an orders domain (owned by the fulfilment team, 7-year retention for tax compliance, burst writes at checkout) and a reviews domain (owned by the content team, indefinite retention, burst reads on product pages). Different teams, different TTL, different scaling profiles. Multi-table is correct. The two domains cross-reference via `orderId` attributes in review items — no shared DynamoDB key schema is needed for that link.

**State it explicitly:** neither pattern is universally correct. The rest of this file documents key design, GSI, and hierarchical patterns that work identically in both shapes.

---

## Section 2: Partition key design

The partition key (PK) determines which physical DynamoDB partition stores an item. DynamoDB hashes the partition key value and routes the item to the partition that owns that hash range. Every read and write to the item must name the same partition key value to reach the item — there is no secondary lookup at the partition level.

### High cardinality

A partition key with low cardinality concentrates traffic on a small number of physical partitions. DynamoDB allocates 3,000 RCUs and 1,000 WCUs per second per partition (these are partition-level limits, separate from the table-level throughput budget). A partition key with ten distinct values means ten partitions share the entire table's load; if traffic is unevenly distributed — which it almost always is with low-cardinality keys — the hot partitions throttle while cold partitions are idle.

Common low-cardinality anti-patterns:

- `status` as PK: values like `PENDING`, `ACTIVE`, `COMPLETED`. In an orders table, `ACTIVE` might hold 90% of all items and receive 90% of all writes.
- `type` as PK: values like `USER`, `ORDER`, `REVIEW`. In a single-table design this is especially dangerous — the `USER` partition receives all user writes regardless of how many user IDs exist.
- Boolean flags as PK: `is_flagged = true/false`. Two partitions for the entire table.
- Date at day granularity as PK: `created_date = 2026-04-20`. Every write today hits one partition; yesterday's partition is cold.

The fix is always to move to a higher-cardinality key: user ID, order ID, a UUID, or a composite key that incorporates a high-cardinality attribute. See `02-scaling.md` for write-sharding mitigations when the high-cardinality fix is not possible (for example, a status-based workflow where "active" items must be queryable as a collection).

### Even distribution

High cardinality is necessary but not sufficient. The key values must also distribute evenly across the DynamoDB hashing space. DynamoDB uses consistent hashing — partition key values that are similar strings (for example, sequential integers `1`, `2`, `3`, ...) may not hash to evenly spaced positions in the ring, particularly when the range of integers is small.

In practice, even distribution is achieved by:

- **UUIDs (v4):** 128-bit random values distribute uniformly by design.
- **Prefixed natural keys:** `USER#<uuid>` hashes differently from `uuid` because the prefix changes the input. Prefixes contribute to distribution when the prefix itself varies — if every key has the same prefix, the prefix is irrelevant to distribution.
- **Avoiding sequential integers as sole PK:** A table that starts with 1,000 items and uses `item_id = 1..1000` hashes to a relatively small region of the hash ring. As the table grows to millions of rows and DynamoDB splits partitions, distribution improves automatically — but during the early life of the table, hot partitions can form.

The anti-patterns to avoid at design time: `status`, `type`, boolean flags, low-granularity dates, and sequential integers in small tables.

### Caller-provided vs system-generated PKs

**System-generated PKs** (UUIDs from `randomUUID()` or equivalent) distribute evenly by construction and guarantee no collision. The trade-off is that natural lookup by a human-meaningful identifier requires either a GSI or a lookup item. If a support engineer needs to find an order by a customer-facing order number, and the PK is a UUID, the system must maintain a mapping from order number to UUID.

**Caller-provided PKs** (user ID from an OAuth token, order number from a sequence, product SKU from a catalog) are immediately lookup-friendly — the caller already has the key. The trade-off is that the distribution quality depends on the caller's ID space. OAuth user IDs from most providers are UUIDs or high-entropy strings, so distribution is good. Sequential database IDs from a relational system migrated to DynamoDB start at 1 and grow slowly — distribution may be poor during early growth.

Decision rule:
- Use system-generated UUIDs when the item has no natural human-facing identifier, or when the item's identifier is assigned by the system rather than the caller.
- Use caller-provided IDs when (a) the ID is already a high-entropy string from a trusted source, (b) the primary access pattern is a point lookup by that ID with no GSI required, and (c) the ID space is large enough to ensure even distribution.

### PKs that leak

Never reuse raw user-supplied input as a partition key when that input could enable enumeration or collision.

**Enumeration risk:** If `pk = email` (plaintext), anyone with `Scan` access to the table can enumerate all email addresses in the system. An attacker who compromises a read-only IAM credential gains a full email list. Use a system-generated UUID as the PK; store the email as an attribute and enforce uniqueness via the lookup-table pattern (see Section 7 and `../../aws-cdk-patterns/references/04-database.md` §4).

**Collision risk:** If `pk = username` and two users submit the same username at the same time, a naive `PutItem` without `attribute_not_exists(pk)` will silently overwrite the first user's item. Use `attribute_not_exists(pk)` on every `PutItem` for user-created keys, or use the transactional uniqueness pattern.

**PII in key space:** A partition key is visible in DynamoDB access logs, CloudWatch Logs Insights queries on table metrics, and AWS support tooling. Keys that contain email addresses, phone numbers, or government IDs expose PII to a wider surface area than a hashed or encrypted attribute would. Use a hash (for example, SHA-256 of the email with a domain-specific salt) or a system-generated ID as the PK, not the raw PII value.

---

## Section 3: Sort key design

The sort key (SK) determines the ordering of items within a partition. Within a single partition, items are physically stored in ascending sort-key order. This physical layout is what makes `begins_with`, `BETWEEN`, and comparison predicates efficient — DynamoDB does not scan the entire partition; it seeks to the start of the key range and reads forward or backward until the range is exhausted.

### Composite patterns

Sort keys compound multiple semantic components with a delimiter:

- **Entity root:** `USER#<userId>` — used when the item represents the aggregate root itself (the user, not a child entity). The partition key and sort key are identical for root items.
- **Single child:** `ADDRESS#<addressId>` — all addresses under a user partition.
- **Nested child:** `ORDER#<orderId>#ITEM#<itemId>` — a line item nested under an order, within a user partition.
- **Date prefix for time-ordered collections:** `ORDER#2026-04-20T14:32:00Z` — orders sorted chronologically. ISO 8601 strings sort lexicographically in the same order as chronologically, which is why they are used instead of Unix epoch integers for sort keys (epoch integers are also correct — they sort numerically — but ISO 8601 is human-readable in the DynamoDB console).
- **Composite date + ID:** `ORDER#2026-04-20T14:32:00Z#<orderId>` — when two orders could arrive at the same millisecond, append a UUID to guarantee uniqueness within the sort key space.

### Sort-key prefix conventions

The prefix convention used throughout this skill is `ENTITY_TYPE#<id>`. The prefix is always uppercase, separated from the ID by a `#`. This convention enables three things:

1. **Entity discrimination within a partition.** A `Query` with `pk = USER#<userId>` and `KeyConditionExpression = pk = :pk AND begins_with(sk, :prefix)` returns only the entity type named by the prefix, not all items in the partition.

2. **`begins_with` range queries** without a separate filter expression. The prefix is the predicate; items without that prefix are not returned by the Query.

3. **Sort-key namespace isolation.** If two entity types both store an `<id>` as the sort key value, the prefix prevents collision: `ADDRESS#addr_001` and `SESSION#addr_001` are different sort keys even though the ID portion is the same.

### `begins_with` queries

The `begins_with` function is used inside a `KeyConditionExpression` on the sort key. It is a DynamoDB expression function — it appears as a string in the expression, not as a JavaScript function call.

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Fetch all orders under a user, sorted ascending by creation time.
// Table schema: pk = USER#<userId>, sk = ORDER#<createdAt>#<orderId>
const result = await client.send(
  new QueryCommand({
    TableName: "social-graph",
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: {
      ":pk": "USER#usr_01HZXYZ",
      ":prefix": "ORDER#",
    },
    ScanIndexForward: true, // ascending — earliest orders first
  }),
);

const orders = result.Items ?? [];
```

`begins_with` works identically on GSI sort keys when the GSI sort key uses the same prefix scheme.

**Reserved-word collisions.** DynamoDB maintains a list of reserved words that cannot appear as attribute names in expressions without being aliased via `ExpressionAttributeNames`. Common collisions include `status`, `name`, `count`, `value`, `type`, `data`, `timestamp`, `order`, `key`, `hash`, and `size`. If a `FilterExpression` or `ProjectionExpression` references any of these without aliasing, DynamoDB returns a `ValidationException`. The fix is always to alias the attribute:

```typescript
// "status" is a DynamoDB reserved word — alias it.
new QueryCommand({
  TableName: "orders",
  KeyConditionExpression: "pk = :pk",
  FilterExpression: "#s = :status",
  ExpressionAttributeNames: { "#s": "status" },
  ExpressionAttributeValues: {
    ":pk": "USER#usr_01HZXYZ",
    ":status": "ACTIVE",
  },
});
```

The full reserved-word list is published in the AWS DynamoDB Developer Guide under "Reserved Words in DynamoDB." It is long (hundreds of entries). As a practical rule, alias every attribute whose name is a common English word or a SQL keyword.

### Sort direction

`ScanIndexForward` controls the order in which DynamoDB returns items within a partition:

- `ScanIndexForward: true` (default) — ascending order, smallest sort key first. Use for oldest-first timelines, alphabetical lists.
- `ScanIndexForward: false` — descending order, largest sort key first. Use for newest-first feeds, "most recent N" queries.

DynamoDB does not support bidirectional pagination from a single `ExclusiveStartKey`. If descending order is needed, set `ScanIndexForward: false` on every page of the same query chain — do not flip sort direction mid-pagination.

### When no sort key is needed

A table with only a partition key (no sort key) is correct when every access pattern is a point lookup (`GetItem`) by a single attribute and no pattern ever needs a collection or range query. Example: a session cache table where the access is always `GetItem` by session ID and sessions are deleted by TTL, not queried by range.

Consequences of omitting a sort key:
- `GetItem` is the only strongly consistent read option.
- `Query` can still be used but with no sort-key predicate — it returns all items in the partition, which is typically one item (since each PK value holds one item without a SK to distinguish multiple items per partition).
- No `begins_with` or `BETWEEN` predicates are possible on the base table. A GSI can add a sort key at the GSI level.
- Adding a sort key to the base table later requires a table rebuild — sort key presence is fixed at table-creation time and cannot be added or removed from a live table.

If there is a possibility that a collection or range pattern will be needed in the future, add a sort key at design time (even if the current sort key value is identical to the partition key, as in `pk = USER#<id>, sk = USER#<id>` for root items). Adding a GSI with a sort key is always available as a later option; changing the base-table sort key is not.

---

## Section 4: Key overloading / entity discrimination

Single-table design requires multiple entity types to coexist in the same partition key space. Key overloading is the technique of storing different entity types in the same table by varying the sort key prefix. Entity discrimination is the practice of recording which entity type each item represents, so that consumers — application code, DynamoDB Streams handlers, deserializers — can identify the item type without inferring it from the key.

### The `entity_type` attribute

Every item in a single-table design should carry an explicit `entity_type` attribute:

```
pk = USER#usr_01HZXYZ
sk = USER#usr_01HZXYZ
entity_type = "USER"

pk = USER#usr_01HZXYZ
sk = ORDER#2026-04-20T14:32:00Z#ord_ABC
entity_type = "ORDER"
```

Why it matters:
- **DynamoDB Streams consumers** receive `NEW_IMAGE` records that contain the full item. Without `entity_type`, a consumer that sees `pk = USER#usr_01HZXYZ` must parse the sort key prefix to determine whether the item is a user root, an order, or a child entity. Sort key parsing is brittle — it breaks when the prefix scheme changes and is error-prone when two entity types share a prefix length.
- **Client deserializers** can use `entity_type` as a discriminant for union types without parsing string keys.
- **Human debugging** — the DynamoDB console shows `entity_type` as a plain string, making item type immediately visible.

### Sort-key prefix as entity discriminator

The sort-key prefix (`ORDER#`, `ADDRESS#`, `REVIEW#`) serves as the schema-level entity discriminator. It enables `begins_with` queries to return only one entity type without a filter expression. Combined with the `entity_type` attribute, it provides two independent discrimination mechanisms — the key-level mechanism for query routing, and the attribute-level mechanism for runtime deserialization.

The two mechanisms should agree. An item whose sort key starts with `ORDER#` should always have `entity_type = "ORDER"`. Inconsistencies (a bug that sets the wrong `entity_type`) are detectable by checking the two values against each other in the application layer or a Streams consumer.

### The GSI projection trap

When projecting items into a GSI with `ProjectionType.KEYS_ONLY`, the GSI item contains only the base-table partition key, the base-table sort key, the GSI partition key, and the GSI sort key. Non-key attributes — including `entity_type` — are not projected.

**The trap:** A Streams consumer or query result that reads from a `KEYS_ONLY` GSI receives items with no `entity_type` attribute. If the consumer was written assuming `entity_type` is always present, it fails silently or throws a deserialization error. The sort key prefix is still available (the base-table SK is always projected into GSIs), so sort-key prefix parsing is the fallback — but this puts you back in the brittle position that `entity_type` was meant to avoid.

**Fix:** When writing a GSI consumer that needs entity discrimination, either:
1. Use `ProjectionType.INCLUDE` and explicitly include `entity_type` in the `nonKeyAttributes` list.
2. Use `ProjectionType.ALL` (safe default — projects everything).
3. Accept that the consumer will use sort-key prefix parsing, and document this explicitly in the consumer code.

Never use `ProjectionType.KEYS_ONLY` on a GSI whose consumers need entity discrimination unless you have confirmed that sort-key prefix parsing is intentional and tested.

### Stream routing

DynamoDB Streams delivers records with a `NEW_IMAGE` (and optionally `OLD_IMAGE`) that contains the full item (when stream view type is `NEW_IMAGE` or `NEW_AND_OLD_IMAGES`). Route stream records to the correct handler by inspecting `entity_type`:

```typescript
// In a DynamoDB Streams Lambda consumer:
for (const record of event.Records) {
  if (record.eventName === "REMOVE") continue; // handle separately if needed

  const image = record.dynamodb?.NewImage;
  if (!image) continue;

  // entity_type is a String attribute in the DynamoDB wire format.
  const entityType = image["entity_type"]?.S;

  switch (entityType) {
    case "USER":
      await handleUserChange(image);
      break;
    case "ORDER":
      await handleOrderChange(image);
      break;
    default:
      // Unknown entity type — log and continue, do not throw.
      console.warn("Unknown entity_type in stream record:", entityType);
  }
}
```

Using `entity_type` as the routing key makes the Stream consumer robust to future entity additions — add a new `case` for the new entity type rather than updating a sort-key prefix parser.

---

## Section 5: GSI design

A Global Secondary Index (GSI) provides an alternate key schema for a DynamoDB table. Queries against a GSI are always eventually consistent (`ConsistentRead` is not supported on GSIs). Up to 20 GSIs are supported per table (verify this limit in the current AWS DynamoDB service quotas before relying on it — the limit has been 20 historically and has not changed as of this writing).

### PK/SK selection for a GSI

The GSI partition key and sort key are chosen to serve exactly one unserved access pattern. The selection rules mirror those for the base table:

- **The GSI PK must have high cardinality.** A low-cardinality GSI PK concentrates items and reads on a small number of GSI partitions. GSI partitions have the same per-partition throughput limits as base-table partitions.
- **One GSI per access pattern.** Do not overload a GSI with two unrelated patterns. Overloading prevents per-pattern cost attribution, makes GSI removal impossible without breaking both patterns, and introduces cardinality problems when the two patterns' data sizes differ by an order of magnitude.
- **GSI sort key should match the ordering the pattern expects.** If the access pattern is "list orders by user, newest first," the GSI sort key should be `created_at` (ISO 8601 string or epoch integer), enabling `ScanIndexForward: false` to return the newest items first without a `Scan`.

### Projection types — concrete byte-cost walkthrough

Projection type determines which attributes are copied from the base table into the GSI. This affects GSI storage cost, GSI read cost, and GSI write cost (a base-table write that changes a GSI-projected attribute triggers a corresponding GSI write).

Assume a 1 KB item with the following approximate attribute distribution:
- PK + SK: ~100 bytes (two string attributes, ~50 bytes each)
- One additional projected attribute (`user_id`): ~50 bytes
- All remaining attributes: ~850 bytes (bringing the total to 1 KB)

| Projection type | GSI item size | Storage cost (per million items) | Read cost per Query page | Write cost per base-table write |
|---|---|---|---|---|
| `KEYS_ONLY` | ~100 bytes (base PK + SK + GSI PK + GSI SK) | ~100 MB | 0.5 RCU per 4 KB of returned data | 1 WCU for the GSI write (ceil(0.1 KB / 1 KB) = 1 WCU) |
| `INCLUDE` (+ `user_id`) | ~150 bytes (keys + 1 extra attribute) | ~150 MB | 0.5 RCU per 4 KB | 1 WCU for the GSI write (ceil(0.15 KB / 1 KB) = 1 WCU) |
| `ALL` | ~1 KB (full item) | ~1 GB | 0.5 RCU per 4 KB | 1 WCU for the GSI write (ceil(1 KB / 1 KB) = 1 WCU) |

Notes on the table:
- Storage costs are rough approximations per million items. At 1 KB items, `ALL` projection uses roughly 10× the storage of `KEYS_ONLY`. At higher WCU throughput or with items > 1 KB, this difference compounds.
- Write costs per WCU look identical at 1 KB because all three projection sizes are below the 1 KB WCU boundary. The difference appears with larger items: a 3 KB item with `ALL` projection costs 3 WCUs for the GSI write; with `KEYS_ONLY`, still 1 WCU.
- A base-table write that changes **no** GSI-projected attribute does not trigger a GSI write. `KEYS_ONLY` minimizes GSI write amplification on write-heavy tables with wide items.
- A GSI with `ALL` projection that is queried by high-frequency readers costs the same per RCU as `KEYS_ONLY` — read cost is determined by the amount of data returned, not by the projection type. The projection type matters for whether a second `GetItem` to the base table is needed to retrieve unprojected attributes.

**Decision rule:**
- Default to `ALL` for new GSIs. It avoids a second base-table fetch and is safe to downgrade later.
- Switch to `INCLUDE` when the query only needs a small, known set of attributes and the table has high write volume.
- Use `KEYS_ONLY` only when the GSI consumer never needs non-key attributes from the item (for example, a sparse index used only to check existence) and the table has very high write volume or very large items.

### Sparse indexes

A sparse GSI is a GSI whose partition key is an attribute that only some items in the base table carry. Items that lack the GSI PK attribute are not indexed in the GSI — they are simply absent. This makes sparse indexes an efficient filtering mechanism.

**Example — flagged-items index:**

Suppose a moderation system needs to query all flagged items. Most items are not flagged, so adding a GSI on `flagged` (boolean) would create a low-cardinality, two-value partition key — the anti-pattern from Section 2.

Instead, use a sparse index: only flagged items carry a `flagged_at` attribute (the timestamp when the item was flagged). Items that are not flagged do not have `flagged_at` and are not present in the GSI.

Table schema:
```
Base table:
  pk = ITEM#<itemId>    (all items)
  sk = ITEM#<itemId>    (all items)
  flagged_at = "2026-04-20T14:32:00Z"  (only flagged items)

GSI: flagged-items-index
  gsi_pk = flagged_at   (only items with flagged_at are indexed)
  gsi_sk = pk
```

A `Query` on `flagged-items-index` with `gsi_pk = "2026-04-20T14:32:00Z"` returns only items flagged at that exact timestamp. To query all items flagged after a given date, use `BETWEEN` or `>=` on the GSI sort key — but the GSI partition key must still be specified. A common pattern is to use a fixed "namespace" value as the GSI PK and the `flagged_at` timestamp as the GSI SK:

```
GSI: flagged-items-index
  gsi_pk = flagged_namespace   (always = "FLAGGED" — a constant string written only on flagged items)
  gsi_sk = flagged_at          (ISO 8601, enables range queries on flagged time)
```

Then:

```typescript
// Query all items flagged after a given date.
const result = await client.send(
  new QueryCommand({
    TableName: "content",
    IndexName: "flagged-items-index",
    KeyConditionExpression:
      "flagged_namespace = :ns AND flagged_at >= :since",
    ExpressionAttributeValues: {
      ":ns": "FLAGGED",
      ":since": "2026-04-01T00:00:00Z",
    },
    ScanIndexForward: false, // most recently flagged first
  }),
);
```

Items that have never been flagged do not carry `flagged_namespace` or `flagged_at`, so they do not appear in this GSI at all. The GSI is small and fast even if the base table is enormous.

### When to add a GSI vs overload the base table

From `00-methodology.md` §Section 5 (GSI vs key overloading vs separate table decision):

- **Add a GSI** when the unserved pattern needs a different partition attribute — the base-table PK cannot serve it with a sort-key prefix predicate.
- **Overload the base table** (use a sort-key prefix) when the pattern is a collection on the same partition key as an existing pattern, just restricted to a different entity type. No new GSI is needed.
- **Use a separate table** when the pattern belongs to a different bounded context with distinct ownership or scaling characteristics (see Section 1 of this file).

### Local Secondary Indexes (LSI)

A Local Secondary Index shares the base table's partition key and adds an alternate sort key. LSIs are mentioned for completeness; multi-table or GSI is almost always preferable.

Key LSI constraints:
- **Must be defined at table-creation time.** LSIs cannot be added to an existing table. This is the primary reason to prefer GSIs — GSIs can be added at any time.
- **Bounded by 10 GB per partition collection.** A "collection" in LSI terms is all items that share the same base-table partition key value across the base table and all its LSIs. If the collection exceeds 10 GB, DynamoDB returns an `ItemCollectionSizeLimitExceededException` on writes. There is no workaround except splitting the partition (changing the PK scheme) or removing the LSI.
- **Strong consistency available.** Unlike GSIs, LSIs support `ConsistentRead: true`. This is the only scenario where an LSI is preferable to a GSI: a collection query on the same partition that requires strong consistency. If that scenario applies, evaluate whether the 10 GB collection-size limit is acceptable for your data growth projection before choosing an LSI.
- **No additional write amplification cost beyond GSI-equivalent writes.** LSI writes are included in the base-table write; they are not billed separately.

Summary: define an LSI only if (a) the pattern requires strong consistency on a collection query on the same partition, (b) you can guarantee the collection will never exceed 10 GB, and (c) you know at table-creation time that the LSI is needed. In all other cases, use a GSI.

---

## Section 6: Adjacency list / hierarchical patterns

An adjacency list is a table design that stores multiple relationship types in the same table by using the partition key and sort key to encode entity membership and relationships. The pattern generalizes to one-to-many, many-to-many, and nested hierarchical structures.

### One-to-many

The parent entity's ID is the partition key. Each child entity has a sort key with a prefix that identifies the child type.

```
Parent (Order):  pk = ORDER#<orderId>   sk = ORDER#<orderId>
Child (Item):    pk = ORDER#<orderId>   sk = ITEM#<itemId>
Child (Note):    pk = ORDER#<orderId>   sk = NOTE#<noteId>
```

Fetching the parent and all children: one `Query` on `pk = ORDER#<orderId>` returns all items in the partition. Fetching only items: `begins_with(sk, "ITEM#")`. Fetching only notes: `begins_with(sk, "NOTE#")`.

### Many-to-many

Many-to-many relationships require a "relationship item" that can be queried from either side. The relationship item is indexed in a GSI with its partition and sort keys swapped relative to the base table.

**Pattern:** A user can belong to many groups; a group can have many members.

```
Base table:
  User-Group membership:
    pk = USER#<userId>    sk = GROUP#<groupId>    entity_type = "MEMBERSHIP"

GSI: inverse-index
  gsi_pk = sk (= GROUP#<groupId>)
  gsi_sk = pk (= USER#<userId>)
```

Query "which groups does user X belong to?"

```typescript
const result = await client.send(
  new QueryCommand({
    TableName: "social-graph",
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: {
      ":pk": "USER#usr_01HZXYZ",
      ":prefix": "GROUP#",
    },
  }),
);
```

Query "which users belong to group Y?" — uses the inverse GSI:

```typescript
const result = await client.send(
  new QueryCommand({
    TableName: "social-graph",
    IndexName: "inverse-index",
    KeyConditionExpression: "gsi_pk = :gsiPk AND begins_with(gsi_sk, :prefix)",
    ExpressionAttributeValues: {
      ":gsiPk": "GROUP#grp_ALPHA",
      ":prefix": "USER#",
    },
  }),
);
```

The same GSI serves the inverse query for any relationship type stored in the same table, as long as the base table uses `pk` and `sk` and the GSI uses `sk` and `pk` (reversed). This is the canonical adjacency-list GSI.

### Nested hierarchies

Multi-level sort-key prefixes encode nested containment:

```
pk = ORG#<orgId>    sk = ORG#<orgId>                              entity_type = "ORG"
pk = ORG#<orgId>    sk = DEPT#<deptId>                            entity_type = "DEPT"
pk = ORG#<orgId>    sk = DEPT#<deptId>#EMP#<empId>               entity_type = "EMP"
pk = ORG#<orgId>    sk = DEPT#<deptId>#EMP#<empId>#TASK#<taskId> entity_type = "TASK"
```

Traversal queries:

```typescript
// All departments in an org:
// begins_with(sk, "DEPT#")

// All employees in a department:
// begins_with(sk, "DEPT#<deptId>#EMP#")

// All tasks for an employee:
// begins_with(sk, "DEPT#<deptId>#EMP#<empId>#TASK#")
```

Each `begins_with` predicate efficiently scopes the query to the correct level of the hierarchy without Scans or filter expressions. The depth of the hierarchy is limited only by the 1,024-byte sort key size limit (verify in current DynamoDB limits — this limit has been 1,024 bytes historically).

### Worked example: social graph

Domain: users, follows (user follows user), groups, memberships (user belongs to group). Four entity types, three relationship types, two query directions each.

**Access patterns:**

| Operation | Pattern class | Key expression |
|---|---|---|
| Fetch user profile by user ID | Lookup | `GetItem pk=USER#<id> sk=USER#<id>` |
| List users that user X follows | Collection | `Query pk=USER#<userId> begins_with(sk, "FOLLOWS#")` |
| List users that follow user X (followers) | Collection (inverse) | `Query GSI: inverse-index gsi_pk=USER#<userId> begins_with(gsi_sk, "FOLLOWS#")` |
| List groups user X belongs to | Collection | `Query pk=USER#<userId> begins_with(sk, "MEMBER_OF#")` |
| List members of group Y | Collection (inverse) | `Query GSI: inverse-index gsi_pk=GROUP#<groupId> begins_with(gsi_sk, "USER#")` |
| Fetch group by group ID | Lookup | `GetItem pk=GROUP#<groupId> sk=GROUP#<groupId>` |

**Base table key schema:**

| Entity | pk | sk | entity_type | gsi_pk (for inverse-index) | gsi_sk (for inverse-index) |
|---|---|---|---|---|---|
| User (root item) | `USER#<userId>` | `USER#<userId>` | `USER` | _(not set — not in inverse GSI)_ | _(not set)_ |
| Follow relationship | `USER#<followerUserId>` | `FOLLOWS#<followedUserId>` | `FOLLOW` | `USER#<followedUserId>` | `FOLLOWS#<followerUserId>` |
| Group (root item) | `GROUP#<groupId>` | `GROUP#<groupId>` | `GROUP` | _(not set)_ | _(not set)_ |
| Membership | `USER#<userId>` | `MEMBER_OF#<groupId>` | `MEMBERSHIP` | `GROUP#<groupId>` | `USER#<userId>` |

**GSI: `inverse-index`**
- GSI PK: `gsi_pk` (populated only on relationship items — FOLLOW and MEMBERSHIP)
- GSI SK: `gsi_sk`
- Projection: `ALL` (needed for profile data in follower listings without a second fetch)

Because `gsi_pk` is only set on relationship items (FOLLOW, MEMBERSHIP) and not on root items (USER, GROUP), the `inverse-index` is a sparse index — root items are not present in it. This keeps the GSI lean and avoids mixing root items into relationship queries.

**Fetching followers of user X (uses inverse-index):**

```typescript
const result = await client.send(
  new QueryCommand({
    TableName: "social-graph",
    IndexName: "inverse-index",
    KeyConditionExpression: "gsi_pk = :gsiPk AND begins_with(gsi_sk, :prefix)",
    ExpressionAttributeValues: {
      ":gsiPk": "USER#usr_TARGET",
      ":prefix": "FOLLOWS#",
    },
    ScanIndexForward: false, // most recent followers first
  }),
);

// Each result item is a FOLLOW entity_type item with entity_type = "FOLLOW".
// The gsi_sk value "FOLLOWS#<followerUserId>" gives us the follower's user ID.
```

**Verification — `describe-table` output for the social-graph table:**

```bash
aws dynamodb describe-table --table-name social-graph --profile <your-profile>
```

Expected excerpt:

```json
{
  "Table": {
    "TableName": "social-graph",
    "KeySchema": [
      { "AttributeName": "pk", "KeyType": "HASH" },
      { "AttributeName": "sk", "KeyType": "RANGE" }
    ],
    "GlobalSecondaryIndexes": [
      {
        "IndexName": "inverse-index",
        "KeySchema": [
          { "AttributeName": "gsi_pk", "KeyType": "HASH" },
          { "AttributeName": "gsi_sk", "KeyType": "RANGE" }
        ],
        "Projection": { "ProjectionType": "ALL" },
        "IndexStatus": "ACTIVE"
      }
    ],
    "BillingModeSummary": { "BillingMode": "PAY_PER_REQUEST" },
    "StreamSpecification": {
      "StreamEnabled": true,
      "StreamViewType": "NEW_AND_OLD_IMAGES"
    }
  }
}
```

`IndexStatus: ACTIVE` confirms the GSI finished backfilling and is serving queries. During backfill (status `CREATING` or `BACKFILLING`), queries against the GSI may return incomplete results — guard against this in the application layer or deployment runbook.

---

## Section 7: Cross-references

### Atomic uniqueness constraints

Ensuring that an attribute value (email, phone number, referral code, username) is globally unique across a DynamoDB table requires a dedicated lookup table and `TransactWriteCommand` with `attribute_not_exists`. The GSI-query-then-write pattern is not atomic and contains a race condition. The canonical pattern with full TypeScript implementation is in `../../aws-cdk-patterns/references/04-database.md` §4.

Never use `pk = email` (raw email as partition key) to enforce uniqueness — this leaks PII into the key space (see Section 2 of this file) and still does not prevent a race condition without `attribute_not_exists`. The correct pattern uses a system-generated UUID as the user's primary PK and a separate lookup table whose partition key is the email hash or the email plaintext with `attribute_not_exists(email)` on every write.

### CDK provisioning

The CDK `Table` construct that provisions the table with billing mode, PITR, TTL, encryption, and GSI definitions is documented in `../../aws-cdk-patterns/references/04-database.md` §3. The key names (`pk`, `sk`, `gsi_pk`, `gsi_sk`) in this file match the naming conventions used in that construct; the two files are designed to be read together.

---

## Section 8: Verification

Run `describe-table` against a deployed table to confirm the key schema, GSI definitions, and stream settings match the design:

```bash
aws dynamodb describe-table \
  --table-name <your-table-name> \
  --profile <your-aws-profile>
```

Fields to verify:

| Field | Expected value | What it confirms |
|---|---|---|
| `KeySchema[0].KeyType` | `HASH` | Partition key is set |
| `KeySchema[1].KeyType` | `RANGE` | Sort key is set (or absent if no SK) |
| `GlobalSecondaryIndexes[*].IndexName` | Each GSI by its design name | GSI exists |
| `GlobalSecondaryIndexes[*].IndexStatus` | `ACTIVE` | GSI is serving queries (not backfilling) |
| `GlobalSecondaryIndexes[*].Projection.ProjectionType` | `ALL` / `INCLUDE` / `KEYS_ONLY` | Projection matches the design decision |
| `StreamSpecification.StreamEnabled` | `true` if Streams are enabled | Change-data capture is active |
| `StreamSpecification.StreamViewType` | `NEW_AND_OLD_IMAGES` or as designed | Streams deliver the expected image type |
| `TimeToLiveDescription.TimeToLiveStatus` | `ENABLED` | TTL is active (check separately via `describe-time-to-live`) |

Check TTL separately:

```bash
aws dynamodb describe-time-to-live \
  --table-name <your-table-name> \
  --profile <your-aws-profile>
```

Expected when TTL is enabled:

```json
{
  "TimeToLiveDescription": {
    "TimeToLiveStatus": "ENABLED",
    "AttributeName": "expires_at"
  }
}
```

If `TimeToLiveStatus` is `DISABLED`, TTL is not active even if the CDK stack specifies `timeToLiveAttribute`. Verify the CDK stack deployed successfully and the attribute name matches the items being written.

---

## Section 9: Further reading

- `00-methodology.md` — the six-step design process that produced the key shapes documented here. Start here before this file if you are designing from scratch.
- `02-scaling.md` — hot-partition mitigation when the partition key design hits a cardinality or traffic-skew problem: write sharding, calendar-based sharding, Contributor Insights detection, item-size cost modeling.
- `../../aws-cdk-patterns/references/04-database.md` §3 — CDK `Table` construct with billing mode, PITR, TTL, encryption, and GSI definitions.
- `../../aws-cdk-patterns/references/04-database.md` §4 — atomic uniqueness pattern with `TransactWriteCommand` and a dedicated lookup table. Full TypeScript implementation.
- [Amazon DynamoDB Developer Guide — Best Practices for Designing Sort Keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html) — AWS's authoritative guidance on sort key patterns, composite key design, and hierarchical data.
- [Amazon DynamoDB Developer Guide — Reserved Words](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html) — full list of reserved words that require `ExpressionAttributeNames` aliasing.
- [Amazon DynamoDB Developer Guide — Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) — GSI limits, backfill behavior, and projection type semantics.
