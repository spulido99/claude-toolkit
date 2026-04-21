# Streams & CDC

**Builds:** DynamoDB Streams consumers with Lambda, idempotent at-least-once processing with a dedup table, OpenSearch projection via bulk API, EventBridge Pipes as a no-Lambda alternative, and `IteratorAge` alarming.
**When to use:** When you need to react to item changes in DynamoDB — projecting into a search index, building an audit log, invalidating caches, triggering downstream notifications, or replicating data across services.
**Prerequisites:** `00-methodology.md` — the six-step design process and constraint vocabulary that ground every decision in this file.

---

## Contents

1. **When to use Streams** — canonical use cases.
2. **Stream view types** — decision table with tradeoffs and byte-cost note.
3. **Lambda consumers** — event source mapping parameters, handler shape, and full TypeScript example projecting to OpenSearch.
4. **Idempotency** — at-least-once delivery, the dedup table pattern, and a complete handler integrating the check.
5. **Error handling** — on-failure destinations, `BisectBatchOnFunctionError`, `IteratorAge` alarming, and 24h retention.
6. **Streams vs EventBridge Pipes** — decision tree with one concrete example per side.
7. **Gotchas** — stream-specific failure modes.
8. **Verification** — CLI commands for stream config and consumer mapping.
9. **Further reading** — related docs and cross-references.

---

## Section 1: When to use Streams

Enable DynamoDB Streams when item changes in the table must drive work outside the table itself. The six canonical use cases:

- **Search index projection.** Each write is projected into OpenSearch (or Elasticsearch) so users can full-text-search items that live in DynamoDB. The Lambda consumer maps `INSERT`/`MODIFY` to `index` operations and `REMOVE` to `delete` operations against the bulk API.
- **Audit log.** Every change to an item — who changed what, and from which state — is appended to an immutable audit trail in S3 or another DynamoDB table. `NEW_AND_OLD_IMAGES` view type captures the before and after for each write.
- **S3 projection.** The latest state of each item is snapshotted as a JSON object in S3, keyed by `pk/sk.json`. Downstream batch jobs or data lake ingestion reads from S3 instead of scanning the table.
- **Cache invalidation.** A write to the canonical table fires a stream record; the consumer deletes the matching entry from ElastiCache or DynamoDB Accelerator (DAX). `KEYS_ONLY` is sufficient — the consumer only needs to know which key to evict.
- **Cross-region replication.** AWS Global Tables use Streams internally. If you are building custom replication (for example, selective table subsets or non-Global-Tables regions), the consumer reads the stream and writes to the target region table. Note: for most cross-region use cases, Global Tables is the correct answer.
- **Event-driven downstream triggers.** An order placed, a payment confirmed, or a subscription cancelled in DynamoDB fires a stream record that triggers a notification Lambda, a billing system update, or a webhook delivery. This is the simplest form — stream to Lambda to external call.

---

## Section 2: Stream view types

The `StreamViewType` controls what data is included in each stream record. Choose the smallest view that meets the consumer's needs — `NEW_AND_OLD_IMAGES` is roughly 2× the per-record size of `NEW_IMAGE` alone, and you pay for stream reads and the Lambda invocation payload.

| View type | What is included | Byte cost | Use when |
|---|---|---|---|
| `KEYS_ONLY` | Only `pk`/`sk` of the changed item. | Smallest. No item data transferred. | The consumer only needs to know **which item changed** — e.g., cache invalidation where the consumer calls `GetItem` to fetch the current state, or an eviction that only needs the key. |
| `NEW_IMAGE` | The item as it is **after** the write. No `OldImage`. | Medium. One copy of the item. | Inserts and simple "project to search index" patterns where history does not matter. Standard choice for OpenSearch projection. |
| `OLD_IMAGE` | The item as it was **before** the write. No `NewImage`. | Medium. One copy of the item. | Deletion-aware consumers that need the prior state to produce a tombstone — e.g., an audit trail that records what was removed, or a search index that must delete the old document by its prior attributes. |
| `NEW_AND_OLD_IMAGES` | Both images. | **~2× `NEW_IMAGE` cost.** Two copies of the item per record. | Diff-based consumers: audit logs with before/after, cache invalidation that compares old vs new to decide whether to purge, or any consumer that needs to detect which specific fields changed. |

**Byte-cost note.** Each stream record is billed per shard read. `NEW_AND_OLD_IMAGES` on a 4 KB item produces an ~8 KB stream record per write. Over one million writes per day that is roughly 8 GB of stream data versus 4 GB for `NEW_IMAGE`. Pick based on what the consumer actually needs, not as a default.

---

## Section 3: Lambda consumers

### Event source mapping parameters

AWS Lambda polls the DynamoDB stream shard and invokes the function with a batch of records. The key parameters for event source mappings on DynamoDB Streams:

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `BatchSize` | 100 | 1–10,000 | Number of records per Lambda invocation. Higher values reduce invocations but increase tail latency per batch. |
| `ParallelizationFactor` | 1 | 1–10 | Number of concurrent Lambda invocations per shard. DynamoDB Streams only (not Kinesis). Multiply by shard count for total concurrency. |
| `StartingPosition` | — | `LATEST` \| `TRIM_HORIZON` | `LATEST` = process only new records. `TRIM_HORIZON` = replay all 24h of buffered records. New consumers at `TRIM_HORIZON` will have an initial `IteratorAge` spike — this is expected. |
| `MaximumRetryAttempts` | -1 (infinite) | -1 to 10,000 | Set a finite value (e.g., 3) to avoid poison pills looping forever before DLQ delivery. |
| `BisectBatchOnFunctionError` | false | boolean | When `true`, splits the failing batch in half and retries each half independently. Isolates the bad record to a batch of one. **Recommended default: `true`.** |
| `FunctionResponseTypes` | — | `ReportBatchItemFailures` | Enables partial-batch success reporting. The handler returns `{ batchItemFailures: [{ itemIdentifier: sequenceNumber }] }` instead of throwing, letting Lambda retry only failed items. |
| `DestinationConfig` | — | SQS / SNS | On-failure destination. Records that exhaust `MaximumRetryAttempts` land here with original payload plus failure metadata. |

### Handler shape

DynamoDB Streams events arrive as `DynamoDBStreamEvent`. Each record carries the event metadata and the item images (depending on `StreamViewType`). Values are DynamoDB-typed — `{ S: "..." }`, `{ N: "..." }`, `{ BOOL: true }` — not plain JavaScript objects. Use `@aws-sdk/util-dynamodb`'s `unmarshall` to convert.

```typescript
import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    const eventName = record.eventName; // "INSERT" | "MODIFY" | "REMOVE"
    const eventID = record.eventID;     // unique per-record ID within the stream
    const keys = record.dynamodb?.Keys
      ? unmarshall(record.dynamodb.Keys as Record<string, AttributeValue>)
      : undefined;
    const newImage = record.dynamodb?.NewImage
      ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>)
      : undefined;
    const oldImage = record.dynamodb?.OldImage
      ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>)
      : undefined;

    console.log({ eventName, eventID, keys, newImage, oldImage });
  }
};
```

### Full example: OpenSearch projection consumer

This consumer projects an `orders` DynamoDB table into an OpenSearch index. `INSERT` and `MODIFY` events upsert the document; `REMOVE` events delete it. The bulk API is used to batch all operations from a single Lambda invocation into one HTTP call.

```typescript
import type { DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { Client } from "@opensearch-project/opensearch";

const OS_INDEX = "orders";
const osClient = new Client({ node: process.env.OPENSEARCH_ENDPOINT! });

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  // Build the NDJSON body for the bulk API.
  // Each operation is two lines: an action object, then a document (omitted for delete).
  const bulkBody: object[] = [];

  for (const record of event.Records) {
    const eventName = record.eventName;
    if (!eventName || !record.dynamodb) continue;

    const keys = record.dynamodb.Keys
      ? unmarshall(record.dynamodb.Keys as Record<string, AttributeValue>)
      : undefined;

    // The document ID is derived from the primary key so that upserts are idempotent
    // by nature: re-indexing the same record version produces the same document.
    const docId = `${keys?.pk}#${keys?.sk}`;

    if (eventName === "INSERT" || eventName === "MODIFY") {
      const newImage = record.dynamodb.NewImage
        ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>)
        : undefined;
      if (!newImage) continue;

      bulkBody.push({ index: { _index: OS_INDEX, _id: docId } });
      bulkBody.push(newImage);
    } else if (eventName === "REMOVE") {
      bulkBody.push({ delete: { _index: OS_INDEX, _id: docId } });
    }
  }

  if (bulkBody.length === 0) return;

  const response = await osClient.bulk({ body: bulkBody });

  if (response.body.errors) {
    // Log individual item errors but do not throw — a partial failure here
    // should be surfaced as a batch item failure (see ReportBatchItemFailures),
    // not a full-batch retry that would re-process successful records.
    const failed = (response.body.items as object[]).filter(
      (item: any) => item.index?.error || item.delete?.error,
    );
    console.error("OpenSearch bulk errors", JSON.stringify(failed, null, 2));
    throw new Error(`OpenSearch bulk had ${failed.length} error(s); see logs`);
  }
};
```

---

## Section 4: Idempotency

### At-least-once delivery

DynamoDB Streams guarantees **at-least-once** delivery. The same record can arrive in more than one Lambda invocation — on retries, after a shard failover, or after a consumer redeploy. Consumers **must** tolerate redelivery without producing duplicate side effects (duplicate documents, duplicate audit entries, duplicate notifications).

### Idempotency key

Use `eventID` as the idempotency key. It is assigned by DynamoDB and is unique per record within a single stream. Do not concatenate `eventID` values across tables — uniqueness is scoped to one stream ARN.

### Dedup table

Store processed `eventID` values in a dedicated `STREAM_DEDUP` table with a TTL. The TTL calculation:

- DynamoDB Streams retains records for **24 hours**.
- Lambda `MaximumRetryAttempts` adds a retry window on top of that.
- Set TTL to **48 hours** to cover the full retention window plus retry budget.

`STREAM_DEDUP` schema:

| Attribute | Type | Notes |
|---|---|---|
| `event_id` | String (PK) | The `eventID` from the stream record. |
| `processed_at` | String | ISO 8601 timestamp for observability. |
| `ttl` | Number | Unix epoch seconds; item auto-deleted after 48h. |

### Full TS helper: `wasAlreadyProcessed`

The helper uses a conditional `PutCommand`. If the `event_id` already exists in the table, the condition fails and DynamoDB throws `ConditionalCheckFailedException`. Return `true` — the event was already handled. If the item is new, the `Put` succeeds and we return `false`.

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

const rawClient = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(rawClient);

const DEDUP_TABLE = process.env.STREAM_DEDUP_TABLE!;
const TTL_SECONDS = 48 * 60 * 60; // 48 hours

/**
 * Returns true if this eventID has already been processed.
 * Side-effect: registers the eventID in the dedup table when returning false.
 */
async function wasAlreadyProcessed(eventID: string): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  try {
    await client.send(
      new PutCommand({
        TableName: DEDUP_TABLE,
        Item: {
          event_id: eventID,
          processed_at: new Date().toISOString(),
          ttl,
        },
        ConditionExpression: "attribute_not_exists(event_id)",
      }),
    );
    return false; // First time we've seen this eventID — proceed.
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return true; // Already processed — skip.
    }
    throw err; // Unexpected error — propagate to trigger a retry.
  }
}
```

### Complete handler integrating idempotency

```typescript
import type { DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

const rawClient = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(rawClient);

const DEDUP_TABLE = process.env.STREAM_DEDUP_TABLE!;
const TTL_SECONDS = 48 * 60 * 60;

async function wasAlreadyProcessed(eventID: string): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  try {
    await client.send(
      new PutCommand({
        TableName: DEDUP_TABLE,
        Item: { event_id: eventID, processed_at: new Date().toISOString(), ttl },
        ConditionExpression: "attribute_not_exists(event_id)",
      }),
    );
    return false;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return true;
    throw err;
  }
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  // Replace with actual downstream side effect (notification, billing call, etc.)
  const eventName = record.eventName;
  const newImage = record.dynamodb?.NewImage
    ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>)
    : undefined;
  console.log("Processing", { eventName, newImage });
  // await notifyBillingSystem(newImage);
}

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    const eventID = record.eventID;
    if (!eventID) continue;

    const alreadyProcessed = await wasAlreadyProcessed(eventID);
    if (alreadyProcessed) {
      console.log(`Skipping duplicate eventID: ${eventID}`);
      continue;
    }

    await processRecord(record);
  }
};
```

**Important:** The dedup check and the downstream side effect are not atomic. If the Lambda is killed between the `PutCommand` returning and the side effect completing, the side effect is skipped permanently on retry. For side effects that are themselves idempotent (e.g., `PUT /orders/:id` in a REST API), this is acceptable. For non-idempotent side effects (e.g., sending an email, debiting an account), design the downstream call to be idempotent using the `eventID` as an external idempotency key passed to the downstream API.

---

## Section 5: Error handling

### On-failure destinations

Configure `DestinationConfig` on the event source mapping with a standard SQS queue as the DLQ. Failed batches — those that exhaust `MaximumRetryAttempts` — are delivered to the DLQ with:

- The original stream records (the full batch payload).
- Failure metadata: function ARN, error message, error type, shard ID, and sequence numbers.

Use a separate DLQ per consumer function, not a shared DLQ. Shared DLQs make it impossible to distinguish which consumer failed without parsing the metadata.

### `BisectBatchOnFunctionError`

When set to `true`, Lambda splits a failing batch in half and retries each half independently. This continues recursively until a batch of one is reached. The batch of one that still fails is the poison pill — it goes to the DLQ. The rest of the records re-enter the stream normally.

**Recommended default: set `BisectBatchOnFunctionError: true` on every DynamoDB Streams event source mapping.** Without it, one bad record blocks the entire shard until `MaximumRetryAttempts` is exhausted, causing consumer lag to grow.

### CDK event source mapping with error handling

```typescript
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

// Assumes `table` is a dynamodb.Table with stream enabled and `fn` is the Lambda function.
const dlq = new sqs.Queue(scope, "StreamConsumerDLQ", {
  retentionPeriod: cdk.Duration.days(14),
});

fn.addEventSource(
  new lambdaEventSources.DynamoDBEventSource(table, {
    startingPosition: lambda.StartingPosition.LATEST,
    batchSize: 100,
    parallelizationFactor: 2,
    maxBatchingWindow: cdk.Duration.seconds(5),
    bisectBatchOnError: true,
    maxConcurrentBatchesPerShard: 2, // alias for ParallelizationFactor in CDK
    retryAttempts: 3,
    onFailure: new lambdaEventSources.SqsDlq(dlq),
  }),
);
```

### `IteratorAge` — consumer lag monitoring

`IteratorAge` is the CloudWatch metric for how far behind the stream consumer is. It is emitted per-function and measured in milliseconds.

- **Normal:** `IteratorAge` near zero. The consumer is keeping up with the stream.
- **Alarm threshold: > 60,000 ms (1 minute).** The consumer is falling behind. Investigate Lambda concurrency, function duration, and error rate.
- **Critical: approaching 86,400,000 ms (24 hours).** Records are at risk of expiring before the consumer processes them. DynamoDB Streams retains records for exactly 24 hours. Data is silently lost after that window.

```typescript
// CDK CloudWatch alarm for IteratorAge
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";

new cloudwatch.Alarm(scope, "StreamConsumerLagAlarm", {
  metric: fn.metricIteratorAge({
    period: cdk.Duration.minutes(1),
    statistic: "Maximum",
  }),
  threshold: 60_000,       // 60 seconds in ms
  evaluationPeriods: 3,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  alarmDescription:
    "DynamoDB stream consumer is more than 1 minute behind. Check errors and concurrency.",
});
```

**24h retention is hard.** If the consumer function is down for more than 24 hours, records written during the outage are gone. Two mitigations:

1. Alarm on `IteratorAge` AND have a runbook that says what to do if the consumer is down (backfill from PITR, replay from S3 snapshot, etc.).
2. If longer retention is required, use Kinesis Data Streams as the stream target via `ENABLE_KINESIS_STREAMING_DESTINATION`. Kinesis supports up to 7 days (standard) or 365 days (extended) retention. This adds cost and operational complexity; reserve it for compliance or high-stakes audit workloads.

---

## Section 6: Streams vs EventBridge Pipes

Both Streams + Lambda and EventBridge Pipes can connect a DynamoDB stream to a downstream target. They are not equivalent — pick based on complexity and target.

### Decision tree

**Use Streams + Lambda when:**

- The consumer needs **custom transformation logic** — shaping documents for OpenSearch, enriching records by joining data from other tables, or computing derived fields.
- You need to **fan out to multiple sinks** in one invocation — index to OpenSearch AND write an audit entry AND post to SNS.
- You need **exactly-once semantics** via the dedup table pattern (Section 4).
- The downstream target requires **complex conditional logic** — e.g., only notify if both `status` changed to `SHIPPED` AND `total > 1000`.
- The consumer needs access to **`OldImage` and `NewImage`** simultaneously for diff-based logic.

**Use EventBridge Pipes when:**

- The transformation is simple — filter on `eventName`, pass the payload through with light enrichment.
- The target is a native EventBridge bus, Kinesis Data Stream, Step Functions state machine, API destination (webhook), or SQS queue.
- You want to **reduce cost**: Pipes charges per event processed through the pipe, with no Lambda execution cost for the routing layer. If the logic fits inside Pipes' filter expressions, this is cheaper.
- You want **built-in filter expressions** — Pipes can filter on `eventName = INSERT`, attribute presence, or attribute value ranges before even invoking a Lambda enricher.

### Concrete example A: Streams + Lambda → OpenSearch

The handler in Section 3 is the canonical Streams + Lambda example. The handler performs custom document shaping (e.g., renaming DynamoDB attribute names to match the OpenSearch mapping, stripping internal fields like `pk`/`sk`, and computing a `display_name` from `first_name + last_name`). None of this is expressible in Pipes without a Lambda enricher — at which point you might as well skip Pipes.

### Concrete example B: EventBridge Pipes → EventBridge bus

Scenario: every `INSERT` on the `orders` table must be routed to an EventBridge bus so that downstream services (fulfillment, analytics, notifications) can independently subscribe.

The Pipes configuration:

1. **Source:** DynamoDB stream on `orders` table. `StreamViewType: NEW_IMAGE`.
2. **Filter:** `{ "dynamodb.NewImage": { "exists": true }, "eventName": ["INSERT"] }` — only pass inserts to the enricher.
3. **Enricher:** Optional Lambda that extracts a clean JSON order object from the DynamoDB typed image. If the downstream bus rules can tolerate DynamoDB-typed attributes, skip the enricher entirely.
4. **Target:** EventBridge bus `orders-events`. Downstream rules on the bus route by `source`, `detail-type`, or any attribute in the event body — no Lambda needed in the routing layer.

```typescript
// CDK EventBridge Pipes for DynamoDB → EventBridge bus
import * as pipes from "@aws-cdk-lib/aws-pipes-alpha";
import * as pipesSources from "@aws-cdk-lib/aws-pipes-sources-alpha";
import * as pipesTargets from "@aws-cdk-lib/aws-pipes-targets-alpha";
import * as events from "aws-cdk-lib/aws-events";

const bus = new events.EventBus(scope, "OrdersBus");

new pipes.Pipe(scope, "OrdersInsertPipe", {
  source: new pipesSources.DynamoDBSource(table, {
    startingPosition: pipesSources.DynamoDBStartingPosition.LATEST,
    batchSize: 10,
    // Filter: only INSERT events reach the target.
    filters: [
      pipes.Filter.fromObject({
        eventName: ["INSERT"],
      }),
    ],
  }),
  target: new pipesTargets.EventBridgeTarget(bus, {
    detailType: "OrderCreated",
    source: "dynamodb.orders",
  }),
});
```

No Lambda function is involved in the routing path. Downstream services subscribe to the bus with their own rules. Pipes handles the DLQ and retry configuration natively.

---

## Section 7: Gotchas

| Symptom | Root cause | Fix |
|---|---|---|
| `IteratorAge` spikes after a consumer deploys at `TRIM_HORIZON`. | Expected. The consumer is replaying all records buffered in the 24h window, so lag starts at maximum and drains down. | Wait for the consumer to catch up. Do not alarm during initial deployment; gate the alarm on lag being sustained above threshold for ≥ 3 evaluation periods. |
| Duplicate records processed by the consumer. | Streams is at-least-once. Retries, shard failovers, and consumer redeployment all re-deliver records. | Implement the dedup table pattern from Section 4. Use `eventID` as the idempotency key. |
| Consumer blocks on a single bad record for hours. | `BisectBatchOnFunctionError` not enabled. The batch keeps retrying as a whole until `MaximumRetryAttempts` is exhausted. | Enable `BisectBatchOnFunctionError: true`. Set a finite `MaximumRetryAttempts`. Configure a DLQ for final delivery of poison pills. |
| Stream record missing `NewImage` / `OldImage` even though the change happened. | `StreamViewType` does not include the requested image. `KEYS_ONLY` carries no images; `NEW_IMAGE` carries no `OldImage`; `OLD_IMAGE` carries no `NewImage`. | Set `StreamViewType` to `NEW_AND_OLD_IMAGES` when both images are needed. Changing `StreamViewType` requires updating the table — the stream ARN changes; update all event source mappings. |
| Data silently lost after consumer outage. | Stream records expired after the 24h retention window while the consumer was down. | Alarm on `IteratorAge` approaching 24h. If longer retention is required, redirect to Kinesis Data Streams via `ENABLE_KINESIS_STREAMING_DESTINATION` (7–365 day retention). Have a backfill runbook using DynamoDB PITR or S3 snapshots. |
| `NEW_AND_OLD_IMAGES` doubles cost unexpectedly. | Two full item images per stream record at ~2× the per-record size. | Profile item size before enabling. For large items (>4 KB), evaluate whether `NEW_IMAGE` or `KEYS_ONLY` meets the consumer's needs. Use `OLD_IMAGE` only if tombstoning is required. |
| Shard splits after a table scaling event cause consumer throughput to skew. | DynamoDB splits shards when throughput increases. The new shards inherit records from the split point; existing consumers must be re-mapped. | Lambda's event source mapping handles shard splits automatically. `IteratorAge` may spike briefly during the split. Monitor and wait — it recovers without intervention. |
| `eventID` uniqueness assumption broken across tables. | `eventID` is only unique within a single stream. Using a global dedup table shared across multiple table consumers causes false duplicates if two tables emit records with the same `eventID` string. | Prefix the dedup key with the table name or stream ARN: `${tablePrefix}#${eventID}`. |

---

## Section 8: Verification

Run these commands against a deployed environment to confirm streams are configured correctly. Substitute ARNs and UUIDs from your deployment outputs.

```bash
# 1. Confirm the stream is enabled and check view type + shard count
aws dynamodbstreams describe-stream \
  --stream-arn arn:aws:dynamodb:us-east-1:123456789012:table/orders/stream/2024-01-01T00:00:00.000 \
  --profile <project>
# Look for: StreamStatus: ENABLED, StreamViewType, Shards[].ShardId count

# 2. Confirm the Lambda event source mapping configuration
aws lambda get-event-source-mapping \
  --uuid <uuid-from-cdk-output-or-console> \
  --profile <project>
# Look for: BatchSize, ParallelizationFactor, BisectBatchOnFunctionError,
#           MaximumRetryAttempts, DestinationConfig.OnFailure.Destination (DLQ ARN),
#           State: Enabled

# 3. Check IteratorAge metric (last 1 hour, Maximum stat) via CloudWatch Insights
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name IteratorAge \
  --dimensions Name=FunctionName,Value=<your-function-name> \
  --start-time $(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%SZ') \
  --period 60 \
  --statistics Maximum \
  --profile <project>
# Healthy: Maximum near 0. Alarming if > 60000 (60 seconds in ms).

# 4. Confirm the STREAM_DEDUP table exists with TTL enabled
aws dynamodb describe-time-to-live \
  --table-name STREAM_DEDUP \
  --profile <project>
# Look for: TimeToLiveStatus: ENABLED, AttributeName: ttl

# 5. Inspect records currently in the DLQ (if any)
aws sqs get-queue-attributes \
  --queue-url <dlq-url> \
  --attribute-names ApproximateNumberOfMessages \
  --profile <project>
# If > 0, a consumer has been discarding records. Inspect with:
# aws sqs receive-message --queue-url <dlq-url> --profile <project>
```

---

## Section 9: Further reading

- `../../aws-cdk-patterns/references/04-database.md` §3 — provisioning a `dynamodb.Table` with `stream: StreamViewType.NEW_AND_OLD_IMAGES` in CDK.
- `03-write-correctness.md` — `ConditionalCheckFailedException` handling used in the dedup helper, and `TransactWriteCommand` patterns.
- [AWS DynamoDB Streams Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [AWS Lambda — Using Lambda with DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html)
- [AWS Lambda — DynamoDB event source mapping parameters](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html)
- [EventBridge Pipes — DynamoDB stream source](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-dynamodb.html)
- [OpenSearch JavaScript client — Bulk API](https://opensearch-project.github.io/opensearch-js/2.x/classes/API.html#bulk)
- [Kinesis Data Streams — DynamoDB Streams integration (longer retention)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/kds.html)
