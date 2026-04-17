# Shared Utilities

**Builds:** A set of cross-cutting TypeScript utilities — `parseBody`, `createResponse`, `withCors`, `validateEnv`, a secrets loader with cold-start cache, and standardized `ApiResponse<T>` / `ErrorCodes` — used consistently across every Lambda handler, service, and adapter.
**When to use:** When writing Lambda handlers, reading environment variables, loading secrets, returning API responses, or parsing request bodies. Reference from any module in the codebase.
**Prerequisites:** None. This file is self-contained and readable without reading other reference files.

## Contents

1. **Why centralize utilities** — Rationale and conventions for `shared/utils/` and `shared/types/`.
2. **Request body parsing — `parseBody(body, schema)`** — Zod-backed parser returning a discriminated union; never throws.
3. **Response helpers — `createResponse`, `withCors`, security headers** — Allowlist-based CORS, security headers, and request ID on every response.
4. **Standardized API responses — `ApiResponse<T>` and `ErrorCodes`** — Shared response shape and enum of error codes used across handlers.
5. **Environment variable validation — `validateEnv`** — Fail-fast, typed env var reader invoked at module scope.
6. **Secrets loading with cold-start cache** — `loadSecret` against Secrets Manager, cached per Lambda container.
7. **Gotchas catalog** — Known failure modes with root causes and fixes.

## Section 1: Why centralize utilities

Handlers, services, and adapters all rely on the same small set of helpers: parse a body, validate env vars, load a secret, build a response. Centralizing those helpers prevents three problems that compound over time.

- **Duplication.** Every handler reimplementing `JSON.parse(event.body || '{}')` produces dozens of subtly different input paths.
- **Silent inconsistency.** Two CORS implementations, one allowlist-based and one wildcard, are indistinguishable at code review and divergent in production.
- **Documentation drift.** If each module defines its own `ApiResponse<T>`, the shape documented in the API contract is an opinion, not a fact.

Convention: `shared/utils/` for helpers (`parse-body.ts`, `cors.ts`, `validate-env.ts`, `load-secrets.ts`) and `shared/types/` for types (`api-responses.ts`). Every module imports from `shared/` — never defines local versions. When a handler declares a local `ApiResponse<T>` or a local `createResponse`, that is always a defect, not a style choice.

## Section 2: Request body parsing — `parseBody(body, schema)`

Parse the raw API Gateway body once, in one place, against a Zod schema. The function returns a discriminated union and never throws. Handlers branch on `parsed.success` and receive a fully typed `parsed.data` on the success arm.

```typescript
// shared/utils/parse-body.ts
import { ZodSchema, ZodError } from "zod";

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function parseBody<T>(
  body: string | null | undefined,
  schema: ZodSchema<T>,
): ParseResult<T> {
  if (!body) {
    return { success: false, error: "Missing request body" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { success: false, error: "Malformed JSON" };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { success: false, error: formatZodError(result.error) };
  }
  return { success: true, data: result.data };
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}
```

Usage inside a handler:

```typescript
import { z } from "zod";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { parseBody } from "shared/utils/parse-body";
import { createResponse } from "shared/utils/cors";
import { ErrorCodes } from "shared/types/api-responses";

const CreateOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export const handler = async (event: APIGatewayProxyEvent) => {
  const parsed = parseBody(event.body, CreateOrderSchema);
  if (!parsed.success) {
    return createResponse(
      400,
      { success: false, error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error } },
      event,
    );
  }
  // parsed.data is typed as { productId: string; quantity: number }
  // ... call service with parsed.data
};
```

**Rule:** Never use `JSON.parse(body || '{}')` directly. It silently accepts malformed JSON on one branch and skips schema validation entirely. A handler with that line is not validating input.

## Section 3: Response helpers — `createResponse`, `withCors`, security headers

`createResponse` produces a well-formed API Gateway response with CORS, security headers, and a unique request ID. `withCors` is a higher-order wrapper that guarantees CORS is applied even on exception paths and supplies a consistent 500 response for uncaught errors.

`cors.ts` does not redefine `ApiResponse<T>` — it imports the canonical type from `shared/types/api-responses.ts` (Section 4). This keeps a single source of truth for the response shape across the codebase.

```typescript
// shared/utils/cors.ts
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "crypto";
import type { ApiResponse } from "shared/types/api-responses";
import { ErrorCodes } from "shared/types/api-responses";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cache-Control": "no-store",
} as const;

function getCorsOrigin(requestOrigin: string | undefined): string {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (requestOrigin && allowed.includes(requestOrigin)) {
    return requestOrigin;
  }
  // Default to the first allowed origin; never wildcard in production.
  return allowed[0] ?? "";
}

export function createResponse<T>(
  statusCode: number,
  body: ApiResponse<T>,
  event?: APIGatewayProxyEvent,
): APIGatewayProxyResult {
  const origin = event?.headers?.origin ?? event?.headers?.Origin;
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": getCorsOrigin(origin),
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "X-Request-Id": randomUUID(),
      ...SECURITY_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

export function withCors(
  handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (event) => {
    try {
      const response = await handler(event);
      // Ensure CORS headers are present even if the inner handler forgot.
      return {
        ...response,
        headers: {
          ...createResponse(response.statusCode, { success: true }, event).headers,
          ...response.headers,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return createResponse(
        500,
        { success: false, error: { code: ErrorCodes.INTERNAL_ERROR, message } },
        event,
      );
    }
  };
}
```

**Rules:**

- **Always pass `event` to `createResponse()`.** Every response path (success AND error) must include `event` so the CORS origin header matches the request origin. Omitting `event` causes the fallback to the first allowed origin, which breaks production when multiple origins are configured.
- **Allowlist-based CORS, never wildcard.** `getCorsOrigin(requestOrigin)` validates against the `ALLOWED_ORIGINS` env var. A response with `Access-Control-Allow-Origin: *` is a configuration error.
- **Every response automatically includes security headers** (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Cache-Control`) and a unique `X-Request-Id`. These come from `createResponse` for free — handlers do not set them manually.

## Section 4: Standardized API responses — `ApiResponse<T>` and `ErrorCodes`

A single response shape and a closed set of error codes make API contracts enforceable in TypeScript and observable in logs. Define both in `shared/types/`.

```typescript
// shared/types/api-responses.ts

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
  };
}

export const ErrorCodes = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  INVALID_OTP: "INVALID_OTP",

  // Input validation
  INVALID_INPUT: "INVALID_INPUT",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_MIME_TYPE: "INVALID_MIME_TYPE",
  INVALID_FORMAT: "INVALID_FORMAT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",

  // Resources
  NOT_FOUND: "NOT_FOUND",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  CONFLICT: "CONFLICT",

  // Rate limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",

  // Server
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",

  // Business logic
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  OPERATION_NOT_ALLOWED: "OPERATION_NOT_ALLOWED",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

**Rules:**

- **Every API response uses `ApiResponse<T>`.** Never return raw objects from handlers. A response without `success` is unparseable by generic client code.
- **`error.code` is always from `ErrorCodes`.** Never invent codes locally. Adding a new code means editing `ErrorCodes` in `shared/types/api-responses.ts` and referencing it by name everywhere.
- **`error.message` is human-readable and safe to display to end users.** No stack traces, no internal identifiers, no SQL fragments. Log internal detail server-side; return only the message.

## Section 5: Environment variable validation — `validateEnv`

Fail fast on missing env vars, and do it at cold start rather than mid-request. The helper returns a typed object with one property per requested key, each typed as `string` (never `string | undefined`).

```typescript
// shared/utils/validate-env.ts

export function validateEnv<const K extends readonly string[]>(
  keys: K,
): { [P in K[number]]: string } {
  const result = {} as { [P in K[number]]: string };
  const missing: string[] = [];
  for (const key of keys) {
    const value = process.env[key];
    if (!value || value.trim() === "") {
      missing.push(key);
    } else {
      (result as Record<string, string>)[key] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing or empty required environment variables: ${missing.join(", ")}`,
    );
  }
  return result;
}
```

Usage:

```typescript
import { validateEnv } from "shared/utils/validate-env";

// At module scope so it runs once per cold start
const { TABLE_NAME, SECRET_ARN, ALLOWED_ORIGINS } = validateEnv([
  "TABLE_NAME",
  "SECRET_ARN",
  "ALLOWED_ORIGINS",
] as const);
```

**Rules:**

- **Call `validateEnv` at module scope** (outside the handler), so missing env vars fail at cold start rather than mid-request. A handler that throws on its first real invocation produces a confusing 5xx instead of a clean init failure in CloudWatch.
- **Never use `process.env.X || ''`.** It silently passes empty strings downstream. DynamoDB calls with an empty table name, Secrets Manager calls with an empty ARN, and similar failures appear far from their root cause.
- **The return type is typed via `as const` inference.** Each key becomes a required string property. Destructuring into named constants preserves the types at every use site.

## Section 6: Secrets loading with cold-start cache

Load secrets from Secrets Manager at runtime. Cache the parsed value at module scope so subsequent invocations during the same cold start reuse the result without another network call.

```typescript
// shared/utils/load-secrets.ts
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});

// Cache at module scope — persists across invocations during the same cold start.
const cache = new Map<string, unknown>();

export async function loadSecret<T>(secretArn: string): Promise<T> {
  const cached = cache.get(secretArn);
  if (cached !== undefined) {
    return cached as T;
  }
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} has no SecretString value`);
  }
  const parsed = JSON.parse(response.SecretString) as T;
  cache.set(secretArn, parsed);
  return parsed;
}
```

Usage in a Lambda handler:

```typescript
import type { APIGatewayProxyEvent } from "aws-lambda";
import { withCors } from "shared/utils/cors";
import { validateEnv } from "shared/utils/validate-env";
import { loadSecret } from "shared/utils/load-secrets";

interface GoogleOAuth {
  clientId: string;
  clientSecret: string;
}

const { GOOGLE_OAUTH_SECRET_ARN } = validateEnv([
  "GOOGLE_OAUTH_SECRET_ARN",
] as const);

export const handler = withCors(async (event: APIGatewayProxyEvent) => {
  const creds = await loadSecret<GoogleOAuth>(GOOGLE_OAUTH_SECRET_ARN);
  // creds is cached after the first call during this cold start
  // ... use creds.clientId / creds.clientSecret
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
});
```

**Rules:**

- **Pass `SECRET_ARN` as a Lambda env var.** Never read secret values at CDK synth time — doing so bakes them into the CloudFormation template as empty strings (or leaks them into templates, which is worse). The Lambda reads the ARN at runtime and calls Secrets Manager itself.
- **Cache at module scope, not inside the handler.** Module scope persists across invocations during the same cold start; handler scope does not. A handler-scope `Map` is re-initialized on every invocation and defeats the cache.
- **The cache is per-Lambda-instance.** When the Lambda cold-starts on a new container, the cache is empty — a fresh fetch happens on first invocation. This is the correct behavior: rotated secrets propagate without requiring an application-level TTL.

## Section 7: Gotchas catalog

| Symptom | Root cause | Fix |
|---------|------------|-----|
| **"CORS error in production, works locally"** | `event` was not passed to `createResponse` on some path (usually an error path). `Access-Control-Allow-Origin` falls back to the first allowed origin and does not match the production request origin. | Audit every `createResponse` call (success AND error). Always pass `event` as the third argument. |
| **Set-cookie works on login but logout does not clear the cookie** | The set-cookie and clear-cookie responses used different `Secure`, `SameSite`, `Path`, or `HttpOnly` attributes. Browsers refuse to clear a cookie unless the clear response matches all of those attributes exactly. | Use a shared cookie-config helper that generates both the set and clear headers from the same source of truth. Attribute mismatches across responses are the single source of "clear does nothing" bugs. |
| **Local `ApiResponse<T>` or `createResponse` defined in a handler** | The developer forgot to import from `shared/`, or pasted from another handler without updating imports. | Remove the local definition. Import `ApiResponse<T>` from `shared/types/api-responses` and `createResponse`/`withCors` from `shared/utils/cors`. |
| **`JSON.parse(event.body)` throws, or returns an unexpected type** | No schema validation; malformed JSON crashes on the parse call, and unexpected keys silently pass through on success. | Replace with `parseBody(event.body, zodSchema)`. Branch on `parsed.success`. Return a 400 with `parsed.error` on failure. |
| **`process.env.TABLE_NAME` is the empty string and the downstream DynamoDB call fails with an obscure error** | `process.env.TABLE_NAME || ''` fallback silently passed an empty string to the AWS SDK. The SDK error points at the SDK, not at the config. | Use `validateEnv(["TABLE_NAME"] as const)` at module scope. Missing or empty values throw at cold start with a clear message naming the missing key. |
| **Secret value shows as an empty string in the CloudFormation template** | The secret was read at CDK synth time (e.g., `process.env.GOOGLE_CLIENT_SECRET` referenced inside a Stack class). At synth time that env var is not set, so the template contains `""`. | Pass `SECRET_ARN` as a Lambda env var. Load the secret at runtime using `loadSecret` with the cold-start cache. Never reference secret values from inside CDK constructs. |
| **Cold-start latency higher than expected; Secrets Manager cost unexpectedly high** | `loadSecret` was called inside the handler without using the module-scope cache (e.g., a handler-local `const cache = new Map()`), so every invocation re-fetches the secret. | Keep the cache in `shared/utils/load-secrets.ts` at module scope. Call `loadSecret` from anywhere — the cache is shared per-container. Alternatively, hoist the fetch into a module-level top-level `await` if ESM is enabled. |
