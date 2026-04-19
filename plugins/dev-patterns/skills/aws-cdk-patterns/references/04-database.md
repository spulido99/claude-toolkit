# Database

**Builds:** Aurora Serverless v2 clusters with scale-to-zero and the Data API, DynamoDB tables (single-table and multi-table), a critical atomic uniqueness pattern backed by a dedicated lookup table, identity-verified updates for positional writes, and cursor-based pagination.
**When to use:** When provisioning relational or key-value storage for a serverless backend, enforcing uniqueness on attributes like email or phone, safely updating items that live in arrays, or returning paginated query results to API clients.
**Prerequisites:** `00-architecture.md` — the module structure and shared infrastructure constructs referenced here.

## Contents

1. **Aurora Serverless v2 patterns** — `DatabaseCluster` with scale-to-zero (PostgreSQL 16.3+), Data API, generated secret, and `isProd` branching on backup/retention.
2. **DynamoDB — single-table vs multi-table decision tree** — When each pattern fits, and an explicit statement that neither is universally correct.
3. **DynamoDB construct patterns** — Canonical `Table` construct with billing mode, PITR, TTL, and GSIs.
4. **Atomic uniqueness pattern (critical)** — Dedicated lookup table with `attribute_not_exists` and `TransactWriteCommand`. The core pattern of the skill.
5. **Identity-verified updates pattern** — Guarding positional updates against concurrent reordering.
6. **Cursor-based pagination** — Opaque base64 cursors over `LastEvaluatedKey`.
7. **Gotchas catalog** — Known failure modes with root causes and fixes.
8. **Verification** — CLI commands to confirm tables, TTL, and clusters are configured correctly.
9. **Further reading** — Links to the underlying AWS and CDK docs.

## Section 1: Aurora Serverless v2 patterns

Aurora Serverless v2 with scale-to-zero is the default choice for serverless relational storage. The cluster pauses compute after an idle window (default five minutes, tunable via `serverlessV2AutoPauseDuration`) and resumes on the next query, so the cost floor is storage-only. Two non-obvious requirements apply: the engine version must be one that supports scale-to-zero, and the Data API must be enabled so Lambdas can reach the cluster without being placed in a VPC.

**Engine versions that support scale-to-zero on Aurora PostgreSQL** (as of AWS's Q4 2024 rollout — verify current list in the RDS release notes before picking one for prod):

- 13.15 and newer 13.x
- 14.12 and newer 14.x
- 15.7 and newer 15.x
- 16.3 and newer 16.x
- 17.4 and newer 17.x

Earlier minor versions silently ignore `serverlessV2MinCapacity: 0` and leave the cluster at the explicit minimum. For Aurora MySQL, scale-to-zero is supported from 3.08.0 onward. The example below pins 16.3 for stability; upgrade to newer minors as they are validated in your environment.

```typescript
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

interface DatabaseStackProps extends cdk.StackProps {
  stage: string;
}

export class DatabaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const isProd = props.stage === "prod";

    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 0 });

    const cluster = new rds.DatabaseCluster(this, "Cluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_3,
      }),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: isProd ? 16 : 2,
      writer: rds.ClusterInstance.serverlessV2("Writer"),
      readers: isProd
        ? [rds.ClusterInstance.serverlessV2("Reader1", { scaleWithWriter: true })]
        : [],
      vpc,
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      enableDataApi: true,
      backupRetention: isProd ? cdk.Duration.days(30) : cdk.Duration.days(1),
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      storageEncrypted: true,
    });

    new cdk.CfnOutput(this, "ClusterArn", { value: cluster.clusterArn });
    new cdk.CfnOutput(this, "SecretArn", { value: cluster.secret!.secretArn });
  }
}
```

Key points:

- **Data API.** `enableDataApi: true` exposes the cluster over an HTTPS endpoint. Lambdas call the cluster via `@aws-sdk/client-rds-data` without being placed in a VPC. That removes NAT Gateway cost, removes the Lambda-in-VPC cold start penalty, and removes the need to manage a connection pool — the Data API multiplexes connections on the server side.
- **Scale-to-zero.** `serverlessV2MinCapacity: 0` enables auto-pause. After five minutes with no active sessions, the compute layer pauses and billing drops to storage. The first query after a pause pays a 5-15s resume penalty. That latency is acceptable for internal tools and low-traffic APIs; it is not acceptable for synchronous user-facing paths without a keepalive.
- **Generated secret.** `rds.Credentials.fromGeneratedSecret("postgres")` injects a Secrets Manager secret with a rotating password. Reference it from downstream stacks via `cluster.secret!.secretArn` and load it at Lambda cold start using the pattern in `05-shared-utilities.md`. Never hardcode credentials, and never read them at CDK synth time.
- **`isProd` branching.** Production enables deletion protection, a 30-day backup retention, a `SNAPSHOT` removal policy, and at least one read replica. Non-production uses a single writer, one-day backups, and a `DESTROY` removal policy so ephemeral environments tear down cleanly. The branching is binary: either full production hardening or full teardown.

## Section 2: DynamoDB — single-table vs multi-table decision tree

Single-table design collapses every entity in a bounded context into one table with composite keys. Multi-table design gives each entity its own table. Both are valid, and neither is universally correct. Choose based on access patterns, ownership, and sync semantics — not on folklore.

**Choose single-table when:**

- All entities belong to a single, tightly coupled bounded context — typically one aggregate root and its children (for example, a user and their saved preferences, addresses, and tokens).
- Access patterns are homogeneous and bounded in count (roughly 5-10 queries total across all entities in the context).
- Cost optimization on the tail is important. Fewer tables means fewer minimum provisioning commitments, fewer CloudWatch metrics streams, and lower baseline cost.
- Queries routinely cross entity boundaries and benefit from returning multiple entity types in a single `Query` — for example, fetching a user plus their recent orders and reviews in one call using a shared partition key.

**Choose multi-table when:**

- Multiple bounded contexts need distinct access patterns. Merging them hides the boundary and invites accidental coupling.
- Offline/online sync is per-domain. Each domain has its own sync strategy, and a per-table model makes the sync cursor, conflict resolution, and retention independent.
- TTL or retention differs by domain. One entity lives forever, another expires in seven days — `timeToLiveAttribute` is a table-level setting.
- Team ownership boundaries differ. When two teams own two domains, two tables make responsibility concrete and prevent a noisy neighbor from destabilizing an unrelated access pattern.
- Scaling characteristics diverge. One entity is hot and bursts to thousands of writes per second; another is cold and writes a few times per day. Separate tables keep hot-partition diagnosis per-table and let each table be tuned independently.

State it explicitly: **neither pattern is universally correct.** The rest of this file documents construct patterns that work identically in both; the access-pattern sections (atomic uniqueness, identity-verified updates, pagination) assume whichever shape fits the domain.

## Section 3: DynamoDB construct patterns

The canonical `Table` construct sets billing mode, PITR, TTL, removal policy, encryption, and one GSI per access pattern. Every field is set explicitly — no implicit defaults.

```typescript
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

interface OrderTableProps {
  /** "dev" | "staging" | "prod" — drives isProd branching. */
  stage: string;
  /** Per-deploy segment used in the table name so concurrent dev deploys
   *  do not collide (see 06-deploy-workflow.md). */
  stackSuffix: string;
}

export class OrderTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: OrderTableProps) {
    super(scope, id);

    const isProd = props.stage === "prod";

    this.table = new dynamodb.Table(this, "Table", {
      tableName: `orders-${props.stackSuffix}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      timeToLiveAttribute: "expires_at",
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "user_id-index",
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
```

Rules:

- **Billing mode: `PAY_PER_REQUEST` by default.** Switch to `PROVISIONED` only when traffic is predictable and sustained above roughly 10 RPS for long periods. Most serverless backends never cross that threshold.
- **PITR on RETAIN tables.** If the removal policy is `RETAIN`, point-in-time recovery must be enabled. A table retained past stack deletion with no PITR is a latent data-loss incident.
- **TTL via `timeToLiveAttribute`.** Setting `timeToLiveAttribute: "expires_at"` enables server-side TTL deletion. Items whose `expires_at` attribute is a Unix epoch seconds integer in the past are deleted within roughly 48 hours. The value must be an integer — ISO 8601 strings do not trigger deletion.
- **One GSI per access pattern.** Never overload a GSI with two unrelated queries by packing multiple partition-key shapes into a shared attribute. When the access patterns diverge later, the GSI cannot be refactored without downtime.
- **Explicit `removalPolicy`.** The CDK default is `RETAIN` for stateful resources, which is correct for production and wrong for ephemeral environments. Set it explicitly every time; do not rely on the default.
- **`encryption: TableEncryption.AWS_MANAGED`.** Use AWS-managed keys unless compliance requires customer-managed KMS. The CloudWatch metric for AWS-managed encryption is free; CMKs incur additional per-request cost.

## Section 4: Atomic uniqueness pattern (CRITICAL)

> **Problem:** Ensure a value (email, phone, referral code, username) is globally unique across a table. The naive approach — "query a GSI to check if the value exists, then write if not" — contains a race condition. Two concurrent writers can both pass the pre-check and both succeed at the write. The database ends up with two rows for the same supposedly unique value, and every downstream query that joins on that value is ambiguous.

### Wrong pattern — race condition

```typescript
// DO NOT DO THIS
const existing = await client.send(new QueryCommand({
  TableName: USERS_TABLE,
  IndexName: "email-index",
  KeyConditionExpression: "email = :e",
  ExpressionAttributeValues: { ":e": email },
}));
if (existing.Items?.length) {
  throw new Error("Email taken");
}
await client.send(new PutCommand({
  TableName: USERS_TABLE,
  Item: user,
}));
// Between the Query and the Put, another writer on a separate invocation
// can run the same Query, get zero results, and Put its own row. Both
// writers succeed. The GSI now returns two items for the same email.
```

Why this fails: GSI reads are **eventually consistent**. `ConsistentRead: true` is not supported on GSIs. Even if it were, two concurrent writers that enter the handler within the same millisecond both see "not found" before either has written. The check-then-act sequence is not atomic.

### Correct pattern — `TransactWriteCommand` with a dedicated lookup table

Use a second table whose partition key is the unique value itself, and wrap both the reservation write and the user-row write in a single `TransactWriteCommand`. The condition is evaluated atomically by DynamoDB at write time against the base table's primary key — the same guarantee as any row-level write, so two concurrent writers cannot both succeed. Because both writes are in one transaction, either every item is persisted or none is. There is no rollback path to forget.

```typescript
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { ErrorCodes, UserError } from "shared/types/api-responses";

// Table 1: USERS            pk = USER#<id>, sk = USER#<id>
// Table 2: USER_EMAILS      partition key: email (string)
//                           attributes: user_id, created_at

interface CreateUserInput {
  email: string;
  name: string;
}

interface User extends CreateUserInput {
  userId: string;
}

async function createUser(input: CreateUserInput): Promise<User> {
  const userId = randomUUID();

  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: USER_EMAILS_TABLE,
            Item: {
              email: input.email,
              user_id: userId,
              created_at: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(email)",
          },
        },
        {
          Put: {
            TableName: USERS_TABLE,
            Item: {
              pk: `USER#${userId}`,
              sk: `USER#${userId}`,
              ...input,
              userId,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
      ],
    }));
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      // err.CancellationReasons is an array aligned to TransactItems.
      // Each entry has a Code like "ConditionalCheckFailed". Inspect
      // to decide which write failed — the email conflict vs. the
      // user-id collision (the latter should never happen with UUIDs).
      const reasons = err.CancellationReasons ?? [];
      if (reasons[0]?.Code === "ConditionalCheckFailed") {
        throw new UserError(ErrorCodes.ALREADY_EXISTS, "Email already registered");
      }
    }
    throw err;
  }

  return { ...input, userId };
}
```

### Fallback pattern — two-step write with compensating delete

`TransactWriteCommand` only works when every item lives in the same AWS account and region. When the uniqueness table must live in another account (central identity table shared by several product accounts) or in another region (geo-sharded writes), fall back to two sequential writes with a compensating delete.

**Use this pattern only when transactions are not available.** The catch-block rollback is a liability: if the Lambda is killed between step 1 and the rollback, the reservation orphans and blocks future registrations for the same email until an operator cleans it up. If you are writing within a single account and region, use `TransactWriteCommand` above.

```typescript
import {
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

async function createUserFallback(input: CreateUserInput): Promise<User> {
  const userId = randomUUID();

  // Step 1: reserve the email. If another writer already reserved it,
  // the ConditionExpression fails and DynamoDB throws
  // ConditionalCheckFailedException. Map to a domain error.
  try {
    await client.send(new PutCommand({
      TableName: USER_EMAILS_TABLE,
      Item: {
        email: input.email,
        user_id: userId,
        created_at: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(email)",
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new UserError(ErrorCodes.ALREADY_EXISTS, "Email already registered");
    }
    throw err;
  }

  // Step 2: create the user row. The email reservation has already passed.
  try {
    await client.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: {
        pk: `USER#${userId}`,
        sk: `USER#${userId}`,
        ...input,
        userId,
      },
    }));
  } catch (err) {
    // Best-effort rollback. If the Lambda dies before this runs, the
    // reservation is orphaned — operational runbooks must document the
    // manual cleanup. Pair this pattern with a periodic sweep that
    // deletes reservations older than N minutes whose user_id has no
    // matching row in USERS.
    await client.send(new DeleteCommand({
      TableName: USER_EMAILS_TABLE,
      Key: { email: input.email },
    }));
    throw err;
  }

  return { ...input, userId };
}
```

### Never do this

- **Query a GSI, then write.** Covered above. GSI reads are eventually consistent; concurrent writers race past the check.
- **Use `attribute_not_exists` on a GSI partition key.** `ConditionExpression` is evaluated against the base table's primary key, not against GSI projections. A condition like `attribute_not_exists(email)` on the base USERS table is meaningless if `email` is a GSI partition key but not the base primary key — DynamoDB evaluates it against the item being written, where `email` is always present, and the check passes every time.
- **Rely on application-level locking.** Distributed locks over DynamoDB (separate lock items with TTL) add complexity, require their own race analysis, and still do not beat a condition expression on the write path. The lookup-table pattern is simpler and atomic by construction.

The lookup-table shape scales to every uniqueness constraint: phone numbers, referral codes, usernames, invitation tokens. Each constraint gets its own lookup table with the unique value as the partition key.

## Section 5: Identity-verified updates pattern

Updating an item inside an array by index is racy when concurrent writers reorder the array. Consider a per-user task list stored as a single item with a `tasks` array. Two concurrent handlers — one deleting a task, one marking a different task as complete — can collide.

```typescript
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Wrong: blindly target tasks[3]. If a concurrent delete removed
// tasks[1], the original tasks[3] has shifted to tasks[2]. This
// update overwrites the wrong task.
await client.send(new UpdateCommand({
  TableName: TASKS_TABLE,
  Key: { pk: userId, sk: "TASKS" },
  UpdateExpression: "SET tasks[3].completed = :true",
  ExpressionAttributeValues: { ":true": true },
}));
```

The fix is to include the task identity in the `ConditionExpression`. If the task currently at index 3 has a different ID than the caller expected (because tasks were reordered between read and write), the condition fails and the update is rejected. The caller retries after a fresh read.

```typescript
// Correct: verify the identity of the task at the target index.
// If the check fails, DynamoDB throws ConditionalCheckFailedException
// and the caller retries with a fresh read.
try {
  await client.send(new UpdateCommand({
    TableName: TASKS_TABLE,
    Key: { pk: userId, sk: "TASKS" },
    UpdateExpression: "SET tasks[3].completed = :true",
    ConditionExpression: "tasks[3].task_id = :expectedTaskId",
    ExpressionAttributeValues: {
      ":true": true,
      ":expectedTaskId": expectedTaskId,
    },
  }));
} catch (err) {
  if (err instanceof ConditionalCheckFailedException) {
    // Re-read the item, recompute the index, and retry.
    // Cap retries (e.g. three) to avoid live-lock on a contended item.
    throw new UserError(ErrorCodes.CONFLICT, "Task list changed; retry");
  }
  throw err;
}
```

The same principle applies to any positional update — map values keyed by index, list items referenced by offset, nested fields whose position can change. Always encode an identity check that fails the write when concurrent activity has shifted the target.

## Section 6: Cursor-based pagination

Paginate DynamoDB queries by threading `LastEvaluatedKey` back to the client as an opaque, base64-encoded cursor. Never expose the raw key — clients could craft a cursor that scans outside the intended partition or injects attribute names into the pagination state.

```typescript
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
}

interface Order {
  order_id: string;
  user_id: string;
  created_at: string;
  total: number;
}

async function listOrders(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<PaginatedResult<Order>> {
  const res = await client.send(new QueryCommand({
    TableName: ORDERS_TABLE,
    IndexName: "user_id-index",
    KeyConditionExpression: "user_id = :u",
    ExpressionAttributeValues: { ":u": userId },
    Limit: limit,
    ExclusiveStartKey: cursor
      ? JSON.parse(Buffer.from(cursor, "base64").toString())
      : undefined,
  }));

  const nextCursor = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64")
    : undefined;

  return {
    items: (res.Items ?? []) as Order[],
    nextCursor,
  };
}
```

Clients call `GET /orders?limit=20`, receive `{ items, nextCursor }`, and fetch the next page with `GET /orders?cursor=<opaque>&limit=20`. When `nextCursor` is absent, the scan is complete. The cursor carries everything the server needs to resume — no server-side pagination state is required.

Two implementation notes:

- **Validate the decoded cursor.** When decoding the cursor on the server, wrap `JSON.parse` in a try/catch and return a `400 INVALID_INPUT` on malformed input. An attacker who discovers the format can send corrupt cursors to probe for error leakage.
- **Do not mix sort orders across cursors.** If the request specifies `ScanIndexForward: false`, every subsequent request on the same cursor chain must specify the same sort direction. Flipping the direction mid-chain returns an inconsistent slice.

## Section 7: Gotchas catalog

| Symptom | Root cause | Fix |
|---|---|---|
| Aurora Serverless v2 scale-to-zero does not engage; cluster stays at min capacity > 0. | Engine version does not support scale-to-zero. For Aurora PostgreSQL, supported versions are 13.15+, 14.12+, 15.7+, 16.3+, 17.4+ (earlier minors silently ignore `serverlessV2MinCapacity: 0`). For Aurora MySQL, 3.08.0+. | Upgrade `AuroraPostgresEngineVersion` / `AuroraMysqlEngineVersion` to a supported version; redeploy the stack. Verify the current supported-version list in the RDS release notes before pinning. |
| First query after idle period takes 5-15 seconds. | Auto-pause kicked in after the five-minute idle window. | Expected behavior. Accept the first-query latency, add a warmup ping on a schedule for user-facing paths, or raise `serverlessV2MinCapacity` above zero for latency-critical clusters. |
| `Export <name> cannot be removed as it is in use by <stack>` on a cross-stack deploy. | Removed an export from the producer stack while the consumer still references it. | Remove the reference from the consumer stack first, deploy the consumer, then remove the export from the producer and deploy again. |
| Two users registered with the same email within milliseconds in production. | GSI-query-then-write uniqueness pattern instead of a lookup table with `attribute_not_exists`. | Migrate to the dedicated lookup-table pattern in Section 4. Backfill the lookup table from the existing GSI before enabling the new code path. |
| DynamoDB TTL is not deleting items. | `timeToLiveAttribute` missing on the table, or items store `expires_at` as an ISO 8601 string instead of Unix epoch seconds. | Set `timeToLiveAttribute: "expires_at"` in CDK. Store `expires_at` as an integer (epoch seconds in the past). Expect deletion within 48 hours, not immediately. |
| Cross-stack export gets recreated on an unrelated deploy, breaking the consumer. | `env.account` or `env.region` changed silently between deploys because the stack used `process.env.CDK_DEFAULT_ACCOUNT` without pinning. | Pin `env.account` and `env.region` from CDK context or explicit stack props; never let them drift across machines or CI environments. |
| Orphaned S3 objects remain after a DynamoDB item is deleted. | No cleanup handler is wired to the table's change feed. | Enable DynamoDB Streams on the table and attach a Lambda that deletes referenced S3 objects on `REMOVE` events. |
| Query returns stale data immediately after a write. | Read issued against a GSI, which is always eventually consistent. `ConsistentRead` is not supported on GSIs. | If strong consistency is required, read from the base table with `ConsistentRead: true`. Otherwise, accept eventual consistency and retry on miss; typical propagation is under one second. |
| `TransactWriteCommand` fails with `TransactionCanceledException`. | At least one item in the transaction had a failing condition. | Inspect the `CancellationReasons` array on the exception. The array is aligned to the `TransactItems` order; each entry carries a `Code` (for example `ConditionalCheckFailed`) identifying the exact failure. Map the relevant index to a domain error. |

## Section 8: Verification

Run these commands against a deployed environment to confirm the stack is configured as intended. Substitute `<project>` with the AWS profile name.

```bash
# DynamoDB table configuration
aws dynamodb describe-table \
  --table-name orders-dev \
  --profile <project>

# DynamoDB TTL status
aws dynamodb describe-time-to-live \
  --table-name orders-dev \
  --profile <project>

# Aurora cluster connectivity via the Data API
aws rds-data execute-statement \
  --resource-arn <cluster-arn> \
  --secret-arn <secret-arn> \
  --database postgres \
  --sql "SELECT 1" \
  --profile <project>
```

For the atomic uniqueness pattern, add a parallel test to the integration suite. Spawn concurrent writers attempting to register the same email and confirm exactly one succeeds:

```bash
# Ten concurrent POSTs with the same email; expect 1x 200 and 9x ALREADY_EXISTS.
seq 1 10 | xargs -n1 -P10 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://<api>/users \
  -H "content-type: application/json" \
  -d '{"email":"race@example.com","name":"race"}'
```

Any outcome other than one `200` and nine conflict responses indicates the uniqueness write path is not atomic — the wrong pattern has slipped in. Fix before proceeding.

## Section 9: Further reading

- [aws-dynamodb construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html)
- [aws-rds construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds-readme.html)
- [DynamoDB conditional writes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Aurora Serverless v2 scaling](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html)
- Sibling: `00-architecture.md` — module structure and shared infrastructure wiring.
- Sibling: `05-shared-utilities.md` — secret loading at cold start, `ErrorCodes`, and `ApiResponse<T>`.
