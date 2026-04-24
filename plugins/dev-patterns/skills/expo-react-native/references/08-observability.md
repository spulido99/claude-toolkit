# Observability

**Builds:** The observability spine for Acme Shop — `@sentry/react-native` 7 for crash + JS error + performance monitoring wired via its Expo config plugin (`@sentry/react-native/expo`), EAS Build hooks that upload Hermes source maps on every release build so stack traces resolve to `src/...` instead of `index.android.bundle:1:42981`, `posthog-react-native` 4 for product analytics and feature flags from one vendor (chosen over Amplitude / Firebase because it ships feature flags, session replay, and surveys in the same SDK and is open-source), a single `eventNames.ts` constants file that is the only place ad-hoc event strings are allowed to exist, a `beforeSend` hook that redacts PII from every Sentry event before it leaves the device, and an `analytics` facade that calls `identify` / `reset` in lockstep with the auth state from `./03-auth-and-networking.md` §4.
**When to use:** Setting up Sentry on a fresh Expo project, chasing a "stack trace points into minified code" bug, diagnosing "my event is not showing up in PostHog" (see §11.3), adding a new tracked event to an existing flow, writing the `beforeSend` redaction for a new PII field after Legal flags it, configuring release-health gates in CI, deciding whether PostHog / Amplitude / Firebase Analytics is the right choice for your app (§5), or untangling "dev events are polluting my prod dashboard". Read §3 before the first `Sentry.init`; §4 before shipping a release build; §6 before adding the tenth event — the catalog is the difference between a queryable funnel and an unanalyzable pile of strings; §11 whenever something silently stops working.
**Prerequisites:** `./00-architecture.md` (project layout — `src/observability/`, `src/analytics/`, `src/lib/eventNames.ts`; `app.config.ts` for the Sentry plugin block; EAS build profiles), `./03-auth-and-networking.md` §4 (the auth state machine — `onAuthChange` is where `Sentry.setUser` + `posthog.identify` fire; `./03` §5 for the `apiClient` wrapper whose `requestId` we attach as a Sentry tag), `./04-native-and-release.md` §10 (iOS privacy manifests — third-party SDKs must declare their data-collection reasons; §10 covers the mechanics). Required packages: `@sentry/react-native@^7`, `posthog-react-native@^4`, `expo-constants` (for `expoConfig.extra` secrets; already a peer), `react-native-device-info` (optional, for device context — we use it only to tag builds).

> Examples verified against Expo SDK 54 + `@sentry/react-native` 7.6.0 + `posthog-react-native` 4.4.1 + `eas-cli` >= 18.0.0 on 2026-04-23. Re-verify via context7 before porting to a newer SDK — Sentry 7 bundles source-map upload into the `@sentry/react-native/expo` config plugin (v6 and earlier required a manual EAS post-build hook; that hook is documented in §4.2 as a fallback), PostHog v4 split React Navigation auto-capture out of the core package into `posthog-react-native-navigation` (already reflected in §5.3), and `@sentry/react-native` 7's `mobileReplayIntegration` replaces the deprecated `ReactNativeTracing` replay options.

## Contents

1. **What to instrument, and why the split matters** — Sentry for errors + performance + release health; PostHog for product analytics + feature flags. The "one vendor per signal" rule. Why putting analytics events into Sentry breadcrumbs is fine; why putting crash data into PostHog is not.
2. **Project layout** — `src/observability/sentry.ts`, `src/analytics/posthog.ts`, `src/lib/eventNames.ts`, `src/hooks/useAnalytics.ts`. What lives where and why.
3. **Sentry setup — Expo config plugin + `Sentry.init`** — The `@sentry/react-native/expo` plugin in `app.config.ts`, the `Sentry.init` call in `app/_layout.tsx`, the `wrapExpoRouter` integration for automatic navigation spans, `tracesSampleRate` in dev vs prod, session replay with privacy masks.
4. **Source maps — why traces are minified, and how to fix that permanently** — Why Hermes bundles obfuscate stack traces; how the Expo config plugin auto-uploads maps on EAS Build; the post-build hook fallback; how to verify a map uploaded (Sentry CLI + the Release page); the four-symptom table when maps do not resolve.
5. **Privacy scrubbing — `beforeSend` + session-replay masks** — The `beforeSend` hook that redacts `password`, `token`, `authorization`, `email`-looking strings, and the `Cookie` header from every event; session-replay `Mask` wrappers on forms and payment fields; the "redact before sampling" ordering rule.
6. **Analytics vendor choice — PostHog vs Amplitude vs Firebase Analytics** — Decision table; when each wins; why Acme Shop ships PostHog.
7. **Event taxonomy — `noun_verb` and the shared constants file** — The naming rule, the anti-pattern (ad-hoc strings), the `eventNames.ts` file as the single source of truth, the Acme Shop catalogue (`app_opened` through `subscription_started`), and the `trackEvent(name, props)` facade that enforces type-safety.
8. **User identification — `identify` and `reset` in lockstep** — Why logout without `reset` leaks events across accounts on shared devices; the `onAuthChange` pattern from `./03` §4 wired to both Sentry and PostHog; the guest-session strategy for pre-login analytics.
9. **Release health — session tracking + crash-free-user rate** — `autoSessionTracking`, the crash-free-user rate as a release-blocking KPI, the CI gate that refuses to promote a release when crash-free regresses more than 0.5%.
10. **Debug vs production — sampling, gating, and "no dev pollution"** — Disable Sentry + PostHog in `__DEV__`; `tracesSampleRate: 0.1` in prod (not 1.0); environment tags; the two-project strategy (prod + staging) vs single-project with an `environment` tag.
11. **iOS privacy manifests — third-party SDK declarations** — Sentry bundles its `PrivacyInfo.xcprivacy`; PostHog may not; the check-list; cross-link to `./04` §10.
12. **Gotchas (observability-specific)** — Maps uploaded but not resolving, Sentry double-init on fast refresh, analytics events firing in dev, PII leaking into breadcrumbs, PostHog feature flags cached stale on cold start, session-replay masking missing fields.
13. **Verification** — Trigger a test crash in a release build and see it resolve in Sentry; fire `checkout_started` from a Maestro flow and see it land in PostHog with expected properties; grep for ad-hoc event strings.
14. **Further reading** — Pointers into this skill and external canonical docs.

---

## Section 1: What to instrument, and why the split matters

Two signals, two vendors, no overlap:

- **Sentry** — errors, crashes, performance traces, release health, session replay. The questions it answers: "is the app broken?", "how badly?", "on which release?", "for how many users?".
- **PostHog** — product analytics, feature flags, funnels, cohorts, surveys. The questions it answers: "are users reaching checkout?", "does variant B convert better?", "which step of onboarding loses the most users?".

The rule: **one vendor per signal.** Do not ship both Sentry and Datadog for errors — you will get double-billed, double-instrumented, and the two dashboards will disagree on crash counts. Do not ship PostHog and Amplitude for analytics — you will have two event catalogues that drift and the business will ask which is right.

There is one crossover that is fine and one that is not:

- **Fine:** Analytics events as Sentry breadcrumbs. Sentry automatically records PostHog `capture` calls as breadcrumbs if you call them before an error; this gives you "what was the user doing when it crashed" for free. You do not duplicate data, you enrich the error.
- **Not fine:** Crash data in PostHog. PostHog is not an error tracker; it has no symbolication, no grouping, no release health. Sending `app_crashed` as a PostHog event buys you nothing you do not already have in Sentry and pollutes your funnels.

Acme Shop ships **Sentry + PostHog** and nothing else in the observability slot. Everything in this reference assumes that pair.

---

## Section 2: Project layout

```
src/
  observability/
    sentry.ts               // Sentry.init + beforeSend scrubber
    sentry-wrapper.tsx      // <SentryRouterProvider /> — wraps expo-router
  analytics/
    posthog.ts              // PostHog client instance + analytics facade
    posthog-provider.tsx    // <PostHogProvider /> for the app tree
  hooks/
    useAnalytics.ts         // useAnalytics() — typed wrapper over posthog
  lib/
    eventNames.ts           // THE ONLY PLACE event strings live
    scrub.ts                // scrubPII() — shared between Sentry + logs
  features/
    auth/
      useAuthSync.ts        // wires auth state to Sentry.setUser + posthog.identify
app/
  _layout.tsx               // calls initSentry() + wraps tree in PostHogProvider
```

Three invariants:

1. **`eventNames.ts` is imported by every `capture` call.** No string literals in feature code.
2. **`scrub.ts` is imported by the `beforeSend` hook and by any logger.** PII rules live in one place.
3. **`useAnalytics.ts` is the only way feature code calls PostHog.** Direct `posthog.capture(...)` calls are banned by an ESLint rule (shown in §7.4).

Without these three, you get drift — a button reports `"purchase-start"`, a sibling reports `"start_purchase"`, and the funnel looks wrong for a week until someone notices.

---

## Section 3: Sentry setup — Expo config plugin + `Sentry.init`

Two steps: the config plugin in `app.config.ts` (wires native SDKs + source-map upload), and the `Sentry.init` call in `app/_layout.tsx` (wires the JS runtime).

### 3.1 The config plugin

```ts
// app.config.ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Acme Shop",
  slug: "acme-shop",
  runtimeVersion: { policy: "appVersion" },
  updates: { url: "https://u.expo.dev/<project-id>" },
  plugins: [
    "expo-router",
    [
      "@sentry/react-native/expo",
      {
        organization: "acme-inc",
        project: "acme-shop-mobile",
        // SENTRY_AUTH_TOKEN is injected by EAS — see §4.1 for EAS secrets setup.
        // Never commit this token; the plugin reads it from env at build time.
        url: "https://sentry.io/",
      },
    ],
  ],
  ios: { bundleIdentifier: "com.acme.shop" },
  android: { package: "com.acme.shop" },
};

export default config;
```

What the plugin does, in order:

1. Adds `@sentry/react-native`'s native iOS + Android SDK dependencies to the generated `Podfile` / Gradle config.
2. Injects a `sentry.properties` file into `ios/` and `android/` pointing at your org + project.
3. Registers a **Metro source-map transformer** that, during EAS Build, runs `sentry-cli sourcemaps upload` after the JS bundle is produced. You do not write an EAS post-build hook for this — the plugin owns it.
4. Auto-detects the `release` name from `expo-application` (`${bundleIdentifier}@${version}+${buildNumber}`). This is the string Sentry matches against uploaded maps.

If you come from `@sentry/react-native` v6, you may remember a manual EAS `postBuild` hook. **You do not need it on v7.** §4.2 documents the fallback hook for the rare case the plugin upload fails, but the default path is "add the plugin and stop thinking about it."

### 3.2 `Sentry.init` in `app/_layout.tsx`

```ts
// app/_layout.tsx
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Slot, useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";

import { scrubPII } from "@/lib/scrub";
import { PostHogRoot } from "@/analytics/posthog-provider";
import { initAnalytics } from "@/analytics/posthog";
import { useAuthSync } from "@/features/auth/useAuthSync";

const SENTRY_DSN = Constants.expoConfig?.extra?.sentryDsn as string | undefined;

if (!__DEV__ && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: Constants.expoConfig?.extra?.env ?? "production", // "staging" | "production"
    release: `${Constants.expoConfig?.ios?.bundleIdentifier}@${Constants.expoConfig?.version}`,
    // Performance: sample 10% of traces in prod. 1.0 is dev-only — it floods the quota.
    tracesSampleRate: 0.1,
    // Session replay: record 10% of sessions, 100% when an error fires.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Profiling: 50% of sampled traces get CPU profiles.
    profilesSampleRate: 0.5,
    // Automatic integrations.
    enableAutoPerformanceTracing: true,
    enableNativeCrashHandling: true,
    attachScreenshot: true,
    integrations: [
      Sentry.mobileReplayIntegration({
        maskAllText: true, // default; errs on the side of privacy
        maskAllImages: true,
        maskAllVectors: false,
      }),
    ],
    // The scrubber. See §5.
    beforeSend: (event, hint) => scrubPII(event),
    beforeBreadcrumb: (breadcrumb) => {
      // Drop breadcrumbs with raw request bodies — they often contain tokens.
      if (breadcrumb.category === "xhr" && breadcrumb.data?.["body"]) {
        delete breadcrumb.data["body"];
      }
      return breadcrumb;
    },
    debug: false, // never true in prod; noisy logs in release builds
  });
}

// Top-level component wrapped with Sentry's HOC so crashes inside React render
// are captured with a component stack.
function RootLayout() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    initAnalytics(); // PostHog — see §6
  }, []);

  useEffect(() => {
    if (navigationRef) {
      // Registers navigation container so Sentry emits span per route change.
      Sentry.reactNavigationIntegration().registerNavigationContainer(navigationRef);
    }
  }, [navigationRef]);

  useAuthSync(); // wires identify / reset — see §8

  return (
    <PostHogRoot>
      <Slot />
    </PostHogRoot>
  );
}

export default Sentry.wrap(RootLayout);
```

Three non-obvious choices:

- **`if (!__DEV__)`** — We do not init Sentry in dev. Dev crashes are already loud in the Metro terminal, and shipping dev events to Sentry pollutes the dashboard and wastes the event quota. §10 expands on the dev-vs-prod split.
- **`tracesSampleRate: 0.1`** — Performance traces are expensive. 1.0 in prod at Acme Shop's traffic would cost more than the rest of the observability stack combined. 0.1 is the floor that keeps statistical usefulness for p50 / p95 latency.
- **`Sentry.wrap(RootLayout)`** — The HOC wraps the root in an `ErrorBoundary` that captures React-tree crashes with component stack. `wrap` is new in v7; v6's equivalent was `Sentry.ErrorBoundary`.

### 3.3 Session replay — privacy first, not feature-first

Session replay records the user's screen as a stream of frame deltas. It is the highest-signal signal Sentry ships — you see exactly what the user saw before the crash — and the single biggest privacy risk if misconfigured.

**The default stance in this setup is "mask everything."** `maskAllText: true` redacts every `<Text>` to a solid block. `maskAllImages: true` redacts every `<Image>`. You then selectively unmask non-sensitive surfaces (a logo, an icon, a public product name) with `<Sentry.Unmask>`:

```tsx
import * as Sentry from "@sentry/react-native";

function ProductCard({ product }: { product: Product }) {
  return (
    <View>
      <Sentry.Unmask>
        <Text style={styles.name}>{product.name}</Text>
      </Sentry.Unmask>
      {/* price stays masked — we consider it user-contextual */}
      <Text style={styles.price}>{formatPrice(product.price)}</Text>
    </View>
  );
}
```

And you explicitly re-mask sensitive surfaces that default masking would not catch (a `<TextInput secureTextEntry>` is auto-masked; a third-party WebView is not):

```tsx
<Sentry.Mask>
  <WebView source={{ uri: paymentUrl }} />
</Sentry.Mask>
```

**Do not enable session replay until Legal has signed off on the masking defaults.** Shipping a replay session that captures a credit-card form un-masked is a GDPR / PCI incident, not a bug.

---

## Section 4: Source maps — why traces are minified, and how to fix that permanently

When you ship an Expo release build, the JS runs from a **Hermes bytecode bundle** (`main.jsbundle` → `.hbc`). Stack traces from that bundle look like:

```
TypeError: undefined is not an object (evaluating 't.items[0].price')
  at index.android.bundle:1:42981
  at index.android.bundle:1:38814
```

Useless. No function names, no file paths, no line numbers that map to your source. To resolve these to `src/features/cart/useCart.ts:42`, Sentry needs the **source map** that was generated alongside the Hermes bundle and **uploaded to Sentry's backend** keyed by the release string in `Sentry.init`.

### 4.1 The happy path — Expo config plugin auto-upload

With `@sentry/react-native` v7 and the Expo config plugin (§3.1), source-map upload runs automatically on every EAS Build. The flow:

1. EAS Build builds your app.
2. The Metro transformer the plugin registered emits the source map alongside the bundle.
3. A post-bundle hook the plugin installed calls `npx sentry-cli sourcemaps upload --release=<auto-detected>`.
4. The upload includes the `debugId` Sentry embedded in both the bundle and the map, so they pair correctly regardless of the release string.

What you have to configure:

- **`SENTRY_AUTH_TOKEN` as an EAS secret.** Create an internal integration token in Sentry (Settings → Integrations → Auth Tokens, scope: `project:releases`, `project:write`), then:

  ```bash
  eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value "sntrys_..."
  ```

- **`SENTRY_ORG` and `SENTRY_PROJECT`** — baked into `app.config.ts` (§3.1) as `organization` / `project`, so you do not need them as secrets.

That is the whole setup. Build once, check the Sentry release page, and confirm the source map shows up under "Artifacts". If it does, you are done.

### 4.2 The fallback — manual post-build hook

If you are on `@sentry/react-native` v6, or you need to decouple upload from build (e.g., you build off-EAS), wire a post-build hook in `eas.json`:

```json
{
  "build": {
    "production": {
      "env": { "SENTRY_ORG": "acme-inc", "SENTRY_PROJECT": "acme-shop-mobile" },
      "ios": { "image": "latest" },
      "android": { "image": "latest" },
      "hooks": {
        "postBuild": "node scripts/upload-sentry-sourcemaps.js"
      }
    }
  }
}
```

```js
// scripts/upload-sentry-sourcemaps.js
// Fallback: runs after EAS builds the bundle and source maps.
// Only needed when the Expo config plugin is NOT in use (v6 or bare workflow).
// Uses execFileSync with an array arg list (no shell, no injection surface).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const platform = process.env.EAS_BUILD_PLATFORM; // "ios" | "android"
const slug = process.env.EAS_BUILD_PROJECT_SLUG ?? "acme-shop";
const version = process.env.EAS_BUILD_APP_VERSION ?? "0.0.0";
const release = `${slug}@${version}`;

const workdir = process.env.EAS_BUILD_WORKINGDIR ?? process.cwd();
const bundlePath = platform === "ios"
  ? path.resolve(workdir, "ios/main.jsbundle")
  : path.resolve(workdir, "android/app/src/main/assets/index.android.bundle");
const mapPath = `${bundlePath}.map`;

function run(args) {
  execFileSync("npx", ["sentry-cli", ...args], { stdio: "inherit", env: process.env });
}

run(["releases", "new", release]);
run([
  "sourcemaps", "upload",
  "--release", release,
  "--bundle", bundlePath,
  "--bundle-sourcemap", mapPath,
]);
run(["releases", "finalize", release]);
```

Prefer the plugin over this script. The script is here for when the plugin is not an option.

### 4.3 Verifying the map uploaded

On a release build, trigger a test error:

```ts
import * as Sentry from "@sentry/react-native";

function DebugTriggerScreen() {
  return (
    <Button
      title="Throw"
      onPress={() => {
        throw new Error(`sentry source-map smoke test ${Date.now()}`);
      }}
    />
  );
}
```

Then in the Sentry UI → Issues → click the issue → the "In App" frames should show `src/...` paths with function names. If they show `index.android.bundle:1:42981`, the map did not pair. See §12.1.

---

## Section 5: Privacy scrubbing — `beforeSend` + session-replay masks

`beforeSend` is the last line of defence before an event leaves the device. It runs on every Sentry payload (errors, performance traces, transactions) and returns either a modified event or `null` to drop.

### 5.1 The scrubber

```ts
// src/lib/scrub.ts
import type { ErrorEvent } from "@sentry/react-native";

// Field names we consider sensitive. Keys matching (case-insensitive, full or
// substring) are redacted to "[REDACTED]".
const SENSITIVE_KEYS = /^(password|passwd|pwd|token|api[_-]?key|auth(?:orization)?|cookie|ssn|credit[_-]?card|cc[_-]?number|cvv)$/i;

// Patterns that look like PII even when the key is innocuous.
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._-]+/gi;

function redactString(value: string): string {
  return value
    .replace(EMAIL, "[email-redacted]")
    .replace(JWT, "[jwt-redacted]")
    .replace(BEARER, "Bearer [token-redacted]");
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redactDeep(v);
    }
    return out;
  }
  return value;
}

export function scrubPII(event: ErrorEvent): ErrorEvent {
  // Strip Authorization + Cookie from request headers.
  if (event.request?.headers) {
    for (const k of Object.keys(event.request.headers)) {
      if (SENSITIVE_KEYS.test(k)) {
        event.request.headers[k] = "[REDACTED]";
      }
    }
  }

  // Scrub free-form strings in exception messages and breadcrumb messages.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = redactString(ex.value);
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      message: b.message ? redactString(b.message) : b.message,
      data: b.data ? (redactDeep(b.data) as typeof b.data) : b.data,
    }));
  }

  // Scrub extra / contexts — they are developer-attached and often include payloads.
  if (event.extra) event.extra = redactDeep(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = redactDeep(event.contexts) as typeof event.contexts;

  return event;
}
```

Test it before relying on it:

```ts
// scrub.test.ts
import { scrubPII } from "./scrub";

describe("scrubPII", () => {
  it("redacts Authorization header", () => {
    const event = { request: { headers: { Authorization: "Bearer abc.def.ghi" } } };
    expect(scrubPII(event as any).request!.headers!.Authorization).toBe("[REDACTED]");
  });

  it("redacts email in exception message", () => {
    const event = { exception: { values: [{ value: "user alice@acme.com failed to log in" }] } };
    expect(scrubPII(event as any).exception!.values![0]!.value).toBe("user [email-redacted] failed to log in");
  });

  it("redacts JWT in breadcrumb data", () => {
    const event = { breadcrumbs: [{ message: "req", data: { auth: "eyJhbGciOiJI.eyJzdWI.SflKxwRJ" } }] };
    expect((scrubPII(event as any).breadcrumbs![0]!.data!.auth as string)).toBe("[jwt-redacted]");
  });
});
```

### 5.2 Ordering — redact before sampling

`beforeSend` runs **before** `tracesSampleRate` is applied to a transaction event. If you put a `return null` for "drop high-volume route traces" inside `beforeSend`, you pay the scrub cost on events that Sentry would have dropped anyway. Move rate-based drops to `tracesSampler` (a separate option) so `beforeSend` stays cheap and scrub-only.

### 5.3 Session replay masks

§3.3 already covered this: `maskAllText` + `maskAllImages` are your defaults, `<Sentry.Unmask>` is explicit opt-out, `<Sentry.Mask>` is explicit opt-in for things the defaults do not catch (WebViews, third-party map tiles, animated SVGs).

---

## Section 6: Analytics vendor choice — PostHog vs Amplitude vs Firebase Analytics

| Need | PostHog | Amplitude | Firebase Analytics |
|------|---------|-----------|--------------------|
| **Product analytics** | Yes | Yes (category leader) | Yes (Google-flavoured) |
| **Feature flags in the same SDK** | Yes | Separate product (Experiment) | Separate (Remote Config) |
| **Session replay in the same SDK** | Yes | Separate tier | No |
| **Self-hostable** | Yes (free OSS) | No | No |
| **Free tier** | 1M events/mo | 10M events/mo (but surveys + flags extra) | Unlimited (but sampled + Google-only) |
| **SQL export / own your data** | Yes (ClickHouse) | Paid tier | BigQuery export (paid) |
| **iOS privacy manifest bundled** | Partial — verify per SDK version (§11) | Yes | Yes (Google ships it) |
| **Best fit** | Startups, privacy-first, "I want one SDK" | Large orgs with analytics team, need category-leading cohort tooling | Apps already deep in the Google ecosystem (Firebase Auth, FCM, Crashlytics) |

**Acme Shop ships PostHog.** The tie-breaker is feature flags + analytics in one SDK. Adding a separate SDK per concern doubles the privacy-manifest work, doubles the initialisation code, and doubles the number of places a consent framework has to check.

If your org has a mature analytics team on Amplitude, use Amplitude — the tooling is genuinely better. If your app is already on Firebase for push + auth, use Firebase Analytics — one SDK family is worth the Google lock-in.

The rest of this reference assumes PostHog. §7 and §8 apply identically to any of the three — the only thing that changes is the import.

---

## Section 7: Event taxonomy — `noun_verb` and the shared constants file

### 7.1 The naming rule

**`noun_verb`**, lowercase, underscore-separated. The noun comes first because dashboards group by prefix — `cart_*` clusters all cart events together when you filter by event name.

| Do | Do not |
|----|--------|
| `cart_item_added` | `addedItemToCart` |
| `checkout_started` | `start-checkout` |
| `paywall_viewed` | `paywall_impression` (ambiguous verb) |
| `order_placed` | `purchase` (too generic; which product?) |
| `sign_in_succeeded` | `login` (succeeded vs attempted is load-bearing) |

Every event has a past-tense verb. The event records a thing that happened; future-tense ("will_start") is not a thing to track.

### 7.2 The `eventNames.ts` file

```ts
// src/lib/eventNames.ts
// The ONLY place event strings are allowed to exist.
// If you need a new event, add it here first, then import it.
// An ESLint rule (§7.4) bans string literals at call sites.

export const EventNames = {
  // App lifecycle
  AppOpened: "app_opened",
  AppBackgrounded: "app_backgrounded",

  // Auth
  SignInSucceeded: "sign_in_succeeded",
  SignInFailed: "sign_in_failed",
  SignOut: "sign_out",

  // Catalog
  ProductViewed: "product_viewed",
  ProductSearched: "product_searched",

  // Cart
  CartItemAdded: "cart_item_added",
  CartItemRemoved: "cart_item_removed",
  CartViewed: "cart_viewed",

  // Checkout
  CheckoutStarted: "checkout_started",
  CheckoutCompleted: "checkout_completed",
  OrderPlaced: "order_placed",

  // Monetization (see ./09-monetization.md for the paywall flow)
  PaywallViewed: "paywall_viewed",
  SubscriptionStarted: "subscription_started",
  SubscriptionCancelled: "subscription_cancelled",
} as const;

// Typed property contracts per event. Discriminated union over name.
// The `trackEvent` facade (§7.3) enforces these at the call site.
export type EventProps =
  | { name: typeof EventNames.AppOpened; props: { cold_start: boolean } }
  | { name: typeof EventNames.AppBackgrounded; props: Record<string, never> }
  | { name: typeof EventNames.SignInSucceeded; props: { method: "email" | "apple" | "google" } }
  | { name: typeof EventNames.SignInFailed; props: { method: "email" | "apple" | "google"; reason: string } }
  | { name: typeof EventNames.SignOut; props: Record<string, never> }
  | { name: typeof EventNames.ProductViewed; props: { product_id: string; category: string; price_minor: number; currency: string } }
  | { name: typeof EventNames.ProductSearched; props: { query: string; result_count: number } }
  | { name: typeof EventNames.CartItemAdded; props: { product_id: string; quantity: number; price_minor: number; currency: string } }
  | { name: typeof EventNames.CartItemRemoved; props: { product_id: string; quantity: number } }
  | { name: typeof EventNames.CartViewed; props: { item_count: number; subtotal_minor: number; currency: string } }
  | { name: typeof EventNames.CheckoutStarted; props: { cart_value_minor: number; currency: string; item_count: number } }
  | { name: typeof EventNames.CheckoutCompleted; props: { order_id: string; cart_value_minor: number; currency: string } }
  | { name: typeof EventNames.OrderPlaced; props: { order_id: string; payment_method: "card" | "apple_pay" | "google_pay" } }
  | { name: typeof EventNames.PaywallViewed; props: { surface: "onboarding" | "post_purchase" | "settings"; variant: string } }
  | { name: typeof EventNames.SubscriptionStarted; props: { plan_id: string; price_minor: number; currency: string; trial_days: number } }
  | { name: typeof EventNames.SubscriptionCancelled; props: { plan_id: string; reason?: string } };
```

The shape — `product_id` not `productId`, `cart_value_minor` not `cartValue`, `price_minor` in integer minor units with a separate `currency` string — is the taxonomy the data team queries against. It matches the API contract in `../../aws-cdk-patterns/references/01-serverless-api.md`, so events line up with the backend's own logs when you join across both.

### 7.3 The `trackEvent` facade

```ts
// src/hooks/useAnalytics.ts
import { useCallback } from "react";
import { posthog } from "@/analytics/posthog";
import type { EventProps } from "@/lib/eventNames";

export function useAnalytics() {
  // Typed capture: TypeScript narrows `props` by `name`.
  const track = useCallback(<N extends EventProps["name"]>(
    name: N,
    props: Extract<EventProps, { name: N }>["props"],
  ) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[analytics] ${name}`, props);
      return;
    }
    posthog?.capture(name, props);
  }, []);

  return { track };
}
```

Call site:

```tsx
// src/features/cart/useAddToCart.ts
import { EventNames } from "@/lib/eventNames";
import { useAnalytics } from "@/hooks/useAnalytics";

export function useAddToCart() {
  const { track } = useAnalytics();

  return (product: Product, quantity: number) => {
    // business logic ...
    track(EventNames.CartItemAdded, {
      product_id: product.id,
      quantity,
      price_minor: product.priceMinor,
      currency: product.currency,
    });
  };
}
```

If you misspell a property, TypeScript errors at compile time. If you pass `price: 12.99` instead of `price_minor: 1299`, TypeScript errors. The taxonomy is unbypassable.

### 7.4 The ESLint rule that enforces it

```js
// eslint.config.js — excerpt
{
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        // Ban posthog.capture("literal-string", ...). Force the constant.
        selector: "CallExpression[callee.object.name='posthog'][callee.property.name='capture'] > Literal:first-child",
        message: "Event names must come from src/lib/eventNames.ts. Do not pass a string literal to posthog.capture().",
      },
    ],
  },
}
```

This is the rule that keeps the taxonomy honest during code review fatigue. Without it, six months from now someone will ship `posthog.capture("purchase_start")` at 2am and break the funnel for a week.

---

## Section 8: User identification — `identify` and `reset` in lockstep

Analytics without identity is a firehose of anonymous events. Analytics with wrong identity is a privacy incident.

The rule: **every auth state transition triggers both Sentry and PostHog, in the same hook, atomically.**

```ts
// src/features/auth/useAuthSync.ts
import * as Sentry from "@sentry/react-native";
import { useEffect } from "react";

import { posthog } from "@/analytics/posthog";
import { useAuth } from "./useAuth"; // see ./03-auth-and-networking.md §4

export function useAuthSync() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === "authenticated" && user) {
      // Sentry: attach user to every subsequent event.
      // IMPORTANT: do NOT attach email — that violates the scrub rules in §5.
      Sentry.setUser({ id: user.id });

      // PostHog: merge anonymous events into this user id.
      // $set captures user traits. Email is OK here ONLY because PostHog is
      // where marketing CRM data lives; keep it out of Sentry.
      posthog?.identify(user.id, {
        email: user.email,
        plan: user.plan,
        created_at: user.createdAt,
      });
    } else if (status === "unauthenticated") {
      // Sign-out: clear BOTH. Shared devices are why this matters —
      // without reset(), user B's events get attributed to user A.
      Sentry.setUser(null);
      posthog?.reset();
    }
  }, [status, user]);
}
```

Two rules you cannot break:

1. **Never attach email to Sentry.** Emails end up in stack-trace bodies, breadcrumbs, and extras. Sentry's access model is "every engineer with Sentry access can read any event". PostHog's is "everyone with PostHog access is explicitly a marketing / product persona". Separate them.
2. **Always call `posthog.reset()` on sign-out.** Not just on session expiry — on any transition back to unauthenticated. Without it, the next sign-in merges two users' histories, and PostHog has no "un-merge" operation. This is a permanent data integrity bug.

Pre-login, PostHog already tracks the user via an **anonymous distinct ID** (a UUID generated and stored locally on first SDK init). When `identify(userId)` fires, PostHog aliases the anonymous ID to the real ID and all pre-login events retroactively attribute to the user. That is the behaviour you want; do not try to defer analytics until after login.

---

## Section 9: Release health — session tracking + crash-free-user rate

Sentry's release-health feature tracks **sessions**: a session starts when the app opens, ends when it backgrounds for more than 30 seconds. A session is **crashed** if a native crash or unhandled JS error occurred during it. The metric the team cares about is the **crash-free-user rate** — the percentage of users in a release who did not experience a crash.

### 9.1 Enabling session tracking

```ts
Sentry.init({
  // ...
  autoSessionTracking: true, // default in v7, but make it explicit
  // How long the app can be backgrounded before the session ends (default: 30_000 ms).
  sessionTrackingIntervalMillis: 30_000,
});
```

The SDK starts a session on init, ends it on background, and starts a new one on foreground beyond the interval. You do not call `Sentry.startSession` manually on a mobile app — the SDK handles it.

### 9.2 Crash-free-user rate as a release gate

In `Settings → Releases → Release Health Thresholds`, set:

- **Unhealthy release:** crash-free users < 98.0%.
- **Critical release:** crash-free users < 97.0%.

Pair that with a CI gate that refuses to promote a release from `staging` to `production` if the staging crash-free rate regressed by > 0.5% against the last promoted release. The check is a Sentry API call from your promotion pipeline:

```bash
# In your "promote to prod" GitHub Actions job:
CRASH_FREE=$(npx sentry-cli releases info "acme-shop@1.12.0" --json | jq '.crashFreeUsers')
if (( $(echo "$CRASH_FREE < 97.5" | bc -l) )); then
  echo "Crash-free users at ${CRASH_FREE}%, below 97.5% threshold. Blocking promotion."
  exit 1
fi
```

This gate caught two regressions at Acme Shop in the last quarter — one config-plugin ordering bug, one third-party SDK that crashed on Android 11. Both would have shipped without it.

---

## Section 10: Debug vs production — sampling, gating, and "no dev pollution"

### 10.1 The four rules

1. **Sentry off in `__DEV__`.** `if (!__DEV__) Sentry.init(...)` in `app/_layout.tsx`. Dev crashes are already loud; shipping them to Sentry burns quota and pollutes issue stats.
2. **PostHog off in `__DEV__`.** Same reason. The `useAnalytics` hook in §7.3 already guards with `if (__DEV__) console.log; return;`.
3. **`tracesSampleRate: 0.1` in prod.** Not 1.0. Performance events at 1.0 for a consumer app with 100k DAU costs more than the Sentry plan itself.
4. **`environment` tag per build profile.** `development` / `preview` / `production` — set via `Constants.expoConfig?.extra?.env`, fed from `eas.json`:

```json
// eas.json
{
  "build": {
    "preview": { "env": { "APP_ENV": "staging" } },
    "production": { "env": { "APP_ENV": "production" } }
  }
}
```

```ts
// app.config.ts
export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,
  extra: {
    env: process.env.APP_ENV ?? "development",
    sentryDsn: process.env.SENTRY_DSN,
    posthogKey: process.env.POSTHOG_KEY,
  },
});
```

With `environment` tagged, staging and production events go to the same Sentry project but filter independently. One project is easier to administer than two; staging-vs-prod separation is a filter, not an infra concern.

### 10.2 Feature-flag pre-fetch (PostHog gotcha)

PostHog caches feature-flag evaluations on disk. If the app launches offline, `posthog.isFeatureEnabled("new-checkout")` returns the cached value from the last online launch — which may be days stale. For flags that gate UX (not payments), this is the right trade-off. For flags that gate payment flows or terms-of-service surfaces, force a fresh fetch on cold start and block on it up to a timeout:

```ts
import PostHog from "posthog-react-native";

export async function initAnalytics() {
  const client = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_KEY!, {
    host: "https://us.i.posthog.com",
    // Force flag reload on init. Default is true, but make it explicit.
    preloadFeatureFlags: true,
    // Flush events on these thresholds.
    flushAt: 20,
    flushInterval: 10_000,
  });

  // Wait up to 2s for fresh flags; fall back to cached otherwise.
  await Promise.race([
    client.reloadFeatureFlagsAsync(),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);

  return client;
}
```

---

## Section 11: iOS privacy manifests — third-party SDK declarations

iOS 17+ requires a `PrivacyInfo.xcprivacy` in every app that enumerates:

1. Data types collected by the app.
2. "Required Reason APIs" used (e.g., `UserDefaults`, `FileSystem.ModificationDate`).
3. A separate manifest bundled per SDK that collects data.

The mechanics of writing and merging manifests live in `./04-native-and-release.md` §10. The observability-specific part is:

- **Sentry bundles its own `PrivacyInfo.xcprivacy`** (v7+). No action needed.
- **PostHog** — as of `posthog-react-native` 4.4.1, the SDK bundles a manifest. Verify on the version you install, e.g. via `npm ls posthog-react-native` + listing files under `node_modules/posthog-react-native/ios/`. If it is missing, you must add one covering: `NSPrivacyCollectedDataType{Identifiers.UserID, Analytics.ProductInteraction, OtherDiagnosticData}` and `NSPrivacyAccessedAPICategoryUserDefaults` (reason code `CA92.1`). `./04` §10 covers the XML shape.
- **Amplitude / Firebase Analytics** — both bundle their manifests as of their 2025+ versions.

One App Store rejection we have seen: a team shipped an older `posthog-react-native` without a bundled manifest, did not add one themselves, and the build bounced on submission with ITMS-91053 ("missing privacy manifest for SDK"). The fix is five minutes once you know to look. The diagnosis, without this checklist, is two hours.

---

## Section 12: Gotchas (observability-specific)

### 12.1 Source maps uploaded but not resolving

**Fingerprint:** Release crash in Sentry shows `index.android.bundle:1:42981` instead of `src/features/cart/useCart.ts:42`. The Sentry release page shows the map is uploaded.

**Cause (most common):** The `release` string in `Sentry.init` does not match the release the map was uploaded against. The Expo config plugin auto-detects the release; your manual `Sentry.init` then overwrote it with a different string.

**Fix:** Either drop the `release:` line from `Sentry.init` and trust the plugin, or make sure both match exactly. The format the plugin uses is `${bundleIdentifier}@${version}+${buildNumber}`.

**Cause (second):** `debugId` mismatch — the bundle and the map have different embedded IDs. Happens when you regenerate the bundle without re-uploading the map, or when a watch-mode dev server stale-caches a bundle. Clean build: `eas build --clear-cache`.

### 12.2 Sentry double-init on fast refresh

**Fingerprint:** In dev, errors show up twice in the Metro console. In prod, they show up once.

**Cause:** `Sentry.init` gets called on every fast refresh because `app/_layout.tsx` re-evaluates. Not actually a bug in prod (which does not fast-refresh), but annoying in dev.

**Fix:** Guard with `if (!__DEV__) Sentry.init(...)` (already done in §3.2). This is the other half of the "no Sentry in dev" rule.

### 12.3 Analytics events firing in dev

**Fingerprint:** PostHog dashboard shows 20× more `cart_item_added` events than users. Digging in, half of them are from `<your-laptop-hostname>` on the `development` environment.

**Cause:** `useAnalytics` hook was updated to always call `posthog?.capture`, losing the `__DEV__` guard.

**Fix:** The guard in §7.3 is load-bearing. A unit test on `useAnalytics` should assert `posthog.capture` is not called when `__DEV__` is true.

### 12.4 PII leaking into breadcrumbs

**Fingerprint:** A Sentry crash report contains a breadcrumb like `POST /auth/login — body: {"email":"alice@acme.com","password":"hunter2"}`.

**Cause:** The SDK's default XHR breadcrumb captures request bodies. `beforeSend` scrubs, but breadcrumbs pass through `beforeBreadcrumb` first.

**Fix:** The `beforeBreadcrumb` filter in §3.2 strips `data.body` from XHR breadcrumbs. Add it.

### 12.5 PostHog feature flags cached stale on cold start

**Fingerprint:** A feature flag flip in the PostHog dashboard takes 24 hours to propagate to users.

**Cause:** PostHog caches flag evaluations on disk and uses the cache on cold start before (or instead of) hitting the network. The `reloadFeatureFlagsAsync` call is missing.

**Fix:** `await client.reloadFeatureFlagsAsync()` on init, with a `Promise.race` timeout so it never blocks startup for more than 2s. §10.2.

### 12.6 Session-replay masking missing on a WebView

**Fingerprint:** Session replay shows the user typing a credit-card number into an embedded payment WebView. The default `maskAllText` does not mask WebView internals because the SDK does not walk the WebView's DOM.

**Cause:** `maskAllText` masks React Native `<Text>` nodes. A WebView renders HTML, which is outside the SDK's tree.

**Fix:** Wrap the WebView in `<Sentry.Mask>` (§3.3). Treat every WebView as sensitive until proven otherwise.

---

## Section 13: Verification

Pre-RC gates:

```bash
npx tsc --noEmit                                     # type-check (catches taxonomy errors)
npx eslint . --max-warnings=0                        # catches no-restricted-syntax violations
grep -r "posthog.capture(\"" src/ && exit 1          # catches bypasses of eventNames.ts
npm test -- src/lib/scrub.test.ts                    # scrub rules pass
eas build --profile preview --platform ios           # build a real binary
```

### 13.1 End-to-end smoke

1. Install the preview build on a physical device (simulator does not have APNS, which breaks some Sentry native init paths).
2. Trigger a test crash:

   ```tsx
   <Button title="Debug crash" onPress={() => { throw new Error(`release smoke ${Date.now()}`); }} />
   ```

3. Within ~30 seconds, Sentry → Issues → the issue appears with resolved frames (`src/...`), user id attached, `environment: staging`.
4. Perform the happy-path checkout flow in the preview build.
5. PostHog → Activity → events appear: `app_opened`, `product_viewed`, `cart_item_added`, `checkout_started`, `checkout_completed`. Each has the properties from §7.2 populated.
6. Sign out, sign in as a different user, add to cart. Confirm in PostHog the events attribute to the second user (no cross-contamination from §8 — this is the `reset()` gate).

### 13.2 Release health gate

After a staging bake period of 48 hours:

```bash
npx sentry-cli releases info "com.acme.shop@1.12.0+112" --json | jq '.crashFreeUsers'
# expect >= 99.0%
```

Below 98.0% — block the promotion. Diagnose in Sentry → Issues sorted by "Users Affected".

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` §4 (project layout for `src/observability/` + `src/analytics/`), §7 (EAS profiles that feed `environment` + secrets).
  - `./03-auth-and-networking.md` §4 (the auth state machine `useAuthSync` hooks into), §5 (the `apiClient` whose `requestId` we attach as a Sentry tag).
  - `./04-native-and-release.md` §10 (iOS privacy manifests — the mechanical XML shape this reference defers to).
  - `./09-monetization.md` — paywall + subscription events (`PaywallViewed`, `SubscriptionStarted`) are declared here; the purchase flow lives there.
  - `./10-gotchas.md` — broader diagnostic catalogue; §12 above is the observability-specific slice.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — the backend whose `requestId` matches the Sentry tag. Joining crash reports to API logs goes through this ID.
- **External documentation:**
  - [Sentry React Native docs](https://docs.sentry.io/platforms/react-native/) — canonical reference; §Session Replay + §Source Maps are the two pages to re-read on every SDK upgrade.
  - [Sentry + Expo integration guide](https://docs.sentry.io/platforms/react-native/manual-setup/expo/) — the config-plugin flow; updated on every Expo SDK release.
  - [Sentry `beforeSend` + data scrubbing](https://docs.sentry.io/platforms/react-native/data-management/sensitive-data/) — additional patterns (server-side scrubbing, relay rules) for defence in depth.
  - [PostHog React Native docs](https://posthog.com/docs/libraries/react-native) — SDK reference; `identify` / `reset` / `capture` signatures.
  - [PostHog feature-flag best practices](https://posthog.com/docs/feature-flags/best-practices) — the bootstrap + reload patterns §10.2 is based on.
  - [Apple — Required Reason API list](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api) — the authoritative list of what a privacy manifest must declare.
  - [Amplitude React Native SDK](https://amplitude.com/docs/sdks/analytics/react-native) — for apps that chose Amplitude; the taxonomy and identify / reset patterns in §7 + §8 apply unchanged.
  - [Firebase Analytics for React Native](https://rnfirebase.io/analytics/usage) — for apps that chose Firebase; same applicability.
