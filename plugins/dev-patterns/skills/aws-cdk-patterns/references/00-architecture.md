# Architecture

**Builds:** A complete CDK project layout: hexagonal Lambda modules, DDD bounded contexts, a two-stack backend/frontend split (when applicable), and shared infrastructure constructs.
**When to use:** Starting a new CDK project, or restructuring an existing CDK project that has grown past a single handler.
**Prerequisites:** None. This file is the foundation; read it first.

## Contents

1. **When to apply this architecture** — Default applies to any non-trivial app; explicit exception for extra-simple cases with thresholds.
2. **Hexagonal architecture for Lambda functions** — Handlers, services, ports, adapters; dependency injection; test strategy per layer.
3. **DDD module structure** — One bounded context per module; directory layout; decision tree for new Lambda vs. new module.
4. **Two-stack architecture (backend + frontend)** — Backend exports, frontend consumes via `config.json`; when stateful/stateless split actually applies.
5. **Shared infrastructure constructs** — Cognito, API Gateway, Lambda layer, audit log, event bus, monitoring; injection pattern.
6. **Cross-module communication patterns** — IAM-authenticated REST, read-only grants, shared kernel types, event bus.

## Section 1: When to apply this architecture

**Default:** Apply hexagonal architecture inside DDD modules to any non-trivial application. Any project with more than one domain, more than a handful of Lambdas, or any expectation of growth qualifies.

**Exception — extra-simple applications:** A single Lambda with minimal logic, a small utility endpoint, or a short-lived prototype may keep all the domain logic inline in the handler. The hexagonal split introduces overhead (extra files, constructor injection, port interfaces) that is not worth it below a certain complexity threshold.

**Thresholds for extra-simple:** All three must hold.

- Handler is under ~50 lines of business logic.
- Handler touches at most one external system (one DynamoDB table, or one HTTP call, or one S3 bucket — not a combination).
- Handler is not expected to grow. It is intentionally a one-shot utility.

If any of these thresholds is crossed, refactor to hexagonal before adding more code. Waiting until the handler is several hundred lines with inline AWS SDK calls makes the refactor substantially more expensive.

**Cross-cutting principles always apply.** Even a one-file handler must:

- Validate environment variables at cold start using `validateEnv()` from `05-shared-utilities.md`.
- Parse request bodies with `parseBody()` and Zod, never `JSON.parse(body || '{}')`.
- Return responses through `createResponse()` / `withCors()` so CORS, security headers, and request IDs are consistent.
- Load secrets from Secrets Manager at runtime, never from `process.env` at CDK synth time.
- Define its own `LogGroup` with an explicit retention period.

The hexagonal split is a structural choice. The cross-cutting principles are non-negotiable regardless of structure.

## Section 2: Hexagonal architecture for Lambda functions

Hexagonal architecture (ports and adapters) separates domain logic from infrastructure. For Lambda functions, it produces four layers per module.

### Layers

- **Handlers** — Thin entry points. Translate Lambda events (API Gateway, SQS, EventBridge, DynamoDB Streams) into domain calls. Parse and validate input, call the service, wrap the response. For API Gateway handlers, wrap with `withCors()` so CORS and security headers apply uniformly. Handlers never import the AWS SDK directly.
- **Services** — Domain logic. Pure TypeScript. Depend on port interfaces, never on concrete AWS clients. A service is testable with plain mocks and has no knowledge of how data is persisted or events are emitted.
- **Ports** — TypeScript interfaces defining contracts with external systems: data store, blob storage, other services, event bus, HTTP clients. Ports live in the domain layer and are implemented by adapters.
- **Adapters** — Concrete implementations of ports using AWS SDK clients or third-party libraries. Adapters are the only place that imports `@aws-sdk/client-dynamodb`, `@aws-sdk/client-s3`, etc.

### Dependency injection

Services receive their dependencies via constructor injection with sensible defaults. The default wires the real adapter (so handlers can instantiate the service with no arguments in production), and tests override by passing mock implementations.

```typescript
import { Order, CreateOrderInput } from "../types";
import { OrderAdapter } from "../adapters/order.adapter";
import { EventAdapter } from "../adapters/event.adapter";

export interface OrderPort {
  getOrder(id: string): Promise<Order | null>;
  listOrders(userId: string): Promise<Order[]>;
  createOrder(input: CreateOrderInput): Promise<Order>;
}

export interface EventPort {
  emitOrderCreated(order: Order): Promise<void>;
}

export class OrderService {
  constructor(
    private readonly orderPort: OrderPort = new OrderAdapter(),
    private readonly eventPort: EventPort = new EventAdapter(),
  ) {}

  async createOrder(userId: string, input: CreateOrderInput): Promise<Order> {
    const order = await this.orderPort.createOrder({ ...input, userId });
    await this.eventPort.emitOrderCreated(order);
    return order;
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.orderPort.getOrder(id);
  }

  async listOrdersForUser(userId: string): Promise<Order[]> {
    return this.orderPort.listOrders(userId);
  }
}
```

The handler instantiates the service without arguments. The defaults provide the real adapters.

```typescript
import { APIGatewayProxyHandler } from "aws-lambda";
import { withCors } from "../../../shared/utils/cors";
import { parseBody } from "../../../shared/utils/parse-body";
import { createResponse } from "../../../shared/utils/response";
import { CreateOrderSchema } from "../types";
import { OrderService } from "../services/order.service";

const service = new OrderService();

export const handler: APIGatewayProxyHandler = withCors(async (event) => {
  const parsed = parseBody(event.body, CreateOrderSchema);
  if (!parsed.success) {
    return createResponse(400, { success: false, error: parsed.error }, event);
  }
  const userId = event.requestContext.authorizer?.claims?.sub as string;
  const order = await service.createOrder(userId, parsed.data);
  return createResponse(201, { success: true, data: order }, event);
});
```

### Test strategy per layer

- **Service tests** — Mock ports by passing fake implementations into the constructor. Pure unit tests. No AWS credentials, no AWS SDK mocks, no network. Fastest and most numerous tests in the suite.
- **Adapter tests** — Mock the AWS SDK clients directly using `@aws-sdk/client-mock` (or an equivalent). Verify that commands are constructed correctly and that results map to the domain types in `types.ts`.
- **Handler tests** — Mock the service entirely. Verify event translation, input validation, CORS wrapping, and error mapping. Do not drive the real service from a handler test.

A symptom of broken decoupling is a service test that needs AWS credentials to run. See the Gotchas catalog below.

## Section 3: DDD module structure

Each bounded context is a self-contained module under `modules/{domain}/`. A bounded context is the boundary within which a given domain term has a consistent meaning — `orders`, `users`, `inventory`, `billing`, `notifications`.

### Directory layout

```
modules/{domain}/
├── src/
│   ├── handlers/       # Lambda entry points ({name}.handler.ts)
│   ├── services/       # Business logic ({name}.service.ts)
│   ├── ports/          # Interfaces for adapters
│   ├── adapters/       # External integrations (DynamoDB, S3, HTTP clients)
│   └── types.ts        # Zod schemas and TypeScript types for domain values
├── infra/
│   ├── {domain}.module.ts    # CDK construct (tables, lambdas, routes, permissions)
│   └── index.ts
└── tests/
```

Everything the bounded context needs lives inside the module. The `src/` directory holds Lambda runtime code. The `infra/` directory holds the CDK construct that provisions the module's resources. The `tests/` directory holds unit tests for handlers, services, and adapters.

### Module infra construct

The CDK construct in `infra/{domain}.module.ts` owns the module's tables, Lambdas, routes, and IAM permissions. It does not own shared resources. Shared resources (Cognito user pool, API Gateway REST API, audit log table, event bus, monitoring dashboards) are injected through props by the main stack.

Sketch:

```typescript
import { Construct } from "constructs";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { SharedInfra } from "../../../shared/infra/types";

export interface OrdersModuleProps {
  shared: SharedInfra;
  stage: string;
}

export class OrdersModule extends Construct {
  public readonly ordersTable: Table;

  constructor(scope: Construct, id: string, props: OrdersModuleProps) {
    super(scope, id);
    // Define this module's table, lambdas, routes, and permissions here.
    // Wire API Gateway routes off props.shared.api, Cognito authorizer off props.shared.cognito, etc.
  }
}
```

### Decision tree — new Lambda vs. new module

When adding functionality, apply these rules.

- **Does the new Lambda belong to an existing bounded context?** Add handler + service + ports/adapters to the existing module. Reuse the module's table when the data lives in the same aggregate root.
- **Does the new Lambda introduce a new bounded context (a distinct domain term, distinct aggregate, distinct team-level ownership)?** Create a new module directory under `modules/`.
- **Is the new functionality cross-cutting (audit log, monitoring, shared auth helpers)?** It belongs in `shared/` — not in a module.

Avoid the anti-pattern of one giant `modules/api/` that accumulates every endpoint. That is a single bounded context only if the domain genuinely is that cohesive. Usually it is not, and the right move is to split into `modules/orders/`, `modules/users/`, `modules/inventory/`, etc.

## Section 4: Two-stack architecture (backend + frontend)

A typical full-stack CDK application splits into two stacks: a backend stack and a frontend stack. This split is driven by lifecycle and deployment differences, not by stateful/stateless concerns in the serverless case.

### Backend stack

Contains the authentication layer, API surface, compute, data, secrets, and event infrastructure.

- Cognito user pool, app client, hosted UI domain.
- API Gateway REST API with Cognito authorizer.
- Lambda functions (one per handler).
- DynamoDB tables.
- Secrets Manager secrets.
- EventBridge bus.
- CloudWatch log groups, dashboards, alarms.

The backend stack exports the values that the frontend needs via CloudFormation outputs:

- Cognito user pool ID and app client ID.
- Cognito hosted UI domain.
- API Gateway invoke URL.
- Any module-specific endpoint values the SPA must call.
- Table names, if the frontend signs requests directly (rare — usually all access is through the API).

### Frontend stack

Contains the static hosting layer and the runtime configuration bridge.

- S3 bucket (private, served via CloudFront OAC).
- CloudFront distribution.
- Route53 record + ACM certificate (in us-east-1).
- A `config.json` generator construct that reads backend outputs and writes a config file alongside the SPA assets.

The `config.json` pattern solves a chicken-and-egg problem. The SPA needs the Cognito client ID, the API URL, and similar backend values to function. Injecting these at SPA build time couples the build to a specific environment and requires a rebuild on any backend change. Instead, the backend stack deploys first and exports the values. The frontend stack reads the exports and generates a `config.json` file in the S3 bucket. The SPA fetches `config.json` at runtime on load. A single SPA artifact can target any environment by pointing at the correct deploy.

### When stateful/stateless split actually applies

A separate stateful stack (data + secrets) and stateless stack (compute + API) is a common CDK recommendation. **It is not always the right choice.** The split pays off only when the stateful layer contains instance-backed resources — resources that will be replaced or restarted if their stack is modified. Examples of instance-backed resources:

- Aurora Serverless v2 cluster.
- RDS database instances.
- EC2 instances.
- OpenSearch Domain.
- ElastiCache cluster.

For a 100% serverless architecture — DynamoDB + Lambda + S3 + Cognito + API Gateway + Secrets Manager — **do not split backend into stateful/stateless.** None of these resources are instance-backed, none of them replace on compute-only deploys, and the split adds cross-stack export friction with no safety benefit. Keep everything in a single backend stack.

Keep the frontend stack separate regardless, because:

- The ACM certificate must be in us-east-1 (CloudFront constraint), while the backend may live in any region.
- The frontend assets have a distinct build lifecycle from the backend code.
- The `config.json` generator requires backend outputs, which is cleaner as cross-stack references than as same-stack dependencies.

### Deployment order

Always deploy the backend first. The frontend reads backend outputs. `cdk deploy --all` resolves the dependency automatically when cross-stack references are set up correctly, but be explicit: running `cdk deploy BackendStack` before `cdk deploy FrontendStack` is safer for first-time deploys and avoids confusing error messages when backend exports are not yet resolved.

## Section 5: Shared infrastructure constructs

Several resources are shared across all modules. Define them once as CDK constructs under `shared/infra/`, instantiate them once in the main stack, and pass them to every module as props. This keeps each module focused on its own domain while still composing into a coherent application.

### Constructs

- **`CognitoConstruct`** — User pool, app client, hosted UI domain. Federated identity providers (Google, etc.) wire in here. Exports user pool ID and client ID as CloudFormation outputs.
- **`ApiGatewayConstruct`** — REST API with Cognito authorizer and CORS preflight. Modules attach routes to this API rather than creating their own. Centralizing the API keeps a single URL for the SPA and a single authorizer for all authenticated routes.
- **`LambdaLayerConstruct`** — Pre-bundled shared dependencies. Common inclusions: DynamoDB SDK, Zod, UUID, Secrets Manager SDK, common utilities. Every `NodejsFunction` uses the layer plus an external modules list so esbuild does not re-bundle layer contents. Deployment is significantly faster because most Lambda packages are only a few kilobytes of glue code on top of the layer.
- **`AuditLogConstruct`** — Cross-module audit log DynamoDB table. Every module writes audit entries. Centralizing the table means a single retention policy, a single TTL configuration, and a single place to stream events for downstream analytics.
- **`EventBusConstruct`** — EventBridge bus for cross-module domain events. Modules publish events without knowing which other modules consume them.
- **`MonitoringConstruct`** — CloudWatch dashboards and alarms per Lambda. Applied uniformly so every Lambda gets invocation count, error count, and duration metrics without bespoke per-module configuration.

### Wiring sketch

The main stack instantiates the shared constructs once and passes them into each module as a typed `shared` prop.

```typescript
import { Construct } from "constructs";
import { Stack, StackProps } from "aws-cdk-lib";
import { CognitoConstruct } from "../shared/infra/cognito.construct";
import { ApiGatewayConstruct } from "../shared/infra/api-gateway.construct";
import { LambdaLayerConstruct } from "../shared/infra/lambda-layer.construct";
import { AuditLogConstruct } from "../shared/infra/audit-log.construct";
import { EventBusConstruct } from "../shared/infra/event-bus.construct";
import { MonitoringConstruct } from "../shared/infra/monitoring.construct";
import { OrdersModule } from "../modules/orders/infra/orders.module";
import { UsersModule } from "../modules/users/infra/users.module";
import { InventoryModule } from "../modules/inventory/infra/inventory.module";

export class BackendStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const shared = {
      cognito: new CognitoConstruct(this, "Cognito", { stage: "dev" }),
      api: new ApiGatewayConstruct(this, "Api", { stage: "dev" }),
      layer: new LambdaLayerConstruct(this, "Layer"),
      audit: new AuditLogConstruct(this, "Audit"),
      eventBus: new EventBusConstruct(this, "Events"),
      monitoring: new MonitoringConstruct(this, "Monitoring"),
    };

    new OrdersModule(this, "Orders", { shared, stage: "dev" });
    new UsersModule(this, "Users", { shared, stage: "dev" });
    new InventoryModule(this, "Inventory", { shared, stage: "dev" });
  }
}
```

Each module receives the same `shared` object and uses whichever pieces it needs. A module that does not emit events does not have to use `shared.eventBus`. A module that does not have audit requirements does not have to touch `shared.audit`. But the consistent shape means every module has the same surface to work from, and adding a new shared concern later means updating the `SharedInfra` type once rather than threading a prop through every module.

## Section 6: Cross-module communication patterns

Bounded contexts need to exchange data and events, but the exchange must not dissolve the boundaries. Use these patterns, preferred to acceptable.

### Preferred: IAM-authenticated REST calls

When module A needs data from module B, call module B's exposed API endpoint with a SigV4-signed request. Module B's endpoint URL is injected into module A's Lambda via an environment variable (`MODULE_B_API_ENDPOINT`). Module A has IAM permission to invoke that endpoint; module B's authorizer accepts IAM-authenticated calls from known roles.

This pattern preserves bounded context boundaries. Module A does not know module B's DynamoDB table name, partition key design, or storage details. If module B refactors its data layer, module A is unaffected as long as the API contract is stable.

### Acceptable for reads: direct table grants

For tightly coupled cross-cutting reads where the REST round-trip is prohibitively expensive or the data is fundamentally shared (configuration tables, lookup tables), grant read-only access to the other module's table directly.

```typescript
// In the module that exposes the table:
props.shared.crossModuleGrants.grantReadOnOrdersTable(someOtherModuleFunction);

// Or directly, inside the main stack:
ordersModule.ordersTable.grantReadData(inventoryReconciliationFunction);
```

Keep this pattern for reads only. A cross-module write against another module's table is almost always a design smell — the owning module should expose a write API with validation, authorization, and events.

### Shared writes: the audit log

Every module writes to the shared audit log table. The audit log is an append-only record of domain events with a stable schema. Grant write access through the shared construct so each module's Lambdas get the right IAM permissions without cross-wiring.

```typescript
props.shared.audit.grantWrite(someFunction);
```

### Shared kernel types

Some types are genuinely cross-domain — identifiers, monetary values, time ranges, user IDs. Define these in `shared/types/domain.ts` and let any module import from `shared/types`. **Never import types from another module's `src/types.ts` directly.** Direct cross-module type imports create circular dependencies and couple modules at compile time even when their runtime contracts are loose.

If a type currently lives in `modules/orders/src/types.ts` and module `inventory` needs it, move it to `shared/types/` first, then have both modules import from `shared/types`. This is a mechanical refactor: move the declaration, update the imports, verify the build.

### Events: publish without knowing consumers

Modules publish domain events (`OrderCreated`, `UserRegistered`, `InventoryAdjusted`) to the shared EventBridge bus without knowing who consumes them. EventBridge rules, defined either in the main stack or in the consumer module's infra, route events to interested Lambdas.

```typescript
// Producer: module A emits an event it cares about, nothing more.
await this.eventPort.emitOrderCreated(order);

// Consumer: module B adds a rule routing OrderCreated to its own handler.
// This wiring lives in module B's infra, not module A's.
```

This pattern is the loose-coupling workhorse. Adding a new consumer for `OrderCreated` is additive — module A changes not at all.

## Gotchas catalog

| Symptom | Root cause | Fix |
|---------|------------|-----|
| TypeScript circular dependency error or "module import loop" when building; IDE autocomplete fails across modules. | A module imports types directly from another module's `src/types.ts`. When the other module also imports back (directly or transitively), TypeScript sees a cycle. | Move the shared type to `shared/types/`. Update both modules to import from `shared/types`. Never let `modules/A/...` import from `modules/B/...`. |
| Handler file imports `@aws-sdk/client-dynamodb` (or similar) and contains inline AWS SDK calls. Unit tests for the handler require mocking AWS SDK clients. | Hexagonal split was skipped: the handler is doing adapter work. | If the application crosses the Section 1 thresholds, refactor: extract the data access into a port + adapter, move business logic into a service, and inject via constructor. If the application is genuinely extra-simple, document that choice explicitly and keep the cross-cutting principles (`validateEnv`, `parseBody`, `withCors`, explicit log group). |
| Service unit test fails with "Unable to resolve AWS credentials" or "Region is missing" when run locally or in CI. | The service is not actually decoupled from its adapters. Either the constructor does not accept injected ports, or the test is instantiating the service without passing mocks (so the default real adapter runs). | Verify the service constructor has the shape `constructor(private readonly port: Port = new RealAdapter())`. In the test, construct with mocks: `new OrderService(mockOrderPort, mockEventPort)`. Never call the real adapter from a service test. |

## Further reading

- AWS CDK v2 API reference: `https://docs.aws.amazon.com/cdk/api/v2/`
- `01-serverless-api.md` — Lambda + DynamoDB + API Gateway inside the hexagonal pattern.
- `05-shared-utilities.md` — `validateEnv`, `parseBody`, `createResponse`, `withCors`, `ApiResponse<T>`, `ErrorCodes`, secrets loading.
- `06-deploy-workflow.md` — Pre-deploy checklist, stage and suffix system, rollback basics.
