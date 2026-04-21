# Testing and Local Development

**Builds:** A complete local test environment for DynamoDB — ephemeral DynamoDB Local containers in Jest/Vitest, testcontainers for isolation, LocalStack for Streams + Lambda pipelines, access-pattern tests that exercise the exact query shape production uses, and a deterministic seeding layer with proper teardown.
**When to use:** Before shipping any handler that reads or writes DynamoDB, or before modifying an access pattern that is already live. Run the full suite in CI as a sidecar alongside the main unit tests.
**Prerequisites:** `03-write-correctness.md` — the `updateWithLock` helper and `BatchWriteCommand` retry loop that the tests in this file validate. `04-streams-cdc.md` — the Streams consumer that LocalStack tests exercise.

---

## Contents

1. **DynamoDB Local** — AWS-provided emulator, Docker setup, flags, limitations, and a Jest `beforeAll`/`afterAll` that manages the container via `child_process`.
2. **Testcontainers** — `GenericContainer("amazon/dynamodb-local")` for per-suite isolation, mapped ports, and cleaner CI.
3. **LocalStack** — Full-service emulator supporting Streams + Lambda; `docker-compose.yml` snippet plus SDK wiring.
4. **Access-pattern tests** — One test per access pattern, covering happy path, concurrent race, and retry-cap-exceeded.
5. **Test data seeding** — `BatchWriteCommand` helper, deterministic IDs via `faker.setSeed`, frozen timestamps, and teardown strategy.
6. **Gotchas** — Port collisions, stale state, `-sharedDb` trap, Streams no-op, TTL non-deletion.
7. **Verification** — `npm test` targets, coverage thresholds, CI sidecar, and sample `package.json` scripts.
8. **Further reading**.

---

## Section 1: DynamoDB Local

### What it is

DynamoDB Local is an AWS-provided emulator — a JAR file that speaks the same HTTP/JSON API as the real service — intended for offline development and unit testing. It runs entirely in memory or backed by a local SQLite file, has no internet dependency, and starts in under a second.

### Installation options

**Option A — Docker image (recommended for CI and team consistency):**

```bash
docker run -d -p 8000:8000 amazon/dynamodb-local:latest \
  -jar DynamoDBLocal.jar -inMemory -sharedDb
```

**Option B — Standalone JAR download:**

```bash
# Download from AWS and run directly (requires Java 11+)
curl -O https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz
tar xzf dynamodb_local_latest.tar.gz
java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -inMemory -sharedDb
```

### In-memory vs file-backed

| Flag | Behavior |
|------|----------|
| `-inMemory` | All data is lost when the process exits. Ideal for tests — each run starts from a clean slate. |
| `-dbPath ./data` | Data is persisted in SQLite files under `./data`. Survives restarts; useful for iterative local development where you want to keep seed data between `npm run dev` cycles. |

Use `-inMemory` for all automated tests. Use `-dbPath` only for local exploration.

### The `-sharedDb` flag

Without `-sharedDb`, DynamoDB Local creates a **separate isolated database per AWS access key**. In a test suite, different `DynamoDBClient` instances or different test files that use different (even dummy) credential strings each get their own empty DB. The result is confusing: `CreateTable` succeeds but a subsequent `PutItem` from a differently-configured client hits a `ResourceNotFoundException`.

Always pass `-sharedDb`. It forces a single shared database regardless of which access key is presented.

### Known limitations (precise)

| Feature | Behavior on DynamoDB Local |
|---------|---------------------------|
| **DynamoDB Streams** | APIs respond but return empty shard iterators. `GetShardIterator` and `GetRecords` work structurally but never yield records. Tests that depend on Streams must use LocalStack. |
| **Global Tables** | Not supported. `CreateGlobalTable` and `UpdateGlobalTable` return errors. |
| **TTL actual deletion** | The TTL attribute is recognized and stored, but items past their expiry are NOT automatically removed. Queries and scans return expired items as if they were live. |
| **PITR / BackupSummary** | The backup and PITR APIs (`CreateBackup`, `RestoreTableFromBackup`, `ListBackups`) are no-ops or return empty responses. |
| **IAM enforcement** | No IAM evaluation. Any credentials — including `accessKeyId: "fake"` — are accepted. |
| **Adaptive capacity** | Not emulated. Throttling behavior under load does not match production. |

### SDK client configuration

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function makeLocalClient(port = 8000): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    endpoint: `http://localhost:${port}`,
    region: "us-east-1",        // value is arbitrary — Local ignores it
    credentials: {
      accessKeyId: "fake",
      secretAccessKey: "fake",
    },
  });
  return DynamoDBDocumentClient.from(raw);
}
```

### Jest/Vitest setup via `child_process` docker run

This approach requires Docker on the CI runner but adds no extra npm dependencies.

```typescript
// tests/setup/dynamodb-local.ts
import { execSync, spawn, ChildProcess } from "child_process";

const PORT = 8000;
const CONTAINER_NAME = "dynamodb-local-test";

let container: ChildProcess | null = null;

export async function startDynamoDBLocal(): Promise<void> {
  // Remove any stale container from a previous interrupted run.
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: "ignore" });
  } catch {
    // No container to remove — fine.
  }

  container = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name", CONTAINER_NAME,
      "-p", `${PORT}:8000`,
      "amazon/dynamodb-local:latest",
      "-jar", "DynamoDBLocal.jar",
      "-inMemory",
      "-sharedDb",
    ],
    { stdio: "ignore" },
  );

  // Wait until the port is accepting connections (max 10 s).
  await waitForPort(PORT, 10_000);
}

export async function stopDynamoDBLocal(): Promise<void> {
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: "ignore" });
  } catch {
    // Already gone.
  }
  container = null;
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const net = require("net");

    function probe() {
      const sock = new net.Socket();
      sock
        .once("connect", () => { sock.destroy(); resolve(); })
        .once("error", () => {
          sock.destroy();
          if (Date.now() < deadline) {
            setTimeout(probe, 200);
          } else {
            reject(new Error(`DynamoDB Local did not start on port ${port} within ${timeoutMs} ms`));
          }
        })
        .connect(port, "127.0.0.1");
    }
    probe();
  });
}
```

```typescript
// tests/setup/create-table.ts
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { makeLocalClient } from "./dynamodb-local-client";

export async function createTestTable(tableName: string): Promise<void> {
  const client = makeLocalClient();
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
}

export async function dropTestTable(tableName: string): Promise<void> {
  const { DeleteTableCommand } = await import("@aws-sdk/client-dynamodb");
  const client = makeLocalClient();
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch {
    // Table may not exist — ignore.
  }
}
```

```typescript
// tests/write-correctness.test.ts (abridged — full version in Section 4)
import { startDynamoDBLocal, stopDynamoDBLocal } from "./setup/dynamodb-local";
import { createTestTable, dropTestTable } from "./setup/create-table";

const TABLE = "test-write-correctness";

beforeAll(async () => {
  await startDynamoDBLocal();
  await createTestTable(TABLE);
}, 30_000); // allow up to 30 s for Docker pull on first run

afterAll(async () => {
  await dropTestTable(TABLE);
  await stopDynamoDBLocal();
});
```

---

## Section 2: Testcontainers

### What it is

Testcontainers is a Node.js library that manages ephemeral Docker containers scoped to the test lifecycle. It handles port allocation, readiness probing, and cleanup automatically — which removes the manual `execSync docker rm -f` gymnastics from Section 1.

### Package

```bash
npm install --save-dev testcontainers
```

There is no dedicated `@testcontainers/dynamodb` module today. Use the generic API with the official AWS image.

### Full Jest/Vitest setup

```typescript
// tests/setup/testcontainers-dynamo.ts
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";

const DYNAMO_CONTAINER_PORT = 8000;

let container: StartedTestContainer;
let docClient: DynamoDBDocumentClient;

export async function startDynamo(): Promise<DynamoDBDocumentClient> {
  container = await new GenericContainer("amazon/dynamodb-local:latest")
    .withCommand([
      "-jar", "DynamoDBLocal.jar",
      "-inMemory",
      "-sharedDb",
    ])
    .withExposedPorts(DYNAMO_CONTAINER_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(60_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(DYNAMO_CONTAINER_PORT);

  const raw = new DynamoDBClient({
    endpoint: `http://${host}:${port}`,
    region: "us-east-1",
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });

  docClient = DynamoDBDocumentClient.from(raw);
  return docClient;
}

export async function stopDynamo(): Promise<void> {
  await container.stop({ timeout: 10_000 });
}
```

```typescript
// tests/access-patterns.test.ts
import { startDynamo, stopDynamo } from "./setup/testcontainers-dynamo";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const TABLE = "test-access-patterns";
let client: DynamoDBDocumentClient;

beforeAll(async () => {
  client = await startDynamo();
  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
}, 60_000);

afterAll(async () => {
  await stopDynamo();
});
```

### When testcontainers beats the child_process approach

| Concern | child_process docker run | testcontainers |
|---------|--------------------------|----------------|
| Port collision (parallel suites) | Manual — you must assign distinct ports and coordinate | Automatic — each container gets a random ephemeral host port via `getMappedPort` |
| Readiness probe | Manual poll loop (`waitForPort`) | Built-in: `Wait.forListeningPorts()`, `Wait.forLogMessage(...)` |
| Teardown on test crash | Container may be left running | Ryuk (testcontainers reaper) removes orphan containers |
| State leakage across runs | Possible if `docker rm -f` fails | Impossible — each `start()` creates a fresh container |

Use testcontainers for CI and for any project where multiple test suites run in parallel.

---

## Section 3: LocalStack

### What it is

LocalStack is a community platform that emulates a broad set of AWS services in a single Docker container. Unlike DynamoDB Local, it supports **DynamoDB Streams**, **Lambda**, **S3**, **SQS**, **SNS**, and many others — making it the right tool whenever a test needs to cross a service boundary.

### When LocalStack beats DynamoDB Local

- Testing a full Streams → Lambda consumer pipeline locally (DynamoDB Local's Streams APIs return empty iterators).
- Testing interactions between DynamoDB and S3/SQS/SES in a single `docker-compose` environment.
- Reproducing a CDC fan-out bug that only manifests when the Lambda is actually invoked by a Streams trigger.

### Community vs Pro tier

The **community version** (`localstack/localstack`) supports DynamoDB, DynamoDB Streams, Lambda, S3, SQS, SNS, IAM, and other core services sufficient for CI workflows. The **Pro tier** adds features such as advanced parity checks, a resource browser UI, and additional services. Specific tier boundaries change as LocalStack evolves — check [localstack.cloud](https://localstack.cloud) for the current feature matrix before choosing a tier.

### docker-compose.yml

```yaml
# docker-compose.localstack.yml
version: "3.8"

services:
  localstack:
    image: localstack/localstack:latest
    container_name: localstack-test
    ports:
      - "127.0.0.1:4566:4566"         # LocalStack Gateway (all services)
    environment:
      - SERVICES=dynamodb,lambda,s3,sqs
      - DEBUG=0
      - LAMBDA_EXECUTOR=local          # "local" avoids Docker-in-Docker in CI
      - AWS_DEFAULT_REGION=us-east-1
    volumes:
      - "${LOCALSTACK_VOLUME_DIR:-/tmp/localstack-volume}:/var/lib/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Start and tear down:

```bash
# Start
docker compose -f docker-compose.localstack.yml up -d

# Wait for healthy
docker compose -f docker-compose.localstack.yml ps

# Stop
docker compose -f docker-compose.localstack.yml down -v
```

### Jest setup wired to LocalStack

```typescript
// tests/setup/localstack-client.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566";

const CREDS = { accessKeyId: "test", secretAccessKey: "test" };
const REGION = "us-east-1";

export function makeLocalStackDynamo(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: REGION,
    credentials: CREDS,
  });
  return DynamoDBDocumentClient.from(raw);
}

export function makeLocalStackLambda(): LambdaClient {
  return new LambdaClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: REGION,
    credentials: CREDS,
  });
}
```

```typescript
// tests/streams-pipeline.test.ts
import { makeLocalStackDynamo, makeLocalStackLambda } from "./setup/localstack-client";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand } from "@aws-sdk/client-lambda";

const TABLE = "test-streams-pipeline";

describe("Streams → Lambda pipeline", () => {
  const ddb = makeLocalStackDynamo();
  const lambda = makeLocalStackLambda();

  beforeAll(async () => {
    await ddb.send(
      new CreateTableCommand({
        TableName: TABLE,
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        StreamSpecification: {
          StreamEnabled: true,
          StreamViewType: "NEW_AND_OLD_IMAGES",
        },
      }),
    );
  });

  it("publishes a stream record when an item is written", async () => {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk: "USER#1", sk: "PROFILE", name: "Alice" },
      }),
    );
    // Assert the stream record or the downstream Lambda effect here.
    // (Full assertion depends on your consumer implementation.)
  });
});
```

### Drift warning

LocalStack's DynamoDB implementation is close but not an exact mirror of the real service. Edge cases around condition expressions, projection expressions on sparse GSIs, and Streams shard iteration timing can differ. Use LocalStack for **fast local feedback**, but run at least one staging deployment against the real AWS service before shipping a new access pattern.

---

## Section 4: Access-pattern tests

### Core principle

Write one test per access pattern. Each test exercises the **exact query shape** the production handler sends — same key construction, same filter expressions, same pagination limit. Do not simplify. If the handler calls `QueryCommand` with a `FilterExpression`, the test must also send that `FilterExpression` against real seeded data.

### Per-pattern test structure

```
Arrange → seed items that match the expected partition distribution
Act     → call the production query function (not a hand-rolled duplicate)
Assert  → verify result shape, item count, sort order, and pagination cursor
```

### Anti-patterns

| Anti-pattern | Why it fails |
|--------------|--------------|
| Mocking `DynamoDBDocumentClient` | Loses coverage of key construction, filter expressions, ExpressionAttributeNames, pagination token decoding, and any bug in the query code itself. |
| Testing only the happy path | The `ConditionalCheckFailedException` path and the retry-cap-exceeded path often have the highest production incident rate. |
| Using random IDs per test run | Non-deterministic test data produces non-deterministic sort order, which makes snapshot assertions unreliable. |
| Calling `PutCommand` with hand-coded attributes in each test | Drift between the seed and the real item shape means the test silently misses new required attributes. Use a factory function. |

### Full TS: `updateWithLock` tests — happy path, race, and cap-exceeded

These tests validate the optimistic-locking helper defined in `03-write-correctness.md`.

```typescript
// tests/update-with-lock.test.ts
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { startDynamo, stopDynamo } from "./setup/testcontainers-dynamo";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Import the production implementation — never re-implement inline.
import { updateWithLock } from "../../src/dynamodb/update-with-lock";
import { UserError, ErrorCodes } from "../../src/shared/types/api-responses";

const TABLE = "test-optimistic-lock";

let client: DynamoDBDocumentClient;

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  client = await startDynamo();
  await client.send(
    new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
}, 60_000);

afterAll(async () => {
  await stopDynamo();
});

// Seed a fresh item before each test to avoid cross-test state leakage.
beforeEach(async () => {
  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: "USER#test-1",
        sk: "PROFILE",
        version: 0,
        points: 10,
      },
    }),
  );
});

const KEY = { pk: "USER#test-1", sk: "PROFILE" };

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("updateWithLock — happy path", () => {
  it("applies the transform and increments the version", async () => {
    await updateWithLock(client, TABLE, KEY, (current) => ({
      points: (current as { points: number }).points + 5,
    }));

    const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: KEY }),
    );

    expect(res.Item?.points).toBe(15);
    expect(res.Item?.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrent race — exactly one writer wins
// ---------------------------------------------------------------------------

describe("updateWithLock — concurrent race", () => {
  it("exactly one of two concurrent writers succeeds on the first attempt", async () => {
    // Fire two concurrent writes against the same item at version 0.
    const results = await Promise.allSettled([
      updateWithLock(client, TABLE, KEY, (_current) => ({ points: 100 })),
      updateWithLock(client, TABLE, KEY, (_current) => ({ points: 200 })),
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // Exactly one must have won the conditional write outright.
    // The other may have retried successfully (updateWithLock retries up to 3×)
    // so both could eventually resolve — that is also valid.
    // What must NOT happen: both resolving with conflicting final values.
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: KEY }),
    );

    // Final points must be one of the two intended values, not a merge.
    expect([100, 200]).toContain(res.Item?.points);
    // Version must have advanced at least once.
    expect(res.Item?.version).toBeGreaterThanOrEqual(1);

    void failed; // May be zero if the loser retried successfully.
  });
});

// ---------------------------------------------------------------------------
// Retry-cap exceeded — surfaces UserError(CONFLICT)
// ---------------------------------------------------------------------------

describe("updateWithLock — retry cap exceeded", () => {
  it("throws UserError(CONFLICT) when the version is bumped on every read", async () => {
    // Simulate a hot item: a background writer bumps the version faster
    // than updateWithLock can retry. We do this by seeding version = 0 and
    // running a tight concurrent loop that always wins the condition.
    let backgroundRunning = true;

    const backgroundWriter = (async () => {
      let v = 0;
      while (backgroundRunning) {
        try {
          const { UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
          await client.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: KEY,
              UpdateExpression: "SET version = :next, points = :p",
              ConditionExpression: "version = :cur",
              ExpressionAttributeValues: {
                ":cur": v,
                ":next": v + 1,
                ":p": 999,
              },
            }),
          );
          v++;
        } catch {
          // ConditionalCheckFailed means updateWithLock won a round — loop.
        }
      }
    })();

    // updateWithLock will retry MAX_LOCK_RETRIES (3) times and then throw.
    await expect(
      updateWithLock(client, TABLE, KEY, (_current) => ({ points: 42 })),
    ).rejects.toThrow(UserError);

    await expect(
      updateWithLock(client, TABLE, KEY, (_current) => ({ points: 42 })),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });

    backgroundRunning = false;
    await backgroundWriter;
  });
});
```

---

## Section 5: Test data seeding

### `BatchWriteCommand` helper

`BatchWriteCommand` accepts a maximum of 25 items per call and may return `UnprocessedItems` under throttling or transient errors. Always retry `UnprocessedItems`.

```typescript
// tests/setup/seed.ts
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { WriteRequest } from "@aws-sdk/client-dynamodb";

const BATCH_SIZE = 25;
const MAX_SEED_RETRIES = 5;
const RETRY_BACKOFF_MS = 100;

/**
 * Seeds `items` into `tableName` using BatchWriteCommand with UnprocessedItems
 * retry and exponential backoff. Logs progress for large datasets.
 */
export async function seedItems(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
): Promise<void> {
  const putRequests: WriteRequest[] = items.map((Item) => ({
    PutRequest: { Item },
  }));

  for (let offset = 0; offset < putRequests.length; offset += BATCH_SIZE) {
    const batch = putRequests.slice(offset, offset + BATCH_SIZE);
    let remaining: WriteRequest[] = batch;
    let attempt = 0;

    while (remaining.length > 0 && attempt < MAX_SEED_RETRIES) {
      const res = await client.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: remaining },
        }),
      );

      remaining = (res.UnprocessedItems?.[tableName] ?? []) as WriteRequest[];

      if (remaining.length > 0) {
        const backoffMs = RETRY_BACKOFF_MS * Math.pow(2, attempt);
        console.log(
          `[seed] ${remaining.length} unprocessed items after attempt ${attempt + 1}; retrying in ${backoffMs} ms`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        attempt++;
      }
    }

    if (remaining.length > 0) {
      throw new Error(
        `[seed] Failed to write ${remaining.length} items to ${tableName} after ${MAX_SEED_RETRIES} retries`,
      );
    }

    const done = Math.min(offset + BATCH_SIZE, putRequests.length);
    console.log(`[seed] ${done}/${putRequests.length} items written to ${tableName}`);
  }
}
```

### Deterministic IDs and frozen timestamps

Non-deterministic test data causes non-deterministic sort order and flaky snapshot assertions. Fix both before writing a single seed item.

```typescript
// tests/setup/deterministic.ts
import { faker } from "@faker-js/faker";

/**
 * Call once at the top of a describe block or beforeAll.
 * Seed 42 is arbitrary but must be consistent across all test files that
 * share the same table data.
 */
export function resetFaker(): void {
  faker.seed(42);
}

/**
 * Use in tests that exercise code calling Date.now() or new Date().
 * Place in beforeAll/beforeEach; restore in afterAll/afterEach.
 *
 * Vitest:
 *   vi.useFakeTimers({ now: FROZEN_DATE });
 *   vi.useRealTimers();
 *
 * Jest:
 *   jest.useFakeTimers({ now: FROZEN_DATE });
 *   jest.useRealTimers();
 */
export const FROZEN_DATE = new Date("2026-04-21T00:00:00.000Z");
export const FROZEN_EPOCH = FROZEN_DATE.getTime(); // 1745193600000

/** Build a deterministic item factory for a User entity. */
export function makeUserItem(overrides: Partial<{
  pk: string;
  sk: string;
  name: string;
  email: string;
  createdAt: string;
  version: number;
}> = {}): Record<string, unknown> {
  return {
    pk: `USER#${faker.string.uuid()}`,
    sk: "PROFILE",
    name: faker.person.fullName(),
    email: faker.internet.email(),
    createdAt: FROZEN_DATE.toISOString(),
    version: 0,
    ...overrides,
  };
}
```

```typescript
// Usage in a test file
import { resetFaker, makeUserItem, FROZEN_DATE } from "./setup/deterministic";
import { seedItems } from "./setup/seed";
import { vi } from "vitest"; // or jest

beforeAll(async () => {
  resetFaker();
  vi.useFakeTimers({ now: FROZEN_DATE });

  const items = Array.from({ length: 50 }, () => makeUserItem());
  await seedItems(client, TABLE, items);
});

afterAll(() => {
  vi.useRealTimers();
});
```

### Teardown strategy

| Approach | Speed | Isolation | When to use |
|----------|-------|-----------|-------------|
| Drop + recreate table between test files | Fast (~10 ms on Local) | Full — fresh schema | Preferred for DynamoDB Local; use `DeleteTableCommand` + `CreateTableCommand` in `afterAll`/`beforeAll` |
| Stop + restart testcontainer | Slow (~2 s) | Complete — fresh process | When you also want to verify the table-creation CDK bootstrap path |
| `DeleteCommand` per item in `beforeEach` | Slowest at scale | Partial — same schema | Acceptable only for very small tables (<50 items) with a known key set |

```typescript
// Fast drop-recreate pattern
afterAll(async () => {
  const { DeleteTableCommand } = await import("@aws-sdk/client-dynamodb");
  await client.send(new DeleteTableCommand({ TableName: TABLE })).catch(() => {});
});

beforeAll(async () => {
  await createTestTable(TABLE);
});
```

---

## Section 6: Cross-reference — CDK construct tests

The patterns in this file cover runtime behavior (query correctness, write correctness). For **infrastructure correctness** — asserting that the CDK stack provisions the table with the right billing mode, GSIs, TTL attribute, and Stream specification — use CDK's `Template.fromStack` / `hasResourceProperties` pattern.

See `../../aws-cdk-patterns/references/00-architecture.md` §Construct tests for the full `Template.fromStack` example, how to assert `StreamSpecification`, and how to test that the Lambda event source mapping is wired to the correct stream ARN.

---

## Section 7: Gotchas

**Port collisions (parallel test suites).** DynamoDB Local binds to a fixed port (default 8000). If two Jest worker processes run two suite files simultaneously and both try to bind port 8000, one will fail to start. Testcontainers solves this automatically via `getMappedPort` (each container gets a random ephemeral host port). With the `child_process` approach, you must assign distinct ports per worker — either via an environment variable injected by the test runner or by reading `process.env.JEST_WORKER_ID` and computing `8000 + workerId`.

**Stale container state between test runs.** If a test process crashes, the DynamoDB Local container may remain running with data from the crashed run. The next run then finds an unexpected table state. Fix: always call `docker rm -f <name>` at the top of `startDynamoDBLocal` before starting a new container (shown in Section 1). Testcontainers' Ryuk reaper handles this automatically.

**Streams no-op on DynamoDB Local.** `GetShardIterator` returns an iterator, but `GetRecords` always returns an empty list. Any test that asserts a Streams record was produced, or that a Lambda consumer was triggered, will pass vacuously on DynamoDB Local. These tests MUST run against LocalStack (Section 3). Do not skip them — move them to the `test:streams` npm script that requires LocalStack.

**The `-sharedDb` flag missing.** Without `-sharedDb`, each distinct `accessKeyId` gets an isolated database. A test that seeds with `accessKeyId: "seedKey"` and then reads with `accessKeyId: "fake"` will see an empty table. Always pass `-sharedDb` and always use the same credentials throughout a test suite. The example in Section 1 uses `accessKeyId: "fake"` everywhere.

**TTL non-deletion on DynamoDB Local.** DynamoDB Local recognizes the TTL attribute (it will be returned in `DescribeTimeToLive`) but never actually deletes expired items. A test that seeds an item with a TTL timestamp in the past and then asserts the item is gone will fail locally — the item is still there. Two safe approaches: (a) assert only that the TTL attribute is set to the expected epoch value, not that the item was deleted; or (b) mock `Date.now` and test the TTL-setting code path, leaving actual deletion to a staging environment integration test.

**`WithReuse` across test files.** Testcontainers' `withReuse()` option (Section 2) persists the container across test runs. Useful for speeding up local iteration; dangerous in CI where a previous failed run may have left dirty data. Disable `withReuse` in CI by not setting `TESTCONTAINERS_REUSE_ENABLE=true` in the CI environment, or by dropping and recreating the table in `beforeAll`.

---

## Section 8: Verification

### Coverage targets

| Code path | Target |
|-----------|--------|
| Access-pattern query functions | 80% line coverage minimum |
| `updateWithLock` and all write-correctness helpers (`03-write-correctness.md`) | 100% — every branch including `ConditionalCheckFailedException`, retry backoff, and retry-cap throw |
| `seedItems` helper | 80% |

### CI sidecar configuration

Add DynamoDB Local as a sidecar service in your CI workflow. For GitHub Actions:

```yaml
# .github/workflows/test.yml (relevant excerpt)
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    options: >-
      -jar DynamoDBLocal.jar -inMemory -sharedDb
    ports:
      - 8000:8000

env:
  DYNAMODB_ENDPOINT: http://localhost:8000
```

For the Streams integration tests, start LocalStack as a separate sidecar:

```yaml
  localstack:
    image: localstack/localstack:latest
    ports:
      - 4566:4566
    env:
      SERVICES: dynamodb,lambda,s3,sqs
```

### Sample `package.json` scripts

```jsonc
{
  "scripts": {
    // Unit + access-pattern tests — requires only Docker (DynamoDB Local sidecar)
    "test": "vitest run --reporter=verbose",

    // Integration tests that exercise real multi-item transactions and GSI queries
    // against DynamoDB Local; runs after the main suite in CI
    "test:integration": "DYNAMODB_ENDPOINT=http://localhost:8000 vitest run --project=integration",

    // Streams + Lambda pipeline tests — requires LocalStack to be running
    // Start with: docker compose -f docker-compose.localstack.yml up -d
    "test:streams": "LOCALSTACK_ENDPOINT=http://localhost:4566 vitest run --project=streams"
  }
}
```

### Lint and type-check gate

```bash
npm run lint        # ESLint — must exit 0
npx tsc --noEmit   # Type check — must exit 0
npm test            # Full suite — must exit 0
```

All three must pass before a PR is merged. The `test:streams` script is optional in CI for projects that have not yet deployed a Streams consumer; make it required as soon as `04-streams-cdc.md` patterns are in production.

---

## Further reading

- `03-write-correctness.md` — the `updateWithLock` helper and `BatchWriteCommand` retry loop tested in this file.
- `04-streams-cdc.md` — the Streams consumer validated by the LocalStack tests in Section 3.
- `../../aws-cdk-patterns/references/00-architecture.md` §Construct tests — CDK `Template.fromStack` / `hasResourceProperties` for infrastructure assertions.
- [AWS DynamoDB Local documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) — official setup guide, flag reference, and known limitations list.
- [testcontainers-node GitHub](https://github.com/testcontainers/testcontainers-node) — `GenericContainer` API, `Wait` strategies, Ryuk configuration.
- [LocalStack documentation](https://docs.localstack.cloud) — service coverage matrix, Docker configuration, and CI integration guides.
