# Navigation

**Builds:** The complete navigation surface for an Expo app — `expo-router` file-based routing, nested layouts, typed routes, protected (auth-gated) routes, universal / app links, and deep-link entry points (including paywall deep links). Every code example extends the Acme Shop worked example introduced in `00-architecture.md`.
**When to use:** Adding or restructuring a screen, wiring a new deep link, debugging a navigation-related bug, or integrating an external entry point (push notification, email) that must open a specific screen.
**Prerequisites:** `00-architecture.md` (the project layout, `app.config.ts` structure, and the `acmeshop://` scheme this file builds on). If you haven't read it, start there — this file assumes the `app/` + `src/features/` split documented in §2 of the architecture reference.

> Examples verified against Expo SDK 54 + expo-router 5.x on 2026-04-23. Re-verify via context7 before porting to a newer SDK.

## Contents

1. **`expo-router` file-based routing** — `app/` directory conventions, `_layout.tsx`, `index.tsx`, route groups `(auth)` / `(shop)`, dynamic segments `[id]`, catch-all `[...slug]`.
2. **Nested layouts** — Stacks inside tabs inside a root layout; modal presentation; shared headers; back-behavior customization.
3. **Typed routes** — `experiments.typedRoutes: true` in `app.config.ts`, typed `router.push({ pathname, params })`, typed `<Link href={}>`, `useLocalSearchParams<T>()` generic.
4. **Protected routes** — Auth guard pattern with `<Redirect href="/sign-in" />` inside `_layout.tsx`; loading state to avoid a flash; splash-screen integration with `expo-splash-screen`.
5. **Deep links** — Universal links (iOS) / app links (Android) setup, domain association file requirements, `expo-linking` for URL parsing and programmatic generation, cold-start vs warm-start handling via `Linking.useURL()`.
6. **Paywall deep-link entry** — Scenario: open `/paywall?sku=premium_monthly` from a push notification or an email. `router.replace` vs `router.push`, handling auth state before the paywall. IAP mechanics live in `./09-monetization.md`.
7. **Gotchas (navigation slice)** — Typed-routes not regenerating after a new file, deep links working in dev but not TestFlight, tab-bar flash on protected-route redirect.
8. **Verification** — `npx expo-router list`, typed-routes type-check, simulator deep-link smoke tests via `xcrun simctl openurl` and `adb shell am start`.
9. **Further reading** — Pointers into the rest of this skill and the two sibling skills.

---

## Section 1: `expo-router` file-based routing

`expo-router` maps the file system under `app/` to URL routes and native screens. One file per route; one layout per directory. The library wraps `@react-navigation/*` — you never import from `react-navigation` directly in this skill. Every navigation primitive comes from `expo-router`.

### Rules at a glance

| File | Route | Notes |
|------|-------|-------|
| `app/index.tsx` | `/` | Home route. Re-exports a screen from `src/features/catalog/screens/`. |
| `app/cart.tsx` | `/cart` | A flat route. |
| `app/product/[id].tsx` | `/product/:id` | Dynamic segment. `useLocalSearchParams<{ id: string }>()` reads `id`. |
| `app/orders/[orderId].tsx` | `/orders/:orderId` | Same, different param name. |
| `app/help/[...slug].tsx` | `/help/*` | Catch-all. `slug` is `string[]`. |
| `app/(auth)/sign-in.tsx` | `/sign-in` | Route group — parentheses are stripped from the URL. Groups share a layout. |
| `app/(shop)/cart.tsx` | `/cart` | Group segment is absent from the URL. |
| `app/_layout.tsx` | (layout) | Root layout. Wraps every child route. |
| `app/(shop)/_layout.tsx` | (layout) | Group layout. Wraps every route inside `(shop)`. |
| `app/+not-found.tsx` | (fallback) | Rendered when no route matches. |

The `app/` directory contains **only** route files that re-export screens. All rendering logic lives in `src/features/<feature>/screens/`. This keeps the URL surface decoupled from the feature implementation — renaming a screen file does not break any routes, and the typed-routes generator only sees the URL shape. (See `00-architecture.md` §2 for the non-negotiable rules.)

### A minimal route file

```tsx
// app/product/[id].tsx
import { ProductDetailScreen } from "@/features/catalog/screens/product-detail.screen";

export default ProductDetailScreen;
```

One line. The screen component — which uses `useLocalSearchParams`, triggers data fetches, owns its UI — is a feature-folder concern. Moving a screen between routes is an `app/` edit only; renaming a screen file never breaks routing.

### Route groups

Parentheses group routes that share a layout (and, optionally, shared middleware such as an auth guard) without adding a URL segment. Acme Shop uses two:

- `(auth)` — pre-authentication screens (sign-in, forgot-password, magic-link-confirm). Wrapped in a plain `Stack`.
- `(shop)` — post-authentication screens (catalog, cart, checkout, orders, account). Wrapped in a `Stack` with an auth guard.

The URL for `app/(shop)/cart.tsx` is `/cart`, not `/(shop)/cart`. The group is invisible to users and to deep links. It is a layout-scoping tool, not a URL-shaping tool.

You can nest groups. `app/(shop)/(tabs)/_layout.tsx` is a tab layout inside the `(shop)` stack — useful if you want the cart and account icons to live in a tab bar, with product-detail screens pushed above the tab bar as full-screen stack entries. Section 2 walks through this arrangement.

### Dynamic segments and catch-alls

A file named `[param].tsx` becomes a dynamic segment. A file named `[...rest].tsx` becomes a catch-all that receives every remaining path segment as an array.

```tsx
// app/product/[id].tsx          → /product/abc123
// app/orders/[orderId].tsx       → /orders/ord_9f2
// app/help/[...slug].tsx         → /help/getting-started/returns
//                                  → slug = ["getting-started", "returns"]
```

Square-bracket names become params on the route. You read them with `useLocalSearchParams`. Section 3 covers the typed variant.

---

## Section 2: Nested layouts

A layout file (`_layout.tsx`) is a React component that renders its child routes via `<Stack />`, `<Tabs />`, or a custom arrangement. Layouts nest — a root layout wraps a group layout, which wraps a tab layout, which wraps a screen. Each level can add providers (theme, i18n, query client), a header, a tab bar, or an auth guard.

### Root layout — `app/_layout.tsx`

The root layout wraps every route in the app. It is the right place for app-wide providers (QueryClient, Zustand persistence gate, i18n, theme) and for the top-level Stack that routes everything else.

```tsx
// app/_layout.tsx
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { queryClient } from "@/shared/api/query-client";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";
import { DeepLinkListener } from "@/shared/navigation/deep-link-listener";

// Keep the splash screen on until we know the auth state. Called at module
// scope — not inside a component — so it runs before the first render.
SplashScreen.preventAutoHideAsync();

export default function RootLayout(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DeepLinkListener />
        <StatusBar style="auto" />
        <RootStack />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootStack(): JSX.Element {
  const { isLoading } = useAuth();

  // Hide the splash screen only once we've resolved auth. This prevents the
  // brief flash of an unauthed screen that would otherwise appear while the
  // Cognito token restore is in flight.
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {
        // hideAsync rejects if the screen was already hidden — benign.
      });
    }
  }, [isLoading]);

  if (isLoading) {
    // Return null while splash is still up. Don't render a custom spinner —
    // the native splash image is already on screen.
    return null as unknown as JSX.Element;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false, // Group layouts opt into their own headers.
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
      <Stack.Screen name="(shop)" />
      <Stack.Screen
        name="paywall"
        options={{
          presentation: "modal",
          gestureEnabled: false, // Prevent swipe-dismiss on a deep-linked paywall.
        }}
      />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}
```

Notes on this file:

- `SplashScreen.preventAutoHideAsync()` is called at module scope, not inside the component. Calling it inside `useEffect` loses the race against the first paint, and the screen hides before we tell it not to.
- The `(auth)` and `(shop)` screens are declared with `<Stack.Screen>` so we can attach per-group animation options. The actual layouts live in `app/(auth)/_layout.tsx` and `app/(shop)/_layout.tsx`.
- `<DeepLinkListener />` is a headless component that subscribes to `Linking.useURL()` for warm-start events. Section 5 shows its implementation.
- The auth guard is **not** in the root layout. It belongs on the `(shop)` layout, so the `(auth)` routes stay reachable when the user is signed out. Section 4 explains why.

### Group layout with tabs — `app/(shop)/_layout.tsx`

The shop group is where authenticated users spend most of their time. We want a tab bar (Home, Cart, Orders, Account) *and* the ability to push product-detail and checkout screens above the tab bar. That means a two-level structure: a Stack for the detail screens, with Tabs as the default screen of the stack.

```tsx
// app/(shop)/_layout.tsx
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/features/auth/auth-context";

export default function ShopLayout(): JSX.Element {
  const { session } = useAuth();

  // Guard: if the user is not signed in, redirect to sign-in. The root
  // layout has already waited for auth to resolve (see above), so `session`
  // is either a real session or `null` — never "loading".
  if (session === null) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Stack screenOptions={{ headerShown: true }}>
      {/* The tab bar lives on the default screen. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/* Detail screens push above the tab bar. */}
      <Stack.Screen
        name="product/[id]"
        options={{ title: "Product", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="checkout"
        options={{
          title: "Checkout",
          // Disable back gesture so users can't swipe away from an
          // in-flight payment.
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}
```

The tabs themselves live at `app/(shop)/(tabs)/_layout.tsx`:

```tsx
// app/(shop)/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabsLayout(): JSX.Element {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#0a7ea4",
        headerShown: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Shop",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

With this tree:

- `/` → `(shop)/(tabs)/index.tsx` → Catalog screen, tab bar visible.
- `/cart` → `(shop)/(tabs)/cart.tsx` → Cart screen, tab bar visible.
- `/product/abc123` → `(shop)/product/[id].tsx` → Product detail, pushed above tabs, tab bar hidden.
- `/checkout` → `(shop)/checkout.tsx` → Checkout, pushed above tabs, tab bar hidden, back gesture disabled.

### Modals

Modal screens use `presentation: "modal"` in their `Stack.Screen` options. They slide up from the bottom on iOS and appear as a dialog on Android / web. Acme Shop uses two modals:

- `/paywall` — premium-upgrade sheet, reached via deep link or a "Go Premium" button.
- `/(shop)/address-picker` — pre-checkout address selector, reached from the checkout screen.

The paywall is registered in the root layout because it must be reachable from any screen (including the `(auth)` group). The address picker is registered inside `(shop)` because it only makes sense for authenticated users. See Section 6 for the paywall implementation.

### Stack for auth — `app/(auth)/_layout.tsx`

The auth group has no guard and no tab bar. Every screen pushes onto a plain stack. Acme Shop keeps it simple:

```tsx
// app/(auth)/_layout.tsx
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/features/auth/auth-context";

export default function AuthLayout(): JSX.Element {
  const { session } = useAuth();

  // If the user is already signed in, don't let them walk back into the
  // auth flow — send them home instead. Without this, a stale token plus
  // a cold start into /sign-in shows a useless sign-in screen to a logged-in user.
  if (session !== null) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
      <Stack.Screen name="forgot-password" options={{ title: "Reset password" }} />
    </Stack>
  );
}
```

### Back-behavior customization

The default back behavior on each stack is what users expect: a back button or swipe-back gesture pops one screen. Two common overrides:

- **Disable swipe-back on critical screens.** Checkout and paywall screens set `gestureEnabled: false` so a half-remembered swipe doesn't abort a payment.
- **Intercept the back button.** For unsaved-edit screens, use `useNavigation` to attach a `beforeRemove` listener — if the form is dirty, show an "Are you sure?" prompt before allowing the pop.

```tsx
import { useNavigation } from "expo-router";
import { useEffect } from "react";
import { Alert } from "react-native";

export function useWarnBeforeLeave(isDirty: boolean): void {
  const navigation = useNavigation();

  useEffect(() => {
    const subscription = navigation.addListener("beforeRemove", (event) => {
      if (!isDirty) return;
      event.preventDefault();
      Alert.alert(
        "Discard changes?",
        "You have unsaved changes that will be lost.",
        [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
        ],
      );
    });
    return subscription;
  }, [navigation, isDirty]);
}
```

---

## Section 3: Typed routes

Typed routes are an `expo-router` feature that generates TypeScript types from the `app/` tree. With it on, `<Link href={}>`, `router.push()`, and `useLocalSearchParams()` all refuse to compile against routes that do not exist.

### Enable it

```typescript
// app.config.ts (excerpt — full file in 00-architecture.md §3)
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Acme Shop",
  slug: "acme-shop",
  scheme: "acmeshop",
  experiments: {
    typedRoutes: true,
  },
  // ... plugins, ios, android, etc.
});
```

After changing `app.config.ts`, restart Metro with `npx expo start --clear` so the generator re-emits types. Types land in `.expo/types/router.d.ts`, which `tsconfig.json` already includes (`"include": [".expo/types/**/*.ts"]` — see `00-architecture.md` §2).

### What you get

```tsx
import { Link, router } from "expo-router";

// Declarative — the compiler checks both pathname and params.
<Link href={{ pathname: "/product/[id]", params: { id: "abc123" } }}>
  View product
</Link>;

// Imperative — same compile-time guarantee.
router.push({ pathname: "/orders/[orderId]", params: { orderId: "ord_9f2" } });
router.replace("/sign-in");

// Mistakes caught at build time:
router.push("/produk/abc123"); // TS error: typo
router.push({ pathname: "/product/[id]", params: {} }); // TS error: missing id
router.push({ pathname: "/product/[id]", params: { id: "a", color: "r" } }); // TS error: unknown key
```

### Typed `useLocalSearchParams`

Passing a full route literal to `useLocalSearchParams` gives you the same param-key guarantee:

```tsx
// src/features/catalog/screens/product-detail.screen.tsx
import { useLocalSearchParams } from "expo-router";
import { View, Text } from "react-native";
import { useProduct } from "@/features/catalog/hooks/use-product";

export function ProductDetailScreen(): JSX.Element {
  const { id } = useLocalSearchParams<"/product/[id]">();
  const { data: product, isLoading } = useProduct(id);

  if (isLoading) return <Text>Loading…</Text>;
  if (!product) return <Text>Not found</Text>;

  return (
    <View>
      <Text>{product.name}</Text>
      <Text>{product.priceFormatted}</Text>
    </View>
  );
}
```

The generic `"/product/[id]"` is the full route literal — `id` is inferred as `string`. For a catch-all like `app/help/[...slug].tsx`, the literal is `"/help/[...slug]"` and `slug` is `string[]`.

### Query-string params

Query-string params are not part of the route literal. Type them with an explicit generic instead:

```tsx
// From /paywall?sku=premium_monthly&source=push
const { sku, source } = useLocalSearchParams<{ sku?: string; source?: string }>();
```

The `?` is correct: the paywall is reachable *without* a `sku` (e.g., from the settings screen's "Go Premium" button that picks the SKU at runtime). Treat every query param as optional unless you control every entry point yourself.

---

## Section 4: Protected routes

An authenticated area is *every route outside* `(auth)`. The simplest enforcement is a redirect in the `(shop)` layout. Section 2 already showed it; the rest of this section explains the patterns and the trade-offs.

### Pattern A — `<Redirect />` in the layout (preferred)

Use `<Redirect />` as the default guard. It is declarative, runs during render, and avoids a visible flash of the guarded screen before the redirect fires.

```tsx
// app/(shop)/_layout.tsx — excerpt from Section 2
export default function ShopLayout(): JSX.Element {
  const { session } = useAuth();
  if (session === null) {
    return <Redirect href="/(auth)/sign-in" />;
  }
  return <Stack>{/* … */}</Stack>;
}
```

Two pieces that make this work:

1. **The root layout resolves `isLoading` before mounting group layouts.** The root layout keeps the splash screen up until `isLoading === false`. By the time `(shop)/_layout.tsx` renders, `session` is either a real session or `null` — never the loading sentinel. This is why `session === null` is a safe check.
2. **The target of the redirect lives outside the guarded group.** Redirecting to a route inside `(shop)` from inside `(shop)` is an infinite loop. Always redirect to a route in a different group (or to a root-level screen).

### Pattern B — `router.replace` in an effect (fallback)

Use an imperative redirect only when the guard needs a side effect — logging the blocked attempt, showing a toast, clearing a pending mutation — that can't be expressed declaratively.

```tsx
// Use this only when <Redirect /> is not expressive enough.
import { router } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { analytics } from "@/shared/analytics";

export default function ShopLayout(): JSX.Element {
  const { session } = useAuth();

  useEffect(() => {
    if (session === null) {
      analytics.track("auth_required_redirect", { from: "shop_group" });
      router.replace("/(auth)/sign-in");
    }
  }, [session]);

  if (session === null) return null;
  return <Stack>{/* … */}</Stack>;
}
```

Downsides of Pattern B:

- Requires a `return null` branch so the guarded subtree does not render mid-redirect.
- An analytics event fires before the imperative redirect runs, which is exactly why you would use it — but the declarative `<Redirect />` is cleaner when you have no such need.
- The `useEffect` runs after the first render, so guarded data-fetching hooks can briefly observe an unauthenticated state. Declarative redirect avoids this entirely.

**Rule of thumb:** `<Redirect />` is the default. Only reach for imperative `router.replace` when you cannot avoid a side effect.

### Splash-screen integration

The native splash screen is the user's first frame. Keeping it up until the auth state is known makes the transition feel instant — no white flash, no brief "Sign in" screen that then redirects to the home screen.

```tsx
// app/_layout.tsx — excerpt from Section 2
import * as SplashScreen from "expo-splash-screen";

// Module scope — runs before any component renders.
SplashScreen.preventAutoHideAsync();

function RootStack(): JSX.Element {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden — benign. Happens on fast reloads in dev.
      });
    }
  }, [isLoading]);

  if (isLoading) return null as unknown as JSX.Element;

  return <Stack>{/* … */}</Stack>;
}
```

Three rules:

1. **Call `preventAutoHideAsync` at module scope**, not inside a component, or the native splash will already have faded by the time your code runs.
2. **Hide the splash once — and only once — when auth resolves.** A second `hideAsync()` call on an already-hidden screen rejects; wrap the call in `.catch(() => {})` or it surfaces as an unhandled promise rejection in the dev client.
3. **Do not render a custom spinner during the loading phase.** The native splash is already on screen — a spinner would paint over it and cause a visible stutter when it's removed.

### Handling the pending destination

A user tapping a push notification while signed out should land on the notification's target once they sign in — not on the default home screen. Store the pending destination alongside the redirect:

```tsx
// src/features/auth/auth-context.tsx — excerpt
import { useState, useCallback } from "react";
import { router, type Href } from "expo-router";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  pendingHref: Href | null;
  setPendingHref: (href: Href | null) => void;
  signIn: (credentials: Credentials) => Promise<void>;
}

// Inside the provider:
const [pendingHref, setPendingHref] = useState<Href | null>(null);

const signIn = useCallback(async (credentials: Credentials) => {
  await performCognitoSignIn(credentials);
  if (pendingHref) {
    router.replace(pendingHref);
    setPendingHref(null);
  } else {
    router.replace("/");
  }
}, [pendingHref]);
```

The deep-link listener (Section 5) calls `setPendingHref` when it receives a link while unauthenticated. The `(shop)` layout's `<Redirect href="/(auth)/sign-in" />` fires, and after sign-in, `router.replace(pendingHref)` sends the user where they originally wanted to go.

---

## Section 5: Deep links

A deep link is a URL that opens a specific screen in your app. Three mechanisms coexist:

- **Custom scheme** (`acmeshop://orders/ord_9f2`) — works everywhere with no setup beyond declaring the scheme in `app.config.ts`. Appears as a non-clickable string in most mail clients. Use for push-notification payloads and in-app internal navigation.
- **Universal Links** (iOS) — an `https://acme.example/orders/ord_9f2` URL that opens the app when installed, or the website otherwise. Requires `apple-app-site-association` on your domain.
- **App Links** (Android) — the Android equivalent. Requires `assetlinks.json` on your domain.

Acme Shop uses all three. Custom scheme for push notifications (delivered by the push provider), universal / app links for email receipts and shared links.

### Declare the scheme and associated domains

```typescript
// app.config.ts — excerpt
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  scheme: "acmeshop",
  ios: {
    bundleIdentifier: "com.acme.shop",
    associatedDomains: [
      "applinks:acme.example",
      "applinks:m.acme.example", // Subdomain used by the email service.
    ],
  },
  android: {
    package: "com.acme.shop",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true, // Promotes the filter to a verified App Link.
        data: [
          { scheme: "https", host: "acme.example", pathPrefix: "/orders" },
          { scheme: "https", host: "acme.example", pathPrefix: "/product" },
          { scheme: "https", host: "acme.example", pathPrefix: "/paywall" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  // ... plugins, extra, etc.
});
```

### Domain association files

Both platforms require a JSON file hosted on your domain that proves you own the app identifier. Serve them with `Content-Type: application/json` over HTTPS, with no redirect, no authentication, and no cookies. If you run a static site with `aws-cdk-patterns`, drop them in `public/.well-known/`.

**iOS** — `https://acme.example/.well-known/apple-app-site-association`:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID123.com.acme.shop"],
        "components": [
          { "/": "/orders/*", "comment": "Order detail" },
          { "/": "/product/*", "comment": "Product detail" },
          { "/": "/paywall", "comment": "Paywall sheet" }
        ]
      }
    ]
  }
}
```

**Android** — `https://acme.example/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.acme.shop",
      "sha256_cert_fingerprints": [
        "14:6D:E9:83:51:7F:66:01:84:93:4F:2F:5E:E0:8F:3A:D6:F4:CA:41:1A:CF:45:BF:8D:10:76:76:CD"
      ]
    }
  }
]
```

Fetch the SHA256 fingerprint from EAS:

```bash
eas credentials --platform android
# Follow the prompts to the production keystore; the tool prints the SHA256 fingerprint.
```

The fingerprint is keystore-specific. You need one entry per build profile that shipped to users — in Acme Shop's case, both the production keystore and any enterprise distribution keystore.

### Parsing the incoming URL with `expo-linking`

`expo-router` handles routing automatically — a URL matching a registered route opens the right screen. You rarely need to parse manually. When you do (an analytics breadcrumb, a custom-scheme payload that maps to a route indirectly), use `expo-linking`.

```tsx
// src/shared/navigation/deep-link-listener.tsx
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";

import { useAuth } from "@/features/auth/auth-context";
import { analytics } from "@/shared/analytics";

/**
 * Headless component. Handles both cold-start (app launched from a link)
 * and warm-start (app already running when the link arrives) deep-link
 * events. Render it once, near the top of the tree, inside the AuthProvider.
 */
export function DeepLinkListener(): null {
  // useURL() returns the initial URL on cold start, then updates on every
  // subsequent warm-start link event. A single hook covers both paths.
  const url = Linking.useURL();
  const { session, setPendingHref } = useAuth();

  useEffect(() => {
    if (!url) return;

    const { path, queryParams } = Linking.parse(url);
    analytics.track("deep_link_received", { path, queryParams });

    // Map the parsed URL to an expo-router Href. In practice most deep
    // links match registered routes directly and expo-router has already
    // navigated by the time we see this event — we just record it.
    // Links that require auth-aware routing (like the paywall) go through
    // this block.
    if (path === "paywall") {
      const sku = typeof queryParams?.sku === "string" ? queryParams.sku : undefined;
      const target = {
        pathname: "/paywall",
        params: sku ? { sku } : {},
      } as const;

      if (session === null) {
        // User not signed in — stash the target and let the (shop)
        // layout's <Redirect /> send them to sign-in.
        setPendingHref(target);
        return;
      }

      router.push(target);
    }
  }, [url, session, setPendingHref]);

  return null;
}
```

Key points:

- **One hook for cold and warm start.** `Linking.useURL()` collapses the old two-hook pattern (`getInitialURL` + `addEventListener('url')`) into a single reactive value. That means one code path to test, one place for bugs.
- **No early return for `!url`.** Cold-start with no link at all — the common case — returns `null`. Guard with `if (!url) return;` before doing anything.
- **Do not `router.replace` from the listener unless you know what you're doing.** `expo-router` has usually already navigated by the time this effect runs. A `replace` from inside the effect creates a second navigation that may surprise the user (e.g., lose their back stack). Only override the automatic navigation when you have a conditional decision (auth-gated, paywall-like) that `expo-router` cannot make on its own.

### Programmatic URL generation

Need to share a link from the app? Use `Linking.createURL`:

```tsx
import * as Linking from "expo-linking";

// In development with a dev client, this emits `acmeshop://orders/ord_9f2`.
// In Expo Go, it emits `exp://<LAN-IP>:8081/--/orders/ord_9f2`.
// In production, it emits `acmeshop://orders/ord_9f2`.
const url = Linking.createURL("/orders/ord_9f2", { queryParams: { ref: "share" } });
```

For share-sheet content, prefer the universal-link form (`https://acme.example/orders/ord_9f2`) over the custom-scheme form — users with the app installed get deep-linked, users without get a web fallback. Build it from a constant base URL rather than `Linking.createURL` when you specifically want the HTTPS variant.

---

## Section 6: Paywall deep-link entry

Scenario: the user receives a push notification ("Upgrade to Premium for $4.99/mo — 24 hours left") or an email ("Your free trial is ending"). Tapping opens `/paywall?sku=premium_monthly` in Acme Shop, regardless of where the app was before — signed out, on the cart screen, mid-checkout.

This section is **navigation mechanics only**. The IAP flow — receipt validation, entitlement checks, the actual purchase — lives in `./09-monetization.md` §RevenueCat.

### Register the paywall route at the root

The paywall is reachable from any group, so it lives at the root. The listing in `app/_layout.tsx` (Section 2) gave it `presentation: "modal"` and `gestureEnabled: false`:

```tsx
// app/_layout.tsx — relevant excerpt
<Stack.Screen
  name="paywall"
  options={{
    presentation: "modal",
    gestureEnabled: false, // Deep-linked paywalls shouldn't be swipe-dismissed.
  }}
/>
```

### Paywall screen — minimal shape

```tsx
// src/features/monetization/screens/paywall.screen.tsx
import { useLocalSearchParams, router } from "expo-router";
import { View, Text, Pressable } from "react-native";

import { usePaywallOffer } from "@/features/monetization/hooks/use-paywall-offer";
// Purchase logic lives in 09-monetization.md — stubbed here on purpose.
import { useStartPurchase } from "@/features/monetization/hooks/use-start-purchase";

export function PaywallScreen(): JSX.Element {
  const { sku, source } = useLocalSearchParams<{ sku?: string; source?: string }>();
  const { offer, isLoading } = usePaywallOffer(sku);
  const { startPurchase, isStarting } = useStartPurchase();

  if (isLoading || !offer) return <Text>Loading offer…</Text>;

  return (
    <View>
      <Text>Upgrade to {offer.title}</Text>
      <Text>{offer.priceFormatted} / {offer.periodLabel}</Text>
      {source === "push" && <Text>Tap offer from your notification.</Text>}
      <Pressable
        disabled={isStarting}
        onPress={() => startPurchase(offer.identifier)}
      >
        <Text>Start subscription</Text>
      </Pressable>
      <Pressable onPress={() => router.back()}>
        <Text>Not now</Text>
      </Pressable>
    </View>
  );
}
```

### Wiring the deep link

The `DeepLinkListener` in Section 5 already routes `/paywall?sku=<id>` through the auth guard. The two navigation calls you might make from elsewhere in the app:

```tsx
// From a "Go Premium" button inside the signed-in app — stack push.
router.push({ pathname: "/paywall", params: { sku: "premium_monthly", source: "settings" } });

// From the deep-link listener after a push notification opened the app
// while the user was on a deep-nested screen — replace so "back" doesn't
// unwind into an unrelated screen stack.
router.replace({ pathname: "/paywall", params: { sku: "premium_monthly", source: "push" } });
```

**`push` vs `replace` rule** for the paywall:

- **Use `push`** when the user triggered the paywall themselves from inside the app (tapped a "Go Premium" button). Back should return them to where they were.
- **Use `replace`** when the paywall arrives via deep link to a user whose previous state was unrelated (e.g., they were at `/checkout` when a push notification fired and tapped it). A `push` would leave `/checkout` underneath the paywall, and a back-dismiss would land them mid-checkout for a cart they may no longer want.

### Auth interaction

From Section 5's listener:

1. User taps the push notification while signed out.
2. `DeepLinkListener` sees `session === null`, stores the paywall target in `pendingHref`, and bails out — no imperative navigation.
3. `expo-router` had already navigated to `/paywall` as part of the link resolution, but the `(shop)` layout's `<Redirect href="/(auth)/sign-in" />` fires first because the paywall route is *outside* the `(shop)` group — wait, except we registered it at the root, so it's not inside `(shop)`. That's deliberate: the paywall must render for signed-out users too, because some paywall flows offer a "sign in first, then subscribe" path.
4. If your paywall requires authentication (Acme Shop does — we need the Cognito user ID to associate the entitlement), add the same `session === null` check *inside* the paywall screen and redirect to sign-in, storing the pending paywall target in `pendingHref`.

```tsx
// Inside PaywallScreen — guard for auth-required paywalls.
import { useAuth } from "@/features/auth/auth-context";
import { Redirect } from "expo-router";

export function PaywallScreen(): JSX.Element {
  const { sku, source } = useLocalSearchParams<{ sku?: string; source?: string }>();
  const { session, setPendingHref } = useAuth();

  if (session === null) {
    setPendingHref({ pathname: "/paywall", params: { sku: sku ?? "", source: source ?? "" } });
    return <Redirect href="/(auth)/sign-in" />;
  }

  // ... the rest of the screen from above.
  return null as unknown as JSX.Element;
}
```

The IAP purchase call, receipt validation, entitlement refresh, and analytics are in `./09-monetization.md`. This file's job ends once the user is on the paywall screen with the right SKU loaded.

---

## Section 7: Gotchas (navigation slice)

Full catalogue in `./10-gotchas.md`. The three below are navigation-specific and the most common sources of "works on my machine, broken on TestFlight" tickets.

| Symptom | Root cause | Fix |
|---|---|---|
| New route file exists under `app/`, `npx expo-router list` prints it, but `router.push("/new-route")` still shows a TypeScript error (`Type '"/new-route"' is not assignable to…`). Types did not regenerate. | Typed-routes runs during Metro's `expo-router` transformation. Metro caches the generated `.expo/types/router.d.ts` aggressively. A new file added while Metro is running sometimes leaves the types stale. | Restart Metro with `npx expo start --clear`. If the types still do not regenerate, delete `.expo/types/` and restart Metro. If even that fails, verify `experiments.typedRoutes: true` is set in the **current** `app.config.ts` (not an older `app.json`). |
| Deep link works in `expo start` on the simulator, but tapping `https://acme.example/orders/ord_9f2` in TestFlight opens the website instead of the app. | The domain-association file is unreachable, returns the wrong `Content-Type`, or the SHA256 fingerprint in `assetlinks.json` doesn't match the keystore TestFlight used. Apple and Google fetch these files on install (Apple) and on verification (Google); a 302 redirect, a gzipped response, or a text/plain MIME type silently breaks verification. | For iOS: `curl -I https://acme.example/.well-known/apple-app-site-association` — must return `200`, `Content-Type: application/json`, and no `Content-Encoding`. Reinstall the app after fixing so iOS refetches. For Android: `adb shell pm get-app-links com.acme.shop` — the state must be `verified`. If it says `legacy_failure`, re-check `assetlinks.json`, then `adb shell pm verify-app-links --re-verify com.acme.shop`. |
| Tapping a protected route from a signed-out cold start briefly shows the tab bar (empty tabs flash) before the redirect fires. User-reported "glitchy startup". | The splash screen hid before the auth state resolved, revealing the `(shop)` layout for one frame before the `<Redirect />` fired. Usually caused by splitting `preventAutoHideAsync` between a component's `useEffect` (which runs late) and the module scope (which runs on time). | Make sure `SplashScreen.preventAutoHideAsync()` is the very first executable line of `app/_layout.tsx`, not inside a hook. Hide the splash only inside a `useEffect` that depends on `isLoading`, and only once (`hideAsync` rejects on a double call). Pattern: Section 2's root-layout example. |

---

## Section 8: Verification

Three low-cost checks, each under a minute. Run all three before opening a PR that touches routing, and again before tagging a release.

```bash
# 1. List every registered route. Confirms the app/ directory was parsed
#    correctly and every expected route shows up. Also prints the typed
#    route literals — handy for copying into useLocalSearchParams<>.
npx expo-router list

# 2. Type-check the whole app. Typed routes are enforced here — a deleted
#    or renamed route surfaces as a compile error in every caller.
npx tsc --noEmit

# 3. Smoke-test the deep-link routes. The simulator must be running and
#    the dev client installed. Expect the app to foreground and open the
#    correct screen within a second.
xcrun simctl openurl booted "acmeshop://product/demo-123"
xcrun simctl openurl booted "acmeshop://orders/ord_9f2"
xcrun simctl openurl booted "acmeshop://paywall?sku=premium_monthly&source=push"

# Android equivalent (emulator must be running and the dev client installed):
adb shell am start -W -a android.intent.action.VIEW \
  -d "acmeshop://product/demo-123" com.acme.shop.dev
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://acme.example/orders/ord_9f2" com.acme.shop.dev
```

For the universal-link / app-link path, also run:

```bash
# Verify apple-app-site-association is reachable with the right MIME type.
curl -sI https://acme.example/.well-known/apple-app-site-association | head -5

# Verify assetlinks.json is reachable.
curl -sI https://acme.example/.well-known/assetlinks.json | head -5

# After install, confirm Android verified the app links.
adb shell pm get-app-links com.acme.shop
```

If any of those fail, jump straight to Section 7 — the symptoms/cause table there covers every `works-on-my-machine` deep-link case Acme Shop has seen in production.

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — Project layout (`app/` + `src/features/`), `app.config.ts` authoring, the `acmeshop://` scheme declaration, and the Acme Shop worked example.
  - `./02-state-and-data.md` — Auth context implementation (`useAuth`, `session`, `isLoading`), TanStack Query setup, Zustand persistence. The `<AuthProvider>` and `useAuth` hook referenced throughout this file are defined there.
  - `./03-auth-and-networking.md` — Cognito sign-in, Google federation via `expo-auth-session`, and the API client that honors the auth session. The `performCognitoSignIn` stub in Section 4 is the full flow there.
  - `./04-native-and-release.md` — Push-notification setup. The payload shape that produces the deep-link URL consumed by `DeepLinkListener` is documented there.
  - `./09-monetization.md` — Paywall IAP logic: RevenueCat offerings, receipt validation, entitlement refresh, analytics events. The `startPurchase` stub used in Section 6 is the full flow there.
  - `./10-gotchas.md` — Full diagnostic catalogue; symptoms indexed by error message.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/02-auth-stack.md` — Cognito user pool + Google federation on the backend. Acme Shop's auth-context consumes this directly.
  - `../../aws-cdk-patterns/references/03-static-site.md` — CloudFront distribution hosting `apple-app-site-association` and `assetlinks.json`. If your site is served from there, the `/.well-known/` content type and caching must be configured per that reference.
- **External documentation:**
  - [expo-router — Typed routes](https://docs.expo.dev/router/reference/typed-routes/) — `experiments.typedRoutes` flag, literal syntax, generator behavior.
  - [expo-router — Authentication](https://docs.expo.dev/router/advanced/authentication/) — Canonical protected-routes patterns. This file follows the authentication-rewrites pattern (Pattern A above).
  - [expo-linking — Into your app](https://docs.expo.dev/linking/into-your-app/) — Custom scheme, universal links, app links; `Linking.useURL` vs `Linking.getInitialURL`.
  - [iOS — Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains) — Apple's authoritative guide to `apple-app-site-association`.
  - [Android — Verify app links](https://developer.android.com/training/app-links/verify-android-applinks) — Google's authoritative guide to `assetlinks.json` and the `autoVerify` flag.
