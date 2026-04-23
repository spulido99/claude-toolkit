# Native and release

**Builds:** Everything that lives below the JS runtime for Acme Shop — config plugins that patch `Info.plist` / `AndroidManifest.xml` / entitlements, `expo-notifications` wired to APNS (iOS) and FCM (Android) with a deep-linking response handler that opens `/orders/[id]`, `expo-updates` on profile-scoped channels with a `useUpdates` hook that checks on cold start and resume, EAS Build credentials (Apple distribution cert + APNS key + Android keystore), EAS Submit to App Store Connect and Play Console, native capability flags for In-App Purchases (implementation in `./09-monetization.md`), and the iOS 17+ `PrivacyInfo.xcprivacy` manifest that keeps App Store submissions from bouncing.
**When to use:** Wiring push notifications for the first time, debugging a silent-push problem, shipping an OTA update that does not arrive, uploading a build that gets rejected for a missing privacy manifest, onboarding a new platform capability (HealthKit, Background Fetch, In-App Purchase), or setting up credentials for a fresh Apple / Google developer account. Read Sections 1-5 before touching any native config; Sections 8-10 before running `eas build --profile production` for the first time.
**Prerequisites:** `./00-architecture.md` (workflow choice, `app.config.ts` authoring, the `prebuild --clean` rule, EAS profile conventions), `./03-auth-and-networking.md` (the `apiClient` wrapper that registers the push token with the backend; the `tokenStore` whose refresh token a silent-push wake-up may need), and `../../aws-cdk-patterns/references/01-serverless-api.md` (the backend that signs order-status push payloads and stores device tokens).

> Examples verified against Expo SDK 54 + `expo-notifications` 0.32.x + `expo-updates` 0.28.x + `eas-cli` >= 18.0.0 on 2026-04-23. Re-verify via context7 before porting to a newer SDK — SDK 55 renames `shouldShowAlert` → `shouldShowBanner`/`shouldShowList` (already reflected here) and tightens `PrivacyInfo.xcprivacy` merging for static frameworks.

## Contents

1. **Expo modules API vs config plugin vs community package** — When each is the right tool; the decision rule; a minimal Expo module for a platform-specific capability; when the managed-workflow escape hatch is actually needed.
2. **Config plugins in practice** — A single `withAcmePush` plugin that adds the iOS `aps-environment` entitlement, the Android `POST_NOTIFICATIONS` permission, and an `Info.plist` privacy description key; idempotency and the `--clean` lifecycle; the five pitfalls that account for most plugin bugs.
3. **Push notifications — the flow** — `expo-notifications` with APNS direct on iOS + FCM direct on Android; Expo push token vs direct native token; foreground vs background vs killed-app handling via `setNotificationHandler` + `addNotificationResponseReceivedListener`; notification categories / actions; deep-link from payload to `router.push("/orders/[id]")`. Brief note on AWS SNS / Pinpoint as a broker.
4. **iOS entitlements + APNS key** — App Store Connect APNS `.p8` key upload to EAS, APNS auth-key vs APNS certificate tradeoffs, foreground vs background entitlement config, the `aps-environment` development-vs-production map.
5. **Android 13+ `POST_NOTIFICATIONS`** — Runtime permission flow, handling denial gracefully, the notification-channel-before-token ordering rule, foreground-service-type requirement on Android 14.
6. **OTA updates** — `expo-updates` channels crossed with EAS profiles; `checkForUpdateAsync` on app start vs on resume; rollback via republishing previous bundle; testing updates in the preview profile before promoting to production.
7. **EAS Build** — Build profiles (`development` / `preview` / `production`), credentials management (Apple distribution cert + APNS key + Android keystore), EAS secrets vs `process.env.EXPO_PUBLIC_*` (which gets embedded, which stays server-side), build caching gotchas, iOS simulator builds for CI.
8. **EAS Submit** — Automated submission to App Store Connect and Play Console, metadata handling, initial-submission vs update flow, `eas submit --profile production --latest`.
9. **In-app purchases — native config** — iOS In-App Purchase capability, Android `com.android.vending.BILLING`, EAS credentials, App Store Connect + Play Console product creation. **Implementation (RevenueCat / `react-native-purchases`) lives in `./09-monetization.md`.**
10. **iOS privacy manifests (iOS 17+)** — Required `PrivacyInfo.xcprivacy`; EAS auto-generation for first-party Expo modules; adding one for a third-party module that does not ship one; the four most common rejection patterns.
11. **Gotchas (native/release-specific)** — Silent push tokens when the APNS key expired, OTA bundle not delivered due to channel/profile mismatch, config plugin not re-run after `prebuild --clean`, build rejected for missing privacy manifest, Android foreground-service type missing on Android 14.
12. **Verification** — `eas build --profile preview --platform ios --local` smoke, `eas channel:view preview`, push-token echo test, OTA round-trip dry run.
13. **Further reading** — Pointers into the rest of this skill and sibling skills.

---

## Section 1: Expo modules API vs config plugin vs community package

Three tools, one question: **how do I add a native capability to an Expo app?**

The decision rule, in order of preference:

1. **Is there a well-maintained community package?** Use it. `expo-notifications`, `expo-updates`, `expo-secure-store`, `expo-image-picker`, `react-native-mmkv`, `react-native-purchases`. These are the happy path. You write zero native code and your `prebuild` stays deterministic.
2. **Do you need to patch a native config file** (an entitlement, an `Info.plist` key, a permission, a Gradle dep, a Pod hook) **to wire a package or to toggle an OS feature?** Write a **config plugin**. This skill shows one in §2.
3. **Do you need to call a native API that no package wraps** (a new HealthKit endpoint, a platform-specific capability Apple or Google released last month, a C++ library with no JS binding)? Use the **Expo modules API** to author a real native module in Swift / Kotlin. This is rare for an app like Acme Shop.

If none of these three fit, the managed workflow's escape hatch is **dropping to bare** — `npx expo prebuild` followed by `cd ios && pod install && open *.xcworkspace`. You lose the ability to regenerate native code cleanly and you own the `ios/` and `android/` folders forever. Do not reach for this unless you have read §3 of `./00-architecture.md` and genuinely need Xcode-level customization the config-plugin system cannot express.

### 1.1 Choosing between the three — concrete Acme Shop examples

| Need | Right tool | Why |
|---|---|---|
| Push notifications (FCM + APNS) | `expo-notifications` | Well-maintained first-party package. |
| Order-status deep link → `/orders/[id]` | `expo-router` + `addNotificationResponseReceivedListener` | Pure JS wiring on top of `expo-notifications`. |
| `aps-environment` entitlement for silent push | Config plugin (§2) | One-line patch to `ios.entitlements`; no native code. |
| Android `POST_NOTIFICATIONS` runtime permission | `expo-notifications` + manifest merge (§2) | Package declares the permission; you ensure the manifest entry. |
| Read a user's step count from HealthKit | Community package `react-native-health` (or Expo module) | Existing wrapper covers the API Acme Shop needs. |
| Call a proprietary C++ signal-processing SDK for receipt-OCR preprocessing | **Expo module** (§1.2) | No community wrapper exists; you are the maintainer. |
| In-App Purchase capability + Billing permission | Config plugin + `react-native-purchases` | Capability via plugin; purchase flow via RC. See §9 + `./09-monetization.md`. |
| Custom iOS extension (Siri Intent, Widget, Watch app) | **Drop to bare** | Config plugins do not yet model multi-target Xcode projects. |

### 1.2 Minimal Expo module — sketch only

The full tutorial is in the Expo docs ([docs.expo.dev/modules/native-module-tutorial](https://docs.expo.dev/modules/native-module-tutorial)). What matters here is the shape of the three files you end up with, because the reviewer who reads your PR needs to see that you wired JS → native correctly.

`modules/acme-receipt-ocr/android/src/main/java/expo/modules/acmereceiptocr/AcmeReceiptOcrModule.kt`:

```kotlin
package expo.modules.acmereceiptocr

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AcmeReceiptOcrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AcmeReceiptOcr")

    AsyncFunction("preprocess") { base64Jpeg: String ->
      // Call into your C++/JNI code here. Return the preprocessed base64.
      AcmeReceiptOcrNative.preprocess(base64Jpeg)
    }
  }
}
```

`modules/acme-receipt-ocr/ios/AcmeReceiptOcrModule.swift`:

```swift
import ExpoModulesCore

public class AcmeReceiptOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AcmeReceiptOcr")

    AsyncFunction("preprocess") { (base64Jpeg: String) -> String in
      // Swift bridge to the C++ lib.
      return AcmeReceiptOcrNative.preprocess(base64Jpeg)
    }
  }
}
```

`modules/acme-receipt-ocr/src/index.ts`:

```ts
import { requireNativeModule, NativeModule } from "expo";

declare class AcmeReceiptOcrModule extends NativeModule {
  preprocess(base64Jpeg: string): Promise<string>;
}

const native = requireNativeModule<AcmeReceiptOcrModule>("AcmeReceiptOcr");

export function preprocess(base64Jpeg: string): Promise<string> {
  return native.preprocess(base64Jpeg);
}
```

The `Name()` string (`"AcmeReceiptOcr"`) must match across all three files. The module lives under `modules/` in the repo root and is wired in by adding `"./modules/acme-receipt-ocr"` to your `package.json` `expo.modules` array (or simply `autolinking` if the module exposes a `config.json`). After adding, re-run `npx expo prebuild --clean` and rebuild the dev client.

**When you do not need this:** every single push-notification, OTA-update, and store-submission concern in the rest of this file uses community packages. An Expo module is an escape hatch for platform capabilities the ecosystem has not caught up with yet — not a tool for everyday feature work.

---

## Section 2: Config plugins in practice

A config plugin is a function that takes an `ExpoConfig` and returns an `ExpoConfig`, running during `npx expo prebuild`. Under the hood `prebuild` does two things:

1. Generates the `ios/` and `android/` folders from templates (if not present).
2. Runs every plugin in `app.config.ts`'s `plugins` array, each patching the native files it cares about.

The three patches Acme Shop needs for push notifications — and which this one plugin rolls together — are:

- **iOS entitlement**: `aps-environment` → `development` or `production` depending on build profile.
- **Android permission**: `POST_NOTIFICATIONS` in `AndroidManifest.xml` for Android 13+.
- **iOS `Info.plist` key**: `NSUserTrackingUsageDescription` for any ATT-requiring analytics vendor (Sentry, Segment, etc).

### 2.1 The plugin source

`plugins/with-acme-push.ts` (at repo root, referenced from `app.config.ts`):

```ts
import {
  AndroidConfig,
  ConfigPlugin,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} from "expo/config-plugins";

type AcmePushOptions = {
  /** Controls the iOS `aps-environment` entitlement. Use `production` only on App Store builds. */
  apsEnvironment: "development" | "production";
  /** Shown in the iOS App Tracking Transparency prompt. Required if any analytics vendor tracks across apps. */
  trackingUsageDescription?: string;
};

const withAcmePush: ConfigPlugin<AcmePushOptions> = (config, props) => {
  // ---- iOS: aps-environment entitlement ----
  config = withEntitlementsPlist(config, (cfg) => {
    cfg.modResults["aps-environment"] = props.apsEnvironment;
    return cfg;
  });

  // ---- iOS: NSUserTrackingUsageDescription (only if provided) ----
  if (props.trackingUsageDescription) {
    config = withInfoPlist(config, (cfg) => {
      cfg.modResults.NSUserTrackingUsageDescription =
        props.trackingUsageDescription!;
      return cfg;
    });
  }

  // ---- Android: POST_NOTIFICATIONS permission ----
  config = withAndroidManifest(config, (cfg) => {
    // `addPermission` is idempotent: re-running --clean does not duplicate.
    AndroidConfig.Permissions.addPermission(
      cfg.modResults,
      "android.permission.POST_NOTIFICATIONS",
    );
    return cfg;
  });

  return config;
};

export default withAcmePush;
```

Wire it into `app.config.ts`:

```ts
// app.config.ts (excerpt — full file in 00-architecture.md §3)
import type { ExpoConfig } from "expo/config";

export default (): ExpoConfig => ({
  name: "Acme Shop",
  slug: "acme-shop",
  scheme: "acmeshop",
  ios: { bundleIdentifier: "com.acme.shop" },
  android: { package: "com.acme.shop" },
  plugins: [
    "expo-router",
    "expo-notifications", // order matters — see §2.3
    [
      "./plugins/with-acme-push",
      {
        // APS_ENVIRONMENT is set per build profile in eas.json.
        apsEnvironment:
          process.env.APS_ENVIRONMENT === "production"
            ? "production"
            : "development",
        trackingUsageDescription:
          "Acme Shop uses anonymous analytics to improve product recommendations. You can disable this in Settings.",
      },
    ],
  ],
});
```

### 2.2 Idempotency and the `--clean` lifecycle

Every plugin **must** be safe to run twice. `npx expo prebuild` is idempotent only if every plugin in the chain is. The rules:

- **Check before adding.** `AndroidConfig.Permissions.addPermission` does this internally (it skips if the permission is already present). If you write a manual patch, check first.
- **Use the helpers.** `withInfoPlist`, `withEntitlementsPlist`, `withAndroidManifest`, `withGradleProperties` — these merge, they do not overwrite. Direct file writes (`fs.writeFileSync`) break `--clean`.
- **Test `--clean`.** After any plugin change, run `npx expo prebuild --platform ios --clean && npx expo prebuild --platform ios` and diff `ios/*.entitlements`. Two runs should produce byte-identical output.

The `--clean` flag **deletes `ios/` and `android/` before regenerating them**. This is the only reliable way to pick up a changed plugin. If you edit `plugins/with-acme-push.ts` and do not pass `--clean`, Expo re-runs the chain but your cached native files may ignore the update. Treat `--clean` as the default for plugin debugging — only skip it when iterating on JS code.

### 2.3 The five pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| **Plugin order wrong.** `expo-notifications` ships its own entitlement patch; if `with-acme-push` runs first, `expo-notifications` overwrites your `aps-environment` value. | Your custom entitlement "disappears" from `ios/AcmeShop.entitlements`. | Put custom plugins **after** the community plugins they depend on. In the array above, `with-acme-push` comes last. |
| **Plugin missing from `app.config.ts`.** You wrote the plugin, ran `prebuild`, but the plugin array does not reference it. | `prebuild` succeeds silently; nothing changes in native files. | Add `["./plugins/with-acme-push", { ... }]` to `plugins`. Run `npx expo config --json \| jq .plugins` to confirm. |
| **Forgot `--clean` after plugin edit.** | Old native code; new plugin changes ignored. | Always `--clean` after plugin edits. |
| **Non-idempotent mod**. Plugin appends to a list without deduping. | Second `prebuild` run creates duplicate manifest entries; build fails with `duplicate permission`. | Use the `AndroidConfig` / `IOSConfig` helpers, not manual string ops. |
| **Typo in mod name.** `withEntitlementPlist` (no `s`) vs `withEntitlementsPlist`. | `TypeError: not a function`. | Import from `expo/config-plugins` and rely on TS for autocomplete — both names are real in some docs, the correct one is `withEntitlementsPlist`. |

### 2.4 What NOT to put in a config plugin

Config plugins are for **static, build-time** native config. They run once per `prebuild`. They are not the place for:

- **Runtime behavior.** A toggle the user flips in Settings belongs in JS, not in native config.
- **Sensitive values.** `withInfoPlist` with `apiSecret: process.env.ACME_API_SECRET` embeds the secret in `Info.plist`, which ships to every device. See §7.3.
- **Heavy lifting.** If your plugin is 300 lines and runs network requests, split the work: do the research / codegen as a separate CLI step that commits generated files, and have the plugin just patch the static output.

---

## Section 3: Push notifications — the flow

### 3.1 Expo push token vs direct native token

`expo-notifications` gives you two functions:

| Function | Returns | Use when |
|---|---|---|
| `getExpoPushTokenAsync({ projectId })` | Opaque `ExponentPushToken[...]` | Sending via Expo Push Service (free, easy, rate-limited). Works on top of FCM/APNS but keeps you on Expo's abstraction. |
| `getDevicePushTokenAsync()` | Raw APNS hex token (iOS) or FCM token (Android) | Sending directly via AWS SNS / Firebase Admin / any server that speaks APNS/FCM. This is what Acme Shop uses — the backend already has APNS + FCM credentials and sends notifications via SNS platform endpoints described in `../../aws-cdk-patterns/references/01-serverless-api.md`. |

**Pick one and stick with it.** Do not mix — the backend addresses devices by exactly one kind of token. Acme Shop uses `getDevicePushTokenAsync` for production and the Expo token only for local dev testing via `expo send` scripts.

> **AWS SNS / Pinpoint note.** If you want a broker between your backend and APNS/FCM — for multi-platform fanout, analytics, or topic subscriptions — SNS platform endpoints or Pinpoint is fine. Our backend registers each device token with an SNS `PlatformEndpoint` and publishes to that endpoint's ARN. This is covered in `../../aws-cdk-patterns/references/01-serverless-api.md` §Push. For apps with straightforward per-user push, direct APNS + FCM is simpler and lower latency.

### 3.2 The registration function

`src/platform/push/registerPushNotifications.ts`:

```ts
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { apiClient } from "@/platform/net/apiClient";

export type PushRegistrationResult =
  | { ok: true; token: string; kind: "apns" | "fcm" }
  | { ok: false; reason: "permission_denied" | "not_a_device" | "no_token" | "network" };

/**
 * Full registration flow:
 *   1. Create the Android default channel (required before the permission prompt).
 *   2. Request permission.
 *   3. Fetch the native device token.
 *   4. POST the token to our backend so it can address this device via SNS.
 *
 * Call once from the authenticated root layout. Re-call on sign-in if the user changes accounts.
 */
export async function registerPushNotifications(
  userId: string,
): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return { ok: false, reason: "not_a_device" };
  }

  // 1. Android 13+ requires at least one notification channel BEFORE the permission
  //    prompt will appear. Do this unconditionally on every launch — the call is idempotent.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Order updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  // 2. Check existing permission, only prompt if we have not asked yet.
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== "granted") {
    const res = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    status = res.status;
  }
  if (status !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  // 3. Native device token (APNS hex on iOS, FCM string on Android).
  //    We do NOT use getExpoPushTokenAsync because our backend talks APNS/FCM directly.
  let devicePushToken: Notifications.DevicePushToken;
  try {
    devicePushToken = await Notifications.getDevicePushTokenAsync();
  } catch (err) {
    console.warn("[push] getDevicePushTokenAsync failed", err);
    return { ok: false, reason: "no_token" };
  }
  const token = devicePushToken.data as string;
  const kind = Platform.OS === "ios" ? "apns" : "fcm";

  // 4. Register with backend. The server stores (userId, platform, token)
  //    and provisions an SNS PlatformEndpoint.
  try {
    await apiClient.post("/devices", {
      userId,
      platform: kind,
      token,
      appVersion: Constants.expoConfig?.version,
      // SDK version is useful for debugging token-format drift across SDK upgrades.
      sdkVersion: Constants.expoConfig?.sdkVersion,
    });
  } catch (err) {
    console.warn("[push] backend register failed", err);
    return { ok: false, reason: "network" };
  }

  return { ok: true, token, kind };
}
```

The call site lives in the authenticated root layout, guarded by sign-in status:

```tsx
// app/(shop)/_layout.tsx (excerpt — see 01-navigation.md for the full layout)
import { useEffect } from "react";
import { registerPushNotifications } from "@/platform/push/registerPushNotifications";
import { useAuth } from "@/platform/auth/useAuth";

export default function ShopLayout() {
  const userId = useAuth((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;
    void registerPushNotifications(userId).then((r) => {
      if (!r.ok) console.log("[push] not registered:", r.reason);
    });
  }, [userId]);

  return /* ... */;
}
```

### 3.3 Foreground vs background vs killed-app

Three distinct delivery states. The behavior of each depends on `setNotificationHandler` and on whether you subscribed to `addNotificationResponseReceivedListener`.

| State | Behavior |
|---|---|
| **Foreground** (app open, user looking at it) | `setNotificationHandler` decides whether to show a banner + play sound + add badge. Default behavior is **silent** — this is different from iOS pre-SDK 50. Configure `shouldShowBanner: true` if you want the OS banner. |
| **Background** (app suspended, not killed) | OS shows banner automatically. `addNotificationResponseReceivedListener` fires if the user taps the banner. Tapping without the listener just opens the app. |
| **Killed** (user force-quit, or never opened) | OS shows banner. When user taps, app launches. At launch, `getLastNotificationResponseAsync()` returns the response you missed. You MUST read this on startup to deep-link correctly — the listener is not firing for events that predate its subscription. |

### 3.4 The handler + listener

`src/platform/push/setupNotifications.ts`:

```ts
import * as Notifications from "expo-notifications";
import type { Router } from "expo-router";

// Runs at module import time, once per app lifecycle. Safe to call early.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // iOS / Android foreground behavior. SDK 54 replaced shouldShowAlert
    // with the more specific shouldShowBanner + shouldShowList pair.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false, // Acme Shop: silent by default; OS Settings override this.
    shouldSetBadge: true,
  }),
});

/**
 * Wire notification taps to the router.
 *
 * Call once from the root layout's useEffect — NOT from every screen.
 * Returns the cleanup function; unsubscribe on unmount.
 */
export function wireNotificationResponses(router: Router): () => void {
  // Handle taps while app is alive (foreground or suspended → resumed via tap).
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = extractDeepLink(response);
    if (url) router.push(url as any);
  });

  // Handle the "app was killed, user tapped notification to launch" case.
  // Fire-and-forget: the router may not be mounted on the very first render,
  // so wrap in a microtask to let the layout finish mounting.
  void (async () => {
    const initial = await Notifications.getLastNotificationResponseAsync();
    if (!initial) return;
    const url = extractDeepLink(initial);
    if (url) router.push(url as any);
  })();

  return () => sub.remove();
}

function extractDeepLink(
  response: Notifications.NotificationResponse,
): string | null {
  // Backend convention: every push payload includes a `data.url` key like `/orders/abc123`.
  const url = response.notification.request.content.data?.url;
  return typeof url === "string" ? url : null;
}
```

Call site in the root layout:

```tsx
// app/_layout.tsx
import { useEffect } from "react";
import { useRouter } from "expo-router";
import "@/platform/push/setupNotifications"; // import for side-effect: setNotificationHandler
import { wireNotificationResponses } from "@/platform/push/setupNotifications";

export default function RootLayout() {
  const router = useRouter();
  useEffect(() => wireNotificationResponses(router), [router]);
  return /* ... */;
}
```

### 3.5 Notification categories and actions

iOS supports per-notification buttons ("Mark as shipped", "Cancel order") via **categories**. Android supports the same via **actions** on the channel. Expo's API unifies them:

```ts
// Register once at startup — usually from setupNotifications.ts.
await Notifications.setNotificationCategoryAsync("order_update", [
  {
    identifier: "view",
    buttonTitle: "View order",
    options: { opensAppToForeground: true },
  },
  {
    identifier: "dismiss",
    buttonTitle: "Dismiss",
    options: { opensAppToForeground: false, isDestructive: false },
  },
]);
```

Then set `categoryIdentifier: "order_update"` in the push payload your backend sends. When the user taps "View order", `addNotificationResponseReceivedListener` fires with `response.actionIdentifier === "view"` and you route to `/orders/[id]`.

### 3.6 Deep-link payload shape

Acme Shop's backend sends payloads like:

```json
{
  "aps": {
    "alert": { "title": "Order shipped", "body": "Your order #7823 is on its way." },
    "sound": "default",
    "category": "order_update",
    "badge": 1
  },
  "data": { "url": "/orders/7823" }
}
```

The `data.url` convention matches what `extractDeepLink` above reads. Android sends the same `data.url` under the FCM `data` payload (not `notification` — notifications in `notification` do not invoke your listener when the app is killed; only `data`-only payloads do). Ask your backend team to send **data-only** FCM messages for anything that needs to deep-link when the app is killed.

---

## Section 4: iOS entitlements + APNS key

### 4.1 The APNS key (`.p8`) flow

Apple supports two APNS authentication methods:

| Method | Lifetime | Scope |
|---|---|---|
| **APNS auth key (`.p8`)** | Does not expire | All apps in your Apple Developer team. One key per team. |
| **APNS certificate (`.p12`)** | 1 year | Single app bundle ID. |

**Use the `.p8` key.** It is simpler, covers all apps, and does not expire. Only fall back to certificates if you need per-app key rotation (rare).

Steps (once per team):

1. App Store Connect → Keys → **+** → Enable "Apple Push Notifications service (APNs)".
2. Download the `.p8` file. **You can only download it once** — store it somewhere safe immediately.
3. Note the **Key ID** (10 characters) and **Team ID** (10 characters, from your Membership page).
4. Upload to EAS:

```bash
eas credentials --platform ios
# ? What do you want to do? Push Notifications: Manage your Apple Push Notifications Key
# ? Select the Apple Team: Acme Inc (TEAM123)
# ? Select the iOS Capability Identifier: com.acme.shop
# > Set up a new Apple Push Notifications Key
# ? Path to the .p8 file: /path/to/AuthKey_XXXXXXXXXX.p8
# ? Key ID: XXXXXXXXXX
```

EAS stores the key server-side and attaches it to every `eas build` for that bundle ID. The key is **not** embedded in the binary; Apple APNS validates it server-to-server when your backend sends pushes.

### 4.2 `aps-environment` development vs production

The entitlement's value controls which APNS endpoint your app registers with:

| Value | APNS endpoint | When |
|---|---|---|
| `development` | `sandbox.push.apple.com` | Dev client builds, TestFlight internal testers, Ad Hoc distributions. |
| `production` | `api.push.apple.com` | App Store builds, TestFlight external testers. |

The wrong value is the #1 cause of "push works in dev but not in TestFlight" bug reports. The `with-acme-push` plugin in §2.1 reads `process.env.APS_ENVIRONMENT`, which Acme Shop sets per EAS profile (see §7):

```json
// eas.json (excerpt)
{
  "build": {
    "development": { "env": { "APS_ENVIRONMENT": "development" } },
    "preview":     { "env": { "APS_ENVIRONMENT": "development" } },
    "production":  { "env": { "APS_ENVIRONMENT": "production"  } }
  }
}
```

TestFlight is a special case: builds submitted through `eas submit` inherit the `aps-environment` of the build profile. `production` builds use the production APNS endpoint even for TestFlight testers — this is correct.

### 4.3 Foreground vs background entitlement

Plain notifications (banner + sound) only need `aps-environment`. **Silent push** — used to refresh data in the background without alerting the user — additionally needs the `remote-notification` background mode in `UIBackgroundModes`:

```ts
// plugins/with-acme-push.ts (add this mod if you need silent push)
config = withInfoPlist(config, (cfg) => {
  const modes = cfg.modResults.UIBackgroundModes ?? [];
  if (!modes.includes("remote-notification")) {
    modes.push("remote-notification");
  }
  cfg.modResults.UIBackgroundModes = modes;
  return cfg;
});
```

Acme Shop uses silent push to refresh the order cache when the backend marks an order shipped — the user sees the update the moment they next open the app, without needing an alert. `addNotificationReceivedListener` fires in the background thread for these payloads; you have ~30 seconds to complete work before iOS suspends you.

---

## Section 5: Android 13+ `POST_NOTIFICATIONS`

Android 13 (API 33, August 2022) introduced the runtime permission `POST_NOTIFICATIONS`. Apps targeting API 33+ must request it explicitly; older apps get grandfathered but will be rejected from Play Store updates without proper handling.

### 5.1 The permission declaration

`with-acme-push` already adds `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` to `AndroidManifest.xml`. `expo-notifications` also adds this permission, so you could technically rely on the community plugin alone — but declaring it explicitly in your own plugin makes the dependency visible in code review.

### 5.2 The runtime flow

`Notifications.requestPermissionsAsync()` handles the native OS prompt on both platforms. On Android 13+ it:

1. Returns `{ status: "granted" }` immediately if already granted.
2. Returns `{ status: "denied" }` immediately if the user previously denied with "Don't ask again" (the OS remembers).
3. Otherwise shows the system prompt and awaits user response.

**Before calling `requestPermissionsAsync`, you must create at least one notification channel.** Android 13 will silently return `denied` without showing the prompt if no channel exists. This is why `setNotificationChannelAsync("default", ...)` runs first in `registerPushNotifications` (§3.2).

### 5.3 Handling denial gracefully

If the user denies, your app should not nag them on every launch. Our `registerPushNotifications` returns `{ ok: false, reason: "permission_denied" }`; the UI either ignores it or shows a one-time banner.

Offer a way to revisit the decision from Settings — tapping the banner opens the app's notification settings page:

```ts
import { Linking, Platform } from "react-native";

async function openNotificationSettings() {
  if (Platform.OS === "ios") {
    await Linking.openSettings(); // iOS: generic app settings.
  } else {
    // Android: deep link to the app's notification settings screen.
    await Linking.sendIntent("android.settings.APP_NOTIFICATION_SETTINGS", [
      { key: "android.provider.extra.APP_PACKAGE", value: "com.acme.shop" },
    ]);
  }
}
```

### 5.4 Foreground-service type on Android 14

Android 14 (API 34) requires apps declaring `FOREGROUND_SERVICE` to also declare a **specific type** — `dataSync`, `mediaPlayback`, `location`, `connectedDevice`, etc. If you use `expo-background-fetch` or `expo-task-manager` with a foreground service, add the type via a config plugin:

```ts
// In with-acme-push.ts or a separate plugin
config = withAndroidManifest(config, (cfg) => {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
  const service = app.service?.find(
    (s) => s.$["android:name"] === "expo.modules.taskmanager.BackgroundTaskService",
  );
  if (service) {
    service.$["android:foregroundServiceType"] = "dataSync";
  }
  return cfg;
});
```

Acme Shop does not currently ship a foreground service; this is documented for when we add background order-tracking in a later milestone.

---

## Section 6: OTA updates

`expo-updates` lets you ship a new JS bundle + assets to devices without going through the App Store. Use it for:

- Copy changes (typos, legal updates).
- Small bug fixes in pure JS (logic, rendering).
- Experiment flips (A/B tests, feature flags).

**Do not use it for:**

- Native code changes. Anything that changes `ios/` or `android/` requires a store build.
- New native permissions or entitlements.
- New dependencies that include native code.

The rule is: if `npx expo prebuild` would produce different native output, OTA is not enough.

### 6.1 Channels and EAS profiles

A **channel** is a named track of updates. A build listens to exactly one channel, declared in `eas.json`:

```json
{
  "build": {
    "development": { "channel": "development", "developmentClient": true },
    "preview":     { "channel": "preview",     "distribution": "internal" },
    "production":  { "channel": "production" }
  }
}
```

Publish an update to a channel:

```bash
# Beta testers on the preview build get this update on next launch.
eas update --branch preview --message "Fix: product card price rounding"

# Promote to production once validated.
eas update --branch production --message "Release: price rounding fix"
```

`--branch` is the git-like name of the update sequence; `--channel` in `eas.json` is the name of the track the build reads from. In most projects the two coincide, and the CLI auto-maps branch `preview` to channel `preview`.

### 6.2 The `useUpdates` hook

`src/platform/updates/useUpdates.ts`:

```ts
import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Checks for an OTA update on cold start and whenever the app returns to the foreground.
 *
 * Strategy:
 *   - Dev builds: no-op (Updates.isEnabled is false in dev client by default).
 *   - Else: fetch + reload immediately. User sees a brief splash flash rather than
 *     running on the old bundle for the rest of the session.
 *
 * Adjust the check cadence via `minIntervalMs` — default 10 min avoids thrashing
 * if the user backgrounds / foregrounds rapidly.
 */
export function useUpdates({ minIntervalMs = 10 * 60 * 1000 } = {}) {
  const lastCheck = useRef<number>(0);

  useEffect(() => {
    if (!Updates.isEnabled) return;

    const check = async () => {
      if (Date.now() - lastCheck.current < minIntervalMs) return;
      lastCheck.current = Date.now();

      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable) return;

        await Updates.fetchUpdateAsync();
        // Delay the reload by ~500ms so the current screen finishes any in-flight
        // nav / animation. reloadAsync unmounts the entire React tree.
        setTimeout(() => {
          void Updates.reloadAsync();
        }, 500);
      } catch (err) {
        // Silent failure: the next cold start tries again. Don't alert users.
        console.log("[updates]", err);
      }
    };

    // 1. On mount / cold start.
    void check();

    // 2. On foreground transition.
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });

    return () => sub.remove();
  }, [minIntervalMs]);
}
```

Call it from the root layout:

```tsx
// app/_layout.tsx
import { useUpdates } from "@/platform/updates/useUpdates";

export default function RootLayout() {
  useUpdates();
  return /* ... */;
}
```

### 6.3 Rollback

`expo-updates` has no built-in rollback. To roll back, **republish the previous known-good bundle** as a new update:

```bash
# Find the last-known-good update ID.
eas update:list --branch production --limit 5

# Republish it — this creates a new update pointing at the old bundle.
eas update:republish --branch production --group <GROUP_ID>
```

Clients poll on next launch or on `checkForUpdateAsync`, pick up the new-but-older-content update, and reload. End users see no error, only that the regression disappeared.

**Always leave a breadcrumb.** When republishing, include a `--message "Rollback of 3.2.1 due to rendering regression in cart"` so the deploy log is readable.

### 6.4 Testing updates before promoting

A safe update-promotion flow for Acme Shop:

1. Publish to `preview` channel:  
   `eas update --branch preview --message "Feature flag: new checkout"`
2. Install the latest `preview` build on a test device (`eas build:list --profile preview --limit 1 --json` for the install link).
3. Launch the app — `useUpdates` picks up the new bundle on cold start.
4. Verify the change end-to-end.
5. Promote:  
   `eas update --branch production --message "Release: new checkout"`

This is equivalent to a staging → production promotion but without another store round-trip. The `preview` build is the "same native binary as production"; only the JS differs, so if it works in `preview` it works in `production`.

---

## Section 7: EAS Build

### 7.1 The three profiles

Acme Shop's `eas.json`:

```json
{
  "cli": {
    "version": ">= 18.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "ios": {
        "simulator": true,
        "resourceClass": "m-medium"
      },
      "android": {
        "buildType": "apk"
      },
      "env": {
        "APS_ENVIRONMENT": "development",
        "EXPO_PUBLIC_API_BASE_URL": "https://dev.api.acme.shop",
        "EXPO_PUBLIC_SENTRY_ENV": "development"
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "ios": {
        "resourceClass": "m-medium"
      },
      "android": {
        "buildType": "apk"
      },
      "env": {
        "APS_ENVIRONMENT": "development",
        "EXPO_PUBLIC_API_BASE_URL": "https://staging.api.acme.shop",
        "EXPO_PUBLIC_SENTRY_ENV": "staging"
      }
    },
    "production": {
      "autoIncrement": true,
      "channel": "production",
      "env": {
        "APS_ENVIRONMENT": "production",
        "EXPO_PUBLIC_API_BASE_URL": "https://api.acme.shop",
        "EXPO_PUBLIC_SENTRY_ENV": "production"
      }
    }
  },
  "submit": {
    "development": {
      "ios":    { "appleId": "ops@acme.shop", "ascAppId": "1234567890", "appleTeamId": "TEAM123" },
      "android": { "serviceAccountKeyPath": "./secrets/play-service-account.json", "track": "internal" }
    },
    "preview": {
      "ios":    { "appleId": "ops@acme.shop", "ascAppId": "1234567890", "appleTeamId": "TEAM123" },
      "android": { "serviceAccountKeyPath": "./secrets/play-service-account.json", "track": "internal" }
    },
    "production": {
      "ios":    { "appleId": "ops@acme.shop", "ascAppId": "1234567890", "appleTeamId": "TEAM123" },
      "android": { "serviceAccountKeyPath": "./secrets/play-service-account.json", "track": "production" }
    }
  }
}
```

Each profile maps 1:1 to a channel (§6) and to a submit profile (§8). Keep this parallelism — mismatched names ("prod" in one place, "production" in another) are the #2 cause of "OTA update not delivered" incidents.

### 7.2 Credentials management

For each platform, EAS manages three credential objects server-side:

**iOS:**

- **Apple distribution certificate + provisioning profile.** Generated by `eas credentials` the first time you build for the App Store. EAS renews them before they expire.
- **APNS auth key (`.p8`).** Uploaded once per team (§4.1).
- **Push key capabilities.** Linked to the App ID when you enable Push Notifications capability.

**Android:**

- **Upload keystore.** Generated by `eas build` on first invocation, stored encrypted. Losing this means losing the ability to publish updates to the same Play Store listing — EAS keeps a backup but you should export a copy yourself (`eas credentials` → Android → Keystore → Download).
- **Google service account JSON.** For `eas submit` to push to the Play Console (§8).

List everything:

```bash
eas credentials --platform ios
eas credentials --platform android
```

Rotate a credential (e.g., a compromised APNS key):

```bash
eas credentials --platform ios
# > Push Notifications: Manage your Apple Push Notifications Key
# > Remove an Apple Push Notifications Key
# > [upload replacement]
```

The next build automatically uses the new key. Backend APNS sender must also be updated — the key is used at two ends.

### 7.3 EAS secrets vs `EXPO_PUBLIC_*`

This trips up every new team member. The rule:

| Kind | Where it lives | When it is embedded in the binary | Use for |
|---|---|---|---|
| **`process.env.EXPO_PUBLIC_*`** (set via `eas.json` `env` or EAS env vars marked "plaintext") | Readable in `app.config.ts` and at runtime in the JS bundle | **Yes — visible in the shipped binary** | API base URL, Sentry DSN (public), project IDs, anything an attacker could read by `strings` on the bundle anyway. |
| **EAS secrets** (set via `eas secret:create --name MY_SECRET --value ... --scope project`) | Readable at build time only, via `process.env.MY_SECRET` in `app.config.ts` or `eas-build-pre-install` hooks | **No — NOT embedded in the binary** unless your code copies them into a runtime-readable location | Things that must never ship to the device: private signing keys, third-party API secrets that must stay server-side. |

**If you put a secret in `EXPO_PUBLIC_*`, it ships to every user.** If you put a non-secret (like an API URL) in EAS secrets, the app cannot read it at runtime and breaks.

The golden rule: **if the client needs it at runtime, it is not a secret — it ships in the binary.** Secrets belong on the server. The `apiClient` talks to the server; the server holds the API keys. This is why the token-refresh flow in `./03-auth-and-networking.md` uses only `EXPO_PUBLIC_COGNITO_CLIENT_ID` (public) and never a Cognito client secret (Cognito issues only public clients for mobile — by design).

### 7.4 Build caching gotchas

EAS caches `node_modules` and `Pods/` per profile. Two gotchas:

- **Dependency changes require a fresh install.** Adding a new native dep (anything that ends up in `Podfile` or Gradle) invalidates the cache on next build — slow (5-15 min longer). Normal.
- **Stale cache after a config plugin change.** The plugin re-runs, but the cached `Pods/Manifest.lock` may match the old `Podfile.lock`. Symptoms: build succeeds but native patch does not apply. Fix: `eas build --clear-cache --profile preview --platform ios`.

### 7.5 iOS simulator builds for CI

Full simulator builds for CI and for quickly sharing with a non-device-owning reviewer:

```json
// eas.json (already shown above for development)
{
  "build": {
    "development": {
      "ios": { "simulator": true }
    }
  }
}
```

```bash
eas build --profile development --platform ios
# Download the .tar.gz, extract to .app, drag into Simulator.app.
```

Simulator builds have one critical limitation: **no APNS**. The iOS simulator cannot register for push; `getDevicePushTokenAsync` throws. Guard the call:

```ts
// registerPushNotifications.ts (already in §3.2)
if (!Device.isDevice) {
  return { ok: false, reason: "not_a_device" };
}
```

For push-notification end-to-end testing, always use a real device.

---

## Section 8: EAS Submit

`eas submit` uploads a finished build to App Store Connect (iOS) or Google Play Console (Android). It handles metadata, screenshots (from `store.config.json`), and the submission itself.

### 8.1 Initial vs update submission

**Initial submission** (first time a bundle ID is submitted):

- Requires the App Store Connect / Play Console listing to exist beforehand — `eas submit` does not create listings.
- Requires manual screenshots and marketing copy filled in via the web console (at least the minimum Apple and Google require).
- iOS: also requires a "Test Information" block (beta testing).

**Update submission** (subsequent versions):

- Pulls version number from `app.config.ts` (or auto-increments if `autoIncrement: true` in the build profile).
- Metadata edits done via the web console carry forward; `eas submit` does not overwrite them unless you supply a `metadata` field in `submit` config.

### 8.2 The commands

```bash
# Submit the latest production build (one-shot, non-interactive).
eas submit --profile production --platform all --latest --non-interactive

# Platform-specific, specific build:
eas submit --profile production --platform ios --id <BUILD_ID>

# TestFlight with "What to test" text:
eas submit --profile preview --platform ios --latest \
  --what-to-test "Fix: cart total rounding error; new product card layout"
```

### 8.3 Required fields per platform

**iOS (`submit.production.ios`):**

- `appleId` — The Apple ID (email) of the App Store Connect user performing the upload. EAS uses this for `xcrun altool` / App Store Connect API authentication.
- `ascAppId` — The numeric ID of the app in App Store Connect (from the URL on the app's page).
- `appleTeamId` — Your Apple Developer team ID (10 characters).

EAS uses either an App Store Connect API key (preferred, set via `eas credentials` once) or the interactive Apple ID password flow the first time.

**Android (`submit.production.android`):**

- `serviceAccountKeyPath` — Path to a Google service-account JSON file with "Release Manager" role on the Play Console. Commit the path but **never the JSON itself**. Keep the JSON in `.gitignore` and supply it via an EAS file secret:  
  `eas secret:create --type file --name GOOGLE_SERVICE_ACCOUNT --value ./secrets/play-service-account.json`  
  Then reference in `eas.json` as `"serviceAccountKeyPath": "${GOOGLE_SERVICE_ACCOUNT}"`.
- `track` — Which Play Console track to upload to: `internal`, `alpha`, `beta`, `production`. Start new apps on `internal`, promote via the Play Console UI after QA.

### 8.4 Metadata-as-code (optional)

You can commit metadata to the repo and have `eas submit` upload it. For iOS:

```
store.config.json
    → references localized strings in store/en-US/*.txt
    → references screenshots in store/en-US/screenshots/*.png
```

This is useful for teams with frequent marketing copy changes but overkill for most apps. The Acme Shop repo uses the web console for marketing copy and only commits `store.config.json` for app-level metadata (age rating, content descriptors) that rarely changes.

---

## Section 9: In-app purchases — native config

**This section covers only the native-side config.** The purchase flow (`react-native-purchases` / RevenueCat, restore-purchases, receipt validation) lives entirely in `./09-monetization.md`.

### 9.1 iOS In-App Purchase capability

Add the capability via a config plugin:

```ts
// plugins/with-iap.ts
import { ConfigPlugin, withEntitlementsPlist } from "expo/config-plugins";

const withIap: ConfigPlugin = (config) => {
  return withEntitlementsPlist(config, (cfg) => {
    // The "In-App Purchase" capability has no explicit entitlement key —
    // enabling the capability in App Store Connect plus shipping the
    // StoreKit framework (which react-native-purchases links) is sufficient.
    // What DOES need an entitlement is the merchant identifier for Apple Pay,
    // which IAP does not use. So this plugin is intentionally a no-op on the
    // entitlement file, but it reserves the seam for future capability flags.
    return cfg;
  });
};

export default withIap;
```

In practice, for vanilla IAP the only thing you do on iOS is **enable the "In-App Purchase" capability in App Store Connect** (Identifiers → your app → check "In-App Purchase"). Nothing goes in `.entitlements`. The StoreKit framework is linked automatically by `react-native-purchases`.

### 9.2 Android Billing permission

```ts
// plugins/with-iap.ts (continued)
import { AndroidConfig, withAndroidManifest } from "expo/config-plugins";

const withIap: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    AndroidConfig.Permissions.addPermission(
      cfg.modResults,
      "com.android.vending.BILLING",
    );
    return cfg;
  });
  return config;
};
```

`react-native-purchases` also auto-adds this permission via its own plugin; declaring it explicitly here just makes it visible in code review.

### 9.3 Product creation

Creation happens in the stores' web consoles, not in code:

- **App Store Connect** → your app → Monetization → In-App Purchases → **+** → choose type (Consumable / Non-Consumable / Auto-Renewable Subscription) → set product ID (e.g., `com.acme.shop.pro_monthly`).
- **Play Console** → your app → Monetization → Products → **+** → set product ID (same as iOS for parity).

Product IDs are referenced in `react-native-purchases` config. Match them exactly between platforms — the SDK expects them to align.

### 9.4 Handoff to `09-monetization.md`

From here, the purchase flow, offering fetch, `purchasePackage`, restore, receipt verification, entitlement gating — all live in `./09-monetization.md`. This file only guarantees that:

- The iOS IAP capability is enabled in App Store Connect.
- The Android `BILLING` permission is in the manifest.
- The IDs are created in both stores with matching identifiers.

---

## Section 10: iOS privacy manifests (iOS 17+)

Apple requires every iOS 17+ app to declare a **`PrivacyInfo.xcprivacy`** manifest if it uses any of the "required reason" APIs (`UserDefaults`, `FileManager` timestamps, system boot time, disk space, active keyboards). Missing or incomplete manifests trigger an email from Apple after submission and, since May 2024, hard-reject the binary.

### 10.1 What Expo generates for you

As of Expo SDK 50+, every **first-party Expo module** ships its own `PrivacyInfo.xcprivacy`. When you run `eas build`, EAS aggregates these into the app-level manifest. You don't have to do anything for Expo modules.

### 10.2 What you still have to declare

Two cases require manual declaration:

1. **Your own code uses a required-reason API.** If you call `UserDefaults` directly from a custom Expo module, or you use a JS library that persists data via `UserDefaults`, you need to declare the reason.
2. **A third-party package does not ship a manifest.** Many older React Native libraries (and some fresh ones) forget to include `PrivacyInfo.xcprivacy`. Apple's aggregator does not catch all of these automatically for statically linked frameworks.

Declare via `app.config.ts`:

```ts
export default (): ExpoConfig => ({
  // ...
  ios: {
    bundleIdentifier: "com.acme.shop",
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"], // "Access info from same app"
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1"], // "Display to user on-device"
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"], // "Measure app performance"
        },
      ],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTrackingDomains: [],
    },
  },
});
```

The `NSPrivacyAccessedAPITypeReasons` codes are from [Apple's required-reason-API list](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api). Look up the code that matches your actual use. Guessing codes to pass submission is a rejection risk if Apple later audits.

### 10.3 Adding a manifest for a third-party module

If `node_modules/some-library/ios/` has no `PrivacyInfo.xcprivacy`:

1. **Read the library source** to find which required-reason APIs it calls.
2. **Open an issue upstream** asking the maintainer to add a manifest.
3. **In the meantime**, add the reasons to your own `app.config.ts` privacy manifest (as above). Aggregation will merge them.

For a library you depend on heavily that will not add a manifest, write a small config plugin that drops a `PrivacyInfo.xcprivacy` file into the library's bundle:

```ts
// plugins/with-thirdparty-privacy.ts (shape only)
import { withDangerousMod } from "expo/config-plugins";
import { promises as fs } from "node:fs";
import path from "node:path";

const withThirdPartyPrivacy: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const libPath = path.join(
        cfg.modRequest.projectRoot,
        "node_modules/some-library/ios/PrivacyInfo.xcprivacy",
      );
      await fs.writeFile(libPath, /* your XML here */);
      return cfg;
    },
  ]);
};
```

`withDangerousMod` is a last-resort escape hatch (note the name). Use it only when no higher-level mod suffices.

### 10.4 The four most common rejection patterns

| Rejection | Cause | Fix |
|---|---|---|
| "Missing API declaration: `NSPrivacyAccessedAPICategoryUserDefaults`" | A library you link persists a value via `UserDefaults` and does not ship a manifest. | Add the category + `CA92.1` reason to your `app.config.ts` `privacyManifests`. |
| "Missing API declaration: `NSPrivacyAccessedAPICategoryFileTimestamp`" | A library reads file `modificationDate` (e.g., for caching). | Add category + appropriate reason (`C617.1` for on-device display). |
| "Missing API declaration: `NSPrivacyAccessedAPICategorySystemBootTime`" | `Date` / monotonic clock usage via a perf library. | Add category + `35F9.1` (app performance) or `8FFB.1` (advertising). |
| "Your app's privacy manifest includes tracking domains (`NSPrivacyTrackingDomains`), but `NSPrivacyTracking` is not set to true" | Contradiction between the two keys. | If you list tracking domains, set `NSPrivacyTracking: true`. If not tracking, remove the domains array. |

---

## Section 11: Gotchas (native/release-specific)

Each entry: **Symptom** → **Cause** → **Fix**.

### 11.1 Silent push stops working after ~12 months

**Symptom.** Pushes that worked in production suddenly stop. No errors in the app; backend SNS / APNS logs show `InvalidToken` or 403 responses. Only affects iOS.

**Cause.** The APNS `.p8` key has been **revoked** (rotated by another team member, or the original creator left the team and their access was removed). The key itself never expires by time, but it does get removed by human action.

**Fix.** Generate a new key in App Store Connect (§4.1), upload via `eas credentials --platform ios`, update the backend APNS sender config, and redeploy the backend. No app rebuild needed — the key is server-side.

### 11.2 OTA update not delivered — channel/profile mismatch

**Symptom.** You ran `eas update --branch production`, the CLI reported success, but no user got the update.

**Cause.** The production **build** has `channel: "prod"` (typo) in `eas.json` but the **update** went to branch `production`. Because channel ≠ branch, no client polls for this branch.

**Fix.** Confirm with `eas channel:view production` and `eas update:list --branch production`. Both must show the same name, and the installed app's `Updates.channel` must equal that name. The client value can be read in-app:

```ts
import * as Updates from "expo-updates";
console.log("[updates] channel:", Updates.channel);
```

### 11.3 Config plugin not re-run after `prebuild --clean`

**Symptom.** You edited `plugins/with-acme-push.ts`, ran `eas build`, and the new behavior is absent in the built app.

**Cause.** EAS Build caches `ios/` and `android/` on its side. A plugin edit **does** invalidate the cache, but if the git diff only touches `plugins/` and not `app.config.ts`, the cache fingerprint sometimes misses the change.

**Fix.** Explicitly clear: `eas build --clear-cache --profile preview --platform ios`. For local builds, `npx expo prebuild --clean --platform ios` before `eas build --local`. When in doubt, touch `app.config.ts` (add a no-op whitespace change) to force a fingerprint miss.

### 11.4 iOS build rejected for missing privacy manifest

**Symptom.** `eas submit` succeeds, but 30 minutes later you get an email from Apple: "We have discovered one or more issues with your recent delivery... missing API declaration."

**Cause.** A dependency uses a required-reason API and its `PrivacyInfo.xcprivacy` is either missing or not picked up by Apple's aggregator.

**Fix.** Read the Apple email — it lists the exact API category. Add the matching `NSPrivacyAccessedAPITypes` entry to your `app.config.ts` `privacyManifests`. Rebuild, resubmit. See §10.

### 11.5 Android 14 `FOREGROUND_SERVICE_DATA_SYNC` missing

**Symptom.** Build succeeds, but the app crashes on launch on Android 14 devices with `SecurityException: Starting FGS with type none ... targetSDK=34`.

**Cause.** You declared `FOREGROUND_SERVICE` permission (directly or via `expo-background-fetch`) but did not declare a type via `android:foregroundServiceType`.

**Fix.** Add the matching `android.permission.FOREGROUND_SERVICE_DATA_SYNC` (or `_MEDIA_PLAYBACK`, `_LOCATION`, etc) permission and set the `service` element's `android:foregroundServiceType`. See §5.4.

### 11.6 Expo push token works locally, fails in TestFlight

**Symptom.** `getExpoPushTokenAsync` returns a token in dev; the same call in TestFlight returns nothing or throws.

**Cause.** You did not upload the APNS key to EAS (`eas credentials` → Push Notifications). The dev client does not need it because it routes through sandbox APNS via Expo's servers; TestFlight and App Store builds do need it.

**Fix.** Upload the APNS `.p8` per §4.1. Rebuild.

### 11.7 Android notification icon is a white square

**Symptom.** Notifications render with a blank white square where the icon should be.

**Cause.** Android 5+ requires notification icons to be **monochrome** (alpha channel only; the color is tinted by the system). You supplied a full-color PNG.

**Fix.** Provide a `notification.icon` asset to `expo-notifications` in `app.config.ts`:

```ts
plugins: [
  [
    "expo-notifications",
    {
      icon: "./assets/notification-icon.png", // Monochrome, 96x96 recommended.
      color: "#FF231F7C",
    },
  ],
];
```

Create the icon as a white-on-transparent PNG. Android tints it using the `color` value.

---

## Section 12: Verification

Run before every production release and after any native-config change.

### 12.1 Pre-flight — one-shot commands

```bash
# 1. Schema + plugin validation. This is the fastest proof your config isn't broken.
npx expo config --json | jq '.plugins | length'
# Expected: a positive integer (e.g., 4). 0 or parse errors mean app.config.ts is broken.

# 2. Prebuild diff. Show what your plugins produce.
npx expo prebuild --platform ios --clean
git diff --stat ios/
# Expected: changes to AppDelegate, Info.plist, *.entitlements. Empty diff = plugins not running.

# 3. Preview iOS build (local or cloud).
eas build --profile preview --platform ios --local  # fastest feedback; requires Xcode.
# OR
eas build --profile preview --platform ios           # cloud; 8-15 min.
```

### 12.2 Channel + update sanity

```bash
# Confirm the preview channel exists and has a build pointing at it.
eas channel:view preview

# Confirm the latest update on the preview branch.
eas update:list --branch preview --limit 3

# In-app, log the channel at boot (remove before production):
# console.log("[updates] channel:", Updates.channel, "runtimeVersion:", Updates.runtimeVersion);
```

### 12.3 Push token echo test

A real device + a backend echo endpoint is the most reliable proof push works end-to-end.

```bash
# 1. Run the app on a real device, sign in.
# 2. In the app, read the token the registration function captured
#    (exposed via a dev-only debug screen or a console.log).
# 3. Send yourself a test push from the backend (or via expo's test tool for Expo tokens):
curl -X POST https://api.acme.shop/dev/push \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEV_SECRET" \
  -d '{"token":"<device-token>","platform":"apns","payload":{"aps":{"alert":{"title":"Test","body":"Hi"}},"data":{"url":"/orders/test123"}}}'
# 4. Notification arrives. Tap it. App opens at /orders/test123.
```

If step 4 fails: log `addNotificationResponseReceivedListener` output. If the listener fires but the URL is wrong, the payload's `data.url` is missing — check backend. If the listener doesn't fire, confirm `wireNotificationResponses` is subscribed from the root layout (§3.4).

### 12.4 OTA round-trip dry run

```bash
# 1. Note the current runtimeVersion in app.config.ts.
# 2. Change a user-visible string (e.g., greeting text).
eas update --branch preview --message "test: greeting text change"
# 3. Force-close and reopen the app on your preview device.
# 4. See the change within the first 10 seconds (our useUpdates polls on foreground).
# 5. Revert the change + republish so the next build doesn't ship with "test" content.
eas update:republish --branch preview --group <previous-group-id>
```

If step 4 fails: check that `Updates.channel === "preview"` in the app (dev-only log). Check that `eas update:list --branch preview` shows your update. Check network — OTA update URLs go to `https://u.expo.dev/<project-id>`.

### 12.5 Privacy manifest audit

Before every production submission:

```bash
# 1. Grep the prebuilt ios/ folder for all aggregated xcprivacy files.
npx expo prebuild --platform ios --clean
find ios/Pods -name "PrivacyInfo.xcprivacy" -print
# Review each: do they cover everything your app does?

# 2. Compare against app.config.ts privacyManifests.
npx expo config --json | jq '.ios.privacyManifests'
# Ensure NSPrivacyAccessedAPITypes covers at least UserDefaults (most apps need this).
```

If a new dependency ships no manifest, add the reason to your `app.config.ts` before submitting. See §10.3.

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — `app.config.ts` plugin-array mechanics, `prebuild --clean` rule, EAS profile conventions the `eas.json` in §7.1 extends.
  - `./01-navigation.md` — `router.push("/orders/[id]")` in `wireNotificationResponses`; the `(shop)` layout that calls `useUpdates()` and `registerPushNotifications(userId)`.
  - `./02-state-and-data.md` — The mutation queue whose next-attempt may run inside a silent-push wake-up window; why background work must complete in <30s on iOS.
  - `./03-auth-and-networking.md` — `apiClient.post("/devices", ...)` used by `registerPushNotifications`; the `tokenStore` that silent push may read on a cold wake.
  - `./08-observability.md` — Sentry source maps uploaded via `eas-build-post-install` hooks in EAS Build profiles; session-id correlation across OTA updates.
  - `./09-monetization.md` — `react-native-purchases` integration that consumes the IAP capability / `BILLING` permission this file configures.
  - `./10-gotchas.md` — Full diagnostic catalogue; §11 above is a curated subset.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — Backend side of push: SNS platform endpoints, APNS/FCM credential handling, the `POST /devices` handler, and the push-send API.
  - `../../aws-cdk-patterns/references/02-auth-stack.md` — How the `userId` passed to `registerPushNotifications` maps to a Cognito principal.
- **External documentation:**
  - [Expo — `expo-notifications`](https://docs.expo.dev/versions/latest/sdk/notifications/) — `setNotificationHandler`, `addNotificationResponseReceivedListener`, `getDevicePushTokenAsync`, category / action API.
  - [Expo — `expo-updates`](https://docs.expo.dev/versions/latest/sdk/updates/) — `checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync`, `Updates.channel`, `Updates.runtimeVersion`.
  - [Expo — Config plugins authoring](https://docs.expo.dev/config-plugins/plugins-and-mods/) — `withInfoPlist`, `withEntitlementsPlist`, `withAndroidManifest`, `withDangerousMod` semantics.
  - [Expo — Modules API](https://docs.expo.dev/modules/overview/) — When and how to write a native module in Swift / Kotlin.
  - [Expo — EAS Build credentials](https://docs.expo.dev/app-signing/app-credentials/) — Apple distribution cert, APNS key upload, Android keystore backup and restore.
  - [Expo — EAS Submit](https://docs.expo.dev/submit/introduction/) — iOS `appleId` / `ascAppId` / `appleTeamId`, Android service-account key, TestFlight groups.
  - [Apple — Required Reason API list](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api) — Canonical reason codes for `PrivacyInfo.xcprivacy`.
  - [Apple — APNS authentication](https://developer.apple.com/documentation/usernotifications/establishing_a_token-based_connection_to_apns) — `.p8` key setup and rotation.
  - [Android — Notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission) — `POST_NOTIFICATIONS` semantics, behavior across API levels.
  - [Android 14 — Foreground service types](https://developer.android.com/about/versions/14/changes/fgs-types-required) — `dataSync`, `mediaPlayback`, `location`, etc.
