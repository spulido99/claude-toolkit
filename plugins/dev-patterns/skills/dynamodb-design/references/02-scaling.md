# Scaling

**Builds:** Diagnosis and mitigation of hot partitions, item-size breaches, and cost surprises in DynamoDB tables. Patterns for write sharding, calendar-based partition keys, S3 offload for oversized items, and capacity-mode selection.
**When to use:** When a table is throttling, when item sizes are approaching 400 KB, when DynamoDB costs have grown unexpectedly, or when planning capacity for a new high-throughput workload. Load this file alongside `01-modeling.md` when designing a key schema for a write-heavy access pattern.
**Prerequisites:** `00-methodology.md` — the six-step design process and constraint-validation checklist that ground every scaling decision in this file.

## Contents

1. **Hot partitions** — symptoms, CloudWatch Contributor Insights detection, adaptive capacity scope and limits, and three mitigations: write sharding, calendar-based sharding, and key redesign.
2. **Item size** — 400 KB hard limit, WCU/RCU billing boundaries, hot/cold attribute splitting, and S3 offload patterns.
3. **Cost modeling** — PAY_PER_REQUEST vs PROVISIONED decision criteria, breakeven formula, GSI write amplification, consistency multipliers.
4. **Auto scaling** — when it helps, when it lags, reserved capacity, and the PAY_PER_REQUEST default recommendation.
5. **Gotchas (scaling subset)** — read fan-out cost, Contributor Insights per-index billing, adaptive capacity masking symptoms, auto-scaling target utilization.
6. **Verification** — CloudWatch CLI commands for consumed capacity and throttle rate; Contributor Insights status; billing mode query.
7. **Further reading** — related reference files and AWS documentation.

---

## Section 1: Hot partitions

### Symptoms

A hot partition is a single DynamoDB partition that receives a disproportionate share of read or write traffic. Because DynamoDB distributes throughput evenly across partitions, concentrating traffic on one partition exhausts its share faster than the table's total provisioned capacity would predict. The signature symptoms are:

- **`ProvisionedThroughputExceededException`** — returned by the DynamoDB service when a request is throttled. Appears in application logs and in the `SystemErrors` CloudWatch metric.
- **`ThrottlingException`** — returned by the SDK retry wrapper when retries are exhausted. The SDK retries with exponential backoff by default (up to three retries); if the hot condition persists, the exception surfaces to the caller.
- **Uneven CloudWatch metrics** — `ConsumedWriteCapacityUnits` or `ConsumedReadCapacityUnits` spiking while `ProvisionedWriteCapacityUnits` appears adequate at the table level. The mismatch is the tell: table-level capacity looks sufficient but partition-level throughput is exhausted.
- **Latency spikes on a subset of requests** — high p99 on items with a specific PK while other items respond normally.

### Detection with CloudWatch Contributor Insights

Contributor Insights for DynamoDB identifies which partition keys account for the most consumed capacity. Enable it per table and per GSI independently; each index is billed separately.

```bash
# Enable Contributor Insights on a table
aws dynamodb update-contributor-insights \
  --table-name MyTable \
  --contributor-insights-action ENABLE

# Verify status
aws dynamodb describe-contributor-insights \
  --table-name MyTable
```

Once enabled, navigate to **CloudWatch > Contributor Insights** and select the DynamoDB rule for your table. The dashboard shows the top partition keys by consumed WCU or RCU over the selected time range. A key that accounts for more than 10–15% of total consumed capacity in a burst window is a candidate for sharding.

### Adaptive capacity: scope and limits

DynamoDB adaptive capacity automatically redistributes provisioned throughput toward hot partitions — up to the table's total provisioned capacity. It is not additive: if your table is provisioned for 1,000 WCU and one partition consumes all 1,000 WCU, adaptive capacity can route the full 1,000 WCU to that partition, but it cannot exceed 1,000 WCU total.

Adaptive capacity responds at minute granularity. A flash spike that fills its burst budget within seconds will throttle before adaptive capacity intervenes. It also silently masks structural hot-partition problems — traffic keeps flowing at reduced throughput, retries succeed, and the alarm never fires. Contributor Insights is the diagnostic instrument that reveals what adaptive capacity is hiding.

**Adaptive capacity does not help when:**
- The hot partition's demand consistently exceeds the table's total provisioned capacity.
- Traffic spikes are faster than the one-minute adaptation window.
- The table is in `PAY_PER_REQUEST` mode with a genuinely single hot key at very high RPS (PAY_PER_REQUEST still has per-partition throughput limits, enforced at 3,000 RCU or 1,000 WCU per second per physical partition; partitions split over time but may not split fast enough for sudden traffic).

### Mitigation 1: Write sharding

Write sharding appends a random or computed suffix to the partition key, spreading items that would otherwise land on one partition across `N` partitions. The trade-off is that reads must fan out to all `N` shards and aggregate the results.

**When to use:** The hot key is a logical aggregate (leaderboard, counter, rate limiter, event stream) where writes concentrate on a single entity but reads can tolerate fan-out latency.

The example below shards a time-series metric writer across 8 shards, then fans out reads across all shards with `Promise.all`.

```typescript
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const SHARD_COUNT = 8;
const TABLE_NAME = process.env.TABLE_NAME ?? "";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/** Derive a deterministic shard index from a source ID for idempotent re-writes. */
function shardIndex(sourceId: string): number {
  let hash = 0;
  for (let i = 0; i < sourceId.length; i++) {
    hash = (hash * 31 + sourceId.charCodeAt(i)) >>> 0;
  }
  return hash % SHARD_COUNT;
}

/** Write a metric data point to its sharded partition. */
export async function writeMetricPoint(params: {
  metricName: string;
  sourceId: string;
  timestamp: string; // ISO-8601
  value: number;
}): Promise<void> {
  const { metricName, sourceId, timestamp, value } = params;
  const shard = shardIndex(sourceId);
  const pk = `METRIC#${metricName}#SHARD#${shard}`;
  const sk = `TS#${timestamp}#SRC#${sourceId}`;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk,
        sk,
        metricName,
        sourceId,
        timestamp,
        value,
        entity_type: "MetricPoint",
      },
    })
  );
}

/** Query all shards for a metric within a time range and return merged results. */
export async function queryMetricRange(params: {
  metricName: string;
  fromTimestamp: string; // ISO-8601 inclusive
  toTimestamp: string;   // ISO-8601 inclusive
}): Promise<Array<{ sourceId: string; timestamp: string; value: number }>> {
  const { metricName, fromTimestamp, toTimestamp } = params;

  const shardQueries: Array<Promise<QueryCommandOutput>> = Array.from(
    { length: SHARD_COUNT },
    (_, shard) =>
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression:
            "pk = :pk AND sk BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":pk": `METRIC#${metricName}#SHARD#${shard}`,
            ":from": `TS#${fromTimestamp}`,
            ":to": `TS#${toTimestamp}~`, // tilde sorts after all ASCII printable chars
          },
        })
      )
  );

  const results = await Promise.all(shardQueries);

  const items = results.flatMap((r) => r.Items ?? []);

  return items
    .map((item) => ({
      sourceId: item["sourceId"] as string,
      timestamp: item["timestamp"] as string,
      value: item["value"] as number,
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
```

**Cost note:** Fan-out reads consume `N` read requests per logical query. For `SHARD_COUNT = 8`, every range query costs 8x the RCU of a single-shard query. Size shards for throughput relief while keeping fan-out cost acceptable. A common starting point is 4–16 shards; go higher only after measuring.

### Mitigation 2: Calendar-based sharding

For time-series tables where writes concentrate on "today" and historical data is read-only, use a time-period suffix on the partition key. Each period (day, week, month) becomes its own physical partition. This is zero-overhead at read time — queries for a specific period go to exactly one partition — and eliminates the fan-out cost of random sharding for historical queries.

```
pk = ORDER#<tenantId>#2024-W12   (weekly bucket)
pk = EVENT#<streamId>#2024-04-20 (daily bucket)
```

Queries within a period are exact. Queries spanning periods require one `Query` per period, which is typically acceptable for reporting workloads. Do not use calendar sharding when cross-period queries are the primary access pattern; use random write sharding instead.

### Mitigation 3: Key redesign to higher-cardinality PK

If the hot key is a low-cardinality value (status flags like `PENDING`, `ACTIVE`; boolean attributes; course-grained categories), the correct fix is redesigning the partition key to a higher-cardinality value. Sharding over a structurally bad key adds complexity without addressing the root cause.

**Example of a bad PK:** `pk = STATUS#PENDING` receives every new order write until the order is fulfilled. Cardinality is 1 (all pending orders share the same partition).

**Corrected PK:** `pk = ORDER#<orderId>` with a GSI on `gsi1pk = STATUS#PENDING` + `gsi1sk = CREATED#<timestamp>`. The base table distributes writes evenly. The GSI receives write amplification (see Section 3) but its partition is also more naturally distributed if `orderId` is a UUID or similar high-cardinality key.

---

## Section 2: Item size

### The 400 KB hard limit

DynamoDB enforces a 400 KB maximum per item, including attribute names and values. This is a hard limit — the service rejects writes that exceed it with `ValidationException: Item size has exceeded the maximum allowed size`. There is no configuration to increase the limit.

Attribute names count toward the 400 KB budget. Prefer short attribute names (`pk`, `sk`, `v`, `ts`) over verbose names (`partitionKey`, `sortKey`, `value`, `timestamp`) when items are large. A difference of 10 bytes per attribute across 20 attributes is 200 bytes per item; at millions of items that is significant both for storage cost and for the 400 KB ceiling.

### WCU and RCU billing boundaries

DynamoDB bills capacity in fixed-size chunks. Understanding the chunk sizes is essential for cost modeling and for predicting whether an item-size change changes tier.

| Operation | Chunk size | Notes |
|---|---|---|
| Write (WCU) | 1 KB per WCU | Rounded up. A 1.1 KB item costs 2 WCU. |
| Read — eventual consistency (RCU) | 4 KB per 0.5 RCU | Rounded up to nearest 4 KB, then halved. |
| Read — strong consistency (RCU) | 4 KB per 1 RCU | Rounded up to nearest 4 KB. |
| Read — transactional (RCU) | 4 KB per 2 RCU | Transactional reads cost 2x strong reads. |
| Write — transactional (WCU) | 1 KB per 2 WCU | `TransactWrite` costs 2x standard writes. |

A 3.5 KB item costs:
- 4 WCU to write (rounded up to 4 × 1 KB)
- 1 RCU to read with eventual consistency (rounded up to 4 KB, halved = 0.5, but billing rounds up to 1)
- 1 RCU to read with strong consistency

A 5 KB item crosses into the next 4 KB read tier: 2 RCU strong, 1 RCU eventual (rounds up from 0.625 to 1).

**The 1 KB write boundary is the most impactful boundary for write-heavy workloads.** Storing an extra 100-byte audit trail that pushes a 950-byte item over 1 KB doubles its write cost.

### Splitting strategies: hot/cold attribute split

Split an item into a "hot" record containing frequently accessed attributes and a "cold" record containing rarely accessed attributes. Both records share the same partition key; the sort key distinguishes them by convention.

```
pk = USER#<userId>, sk = PROFILE          → hot: name, email, avatar_url, plan
pk = USER#<userId>, sk = COLD#PREFERENCES → cold: notification_config, theme, locale, timezone
pk = USER#<userId>, sk = COLD#HISTORY     → cold: last_100_login_ips, device_fingerprints
```

Reads that only need the hot record issue a `GetItem` on `sk = PROFILE`. Reads that need both issue a `Query` on `pk = USER#<userId>`. The cold sort-key prefix `COLD#` makes the split self-documenting and queryable if needed.

The hot record stays small (typically < 1 KB), keeping the common-case read cost at 0.5 RCU (eventual) or 1 RCU (strong). Cold records are read only when needed and their larger size is an acceptable cost in those less frequent paths.

### S3 offload for oversized attributes

When a single attribute (binary content, large JSON blob, rendered HTML, PDF bytes) is the primary driver of item size and must exceed 400 KB, offload it to S3. Store the S3 object key in the DynamoDB item so the caller can retrieve the full content in a second call.

The pattern has two sub-patterns:

**Write path** — store the large payload in S3 first, then write the DynamoDB item with the S3 reference. If the DynamoDB write fails, the S3 object is orphaned (acceptable; clean up with S3 lifecycle rules). If S3 write fails, no DynamoDB write occurs — the item is not corrupted with a dangling reference.

**Read path** — fetch the DynamoDB item first to check existence and authorization, then fetch the S3 object for the payload. This preserves DynamoDB as the source of truth for access control; S3 objects can be private (no public ACL, no pre-signed URL shared with the DynamoDB item).

```typescript
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Readable } from "stream";

const TABLE_NAME = process.env.TABLE_NAME ?? "";
const BUCKET_NAME = process.env.PAYLOAD_BUCKET ?? "";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});

/** Write a large document: store payload in S3, reference in DynamoDB. */
export async function writeDocument(params: {
  documentId: string;
  metadata: Record<string, string>;
  payload: Buffer;
}): Promise<void> {
  const { documentId, metadata, payload } = params;
  const s3Key = `documents/${documentId}/payload`;

  // 1. Write payload to S3 first
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: payload,
      ContentType: "application/octet-stream",
    })
  );

  // 2. Write DynamoDB item with S3 reference (small item, well under 400 KB)
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DOC#${documentId}`, sk: `DOC#${documentId}` },
      UpdateExpression:
        "SET #meta = :meta, s3Key = :s3Key, updatedAt = :updatedAt, entity_type = :entityType",
      ExpressionAttributeNames: { "#meta": "metadata" },
      ExpressionAttributeValues: {
        ":meta": metadata,
        ":s3Key": s3Key,
        ":updatedAt": new Date().toISOString(),
        ":entityType": "Document",
      },
    })
  );
}

/** Read a large document: fetch DynamoDB item for metadata, S3 for payload. */
export async function readDocument(params: {
  documentId: string;
}): Promise<{ metadata: Record<string, string>; payload: Buffer } | null> {
  const { documentId } = params;

  // 1. Fetch DynamoDB item (fast, small, authoritative for existence + ACL)
  const ddbResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `DOC#${documentId}`, sk: `DOC#${documentId}` },
    })
  );

  if (!ddbResult.Item) {
    return null;
  }

  const s3Key = ddbResult.Item["s3Key"] as string;
  const metadata = ddbResult.Item["metadata"] as Record<string, string>;

  // 2. Fetch payload from S3
  const s3Result = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key })
  );

  if (!s3Result.Body) {
    throw new Error(`S3 object missing for document ${documentId} at key ${s3Key}`);
  }

  // s3Result.Body is a Readable stream in Node.js
  const chunks: Buffer[] = [];
  for await (const chunk of s3Result.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const payload = Buffer.concat(chunks);

  return { metadata, payload };
}
```

**S3 lifecycle cleanup:** Add an S3 lifecycle rule to expire orphaned objects (objects without a corresponding DynamoDB item). A practical rule is to expire objects that have not been accessed for 30 days after a grace period of 7 days post-creation. Alternatively, tag objects at write time and use tag-based lifecycle rules to keep the cleanup logic independent of the DynamoDB data model.

---

## Section 3: Cost modeling

### PAY_PER_REQUEST vs PROVISIONED

| Factor | Favors PAY_PER_REQUEST | Favors PROVISIONED |
|---|---|---|
| Traffic pattern | Spiky, unpredictable, or low | Steady, predictable, sustained |
| Ops overhead | Prefer zero | Willing to manage capacity + auto scaling |
| Cost at sustained high traffic | Higher per-unit cost | Lower per-unit cost + reserved capacity |
| Cold start / new service | Default choice | After load profile is established |
| Burst protection | Built-in (up to limits) | Requires burst buffer + auto scaling |

For most new services, start with `PAY_PER_REQUEST`. Switch to `PROVISIONED` only after you have established a stable load profile from production metrics, typically after several weeks of steady traffic data.

### Breakeven formula

The breakeven point between `PAY_PER_REQUEST` and `PROVISIONED` is approximately:

```
Breakeven WCU = PAY_PER_REQUEST_price_per_WCU / PROVISIONED_price_per_WCU_hour × hours_per_month
```

Using example pricing (verify current pricing on the AWS DynamoDB pricing page before using these numbers in a business case — prices vary by region and change over time):

- PAY_PER_REQUEST: ~$1.25 per million WCU (us-east-1)
- PROVISIONED: ~$0.00065 per WCU-hour (us-east-1)

At 730 hours/month, one provisioned WCU costs approximately $0.47/month. One million PAY_PER_REQUEST WCU costs $1.25. The breakeven is approximately:

```
1,250,000 WCU/month ÷ 730 hours/month ≈ 1,712 sustained WCU/hour
```

If your table sustains more than ~1,700 WCU continuously for a full month, `PROVISIONED` is cheaper. If writes are bursty and the average is below that threshold, `PAY_PER_REQUEST` is cheaper — you only pay for what you use.

Always verify current pricing on the [AWS DynamoDB pricing page](https://aws.amazon.com/dynamodb/pricing/) before making capacity-mode decisions for production workloads.

### GSI write amplification

Every write to a base table that changes an attribute projected into a GSI costs an additional WCU for each GSI that includes that attribute. The amplification factor is:

```
Total WCU per write = base WCU × (1 + number of GSIs affected by the write)
```

A write to an item that changes attributes projected into 3 GSIs with `ALL` projection costs 4x the base WCU (1 base + 3 GSI). At scale, GSI write amplification is a primary cost driver and should be quantified explicitly during schema design.

**Projection types and their write amplification:**

| Projection | What is stored in the GSI | Write amplification note |
|---|---|---|
| `KEYS_ONLY` | GSI PK + SK + base table PK + SK only | Lowest amplification; every write to the base PK or GSI key attributes triggers a GSI write, but the GSI item is small |
| `INCLUDE` | KEYS_ONLY + a specific attribute list | Medium; only listed attributes trigger replication overhead |
| `ALL` | Full item copy | Highest amplification; any attribute change writes the full item to the GSI |

Use `KEYS_ONLY` or `INCLUDE` projections when the access pattern only needs a subset of attributes. Reach into the base table for full items when needed (one additional `GetItem` per result). Use `ALL` only when the GSI's primary access pattern consistently needs all attributes and the reduced latency outweighs the write cost.

### Consistency cost multipliers

| Read type | RCU multiplier vs eventual |
|---|---|
| Eventually consistent | 1x (baseline) |
| Strongly consistent | 2x |
| Transactional (`TransactGet`) | 4x |

| Write type | WCU multiplier vs standard |
|---|---|
| Standard write | 1x (baseline) |
| Transactional (`TransactWrite`) | 2x |

Use eventual consistency wherever the access pattern tolerates a brief replication lag (typically < 1 second). Use strong consistency only for reads that must reflect a write that just completed in the same request lifecycle. Use transactional operations only when atomicity across multiple items is a hard correctness requirement — the cost is substantial at scale.

---

## Section 4: Auto scaling

### When auto scaling helps

DynamoDB auto scaling adjusts provisioned capacity in response to CloudWatch `ConsumedWriteCapacityUnits` and `ConsumedReadCapacityUnits` metrics. It works well when:

- **Traffic patterns are predictable and gradual** — a daily ramp from low to peak over 30+ minutes, a weekly business-hours cycle, a steady growth trend. Auto scaling tracks these patterns reliably.
- **Occasional bursts are short** — the burst is absorbed by the partition's burst capacity (up to 5 minutes of previously unused capacity) while auto scaling catches up.
- **The 70% target utilization default provides headroom** — auto scaling targets 70% of provisioned capacity by default. At 70% utilization, there is 30% burst room before throttling occurs.

### When auto scaling lags

Auto scaling is **not** a substitute for correct initial provisioning or `PAY_PER_REQUEST` mode for unpredictable traffic. It fails in these common scenarios:

- **Sub-minute spikes:** Auto scaling reacts to CloudWatch metrics at one-minute granularity. A traffic spike that saturates a partition within seconds throttles before auto scaling can act.
- **Cold deployments and load tests:** A load test that ramps from 0 to target RPS in seconds will throttle heavily even if provisioned capacity is set correctly for steady state. The load test passes in isolation (table is pre-warmed by the test run), then production traffic throttles because the table starts cold. Always pre-warm by gradually sending traffic before a load test, and separately ensure production provisioning is correct before traffic arrives.
- **Simultaneous multi-table scale events:** If many tables scale simultaneously (e.g., after a deployment that changes load across the service), CloudWatch metric collection and auto scaling response can lag across all tables at once.

### Reserved capacity

Reserved capacity offers a discount on provisioned WCU and RCU in exchange for a 1- or 3-year commitment. Reserved capacity applies only to `PROVISIONED` mode tables and only to the region in which it is purchased. It cannot be applied to `PAY_PER_REQUEST` mode tables.

Reserved capacity is appropriate only after you have a stable, long-lived workload with predictable sustained throughput. It is not appropriate for tables that may be deleted, resized to `PAY_PER_REQUEST`, or moved to a different region. Verify current reserved capacity pricing and terms on the AWS DynamoDB pricing page.

### Recommendation: PAY_PER_REQUEST as default

Use `PAY_PER_REQUEST` as the default billing mode for all tables. Switch to `PROVISIONED` with auto scaling only when:

1. Production metrics show the table sustains throughput consistently above the PAY_PER_REQUEST breakeven.
2. The load profile is stable enough that auto-scaling upper bounds can be set without risk of under-provisioning.
3. The operational cost of managing provisioned capacity is justified by the cost savings.

This recommendation is particularly strong for tables that serve bursty API traffic, tables that are shared across multiple features with uncorrelated load, and tables in non-production environments.

---

## Section 5: Gotchas (scaling subset)

| Gotcha | Root cause | Fix |
|---|---|---|
| Read fan-out multiplies cost unexpectedly | Sharding with `SHARD_COUNT = N` costs `N` RCU per logical query even if results are sparse | Benchmark fan-out cost at expected query frequency; reduce `SHARD_COUNT` or use calendar sharding if reads are frequent |
| Contributor Insights billed per index | Each table and each GSI is billed independently for Contributor Insights (~$0.02 per million requests, verify current price) | Enable only on tables/indexes that are actively throttling or under investigation; disable after diagnosis |
| Adaptive capacity masks structural problems | Throttle events are suppressed by retries, alarms do not fire, and the hot partition is never diagnosed | Enable Contributor Insights proactively on high-traffic tables; set CloudWatch alarms on `ThrottledRequests` count, not just `SuccessfulRequestLatency` |
| Auto-scaling 70% target leaves a trap | The 70% default means a 1.43x traffic spike will throttle; burst capacity absorbs short spikes, but a sustained 1.5x load event will not auto-scale fast enough | Adjust the target to 50–60% for tables with bursty traffic, or switch to `PAY_PER_REQUEST` |
| GSI `ALL` projection doubles storage costs | `ALL` projection stores a full copy of every item in the GSI; a 1 KB item with 3 ALL-projection GSIs stores 4 KB total per write | Audit GSI projections; downgrade to `KEYS_ONLY` or `INCLUDE` for GSIs where the access pattern only needs a few attributes |
| S3 offload adds two-hop latency | Every read requires a DynamoDB `GetItem` followed by an S3 `GetObject`; S3 adds 10–50 ms over DynamoDB | Use S3 offload only when items genuinely approach 400 KB; prefer hot/cold attribute splitting for items in the 10–200 KB range |
| `TransactWrite` 2x WCU is invisible at design time | Transactional writes cost double but the code looks identical to standard writes; cost surprises appear at scale | Mark every `TransactWrite` call site with a comment noting the 2x WCU cost; include transactional write volume in cost modeling |

---

## Section 6: Verification

### Check consumed capacity and throttle rate

```bash
# ConsumedWriteCapacityUnits for a table over the last hour (1-minute periods)
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedWriteCapacityUnits \
  --dimensions Name=TableName,Value=MyTable \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 60 \
  --statistics Sum \
  --query "sort_by(Datapoints, &Timestamp)[*].{Time:Timestamp,WCU:Sum}"

# ThrottledRequests count for the same table
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ThrottledRequests \
  --dimensions Name=TableName,Value=MyTable \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 60 \
  --statistics Sum \
  --query "sort_by(Datapoints, &Timestamp)[*].{Time:Timestamp,Throttles:Sum}"
```

A non-zero `ThrottledRequests` sum is actionable. Correlate the timestamps with Contributor Insights to identify the hot keys.

### Check Contributor Insights status

```bash
# Table-level status
aws dynamodb describe-contributor-insights \
  --table-name MyTable \
  --query "{Status:ContributorInsightsStatus,LastUpdateDateTime:LastUpdateDateTime}"

# GSI-level status (repeat for each GSI)
aws dynamodb describe-contributor-insights \
  --table-name MyTable \
  --index-name MyGSI \
  --query "{Status:ContributorInsightsStatus}"
```

Expected output when enabled: `"Status": "ENABLED"`.

### Check billing mode

```bash
aws dynamodb describe-table \
  --table-name MyTable \
  --query "Table.BillingModeSummary"
```

Output for PAY_PER_REQUEST:
```json
{
  "BillingMode": "PAY_PER_REQUEST",
  "LastUpdateToPayPerRequestDateTime": "2024-01-15T10:30:00Z"
}
```

Output for PROVISIONED (no `BillingModeSummary` key, or key absent):
```json
{}
```

A `PROVISIONED` table has no `BillingModeSummary` by default; the absence of the key indicates provisioned mode. Check `Table.ProvisionedThroughput` for WCU/RCU settings in that case:

```bash
aws dynamodb describe-table \
  --table-name MyTable \
  --query "Table.ProvisionedThroughput"
```

---

## Section 7: Further reading

- **`00-methodology.md`** — the six-step access-pattern design process that grounds every key and capacity decision.
- **`01-modeling.md`** — partition key cardinality, sort key design, and GSI projection types (the structural complement to this scaling file).
- **`03-write-correctness.md`** — `ConditionExpression`, `TransactWriteCommand`, and atomic uniqueness patterns. Relevant to this file's discussion of transactional WCU cost.
- **`05-evolution.md`** — zero-downtime schema migrations and capacity-mode transitions without data loss.
- **[AWS DynamoDB Pricing](https://aws.amazon.com/dynamodb/pricing/)** — current PAY_PER_REQUEST and PROVISIONED unit prices by region, reserved capacity terms, and Contributor Insights pricing.
- **[CloudWatch Contributor Insights for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/contributorinsights.html)** — enabling, reading, and interpreting the top-N key reports.
- **[DynamoDB Adaptive Capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html#bp-partition-key-partitions-adaptive)** — official documentation on adaptive capacity behavior and limits.
