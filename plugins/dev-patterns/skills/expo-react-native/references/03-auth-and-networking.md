# Auth and networking

**Builds:** The full sign-in, token-lifecycle, and API-client surface for Acme Shop — Cognito hosted UI brokering Google as an external IdP, PKCE via `expo-auth-session`, access / ID / refresh tokens in `expo-secure-store` (hardware-backed keychain / keystore), biometric gating on cold start via `expo-local-authentication`, and a single `apiClient` fetch wrapper with single-flight refresh on 401, exponential-backoff retries, `AbortController` timeouts, and typed `ApiResponse<T>` envelopes mirroring the server shape from `../../aws-cdk-patterns/references/05-shared-utilities.md`.
**When to use:** Wiring sign-in for a new IdP, debugging a redirect loop, implementing the refresh-on-401 path, or deciding whether a given screen needs `SigV4` or `JWT`. Read Sections 1-4 before writing any token-handling code; Sections 5-7 before implementing any mutation that can race against another device.
**Prerequisites:** `./00-architecture.md` (the `src/platform/` + `src/features/` split; `app.config.ts` plugin entries), `./02-state-and-data.md` (`expo-secure-store` tradeoffs; why cart state lives in Zustand and *tokens* live in keychain), and `../../aws-cdk-patterns/references/02-auth-stack.md` (Cognito User Pool + App Client provisioning that this file consumes).

> Examples verified against Expo SDK 54 + `expo-auth-session` 7.0.10 + `expo-secure-store` 15.0.8 + `expo-local-authentication` 17.0.8 on 2026-04-23. Re-verify via context7 before porting to a newer SDK — SDK 55 bumps all three to v55.x with renamed plugin options.

## Contents

1. **Cognito + Google federation** — `expo-auth-session` with `useAuthRequest` + PKCE; Cognito hosted UI as the IdP broker; the four config values that must match what `aws-cdk-patterns` provisioned.
2. **Token storage** — Access / ID / refresh tokens in `expo-secure-store`; why never AsyncStorage; why never Zustand `persist` without encryption. Full `tokenStore.ts` wrapper.
3. **Refresh flow** — Detect 401 in a fetch interceptor; queue concurrent requests during refresh (single-flight pattern); handle refresh failure by signing out and redirecting to `/sign-in`.
4. **Networking abstraction** — Single `apiClient` wrapper: base URL per EAS profile, auth interceptor, retry with exponential backoff + jitter, `AbortController` timeout, typed `ApiResponse<T>` envelopes mirroring `aws-cdk-patterns`.
5. **SigV4 vs JWT** — When each applies. JWT is the default for API Gateway with Cognito authorizer. SigV4 is rare on mobile (requires Cognito Identity Pool + direct IAM-auth'd APIs).
6. **Stale-data conflicts** — `ConditionalCheckFailedException` surfaces as HTTP 409; "this item changed, refresh to see the latest" UI with a retry affordance.
7. **Biometric unlock** — `expo-local-authentication` gating access to the stored refresh token on cold start / app resume; distinguishing "user cancelled" vs "biometrics not enrolled" vs "hardware missing".
8. **Gotchas (auth-specific)** — Cognito redirect loop from callback URL mismatch, SecureStore biometric prompt blocking on app resume, single-flight refresh not covering concurrent 401s, JWT clock skew.
9. **Verification** — `expo-auth-session` discovery fetch sanity check; forced-401 retry test; redirect URI check against Cognito App Client.
10. **Further reading** — Pointers into the rest of this skill and the sibling skills.

---

## Section 1: Cognito + Google federation

Acme Shop does not implement native Google Sign-In. Instead, the app opens the **Cognito hosted UI** (a web page hosted on a Cognito-owned domain), and Cognito brokers the OAuth flow to Google. After Google issues its token, Cognito mints its own tokens and redirects back into the app via a custom URI scheme. The app never sees Google's tokens; it only sees Cognito's.

This matters because:

- **One code path per IdP.** Adding Apple Sign-In later is purely a Cognito console change — no mobile code modification.
- **The app never stores Google credentials.** All Google-specific logic (client secret, OAuth scopes, token refresh) lives in Cognito. A leak of the app binary reveals only the Cognito public client ID.
- **Session revocation is centralized.** An admin revokes the Cognito session, and all of that user's devices lose access on their next refresh. There is no "is my Google token still valid" loop on the client.

Sequence, concretely:

```
1. User taps "Sign in with Google" on the native UI.
2. App builds a PKCE authorization URL: https://<cognito-domain>.auth.<region>.amazoncognito.com/oauth2/authorize
     ?identity_provider=Google
     &response_type=code
     &client_id=<userPoolWebClientId>
     &redirect_uri=acmeshop://auth/callback
     &code_challenge=<PKCE challenge>
     &code_challenge_method=S256
     &scope=openid+email+profile
3. expo-web-browser opens an in-app browser (ASWebAuthenticationSession on iOS / Custom Tabs on Android).
4. Cognito redirects to Google; user signs in; Google redirects back to Cognito.
5. Cognito issues a one-time code and redirects to acmeshop://auth/callback?code=<code>.
6. expo-auth-session captures the redirect and exchanges the code for tokens at:
     POST https://<cognito-domain>.auth.<region>.amazoncognito.com/oauth2/token
     with the PKCE verifier and grant_type=authorization_code.
7. Cognito returns { access_token, id_token, refresh_token, expires_in }.
8. App writes the tokens to expo-secure-store and sets the session in-memory.
```

### Required config

Four values must match what the CDK stack in `../../aws-cdk-patterns/references/02-auth-stack.md` provisioned:

| Field | Source | Example |
|---|---|---|
| `userPoolId` | `UserPool.userPoolId` output | `us-east-1_abc123XYZ` |
| `userPoolWebClientId` | `UserPoolClient.userPoolClientId` | `5a6b7c8d9e0f1g2h3i4j5k6l7m` |
| `domain` | `UserPoolDomain.domain` (Cognito hosted UI) | `acmeshop-prod` (→ `acmeshop-prod.auth.us-east-1.amazoncognito.com`) |
| `redirectUri` | Custom URI scheme declared in `app.config.ts` **and** in the CDK `UserPoolClient.oAuth.callbackUrls` | `acmeshop://auth/callback` |

If any of these four drift, you get either a Cognito error page in the web view (mismatched `client_id` or `redirect_uri`) or a silent redirect loop (the native scheme is not registered). See §8 for the full diagnostic flow.

Wire the values into `app.config.ts` so they are readable via `expo-constants`:

```ts
// app.config.ts
import type { ExpoConfig } from "expo/config";

export default (): ExpoConfig => ({
  name: "Acme Shop",
  slug: "acme-shop",
  scheme: "acmeshop", // MUST match the host part of redirectUri
  ios: { bundleIdentifier: "com.acme.shop" },
  android: { package: "com.acme.shop" },
  plugins: [
    "expo-router",
    [
      "expo-secure-store",
      {
        configureAndroidBackup: true,
        faceIDPermission: "Unlock Acme Shop with Face ID",
      },
    ],
    [
      "expo-local-authentication",
      { faceIDPermission: "Unlock Acme Shop with Face ID" },
    ],
  ],
  extra: {
    // Populated per EAS profile via eas.json env vars.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    cognitoDomain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN,
    cognitoUserPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID,
    cognitoUserPoolWebClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
  },
});
```

The corresponding `eas.json` profiles (dev, staging, prod) set the four `EXPO_PUBLIC_*` values per environment. See `./00-architecture.md` §eas-profiles for the full profile table.

---

## Section 2: Token storage

Never store an access token, ID token, or refresh token in:

- **AsyncStorage** — Plaintext on disk; an attacker with filesystem access (rooted device, lost-device forensics) reads every token.
- **Zustand `persist` into MMKV without encryption** — Same class of problem. MMKV supports an encryption key, but that key lives in the app binary; a determined attacker can extract it. Fine for cart contents, not for tokens.
- **React state alone** — Tokens vanish on app kill; the user must sign in again every cold start, which is hostile for a shopping app.

Use `expo-secure-store`. It wraps the iOS Keychain (hardware-backed Secure Enclave where available) and the Android Keystore (hardware-backed on most devices ≥ Android 6). Both platforms enforce that the app package / bundle ID owns the key; another app cannot read Acme Shop's tokens.

### `tokenStore.ts`

The wrapper serializes to JSON (SecureStore only stores strings) and centralizes the `requireAuthentication` policy so we can flip biometric gating for the refresh token without touching every caller.

```ts
// src/platform/auth/tokenStore.ts
import * as SecureStore from "expo-secure-store";

export interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

const TOKENS_KEY = "acmeshop.tokens.v1";

// Only the refresh token is worth biometric gating — access / ID tokens
// rotate every hour anyway, and prompting on every cold start would be
// user-hostile for short-lived tokens.
const REFRESH_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  // When the device is unlocked in normal use, unlock the keychain item
  // for this session. AFTER_FIRST_UNLOCK allows restart -> cold start
  // without re-prompting if the device is still unlocked.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  authenticationPrompt: "Unlock Acme Shop",
};

const ACCESS_OPTIONS: SecureStore.SecureStoreOptions = {
  requireAuthentication: false,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * Persist a token set. Access/ID/refresh live in separate keychain entries
 * so that biometric gating can apply only to the refresh token.
 */
export async function setTokens(tokens: TokenSet): Promise<void> {
  const { refreshToken, ...rest } = tokens;
  // Non-biometric slice (access + id + expiry) — read on every request.
  await SecureStore.setItemAsync(
    `${TOKENS_KEY}.main`,
    JSON.stringify(rest),
    ACCESS_OPTIONS,
  );
  // Biometric-gated slice (refresh only) — read on cold start / refresh.
  await SecureStore.setItemAsync(
    `${TOKENS_KEY}.refresh`,
    refreshToken,
    REFRESH_OPTIONS,
  );
}

/**
 * Read the full token set. Pass `unlockRefresh: false` on hot paths (every
 * request) to avoid a biometric prompt — those callers only need access.
 * Pass `unlockRefresh: true` when doing the actual refresh.
 */
export async function getTokens(
  unlockRefresh: boolean,
): Promise<TokenSet | null> {
  const mainRaw = await SecureStore.getItemAsync(
    `${TOKENS_KEY}.main`,
    ACCESS_OPTIONS,
  );
  if (!mainRaw) return null;

  const main = JSON.parse(mainRaw) as Omit<TokenSet, "refreshToken">;

  if (!unlockRefresh) {
    // Caller only needs access/id — return a sentinel refresh so types check.
    return { ...main, refreshToken: "" };
  }

  const refreshToken = await SecureStore.getItemAsync(
    `${TOKENS_KEY}.refresh`,
    REFRESH_OPTIONS,
  );
  if (!refreshToken) return null;

  return { ...main, refreshToken };
}

/**
 * Fast read for the fetch interceptor — access token + expiry only.
 * Never triggers biometric prompt.
 */
export async function getAccessToken(): Promise<{
  accessToken: string;
  expiresAt: number;
} | null> {
  const tokens = await getTokens(false);
  if (!tokens) return null;
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(`${TOKENS_KEY}.main`),
    SecureStore.deleteItemAsync(`${TOKENS_KEY}.refresh`, REFRESH_OPTIONS),
  ]);
}
```

Two splits worth calling out explicitly:

- **Separate keys for refresh vs everything else.** This is the only way to get biometric gating on the long-lived token without prompting on every API call. If you store them together under `requireAuthentication: true`, the user sees a Face ID prompt every 10 seconds, which is unacceptable.
- **`AFTER_FIRST_UNLOCK`, not `WHEN_UNLOCKED`.** On iOS, `WHEN_UNLOCKED` prevents background tasks from reading the keychain while the device is locked. For Acme Shop's silent-push refresh flow (see `./04-native-and-release.md` §push), that breaks background sync. `AFTER_FIRST_UNLOCK` unlocks once per device boot — sufficient for our threat model.

---

## Section 3: Refresh flow

Access tokens from Cognito expire in 1 hour by default. When an API call comes back 401, the client must refresh silently, replay the original request, and expose the hiccup to the user only if refresh itself fails.

### The single-flight problem

If the screen fires three `useQuery` hooks in parallel and the access token just expired, all three return 401 at once. A naive "refresh on 401" triggers three concurrent refresh calls. Cognito may reject two of them (depending on refresh-token rotation settings), and you end up logged out even though the refresh was actually working.

The fix is a **single-flight lock**: one promise for "refresh in progress", to which all concurrent 401s subscribe. The first 401 triggers the refresh; the rest `await` the same promise.

```ts
// src/platform/auth/refreshLock.ts
import { getTokens, setTokens, clearTokens } from "./tokenStore";

interface RefreshResult {
  accessToken: string;
  expiresAt: number;
}

let inFlight: Promise<RefreshResult> | null = null;

/**
 * Refresh tokens against Cognito. Returns the new access token + expiry.
 * Concurrent callers share the same in-flight promise.
 */
export async function refreshTokens(
  cognitoDomain: string,
  clientId: string,
): Promise<RefreshResult> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const current = await getTokens(true); // needs the refresh token
    if (!current?.refreshToken) {
      throw new RefreshFailedError("no_refresh_token");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: current.refreshToken,
    });

    const res = await fetch(
      `https://${cognitoDomain}/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      // 400 "invalid_grant" = refresh token revoked / rotated out / expired.
      // User must sign in again.
      await clearTokens();
      throw new RefreshFailedError(`cognito_${res.status}`);
    }

    const json = (await res.json()) as {
      access_token: string;
      id_token: string;
      expires_in: number;
      refresh_token?: string; // only present if rotation is on
    };

    const next: Parameters<typeof setTokens>[0] = {
      accessToken: json.access_token,
      idToken: json.id_token,
      // If Cognito rotates refresh tokens, use the new one. Otherwise keep
      // the old one — cognito returns it only on rotation.
      refreshToken: json.refresh_token ?? current.refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    await setTokens(next);

    return { accessToken: next.accessToken, expiresAt: next.expiresAt };
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export class RefreshFailedError extends Error {
  constructor(public reason: string) {
    super(`token_refresh_failed:${reason}`);
  }
}
```

The interceptor in §4 calls `refreshTokens` from its 401 handler. If refresh fails (`RefreshFailedError`), the app clears all session state and navigates to `/sign-in`. See `./01-navigation.md` §auth-gated-routes for the redirect mechanics.

---

## Section 4: Networking abstraction

Every network call in Acme Shop goes through **one** module: `src/platform/net/apiClient.ts`. Screens and features call `apiClient.get("/products/42")` — they never touch `fetch` directly. That constraint buys us:

- **Base URL per EAS profile.** Dev, staging, prod read `apiBaseUrl` from `expo-constants.extra`. Changing the profile points the whole app at the new backend with zero code changes.
- **Authorization header in one place.** Every outgoing request gets `Authorization: Bearer <access_token>` automatically. Feature code never imports the token.
- **Single-flight refresh on 401.** One place to get right.
- **Typed envelopes.** Every response deserializes into `ApiResponse<T>` — callers destructure `{ success, data, error }` and can rely on the shape (same contract as `../../aws-cdk-patterns/references/05-shared-utilities.md` §4).
- **Retry, timeout, jitter** — all cross-cutting behavior captured once.

### Typed envelopes

Mirror the server shape. **Do not** redefine `ErrorCodes` client-side — import them from a shared package or copy them verbatim; drifting client codes from server codes is the single most common source of "caught exception, wrong branch" bugs.

```ts
// src/platform/net/types.ts

// Must match ApiResponse<T> in shared/types/api-responses.ts on the backend.
// See ../../aws-cdk-patterns/references/05-shared-utilities.md §4.
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
}

export type ErrorCode =
  // Auth
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "TOKEN_EXPIRED"
  | "SESSION_EXPIRED"
  | "INVALID_OTP"
  // Input
  | "INVALID_INPUT"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_FORMAT"
  | "PAYLOAD_TOO_LARGE"
  // Resources
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "CONFLICT"
  // Rate
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXCEEDED"
  // Server
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "DEPENDENCY_FAILURE"
  // Business
  | "INSUFFICIENT_FUNDS"
  | "OPERATION_NOT_ALLOWED";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
```

### `apiClient.ts`

```ts
// src/platform/net/apiClient.ts
import Constants from "expo-constants";
import { getAccessToken } from "../auth/tokenStore";
import { refreshTokens, RefreshFailedError } from "../auth/refreshLock";
import type { ApiResponse, ErrorCode } from "./types";
import { ApiError } from "./types";

interface Extra {
  apiBaseUrl: string;
  cognitoDomain: string;
  cognitoUserPoolWebClientId: string;
}
const extra = Constants.expoConfig?.extra as Extra | undefined;
if (!extra?.apiBaseUrl || !extra.cognitoDomain || !extra.cognitoUserPoolWebClientId) {
  // Crash loudly at startup — a missing base URL means every request would
  // silently fail against an undefined host.
  throw new Error("apiClient: missing extra.apiBaseUrl / cognito config");
}

const BASE_URL = extra.apiBaseUrl.replace(/\/$/, "");
const COGNITO_TOKEN_HOST = `${extra.cognitoDomain}.auth.us-east-1.amazoncognito.com`;
const CLIENT_ID = extra.cognitoUserPoolWebClientId;

// Tunables. Adjust per product: shopping apps tolerate ~10s timeouts;
// trading apps should be stricter.
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** If true, skip the Authorization header — used by /auth/token itself. */
  skipAuth?: boolean;
  /** If true, skip retry even on retryable statuses. */
  noRetry?: boolean;
  /** Set by the 401-retry path to prevent infinite refresh loops. */
  _refreshed?: boolean;
  /** AbortController from caller — composed with the internal timeout. */
  signal?: AbortSignal;
}

/**
 * The single entry point for all network I/O. Callers pass a typed generic
 * for the response shape of `data`; `request` returns `T` (unwrapped) on
 * success or throws an `ApiError` on failure.
 */
async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...opts.headers,
  };

  if (!opts.skipAuth) {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok.accessToken}`;
  }

  // Compose caller's signal with our timeout signal. Abort from either
  // source kills the request.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const signal = opts.signal
    ? composeSignals(opts.signal, timeoutController.signal)
    : timeoutController.signal;

  let attempt = 0;
  try {
    while (true) {
      attempt += 1;
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal,
        });

        // 401 -> refresh and retry exactly once.
        if (res.status === 401 && !opts.skipAuth && !opts._refreshed) {
          try {
            await refreshTokens(COGNITO_TOKEN_HOST, CLIENT_ID);
          } catch (err) {
            if (err instanceof RefreshFailedError) {
              // Signal the auth layer to sign out. The `useAuth` hook
              // (Section below) subscribes to this event.
              await onSessionLost();
              throw new ApiError(
                401,
                "SESSION_EXPIRED",
                "Your session has expired. Please sign in again.",
              );
            }
            throw err;
          }
          // Retry the original call with the new token. The _refreshed flag
          // prevents infinite loops if the fresh token also 401s.
          return request<T>(path, { ...opts, _refreshed: true });
        }

        // Retryable failure — back off and try again unless we hit the cap.
        if (
          RETRY_STATUSES.has(res.status) &&
          !opts.noRetry &&
          attempt <= MAX_RETRIES
        ) {
          await sleep(backoffMs(attempt));
          continue;
        }

        // Parse envelope. Non-2xx with a valid envelope -> ApiError.
        // Non-2xx without an envelope (HTML error page, CDN error) -> synthesized ApiError.
        const envelope = await parseEnvelope<T>(res);
        if (!res.ok || !envelope.success) {
          throw new ApiError(
            res.status,
            envelope.error?.code ?? statusToCode(res.status),
            envelope.error?.message ?? res.statusText,
            envelope,
          );
        }
        if (envelope.data === undefined) {
          // Success without data (e.g., 204). Returning `undefined` here is
          // fine — callers typed as `void` will accept it.
          return undefined as T;
        }
        return envelope.data;
      } catch (err) {
        // Network errors (no response) are retryable for idempotent methods.
        if (
          isNetworkError(err) &&
          !opts.noRetry &&
          attempt <= MAX_RETRIES &&
          isIdempotent(method)
        ) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseEnvelope<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text();
  if (!text) {
    return res.ok
      ? { success: true }
      : { success: false, error: { code: statusToCode(res.status), message: res.statusText } };
  }
  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    // Body was not our envelope (e.g., CloudFront HTML error page).
    return {
      success: false,
      error: { code: statusToCode(res.status), message: text.slice(0, 200) },
    };
  }
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 429) return "RATE_LIMIT_EXCEEDED";
  if (status >= 500) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

function isNetworkError(err: unknown): boolean {
  // fetch() throws TypeError "Network request failed" on RN for offline / DNS failures.
  return err instanceof TypeError && /network/i.test(err.message);
}

function isIdempotent(method: HttpMethod): boolean {
  return method === "GET" || method === "PUT" || method === "DELETE";
}

function backoffMs(attempt: number): number {
  // Exponential backoff: 250, 500, 1000ms base. Add 0-250ms jitter to avoid
  // thundering herds when a whole fleet of clients sees the same 503.
  const base = 250 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController();
  const onAbort = (): void => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener("abort", onAbort);
  b.addEventListener("abort", onAbort);
  return c.signal;
}

// Fired by the 401 path when refresh fails. The auth layer listens and
// navigates to /sign-in after clearing Zustand slices.
type SessionLostListener = () => void | Promise<void>;
const listeners: SessionLostListener[] = [];
export function onSessionLostEvent(fn: SessionLostListener): () => void {
  listeners.push(fn);
  return (): void => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
async function onSessionLost(): Promise<void> {
  await Promise.all(listeners.map((fn) => fn()));
}

export const apiClient = {
  get: <T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}) =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(
    path: string,
    body?: unknown,
    opts: Omit<RequestOptions, "method" | "body"> = {},
  ) => request<T>(path, { ...opts, method: "POST", body }),
  put: <T>(
    path: string,
    body?: unknown,
    opts: Omit<RequestOptions, "method" | "body"> = {},
  ) => request<T>(path, { ...opts, method: "PUT", body }),
  patch: <T>(
    path: string,
    body?: unknown,
    opts: Omit<RequestOptions, "method" | "body"> = {},
  ) => request<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(
    path: string,
    opts: Omit<RequestOptions, "method" | "body"> = {},
  ) => request<T>(path, { ...opts, method: "DELETE" }),
};
```

Usage from a feature:

```ts
// src/features/catalog/api.ts
import { apiClient } from "@/platform/net/apiClient";

export interface Product {
  productId: string;
  name: string;
  priceCents: number;
  version: number; // optimistic-lock field
}

export async function fetchProduct(id: string): Promise<Product> {
  return apiClient.get<Product>(`/products/${id}`);
}

export async function updateProduct(
  id: string,
  patch: Partial<Product>,
  version: number,
): Promise<Product> {
  return apiClient.put<Product>(`/products/${id}`, { ...patch, version });
}
```

### `useAuth` — Zustand store wrapping the session

The UI needs a reactive hook for "am I signed in" and "who am I". Keep it a Zustand store so React re-renders on sign-in / sign-out without threading props.

```tsx
// src/features/auth/useAuth.tsx
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useEffect } from "react";
import { clearTokens, getTokens, setTokens, type TokenSet } from "@/platform/auth/tokenStore";
import { onSessionLostEvent } from "@/platform/net/apiClient";
import { decodeJwt } from "@/platform/auth/jwt"; // small helper (not shown)

interface Claims {
  sub: string;
  email?: string;
  "cognito:username"?: string;
}

interface AuthState {
  status: "loading" | "signed_out" | "signed_in";
  userId: string | null;
  email: string | null;
  setSession(tokens: TokenSet): Promise<void>;
  signOut(): Promise<void>;
  hydrate(): Promise<void>;
}

export const useAuth = create<AuthState>()(
  subscribeWithSelector((set) => ({
    status: "loading",
    userId: null,
    email: null,

    setSession: async (tokens) => {
      await setTokens(tokens);
      const claims = decodeJwt<Claims>(tokens.idToken);
      set({
        status: "signed_in",
        userId: claims.sub,
        email: claims.email ?? null,
      });
    },

    signOut: async () => {
      await clearTokens();
      set({ status: "signed_out", userId: null, email: null });
    },

    hydrate: async () => {
      const tokens = await getTokens(false);
      if (!tokens) {
        set({ status: "signed_out", userId: null, email: null });
        return;
      }
      const claims = decodeJwt<Claims>(tokens.idToken);
      set({
        status: "signed_in",
        userId: claims.sub,
        email: claims.email ?? null,
      });
    },
  })),
);

/**
 * Mount once at the root. Hydrates the store from SecureStore on first run,
 * and subscribes to session-lost events from the apiClient's 401 handler.
 */
export function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const hydrate = useAuth((s) => s.hydrate);
  const signOut = useAuth((s) => s.signOut);

  useEffect(() => {
    void hydrate();
    return onSessionLostEvent(signOut);
  }, [hydrate, signOut]);

  return <>{children}</>;
}
```

Mount `<AuthGate>` in `app/_layout.tsx` just inside the `<QueryClientProvider>`. The `(shop)` route group in `./01-navigation.md` gates on `useAuth((s) => s.status === 'signed_in')`.

### `signInWithGoogle.ts` — PKCE via Cognito hosted UI

The actual sign-in call. Keep it pure (no React) so it can be called from any screen — a "Sign in" button, a revocation flow, or tests.

```ts
// src/features/auth/signInWithGoogle.ts
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { useAuth } from "./useAuth";

WebBrowser.maybeCompleteAuthSession();

interface Extra {
  cognitoDomain: string;
  cognitoUserPoolWebClientId: string;
}
const extra = Constants.expoConfig?.extra as Extra;
const COGNITO_HOST = `${extra.cognitoDomain}.auth.us-east-1.amazoncognito.com`;

// Discovery endpoints are stable for Cognito. If you later change region
// or pool, `useAutoDiscovery(`https://${host}`)` also works.
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `https://${COGNITO_HOST}/oauth2/authorize`,
  tokenEndpoint: `https://${COGNITO_HOST}/oauth2/token`,
  revocationEndpoint: `https://${COGNITO_HOST}/oauth2/revoke`,
};

const REDIRECT = AuthSession.makeRedirectUri({ scheme: "acmeshop", path: "auth/callback" });

export type SignInOutcome =
  | { kind: "success" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/**
 * Called from the SignInScreen. Builds an AuthRequest with PKCE, opens the
 * Cognito hosted UI with identity_provider=Google, exchanges the code for
 * tokens, and writes the session.
 */
export async function signInWithGoogle(): Promise<SignInOutcome> {
  // PKCE is on by default in AuthSession (usePKCE: true). The request
  // generates a random code_verifier and its SHA256 challenge.
  const request = new AuthSession.AuthRequest({
    clientId: extra.cognitoUserPoolWebClientId,
    redirectUri: REDIRECT,
    scopes: ["openid", "email", "profile"],
    responseType: AuthSession.ResponseType.Code,
    // Route through Google via Cognito. Cognito reads this param and
    // skips the hosted-UI provider picker.
    extraParams: { identity_provider: "Google" },
    usePKCE: true,
  });

  // Prepare loads the discovery / builds the URL.
  await request.makeAuthUrlAsync(discovery);

  const result = await request.promptAsync(discovery, { showInRecents: false });

  if (result.type === "cancel" || result.type === "dismiss") {
    return { kind: "cancelled" };
  }
  if (result.type !== "success") {
    return { kind: "error", message: `auth_${result.type}` };
  }

  const code = result.params.code;
  if (!code) return { kind: "error", message: "no_code" };

  // Exchange code for tokens. `request.codeVerifier` is the PKCE verifier
  // generated at request construction.
  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: extra.cognitoUserPoolWebClientId,
      code,
      redirectUri: REDIRECT,
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    discovery,
  );

  if (!tokens.accessToken || !tokens.refreshToken || !tokens.idToken) {
    return { kind: "error", message: "missing_tokens" };
  }

  await useAuth.getState().setSession({
    accessToken: tokens.accessToken,
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
  });

  return { kind: "success" };
}
```

Usage from the sign-in screen:

```tsx
// app/sign-in.tsx
import { View, Pressable, Text, Alert } from "react-native";
import { useRouter } from "expo-router";
import { signInWithGoogle } from "@/features/auth/signInWithGoogle";

export default function SignInScreen(): React.ReactElement {
  const router = useRouter();

  async function handleGoogle(): Promise<void> {
    const outcome = await signInWithGoogle();
    if (outcome.kind === "success") {
      router.replace("/(shop)");
    } else if (outcome.kind === "error") {
      Alert.alert("Sign in failed", outcome.message);
    }
    // cancelled -> stay on screen silently
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Pressable onPress={handleGoogle} accessibilityRole="button">
        <Text>Continue with Google</Text>
      </Pressable>
    </View>
  );
}
```

---

## Section 5: SigV4 vs JWT

Two ways mobile apps authenticate to AWS. They apply to different scenarios; picking the wrong one costs weeks.

| | JWT (Cognito User Pool + API Gateway authorizer) | SigV4 (Cognito Identity Pool + IAM-auth'd API / direct AWS SDK) |
|---|---|---|
| **Credentials on device** | Short-lived access token (1 hour) | AWS access key + secret key + session token (derived from identity pool) |
| **API Gateway auth type** | `COGNITO_USER_POOLS` | `AWS_IAM` |
| **What the client sends** | `Authorization: Bearer <jwt>` | Signed request (headers include `Authorization: AWS4-HMAC-SHA256 ...`) |
| **Backend validates** | JWT signature + iss/aud/exp | IAM policy on the signed principal |
| **When to use** | 99% of mobile-to-backend calls | Direct-to-S3 uploads, direct DynamoDB reads from mobile (rare), IoT |
| **Required extra infra** | Cognito User Pool | User Pool **plus** Identity Pool (maps user pool users to IAM roles) |

**Acme Shop, and almost every mobile app, is JWT-only.** The API Gateway in `../../aws-cdk-patterns/references/01-serverless-api.md` is configured with a Cognito authorizer; every Lambda receives `event.requestContext.authorizer.jwt.claims` with the user's `sub`, and authorization decisions are made server-side.

**When SigV4 is the right tool** (and when you'd even consider it):

- **Direct uploads to S3** where you want to skip a Lambda pre-signing step. Cheaper, but requires Identity Pool plumbing; prefer `getSignedUrl` from a small Lambda unless you're uploading 10 GB+ files.
- **IoT device shadow** — `aws-amplify/pubsub` with IoT Core, which needs SigV4 to sign MQTT-over-WebSocket.
- **Direct DynamoDB from mobile** — never a good idea for customer data. If you're tempted, you need a backend.

We do **not** include a SigV4 signing example in this skill. If you need one, reach for `@aws-sdk/client-*` — the v3 SDK signs automatically when you pass credentials from `fromCognitoIdentityPool`. The flow is: sign in via Cognito User Pool as usual, then exchange the User Pool ID token for Identity Pool credentials, then call the AWS SDK with those credentials. Every step is documented on the AWS side; the mobile-specific part is just "pass the Identity Pool ID and the user's ID token to `fromCognitoIdentityPool`".

---

## Section 6: Stale-data conflicts (HTTP 409)

When two devices edit the same resource concurrently, one of them writes against a stale version. The DynamoDB layer catches this via `ConditionalCheckFailedException` (see `../../dynamodb-design/references/03-write-correctness.md` §optimistic-locking); the Lambda wrapper translates it to HTTP 409 with `error.code = "CONFLICT"`. On the mobile side, the fix is to surface the conflict honestly and let the user decide.

The wrong pattern: silently overwrite the latest version. The user just lost another device's edit and has no idea.

The right pattern: show a dismissible banner explaining that the item changed, fetch the latest, and let the user retry their edit.

```tsx
// src/features/cart/CartLineEditor.tsx
import { useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/platform/net/types";
import { apiClient } from "@/platform/net/apiClient";

interface CartLine {
  lineId: string;
  productId: string;
  quantity: number;
  version: number;
}

export function CartLineEditor({ line }: { line: CartLine }): React.ReactElement {
  const [draft, setDraft] = useState(String(line.quantity));
  const [conflict, setConflict] = useState(false);
  const qc = useQueryClient();

  const updateQty = useMutation({
    mutationFn: (qty: number) =>
      apiClient.patch<CartLine>(`/cart/lines/${line.lineId}`, {
        quantity: qty,
        version: line.version,
      }),
    onSuccess: (updated) => {
      setConflict(false);
      qc.setQueryData<CartLine>(["cart", "line", line.lineId], updated);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setConflict(true);
        // Refetch so the user sees the other device's edit.
        void qc.invalidateQueries({ queryKey: ["cart", "line", line.lineId] });
      }
    },
  });

  if (conflict) {
    return (
      <View accessibilityLiveRegion="polite">
        <Text>
          This item changed on another device. Refresh to see the latest, then
          try again.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // Clear the banner, the refetched data is already in the cache.
            setConflict(false);
          }}
        >
          <Text>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        keyboardType="number-pad"
        accessibilityLabel="Quantity"
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const qty = parseInt(draft, 10);
          if (!Number.isNaN(qty)) updateQty.mutate(qty);
        }}
      >
        <Text>{updateQty.isPending ? "Saving..." : "Update"}</Text>
      </Pressable>
    </View>
  );
}
```

Three details worth highlighting:

- **The retry affordance is not automatic.** After a conflict, we refetch but do not re-submit the user's edit. The user may see the other device changed the quantity to something they like — auto-retrying would overwrite *their* legitimate edit.
- **The `version` field is part of the mutation payload.** The backend reads it and plugs it into the `ConditionExpression = version = :v`. See `../../dynamodb-design/references/03-write-correctness.md` §optimistic-locking for how the server turns that into a safe write.
- **`accessibilityLiveRegion="polite"`** matters. Screen-reader users need to hear that the edit failed without a focus shift; `polite` reads the region when VoiceOver is idle. See `./07-i18n-and-accessibility.md` §live-regions.

---

## Section 7: Biometric unlock

Users expect Acme Shop to stay signed in across app restarts, but a lost phone with a valid refresh token is a session-hijacking risk. `expo-local-authentication` lets us gate *access to the refresh token* behind Face ID / Touch ID / passcode on cold start and after long backgrounding.

The pattern is **prompt on cold start and on app resume after ≥30 minutes**, not on every request. More often is user-hostile; less often defeats the point.

```ts
// src/platform/auth/biometricGate.ts
import * as LocalAuthentication from "expo-local-authentication";
import { getTokens } from "./tokenStore";

interface UnlockResult {
  ok: boolean;
  reason?:
    | "no_hardware"
    | "not_enrolled"
    | "user_cancel"
    | "system_cancel"
    | "lockout"
    | "unknown";
}

/**
 * Attempt to unlock the refresh token. On success, the caller can safely
 * call getTokens(true) to read the refresh-token entry from SecureStore.
 */
export async function unlockForRefresh(): Promise<UnlockResult> {
  const hasHw = await LocalAuthentication.hasHardwareAsync();
  if (!hasHw) {
    // No biometric sensor. Fall back to passcode only if the user has one;
    // otherwise, degrade gracefully — let them in and rely on tokenStore's
    // keychainAccessible policy for at-rest protection.
    return { ok: true, reason: "no_hardware" };
  }

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) {
    // Hardware is present but no fingerprints / Face ID enrolled.
    // Again, fall back — forcing enrollment is outside the app's scope.
    return { ok: true, reason: "not_enrolled" };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Acme Shop",
    // iOS-only: allow the user to fall back to device passcode after
    // N biometric failures. Android uses BiometricPrompt's built-in fallback.
    fallbackLabel: "Use passcode",
    // Android: if true, disable passcode fallback (strict biometric).
    disableDeviceFallback: false,
    cancelLabel: "Cancel",
  });

  if (result.success) return { ok: true };

  // LocalAuthenticationResult error codes (as of SDK 54):
  //   "user_cancel"    -> tapped Cancel
  //   "system_cancel"  -> OS backgrounded the prompt
  //   "app_cancel"     -> app called cancelAsync()
  //   "authentication_failed" -> too many bad attempts, not yet lockout
  //   "user_fallback"  -> iOS user chose fallback (password)
  //   "biometric_lockout"     -> too many failures, temporarily locked
  //   "biometric_lockout_permanent" -> must re-enroll
  //   "not_enrolled"   -> enrollment was removed mid-session
  //   "not_available"  -> hardware unreachable
  return { ok: false, reason: normalizeError(result.error) };
}

function normalizeError(code: string | undefined): UnlockResult["reason"] {
  if (!code) return "unknown";
  if (code === "user_cancel" || code === "user_fallback") return "user_cancel";
  if (code === "system_cancel" || code === "app_cancel") return "system_cancel";
  if (code.includes("lockout")) return "lockout";
  if (code === "not_enrolled" || code === "not_available") return "not_enrolled";
  return "unknown";
}

/**
 * Hot-path wrapper: on cold start or resume-after-30min, prompt once,
 * then call this to actually fetch tokens. Subsequent requests in the
 * same session read access tokens without re-prompting.
 */
export async function ensureUnlocked(): Promise<boolean> {
  const unlock = await unlockForRefresh();
  if (!unlock.ok) return false;
  const tokens = await getTokens(true);
  return tokens !== null;
}
```

Wire it into the app-resume lifecycle:

```tsx
// src/features/auth/BiometricResumeGate.tsx
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { ensureUnlocked } from "@/platform/auth/biometricGate";
import { useAuth } from "./useAuth";

const RELOCK_AFTER_MS = 30 * 60_000; // 30 minutes

export function BiometricResumeGate(): null {
  const lastActive = useRef(Date.now());
  const signOut = useAuth((s) => s.signOut);

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      if (next === "background" || next === "inactive") {
        lastActive.current = Date.now();
        return;
      }
      if (next === "active") {
        const away = Date.now() - lastActive.current;
        if (away < RELOCK_AFTER_MS) return; // no prompt
        const ok = await ensureUnlocked();
        if (!ok) await signOut();
      }
    });
    return () => sub.remove();
  }, [signOut]);

  return null;
}
```

Mount `<BiometricResumeGate />` at the root (same place as `<AuthGate />`). It renders nothing; it only subscribes to `AppState`. The gate deliberately does not run on the *initial* foreground — that is handled by `AuthGate.hydrate()`, which calls `ensureUnlocked()` once before hydrating `signed_in` state.

---

## Section 8: Gotchas (auth-specific)

### 8.1 Cognito redirect loop — callback URL mismatch

**Symptom.** User taps "Sign in with Google", goes through Google's sign-in, returns to a Cognito error page that says `redirect_mismatch`, or the web view closes and the app shows the sign-in screen again with no error.

**Cause.** The `redirectUri` the app sends does not appear in the Cognito App Client's `CallbackURLs`. Cognito compares these byte-for-byte, including trailing slashes and URL-encoding of `://`.

**Diagnosis.**
```ts
// Inside signInWithGoogle.ts, BEFORE promptAsync:
console.log("redirect_uri the app will use:", REDIRECT);
```
Compare the printed value against the CDK stack's `oAuth.callbackUrls` in `../../aws-cdk-patterns/references/02-auth-stack.md`. Common drift sources: `acmeshop://auth/callback` vs `acmeshop://auth/callback/` (trailing slash), `exp://...` vs `acmeshop://...` (dev client vs prod build), case mismatch.

**Fix.** Add the exact URI to the App Client's `callbackUrls` list and redeploy the stack. Do not use wildcards — Cognito does not support them and will reject the entire list.

### 8.2 SecureStore biometric prompt blocks on app resume

**Symptom.** App resumes from background; UI looks frozen for 10-30 seconds; no error in the console.

**Cause.** `SecureStore.getItemAsync` with `requireAuthentication: true` blocks the JS thread while waiting for Face ID. If you call it in `useEffect` on a resume event without awaiting from a non-blocking path, every render waits for biometrics.

**Fix.** Guard the call behind an explicit user action (our `BiometricResumeGate` is an `AppState` listener, not a render-time read). Never read the biometric-gated key in the render path — always through an event handler.

### 8.3 Single-flight refresh missed when the lock is reset mid-request

**Symptom.** Under network flakiness, two concurrent requests both return 401; both call `refreshTokens()`; one succeeds, one silently logs the user out.

**Cause.** If the `inFlight` promise resolves between the first 401 and the second 401's `refreshTokens()` call, the second request sees `inFlight === null` and starts its own refresh. If Cognito has rotation on, only one of the two refresh calls keeps a valid refresh token; the other is revoked, and the next refresh fails.

**Fix.** Do **not** set `inFlight = null` until the retry of the original request also completes. The version in §3 resets `inFlight = null` in `finally` — for apps with aggressive parallelism, tighten this further by making `inFlight` a promise of `{ result, generation }` and tracking a `generation` counter that the retry path compares to. For Acme Shop's traffic, §3's version is fine.

### 8.4 JWT clock skew

**Symptom.** Fresh access tokens are rejected by API Gateway with `Unauthorized`; error message mentions `token_expired` even though the token was issued seconds ago.

**Cause.** Device clock is off by >5 minutes from AWS's clock. Cognito's token `iat` (issued-at) is later than the server's current time, or the device is ahead of AWS and the token hasn't "started" yet.

**Fix.** Trust network time. Do not let users override the device clock in production. Detect via `Math.abs(Date.now() - serverTimeFromResponseHeader) > 60_000` and show a "Please check your device's time setting" message. For tokens that have this issue, the 401 path will refresh — which usually gets a server-dated token, solving the symptom — but the underlying clock skew remains.

### 8.5 `useAuthRequest` hook returns a stable `request` that doesn't update on config change

**Symptom.** You pass `clientId` from state, change it, and the next `promptAsync()` uses the old value.

**Cause.** `useAuthRequest` memoizes on the initial props. This is by design — PKCE requires a stable verifier across a single flow.

**Fix.** Either do not use the hook (use `new AuthRequest(...)` directly, as our `signInWithGoogle.ts` does), or remount the component (by keying it on `clientId`).

---

## Section 9: Verification

Run before every release; also after any bump of `expo-auth-session`, `expo-secure-store`, or `expo-local-authentication`.

```bash
# 1. TypeScript strict pass. The generics on apiClient propagate all the way
#    through to useQuery; a bad response type surfaces here.
npx tsc --noEmit

# 2. Unit tests for the refresh lock and envelope parser. These are pure TS;
#    mock fetch to simulate 401 -> refresh -> retry.
npx jest src/platform/auth src/platform/net
```

### Discovery document sanity check

Cognito's hosted UI exposes a standard OIDC discovery document. Hit it once during boot in dev mode to fail loudly on misconfig:

```ts
// src/platform/auth/sanity.ts  (DEV ONLY — do not ship)
import Constants from "expo-constants";

export async function verifyCognitoDiscovery(): Promise<void> {
  const host = `${Constants.expoConfig?.extra?.cognitoDomain}.auth.us-east-1.amazoncognito.com`;
  const res = await fetch(`https://${host}/.well-known/openid-configuration`);
  if (!res.ok) {
    console.warn(
      `[auth] discovery fetch failed: ${res.status}. Check cognitoDomain in app.config.ts.`,
    );
    return;
  }
  const d = await res.json();
  const expected = [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ];
  for (const field of expected) {
    if (!d[field]) {
      console.warn(`[auth] discovery missing ${field}`);
    }
  }
  console.log(`[auth] discovery OK: ${d.issuer}`);
}
```

Call `void verifyCognitoDiscovery()` from `app/_layout.tsx` guarded by `if (__DEV__)`. Misconfigured domain → console warning before the user taps anything.

### Forced-401 retry test

Prove the refresh-and-retry path works on a real device. Add a dev-only endpoint or a query param the backend honors that always returns 401. Then:

```bash
# 1. Sign in.
# 2. Navigate to the catalog screen (which calls /products).
# 3. Toggle a dev switch that adds ?force401=true to the next GET /products.
# 4. Pull to refresh the catalog.
# 5. Observe in the dev network log:
#    GET /products?force401=true -> 401
#    POST /oauth2/token          -> 200 (refresh)
#    GET /products?force401=true -> 200 (retry with new bearer)
# 6. The UI does NOT show a sign-in prompt; catalog renders normally.
```

If step 6 fails (user gets bounced to sign-in), either the refresh call is failing (inspect the `POST /oauth2/token` body — mismatched `client_id`?) or the retry isn't using the new token (the `_refreshed` flag path in §4 is broken).

### Redirect URI drift check

Automated in CI — compare the app's scheme to the Cognito stack's allowlist:

```bash
# Run this as a CI step against the staging Cognito client.
aws cognito-idp describe-user-pool-client \
  --user-pool-id "$STAGING_USER_POOL_ID" \
  --client-id "$STAGING_CLIENT_ID" \
  --query 'UserPoolClient.CallbackURLs' \
  --output text
# Expected to contain: acmeshop://auth/callback
```

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — `src/platform/` + `src/features/` split the `apiClient` and `useAuth` live in; `app.config.ts` plugin entries for `expo-secure-store` and `expo-local-authentication`; EAS profiles that supply `apiBaseUrl` / `cognitoDomain` per environment.
  - `./01-navigation.md` — The `(shop)` auth-gated route group that reads `useAuth((s) => s.status)`; the `/sign-in` screen that calls `signInWithGoogle`.
  - `./02-state-and-data.md` — The Zustand store pattern the `useAuth` hook follows; the offline queue (§4) that serializes pending mutations and needs a valid bearer token on replay.
  - `./04-native-and-release.md` — Silent-push refresh flow that reads the biometric-gated refresh token during background wake-ups; why `keychainAccessible: AFTER_FIRST_UNLOCK` matters.
  - `./06-performance-and-testing.md` — Mocking `apiClient` in tests (MSW + a thin wrapper); Detox flows for sign-in happy path and cancellation.
  - `./08-observability.md` — Sentry breadcrumbs for every `apiClient` call; how to capture a 401 -> refresh -> retry trace without leaking tokens.
  - `./10-gotchas.md` — Full diagnostic catalogue indexed by symptom.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/02-auth-stack.md` — Cognito User Pool + App Client provisioning: `userPoolWebClientId`, `domain`, `oAuth.callbackUrls`, Google identity provider federation.
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — API Gateway Cognito authorizer, `event.requestContext.authorizer.jwt.claims`, and the request shape the `apiClient` targets.
  - `../../aws-cdk-patterns/references/05-shared-utilities.md` — Canonical `ApiResponse<T>` and `ErrorCodes` enum; match the client copy in `src/platform/net/types.ts` to this definition exactly.
  - `../../dynamodb-design/references/03-write-correctness.md` — `ConditionalCheckFailedException` → HTTP 409 translation; the `version` field the `updateProduct` / `updateCartLine` mutations send.
- **External documentation:**
  - [`expo-auth-session` — Authentication guide](https://docs.expo.dev/versions/latest/sdk/auth-session/) — `AuthRequest`, `useAuthRequest`, PKCE defaults, `exchangeCodeAsync`, `makeRedirectUri`.
  - [`expo-auth-session` — OAuth providers: Cognito](https://docs.expo.dev/guides/authentication/#amazon-cognito) — Hosted UI pattern, `identity_provider` param for Google / Apple / Facebook federation.
  - [`expo-secure-store` — API reference](https://docs.expo.dev/versions/latest/sdk/securestore/) — `requireAuthentication`, `keychainAccessible`, `authenticationPrompt`; `AFTER_FIRST_UNLOCK` vs `WHEN_UNLOCKED` tradeoffs.
  - [`expo-local-authentication` — API reference](https://docs.expo.dev/versions/latest/sdk/local-authentication/) — `hasHardwareAsync`, `isEnrolledAsync`, `authenticateAsync` result shape (`success`, `error`, `warning`).
  - [Amazon Cognito — Using OAuth 2.0 grants](https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoints-oauth-grants.html) — Hosted UI request / response shapes, PKCE support, refresh-token rotation settings.
  - [OAuth 2.0 — PKCE (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636) — Why PKCE is required for mobile clients; verifier / challenge construction.
