# Monetization — in-app purchases and subscriptions

**Builds:** The monetization spine for Acme Shop — `react-native-purchases` 10 (RevenueCat's React Native SDK) as the default IAP layer, RevenueCat's dashboard as the offering/entitlement authority, RevenueCat's server-side receipt validation as the trust boundary, a paywall screen that reads from Offerings + fires the `paywall_viewed` / `subscription_started` events declared in `./08-observability.md` §7.2, a `usePremiumEntitlement()` hook that projects `Purchases.getCustomerInfo()` onto a boolean the UI can gate on, `Purchases.restorePurchases()` wired into a settings-screen button (required by App Store Review Guideline 3.1.1), `openSubscriptionSettings()` for the "Manage subscription" deep link into App Store / Play Store, and a RevenueCat webhook then API Gateway then Lambda then DynamoDB path that provisions server-side entitlements under optimistic locking (cross-link to `../../dynamodb-design/references/03-write-correctness.md`).

**When to use:** Launching a paid tier on a new Expo project (Acme Shop just added `Acme Shop Plus` — $4.99/mo for free shipping + early access to sales; this doc is the playbook), chasing "my TestFlight tester cannot buy anything" bugs (§11.1), deciding whether to ship RevenueCat or roll your own on `react-native-iap` (§3), writing the webhook handler that flips a `plus` flag on the user record when a subscription renews (§9), debugging "Restore Purchases" returning empty on a reinstall across accounts (§11.3), or responding to an App Store rejection for missing restore-purchases UI (§7). Read §3 before picking an SDK; §4 before you create your first product in App Store Connect; §6 before trusting a client-reported `isPremium`; §9 before promising the marketing team "purchases reflect in the backend within seconds".

**Prerequisites:** `./00-architecture.md` (project layout — `src/features/monetization/` owns the paywall and the entitlement hook; `app.config.ts` for the RevenueCat API keys under `extra`; EAS build profiles for separating sandbox vs production RC keys), `./01-navigation.md` §6 (the paywall route — `/paywall?sku=...` — and the `DeepLinkListener` auth guard that gates it; this reference only adds the purchase mechanics, not the navigation), `./03-auth-and-networking.md` §4 (the auth state machine — `Purchases.logIn(user.id)` fires from the same `onAuthChange` that feeds Sentry + PostHog; §5 for the `apiClient` that the webhook Lambda's sibling endpoints reuse), `./04-native-and-release.md` §9 (native-side IAP config — iOS "In-App Purchase" capability, Android `com.android.vending.BILLING` permission, App Store Connect + Play Console product creation; that reference enables the capability, this one uses it), `./08-observability.md` §7.2 (the `PaywallViewed` / `SubscriptionStarted` / `SubscriptionCancelled` event taxonomy and the `trackEvent` facade the paywall screen calls), `../../aws-cdk-patterns/references/01-serverless-api.md` (the webhook endpoint is a Lambda + API Gateway integration following that reference's hexagonal split), `../../dynamodb-design/references/03-write-correctness.md` §1 (the entitlement update on webhook ingestion uses `updateWithLock<Entitlement>` — the full optimistic-locking pattern lives there; §9 below shows only the handler skeleton). Required packages: `react-native-purchases@^10`, `expo-linking` (already a peer for the deep-link helpers used in §1), `expo-constants` (for API keys from `app.config.ts` extras).

> Examples verified against Expo SDK 54 + `react-native-purchases` 10.0.1 on 2026-04-23. Re-verify via context7 before porting to a newer SDK — RevenueCat v8 replaced the stringly-typed configure call with a typed `PurchasesConfiguration` object (reflected in §5.1), v9 introduced `Purchases.logIn(appUserID)` returning a `{ customerInfo, created }` tuple (replacing the deprecated `Purchases.identify`; reflected in §6), and v10 bumped to `proxyURL` + first-class iOS 17.4 StoreKit 2 transaction signing (nothing in this file depends on that, but the underlying receipt format on iOS is now JWS rather than the legacy base64 blob — your server must accept both during a transition window if you are validating receipts yourself under `react-native-iap`). Webhook payload shapes referenced in §9 are the RevenueCat v1 webhook schema as of 2026-04 — the `event.type` enum is stable; `app_user_id` is the field name (NOT `appUserId`); and the `X-Revenuecat-Signature` header is HMAC-SHA256 over the raw body with your webhook secret.

## Contents

1. **What monetization covers, and what it does not** — The four surfaces (paywall screen, entitlement gate, restore button, subscription-management deep link). The "entitlements, not products, are the UI contract" rule. Why server-side truth must outrank the client `getCustomerInfo` cache.
2. **Project layout** — `src/features/monetization/`, the paywall screen, the `usePremiumEntitlement` hook, `restorePurchases.ts`, `openSubscriptionSettings.ts`. What lives where and why.
3. **RevenueCat as default — why, and when to pick `react-native-iap` instead** — The rationale for RevenueCat (receipt validation, offering A/B tests, webhooks), the one case where `react-native-iap` wins (strict "no SaaS" constraint + self-hosted entitlement service), and the explicit trade-off you sign up for in each case.
4. **The subscription model — entitlements vs products vs offerings** — How the three RevenueCat concepts map to the UI, why you almost always gate on entitlements not product IDs, how Offerings enable price A/B testing from the dashboard without a new app build, and the Offering Groups feature for experimentation.
5. **SDK config + bootstrap** — The `app.config.ts` `extra` block for the RC API keys, the one-time `Purchases.configure` call, `Purchases.logIn(userId)` tied to the auth state machine from `./03-auth-and-networking.md` §4, and the `addCustomerInfoUpdateListener` contract.
6. **The paywall screen** — Fetching offerings, rendering packages, the purchase call, analytics instrumentation using the event taxonomy from `./08-observability.md` §7.2, optimistic-UI rule for the "Subscribe" button.
7. **Restore purchases** — Required by App Store Review Guideline 3.1.1; UI placement; the `Purchases.restorePurchases()` flow; the "user switched Apple IDs" edge case; the three error shapes you handle.
8. **Subscription management deep links** — The iOS `https://apps.apple.com/account/subscriptions` URL, the Android `market://details?id=...&sku=...` URL, the `Linking.openURL` helper, why you do NOT try to cancel the subscription from inside your app.
9. **Webhook to backend provisioning** — RevenueCat webhook payload shape, `X-Revenuecat-Signature` verification, the API Gateway + Lambda + DynamoDB path that updates the entitlement record under optimistic locking, idempotency on `event.id`, cross-link to `../../aws-cdk-patterns/references/01-serverless-api.md` for the endpoint and `../../dynamodb-design/references/03-write-correctness.md` for the write itself.
10. **Receipt validation — server-side truth, client-side optimism** — Why client-reported purchase state is never trusted alone (receipt-replay fraud), how RevenueCat does validation by default, what you must do yourself if you ship `react-native-iap` (App Store Server API + Google Play Developer API), the "never gate premium content on the client booleans alone" rule.
11. **App Store / Play Store gotchas** — TestFlight tester + sandbox account pairing, introductory-offer rules (free trial + intro price), family sharing, grace periods on renewal failure, renewal-notification lag vs real-time webhooks.
12. **Gotchas (monetization-specific)** — Product not returned (TestFlight tester not in sandbox), webhook fires before client cache refreshes, restore empty on fresh install after account switch, Play testing track requires signed upload, receipts not ready on app open, `Purchases.logIn` race with anonymous spend.
13. **Verification** — Sandbox purchase in TestFlight, webhook smoke test in RC dashboard, restore on reinstall, end-to-end flow from paywall to backend entitlement write.
14. **Further reading** — Pointers into this skill and external canonical docs.

---

## Section 1: What monetization covers, and what it does not

The monetization surface has **four responsibilities and no more**:

1. **Paywall** — the screen the user sees when they hit a gated action. Fetches offerings, renders packages, initiates the purchase.
2. **Entitlement gate** — the hook (`usePremiumEntitlement`) the UI calls to decide whether to show the "Plus" badge, unlock the sale, bypass shipping fees.
3. **Restore button** — a settings-screen button that calls `Purchases.restorePurchases()`. Required by Apple. Not optional.
4. **Subscription management link** — a settings-screen button that deep-links to the App Store / Play Store subscription page. You do NOT cancel the subscription yourself; you send the user to the platform.

What monetization **does not** cover in this file:

- Native-side IAP configuration — In-App Purchase capability in Xcode, `BILLING` permission on Android, App Store Connect / Play Console product creation. That lives in `./04-native-and-release.md` §9.
- The navigation into the paywall — deep-link `DeepLinkListener`, auth guard, `push` vs `replace`. That lives in `./01-navigation.md` §6.
- The analytics event taxonomy itself — `PaywallViewed`, `SubscriptionStarted`, etc. are declared in `./08-observability.md` §7.2. This file only calls `trackEvent(EventNames.PaywallViewed, ...)` at the right moments.
- The backend entitlement write — the optimistic-locking pattern on the DynamoDB user-entitlement record lives in `../../dynamodb-design/references/03-write-correctness.md` §1. §9 below shows the Lambda handler skeleton that calls it.

The cross-file invariant: **entitlements are the UI contract, not products.** The UI should never check `productIdentifier === "com.acme.shop.plus_monthly"`. It should check `customerInfo.entitlements.active["plus"]`. That indirection lets you change products (e.g., ship a new annual plan, sunset the monthly plan) without rewriting every gated screen. §4 makes this concrete.

The other cross-file invariant: **server-side truth outranks the client cache.** `Purchases.getCustomerInfo()` is a fast-path read from the SDK's local cache; it is not the source of truth. For non-critical UI (showing a "Plus" badge in the nav bar), trust the client. For anything with money or data-export implications (early-access product drops, bulk exports, enterprise features), verify on the server by reading the entitlement record your webhook Lambda wrote. §10 expands.

---

## Section 2: Project layout

```
src/
  features/
    monetization/
      screens/
        paywall.screen.tsx        // §6 — the paywall UI
        subscription.screen.tsx   // settings screen — restore + manage + cancel FAQ
      hooks/
        use-premium-entitlement.ts // §6 — projects getCustomerInfo() onto a bool
        use-paywall-offer.ts       // §6 — fetches offerings, caches via RQ
      lib/
        purchases.ts               // §5 — Purchases.configure + logIn/logOut
        restore-purchases.ts       // §7 — helper with error-case handling
        open-subscription-settings.ts // §8 — Linking.openURL(platform-specific)
  features/
    auth/
      useAuthSync.ts               // (updated) — calls Purchases.logIn/logOut too
backend/
  webhooks/
    revenuecat/
      handler.ts                   // §9 — Lambda that receives RC webhook
      verify-signature.ts          // §9 — HMAC-SHA256 check on X-Revenuecat-Signature
```

Three invariants that make this split work:

1. **`purchases.ts` is the only place `Purchases.configure` is called.** Everything else imports the configured singleton implicitly (via the static `Purchases` import). Calling `configure` twice is a no-op in v10, but it signals confused ownership.
2. **`use-premium-entitlement.ts` is the only hook feature code uses to check entitlement state.** No component reaches into `Purchases.getCustomerInfo()` directly. This is the same discipline as the `useAnalytics` hook in `./08-observability.md` §7 — single entry point, single point of change.
3. **The webhook handler lives in `backend/`, not `src/`.** This is a Node Lambda, not an Expo RN module. Its dependencies (`@aws-sdk/client-dynamodb`, `crypto`) are server-only. Mixing them into the app bundle would break Metro on every build.

---

## Section 3: RevenueCat as default — why, and when to pick `react-native-iap` instead

### 3.1 Why RevenueCat for Acme Shop (and almost everyone)

RevenueCat wraps StoreKit and Google Play Billing. It does five things you would otherwise build and maintain yourself:

- **Server-side receipt validation.** The App Store returns a signed receipt; Google Play returns a purchase token. Verifying those against the respective platform's server API is a solved problem — solved by RevenueCat. Rolling your own means owning: the App Store Server API client, the Google Play Developer API client, retry logic for transient platform-side 5xx, a store of receipts keyed by transaction, and a cron job that re-validates subscriptions at renewal time. That is a team-week of work on day one, and it is maintenance forever.
- **Entitlement abstraction.** You declare an entitlement (`"plus"`) in the RC dashboard, attach products to it (monthly + annual + yearly-intro-offer), and your client code checks `entitlements.active["plus"]`. Adding a new SKU later is a dashboard change, not a code deploy.
- **Offerings + A/B testing.** A single "current offering" fetched from the dashboard can be swapped per user cohort, per geo, per experiment. You A/B test pricing or copy without shipping a new build.
- **Webhooks.** RevenueCat posts a normalized event (`INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`) to your server in near-real-time. You handle the lifecycle from one endpoint instead of polling each platform's server.
- **Cross-platform subscription identity.** A user who subscribes on iOS and signs in on Android sees their subscription. RC reconciles by `app_user_id` you pass to `Purchases.logIn`.

RevenueCat's pricing at the time of writing is free up to $2.5k MTR (monthly tracked revenue); beyond that it is 1% of tracked revenue. For Acme Shop's expected Plus MRR that is ~$30/mo at launch and ~$300/mo at the year-end target — negligible against the saved engineer-weeks.

### 3.2 The one case for `react-native-iap`

Pick `react-native-iap` (or `expo-iap`) when:

- You have a **strict no-SaaS constraint** from compliance or procurement — you cannot send receipts to a third party, even for validation. Some regulated industries (health, defence, some banking) genuinely have this constraint; most startups do not.
- You already operate a **self-hosted entitlement service** that handles store-side receipt validation in-house — you have the App Store Server API client and the Google Play Developer API client implemented and tested, and you don't want to duplicate validation.

In that case, you give up: dashboard-driven offerings, webhook normalization, A/B pricing, and the cross-platform identity abstraction. You own receipt validation end-to-end, which means: you run the scheduler that re-validates subscriptions daily, you handle Apple's signed-JWS receipt format (StoreKit 2 under iOS 17.4+), you reconcile Google Play's purchase-token rotation on renewal, you implement the retry-and-alert path for when Apple's validation endpoint returns 500 for six hours, and you explain to product why the offering on the paywall requires a build-deploy-submit-review cycle to change the price.

Every code example in the rest of this file is RevenueCat. If you chose `react-native-iap`, consult its docs — they are good — and apply the architectural patterns in §6 (paywall screen shape), §7 (restore button), §8 (subscription settings link), §9 (webhook handler if you build server-side receipt refresh), and §10 (never-trust-the-client rule) unchanged.

---

## Section 4: The subscription model — entitlements vs products vs offerings

Three RevenueCat concepts you must understand before writing any code:

| Concept | What it is | UI binding | Who owns it |
|---------|-----------|-----------|-------------|
| **Product** | A store SKU — one row in App Store Connect / Play Console. Example: `com.acme.shop.plus_monthly`, price $4.99/mo. | Never. | The stores (RC mirrors them). |
| **Entitlement** | A permission flag the client gates on. Example: `plus`. Attached to one or more products. | `customerInfo.entitlements.active["plus"]`. | The RC dashboard. |
| **Offering** | A bundle of packages (usually 1–3: monthly + annual + weekly-trial) shown together on the paywall. The paywall renders from an Offering. | `offerings.current.availablePackages`. | The RC dashboard. |

The mental model:

```
App Store Product (SKU)   -- attached to --> Entitlement "plus" --> UI gate
Play Store Product (SKU)  -- attached to --> Entitlement "plus" --> UI gate

Offering "default"
  Package "$rc_monthly"   -- maps to --> Product: plus_monthly (iOS)    / plus_monthly (Android)
  Package "$rc_annual"    -- maps to --> Product: plus_annual (iOS)     / plus_annual (Android)
  Package "$rc_trial"     -- maps to --> Product: plus_trial_week (iOS) / plus_trial_week (Android)
```

The paywall shows the Offering. The UI gates on the Entitlement. The products are a store-side detail the client should not care about.

### 4.1 Acme Shop Plus — the concrete setup

In the RC dashboard:

- **Entitlement:** `plus` — "Acme Shop Plus (free shipping + early access)"
- **Products:**
  - iOS: `com.acme.shop.plus_monthly` ($4.99/mo), `com.acme.shop.plus_annual` ($49.99/yr with 2-month-free intro)
  - Android: same IDs (we kept parity; §4.2 on why)
- **Offering:** `default`
  - Package `$rc_monthly` routes to both platform products
  - Package `$rc_annual` routes to both platform products
- **Offering:** `holiday_sale_2026` (not yet current) — a holiday-themed variant with a 40% discount on annual.

### 4.2 Parity on product IDs across platforms

RC does not require iOS and Android to share a product ID — the Offering maps per-platform. But we keep them identical because:

- **Simpler debugging.** "Which product failed to purchase?" has one answer, not "the iOS one or the Android one?".
- **Unified analytics.** PostHog events carry `product_id` (`./08-observability.md` §7.2); cross-platform funnels collapse cleanly when the ID is the same.
- **Easier refund reconciliation.** Customer-support queries match one SKU across both platforms.

The cost of parity: you give up platform-specific pricing arbitrage (e.g., charging more on iOS because payments are stickier there). In our experience that arbitrage is worth less than the operational simplicity.

### 4.3 A/B testing via Offering Groups

The RC dashboard has an **Experiments** feature that splits users across Offerings by cohort:

- 50% of users see Offering `default` (monthly $4.99, annual $49.99).
- 50% of users see Offering `pricing_test_q2` (monthly $6.99, annual $59.99).

The client code is unchanged. `Purchases.getOfferings().current` returns whichever offering the user's cohort is assigned. The only client-side work is tagging analytics with the offering identifier so you can correlate (§6 shows this).

The rule: **all price experiments go through the RC dashboard.** Do not ship a build that hardcodes `"plus_monthly_higher_price"`. The second you do, you own the rollback, the cohort assignment, and the analytics — the three things RC does for you.

---

## Section 5: SDK config + bootstrap

### 5.1 The API keys — `app.config.ts` extras, split by environment

```ts
// app.config.ts
import type { ExpoConfig } from "expo/config";

export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,
  name: "Acme Shop",
  slug: "acme-shop",
  plugins: ["expo-router"],
  ios: { bundleIdentifier: "com.acme.shop" },
  android: { package: "com.acme.shop" },
  extra: {
    env: process.env.APP_ENV ?? "development",
    // RevenueCat has separate API keys per platform. Both are "public" in the
    // sense that they ship in the client binary — but they are scoped to the
    // RC project and cannot be used to read other customers' data.
    revenuecatIosKey: process.env.REVENUECAT_IOS_KEY,
    revenuecatAndroidKey: process.env.REVENUECAT_ANDROID_KEY,
  },
});
```

Both keys are injected by EAS from `eas.json` `env:`. In `development` profiles they point at the RC sandbox project; in `production` at the live project. Mixing them — a dev build with prod keys — is the single most common way to see "real" customers appear in a staging dashboard.

### 5.2 The `Purchases.configure` call

```ts
// src/features/monetization/lib/purchases.ts
import Constants from "expo-constants";
import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

/**
 * Call once, at app startup, before any other Purchases method.
 * v10 accepts an API key via the typed `PurchasesConfiguration` object.
 * Safe to call multiple times — subsequent calls are no-ops if the key is unchanged.
 */
export function initPurchases(): void {
  const extra = Constants.expoConfig?.extra ?? {};

  const apiKey =
    Platform.OS === "ios"
      ? (extra["revenuecatIosKey"] as string | undefined)
      : (extra["revenuecatAndroidKey"] as string | undefined);

  if (!apiKey) {
    // Fail loud in dev, fail silently in prod so a missing key does not brick
    // the app — monetization is a non-critical surface at launch.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[purchases] No RevenueCat API key; IAP disabled");
    }
    return;
  }

  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);

  Purchases.configure({
    apiKey,
    // appUserID null => RC auto-generates an anonymous ID. We call
    // Purchases.logIn(user.id) later when the user authenticates (§5.3).
    appUserID: null,
    // `useAmazon` => Amazon App Store on Fire devices. We do not ship there.
    useAmazon: false,
  });
}
```

Call `initPurchases()` exactly once from `app/_layout.tsx`:

```tsx
// app/_layout.tsx (excerpt; full wiring in 08-observability.md §3.2)
import { useEffect } from "react";
import { initPurchases } from "@/features/monetization/lib/purchases";

function RootLayout() {
  useEffect(() => {
    initPurchases(); // monetization bootstrap
    // initSentry() and initAnalytics() are called alongside — see 08-observability.md §3.
  }, []);
  // ...
}
```

### 5.3 `Purchases.logIn` / `logOut` — wired to the auth state machine

The auth `onAuthChange` callback from `./03-auth-and-networking.md` §4 is the choke point. Every auth transition fans out to Sentry, PostHog, and RevenueCat — from one place, atomically:

```ts
// src/features/auth/useAuthSync.ts (extended from 08-observability.md §8)
import * as Sentry from "@sentry/react-native";
import { useEffect } from "react";
import Purchases from "react-native-purchases";

import { posthog } from "@/analytics/posthog";
import { useAuth } from "./useAuth";

export function useAuthSync(): void {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === "authenticated" && user) {
      Sentry.setUser({ id: user.id });
      posthog?.identify(user.id, { email: user.email, plan: user.plan });

      // RC: log in. Returns { customerInfo, created } — `created` tells you if
      // this is a fresh RC user (no prior purchases under this app_user_id).
      // We do not block on this; subscription state will refresh via the
      // customer-info listener in §5.4. Errors are swallowed because a failed
      // RC login should never block the app UX.
      Purchases.logIn(user.id).catch((err: unknown) => {
        Sentry.captureException(err, { tags: { feature: "monetization" } });
      });
    } else if (status === "unauthenticated") {
      Sentry.setUser(null);
      posthog?.reset();

      // RC: log out. This resets the anonymous ID; purchases made while
      // signed-in are still tracked under the previous app_user_id on RC's
      // side and can be restored after the next login.
      Purchases.logOut().catch((err: unknown) => {
        Sentry.captureException(err, { tags: { feature: "monetization" } });
      });
    }
  }, [status, user]);
}
```

Two rules that you cannot break:

1. **Use `Purchases.logIn(user.id)`, not `Purchases.configure({ appUserID })` post-bootstrap.** `configure` is a one-time bootstrap; `logIn` handles the identity transition correctly (reconciles anonymous purchases with the user record, emits a `customer_info_update` event).
2. **Swallow RC errors in the auth sync path.** A RevenueCat outage should degrade to "user cannot restore purchases" — it should not lock the user out of the app. The paywall and restore-purchases screens have their own error handling (§6, §7).

### 5.4 `addCustomerInfoUpdateListener` — the subscription-state stream

The SDK emits a `CustomerInfo` update on every change (purchase complete, subscription renewed, entitlement expired). Register one listener at bootstrap, feed the result into your entitlement hook's cache:

```ts
// src/features/monetization/lib/purchases.ts (extended)
import Purchases, { CustomerInfo } from "react-native-purchases";

// In-memory state mirror — the entitlement hook in §6.2 reads from this.
// Using a Zustand store (see 02-state-and-data.md §4) would be equivalent.
let cachedCustomerInfo: CustomerInfo | null = null;
const listeners = new Set<(info: CustomerInfo) => void>();

export function attachCustomerInfoListener(): () => void {
  const handler = (info: CustomerInfo) => {
    cachedCustomerInfo = info;
    for (const listener of listeners) listener(info);
  };
  Purchases.addCustomerInfoUpdateListener(handler);
  return () => Purchases.removeCustomerInfoUpdateListener(handler);
}

export function subscribeToCustomerInfo(
  listener: (info: CustomerInfo) => void,
): () => void {
  listeners.add(listener);
  if (cachedCustomerInfo) listener(cachedCustomerInfo);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedCustomerInfo(): CustomerInfo | null {
  return cachedCustomerInfo;
}
```

Call `attachCustomerInfoListener()` once from the same effect in `app/_layout.tsx` that calls `initPurchases()`. The `unsubscribe` returned by that call is the effect's cleanup.

---

## Section 6: The paywall screen

### 6.1 Fetching offerings

The paywall's source of truth is `Purchases.getOfferings().current`. Cache it via React Query (`./02-state-and-data.md` §5) with a 5-minute stale time — the dashboard rarely changes within a session:

```ts
// src/features/monetization/hooks/use-paywall-offer.ts
import { useQuery } from "@tanstack/react-query";
import Purchases, {
  PurchasesOffering,
  PurchasesPackage,
} from "react-native-purchases";

/**
 * Fetches the current RC offering. Returns null while loading.
 * Errors are surfaced to the caller via `isError`; we do not try to
 * silently fall back to a hardcoded offering — if RC is down, the paywall
 * should say so, not sell a product that might not exist.
 */
export function usePaywallOffer(): {
  offering: PurchasesOffering | null;
  packages: PurchasesPackage[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ["revenuecat", "offerings", "current"],
    queryFn: async () => {
      const offerings = await Purchases.getOfferings();
      return offerings.current; // may be null if no current offering is set in the dashboard
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  return {
    offering: query.data ?? null,
    packages: query.data?.availablePackages ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
```

### 6.2 The entitlement hook — `usePremiumEntitlement`

The hook every feature screen calls to decide whether to show Plus features. Backed by the `addCustomerInfoUpdateListener` stream from §5.4:

```ts
// src/features/monetization/hooks/use-premium-entitlement.ts
import { useEffect, useState } from "react";
import Purchases, { CustomerInfo } from "react-native-purchases";

import {
  getCachedCustomerInfo,
  subscribeToCustomerInfo,
} from "@/features/monetization/lib/purchases";

const ENTITLEMENT_ID = "plus";

export type PremiumEntitlement = {
  isActive: boolean;
  /** ISO string; null if never subscribed or if subscription has fully lapsed. */
  expiresAt: string | null;
  /** true if the user is in a free-trial period, not yet billed. */
  isInTrial: boolean;
  /** true if RC's local cache is still bootstrapping; treat as "unknown". */
  isLoading: boolean;
};

export function usePremiumEntitlement(): PremiumEntitlement {
  const [info, setInfo] = useState<CustomerInfo | null>(getCachedCustomerInfo());

  useEffect(() => {
    // Kick off a one-shot fetch in case the listener has not fired yet.
    Purchases.getCustomerInfo()
      .then((fresh) => {
        setInfo(fresh);
      })
      .catch(() => {
        // Swallow — subscribeToCustomerInfo will pick up future changes.
      });

    return subscribeToCustomerInfo(setInfo);
  }, []);

  if (info === null) {
    return {
      isActive: false,
      expiresAt: null,
      isInTrial: false,
      isLoading: true,
    };
  }

  const entitlement = info.entitlements.active[ENTITLEMENT_ID];
  return {
    isActive: entitlement !== undefined,
    expiresAt: entitlement?.expirationDate ?? null,
    isInTrial: entitlement?.periodType === "TRIAL",
    isLoading: false,
  };
}
```

Usage in a feature screen:

```tsx
// src/features/catalog/product-grid.tsx (excerpt)
import { usePremiumEntitlement } from "@/features/monetization/hooks/use-premium-entitlement";
import { useRouter } from "expo-router";

export function ProductGrid(): JSX.Element {
  const router = useRouter();
  const { isActive: isPlus } = usePremiumEntitlement();

  function onEarlyAccessTap(productId: string) {
    if (!isPlus) {
      // Paywall is a deep-linkable route — see 01-navigation.md §6.
      router.push({
        pathname: "/paywall",
        params: { sku: productId, source: "early_access_gate" },
      });
      return;
    }
    router.push({ pathname: "/product/[id]", params: { id: productId } });
  }

  // ... render grid with an "Early access" badge on Plus-only items
  return <></>;
}
```

### 6.3 The paywall screen with purchase + analytics

```tsx
// src/features/monetization/screens/paywall.screen.tsx
import { useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Purchases, {
  PURCHASES_ERROR_CODE,
  PurchasesPackage,
} from "react-native-purchases";
import { useLocalSearchParams, useRouter } from "expo-router";

import { EventNames } from "@/lib/eventNames";
import { useAnalytics } from "@/hooks/useAnalytics";
import { usePaywallOffer } from "@/features/monetization/hooks/use-paywall-offer";
import { usePremiumEntitlement } from "@/features/monetization/hooks/use-premium-entitlement";

type PaywallParams = {
  sku?: string; // optional — we usually show the whole offering
  source?: "onboarding" | "post_purchase" | "settings" | "early_access_gate";
};

export default function PaywallScreen(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<PaywallParams>();
  const { track } = useAnalytics();

  const { offering, packages, isLoading, isError, refetch } = usePaywallOffer();
  const { isActive: isPlus } = usePremiumEntitlement();

  // Fire PaywallViewed once per mount. If you render the paywall inside a
  // Stack, the effect re-fires on re-entry, which is the intent — multiple
  // visits to the paywall in one session are multiple funnel entries.
  useEffect(() => {
    if (offering === null) return;
    track(EventNames.PaywallViewed, {
      surface: params.source ?? "settings",
      variant: offering.identifier,
    });
  }, [offering?.identifier, params.source, track]);

  // If the user is already Plus by the time they land here (bounced from a
  // stale deep link, or the webhook wrote back between navigations), close.
  useEffect(() => {
    if (isPlus) router.back();
  }, [isPlus, router]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || offering === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>
          Could not load subscription options. Check your connection.
        </Text>
        <Pressable onPress={refetch} style={styles.retry}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Acme Shop Plus</Text>
      <Text style={styles.subtitle}>
        Free shipping on every order. Early access to sales. 20% off monthly drops.
      </Text>

      <FlatList
        data={packages}
        keyExtractor={(pkg) => pkg.identifier}
        renderItem={({ item }) => (
          <PackageRow
            pkg={item}
            offeringId={offering.identifier}
            source={params.source ?? "settings"}
            onPurchased={() => router.back()}
          />
        )}
      />
    </View>
  );
}

function PackageRow({
  pkg,
  offeringId,
  source,
  onPurchased,
}: {
  pkg: PurchasesPackage;
  offeringId: string;
  source: NonNullable<PaywallParams["source"]>;
  onPurchased: () => void;
}): JSX.Element {
  const { track } = useAnalytics();

  async function handlePurchase() {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);

      if (customerInfo.entitlements.active["plus"]) {
        const product = pkg.product;
        // `introPrice` is non-null only when a free trial / intro offer is
        // active on this user for this product. We tag `trial_days` when
        // present so marketing can segment trial-starts from full-price starts.
        const trialDays =
          product.introPrice?.periodUnit === "DAY"
            ? product.introPrice.periodNumberOfUnits
            : 0;

        track(EventNames.SubscriptionStarted, {
          plan_id: product.identifier,
          price_minor: Math.round(product.price * 100),
          currency: product.currencyCode,
          trial_days: trialDays,
        });

        onPurchased();
      }
    } catch (err: unknown) {
      if (
        (err as { code?: string })?.code ===
        PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
      ) {
        // Expected. User tapped Cancel in the native sheet. No toast; no log.
        return;
      }
      Alert.alert(
        "Purchase failed",
        (err as Error)?.message ?? "Unknown error",
      );
    }
  }

  return (
    <Pressable style={styles.packageRow} onPress={handlePurchase}>
      <View style={{ flex: 1 }}>
        <Text style={styles.packageTitle}>{pkg.product.title}</Text>
        <Text style={styles.packagePrice}>{pkg.product.priceString}</Text>
      </View>
      <Text style={styles.cta}>Subscribe</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginTop: 16 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 24, color: "#444" },
  packageRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginVertical: 6,
    backgroundColor: "#f6f6f8",
    borderRadius: 12,
  },
  packageTitle: { fontSize: 16, fontWeight: "600" },
  packagePrice: { fontSize: 14, color: "#555", marginTop: 4 },
  cta: { fontWeight: "700", color: "#0a61ff" },
  error: { textAlign: "center", marginBottom: 16, color: "#c33" },
  retry: { padding: 12, backgroundColor: "#eee", borderRadius: 8 },
});
```

Four non-obvious choices:

- **`PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR` is swallowed silently.** The user tapped Cancel. Showing a toast for it reads as guilt-tripping. Do not log it, do not fire a `purchase_failed` event.
- **`track(EventNames.SubscriptionStarted, ...)` fires on client-reported success.** This is an analytics event, not a billing trigger. The actual backend provisioning happens via the webhook (§9). PostHog is fine with the ~1% mismatch from "user closed the app before the webhook fired".
- **We project `introPrice` onto `trial_days` only when `periodUnit === "DAY"`.** iOS ships intro offers in other units (WEEK, MONTH). The event contract in `./08-observability.md` §7.2 is `trial_days: number`; a non-day intro serialises as 0 and marketing picks it up from `plan_id`.
- **The `isPlus` auto-close guard.** If the user deep-links to `/paywall` but the webhook has already written the entitlement (e.g., they subscribed on another device), close silently. Without this, a user who subscribes on their tablet and opens a renewal reminder on their phone sees "Subscribe" on a product they already have.

### 6.4 Why the paywall does NOT re-fetch offerings on every mount

`usePaywallOffer` uses React Query with a 5-minute stale time. That means navigating into the paywall twice within 5 minutes does not trigger a network request. This matters because:

- The first fetch on cold start is ~200–600ms on good networks. That is an empty screen with a spinner.
- Offerings change infrequently — weekly at most.
- The SDK already caches the offerings locally across app launches. React Query caches per-session.

If you need a fresh offering (e.g., after an A/B test assignment changed), call `refetch()` explicitly. Do not drop the stale time to zero; it turns every paywall entry into a spinner.

---

## Section 7: Restore purchases

### 7.1 Why it is not optional

App Store Review Guideline 3.1.1: "Apps offering subscription services... must... restore past purchases when users reinstall or switch to a new device." Missing this button is a hard rejection. The bounce message is "Guideline 3.1.1 - Missing restore purchases mechanism".

Play Store does not require it as explicitly, but users expect it — and without it, users who reinstall the app lose their Plus badge for days until the next renewal event fires a webhook. Ship restore on both.

### 7.2 Placement

The button lives on the **subscription settings screen**, accessible from:

- The main settings screen "Subscription" row.
- A deep-linkable URL: `acmeshop://settings/subscription` (see `./01-navigation.md` §5 for deep-link registration).

The label is **"Restore Purchases"** — not "Restore", not "Already a member?", not "Restore my purchase". Apple's reviewers look for those exact two words in UI audits; matching them short-circuits the audit.

### 7.3 The helper

```ts
// src/features/monetization/lib/restore-purchases.ts
import Purchases, { CustomerInfo } from "react-native-purchases";
import * as Sentry from "@sentry/react-native";

export type RestoreResult =
  | { kind: "success"; restored: true; activeEntitlements: string[] }
  | { kind: "success"; restored: false } // call succeeded, user had nothing to restore
  | { kind: "error"; message: string };

/**
 * Calls Purchases.restorePurchases() and classifies the outcome.
 *
 * IMPORTANT: Even a successful restore with no active entitlements is a
 * SUCCESS outcome, not an error. The user "restored" — the call completed —
 * they just had nothing to restore. The UI should say "No previous
 * subscriptions found on this account", not "Restore failed".
 */
export async function restorePurchases(): Promise<RestoreResult> {
  try {
    const info: CustomerInfo = await Purchases.restorePurchases();

    const activeEntitlements = Object.keys(info.entitlements.active);
    if (activeEntitlements.length === 0) {
      return { kind: "success", restored: false };
    }

    return { kind: "success", restored: true, activeEntitlements };
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { feature: "monetization", operation: "restore" },
    });
    return {
      kind: "error",
      message: (err as Error)?.message ?? "Restore failed. Try again.",
    };
  }
}
```

Call site:

```tsx
// src/features/monetization/screens/subscription.screen.tsx (excerpt)
import { Alert, Pressable, Text } from "react-native";

import { restorePurchases } from "@/features/monetization/lib/restore-purchases";

export function RestoreButton(): JSX.Element {
  async function onPress() {
    const result = await restorePurchases();
    switch (result.kind) {
      case "success":
        if (result.restored) {
          Alert.alert(
            "Restored",
            `Subscription active: ${result.activeEntitlements.join(", ")}`,
          );
        } else {
          Alert.alert(
            "No previous subscriptions",
            "We could not find any past purchases on this account.",
          );
        }
        return;
      case "error":
        Alert.alert("Could not restore", result.message);
        return;
    }
  }
  return (
    <Pressable onPress={onPress}>
      <Text>Restore Purchases</Text>
    </Pressable>
  );
}
```

### 7.4 The account-switch edge case

**Scenario:** User A buys Plus on their phone. They sign out. User B signs in on the same phone (shared device). User B taps "Restore Purchases".

Two possible outcomes, controlled by the **Apple ID** (iOS) or **Google account** (Android) the device is signed into at the store level — which is separate from your app's auth:

- If the store is still signed in as User A (they never logged out of the store app), `restorePurchases()` returns User A's entitlements. RevenueCat sees two `app_user_id` values claiming the same Apple receipt and will either:
  - **Transfer the purchase** (RC's default on new installs) — User B now has Plus, User A does not. This is a configuration in the RC dashboard; the default is usually wrong for multi-tenant shared-device scenarios.
  - **Refuse the transfer** (RC setting "Restore Behavior: Block") — User B sees "No previous subscriptions".

The guidance: **in the RC dashboard, under Project settings, Store integrations, Transfer Behavior, set "Keep transferring transactions"** for consumer apps (users share devices intra-family), but **"Never transfer"** for B2B apps where each user is a distinct identity. Acme Shop uses "Keep transferring" — a parent who subscribed on their iPad wants the subscription to follow them when their spouse signs in.

Document this behaviour in the subscription-settings screen copy. A one-liner — "Restoring will apply purchases from this device's App Store / Play Store account" — prevents the "why did my spouse's subscription disappear?" support ticket.

---

## Section 8: Subscription management deep links

Users must be able to cancel. Apple requires it; so does common decency. But **you do not cancel from inside your app** — Apple and Google require cancellation to happen on their UI, and trying to do it yourself will get the app rejected.

### 8.1 The platform URLs

- **iOS:** `https://apps.apple.com/account/subscriptions` — opens the App Store's Manage Subscriptions page, scrolled to the user's active subscriptions.
- **Android:** `https://play.google.com/store/account/subscriptions?sku=<product-id>&package=<package-name>` — opens the Play Store's subscription page, filtered to your SKU if provided.

### 8.2 The helper

```ts
// src/features/monetization/lib/open-subscription-settings.ts
import { Linking, Platform } from "react-native";

/**
 * Opens the platform-native "Manage Subscription" page.
 *
 * On iOS, deep-links to App Store then Subscriptions.
 * On Android, deep-links to Play Store then Subscriptions for your SKU.
 *
 * Fails silently (returns false) if the URL cannot be opened — e.g., on a
 * device without the relevant store installed (rare but possible on dev
 * emulators without Play Services). Callers should fall back to a help-page
 * link in that case.
 */
export async function openSubscriptionSettings(opts?: {
  productId?: string;
  androidPackage?: string;
}): Promise<boolean> {
  let url: string;

  if (Platform.OS === "ios") {
    url = "https://apps.apple.com/account/subscriptions";
  } else {
    const productId = opts?.productId ?? "";
    const androidPackage = opts?.androidPackage ?? "";
    if (productId && androidPackage) {
      url = `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(productId)}&package=${encodeURIComponent(androidPackage)}`;
    } else {
      url = "https://play.google.com/store/account/subscriptions";
    }
  }

  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;

  await Linking.openURL(url);
  return true;
}
```

### 8.3 Usage

```tsx
// src/features/monetization/screens/subscription.screen.tsx (excerpt)
import { Alert, Pressable, Text } from "react-native";
import { openSubscriptionSettings } from "@/features/monetization/lib/open-subscription-settings";

export function ManageButton(): JSX.Element {
  async function onPress() {
    const opened = await openSubscriptionSettings({
      productId: "com.acme.shop.plus_monthly",
      androidPackage: "com.acme.shop",
    });
    if (!opened) {
      Alert.alert(
        "Could not open the store",
        "Manage your subscription from the App Store (iOS) or Play Store (Android) app.",
      );
    }
  }
  return (
    <Pressable onPress={onPress}>
      <Text>Manage Subscription</Text>
    </Pressable>
  );
}
```

The copy on the button matters. **"Manage Subscription"** is right. "Cancel Subscription" is misleading — the store UI lets the user upgrade/downgrade/pause too. "Subscription settings" is also fine. Do not label this button anything that suggests the cancellation happens in-app.

---

## Section 9: Webhook to backend provisioning

The flow end-to-end:

```
Apple / Google billing event
  -> RevenueCat ingests receipt, normalises event
  -> POST https://api.acme.example/webhooks/revenuecat
       Header: X-Revenuecat-Signature: sha256=...
       Body: { event: { type: "INITIAL_PURCHASE", app_user_id: "<user.id>", ... } }
  -> API Gateway (REST; no auth — signature-verified in Lambda)
  -> Lambda `revenuecat-webhook-handler`
       1. Verify HMAC signature vs env.REVENUECAT_WEBHOOK_SECRET
       2. Parse + idempotency check on event.id (event_id in DynamoDB)
       3. updateWithLock<Entitlement>({ pk: `USER#${appUserId}`, sk: "ENTITLEMENT" }, ...)
       4. Return 200 (RC retries on non-2xx for 24h)
  -> DynamoDB `user-entitlements-<env>` table
```

### 9.1 The endpoint

The API Gateway route + Lambda follow `../../aws-cdk-patterns/references/01-serverless-api.md` — hexagonal handler, `NodejsFunction` construct, shared Lambda layer for the AWS SDK, explicit log group with retention. The only difference from the reference example: **no Cognito authorizer** — this endpoint is called by RevenueCat, not a signed-in user; authentication is via HMAC signature verification in the Lambda body (§9.3).

### 9.2 The webhook payload

RevenueCat posts a JSON body with the shape:

```ts
// The subset we care about — full schema at
// https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
type RevenueCatWebhookEvent = {
  api_version: "1.0";
  event: {
    id: string; // UUID — use for idempotency (§9.4)
    type:
      | "INITIAL_PURCHASE"
      | "RENEWAL"
      | "CANCELLATION"     // user turned off auto-renew; subscription still active until expiry
      | "EXPIRATION"       // subscription has fully lapsed
      | "BILLING_ISSUE"    // payment failed; grace period active
      | "PRODUCT_CHANGE"   // upgrade/downgrade
      | "UNCANCELLATION"   // user re-enabled auto-renew within grace period
      | "NON_RENEWING_PURCHASE"
      | "TRANSFER"
      | "SUBSCRIBER_ALIAS"
      | "TEST";
    app_user_id: string;    // The user id we passed to Purchases.logIn()
    product_id: string;     // Store SKU
    entitlement_ids: string[] | null;
    event_timestamp_ms: number;
    expiration_at_ms: number | null;   // null for NON_RENEWING / TEST
    purchased_at_ms: number;
    environment: "SANDBOX" | "PRODUCTION";
    // ... many more fields
  };
};
```

The one field worth calling out: `environment` lets you drop sandbox events in production. A sandbox subscription from a dev tester should not provision a real entitlement on the prod table. §9.4 enforces this.

### 9.3 Signature verification

RC signs the webhook with `X-Revenuecat-Signature: sha256=<hex>` where `<hex>` is an HMAC-SHA256 of the raw request body keyed by your webhook secret. Verify it with `crypto.timingSafeEqual`:

```ts
// backend/webhooks/revenuecat/verify-signature.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyRevenueCatSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  // Header format: "sha256=<hex>"
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader);
  if (!match) return false;
  const provided = Buffer.from(match[1], "hex");

  const expected = createHmac("sha256", secret).update(rawBody).digest();

  // timingSafeEqual throws on length mismatch; both buffers are 32 bytes.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
```

The secret lives in AWS Secrets Manager, fetched at cold start by the Lambda. Rotating the secret is a two-step: add the new secret to RC dashboard, wait 5 minutes, update Secrets Manager, then RC will sign with the new secret. Do not rotate the other way (Secrets Manager first) — you will reject live events during the window.

### 9.4 The handler

```ts
// backend/webhooks/revenuecat/handler.ts
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { verifyRevenueCatSignature } from "./verify-signature";
import { updateWithLock } from "@/lib/dynamodb/optimistic-lock";
// ^^ the updateWithLock helper from ../../dynamodb-design/references/03-write-correctness.md §1
import { getRevenueCatSecret } from "@/lib/secrets";
import { recordProcessedEvent, wasEventProcessed } from "./idempotency";

type Entitlement = {
  pk: string; // `USER#<app_user_id>`
  sk: "ENTITLEMENT";
  plus: boolean;
  expiresAtMs: number | null;
  lastEventId: string;
  lastEventType: string;
  lastEventAtMs: number;
  version: number; // required by updateWithLock
};

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const rawBody = event.body ?? "";
  const signature = event.headers["x-revenuecat-signature"]
    ?? event.headers["X-Revenuecat-Signature"];

  const secret = await getRevenueCatSecret();
  if (!verifyRevenueCatSignature(rawBody, signature, secret)) {
    return { statusCode: 401, body: JSON.stringify({ error: "invalid signature" }) };
  }

  const payload = JSON.parse(rawBody) as {
    event: {
      id: string;
      type: string;
      app_user_id: string;
      product_id: string;
      entitlement_ids: string[] | null;
      event_timestamp_ms: number;
      expiration_at_ms: number | null;
      environment: "SANDBOX" | "PRODUCTION";
    };
  };

  const { event: ev } = payload;

  // Drop sandbox events in prod. Sandbox traffic in a staging-tagged env is OK.
  if (ev.environment === "SANDBOX" && process.env.APP_ENV === "production") {
    return { statusCode: 200, body: JSON.stringify({ skipped: "sandbox-in-prod" }) };
  }

  // Idempotency. RC retries on non-2xx for up to 24h; a 200 we already
  // returned will still be re-sent if our earlier response was dropped.
  if (await wasEventProcessed(ev.id)) {
    return { statusCode: 200, body: JSON.stringify({ skipped: "duplicate" }) };
  }

  // Derive the new entitlement state from the event type.
  const isActive =
    ev.type === "INITIAL_PURCHASE" ||
    ev.type === "RENEWAL" ||
    ev.type === "UNCANCELLATION" ||
    ev.type === "PRODUCT_CHANGE" ||
    ev.type === "NON_RENEWING_PURCHASE" ||
    // CANCELLATION means "auto-renew off", NOT "subscription terminated".
    // The entitlement stays active until expiration_at_ms.
    (ev.type === "CANCELLATION" && (ev.expiration_at_ms ?? 0) > Date.now()) ||
    // BILLING_ISSUE still in grace period — keep active.
    (ev.type === "BILLING_ISSUE" && (ev.expiration_at_ms ?? 0) > Date.now());

  const nextState = {
    plus: isActive && (ev.entitlement_ids ?? []).includes("plus"),
    expiresAtMs: ev.expiration_at_ms,
    lastEventId: ev.id,
    lastEventType: ev.type,
    lastEventAtMs: ev.event_timestamp_ms,
  };

  // updateWithLock — full pattern in ../../dynamodb-design/references/03-write-correctness.md §1.
  // The key point: the Entitlement item carries a `version` attribute; we
  // re-read, recompute, write under ConditionExpression "version = :expectedVersion",
  // and retry up to 3 times on ConditionalCheckFailedException.
  await updateWithLock<Entitlement>(
    {
      tableName: process.env.ENTITLEMENTS_TABLE!,
      key: { pk: `USER#${ev.app_user_id}`, sk: "ENTITLEMENT" },
      // If the item does not exist yet (first purchase ever), initialise.
      initialItem: {
        pk: `USER#${ev.app_user_id}`,
        sk: "ENTITLEMENT",
        plus: false,
        expiresAtMs: null,
        lastEventId: "",
        lastEventType: "",
        lastEventAtMs: 0,
        version: 0,
      },
    },
    (current) => {
      // Only apply this event if it is newer than the last one we processed.
      // Out-of-order delivery is rare but possible — RC retries can arrive
      // after a later event has already been processed.
      if (current.lastEventAtMs > ev.event_timestamp_ms) {
        return current; // unchanged — updateWithLock will no-op
      }
      return { ...current, ...nextState };
    },
  );

  await recordProcessedEvent(ev.id);

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
```

Four non-obvious choices:

- **`CANCELLATION` does not clear `plus`.** Cancellation means the user turned off auto-renew. They still have Plus until `expiration_at_ms`. Only `EXPIRATION` fires when the subscription actually ends — and the derived `isActive` evaluates false at that point.
- **Out-of-order delivery is defended at the state-transition layer.** `current.lastEventAtMs > ev.event_timestamp_ms` skips events that arrived after a newer one. Without this, a retried `INITIAL_PURCHASE` could overwrite a later `EXPIRATION`, re-granting expired access.
- **`updateWithLock` with an `initialItem`.** The first event for a user creates the item. Optimistic locking on a missing item is handled by the helper by setting `version: 0` on the initial write and `attribute_not_exists(pk)` on the ConditionExpression of the first attempt. See `../../dynamodb-design/references/03-write-correctness.md` §1 for the full shape.
- **Idempotency via `wasEventProcessed(ev.id)`.** `event.id` is RC's UUID, stable across retries. Store processed IDs in a secondary DynamoDB table with TTL of ~7 days (RC's retry window is 24 hours; 7 days is generous). Without this, a retried `INITIAL_PURCHASE` after an accepted one could double-increment an MRR counter.

### 9.5 What the app sees after the webhook

The webhook writes the entitlement on the server. The **client's** `customerInfo` cache is independent — it refreshes on:

- `addCustomerInfoUpdateListener` firing after the SDK's own sync (usually within seconds of a purchase).
- `Purchases.getCustomerInfo()` called explicitly (e.g., on app foreground).
- RC's internal polling (~24h).

For UI gating on "is Plus", the client cache is fine. For API-level gating (e.g., the `/early-access-products` endpoint only returns Plus products), the backend must read its **own** DynamoDB entitlement record — not trust an `X-Is-Plus` header from the client. §10 expands.

---

## Section 10: Receipt validation — server-side truth, client-side optimism

### 10.1 The threat model

Receipt replay. A user buys a one-month subscription, screenshots the receipt, requests a refund, and then replays the receipt to trick the app into granting Plus. Without server-side validation this works. With server-side validation, the receipt is re-verified against Apple / Google every time it is presented; refunded or expired receipts fail the check.

The client can lie. `customerInfo.entitlements.active["plus"]` is a local JSON object. A modified build, a rooted device, or a man-in-the-middle proxy can inject `{ plus: { ... } }` into the cache. **Gating premium content solely on the client is the vulnerability.**

### 10.2 How RevenueCat handles it

Every `Purchases.purchasePackage()` call goes: native SDK, then App Store / Play Store, then RevenueCat server, then back to client with a signed CustomerInfo. RC validates the receipt against the platform API server-side **before** returning `entitlements.active`. The client never has the raw receipt in a form it can forge.

The `addCustomerInfoUpdateListener` stream is RC-signed. The local cache is trusted because the SDK verifies the signature on each update.

### 10.3 How `react-native-iap` handles it

It does not. `react-native-iap` gives you the raw receipt (iOS: base64 blob, or StoreKit 2 signed JWS on iOS 17.4+; Android: purchase token). **You** send it to your server, **you** call App Store Server API `/inApps/v1/subscriptions/{originalTransactionId}` (iOS) or Google Play Developer API `purchases.subscriptions.get` (Android), **you** verify the response, **you** grant the entitlement.

You also own:

- The JWT-signed requests to the App Store Server API (you sign with your App Store Connect private key).
- The OAuth 2.0 service-account dance for the Play Developer API.
- Retry logic for 5xx from either platform.
- A daily cron to re-validate active subscriptions (receipts go stale).
- Parsing the v2 App Store Server Notifications for renewals (the equivalent of RC webhooks, but raw).

This is a team-week on day one, maintenance forever. §3 already covered when it is worth doing.

### 10.4 The never-trust-the-client rule

**Server-side code must NEVER trust an `X-Is-Plus: true` header from the client.** The pattern that survives is:

```ts
// Inside a Lambda for GET /early-access-products
const claims = event.requestContext.authorizer.claims;
const userId = claims.sub as string;

const entitlement = await dynamodb.send(new GetCommand({
  TableName: process.env.ENTITLEMENTS_TABLE,
  Key: { pk: `USER#${userId}`, sk: "ENTITLEMENT" },
}));

if (!entitlement.Item?.plus) {
  return { statusCode: 403, body: JSON.stringify({ error: "plus_required" }) };
}
// ... return early-access products
```

The entitlement record is the one written by the webhook Lambda (§9). It is RC's server-side truth, projected into our database. The client can lie about `isPlus` locally — the only consequence is that the UI shows a Plus-only button. Tapping the button hits the API; the API reads the real entitlement; the API returns 403 if they are not actually Plus; the UI shows "Subscribe to Plus".

Client-side gating is UX. Server-side gating is security. Ship both.

---

## Section 11: App Store / Play Store gotchas

### 11.1 TestFlight tester + sandbox account pairing

**Symptom:** A TestFlight tester opens the paywall. `Purchases.getOfferings()` returns an offering with zero packages, or with packages whose `product` is `null`. They cannot purchase.

**Cause:** The tester's device is signed into a production Apple ID. TestFlight builds on production Apple IDs use the **sandbox** IAP environment for unreleased products — but only if the device has signed into a **sandbox tester account** at least once (Settings then App Store then Sandbox Account on iOS).

**Fix:** Document the sandbox-account setup step in the beta tester onboarding email. The account is created in App Store Connect under Users and Access, then Sandbox Testers. Attach one sandbox tester email per physical device; do not share accounts (Apple rate-limits them).

### 11.2 Introductory offer rules

Apple's rules on intro offers (free trial + intro price) are stricter than the intuitive version:

- **A user gets one intro offer per subscription group**, not per product. Upgrading from `plus_monthly` (which had a 7-day trial) to `plus_annual` (which offers a 1-month trial) does NOT grant the annual trial — they already used their trial on monthly.
- **Family sharing** — if a Family Sharing member has used an intro offer, other members of the family are ineligible. RC surfaces this via `product.introPrice === null` on the ineligible user's client.
- **The trial period is part of the subscription.** During the trial, the entitlement is active; `CANCELLATION` (auto-renew off) during trial is common and normal. `EXPIRATION` at trial end only fires if the user actually cancelled — otherwise the trial rolls into a paid period and fires `RENEWAL`.

### 11.3 Grace periods and billing-issue events

When a renewal fails (expired card, insufficient funds), the store enters a **grace period** — typically 16 days on iOS, 30 on Android. During this period:

- The subscription is still active (the entitlement stays `isActive`).
- RC fires `BILLING_ISSUE` on the first failure.
- The user gets notifications from the store to update payment.
- At the end of grace, if still unpaid, `EXPIRATION` fires.

The webhook handler in §9.4 treats `BILLING_ISSUE` with `expiration_at_ms > Date.now()` as "still active", which is correct. The common bug is to see `BILLING_ISSUE` in RC's event log and assume it means "access revoked" — it does not, not yet.

For UX, consider surfacing an in-app banner "We had trouble with your last renewal — update payment in the App Store" triggered by a `BILLING_ISSUE` webhook that also writes a `billingIssue: true` flag onto the entitlement record. The banner links to `openSubscriptionSettings()` (§8).

### 11.4 Renewal-notification lag

Apple and Google push renewal notifications to RC with latency that varies from seconds to ~15 minutes. RC then posts to your webhook with additional latency (seconds). End-to-end: **expect renewals to take up to a minute to reflect on your server.**

The impact: on renewal day, a user who opens the app, sees Plus active (client cache from previous session), uses a Plus feature, backgrounds the app, and waits — they do not see any transition. The renewal webhook fires silently, the entitlement record updates, next session everything is fine.

The failure mode: the renewal genuinely fails (billing issue). Client cache still shows Plus active. The user makes a Plus-gated purchase at 00:02 on the billing date. The server returns 403. The user sees "Subscription expired". This is correct — they do not have Plus — but it is confusing because the Plus badge was still visible a second ago.

Mitigation: on cold start, fetch `Purchases.getCustomerInfo()` before rendering the home screen. Its result reflects the RC-server state, which is fresher than the local cache. §5.4 already wired this via the listener; the explicit cold-start fetch in `usePremiumEntitlement` (§6.2) catches the edge case.

---

## Section 12: Gotchas (monetization-specific)

### 12.1 Product not returned from `getOfferings`

**Fingerprint:** `Purchases.getOfferings()` returns a valid offering, but `offering.availablePackages[n].product` is null or the array is empty. The paywall shows nothing.

**Cause (most common):** The product in App Store Connect is in "Waiting for Review" or "Developer Action Needed" status. Only "Ready to Submit" and "Approved" products return from the store API for sandbox purchases.

**Cause (second):** The sandbox tester account is in a different App Store territory from the product's price tier. Set the sandbox tester's territory in App Store Connect Sandbox Testers to match.

**Cause (third):** Bundle ID mismatch — the TestFlight build's bundle ID is not identical to the one the product is attached to. Common when mixing `com.acme.shop` (prod) and `com.acme.shop.dev` (dev) — products attached to one do not show up for the other.

**Fix:** Verify in the RC dashboard Products tab; products that are visible there but `null` at runtime are usually the App Store status / tester territory problem. `npx expo config` dumps the resolved bundle ID for comparison.

### 12.2 Webhook fires before client cache refreshes

**Fingerprint:** User subscribes. Your backend DB has `plus: true` within 2 seconds. Client cache still shows `isPlus: false` for 15–30 seconds. Paywall auto-close (§6.3) does not fire immediately.

**Cause:** The SDK's `addCustomerInfoUpdateListener` fires when the SDK itself ingests the purchase locally — which is after the native StoreKit transaction completes, typically ~1–3 seconds. But there is a race: if the client-side `purchasePackage` promise resolves and the user navigates away before the listener fires, the home screen still uses the stale cache.

**Fix:** The `usePremiumEntitlement` hook in §6.2 does an explicit `Purchases.getCustomerInfo()` on mount, which triggers a fresh SDK sync. That closes the window. For the paywall screen specifically, you can also `await Purchases.syncPurchases()` before navigating away, but in v10 this is rarely necessary.

**Fix (backend-first UX):** If the client really must know "plus just activated" within seconds and the SDK lag is a problem, query your own backend endpoint (which the webhook already updated) instead of the SDK cache. This is the "server is truth" rule in §10 applied to the UX.

### 12.3 Restore returns empty after account switch

**Fingerprint:** User signs into their second device (same Apple ID, fresh install). Taps "Restore Purchases". Gets "No previous subscriptions". But they have an active subscription.

**Cause:** The user's Apple ID in App Store Connect settings is different from the Apple ID they are signed in as for their in-app account. The App Store receipt is tied to the Apple ID signed into the App Store app, not to your app's user.

**Fix:** Check Settings, then [User], then Media & Purchases, then Apple ID. If it differs from expectation, the user must sign out of the wrong account and sign in with the correct one. Document in the subscription screen's help copy: "Subscription purchases are tied to the Apple ID signed into the App Store app, not to your Acme Shop account."

### 12.4 Play Store testing track requires signed upload

**Fingerprint:** On Android, `Purchases.getOfferings()` returns empty on an internal test build. The RC dashboard shows products as active.

**Cause:** The Play Store only returns products for builds that have been uploaded to a Play Console track (internal, closed, open, production). A local `eas build --profile development` installed via ADB does **not** get products. You must upload to an internal testing track.

**Fix:** `eas submit --profile preview` uploads the build to Play Console's Internal Testing track. Then install from the Play Store on a tester device (listed under Play Console Internal Testing Testers). Installing the same APK via ADB after upload still fails — Play Store checks install origin, not build identity. Install via the Play Store link they email you.

### 12.5 Receipts not ready on app open (slow boot)

**Fingerprint:** On cold start, `Purchases.getCustomerInfo()` returns `entitlements.active = {}` even though the user is subscribed. 2–5 seconds later it updates.

**Cause:** The SDK's local receipt cache is initialising async. `addCustomerInfoUpdateListener` will fire when it completes. Code that reads the cache immediately on app open gets the stale (or empty) state.

**Fix:** Treat the pre-init state as "loading", not "not subscribed". The `usePremiumEntitlement` hook in §6.2 uses `isLoading: true` for this window. UI code that gates on Plus should show a spinner (or default to Plus-off, not Plus-on) until `isLoading` resolves. For the app shell that is not itself Plus-gated, render normally and let the hook update once ready.

### 12.6 `Purchases.logIn` race with anonymous purchase

**Fingerprint:** User opens the app for the first time. SDK initialises with an anonymous `app_user_id` (UUID). User immediately taps "Subscribe" on an onboarding paywall — subscribes as anonymous. Then signs up for an account. The subscription is attached to the anonymous ID, not to their real user ID.

**Cause:** `Purchases.configure` runs before auth is known. Anonymous purchases are the normal flow for pre-login paywalls.

**Fix:** RC handles this automatically if you call `Purchases.logIn(user.id)` after auth. The SDK sends an `alias` request that merges the anonymous app_user_id into the real user's RC record. The subscription carries over.

The one case where this fails: the anonymous purchase happened on device A (device-local anonymous ID). The user later signs in on device B (different anonymous ID). Device B's `logIn` cannot alias device A's anonymous ID because RC has no way to know they are the same user. The user must tap "Restore Purchases" on device B.

**Policy:** onboarding paywalls that target anonymous users should either (a) force sign-up before paying, or (b) accept the restore-purchases step as the bridge for multi-device. Acme Shop chose (b) — we allow anonymous paywalls for conversion, and the restore step on device B is a known one-time UX cost.

---

## Section 13: Verification

Pre-RC gates:

```bash
npx tsc --noEmit                                              # type-check
npx eslint . --max-warnings=0                                 # ESLint clean
# Ensure the Purchases import is not bypassing the monetization lib:
grep -rn "from 'react-native-purchases'" src/ \
  | grep -v "features/monetization/" \
  | grep -v "features/auth/useAuthSync.ts" \
  && echo "Rogue Purchases import" && exit 1
eas build --profile preview --platform ios                    # signed binary
```

### 13.1 Sandbox purchase end-to-end

1. On a device signed into a sandbox tester account (see §11.1), install the preview build via TestFlight.
2. Open the app, sign in as a real user, tap "Plus" in settings to open the paywall.
3. Purchase the $4.99 monthly. Confirm native sheet shows `[Sandbox]` in the price.
4. Paywall auto-closes within 2 seconds. `usePremiumEntitlement` returns `{ isActive: true, expiresAt: <~1 month ahead>, isInTrial: false }`.
5. Within ~5 seconds, RC dashboard Events tab shows `INITIAL_PURCHASE` for the test user's `app_user_id`.
6. Within ~10 seconds, the DynamoDB `user-entitlements-preview` table (`aws dynamodb get-item`) shows `plus: true`, `lastEventType: "INITIAL_PURCHASE"`, matching version increment.

### 13.2 Webhook smoke test

In the RC dashboard Webhooks settings, select your endpoint and click **Send test event**. Pick `INITIAL_PURCHASE`. Confirm:

- CloudWatch logs show the Lambda invoked.
- `X-Revenuecat-Signature` passed (no 401 in the response).
- DynamoDB table has a new/updated entitlement item for the test `app_user_id`.
- RC dashboard shows the test event with a 200 response.

Send a second identical test event. Confirm:

- Lambda logs show `skipped: "duplicate"` (idempotency kicked in).
- DynamoDB item did not re-increment `version`.

### 13.3 Restore on reinstall

1. On the sandbox test device, uninstall the app.
2. Reinstall from TestFlight. Sign in as the same user.
3. `usePremiumEntitlement` returns `isActive: true` within ~3 seconds (SDK syncs on first `getCustomerInfo`).
4. Tap Restore Purchases from the subscription screen. Confirm alert says "Subscription active: plus".

### 13.4 Subscription cancellation path

1. In the sandbox Apple ID settings (Settings, App Store, Sandbox Account, Manage), cancel the subscription.
2. Wait ~5 minutes (sandbox renewal cycles are compressed; cancellation fires fast).
3. RC dashboard Events tab shows `CANCELLATION`. `expiresAtMs` is still in the future.
4. DynamoDB entitlement item updates: `lastEventType: "CANCELLATION"`, but `plus: true` (grace period, §11.3).
5. Wait for the compressed sandbox renewal to fire `EXPIRATION` (sandbox monthly renews every 5 min; after the cancel it expires at the next boundary).
6. DynamoDB entitlement item: `plus: false`, `lastEventType: "EXPIRATION"`.
7. Client `usePremiumEntitlement.isActive` flips to `false` on the next `customerInfo` update.

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` §4 (project layout — `src/features/monetization/` lives alongside other features), §7 (EAS profiles that separate sandbox vs production RC keys).
  - `./01-navigation.md` §6 (paywall deep-link — the `/paywall?sku=...` route, `DeepLinkListener` auth guard, `push` vs `replace`).
  - `./03-auth-and-networking.md` §4 (the auth state machine whose `onAuthChange` fans out to `Purchases.logIn` / `logOut` in §5.3 above), §5 (the `apiClient` used by Plus-gated backend endpoints enforcing §10.4).
  - `./04-native-and-release.md` §9 (native-side IAP config — iOS capability, Android `BILLING` permission, App Store Connect / Play Console product creation; this file consumes those).
  - `./08-observability.md` §7.2 (`PaywallViewed` / `SubscriptionStarted` / `SubscriptionCancelled` event taxonomy called from §6.3), §8 (the `useAuthSync` pattern this file extends for `Purchases.logIn`).
  - `./10-gotchas.md` — broader diagnostic catalogue; §12 above is the monetization-specific slice.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — the API Gateway + Lambda + DynamoDB pattern the RC webhook endpoint follows (no Cognito authorizer; HMAC signature verification instead, §9.3).
  - `../../dynamodb-design/references/03-write-correctness.md` §1 — the full `updateWithLock<Entitlement>` optimistic-locking pattern the webhook handler (§9.4) calls. The handler is the skeleton; the write correctness lives there.
- **External documentation:**
  - [RevenueCat React Native SDK docs](https://www.revenuecat.com/docs/getting-started/installation/reactnative) — canonical reference; configure / getOfferings / purchasePackage / restorePurchases signatures.
  - [RevenueCat webhook docs](https://www.revenuecat.com/docs/integrations/webhooks) — full event schema, signature verification, retry behaviour. Re-read on every major RC SDK upgrade.
  - [RevenueCat webhook event types](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) — the authoritative list of `event.type` values; §9.2 above covers the ones Acme Shop handles.
  - [App Store Review Guidelines §3.1](https://developer.apple.com/app-store/review/guidelines/#payments) — the rules for subscriptions, restore, intro offers, and what the reviewer audit actually checks.
  - [Apple — Testing In-App Purchases with Sandbox](https://developer.apple.com/documentation/storekit/in-app_purchase/testing_in-app_purchases_with_sandbox) — the sandbox-tester setup §11.1 defers to.
  - [Google Play — Test subscriptions](https://developer.android.com/google/play/billing/test) — the internal-testing-track requirement §12.4 covers.
  - [react-native-iap docs](https://react-native-iap.dooboolab.com/) — for the "when to pick RNIAP" path (§3.2); the patterns in §§6, 7, 8, 10 apply unchanged.
