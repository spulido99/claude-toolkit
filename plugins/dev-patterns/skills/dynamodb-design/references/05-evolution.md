# Evolution

**Builds:** Schema versioning across concurrent readers and writers, zero-downtime GSI addition and removal, attribute renaming via dual-write, and table topology migration (single-table split, multi-table consolidation) with shadow-read validation.
**When to use:** When an existing DynamoDB table must change shape — attribute names, types, or structure; GSI additions or removals; or layout migrations between single-table and multi-table designs — without coordinated downtime.
**Prerequisites:** `00-methodology.md` — the six-step design process and constraint vocabulary. `01-modeling.md` — entity shapes, key patterns, and GSI design.

---

## Contents

1. **Schema versioning** — per-item `schema_version` attribute, when to bump, and a reader handling v1/v2 user profiles.
2. **Adding a GSI to a live table** — AWS-managed backfill, cost during backfill, handler safety, `waitForGsiActive` polling helper, and CloudWatch monitoring.
3. **Removing a GSI** — deprecation workflow, silent-failure risk, and CloudWatch Insights usage check.
4. **Renaming an attribute** — three-phase dual-write, migration script with parallel Scan segments and bounded concurrency.
5. **Splitting a table (single → multi)** — eight-phase migration with shadow-read validation and a full TS shadow-read wrapper.
6. **Consolidating tables (multi → single)** — inverse split, sort-key prefix scheme, and re-keying considerations.
7. **Cutover strategies** — dual-write with feature flag, shadow reads, percentage-based rollout, and rollback criteria.
8. **Gotchas** — evolution-specific failure modes.
9. **Verification** — CLI commands for GSI status, item count, and exact count validation.
10. **Further reading** — related references and AWS docs.

---

## Section 1: Schema versioning

### Pattern

Every item carries a `schema_version: number` attribute set by the writer at the time of the write. Writers always tag new items with the current version. Readers are backward-compatible: they inspect `schema_version` and apply migration logic in the application layer before returning the domain object.

### When to bump the version

**Bump `schema_version`** on breaking changes:

- Renaming an attribute (`full_name` → `first_name` + `last_name`).
- Changing an attribute's type (string → number, string → string set).
- Changing an attribute from required to optional or vice versa when readers depend on it being present.

**Do not bump** for additive, non-breaking changes:

- Adding a new optional attribute that readers can tolerate being absent.
- Adding a new GSI key attribute (readers that do not use the GSI are unaffected).

Every version in the wild costs maintenance: readers must handle all historic versions concurrently until every item is migrated. Bump only when the change is genuinely breaking.

### Example: v1 → v2 user profile split

In v1 the user item carries a single `full_name` string. In v2 `full_name` is replaced by `first_name` and `last_name`.

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const rawClient = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(rawClient);

const USERS_TABLE = process.env.USERS_TABLE!;

// Current schema version writers must tag.
const CURRENT_SCHEMA_VERSION = 2;

// Canonical domain type — always v2 shape after normalization.
interface UserProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  schemaVersion: number;
}

// Raw DynamoDB shapes for each version.
interface UserItemV1 {
  pk: string;
  sk: string;
  schema_version: 1;
  email: string;
  full_name: string; // "Jane Doe"
}

interface UserItemV2 {
  pk: string;
  sk: string;
  schema_version: 2;
  email: string;
  first_name: string;
  last_name: string;
}

type RawUserItem = UserItemV1 | UserItemV2;

/**
 * Reads a user from DynamoDB and normalizes any schema version to the
 * current v2 domain shape. Returns null if the item does not exist.
 */
async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const result = await client.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { pk: `USER#${userId}`, sk: `USER#${userId}` },
    }),
  );

  if (!result.Item) return null;

  const raw = result.Item as RawUserItem;
  return normalizeUserItem(raw);
}

/**
 * Converts any raw item version to the canonical UserProfile shape.
 * Extend this function for each new version; never remove a branch
 * until every item in the table has been migrated past that version.
 */
function normalizeUserItem(raw: RawUserItem): UserProfile {
  const userId = raw.pk.replace("USER#", "");

  switch (raw.schema_version) {
    case 1: {
      // Split "Jane Doe" on the first space. Names with no space get an
      // empty lastName; multi-word last names ("Van Den Berg") are handled
      // by the migration script in Section 4 using a domain-specific rule.
      const spaceIdx = raw.full_name.indexOf(" ");
      const firstName =
        spaceIdx === -1 ? raw.full_name : raw.full_name.slice(0, spaceIdx);
      const lastName = spaceIdx === -1 ? "" : raw.full_name.slice(spaceIdx + 1);
      return {
        userId,
        email: raw.email,
        firstName,
        lastName,
        schemaVersion: raw.schema_version,
      };
    }
    case 2:
      return {
        userId,
        email: raw.email,
        firstName: raw.first_name,
        lastName: raw.last_name,
        schemaVersion: raw.schema_version,
      };
    default: {
      // Unknown future version — fail loudly rather than silently returning
      // a corrupt object. The reader needs a code deploy before it can
      // handle a schema version it has never seen.
      const exhaustiveCheck: never = raw;
      throw new Error(
        `Unknown schema_version on item ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

/**
 * Write helper — always tags the current schema version.
 * Writers never write v1 items; only readers need to handle them.
 */
function buildUserItemV2(
  userId: string,
  email: string,
  firstName: string,
  lastName: string,
): UserItemV2 {
  return {
    pk: `USER#${userId}`,
    sk: `USER#${userId}`,
    schema_version: CURRENT_SCHEMA_VERSION,
    email,
    first_name: firstName,
    last_name: lastName,
  };
}
```

---

## Section 2: Adding a GSI to a live table

### AWS-managed backfill

When you add a GSI via CDK (`table.addGlobalSecondaryIndex(...)`) and deploy, DynamoDB starts a backfill automatically. The table stays fully available for reads and writes throughout. There is no application-level work to trigger or manage the backfill.

GSI addition phases (all managed by DynamoDB):

1. `IndexStatus: CREATING` — DynamoDB begins backfilling existing items into the new GSI.
2. `IndexStatus: ACTIVE` — Backfill is complete. The GSI is fully queryable.

### Cost during backfill

- **Reads:** DynamoDB reads the base table to populate the GSI. These reads are free — they do not consume your provisioned or on-demand read capacity.
- **Writes:** Every write to the base table during backfill also updates the new GSI. On PAY_PER_REQUEST tables this means each write costs 2× WRUs until `IndexStatus: ACTIVE`. On PROVISIONED tables each write consumes 2× WCU from the table's provisioned throughput. Provision generously during backfill for high-write tables.

### Handler-level safety

Do not query the new GSI until it is `ACTIVE`. Querying a `CREATING` GSI throws a `ResourceNotFoundException`. Even after the index appears in `DescribeTable`, results may be incomplete while backfill is in progress. Gate all code paths that use the new GSI behind an `IndexStatus` check or a deployment sequencing rule: deploy the CDK change, wait for `ACTIVE`, then deploy the application code that queries the new GSI.

### `waitForGsiActive` polling helper

```typescript
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";

const rawClient = new DynamoDBClient({});

/**
 * Polls DescribeTable until the named GSI reaches IndexStatus "ACTIVE".
 * Throws if the GSI is not found or if the timeout is exceeded.
 *
 * @param tableName  - DynamoDB table name.
 * @param indexName  - GSI name to wait for.
 * @param options    - Poll interval and hard timeout (both in ms).
 */
async function waitForGsiActive(
  tableName: string,
  indexName: string,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const { pollIntervalMs = 10_000, timeoutMs = 20 * 60 * 1000 } = options;
  const deadline = Date.now() + timeoutMs;

  console.log(`Waiting for GSI "${indexName}" on table "${tableName}" to become ACTIVE...`);

  while (Date.now() < deadline) {
    const result = await rawClient.send(
      new DescribeTableCommand({ TableName: tableName }),
    );

    const gsi = result.Table?.GlobalSecondaryIndexes?.find(
      (g) => g.IndexName === indexName,
    );

    if (!gsi) {
      throw new Error(
        `GSI "${indexName}" not found on table "${tableName}". ` +
          `Verify the CDK deployment completed successfully.`,
      );
    }

    const status = gsi.IndexStatus;
    console.log(
      `  ${new Date().toISOString()} — IndexStatus: ${status}` +
        (gsi.Backfilling ? " (backfilling)" : ""),
    );

    if (status === "ACTIVE") {
      console.log(`GSI "${indexName}" is ACTIVE.`);
      return;
    }

    if (status === "DELETING") {
      throw new Error(
        `GSI "${indexName}" is DELETING, not being created. Check your CDK diff.`,
      );
    }

    // CREATING or UPDATING — keep polling.
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for GSI "${indexName}" to become ACTIVE.`,
  );
}

// Usage in a deploy script:
// await waitForGsiActive("users-prod", "email-index", { timeoutMs: 30 * 60 * 1000 });
```

### Monitor during backfill

Watch the CloudWatch metric `OnlineIndexThrottleEvents` (namespace `AWS/DynamoDB`, dimension `TableName`) during the backfill window. If it climbs above zero, DynamoDB is throttling the backfill because write throughput is being consumed faster than the provisioned capacity allows. For PAY_PER_REQUEST tables this is rare; for PROVISIONED tables, increase WCU before adding the GSI and decrease it afterward.

---

## Section 3: Removing a GSI

### The risk

Any code path that queries the removed GSI after the CDK deployment that deletes it throws a `ResourceNotFoundException`. This is a hard failure — not a data-quality issue — and it surfaces to end users if the error is not caught. Deprecate before removing.

### Deprecation workflow

Execute each step in order. Do not skip steps.

1. **Mark the data-access function deprecated.**
   Add a `@deprecated` JSDoc comment to every function that queries the GSI being removed. Include the removal date and the migration path:

   ```typescript
   /**
    * @deprecated Use `listOrdersByUserId` (queries the `user-orders-index` GSI) instead.
    * The `legacy-user-index` GSI will be removed in the 2024-Q3 deploy.
    */
   async function listOrdersByUserLegacy(userId: string): Promise<Order[]> { ... }
   ```

2. **Audit all callers.**
   Run a codebase-wide search for the GSI name and the deprecated function name. In most TypeScript codebases:

   ```bash
   grep -r "legacy-user-index" src/
   grep -r "listOrdersByUserLegacy" src/
   ```

   Address every hit. A zero-hit grep is the gate for the next step.

3. **Remove the callers and the data-access function.**
   Delete all callers, the deprecated function, and any GSI-specific types. Deploy this application change first. Confirm the deploy is healthy in production.

4. **Remove the GSI from CDK.**
   Delete the `addGlobalSecondaryIndex` call from the CDK construct. Deploy the CDK change. DynamoDB transitions the GSI to `IndexStatus: DELETING` and removes it asynchronously — this is also managed with no downtime.

5. **Verify removal.**

   ```bash
   aws dynamodb describe-table \
     --table-name <table-name> \
     --query 'Table.GlobalSecondaryIndexes[*].IndexName'
   ```

   The removed GSI name must not appear in the output.

6. **Delete the `@deprecated` marker** from version control once the GSI is gone and the deployment is stable.

### Check usage before removal

If you are uncertain whether a GSI is actively used, enable CloudWatch metric logging for the GSI's `ConsumedReadCapacityUnits` (dimension: `TableName` + `GlobalSecondaryIndexName`). Monitor for at least two weeks, covering weekly traffic cycles. Any non-zero value means the GSI is still in use — do not remove it.

### Silent-failure note on Scan vs Query

When a `Query` targets a deleted GSI, DynamoDB throws and the failure is visible. The real risk is a `Scan` that was written as a "fallback" against the GSI: if someone silently swaps a `Query` for a `Scan` during a refactor, the missing GSI error disappears and the code continues working — just with a full-table scan instead of an index query. Flag any `Scan`-based access pattern change in PR review and verify the intent.

---

## Section 4: Renaming an attribute

Renaming an attribute in a live table without downtime requires three phases. Complete each phase fully before starting the next.

### Phase 1 — Dual-write (old and new names simultaneously)

Deploy application code that writes **both** the old attribute name and the new attribute name on every write. Readers still read from the old name. No data migration yet.

```typescript
// Writers during Phase 1: set both attributes.
await client.send(
  new PutCommand({
    TableName: USERS_TABLE,
    Item: {
      pk: `USER#${userId}`,
      sk: `USER#${userId}`,
      // Old name — readers still depend on this.
      full_name: `${firstName} ${lastName}`,
      // New names — written now so migrated items are immediately readable
      // by Phase 3 readers.
      first_name: firstName,
      last_name: lastName,
    },
  }),
);
```

### Phase 2 — Backfill via migration script

Run a one-shot migration script that pages through every item in the table and writes the new-name attribute from the old-name attribute. Items already updated by Phase 1 writers are re-written harmlessly. After this phase, every item in the table has both the old and new attribute names.

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const rawClient = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(rawClient);

const TABLE_NAME = process.env.USERS_TABLE!;

// Parallel scan configuration.
// Choose TOTAL_SEGMENTS based on table size: 1 segment per ~10 GB of data,
// minimum 4 for parallelism benefit. Do not exceed 1,000,000.
const TOTAL_SEGMENTS = 8;

// Concurrent UpdateItem calls per segment. Keep low on PAY_PER_REQUEST
// tables to avoid WRU cost spikes. Raise on PROVISIONED tables with headroom.
const CONCURRENCY_PER_SEGMENT = 10;

// Throttle between pages on PAY_PER_REQUEST to avoid cost spikes.
const PAGE_DELAY_MS = 50;

interface ProgressState {
  segment: number;
  itemsProcessed: number;
  itemsSkipped: number; // Items already having the new attribute.
}

async function migrateSegment(segment: number): Promise<ProgressState> {
  const state: ProgressState = {
    segment,
    itemsProcessed: 0,
    itemsSkipped: 0,
  };

  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        // Parallel segment parameters — must be set together.
        TotalSegments: TOTAL_SEGMENTS,
        Segment: segment,
        // Only fetch attributes needed for the migration.
        ProjectionExpression: "pk, sk, full_name, first_name, last_name",
        // Throttle page size to reduce WRU bursts on PAY_PER_REQUEST.
        Limit: 100,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = page.Items ?? [];
    lastEvaluatedKey = page.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;

    // Process up to CONCURRENCY_PER_SEGMENT items at a time.
    for (let i = 0; i < items.length; i += CONCURRENCY_PER_SEGMENT) {
      const batch = items.slice(i, i + CONCURRENCY_PER_SEGMENT);

      await Promise.all(
        batch.map(async (item) => {
          // Skip items that already have both new attributes set.
          if (item.first_name !== undefined && item.last_name !== undefined) {
            state.itemsSkipped++;
            return;
          }

          const fullName = item.full_name as string | undefined;
          if (!fullName) {
            // Item has neither old nor new attributes — skip with a warning.
            console.warn(`Item ${item.pk}/${item.sk} has no full_name; skipping.`);
            state.itemsSkipped++;
            return;
          }

          const spaceIdx = fullName.indexOf(" ");
          const firstName =
            spaceIdx === -1 ? fullName : fullName.slice(0, spaceIdx);
          const lastName =
            spaceIdx === -1 ? "" : fullName.slice(spaceIdx + 1);

          // UpdateItem — only adds/updates the new attributes; does not
          // remove the old attribute yet (that happens in Phase 3).
          // NOTE: if the partition key itself changes during a migration,
          // use PutCommand + DeleteCommand instead. UpdateItem silently
          // creates a new item when given a key that does not exist.
          await client.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { pk: item.pk, sk: item.sk },
              UpdateExpression:
                "SET first_name = :fn, last_name = :ln",
              ExpressionAttributeValues: {
                ":fn": firstName,
                ":ln": lastName,
              },
              // Idempotent: safe to retry if the script is interrupted.
              ConditionExpression: "attribute_exists(pk)",
            }),
          );

          state.itemsProcessed++;
        }),
      );
    }

    console.log(
      `Segment ${segment}: processed=${state.itemsProcessed} ` +
        `skipped=${state.itemsSkipped} ` +
        `lastKey=${lastEvaluatedKey ? "present" : "none"}`,
    );

    // Brief pause between pages to avoid a sustained WRU spike.
    if (lastEvaluatedKey) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
  } while (lastEvaluatedKey);

  return state;
}

async function runMigration(): Promise<void> {
  console.log(
    `Starting parallel migration: table=${TABLE_NAME} segments=${TOTAL_SEGMENTS}`,
  );
  const start = Date.now();

  // Fan out all segments in parallel.
  const results = await Promise.all(
    Array.from({ length: TOTAL_SEGMENTS }, (_, i) => migrateSegment(i)),
  );

  const totalProcessed = results.reduce((s, r) => s + r.itemsProcessed, 0);
  const totalSkipped = results.reduce((s, r) => s + r.itemsSkipped, 0);
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `Migration complete: processed=${totalProcessed} skipped=${totalSkipped} ` +
      `elapsed=${elapsedSec}s`,
  );
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

### Phase 3 — Flip readers, stop dual-writing, delete old attribute

Execute in sub-steps, one deploy each:

1. **Flip readers** to read from `first_name` and `last_name` only. Deploy and monitor for errors.
2. **Stop dual-writing**: remove the `full_name` write from the writer. Deploy and monitor.
3. **Delete the old attribute**: add a one-shot script that runs `UpdateCommand` with `REMOVE full_name` on every item (same parallel-segment pattern as Phase 2). Run after Phase 2's writers have stopped.

After Phase 3 is complete, items in the table carry only the new attribute names.

---

## Section 5: Splitting a table (single → multi)

Splitting a single-table layout into per-entity tables is an eight-phase migration. Each phase must be fully deployed and stable before advancing.

### Context

A single-table design uses sort-key prefixes to distinguish entity types, for example `USER#<id>` and `ORDER#<id>` under the same partition key. The migration moves these into dedicated `users` and `orders` tables.

### Phases

**Phase 1 — Provision new tables.**
Create the per-entity tables in CDK and deploy. Do not write to them yet. Ensure PITR is enabled on the new tables from day one.

**Phase 2 — Dual-write.**
Deploy application code that writes to both the old single-table and the new per-entity tables on every mutation. Both stores must receive every write. Any write error to either store must fail-fast — do not swallow errors. Divergence during dual-write is the primary failure mode.

**Phase 3 — Backfill existing items.**
Run a parallel-segment scan of the single table (same script shape as Section 4's migration). For each item, write to the appropriate new table based on the sort-key prefix. Skip items that already exist in the new table (use `attribute_not_exists(pk)` conditions to avoid overwriting dual-write traffic).

**Phase 4 — Shadow-read validation.**
Deploy the shadow-read wrapper (see example below). For every read, fan out to both stores, return the old store's result to the caller, and log any mismatches to CloudWatch. This is the non-negotiable safety net — it catches subtle mismatches (missing items, divergent attributes) before clients observe them.

**Phase 5 — Flip readers.**
Deploy application code that reads from the new per-entity tables. The shadow-read wrapper can be removed at this point or kept for an additional cool-down window. Monitor error rates and latency immediately after flip.

**Phase 6 — Monitor cool-down.**
Run both stores in read mode (new store primary, old store shadow) for at least 72 hours or one full weekly traffic cycle. Alarm on any mismatch rate > 0 sustained for more than 5 minutes.

**Phase 7 — Stop dual-writing.**
Deploy application code that writes only to the new per-entity tables. Remove the old-table write path.

**Phase 8 — Delete the old table.**
After the cool-down passes with zero mismatches, delete the single table via CDK. Confirm via `aws dynamodb describe-table` that the table no longer exists.

### Shadow-read wrapper (TypeScript)

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

const rawClient = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(rawClient);
const cwClient = new CloudWatchClient({});

const CW_NAMESPACE = "TableMigration";

/**
 * Logs a mismatch count to CloudWatch as a custom metric.
 * An alarm on MismatchCount > 0 for 5 consecutive minutes triggers rollback.
 */
async function logMismatch(
  metricName: string,
  count: number,
): Promise<void> {
  await cwClient.send(
    new PutMetricDataCommand({
      Namespace: CW_NAMESPACE,
      MetricData: [
        {
          MetricName: metricName,
          Value: count,
          Unit: "Count",
          Timestamp: new Date(),
        },
      ],
    }),
  );
}

/**
 * Compares two DynamoDB items for deep equality.
 * Ignores attributes that only exist in the old table (e.g., legacy sk prefixes).
 * Extend this function with domain-specific normalization as needed.
 */
function itemsMatch(
  oldItem: Record<string, unknown> | undefined,
  newItem: Record<string, unknown> | undefined,
  ignoreKeys: string[] = [],
): boolean {
  if (oldItem === undefined && newItem === undefined) return true;
  if (oldItem === undefined || newItem === undefined) return false;

  const oldFiltered = Object.fromEntries(
    Object.entries(oldItem).filter(([k]) => !ignoreKeys.includes(k)),
  );
  const newFiltered = Object.fromEntries(
    Object.entries(newItem).filter(([k]) => !ignoreKeys.includes(k)),
  );

  return JSON.stringify(oldFiltered) === JSON.stringify(newFiltered);
}

/**
 * Shadow-read wrapper for user profile reads during the migration.
 *
 * Fans out to both the old single-table and the new users table.
 * Returns the old table's result (source of truth during Phase 4).
 * Logs mismatches to CloudWatch as MismatchCount.
 *
 * @param userId - The user ID to fetch.
 */
async function getUserShadowRead(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const key = { pk: `USER#${userId}`, sk: `USER#${userId}` };

  // Fan out reads to both stores in parallel. Neither failure blocks the other.
  const [oldResult, newResult] = await Promise.allSettled([
    client.send(
      new GetCommand({
        TableName: process.env.OLD_SINGLE_TABLE!,
        Key: key,
      }),
    ),
    client.send(
      new GetCommand({
        TableName: process.env.NEW_USERS_TABLE!,
        Key: key,
      }),
    ),
  ]);

  // Extract items, treating read errors as undefined (logged separately).
  const oldItem =
    oldResult.status === "fulfilled" ? oldResult.value.Item : undefined;
  const newItem =
    newResult.status === "fulfilled" ? newResult.value.Item : undefined;

  // Log errors from either store.
  if (oldResult.status === "rejected") {
    console.error("Old-table read error:", oldResult.reason);
  }
  if (newResult.status === "rejected") {
    console.error("New-table read error:", newResult.reason);
  }

  // Compare items, ignoring the sort-key prefix that exists only in the old table.
  const match = itemsMatch(
    oldItem as Record<string, unknown> | undefined,
    newItem as Record<string, unknown> | undefined,
    ["sk"], // Old table uses sk = "USER#<id>"; new table may use a different sk.
  );

  if (!match) {
    const detail = {
      userId,
      oldItem: oldItem ?? null,
      newItem: newItem ?? null,
    };
    console.error("Shadow-read mismatch:", JSON.stringify(detail));
    // Metric triggers rollback alarm if sustained.
    await logMismatch("UserMismatchCount", 1).catch((err) =>
      console.error("CloudWatch metric write failed:", err),
    );
  }

  // Always return the old store's result — it is the source of truth
  // until Phase 5 (reader flip).
  return (oldItem as Record<string, unknown> | null) ?? null;
}
```

---

## Section 6: Consolidating tables (multi → single)

Consolidation is the inverse of splitting: multiple per-entity tables are merged into a single table. The same eight phases apply in reverse order of concern, but with an additional design constraint.

### Key design constraint

Before starting Phase 1, finalize the sort-key prefix scheme for all entity types in the combined table. Every entity must fit the scheme and the scheme must accommodate future entity types without collision. Common patterns:

| Entity | pk | sk |
|---|---|---|
| User | `USER#<userId>` | `USER#<userId>` |
| Order | `USER#<userId>` | `ORDER#<orderId>` |
| Product | `PRODUCT#<productId>` | `PRODUCT#<productId>` |
| Inventory | `PRODUCT#<productId>` | `INVENTORY#<warehouseId>` |

Avoid using a bare primary key (no prefix) for any entity type — it prevents adding a second entity type that shares the same partition key in the future.

### Re-keying

If entities in the source tables use different key structures (for example, one table uses `user_id` as the partition key and another uses `order_id`), the new single table must map both to the composite key scheme. This mapping is the hardest part:

- Document the mapping before writing any migration code.
- Test the mapping against a sample of production data in a staging table.
- The backfill script (Phase 3) performs the re-keying by constructing the new `pk`/`sk` from the source attributes.

### Phase differences from splitting

- Phase 2 (dual-write): writes go to both the per-entity tables and the new single table.
- Phase 3 (backfill): the scan is run per source table; the output is the single consolidated table.
- Phase 4 (shadow-read): reads fan out to both the source per-entity table and the new single table.
- Phases 5–8 are identical to the split migration.

---

## Section 7: Cutover strategies

Use one or more of these strategies for every migration phase transition. They are composable — shadow reads are commonly used alongside percentage-based rollout.

### Dual-write with feature flag

A feature flag (environment variable, SSM parameter, or LaunchDarkly toggle) controls which store is the source of truth for reads. Writers always write to both stores simultaneously. The flag only controls which store is read.

```
Flag = OLD  → reads from old store, writes to both.
Flag = NEW  → reads from new store, writes to both.
```

Rollback: flip the flag back to `OLD`. No code deploy needed. Writes during the rollback window are safe because both stores have been receiving all writes continuously.

### Shadow reads

Described in full in Section 5. During the validation phase, every read fans out to both stores. The primary store's result is returned; mismatches are logged. Shadow reads run alongside dual-write — they are a read-path concern only.

### Percentage-based rollout

Route a percentage of reads to the new store. Start at 1% and ramp up as the mismatch rate (from shadow reads or error logs) stays at zero.

Ramp schedule:

| Step | Percentage | Hold duration |
|---|---|---|
| 1 | 1% | 1 hour, zero mismatches |
| 2 | 10% | 4 hours, zero mismatches |
| 3 | 50% | 24 hours, zero mismatches |
| 4 | 100% | 72 hours, zero mismatches |

At any step, a sustained mismatch rate > 0 for > 5 minutes triggers a rollback to the previous percentage.

Implementation: hash the request's partition key with a stable hash (for example, `crc32(userId) % 100`) and compare to the threshold. This ensures a given user is always served by the same store during a given step, which avoids read-your-writes anomalies during the ramp.

### Rollback criteria

Rollback is triggered by **any** of the following conditions sustained for more than 5 consecutive minutes:

- Shadow-read mismatch rate > 0 (any mismatch in any 5-minute window).
- Error rate on new-store reads > 0.1% of requests.
- P99 latency on new-store reads exceeds old-store P99 by more than 50ms.

These are hard numeric thresholds. Do not use subjective criteria ("seems high", "feels off"). Set CloudWatch alarms on all three metrics before starting the cutover and configure rollback runbooks that reference the alarm ARNs.

---

## Section 8: Gotchas

| Symptom | Root cause | Fix |
|---|---|---|
| Readers fail on an item with an unexpected schema version. | A future writer tagged a version the current reader code has not seen. | The `normalizeUserItem` default branch throws explicitly. Add the new `schema_version` branch to the reader and deploy before bumping the version in writers. Always deploy readers before writers on a schema bump. |
| Migration script spikes cost on PAY_PER_REQUEST table. | Full-table `ScanCommand` without `Limit` consumes all WRUs in bursts. | Add `Limit: 100` to every scan page. Add `PAGE_DELAY_MS` between pages. For very large tables, temporarily switch to `PROVISIONED` billing with a fixed capacity ceiling during the migration window, then switch back. |
| Dual-write divergence: one store has the write, the other does not. | One of the two writes in the dual-write path failed and the error was swallowed. | Fail-fast on any write error during dual-write. Do not catch and continue — either retry both writes (idempotent) or fail the entire request. Never log-and-continue on a partial dual-write failure. |
| `UpdateItem` creates a spurious new item during migration. | The partition key changed as part of the migration. `UpdateItem` with a new key creates a new item instead of updating an existing one; there is no error. | When the partition key changes, use `PutCommand` for the new item and `DeleteCommand` for the old item. Never use `UpdateCommand` to move an item to a new key. |
| Schema-version history accumulates maintenance debt. | Every bumped version requires a reader branch in perpetuity until all items are migrated. | Run the backfill script (Phase 2 of Section 4) promptly after every schema bump. Once all items are at the current version, remove old reader branches behind a guard that fails loudly on unknown versions. |
| GSI query fails during the backfill window. | Code deployed that queries the new GSI before `IndexStatus: ACTIVE`. | Use `waitForGsiActive` before deploying code that queries the new GSI. Sequence the deploy: CDK deploy → wait for ACTIVE → application deploy. |
| Shadow-read comparison false-positives on floating-point attributes. | `JSON.stringify` of `0.1 + 0.2` differs between the two stores due to precision. | Normalize numeric attributes before comparison in `itemsMatch`. Round to a fixed precision or use a domain-specific equality function. |

---

## Section 9: Verification

### Confirm all GSIs are ACTIVE

```bash
aws dynamodb describe-table \
  --table-name <table-name> \
  --query 'Table.GlobalSecondaryIndexes[*].{Name:IndexName,Status:IndexStatus}' \
  --output table
```

All rows must show `Status: ACTIVE`. Any `CREATING` or `UPDATING` status means the index is not yet ready for query traffic.

### Sanity-check item count after migration (approximate)

```bash
aws dynamodb describe-table \
  --table-name <table-name> \
  --query 'Table.ItemCount'
```

`ItemCount` is updated every 6 hours. Use it as a rough sanity check — expected order of magnitude — not as an exact post-migration count.

### Exact count for cutover validation (expensive — use once)

```bash
aws dynamodb scan \
  --table-name <table-name> \
  --select COUNT \
  --query 'Count'
```

`scan --select COUNT` reads every item in the table and returns the exact count. On large tables this consumes significant RCUs and takes minutes. Run this exactly once at the cutover gate to confirm the new table's item count matches the old table's item count within an acceptable delta (for example, ±1% to account for in-flight writes during the comparison window).

### Verify GSI removal

```bash
aws dynamodb describe-table \
  --table-name <table-name> \
  --query 'Table.GlobalSecondaryIndexes[*].IndexName'
```

After removing a GSI from CDK and deploying, this query must not return the removed index name. An empty array `[]` is correct when all GSIs have been removed.

### Confirm TTL is still enabled after migration

```bash
aws dynamodb describe-time-to-live \
  --table-name <table-name>
```

Look for `TimeToLiveStatus: ENABLED`. TTL configuration is table-level and is not affected by GSI changes, but confirm after any CDK table modification to rule out accidental removal.

---

## Section 10: Further reading

- `00-methodology.md` — the six-step design process; access pattern changes often trigger schema evolution.
- `01-modeling.md` — entity shapes and GSI design; the source of truth for key scheme decisions.
- `02-scaling.md` — cost and throughput implications of dual-write and full-table scans during migration windows.
- `../../aws-cdk-patterns/references/04-database.md` §3 — CDK `Table` construct with GSI definition; used in Phase 1 of every migration.
- [AWS DynamoDB — Adding a global secondary index to an existing table](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.OnlineOps.html)
- [AWS DynamoDB — Best practices for managing many-to-many relationships](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-adjacency-graphs.html)
- [AWS DynamoDB — Working with scans](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html) — parallel scan segment documentation.
- [AWS DynamoDB — Point-in-time recovery](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html) — enable PITR on the new table before starting any migration; it is the last-resort rollback for data corruption.
