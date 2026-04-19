# Serverless API — Lambda + DynamoDB + API Gateway

**Builds:** A complete hexagonal module that exposes a REST endpoint through API Gateway with a Cognito authorizer, routes the request to a `NodejsFunction` Lambda, and persists data in DynamoDB via a port/adapter split. Includes the CDK construct that wires the table, Lambda, log group, and route together, plus ARM64 bundling with a shared Lambda layer.
**When to use:** Adding a new CRUD-style endpoint to an existing CDK project that already has the shared infrastructure from `00-architecture.md` in place, or scaffolding the first module on a greenfield backend stack.
**Prerequisites:** Read `00-architecture.md` for the hexagonal + DDD structure and the `SharedInfra` injection pattern. Read `05-shared-utilities.md` for `parseBody`, `createResponse`, `withCors`, `validateEnv`, and `loadSecret`. Both files are referenced by name throughout this pattern.

## Contents

1. **Architecture** — Request flow through authorizer, handler, service, port, and adapter.
2. **Template** — Full hexagonal module using `orders` as the generic domain: handler, service, port, adapter, types, CDK infra.
3. **Lambda bundling config** — ARM64, shared layer, `externalModules`, minify, source maps.
4. **Gotchas catalog** — Symptom / root cause / fix table with common failures.
5. **Deployment notes** — Ordering, first-time deploys, CLI profile discipline.
6. **Verification** — Post-deploy checks with `curl`, `aws dynamodb query`, and CloudWatch logs.
7. **Further reading** — CDK construct docs and sibling references.

## Section 1: Architecture

Every authenticated request follows the same five hops.

```
+----------------+     +-------------------+     +----------------+
|  SPA / client  | --> |  API Gateway REST |     |    Cognito     |
|                |     |   w/ authorizer   | <-- |   user pool    |
+----------------+     +---------+---------+     +----------------+
                                 |
                                 v
                       +---------+---------+
                       |  Lambda handler   |
                       |  (withCors wrap)  |
                       +---------+---------+
                                 |
                                 v
                       +---------+---------+
                       |  Domain service   |
                       +---------+---------+
                                 |
                                 v
                       +---------+---------+
                       |   Port (iface)    |
                       +---------+---------+
                                 |
                                 v
                       +---------+---------+     +----------------+
                       |  DynamoDB adapter | --> |  DynamoDB tbl  |
                       +-------------------+     +----------------+
```

- **API Gateway REST method** receives the request, validates the JWT against the Cognito user pool via the authorizer attached in `ApiGatewayConstruct`, and invokes the Lambda with the claims already populated in `event.requestContext.authorizer.claims`.
- **Handler** wraps its body with `withCors()` so CORS headers, security headers, and the request ID are applied uniformly. It extracts the user ID from claims, parses the body with `parseBody()` when applicable, calls the service, and returns through `createResponse()`. No AWS SDK calls live here.
- **Service** holds the domain logic. It depends on port interfaces, constructs a real adapter by default, and accepts mocks via constructor injection for tests.
- **Port** is a TypeScript interface in the domain layer. It names the operations the service needs in domain terms (`getOrder`, `listOrders`, `createOrder`), never in infrastructure terms (`getItem`, `queryByGSI`).
- **Adapter** implements the port with concrete AWS SDK calls. It is the only file that imports `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`.

Cross-cutting principles from `00-architecture.md` apply: validate environment variables at cold start, parse request bodies with Zod, return responses through shared helpers, and define the Lambda's log group explicitly with a retention period.

## Section 2: Template

This template shows a single module, `orders`, with one handler (`list-orders`). Additional handlers (`get-order`, `create-order`, `cancel-order`) follow the same structure — one handler file each, all sharing the service, port, adapter, and types.

### `modules/orders/src/handlers/list-orders.handler.ts`

```typescript
import type { APIGatewayProxyEvent } from "aws-lambda";
import { withCors, createResponse } from "shared/utils/cors";
import { ErrorCodes } from "shared/types/api-responses";
import { validateEnv } from "shared/utils/validate-env";
import { OrderService } from "../services/order.service";

const { ORDERS_TABLE } = validateEnv(["ORDERS_TABLE"] as const);
const service = new OrderService();

export const handler = withCors(async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return createResponse(
      401,
      { success: false, error: { code: ErrorCodes.UNAUTHORIZED, message: "Missing user" } },
      event,
    );
  }
  const orders = await service.listOrders(userId);
  return createResponse(200, { success: true, data: orders }, event);
});
```

The handler calls `validateEnv` at module scope so the Lambda fails fast on cold start if `ORDERS_TABLE` is missing or empty. The `service` instance is also module-scoped so the DynamoDB client inside its default adapter is reused across warm invocations.

### `modules/orders/src/services/order.service.ts`

```typescript
import { OrderPort, OrderAdapter } from "../ports/order.port";
import type { Order } from "../types";

export class OrderService {
  constructor(private readonly orderPort: OrderPort = new OrderAdapter()) {}

  async listOrders(userId: string): Promise<Order[]> {
    return this.orderPort.listOrders(userId);
  }
}
```

The service accepts a port via constructor with a sensible default (the real adapter). Tests construct `new OrderService(fakeOrderPort)` and never touch AWS credentials. A test that needs credentials is a broken-decoupling symptom — see the gotchas catalog.

### `modules/orders/src/ports/order.port.ts`

```typescript
import type { Order, CreateOrderInput } from "../types";

export interface OrderPort {
  getOrder(orderId: string): Promise<Order | null>;
  listOrders(userId: string): Promise<Order[]>;
  createOrder(input: CreateOrderInput): Promise<Order>;
}

export { OrderAdapter } from "../adapters/order.adapter";
```

The port file re-exports `OrderAdapter` as a convenience so services have one import site for both the interface and the default implementation.

### `modules/orders/src/adapters/order.adapter.ts`

```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { validateEnv } from "shared/utils/validate-env";
import type { Order, CreateOrderInput } from "../types";
import type { OrderPort } from "../ports/order.port";

const { ORDERS_TABLE } = validateEnv(["ORDERS_TABLE"] as const);
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export class OrderAdapter implements OrderPort {
  async getOrder(orderId: string): Promise<Order | null> {
    const res = await client.send(new GetCommand({
      TableName: ORDERS_TABLE,
      Key: { pk: `ORDER#${orderId}`, sk: `ORDER#${orderId}` },
    }));
    return (res.Item as Order) ?? null;
  }

  async listOrders(userId: string): Promise<Order[]> {
    const res = await client.send(new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: "user_id-index",
      KeyConditionExpression: "user_id = :u",
      ExpressionAttributeValues: { ":u": userId },
    }));
    return (res.Items ?? []) as Order[];
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const order: Order = {
      pk: `ORDER#${input.orderId}`,
      sk: `ORDER#${input.orderId}`,
      user_id: input.userId,
      status: "pending",
      created_at: new Date().toISOString(),
      ...input,
    };
    await client.send(new PutCommand({
      TableName: ORDERS_TABLE,
      Item: order,
      ConditionExpression: "attribute_not_exists(pk)",
    }));
    return order;
  }
}
```

The adapter wraps the low-level `DynamoDBClient` with `DynamoDBDocumentClient` so that `Item` payloads are plain JavaScript objects. `ConditionExpression: "attribute_not_exists(pk)"` on `createOrder` makes the put idempotent at the DynamoDB level — a duplicate `orderId` raises `ConditionalCheckFailedException` rather than silently overwriting the previous record.

### `modules/orders/src/types.ts`

```typescript
import { z } from "zod";

export const CreateOrderSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string(),
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export interface Order extends CreateOrderInput {
  pk: string;
  sk: string;
  user_id: string;
  status: "pending" | "confirmed" | "shipped" | "cancelled";
  created_at: string;
}
```

Zod schemas live next to the domain types. Handlers import the schema to validate input with `parseBody`; services and adapters import the TypeScript types inferred from those schemas. The domain type extends the input type and adds persistence-only fields (`pk`, `sk`, `user_id`, `status`, `created_at`).

### `modules/orders/infra/orders.module.ts`

```typescript
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";
import type { SharedInfra } from "shared/infra/types";

export interface OrdersModuleProps {
  shared: SharedInfra;
  /** "dev" | "staging" | "prod" — drives isProd branching. */
  stage: string;
  /** Per-deploy segment ("dev-alice", "staging", "prod") appended to resource
   *  names so two developers can deploy to the same AWS account without
   *  colliding on table names, log groups, or Lambdas. */
  stackSuffix: string;
}

const LAYER_EXTERNAL_MODULES = [
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/lib-dynamodb",
  "@aws-sdk/client-secrets-manager",
  "zod",
  "uuid",
];

export class OrdersModule extends Construct {
  readonly ordersTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: OrdersModuleProps) {
    super(scope, id);

    const isProd = props.stage === "prod";

    this.ordersTable = new dynamodb.Table(this, "OrdersTable", {
      tableName: `orders-${props.stackSuffix}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.ordersTable.addGlobalSecondaryIndex({
      indexName: "user_id-index",
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const listOrdersLogGroup = new logs.LogGroup(this, "ListOrdersLogs", {
      logGroupName: `/aws/lambda/orders-list-${props.stackSuffix}`,
      retention: isProd ? logs.RetentionDays.SIX_MONTHS : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const listOrdersFn = new nodejs.NodejsFunction(this, "ListOrdersFn", {
      entry: path.join(__dirname, "../src/handlers/list-orders.handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: isProd ? 512 : 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: listOrdersLogGroup,
      layers: [props.shared.layer.layer],
      environment: {
        ORDERS_TABLE: this.ordersTable.tableName,
        ALLOWED_ORIGINS: props.shared.allowedOrigins.join(","),
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: LAYER_EXTERNAL_MODULES,
        target: "node20",
      },
    });

    this.ordersTable.grantReadData(listOrdersFn);

    props.shared.api.root
      .addResource("orders")
      .addMethod("GET", new apigateway.LambdaIntegration(listOrdersFn), {
        authorizer: props.shared.cognito.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      });
  }
}
```

The construct owns three things: the table (including its GSI), the Lambda (with its explicit log group), and the route attached to the shared API Gateway. It does not own the API, the authorizer, or the layer — those arrive via `props.shared`.

`pointInTimeRecovery` defends against accidental deletes and adapter bugs in production; it is disabled in non-prod to keep costs predictable. `removalPolicy: RETAIN` in prod means a stack deletion does not take the table with it — the table has to be removed explicitly if the intention is truly to delete data.

## Section 3: Lambda bundling config

Four decisions keep Lambda cold starts fast and deploys cheap.

- **ARM64 by default.** `architecture: lambda.Architecture.ARM_64` runs the Lambda on Graviton. Pricing is roughly 20% lower than x86, and cold starts are measurably faster for Node workloads. Use x86_64 only when a dependency ships native binaries that lack an ARM build — rare for pure-JS stacks.
- **Shared layer.** `layers: [props.shared.layer.layer]` attaches the pre-bundled layer from `LambdaLayerConstruct`. Common heavy dependencies (AWS SDK v3 clients, Zod, UUID) live in the layer and are not re-bundled into every Lambda.
- **`externalModules` must match the layer exactly.** The `LAYER_EXTERNAL_MODULES` constant lists every module name present in the layer's `nodejs/node_modules/` directory. `esbuild` treats those names as external and emits `require("zod")` calls that resolve against the layer at runtime. A mismatch — layer contains `zod@3.22`, Lambda bundle has no `zod` because it was externalized, and `externalModules` omits it — produces a runtime `MODULE_NOT_FOUND`. Keep the list in source control in one place and import it from every module.
- **`minify: true` plus `sourceMap: true` plus `NODE_OPTIONS: "--enable-source-maps"`.** Minify shrinks the deployment package; source maps are uploaded alongside the bundle so CloudWatch stack traces resolve to the original TypeScript line numbers. Without the `NODE_OPTIONS` flag Node.js ignores the source maps and reports minified positions that are useless to diagnose an incident.

The `target: "node20"` in bundling matches the `runtime: NODEJS_20_X` setting so `esbuild` emits ES features supported by the Lambda runtime without polyfills.

## Section 4: Gotchas catalog

| Symptom | Root cause | Fix |
|---------|------------|-----|
| Lambda throttles at 10 concurrent executions with `TooManyRequestsException` even though the function is otherwise healthy. | The AWS account's default concurrency quota is 10. Every newly created Lambda competes against that shared pool. | Request an account-level service quota increase before the first production deploy: `aws service-quotas request-service-quota-increase --service-code lambda --quota-code L-B99A9384 --desired-value <N> --profile <project>`. |
| Cold starts are measurably slower than expected for a pure-JS Lambda with no VPC. | Bundle size is too large (layer not attached, `externalModules` missing items), architecture is x86_64 instead of ARM64, or a latency-critical path is not using provisioned concurrency. | Confirm `architecture: Architecture.ARM_64`, verify `layers:` includes the shared layer, verify `externalModules` matches the layer contents exactly, inspect the uploaded asset size in CloudFormation events, and add provisioned concurrency only for paths where p99 latency is a real constraint. |
| Handler file imports `@aws-sdk/client-dynamodb` directly and contains inline DynamoDB calls. | The hexagonal split was skipped; the handler is doing adapter work. | Extract the SDK calls into an adapter, declare a port interface the handler's service depends on, and inject the real adapter via constructor default. Handlers must never import the AWS SDK. |
| Service unit test fails with `CredentialsProviderError: Could not load credentials from any providers`. | The service is instantiating a real adapter by default and the test forgot to pass a mock port. | Construct the service under test with explicit mocks: `new OrderService(mockOrderPort)`. Service tests must never touch AWS — the defaults exist only for production code paths. |
| `process.env.ORDERS_TABLE` returns `undefined` or an empty string inside the handler at cold start. | `validateEnv` was never called, or the env var was not configured on the Lambda in CDK. | Call `validateEnv(["ORDERS_TABLE"] as const)` at module scope and destructure the returned object. Confirm the CDK `environment:` block on the `NodejsFunction` sets the variable. Never fall back to `process.env.X \|\| ""`. |
| A request that should return a list of related records issues one DynamoDB call per record — classic N+1 pattern. | The adapter is fetching single rows in a loop instead of using a single query or batch operation. | Prefer a GSI that lets the use case be satisfied by a single `QueryCommand`. If the access is genuinely keyed by unrelated primary keys, use `BatchGetCommand` (up to 100 keys per call). Revisit the access pattern in `04-database.md` before adding a workaround. |
| Lambda returns `AccessDeniedException` when it reads from the DynamoDB table. | The CDK construct forgot the IAM grant. | Call `this.ordersTable.grantReadData(listOrdersFn)` — or `grantWriteData` / `grantReadWriteData` — in the infra construct. Rely on grants, never hand-written IAM policies, so the principle of least privilege is enforced construct-side. |
| Lambda runs fine locally via `sam local` but fails in the deployed account with `MODULE_NOT_FOUND: Cannot find module 'zod'`. | `externalModules` was set but the dependency is not actually present in the shared layer. | Rebuild the layer with the missing module, or remove the entry from `externalModules` so `esbuild` bundles it into the Lambda zip. Keep the layer manifest and the `externalModules` list identical. |

## Section 5: Deployment notes

Deployments follow a fixed ordering driven by the shared infrastructure.

- **Backend stack deploys first.** The shared API Gateway and Cognito user pool are created inside the backend stack, and module constructs attach their routes to `props.shared.api.root`. Any module deploy assumes the API Gateway stage already exists.
- **Module routes are additive within the same stack.** Adding a new module in `modules/` and a new `new OrdersModule(this, "Orders", { shared, stage })` line in the main stack is the only change required to expose a new endpoint. CDK computes the diff, adds the Lambda, adds the route, and attaches the authorizer without recreating the API.
- **Runtime configuration is read via `validateEnv` at cold start.** Lambda environment variables populated from CDK (`ORDERS_TABLE`, `ALLOWED_ORIGINS`, `NODE_OPTIONS`) are available at `process.env` by the time the handler module is evaluated. The `const { ORDERS_TABLE } = validateEnv(...)` call at module scope establishes a typed, fail-fast contract.
- **First deploy vs. subsequent deploys.** The very first deploy creates the Cognito user pool, the API Gateway REST API, the Lambda layer, and the per-module tables in a single `cdk deploy BackendStack` pass. Subsequent deploys touch only the resources that changed. A module whose code has not changed will not trigger a Lambda update if the bundle hash is stable — `cdk diff` shows this before `cdk deploy`.
- **Always pass `--profile <project>`.** `cdk deploy`, `cdk diff`, `cdk synth`, and every `aws` CLI command run during development or CI must carry `--profile <project>` so credentials never fall back to the default profile or ambient environment. Cross-cutting principle from the skill root: never run AWS commands without a project profile.

## Section 6: Verification

After a successful deploy, verify the endpoint is reachable and the data flow works end-to-end.

### 1. Obtain a Cognito token

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <cognito-client-id> \
  --auth-parameters USERNAME=<email>,PASSWORD=<password> \
  --profile <project> \
  --query 'AuthenticationResult.IdToken' \
  --output text)
```

For programmatic tests prefer a dedicated test user whose password is rotated through CI secrets, not a real end-user account.

### 2. Call the endpoint

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://<api-id>.execute-api.us-east-1.amazonaws.com/<stage>/orders
```

A 200 response with a JSON body matching `ApiResponse<Order[]>` confirms the full path: authorizer validates the token, Lambda resolves the user ID from claims, adapter queries the GSI, service returns the typed list, handler wraps the response with `createResponse`.

A 401 response means the authorizer rejected the token — check the token's issuer (`iss`) matches the user pool ARN and the audience (`aud`) matches the app client ID.

### 3. Confirm persistence in DynamoDB

```bash
aws dynamodb query \
  --table-name orders-<stackSuffix> \
  --index-name user_id-index \
  --key-condition-expression "user_id = :u" \
  --expression-attribute-values '{":u":{"S":"<cognito-sub>"}}' \
  --profile <project>
```

The returned `Items` array must match the handler's response. A mismatch means either the adapter is writing with a different key pattern than it reads, or the GSI has not finished propagating (GSI writes are eventually consistent — retry briefly before concluding there is a bug).

### 4. Check CloudWatch logs

The explicit log group is `/aws/lambda/orders-list-<stackSuffix>`. Structured log lines emitted by the handler — request ID, user ID, duration — should appear within a few seconds of the request. If the log group is empty the Lambda may have failed before emitting any logs (usually an import-time error from `validateEnv`); in that case the Lambda metrics `Errors` and `Invocations` will show non-zero counts even with no log output, and the detail lives in the Lambda configuration's execution role / VPC / runtime errors surface.

## Section 7: Further reading

- [`aws-lambda-nodejs` construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html) — `NodejsFunction`, bundling options, `externalModules`, layer attachment.
- [`aws-dynamodb` construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html) — `Table`, `addGlobalSecondaryIndex`, billing modes, grants.
- [`aws-apigateway` construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html) — `RestApi`, `LambdaIntegration`, `CognitoUserPoolsAuthorizer`.
- Sibling references: `00-architecture.md` (hexagonal + DDD, `SharedInfra`), `04-database.md` (DynamoDB access patterns, GSIs, single-table vs. multi-table), `05-shared-utilities.md` (`parseBody`, `createResponse`, `withCors`, `validateEnv`, `loadSecret`, `ApiResponse<T>`, `ErrorCodes`).
