# State and data

**Builds:** The complete client- and server-state surface for Acme Shop — Zustand for local UI state, TanStack Query for server state, MMKV for hot persisted state, `expo-secure-store` for secrets, and an offline mutation queue that replays when the network returns. Every example extends the Acme Shop worked example introduced in `./00-architecture.md` and navigated in `./01-navigation.md`.
**When to use:** Adding a new store, wiring a screen to the backend, debugging stale-cache bugs, implementing optimistic mutations, or hardening a flow against offline use. Read Sections 1–2 before writing any cache key; Sections 3–6 before implementing any mutation against the backend.
**Prerequisites:** `./00-architecture.md` (the `app/` + `src/features/` split, `app.config.ts`, and the Acme Shop scope) and `./01-navigation.md` (the `(shop)` auth-gated layout — this file assumes a `useAuth()` hook exists but defers its implementation to `./03-auth-and-networking.md`).

> Examples verified against Expo SDK 54 + @tanstack/react-query v5.90.3 + zustand v5.0.12 + react-native-mmkv (latest — `createMMKV` API, not the legacy v2 `new MMKV()` constructor) on 2026-04-23. Re-verify via context7 before porting to a newer SDK.

## Contents

1. **Client state** — Zustand as the default; when Redux Toolkit is warranted (team experience, time-travel dev tools, action replay for bug repros); why React Context is limited to theme/auth/locale.
2. **Server state** — TanStack Query v5 for network state; sensible defaults (`staleTime: 5 * 60_000`, `gcTime: 24 * 3600_000`, `retry: 3`); `networkMode: 'offlineFirst'`; the three query keys every feature should have.
3. **Storage tradeoffs** — Decision table: `expo-secure-store` for tokens / biometric secrets; `react-native-mmkv` for hot app state (sync reads, encrypted, ~30x faster than AsyncStorage); `AsyncStorage` only as a legacy escape hatch.
4. **Offline sync** — Mutation queue pattern: persist pending mutations to MMKV, replay on `NetInfo` reconnect, detect stale server state via an optimistic-lock `version` field.
5. **Optimistic updates** — Full cart-increment example with TanStack Query: `onMutate` cancels in-flight queries and snapshots; `onError` rolls back from the snapshot; `onSettled` invalidates. Pending-state UI pattern for subtle visual feedback.
6. **Background sync** — `expo-task-manager` + `expo-background-task` for periodic catch-up; constraints (advisory intervals, iOS ≥ 15-minute minimum, neither platform guarantees timing); when push-driven sync is a better choice.
7. **Gotchas (state/data slice)** — Zustand `persist` with MMKV performance traps, TanStack Query `gcTime` naming change from v4, `SecureStore.getItemAsync` blocking the JS thread on cold start when biometrics are required, `useMMKVKeys` rerenders.
8. **Verification** — React Query Devtools via the React Native plugin; MMKV read-perf sanity check; offline-queue integration test.
9. **Further reading** — Pointers into the rest of this skill and the sibling skills.

---

## Section 1: Client state

Acme Shop has four distinct state shapes. Knowing which belongs where is half the battle:

| Shape | Example | Where it lives |
|---|---|---|
| Ephemeral UI | Modal open/closed, current tab, form draft | `useState` / `useReducer`, local to the component |
| Cross-screen client | Cart contents, wishlist, theme | **Zustand store** |
| Server data | Product catalog, order history, user profile | **TanStack Query cache** |
| Sensitive identity | Access / refresh tokens, biometric flags | **expo-secure-store** |

Do not invert these. Cart contents in TanStack Query is wrong — TanStack treats the data as *derived* from the server and will refetch it, discarding your optimistic edits. User profile in a Zustand store is wrong — it invites stale writes and duplicate source-of-truth bugs. Tokens in MMKV is wrong — MMKV is encrypted, but not hardware-backed; iOS keychain and Android keystore are.

### Why Zustand is this skill's default

Zustand is ~1 KB, has zero boilerplate, and composes naturally with MMKV for persistence. For 90% of React Native apps, it is the right answer because:

- **One hook per slice.** `useCartStore()` returns the whole store; you select with a selector (`useCartStore((s) => s.items)`). Re-render cost is controlled by the selector, not by a Provider tree.
- **No Provider.** Zustand stores are module-level singletons. You can `import useCartStore` and call `useCartStore.getState()` outside React (useful in the offline queue — Section 4).
- **First-class middleware.** `persist`, `subscribeWithSelector`, `immer`, and `devtools` are ~200 lines each; you assemble only what you need.
- **Testable.** Stores are just functions: `useCartStore.setState({ items: [] })` in a Jest `beforeEach` resets the world without remounting a tree.

### When Redux Toolkit is the right tool

Pick Redux Toolkit (RTK) over Zustand when any of these apply:

- **Your team already knows Redux inside out.** The learning gradient of Zustand is trivial, but a team that has been doing RTK for five years will hit Zustand pitfalls around selector memoization and shallow equality. "Use the tool the team already has" beats architectural purity.
- **You need the Redux DevTools time-travel experience specifically.** Zustand supports Redux DevTools via its `devtools` middleware, but RTK has the full action-replay / action-diff UX that many debugging workflows depend on. If a senior on the team's first instinct for "what broke this state" is to scrub a DevTools timeline, that workflow is two years old and hard to retrain.
- **You want to record + replay user sessions for bug repros.** Every state transition through Redux goes through a serializable action, which means a crash reporter can log the last N actions and you can deterministically re-render the app from that tape. Zustand's state changes go through `set()` — serializable in practice, but you lose action *names*, so the tape is harder to read.
- **You already use RTK Query.** Do not mix TanStack Query and RTK Query in the same app. If your backend contracts are already typed through RTK Query, stick with it and skip TanStack Query entirely.

Everything else in this skill assumes Zustand. If you pick RTK, the Zustand slices translate to RTK slices one-for-one; the persistence layer (MMKV) and server-state layer (TanStack Query, optional) stay the same.

### Why React Context is the wrong default

Context is not state management — it is a *dependency-injection* mechanism. Every consumer of a Context re-renders when the Context value changes, and React cannot skip consumers that only read a tiny slice of the value (the whole object compares by reference). So Context is fine for values that change rarely and are consumed broadly:

- **Theme** — Changes once per user action (light → dark).
- **Auth session** — Changes once per sign-in / sign-out. See `./03-auth-and-networking.md` for the `AuthProvider` implementation this skill uses.
- **Locale** — Changes once per language switch. See `./07-i18n-and-accessibility.md`.

**Do not** put cart contents, form state, selected-product state, or catalog data in a Context. Every swipe on a product card would re-render every cart badge. Zustand (or `useState` at the right level) is the right answer.

### A Zustand store with MMKV persist

The backbone of Acme Shop's client state is the cart. We persist it via MMKV so that a user who adds a product, backgrounds the app, and comes back five minutes later does not lose their cart. MMKV reads are synchronous, so the cart renders at its persisted state on the first frame — no "loading cart..." placeholder needed.

```tsx
// src/features/cart/state/cart-store.ts
import { createMMKV } from "react-native-mmkv";
import { StateStorage } from "zustand/middleware";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// One MMKV instance per concern. Splitting instances isolates rehydration
// failures: a corrupt `cart` instance cannot take down `catalog-cache`.
// `id` is the on-disk identifier; `encryptionKey` ensures every byte on disk
// is AES-128 encrypted. We do NOT put this key in source control in production;
// see `./03-auth-and-networking.md` §device-bound-key for how to derive it
// from `expo-secure-store`.
const cartStorage = createMMKV({
  id: "acme-cart",
  encryptionKey: process.env.EXPO_PUBLIC_MMKV_CART_KEY ?? "dev-only-cart-key",
});

// Adapter between Zustand's `createJSONStorage` shape and MMKV's sync API.
// `getItem` / `setItem` / `removeItem` are synchronous here — that is fine;
// Zustand accepts sync or async storages. Staying sync means rehydration
// completes on the first render, not on a later `useEffect`.
const zustandMMKVStorage: StateStorage = {
  getItem: (name) => cartStorage.getString(name) ?? null,
  setItem: (name, value) => {
    cartStorage.set(name, value);
  },
  removeItem: (name) => {
    cartStorage.remove(name);
  },
};

export type CartLine = {
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
  /** Server-assigned monotonic version — see `../../dynamodb-design/references/03-write-correctness.md` §optimistic-locking. */
  readonly version: number;
};

type CartState = {
  readonly items: readonly CartLine[];
  /** Monotonic version of the whole cart as acknowledged by the server. */
  readonly syncedVersion: number;
  /** Lines whose optimistic edit has not yet been confirmed by the server. */
  readonly pendingLineIds: readonly string[];
};

type CartActions = {
  addLine: (line: Omit<CartLine, "quantity" | "version">) => void;
  incrementLine: (productId: string, delta: number) => void;
  removeLine: (productId: string) => void;
  markLinePending: (productId: string) => void;
  markLineSynced: (productId: string, version: number) => void;
  clear: () => void;
};

const initialState: CartState = {
  items: [],
  syncedVersion: 0,
  pendingLineIds: [],
};

export const useCartStore = create<CartState & CartActions>()(
  persist(
    (set) => ({
      ...initialState,
      addLine: (line) =>
        set((state) => {
          const existing = state.items.find((l) => l.productId === line.productId);
          if (existing !== undefined) {
            return {
              items: state.items.map((l) =>
                l.productId === line.productId ? { ...l, quantity: l.quantity + 1 } : l,
              ),
            };
          }
          return { items: [...state.items, { ...line, quantity: 1, version: 0 }] };
        }),
      incrementLine: (productId, delta) =>
        set((state) => ({
          items: state.items
            .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
            .filter((l) => l.quantity > 0),
        })),
      removeLine: (productId) =>
        set((state) => ({
          items: state.items.filter((l) => l.productId !== productId),
        })),
      markLinePending: (productId) =>
        set((state) => ({
          pendingLineIds: state.pendingLineIds.includes(productId)
            ? state.pendingLineIds
            : [...state.pendingLineIds, productId],
        })),
      markLineSynced: (productId, version) =>
        set((state) => ({
          items: state.items.map((l) => (l.productId === productId ? { ...l, version } : l)),
          pendingLineIds: state.pendingLineIds.filter((id) => id !== productId),
          syncedVersion: Math.max(state.syncedVersion, version),
        })),
      clear: () => set(initialState),
    }),
    {
      name: "acme-cart-v1",
      // `createJSONStorage` is the current Zustand v5 idiom — passing a raw
      // `StateStorage` also works but loses the JSON.parse/stringify helpers.
      storage: createJSONStorage(() => zustandMMKVStorage),
      // Bump this when you change the shape of persisted state. The `migrate`
      // callback receives the old state; return a value shaped like the new.
      version: 1,
      // Only persist state, not actions.
      partialize: (state) => ({
        items: state.items,
        syncedVersion: state.syncedVersion,
        pendingLineIds: state.pendingLineIds,
      }),
    },
  ),
);
```

**Selector pattern.** Always select the narrow slice your component needs:

```tsx
// Re-renders when ANY cart state changes. Avoid.
const store = useCartStore();

// Re-renders only when the items array reference changes. Prefer.
const items = useCartStore((s) => s.items);

// Re-renders only when the badge count (a number) changes. Best for headers.
const badgeCount = useCartStore((s) => s.items.reduce((n, l) => n + l.quantity, 0));
```

For selectors that return an object or array, use `useShallow` from `zustand/react/shallow` to compare element-wise:

```tsx
import { useShallow } from "zustand/react/shallow";

const { items, incrementLine } = useCartStore(
  useShallow((s) => ({ items: s.items, incrementLine: s.incrementLine })),
);
```

Without `useShallow`, every `set` call creates a new object literal and every consumer re-renders, even if the returned values are identical.

---

## Section 2: Server state

### The mental model

Every value in your app comes from one of two sides of a boundary:

- **Client state** — You own it; you write it; you read it. Zustand owns this (Section 1).
- **Server state** — The server owns it; you cache it. TanStack Query owns this.

Confusing the two is the single largest source of "why is this cached wrong" bugs. The user profile is server state: the server is the source of truth, and local edits must go through a mutation that returns the new server shape. The cart is client state *with a server sync* — the client is the source of truth during offline periods, and the server reconciles on reconnect. Section 4 walks through how Acme Shop handles that hybrid.

### Installing TanStack Query

```bash
npx expo install @tanstack/react-query @tanstack/react-query-devtools @react-native-community/netinfo
```

`@react-native-community/netinfo` is not a TanStack dependency, but every TanStack Query app that handles offline behavior needs it. Acme Shop uses it in Section 4 (offline queue replay) and in the `onlineManager` setup below.

### Root provider + defaults

```tsx
// app/_layout.tsx  (condensed — auth + splash logic lives in 01-navigation.md §4)
import { useEffect, useMemo } from "react";
import { Stack } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { AppState, AppStateStatus } from "react-native";

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;

export default function RootLayout(): JSX.Element {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A query is "fresh" for 5 minutes. Inside the fresh window, mounting
            // a component that uses the query returns instantly from cache — no
            // refetch fires. Tune per query (e.g., a stock-level query has
            // staleTime: 0; the product catalog has staleTime: 30 * MINUTE).
            staleTime: 5 * MINUTE,
            // After a query has been unobserved for 24 hours, its entry is
            // garbage-collected. In v5 this is `gcTime`; in v4 it was `cacheTime`
            // (renamed — v4's `cacheTime` no longer works in v5).
            gcTime: 24 * HOUR,
            // Retry 3 times with exponential backoff (default ~1s, 2s, 4s).
            // Don't retry 4xx responses — those are client errors. `retry` can be
            // a function that inspects the error; see the API-client reference.
            retry: 3,
            retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
            // `offlineFirst`: on a paused query (no network), still serve cached
            // data; retry the network attempt when the connection returns. This
            // is the right default for a mobile app with an intermittent network.
            networkMode: "offlineFirst",
            // Refetch on mount only if data is stale. Default is `true`; setting
            // to `false` is common in RN because remounts happen on every screen
            // transition and blowing the cache on every push/pop is wasteful.
            refetchOnMount: true,
            // Do not refetch on window focus. React Native has no window-focus
            // event; we wire `focusManager` below to the AppState API instead.
            refetchOnWindowFocus: false,
          },
          mutations: {
            networkMode: "offlineFirst",
            retry: 0, // Mutations must not silently retry — see the queue in Section 4.
          },
        },
      }),
    [],
  );

  // Wire the React Native AppState to TanStack Query's focusManager. Without
  // this, a user who backgrounds the app and comes back hours later does not
  // see fresh data — the queries stay in the foreground-stale state they had.
  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus): void => {
      focusManager.setFocused(state === "active");
    };
    const sub = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, []);

  // Wire NetInfo to TanStack Query's onlineManager. Queries and mutations paused
  // by `networkMode: "offlineFirst"` resume here when the connection returns.
  useEffect(() => {
    return onlineManager.setEventListener((setOnline) => {
      return NetInfo.addEventListener((state) => {
        setOnline(state.isConnected === true && state.isInternetReachable !== false);
      });
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
```

Three things to note:

1. **`gcTime`, not `cacheTime`.** The rename landed in v5. `cacheTime` in a `QueryClient` constructor is silently ignored in v5; `gcTime` is the live name. (See Section 7's gotcha for catching this during a v4-to-v5 migration.)
2. **`networkMode: "offlineFirst"`.** The v5 default is `"online"` — a query that runs while offline immediately resolves as "paused" and does not attempt the request. `"offlineFirst"` tells the query to still run, serve cached data, and retry the network call when online. This matches mobile-app expectations (user taps "Orders", sees cached orders immediately, fresh data arrives when the network returns).
3. **`focusManager` + `onlineManager`.** TanStack Query ships with web defaults (`window.focus`, `navigator.onLine`) that don't exist in React Native. Wiring these to `AppState` and `NetInfo` is mandatory; without it, `refetchOnFocus: true` and `online` detection are no-ops.

### Query keys and the three-file pattern

Every feature in Acme Shop follows the same three-file pattern for a server-state query:

```
src/features/orders/
├── api/
│   └── orders.api.ts         # Pure functions: fetchOrders(), fetchOrder(id)
├── hooks/
│   ├── use-orders.ts         # useQuery wrapper around fetchOrders
│   └── use-order.ts          # useQuery wrapper around fetchOrder
└── keys.ts                   # Exported query key factory
```

`keys.ts` is the single source of truth for query keys:

```ts
// src/features/orders/keys.ts
export const ordersKeys = {
  all: () => ["orders"] as const,
  lists: () => [...ordersKeys.all(), "list"] as const,
  list: (filters: { status?: string; from?: string }) =>
    [...ordersKeys.lists(), filters] as const,
  details: () => [...ordersKeys.all(), "detail"] as const,
  detail: (orderId: string) => [...ordersKeys.details(), orderId] as const,
} as const;
```

This gives you a clean invalidation surface:

- `queryClient.invalidateQueries({ queryKey: ordersKeys.all() })` → every orders query.
- `queryClient.invalidateQueries({ queryKey: ordersKeys.lists() })` → every list variant.
- `queryClient.invalidateQueries({ queryKey: ordersKeys.detail(orderId) })` → one order.

Without this pattern, you end up sprinkling `["orders", "list", { status: "open" }]` across the codebase and a rename becomes a cross-file grep. The factory is two dozen lines and prevents a whole class of stale-data bugs.

### The `useOrders` hook

```ts
// src/features/orders/hooks/use-orders.ts
import { useQuery } from "@tanstack/react-query";
import { fetchOrders, OrderListItem } from "../api/orders.api";
import { ordersKeys } from "../keys";

export function useOrders(filters: { status?: string; from?: string } = {}) {
  return useQuery({
    queryKey: ordersKeys.list(filters),
    queryFn: ({ signal }) => fetchOrders(filters, signal),
    // Data is immutable once completed, so we can aggressively cache.
    staleTime: 10 * 60_000,
    // `placeholderData` replaces v4's `keepPreviousData: true`. When the filter
    // changes, show the previous filter's data while the new filter loads —
    // prevents a spinner flash on every filter tap.
    placeholderData: (previous) => previous,
    select: (orders): OrderListItem[] => orders.filter((o) => o.total.amount > 0),
  });
}
```

**The v5 rename to know.** `keepPreviousData: true` from v4 is gone. Use `placeholderData: (previous) => previous` in v5. A migration search-and-replace should catch every site.

---

## Section 3: Storage tradeoffs

Three storages, three purposes. Pick by data type, not by habit.

| Storage | Best for | Why | Avoid for |
|---|---|---|---|
| **`expo-secure-store`** | Access / refresh tokens; biometric-guarded secrets; any value that would let an attacker impersonate the user on another device | iOS Keychain (hardware-backed on devices with Secure Enclave); Android Keystore (hardware-backed where available). `requireAuthentication: true` gates reads behind biometrics. Not encrypted "at the app level" — backed by the OS credential store. | Large blobs (>2 KB — `setItemAsync` rejects); hot-path reads (always async; blocks JS thread if biometrics are required). |
| **`react-native-mmkv`** | Persisted app state (cart, theme, recently viewed); cached server responses for the splash-to-first-screen hop; TanStack Query persistence | Sync reads (`getString` returns in ~0.1 ms — safe to call during render); AES-128 (default) or AES-256 with `encryptionKey`; ~30× faster than AsyncStorage; multi-instance isolation. | Secrets that must be hardware-backed (keys rotate with app reinstalls); values over a few MB (use the filesystem). |
| **`AsyncStorage`** | Nothing new. Legacy code that already depends on it. | — | Any new feature. MMKV is strictly faster, encrypted by default, and works under the same API surface with a thin adapter. |

The rule of thumb:

```
Is it a secret?   → expo-secure-store
Is it hot state?  → react-native-mmkv
Anything else?    → Still react-native-mmkv. Do not reach for AsyncStorage in 2026.
```

### Token storage with `expo-secure-store`

The full auth flow — Cognito sign-in, Google federation, refresh-on-401 — lives in `./03-auth-and-networking.md`. The piece this file owns is the thin wrapper around `SecureStore`:

```ts
// src/features/auth/services/token-cache.ts
import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "acme.auth.accessToken";
const REFRESH_TOKEN_KEY = "acme.auth.refreshToken";

export type Tokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch ms when the access token expires. */
  readonly expiresAt: number;
};

export class TokenCache {
  /**
   * Store both tokens. `expiresAt` is stored with the access token so the
   * API client can decide locally whether to refresh without calling the
   * server first. Not secret itself.
   */
  async save(tokens: Tokens): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(
        ACCESS_TOKEN_KEY,
        JSON.stringify({ token: tokens.accessToken, expiresAt: tokens.expiresAt }),
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      ),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        // Biometric gate only for the refresh token — access tokens are
        // short-lived (~1h) and re-prompting biometrics every API call is
        // user-hostile. The refresh token can mint new access tokens
        // indefinitely, so guarding it behind biometrics limits what a
        // stolen unlocked device can do.
        requireAuthentication: true,
        authenticationPrompt: "Unlock to continue your Acme Shop session",
      }),
    ]);
  }

  async loadAccess(): Promise<{ token: string; expiresAt: number } | null> {
    const raw = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as { token: string; expiresAt: number };
    } catch {
      // Corrupt entry — treat as not-signed-in. The user is sent back to sign-in.
      await this.clear();
      return null;
    }
  }

  /**
   * Fetching the refresh token triggers a biometric prompt on iOS and Android.
   * Only call this when you actually need it — during the refresh-on-401 flow.
   */
  async loadRefresh(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY, {
        requireAuthentication: true,
        authenticationPrompt: "Unlock to continue your Acme Shop session",
      });
    } catch {
      // User cancelled biometrics, or biometrics not enrolled. The auth
      // provider should treat this as a silent sign-out and redirect to the
      // sign-in screen.
      return null;
    }
  }

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  }
}
```

**`keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`** keeps the value off iCloud Keychain backups. Useful in two scenarios:

- You don't want a user's refresh token to sync to a second device via iCloud (the attack surface is the second device's keychain-dump tooling).
- Your compliance team requires per-device credential binding.

The default (`AFTER_FIRST_UNLOCK`) backs up to iCloud Keychain; if a user restores to a new device, their refresh token comes with them. Whether that is desirable depends on your UX — some apps explicitly want the "sign in once, never again across my devices" flow.

**The biometric-prompt-on-cold-start trap.** If your `app/_layout.tsx` calls `tokenCache.loadRefresh()` synchronously during mount, every cold start blocks on Face ID before the splash screen hides. The fix is to only call `loadRefresh()` inside the 401-handler in the API client, never during mount. The `loadAccess()` path does not prompt for biometrics — it returns the access token and its expiry, and the API client decides whether to proceed or escalate to a refresh. See `./03-auth-and-networking.md` §refresh-flow for the full pipeline.

### MMKV for everything else

Create MMKV instances at module scope, named by concern:

```ts
// src/platform/storage/mmkv.ts
import { createMMKV } from "react-native-mmkv";

/**
 * Hot cache — anything we want on first render without a loading spinner.
 * Encrypted with a device-bound key derived at first launch; see
 * `./03-auth-and-networking.md` §device-bound-key.
 */
export const hotCache = createMMKV({
  id: "acme-hot-cache",
  encryptionKey: process.env.EXPO_PUBLIC_MMKV_HOT_KEY ?? "dev-only-hot-key",
});

/**
 * Offline mutation queue — Section 4. Kept in its own instance so a
 * corrupted queue does not poison the rest of the app.
 */
export const offlineQueueStorage = createMMKV({
  id: "acme-offline-queue",
  encryptionKey: process.env.EXPO_PUBLIC_MMKV_QUEUE_KEY ?? "dev-only-queue-key",
});

/**
 * TanStack Query persistence — last-known-good cache for
 * `PersistQueryClientProvider`. Big, so keep it isolated.
 */
export const queryCacheStorage = createMMKV({
  id: "acme-query-cache",
  encryptionKey: process.env.EXPO_PUBLIC_MMKV_QUERY_KEY ?? "dev-only-query-key",
});
```

`createMMKV` is the current MMKV API. The legacy `new MMKV()` constructor still exists for backwards compatibility but is being phased out — use the function form in new code. See Section 7's gotcha for the migration note if you are upgrading an older project.

**Key naming.** Namespace your keys. `hotCache.set("cart.v1.items", ...)` beats `hotCache.set("items", ...)` because you will eventually add more state, and flat keys turn into conflicts.

---

## Section 4: Offline sync

Acme Shop has to work on a subway. The cart is the canonical example: a user adds three items on the platform, loses signal, adds two more on the train, and reconnects at their stop. The expected behavior is "all five items are on the server when the cart screen loads five minutes later, and the server's view matches the client."

The architecture is:

1. **Client writes go through a mutation enqueue function**, not directly to the network. If online, the mutation runs immediately. If offline, the mutation is serialized to MMKV and the user sees the optimistic state.
2. **On reconnect** (detected via `NetInfo`), the queue is drained in FIFO order. Each entry carries the expected server `version` it was built against.
3. **On conflict** (the server rejects with `409 Conflict` because another device bumped the version), the client fetches the server state and either auto-resolves (if the semantics allow — e.g., two increments on different items can merge) or prompts the user (if they conflict — e.g., two increments on the same line with a limited-quantity item).

### The queue shape

```ts
// src/platform/offline/queue.ts
import { offlineQueueStorage } from "@/platform/storage/mmkv";

export type OfflineMutation =
  | { kind: "cart.increment"; lineId: string; delta: number; expectedVersion: number }
  | { kind: "cart.remove"; lineId: string; expectedVersion: number }
  | { kind: "profile.update"; field: string; value: string; expectedVersion: number };

type QueueEntry = {
  readonly id: string;
  readonly enqueuedAt: number;
  readonly mutation: OfflineMutation;
  /** Incremented on every retry; used for backoff. */
  readonly attempts: number;
};

const QUEUE_KEY = "queue.v1";

export class OfflineQueue {
  private readOrEmpty(): QueueEntry[] {
    const raw = offlineQueueStorage.getString(QUEUE_KEY);
    if (raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as QueueEntry[]) : [];
    } catch {
      // Corrupt queue — drop and carry on. Log it to Sentry
      // (see `./08-observability.md`). Losing an offline queue is less bad
      // than crashing on next launch.
      offlineQueueStorage.remove(QUEUE_KEY);
      return [];
    }
  }

  private write(entries: QueueEntry[]): void {
    offlineQueueStorage.set(QUEUE_KEY, JSON.stringify(entries));
  }

  enqueue(mutation: OfflineMutation): QueueEntry {
    const entry: QueueEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      enqueuedAt: Date.now(),
      mutation,
      attempts: 0,
    };
    const queue = this.readOrEmpty();
    queue.push(entry);
    this.write(queue);
    return entry;
  }

  peek(): readonly QueueEntry[] {
    return this.readOrEmpty();
  }

  ack(id: string): void {
    this.write(this.readOrEmpty().filter((e) => e.id !== id));
  }

  /**
   * Increment attempts; used to drop a mutation after N failed retries so a
   * permanently-broken mutation does not block the queue forever.
   */
  bumpAttempts(id: string): number {
    const queue = this.readOrEmpty();
    const idx = queue.findIndex((e) => e.id === id);
    if (idx === -1) return 0;
    const updated: QueueEntry = { ...queue[idx], attempts: queue[idx].attempts + 1 };
    queue[idx] = updated;
    this.write(queue);
    return updated.attempts;
  }

  clear(): void {
    offlineQueueStorage.remove(QUEUE_KEY);
  }
}

export const offlineQueue = new OfflineQueue();
```

Three properties of this design:

- **FIFO.** Order matters: `increment +1` then `increment +2` produces `+3`; `+2` then `+1` produces the same *sum*, but between them, the server briefly shows `+2` which can race with another device. Preserving order keeps the server state deterministic.
- **Expected version on every entry.** The replay step sends `If-Match` (or an equivalent) to the server; the server rejects if its current version differs. This is the contract defined in `../../dynamodb-design/references/03-write-correctness.md` §optimistic-locking. Without it, two devices can interleave writes and each "succeed" from its own perspective while silently overwriting each other.
- **Attempt counter.** After ~5 attempts, a mutation is considered permanently failed and is dropped with a Sentry event. Common causes: the server changed the contract (e.g., the `expectedVersion` field was renamed), the mutation references a resource the user no longer has permission to write, the device's clock is far enough ahead that the server rejects the request as future-dated.

### The replayer

```ts
// src/platform/offline/replayer.ts
import NetInfo from "@react-native-community/netinfo";
import { QueryClient } from "@tanstack/react-query";
import { offlineQueue, OfflineMutation } from "./queue";
import { useCartStore } from "@/features/cart/state/cart-store";
import { apiClient } from "@/platform/http/api-client";
import { ordersKeys } from "@/features/orders/keys";

const MAX_ATTEMPTS = 5;

type ReplayResult = "ok" | "conflict" | "retry";

async function executeOne(m: OfflineMutation): Promise<ReplayResult> {
  try {
    switch (m.kind) {
      case "cart.increment": {
        const response = await apiClient.post(`/cart/lines/${m.lineId}/increment`, {
          delta: m.delta,
          expectedVersion: m.expectedVersion,
        });
        useCartStore.getState().markLineSynced(m.lineId, response.version);
        return "ok";
      }
      case "cart.remove": {
        await apiClient.delete(`/cart/lines/${m.lineId}`, {
          expectedVersion: m.expectedVersion,
        });
        return "ok";
      }
      case "profile.update": {
        await apiClient.patch("/profile", {
          [m.field]: m.value,
          expectedVersion: m.expectedVersion,
        });
        return "ok";
      }
    }
  } catch (err) {
    if (isApiConflict(err)) return "conflict";
    if (isNetworkError(err)) return "retry";
    throw err;
  }
}

function isApiConflict(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 409
  );
}

function isNetworkError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "isNetworkError" in err;
}

export class OfflineReplayer {
  private running = false;

  constructor(private readonly queryClient: QueryClient) {}

  start(): () => void {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected === true && state.isInternetReachable !== false) {
        void this.drain();
      }
    });
    return unsubscribe;
  }

  /** Exposed for tests; normally called by the NetInfo listener. */
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const entry of offlineQueue.peek()) {
        const result = await executeOne(entry.mutation);
        if (result === "ok") {
          offlineQueue.ack(entry.id);
          continue;
        }
        if (result === "retry") {
          const attempts = offlineQueue.bumpAttempts(entry.id);
          if (attempts >= MAX_ATTEMPTS) {
            offlineQueue.ack(entry.id);
            // Log to Sentry — see `./08-observability.md`.
          }
          return; // bail; NetInfo will kick us again
        }
        if (result === "conflict") {
          // Stale expectedVersion. Drop the local optimistic copy, refetch
          // the server state, and let the user re-try. For more nuanced
          // conflict resolution (three-way merges), see
          // `../../dynamodb-design/references/03-write-correctness.md`.
          offlineQueue.ack(entry.id);
          await this.queryClient.invalidateQueries({ queryKey: ordersKeys.all() });
          // Cart-specific: refetch the cart and let setQueryData replace local state.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
```

The replayer is deliberately a plain class, not a hook. It runs at module scope, outside of the React tree. Mount it once in `app/_layout.tsx`:

```tsx
// app/_layout.tsx (excerpt)
import { OfflineReplayer } from "@/platform/offline/replayer";

export default function RootLayout(): JSX.Element {
  const queryClient = useMemo(/* ... from §2 ... */);

  useEffect(() => {
    const replayer = new OfflineReplayer(queryClient);
    return replayer.start();
  }, [queryClient]);

  // ... rest of the layout.
  return <QueryClientProvider client={queryClient}>{/* … */}</QueryClientProvider>;
}
```

### When not to build this

A mutation queue is justified when:

- **Writes are frequent and the user expects them not to disappear** (cart, draft, form, offline notes).
- **The server enforces optimistic-lock conflicts** so you can detect and reconcile stale writes.

Skip the queue when:

- **Writes are rare and always user-initiated with a visible submit** (checkout, settings save). A "retry" button on a failed submit is simpler and gives the user agency.
- **The network is reliably online** (tablet apps on in-store WiFi, kiosk mode). The queue adds complexity; if it never runs, that complexity is pure cost.

---

## Section 5: Optimistic updates

Acme Shop's cart increment is the backbone example. The user taps `+` on a cart line; the badge count bumps immediately; the API call fires in the background; on success, nothing visible changes; on failure, the badge rolls back and a toast explains why.

The v5 contract for `useMutation` is:

```
onMutate(variables, context)
  → return a snapshot object (used as `onMutateResult` in onError / onSettled)

onError(error, variables, onMutateResult, context)
  → use onMutateResult to roll back

onSettled(data, error, variables, onMutateResult, context)
  → invalidate queries so final source of truth wins
```

Note: in v5, `onError` and `onSettled` receive the snapshot as the **third positional argument** (called `onMutateResult`), with `context` last. This is the one v4→v5 signature change that is easy to miss — v4 signatures passed `context` third.

### The hook

```ts
// src/features/cart/hooks/use-cart-increment.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/platform/http/api-client";
import { useCartStore, CartLine } from "@/features/cart/state/cart-store";
import { cartKeys } from "@/features/cart/keys";
import { offlineQueue } from "@/platform/offline/queue";
import NetInfo from "@react-native-community/netinfo";

type Variables = { productId: string; delta: number };

type Snapshot = {
  previousCart: readonly CartLine[];
  previousVersion: number;
};

async function incrementOnServer(
  vars: Variables & { expectedVersion: number },
): Promise<{ version: number }> {
  return await apiClient.post(`/cart/lines/${vars.productId}/increment`, {
    delta: vars.delta,
    expectedVersion: vars.expectedVersion,
  });
}

export function useCartIncrement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: Variables) => {
      const { syncedVersion } = useCartStore.getState();

      const state = await NetInfo.fetch();
      if (state.isConnected !== true) {
        // Queue it; the replayer (Section 4) handles it when we're back online.
        offlineQueue.enqueue({
          kind: "cart.increment",
          lineId: vars.productId,
          delta: vars.delta,
          expectedVersion: syncedVersion,
        });
        // Return a marker so onSuccess knows not to ack the server version.
        return { version: syncedVersion, queued: true as const };
      }

      const result = await incrementOnServer({ ...vars, expectedVersion: syncedVersion });
      return { ...result, queued: false as const };
    },

    onMutate: async (vars, { client }) => {
      // 1. Cancel any outgoing refetch — otherwise a response in flight may
      //    overwrite our optimistic state with pre-mutation data.
      await client.cancelQueries({ queryKey: cartKeys.current() });

      // 2. Snapshot the current state. If the mutation fails we roll back to this.
      const { items, syncedVersion } = useCartStore.getState();
      const snapshot: Snapshot = { previousCart: items, previousVersion: syncedVersion };

      // 3. Apply the optimistic patch: update Zustand (the client source of truth
      //    for the cart) and mirror into the TanStack cache (so any component
      //    reading via useQuery sees the new value too).
      useCartStore.getState().incrementLine(vars.productId, vars.delta);
      useCartStore.getState().markLinePending(vars.productId);

      client.setQueryData<CartLine[]>(cartKeys.current(), (old) =>
        (old ?? []).map((l) =>
          l.productId === vars.productId ? { ...l, quantity: l.quantity + vars.delta } : l,
        ),
      );

      // 4. Return the snapshot — TanStack threads it into onError / onSettled.
      return snapshot;
    },

    onError: (_err, _vars, onMutateResult, { client }) => {
      if (onMutateResult === undefined) return; // onMutate never ran; nothing to roll back
      // Roll back Zustand — re-apply the pre-mutation items array.
      useCartStore.setState({
        items: onMutateResult.previousCart,
        syncedVersion: onMutateResult.previousVersion,
      });
      // Roll back the TanStack cache mirror.
      client.setQueryData(cartKeys.current(), onMutateResult.previousCart);
    },

    onSuccess: (result, vars) => {
      if (!result.queued) {
        // Server confirmed — promote the pending line to synced with the new version.
        useCartStore.getState().markLineSynced(vars.productId, result.version);
      }
    },

    onSettled: (_data, _err, _vars, _onMutateResult, { client }) => {
      // Always re-sync with the server so the cache matches server truth after
      // either success or failure. This is cheap because staleTime covers the
      // normal case; invalidation only triggers a refetch if the data is stale
      // or a component is observing the query.
      void client.invalidateQueries({ queryKey: cartKeys.current() });
    },
  });
}
```

Four things this hook does deliberately:

1. **Cancels in-flight queries first.** Without `cancelQueries`, a query that was already mid-flight when you mutated can resolve *after* your `setQueryData` and overwrite your optimistic state with the stale pre-mutation data. This happens mostly in UIs where the user does a refresh-gesture and then immediately taps `+`.
2. **Snapshots before applying.** The snapshot is the *only* rollback mechanism. If `onMutate` throws between the snapshot and the apply, the `onError` callback still has the snapshot via TanStack's internal threading. Do not compute the snapshot from "current state at rollback time" — that captures the optimistic state you are trying to roll back from.
3. **Mirrors into both stores.** Zustand is the cart source of truth; the TanStack cache is a mirror used by components that prefer the `useQuery` idiom. Keeping both in sync means no "select by cache" vs "select by store" inconsistency bugs.
4. **Offline fall-through.** If offline, the mutation is queued and the optimistic state sticks. The replayer (Section 4) promotes pending → synced once the network is back. The UI reads `pendingLineIds` to render pending indicators.

### Pending-state UI

The optimistic patch is visible to the user immediately. Until the server confirms (or the mutation rolls back), we render a subtle pending indicator — a faint spinner on the `+` button, or a slightly dimmed price. Not a blocking overlay: the user can keep interacting.

```tsx
// src/features/cart/components/cart-line-row.tsx
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useCartStore } from "@/features/cart/state/cart-store";
import { useCartIncrement } from "@/features/cart/hooks/use-cart-increment";

export function CartLineRow({ productId }: { productId: string }): JSX.Element {
  // `useShallow` so we don't rerender on unrelated state changes.
  const { line, isPending } = useCartStore((s) => ({
    line: s.items.find((l) => l.productId === productId) ?? null,
    isPending: s.pendingLineIds.includes(productId),
  }));
  const increment = useCartIncrement();

  if (line === null) return <View />;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", opacity: isPending ? 0.7 : 1 }}>
      <Text style={{ flex: 1 }}>{line.name}</Text>
      <Pressable
        onPress={() => increment.mutate({ productId, delta: -1 })}
        disabled={increment.isPending}
      >
        <Text>-</Text>
      </Pressable>
      <Text>{line.quantity}</Text>
      <Pressable
        onPress={() => increment.mutate({ productId, delta: +1 })}
        disabled={increment.isPending}
      >
        <Text>+</Text>
      </Pressable>
      {isPending ? <ActivityIndicator size="small" /> : null}
    </View>
  );
}
```

Two UX invariants:

- **The `+` / `-` buttons are never disabled by the mutation itself.** `increment.isPending` blocks double-submits of the same mutation, but a user tapping `+` twice in quick succession should queue two mutations, not drop the second. If you need to rate-limit, throttle in the component, not by gating the store.
- **`opacity: 0.7` for pending lines.** Subtle enough not to feel broken, visible enough that a power user notices. A spinner overlay would block the row and frustrate real-world use.

---

## Section 6: Background sync

Background sync is the narrow use case where the app is *not* in the foreground and needs to catch up with the server. Examples:

- Prefetch the next day's flight information the night before.
- Sync a user's cart from last session so the catalog screen opens at fresh state.
- Catch up on unread notifications when the device connects to a trusted WiFi.

The Expo primitive is `expo-task-manager` + `expo-background-task` (or the older, still-functional `expo-background-fetch` — the APIs are near-identical; `expo-background-fetch` is being deprecated in favor of `expo-background-task` as of SDK 54). Both platforms *allow* periodic execution, but neither *guarantees* it:

- **iOS.** The system schedules background-task windows based on the user's usage pattern. If a user rarely opens the app, the task runs rarely. The minimum interval is 15 minutes (900 seconds) — advisory; the OS will often wait longer. Tasks that overrun the ~30-second budget are killed.
- **Android.** The system runs tasks via WorkManager. Doze mode and App Standby Buckets push the task further out the less the user interacts. Minimum interval is ~15 minutes as well.

**Rule of thumb:** if freshness is mission-critical, use a push notification to *trigger* the sync. Background fetch is best-effort and should be treated as an optimization, not a reliability mechanism.

### A background-fetch task for cart sync

```ts
// src/platform/background/cart-sync-task.ts
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import { apiClient } from "@/platform/http/api-client";
import { useCartStore } from "@/features/cart/state/cart-store";

export const CART_SYNC_TASK = "acme.cart.sync";

// IMPORTANT: defineTask must be called at module scope, not inside a component.
// The task handler must survive the app being fully backgrounded (no React tree,
// no navigation, no window). Keep the body small and side-effect-free beyond
// the store update. Throwing from here crashes the task silently; wrap in try/catch.
TaskManager.defineTask(CART_SYNC_TASK, async () => {
  try {
    const { syncedVersion } = useCartStore.getState();
    const serverCart = await apiClient.get(`/cart?since=${syncedVersion}`);
    if (serverCart.version > syncedVersion) {
      useCartStore.setState({
        items: serverCart.items,
        syncedVersion: serverCart.version,
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }
    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerCartSync(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
    // Device restricted (low-power mode, user-disabled, enterprise MDM). Silently
    // skip — the queue + foreground sync still handle the happy path.
    return;
  }
  const registered = await TaskManager.isTaskRegisteredAsync(CART_SYNC_TASK);
  if (registered) return;
  await BackgroundFetch.registerTaskAsync(CART_SYNC_TASK, {
    minimumInterval: 15 * 60, // seconds; iOS treats this as advisory
    stopOnTerminate: false,    // Android only — keep running after the user swipes away
    startOnBoot: true,         // Android only — re-register after device reboot
  });
}

export async function unregisterCartSync(): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(CART_SYNC_TASK);
  if (registered) await BackgroundFetch.unregisterTaskAsync(CART_SYNC_TASK);
}
```

Call `registerCartSync()` from the root layout after sign-in, and `unregisterCartSync()` on sign-out:

```tsx
// app/_layout.tsx (excerpt)
import { registerCartSync, unregisterCartSync } from "@/platform/background/cart-sync-task";
import { useAuth } from "@/features/auth/use-auth";

const { session } = useAuth();
useEffect(() => {
  if (session !== null) void registerCartSync();
  else void unregisterCartSync();
}, [session]);
```

### When push-driven sync is better

If your backend emits a "cart changed on another device" event (SNS topic, WebSocket channel, Amazon Pinpoint campaign), skip background fetch and do this instead:

1. Server publishes a silent push (`content-available: 1` on iOS, data-only payload on Android).
2. The push handler calls the same sync function.
3. The user opens the app and sees fresh state immediately, with no waiting for a background window.

This guarantees freshness within seconds of the server change, whereas background fetch can lag by hours. The cost is a silent-push infrastructure (`./04-native-and-release.md` covers the Expo Push setup and the payload shape). For Acme Shop, we do both — push is the primary freshness mechanism, background fetch is a safety net for devices where push delivery was throttled or silenced.

---

## Section 7: Gotchas (state/data slice)

Full catalogue in `./10-gotchas.md`. The five below are state/data-specific and together account for most production incidents in this category.

| Symptom | Root cause | Fix |
|---|---|---|
| `TypeError: cacheTime is not a valid option` in logs after bumping TanStack Query from v4 → v5. Queries behave as if no garbage-collection is set (memory grows unbounded over a long session). | v5 renamed `cacheTime` to `gcTime`. The constructor silently ignores unknown options; the old name is no longer supported. v4 default was `5 * 60_000` (5 min); v5 default is `5 * 60_000` too, so naively the app seems to work — memory grows only if you had tuned `cacheTime` up. | Rename every `cacheTime` to `gcTime`. `grep -r 'cacheTime' src/` is a one-shot migration. Also rename `keepPreviousData: true` to `placeholderData: (prev) => prev` in the same pass. |
| Zustand store with `persist` + MMKV appears slow on large state: a cart with 200 lines takes ~30 ms to save on every `set()`. User reports jank when tapping `+`. | Zustand calls `storage.setItem(name, JSON.stringify(wholeState))` on every `set()`. JSON serialization is O(state size). MMKV writes are fast; the bottleneck is `JSON.stringify` over a large tree on the JS thread. | Two options. (1) Use `partialize` to persist only a minimal shape — drop derived fields, caches, or snapshots that can be recomputed. (2) For state that legitimately is large and hot, move it out of Zustand's `persist` and write it to MMKV directly via a `subscribeWithSelector` listener, so writes are debounced and you control the payload. |
| On a cold start, `app/_layout.tsx` shows the splash for ~3 seconds, then prompts Face ID before the UI appears. iPad users complain. | `tokenCache.loadRefresh()` was called during layout mount, and `requireAuthentication: true` blocks `getItemAsync` on the biometric prompt. The splash hides only after the promise resolves. | Only call `loadRefresh()` from the 401-handler in the API client, never during layout. `loadAccess()` returns `{ token, expiresAt }` without biometrics; the API client decides whether to proceed on the access token or escalate. The refresh path (and the prompt) only fires on expiry. |
| A previously-working component that uses `useMMKVKeys(storage)` to render a dynamic list now renders twice on every set. iOS profiler shows double-renders under load. | `useMMKVKeys` is implemented with a listener that fires *before* React has committed the preceding render. A single `storage.set()` causes a re-render; then React flushes the pending listener, causing another. | Replace `useMMKVKeys` with a derived value from your Zustand store (or TanStack Query cache) — the listener-based hooks are convenient for prototypes but add non-trivial re-render cost at scale. See `./06-performance-and-testing.md` for profiler-driven diagnosis. |
| Mutation queue replayer drains correctly on reconnect, but one mutation keeps retrying and blocking the rest. Sentry shows the same `409 Conflict` every time. | Expected version stale. The mutation was enqueued against `version: 5`; between enqueue and replay, another device pushed the server to `version: 7`. The replayer retries verbatim; the server keeps rejecting. The loop prevents drainage of later mutations. | Section 4 handles this: on `409`, the replayer `ack`s (drops) the mutation and invalidates the relevant queries, so the user sees the server state and can retry if they still want to. If you rolled your own replayer that retries on 409, fix it to drop on conflict — the user's old intent is now stale. |

---

## Section 8: Verification

Three checks, each under a minute. Run all three after any change to queries, mutations, or the offline queue; run them before tagging a release.

```bash
# 1. Type-check the whole app. Most query-shape bugs surface here because the
#    queryFn return type flows through to useQuery's data type.
npx tsc --noEmit

# 2. Unit tests for the offline queue and the cart store. These are pure TS;
#    they run in ~1 second on CI and catch 90% of regression.
npx jest src/platform/offline src/features/cart/state
```

For the end-to-end check, use the React Query Devtools:

```bash
# 3. Launch the React Query Devtools plugin. `@tanstack/react-query-devtools`
#    ships a React Native component that mounts inside your app; toggle it via
#    a shake-to-open gesture or a dev-only tap target.
npx expo start --dev-client
```

Inside the devtools panel, verify for every feature:

- **Query keys match the factory.** Every active query has a key produced by a `keys.ts` factory (no hand-written arrays).
- **`gcTime` and `staleTime` are visible and non-default** where you have tuned them. Defaults mean you never thought about it — often fine, but worth a five-second sanity check.
- **Observers count drops to 0** when screens unmount. A stuck observer usually means a leaked `useQuery` call — common after a screen was refactored to conditionally mount.

For the MMKV read-perf sanity check, add this to a dev-only screen:

```ts
// src/dev/mmkv-bench.ts  (DEV ONLY — do not ship)
import { createMMKV } from "react-native-mmkv";

export function benchMMKV(): void {
  const bench = createMMKV({ id: "bench" });
  const start = performance.now();
  for (let i = 0; i < 10_000; i++) {
    bench.set(`k${i}`, `value-${i}`);
  }
  const writeMs = performance.now() - start;

  const readStart = performance.now();
  for (let i = 0; i < 10_000; i++) {
    bench.getString(`k${i}`);
  }
  const readMs = performance.now() - readStart;

  bench.clearAll();
  console.log(`MMKV: 10k writes=${writeMs.toFixed(0)}ms, 10k reads=${readMs.toFixed(0)}ms`);
}
```

Expected on a modern device: writes under 50 ms for 10 000 keys, reads under 20 ms. If you see dramatically higher, something else is consuming the JS thread — run the same bench in a fresh app to isolate.

For the offline queue integration test:

```bash
# Toggle airplane mode on the simulator (Cmd-Shift-A on recent iOS simulators)
# 1. Sign in.
# 2. Add three items to cart.
# 3. Enable airplane mode.
# 4. Increment the first line by 2, remove the second.
# 5. Verify the offline-queue screen in the dev drawer shows 2 pending entries.
# 6. Disable airplane mode.
# 7. Within ~5 seconds, the dev drawer shows 0 pending entries and the
#    server cart (visible in the API logs) matches the local cart.
```

This flow catches ~90% of offline-queue regressions before they reach TestFlight.

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — Project layout (`src/features/*`) the stores and hooks in this file sit inside; `app.config.ts` plugin entries for `expo-secure-store`.
  - `./01-navigation.md` — The `(shop)` auth-gated route group; the `useAuth` hook consumed in §3's token cache example.
  - `./03-auth-and-networking.md` — Full auth flow (Cognito, Google federation via `expo-auth-session`); the API client that mounts `tokenCache` and implements the refresh-on-401 path; the device-bound MMKV encryption-key derivation referenced in §3.
  - `./04-native-and-release.md` — Push-notification setup for the silent-push pattern discussed in §6.
  - `./06-performance-and-testing.md` — Profiler-driven diagnosis for the Zustand re-render and `useMMKVKeys` issues in §7; integration-test patterns for the offline queue.
  - `./08-observability.md` — Sentry wiring; how to capture a dropped offline mutation with enough context to diagnose.
  - `./10-gotchas.md` — Full diagnostic catalogue; symptoms indexed by error message.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — API Gateway + Lambda shape the `apiClient` in this file targets; the conflict-response envelope used by the replayer.
  - `../../dynamodb-design/references/03-write-correctness.md` — Optimistic-locking contract; the `expectedVersion` / `If-Match` semantics the offline queue depends on.
  - `../../dynamodb-design/references/00-methodology.md` §worked-example — The cart, order, and profile access patterns the TanStack queries mirror on the client.
- **External documentation:**
  - [TanStack Query v5 — Optimistic updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates) — Canonical `onMutate` / `onError` / `onSettled` pattern.
  - [TanStack Query v5 — React Native](https://tanstack.com/query/v5/docs/framework/react/react-native) — `focusManager` + `onlineManager` wiring.
  - [TanStack Query v4 → v5 migration guide](https://tanstack.com/query/v5/docs/framework/react/guides/migrating-to-v5) — Every rename, including `cacheTime` → `gcTime` and `keepPreviousData` → `placeholderData`.
  - [Zustand — Persisting store data](https://zustand.docs.pmnd.rs/integrations/persisting-store-data) — `persist` middleware options, `partialize`, `migrate`, `version`.
  - [react-native-mmkv README](https://github.com/mrousavy/react-native-mmkv) — `createMMKV` API, encryption, multi-instance patterns, Jest mocking.
  - [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/) — `requireAuthentication`, `keychainAccessible`, `authenticationPrompt`.
  - [expo-background-task](https://docs.expo.dev/versions/latest/sdk/background-task/) — Current SDK 54 primitive that supersedes `expo-background-fetch`; near-identical API.
