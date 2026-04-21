# Write Correctness

**Builds:** Safe concurrent writes in DynamoDB — optimistic locking with bounded retries, atomic and sharded counters, batch operations that never silently drop items, and multi-item transactions beyond simple uniqueness enforcement.
**When to use:** Before writing any handler that modifies DynamoDB items under concurrent load, implements a counter, uses `BatchWriteCommand`, or needs all-or-nothing semantics across multiple items or tables.
**Prerequisites:** `00-methodology.md` — the six-step design process and constraint vocabulary that ground every decision in this file.

---

## Contents

1. **Optimistic locking** — version-stamped writes with bounded retry and exponential backoff.
2. **Atomic counters** — `ADD` expression for low-contention increment/decrement.
3. **Sharded counters** — spreading hot counters across N shards to stay below per-partition WPS limits.
4. **Batch operations** — `BatchGetCommand` and `BatchWriteCommand` with `UnprocessedKeys`/`UnprocessedItems` retry loops.
5. **`TransactWriteCommand` beyond uniqueness** — multi-item atomic updates, cross-table writes, conditional batch writes, and a money-transfer example.
6. **Cross-references (runtime patterns in CDK skill)** — atomic uniqueness, identity-verified updates, cursor pagination.
7. **Gotchas** — write-correctness failure modes that are easy to miss.
8. **Verification** — concurrent-writer test and CloudWatch metric pointers.
9. **Further reading**.

---

## Section 1: Optimistic locking

### The problem

The read-modify-write race is the most common correctness bug in DynamoDB handlers. Two concurrent callers each read the same item, each modify their copy independently, and each write back. The second write clobbers the first. The item ends up in a state neither caller intended, and no error is raised — DynamoDB accepted both writes.

```
Time    Caller A                        Caller B
 0      GetItem → { points: 10 }
 1                                      GetItem → { points: 10 }
 2      UpdateItem SET points = 15     (still computing)
 3                                      UpdateItem SET points = 12
 4      Item now has points = 12        ← Caller A's change lost silently
```

### Pattern: version-stamped writes

Add a `version: number` attribute to every item that can be concurrently modified. Every write must:

1. Read the current item and record its `version`.
2. Send an `UpdateCommand` that increments `version` in the `UpdateExpression` AND checks that the stored value still matches the expected prior value in a `ConditionExpression`.
3. If the condition fails (`ConditionalCheckFailedException`), re-read, recompute, and retry — up to a cap.

Because DynamoDB evaluates `ConditionExpression` atomically at write time, two concurrent writers with the same expected version cannot both succeed. Exactly one wins; the other receives `ConditionalCheckFailedException` and must retry.

### Complete implementation

```typescript
import {
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ErrorCodes, UserError } from "shared/types/api-responses";

const MAX_LOCK_RETRIES = 3;

interface VersionedItem {
  pk: string;
  sk: string;
  version: number;
  [key: string]: unknown;
}

/**
 * Read the current item, apply `transform` to produce the new attribute
 * values, and write them back under optimistic locking.
 *
 * Retries up to MAX_LOCK_RETRIES times on ConditionalCheckFailedException
 * with exponential backoff (100 ms, 200 ms, 400 ms). After the cap,
 * throws UserError(ErrorCodes.CONFLICT) so the caller can surface a
 * retriable error to the client.
 *
 * @param client  Shared DynamoDBDocumentClient.
 * @param table   Table name.
 * @param key     Primary key ({ pk, sk }).
 * @param transform  Pure function: current item → attribute updates map.
 *                   Must NOT include `version` — this helper manages it.
 */
async function updateWithLock<T extends VersionedItem>(
  client: DynamoDBDocumentClient,
  table: string,
  key: { pk: string; sk: string },
  transform: (current: T) => Record<string, unknown>,
): Promise<void> {
  let attempt = 0;

  while (attempt <= MAX_LOCK_RETRIES) {
    // 1. Read the current item.
    const getRes = await client.send(
      new GetCommand({
        TableName: table,
        Key: key,
        ConsistentRead: true, // Must be strongly consistent to see latest version.
      }),
    );

    if (!getRes.Item) {
      throw new UserError(ErrorCodes.NOT_FOUND, "Item not found");
    }

    const current = getRes.Item as T;
    const expectedVersion = current.version;
    const nextVersion = expectedVersion + 1;

    // 2. Apply the caller's transform to get the attributes to update.
    const updates = transform(current);

    // Build SET expression clauses for all caller-provided updates.
    const setClauses: string[] = ["version = :nextVersion"];
    const exprAttrValues: Record<string, unknown> = {
      ":expectedVersion": expectedVersion,
      ":nextVersion": nextVersion,
    };

    for (const [attr, value] of Object.entries(updates)) {
      const placeholder = `:${attr}`;
      setClauses.push(`${attr} = ${placeholder}`);
      exprAttrValues[placeholder] = value;
    }

    // 3. Attempt the conditional write.
    try {
      await client.send(
        new UpdateCommand({
          TableName: table,
          Key: key,
          UpdateExpression: `SET ${setClauses.join(", ")}`,
          ConditionExpression: "version = :expectedVersion",
          ExpressionAttributeValues: exprAttrValues,
        }),
      );
      return; // Write succeeded.
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        if (attempt === MAX_LOCK_RETRIES) {
          // Retry cap reached. Surface as a domain conflict error.
          throw new UserError(
            ErrorCodes.CONFLICT,
            "Item was modified by a concurrent request; please retry",
          );
        }
        // Exponential backoff before next attempt.
        const backoffMs = 100 * Math.pow(2, attempt);
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        attempt++;
        continue;
      }
      throw err; // Non-locking error — propagate immediately.
    }
  }
}
```

### Usage example

```typescript
// Increment a user's loyalty points, safe under concurrent updates.
await updateWithLock(
  client,
  USERS_TABLE,
  { pk: `USER#${userId}`, sk: `USER#${userId}` },
  (current) => ({
    points: (current.points as number) + delta,
    updated_at: new Date().toISOString(),
  }),
);
```

### When NOT to use optimistic locking

Optimistic locking is the right choice when contention is **possible** — multiple callers competing on the same item key. It is the **wrong** choice when items are effectively single-writer (each user's own profile, each order modified only by the order handler). There, the retry cost — an extra `GetCommand` per attempt plus backoff delay — exceeds the probability of ever hitting a conflict. Use an unconditional `UpdateCommand` instead.

Rule of thumb: if fewer than two callers can write the same item key concurrently in normal operation, skip the version attribute.

### Cross-reference

For positional writes where the "identity" is an element at an array index rather than a version number, see `../../aws-cdk-patterns/references/04-database.md` §5 (identity-verified updates).

---

## Section 2: Atomic counters

### Pattern

DynamoDB's `ADD` action increments or decrements a numeric attribute atomically at write time without a read-modify-write round trip. The service applies the delta directly, so two concurrent `ADD` operations on the same attribute do not clobber each other — both deltas are applied.

```typescript
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Atomically increment a per-user view counter by `delta`.
 * delta may be negative to decrement.
 */
async function incrementViewCount(
  client: DynamoDBDocumentClient,
  table: string,
  userId: string,
  delta: number,
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: table,
      Key: {
        pk: `USER#${userId}`,
        sk: `USER#${userId}`,
      },
      UpdateExpression: "ADD view_count :delta",
      ExpressionAttributeValues: {
        ":delta": delta,
      },
    }),
  );
}
```

If the `view_count` attribute does not yet exist on the item, DynamoDB initialises it to zero before applying the delta — no pre-condition check required.

### When it is safe

Atomic counters are correct at any write rate. The problem is not correctness — it is **throughput**. DynamoDB's per-item write limit is bounded by the partition throughput. Under `PAY_PER_REQUEST`, each item can absorb roughly 1000 WCU per second sustained before its partition becomes a hot spot. For view counters on popular content, a single item accumulating increments from thousands of simultaneous viewers will trigger throttling long before correctness breaks.

Use atomic counters when:
- Expected write rate on the item is below ~100 WPS (well within the safe zone).
- The item belongs to a low-traffic entity: a per-user counter, a per-order event count, a daily aggregate for a single tenant.

### When it breaks

At high write rates, the problem is not the counter semantics — it is the hot item. All writes to the same `pk`/`sk` land in the same partition. If that partition absorbs more writes than its share of provisioned throughput allows, DynamoDB starts throttling — returning `ProvisionedThroughputExceededException` — even under `PAY_PER_REQUEST` (where adaptive capacity eventually kicks in, but with a lag). Use sharded counters (Section 3) when the item is expected to cross ~500 WPS.

---

## Section 3: Sharded counters

### The problem

A global view counter for a viral post, a like counter for a trending tweet, or a download counter for a popular asset: any counter that receives writes from thousands of concurrent clients on a single item key will throttle its partition. The per-partition practical write ceiling under `PAY_PER_REQUEST` is well below 1000 WCU/second for a single hot item because all writes collide on the same partition key hash slot.

### Pattern: split across N shards

Spread the counter across N independent items, each with a distinct shard suffix:

```
COUNTER#POST123#0
COUNTER#POST123#1
...
COUNTER#POST123#N-1
```

Writers choose a shard at random. Readers fetch all N shards and sum. Because writes land on N different items (and typically N different partitions), the effective write ceiling scales with N.

Choose N = 10 as a starting point for items expected to exceed 500 WPS. Raise N when CloudWatch shows throttling persists.

### Writer

```typescript
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const COUNTER_SHARDS = 10;

/**
 * Increment the sharded post view counter by 1.
 * Chooses a random shard on each call.
 */
async function incrementPostViews(
  client: DynamoDBDocumentClient,
  table: string,
  postId: string,
): Promise<void> {
  const shardIndex = Math.floor(Math.random() * COUNTER_SHARDS);

  await client.send(
    new UpdateCommand({
      TableName: table,
      Key: {
        pk: `COUNTER#POST${postId}#${shardIndex}`,
        sk: `COUNTER#POST${postId}#${shardIndex}`,
      },
      UpdateExpression: "ADD shard_count :one",
      ExpressionAttributeValues: {
        ":one": 1,
      },
    }),
  );
}
```

### Reader

```typescript
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

interface ShardItem {
  pk: string;
  sk: string;
  shard_count?: number;
}

/**
 * Sum all shards to produce the total post view count.
 * Reads are eventually consistent — a write landing in a shard just
 * before this call may not yet be visible if the shard read races
 * the write. The sum is slightly stale by design.
 */
async function getPostViews(
  client: DynamoDBDocumentClient,
  table: string,
  postId: string,
): Promise<number> {
  const shardKeys = Array.from({ length: COUNTER_SHARDS }, (_, i) => ({
    pk: `COUNTER#POST${postId}#${i}`,
    sk: `COUNTER#POST${postId}#${i}`,
  }));

  const shardItems = await Promise.all(
    shardKeys.map((key) =>
      client.send(
        new GetCommand({
          TableName: table,
          Key: key,
          // Eventual consistency is acceptable for a view counter.
          // Use ConsistentRead: true only if you need the tightest possible sum
          // (at 2x RCU cost per shard read).
        }),
      ),
    ),
  );

  return shardItems.reduce((total, res) => {
    const item = res.Item as ShardItem | undefined;
    return total + (item?.shard_count ?? 0);
  }, 0);
}
```

### Eventual consistency

The shard sum is **eventually consistent**. A write that increments `COUNTER#POST123#7` just before `getPostViews` starts may not yet be visible by the time that specific shard's `GetCommand` executes, even with `ConsistentRead: false` (the default). The total returned can be behind the true total by up to one in-flight write per shard. For view counters and like counts this is acceptable; for financial balances it is not — use a single authoritative item with optimistic locking instead.

### Optional periodic roll-up

For very long-lived counters (months/years), the shard items accumulate indefinitely. A scheduled job can read all N shards, write their sum to a `COUNTER#POST123#ROLLUP` item, and reset the shards to zero. Subsequent reads check the ROLLUP item plus any shard increments that arrived after the last roll-up. The roll-up pattern keeps individual shard values small and avoids number precision issues on very large integers. Implementation details are out of scope for this file; the pattern is worth noting as a future optimisation rather than a day-one requirement.

---

## Section 4: Batch operations

### Overview

DynamoDB's batch APIs — `BatchGetCommand` and `BatchWriteCommand` — allow bundling multiple operations into fewer network round trips. Both have hard item limits, and both can return a non-empty subset of items as "unprocessed" on any call. **DynamoDB does not throw an error on partial failures** — it silently returns the unprocessed subset. Callers who do not check and retry `UnprocessedKeys` / `UnprocessedItems` silently drop data.

### `BatchGetCommand` — 100-item limit

```typescript
import {
  BatchGetCommand,
  type BatchGetCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const BATCH_GET_MAX_RETRIES = 5;

/**
 * Fetch up to 100 items by key in a single BatchGetCommand, retrying
 * UnprocessedKeys with exponential backoff until all items are fetched
 * or the retry cap is reached.
 *
 * Returns all successfully fetched items. If the cap is reached with
 * items still unprocessed, throws an Error naming the count so the
 * caller can decide whether to fail or proceed with the partial result.
 */
async function batchGetAll<T>(
  client: DynamoDBDocumentClient,
  table: string,
  keys: Array<Record<string, unknown>>,
): Promise<T[]> {
  if (keys.length > 100) {
    throw new Error(
      `BatchGetCommand limit is 100 items; received ${keys.length}. ` +
        "Split into multiple calls before invoking batchGetAll.",
    );
  }

  const results: T[] = [];

  // Build the initial RequestItems shape.
  let pendingRequest: BatchGetCommandInput["RequestItems"] = {
    [table]: { Keys: keys },
  };

  let attempt = 0;

  while (pendingRequest && Object.keys(pendingRequest).length > 0) {
    const res = await client.send(
      new BatchGetCommand({ RequestItems: pendingRequest }),
    );

    // Collect successfully returned items.
    const returned = res.Responses?.[table] ?? [];
    results.push(...(returned as T[]));

    // Check for unprocessed keys.
    const unprocessed = res.UnprocessedKeys;
    if (!unprocessed || Object.keys(unprocessed).length === 0) {
      break; // All items fetched.
    }

    if (attempt >= BATCH_GET_MAX_RETRIES) {
      const remaining = unprocessed[table]?.Keys?.length ?? 0;
      throw new Error(
        `batchGetAll: ${remaining} item(s) still unprocessed after ` +
          `${BATCH_GET_MAX_RETRIES} retries. DynamoDB may be throttling.`,
      );
    }

    // Exponential backoff before retrying unprocessed keys.
    const backoffMs = 50 * Math.pow(2, attempt);
    await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
    attempt++;

    // DynamoDB returns UnprocessedKeys in the same shape as RequestItems.
    pendingRequest = unprocessed as BatchGetCommandInput["RequestItems"];
  }

  return results;
}
```

### `BatchWriteCommand` — 25-item limit

```typescript
import {
  BatchWriteCommand,
  type BatchWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const BATCH_WRITE_MAX_RETRIES = 5;

type WriteRequest =
  | { PutRequest: { Item: Record<string, unknown> } }
  | { DeleteRequest: { Key: Record<string, unknown> } };

/**
 * Write up to 25 items via BatchWriteCommand, retrying UnprocessedItems
 * with exponential backoff until all writes land or the retry cap is
 * reached.
 *
 * If the cap is reached, throws an Error naming the unprocessed count.
 * The caller must decide whether to fail the overall operation or log
 * and continue with partial success.
 */
async function batchWriteAll(
  client: DynamoDBDocumentClient,
  table: string,
  requests: WriteRequest[],
): Promise<void> {
  if (requests.length > 25) {
    throw new Error(
      `BatchWriteCommand limit is 25 items; received ${requests.length}. ` +
        "Split into chunks of 25 before invoking batchWriteAll.",
    );
  }

  let pendingRequest: BatchWriteCommandInput["RequestItems"] = {
    [table]: requests,
  };

  let attempt = 0;

  while (pendingRequest && Object.keys(pendingRequest).length > 0) {
    const res = await client.send(
      new BatchWriteCommand({ RequestItems: pendingRequest }),
    );

    // Check for unprocessed items.
    const unprocessed = res.UnprocessedItems;
    if (!unprocessed || Object.keys(unprocessed).length === 0) {
      break; // All writes landed.
    }

    if (attempt >= BATCH_WRITE_MAX_RETRIES) {
      const remaining = unprocessed[table]?.length ?? 0;
      throw new Error(
        `batchWriteAll: ${remaining} item(s) still unprocessed after ` +
          `${BATCH_WRITE_MAX_RETRIES} retries. DynamoDB may be throttling.`,
      );
    }

    // Exponential backoff before retrying unprocessed items.
    const backoffMs = 50 * Math.pow(2, attempt);
    await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
    attempt++;

    // DynamoDB returns UnprocessedItems in the same shape as RequestItems.
    pendingRequest = unprocessed as BatchWriteCommandInput["RequestItems"];
  }
}
```

### Partial-failure semantics — the critical invariant

DynamoDB batch operations are **not atomic**. Individual items can succeed or fail independently within the same batch call. An item in `UnprocessedItems` does not mean the overall request failed — it means DynamoDB could not process that particular item in this call (typically due to throttling). DynamoDB returns HTTP 200 with a non-empty `UnprocessedItems` map. There is no exception to catch.

The consequence: **callers that do not check `UnprocessedItems` silently drop data**. The write appears to have succeeded from the handler's perspective. The missing items will never arrive in the table. This is one of the most common DynamoDB bugs in production. Always use helpers like `batchWriteAll` above, or assert `Object.keys(res.UnprocessedItems ?? {}).length === 0` after every call.

### When to prefer `TransactWriteCommand`

If all-or-nothing semantics matter — every item must land or none should — use `TransactWriteCommand` (Section 5) instead of batch operations. Batch ops guarantee delivery of each item eventually (with retry), but they do not guarantee atomic delivery of the full set. A partial batch write can leave the table in an intermediate state. If that intermediate state is unsafe — for example, a debit with no corresponding credit — use a transaction.

---

## Section 5: `TransactWriteCommand` beyond uniqueness

Section 4 of `../../aws-cdk-patterns/references/04-database.md` establishes the canonical use of `TransactWriteCommand` for atomic uniqueness enforcement. Transactions have broader applicability: any scenario where two or more writes must be all-or-nothing.

### Use cases beyond uniqueness

**Multi-item atomic updates** — debit one item and credit another in a single transaction. If either write fails the overall transaction is cancelled; neither write lands. Correct for financial ledgers, inventory adjustments, and any balance transfer.

**Cross-table atomic writes** — write a main item in table X and an audit record in table Y in one transaction. Either both land or neither does. No separate audit-flush background job needed.

**Conditional batch writes** — each `TransactItem` can carry its own `ConditionExpression`. A transaction with five `Update` items, each guarding a different condition, either fully succeeds or is cancelled with a `CancellationReasons` array identifying which condition failed.

### Limits

| Limit | Value |
|---|---|
| Items per transaction | 100 |
| Total data size | 4 MB |
| Scope | Single AWS account and region |
| WCU cost multiplier | 2× per item (transaction coordination overhead) |

The 2× WCU cost applies regardless of whether the transaction succeeds or is cancelled — the coordination cost is incurred either way.

### Error handling

When any item in the transaction fails its condition, DynamoDB throws `TransactionCanceledException`. The `CancellationReasons` array on the exception is **aligned to the `TransactItems` order** — `CancellationReasons[0]` describes the outcome of `TransactItems[0]`, and so on. Each entry's `Code` identifies the failure mode:

| Code | Meaning |
|---|---|
| `ConditionalCheckFailed` | The item's `ConditionExpression` was not satisfied. |
| `ItemCollectionSizeLimitExceeded` | The item collection (partition) exceeded its size limit. |
| `TransactionConflict` | Another in-flight transaction is modifying the same item. |
| `ProvisionedThroughputExceeded` | Throughput was exceeded for this item's partition. |
| `ThrottlingError` | Request was throttled before the transaction started. |
| `ValidationError` | The item failed a schema validation (wrong attribute type, etc.). |
| `None` | This item succeeded; the transaction was cancelled by another item. |

### Complete example — money transfer

```typescript
import {
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ErrorCodes, UserError } from "shared/types/api-responses";

interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number; // Positive integer (e.g. cents)
  transferId: string; // Caller-generated idempotency key
}

/**
 * Transfer `amount` from account A to account B atomically.
 *
 * Both the debit and the credit land in the ACCOUNTS table.
 * An audit row lands in the TRANSFERS table.
 * Either all three writes succeed or none do.
 *
 * Guards:
 * - Debit: `balance >= :amount` — prevents overdraft.
 * - Audit put: `attribute_not_exists(transfer_id)` — prevents duplicate
 *   processing if the caller retries with the same transferId.
 */
async function transferFunds(
  client: DynamoDBDocumentClient,
  accountsTable: string,
  transfersTable: string,
  input: TransferInput,
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          // Item 0: Debit the sender.
          {
            Update: {
              TableName: accountsTable,
              Key: {
                pk: `ACCOUNT#${input.fromAccountId}`,
                sk: `ACCOUNT#${input.fromAccountId}`,
              },
              UpdateExpression:
                "SET balance = balance - :amount, updated_at = :now",
              ConditionExpression: "balance >= :amount",
              ExpressionAttributeValues: {
                ":amount": input.amount,
                ":now": now,
              },
            },
          },
          // Item 1: Credit the receiver.
          {
            Update: {
              TableName: accountsTable,
              Key: {
                pk: `ACCOUNT#${input.toAccountId}`,
                sk: `ACCOUNT#${input.toAccountId}`,
              },
              UpdateExpression:
                "SET balance = balance + :amount, updated_at = :now",
              ExpressionAttributeValues: {
                ":amount": input.amount,
                ":now": now,
              },
            },
          },
          // Item 2: Write an immutable audit record.
          {
            Put: {
              TableName: transfersTable,
              Item: {
                pk: `TRANSFER#${input.transferId}`,
                sk: `TRANSFER#${input.transferId}`,
                from_account_id: input.fromAccountId,
                to_account_id: input.toAccountId,
                amount: input.amount,
                created_at: now,
              },
              // Prevent reprocessing if the Lambda retries after a timeout.
              // If the first attempt actually landed, the audit row already
              // exists and this condition fails — surfacing as CONFLICT so
              // the caller can check whether the transfer already completed
              // rather than re-applying it.
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const reasons = err.CancellationReasons ?? [];

      // Index 0 → debit item
      if (reasons[0]?.Code === "ConditionalCheckFailed") {
        throw new UserError(
          ErrorCodes.UNPROCESSABLE,
          "Insufficient balance for transfer",
        );
      }

      // Index 2 → audit item (duplicate transfer ID)
      if (reasons[2]?.Code === "ConditionalCheckFailed") {
        throw new UserError(
          ErrorCodes.CONFLICT,
          "Transfer already processed; check transfer status before retrying",
        );
      }

      // TransactionConflict: another transaction is touching the same items.
      // Retry with backoff is appropriate here at the caller level.
      if (reasons.some((r) => r?.Code === "TransactionConflict")) {
        throw new UserError(
          ErrorCodes.CONFLICT,
          "Concurrent transaction in progress; retry in a moment",
        );
      }
    }
    throw err;
  }
}
```

---

## Section 6: Cross-references (runtime patterns in CDK skill)

These three patterns are fully implemented in `../../aws-cdk-patterns/references/04-database.md`. Do not reproduce them here — load that file when you need the implementation. The summaries below name the pattern and explain when to reach for the CDK skill reference.

### Atomic uniqueness — §4

Unique-attribute enforcement (email, phone, username, referral code) uses a dedicated lookup table whose partition key is the unique value itself, combined with a `TransactWriteCommand` that atomically reserves the value and writes the main row. The lookup table's `ConditionExpression: "attribute_not_exists(<pk>)"` is evaluated against the base-table primary key at write time, which provides the same atomicity guarantee as any DynamoDB write — no GSI, no application-level lock. Full TypeScript implementation in the CDK skill at §4.

### Identity-verified updates — §5

Updates to items stored as elements in a DynamoDB list attribute — for example, a task in a per-user task list — must guard against concurrent reordering. The pattern encodes the expected element identity (a `task_id`) in the `ConditionExpression` alongside the target index. If a concurrent delete or reorder has shifted the array between the caller's read and write, the condition fails, `ConditionalCheckFailedException` is raised, and the caller retries after a fresh read. Full TypeScript implementation in the CDK skill at §5. Cross-reference from Section 1 above: this is a specialised form of optimistic locking where the "version" is the identity of an array element rather than a monotonic counter.

### Cursor-based pagination — §6

Paginate `QueryCommand` results by threading `LastEvaluatedKey` back to the API client as an opaque base64-encoded string. Decode and validate the cursor server-side on each subsequent request — a malformed cursor returns `400 INVALID_INPUT`. Sort direction must remain consistent across all calls in a cursor chain. Full TypeScript implementation in the CDK skill at §6.

---

## Section 7: Gotchas

| Symptom | Root cause | Fix |
|---|---|---|
| `ConditionalCheckFailedException` on retry after Lambda timeout, but the item was actually updated. | The prior invocation may have succeeded before the Lambda timed out. DynamoDB applied the write; the Lambda never received the response. On retry, the version has already been incremented so the condition fails — but the data is correct. | After a condition failure on retry, always re-read the item and verify whether the intended change has already landed before treating it as an error. |
| Items silently disappear after a `BatchWriteCommand`. | `UnprocessedItems` not checked after the call returned HTTP 200. DynamoDB returned the items as unprocessed (typically due to throttling) and the handler discarded them. | Use `batchWriteAll` (Section 4) or assert `Object.keys(res.UnprocessedItems ?? {}).length === 0` after every call. Never trust HTTP 200 from a batch write without inspecting `UnprocessedItems`. |
| Sharded counter reader returns a value that excludes the most recent increment. | A write landed in a shard just before `Promise.all` started; the corresponding `GetCommand` for that shard executed before the write was visible. | Expected behaviour for eventual consistency. Document the staleness bound for consumers. If sub-second accuracy is required, use a single-item atomic counter and accept the write-throughput ceiling. |
| Two optimistic-locking callers loop indefinitely under sustained contention. | Retry count is unbounded (or the cap is very high). Both callers keep colliding, re-reading, and colliding again. | Always cap retries at a small number (3 in the implementation above). After the cap, surface `CONFLICT` to the caller. The client should introduce jitter before retrying at the HTTP layer. |
| `TransactWriteCommand` is retried on network timeout and the retry is double-billed. | The first invocation was cancelled by DynamoDB (costs 2× WCU). The retry succeeds (costs 2× WCU again). Total cost: 4× WCU. | Use `ClientRequestToken` (an idempotency key) on `TransactWriteCommand` to make retries within a 10-minute window idempotent. DynamoDB will return the same outcome without re-executing the transaction. |
| `ConditionExpression` on a GSI attribute passes unexpectedly. | `ConditionExpression` is evaluated against the base-table item being written, not against GSI projections. `attribute_not_exists(email)` is meaningless as a uniqueness guard on a table whose base PK is `pk` — the condition checks `email` on the item being written, where `email` is always present. | For uniqueness enforcement, use a dedicated lookup table with the unique value as the base PK (see Section 6 → §4 cross-reference). |

---

## Section 8: Verification

### Concurrent-writer test for optimistic locking

Run ten concurrent writers against the same item key and confirm exactly one succeeds and the rest receive the `CONFLICT` domain error (mapped to HTTP 409 by the handler).

```bash
# Replace <api> with your deployed API Gateway URL.
# Replace USER123 with a userId that already exists in the table.
# Expect: 1x HTTP 200, 9x HTTP 409 (or your CONFLICT status code).
seq 1 10 | xargs -n1 -P10 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X PATCH "https://<api>/users/USER123/points" \
  -H "content-type: application/json" \
  -d '{"delta":1}'
```

Any outcome other than one `200` and nine `409` responses indicates the write path is not atomic — either optimistic locking is not being applied or the retry cap is too high (allowing one caller to eventually win by retrying past all others, producing multiple `200` responses).

### CloudWatch metric for throttled writes

Use this query to monitor write-throttling events on the table — relevant when validating whether sharded counters have reduced hot-partition pressure. For the full CloudWatch verification workflow, see `02-scaling.md` §6.

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name WriteThrottleEvents \
  --dimensions Name=TableName,Value=<your-table-name> \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 300 \
  --statistics Sum \
  --profile <project>
```

A non-zero `Sum` for a `COUNTER#<id>#*` partition key namespace after deploying sharded counters indicates N is still too low — increase the shard count and redeploy.

---

## Section 9: Further reading

- `00-methodology.md` — six-step design process; start here before adding a `version` attribute or a counter.
- `02-scaling.md` — hot partition diagnosis, adaptive capacity scope, Contributor Insights; relevant when sharded counter N needs to be tuned.
- `05-evolution.md` — adding a `version` attribute to existing items without downtime; backfill patterns for introducing optimistic locking on a live table.
- `../../aws-cdk-patterns/references/04-database.md` §4 — atomic uniqueness with `TransactWriteCommand` and a dedicated lookup table (full TS implementation).
- `../../aws-cdk-patterns/references/04-database.md` §5 — identity-verified updates for positional writes (full TS implementation).
- `../../aws-cdk-patterns/references/04-database.md` §6 — cursor-based pagination with opaque base64 cursors (full TS implementation).
- [DynamoDB conditional expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
- [DynamoDB batch operations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html#WorkingWithItems.BatchOperations)
- [DynamoDB best practices for sharding](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html)
