# expo-react-native skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an `expo-react-native` skill under `plugins/dev-patterns/` that teaches Claude how to build, ship, and maintain Expo / React Native mobile apps end-to-end, with tight integration to `aws-cdk-patterns` (backend) and `dynamodb-design` (write-correctness on mobile edits). Closes the three-skill roadmap for `dev-patterns`.

**Architecture:** Theme-oriented, progressive disclosure. Lean `SKILL.md` routes Claude to 11 topic references (architecture, navigation, state/data, auth/networking, native/release, web, performance/testing, i18n/a11y, observability, monetization, gotchas). Mirror the `dynamodb-design` testing harness. Cross-references bidirectional with `aws-cdk-patterns/02-auth-stack.md`; forward links to `dynamodb-design` for conflict handling.

**Tech Stack:** Markdown reference files. TypeScript code snippets using Expo SDK + first-party Expo modules (`expo-router`, `expo-auth-session`, `expo-notifications`, `expo-updates`, `expo-secure-store`, `expo-localization`) and battle-tested community libraries (`@tanstack/react-query`, `zustand`, `react-native-mmkv`, `@shopify/flash-list`, `react-native-reanimated`, `@sentry/react-native`, `i18next` + `react-i18next`, `react-native-purchases` / RevenueCat). PowerShell 7+ and Bash for the test harness. **Every library API verified against current docs via context7 before committing.**

**Source of truth:** `plans/2026-04-23-expo-react-native-skill-design.md`

---

## Working conventions (apply to every task)

- **Language:** English for all skill content (matches `aws-cdk-patterns` and `dynamodb-design`).
- **Code style:** TypeScript `strict: true`, explicit imports, no `any`, no elided error handling. Units annotated (`ms`, `dp`, `px`, `MB`) wherever numeric.
- **SDK verification (MANDATORY):** Before committing *any* code snippet that uses a third-party library, resolve the library ID via `mcp__context7__resolve-library-id` and fetch current usage via `mcp__context7__query-docs`. No reliance on training-data memory for library APIs. Examples of libraries to verify per reference:
  - Tasks 2-3: `expo` (SDK version), `expo-router`, `expo-linking`
  - Task 4: `@tanstack/react-query`, `zustand`, `react-native-mmkv`, `expo-secure-store`
  - Task 5: `expo-auth-session`, `expo-local-authentication`, `expo-secure-store`
  - Task 6: `expo-notifications`, `expo-updates`, `react-native-iap` or `react-native-purchases` (RevenueCat), EAS Build docs
  - Task 7: `expo` (web target), `nativewind`
  - Task 8: `@shopify/flash-list`, `react-native-reanimated`, `expo-image`, `@testing-library/react-native`, Maestro / Detox
  - Task 9: `expo-localization`, `i18next`, `react-i18next`, `eslint-plugin-react-native-a11y`
  - Task 10: `@sentry/react-native`, `posthog-react-native` (or equivalent)
  - Task 11: `react-native-purchases` (RevenueCat), `react-native-iap`
- **SDK version pin:** Each reference's intro includes a line: `Examples verified against Expo SDK <X> on <YYYY-MM-DD>. Re-verify via context7 before porting to a newer SDK.`
- **Cross-reference format:** relative paths with anchor names.
  - From this skill to `aws-cdk-patterns`: `../../aws-cdk-patterns/references/<file>.md` + section name.
  - From this skill to `dynamodb-design`: `../../dynamodb-design/references/<file>.md`.
  - From `aws-cdk-patterns` back to this skill (added in Task 14): `../../expo-react-native/references/03-auth-and-networking.md`.
- **Backbone example:** e-commerce mobile client (catalog, cart, checkout, order history) that threads through every reference. Consumes the backend from `aws-cdk-patterns` + `dynamodb-design`. Keeps code snippets consistent across references.
- **Commit cadence:** one commit per task. Message format: `feat(expo-react-native): <summary>` or `docs(expo-react-native): <summary>`.
- **Do not auto-push.** User explicitly confirms before any `git push`.

---

## Task 1: Scaffold directory + SKILL.md

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/SKILL.md`
- Create (empty placeholders): `plugins/dev-patterns/skills/expo-react-native/references/.gitkeep`, `plugins/dev-patterns/skills/expo-react-native/scripts/.gitkeep`, `plugins/dev-patterns/skills/expo-react-native/tests/.gitkeep`

- [ ] **Step 1: Create directory skeleton**

```bash
mkdir -p plugins/dev-patterns/skills/expo-react-native/references \
         plugins/dev-patterns/skills/expo-react-native/scripts \
         plugins/dev-patterns/skills/expo-react-native/tests
touch plugins/dev-patterns/skills/expo-react-native/references/.gitkeep \
      plugins/dev-patterns/skills/expo-react-native/scripts/.gitkeep \
      plugins/dev-patterns/skills/expo-react-native/tests/.gitkeep
```

- [ ] **Step 2: Write SKILL.md**

Frontmatter: `name: expo-react-native` (lowercase, hyphens), description optimized for Claude Search Optimization without a workflow summary. Mirrors `dynamodb-design/SKILL.md` format.

Content:

```markdown
---
name: expo-react-native
description: Build, ship, and maintain Expo / React Native mobile apps. Covers project scaffold (feature-folder DDD, expo-router, EAS profiles), navigation + deep links, client and server state (Zustand + TanStack Query) with offline sync, Cognito + Google federation via expo-auth-session, push notifications, OTA updates, EAS Build / Submit, web / PWA target, performance (Hermes, FlashList, reanimated), testing (Jest + RNTL + Maestro), i18n + accessibility, observability (Sentry + analytics), in-app purchases and subscriptions with RevenueCat. TypeScript examples, gotchas catalog.
---

# Expo / React Native

Opinionated patterns for Expo managed workflow (with dev client) on iOS, Android, and web. Integrates with the AWS backend patterns in `aws-cdk-patterns` and the data-correctness patterns in `dynamodb-design`.

## When to load each reference

| Task | Reference file |
|------|----------------|
| Starting a new Expo app | `references/00-architecture.md` + `references/01-navigation.md` |
| Adding a new screen or route | `references/01-navigation.md` |
| Client state, server state, or offline sync | `references/02-state-and-data.md` |
| Cognito / Google sign-in, API calls with auth | `references/03-auth-and-networking.md` |
| Push notifications, OTA updates, EAS Build / Submit, IAP config | `references/04-native-and-release.md` |
| Shipping to web / PWA | `references/05-cross-platform-web.md` |
| Performance tuning or test setup | `references/06-performance-and-testing.md` |
| Localization, RTL, or accessibility audit | `references/07-i18n-and-accessibility.md` |
| Crash reporting or analytics | `references/08-observability.md` |
| Subscriptions, paywalls, receipt validation | `references/09-monetization.md` |
| Diagnosing a production symptom | `references/10-gotchas.md` |

## Conventions

- Code examples use TypeScript (`strict: true`) with the latest stable Expo SDK. Each reference's intro pins the verification date so future readers know when to re-verify.
- `expo-router` for navigation (not `react-navigation` directly — `expo-router` wraps it with file-based conventions).
- Managed workflow + dev client by default; escape hatch via config plugins. Bare workflow is out of scope.
- Every runtime code snippet is paired with a verification command or test pattern when one applies.

## Further reading

- Sibling skill: `aws-cdk-patterns` — AWS backend infrastructure. Mobile consumes `02-auth-stack.md` (Cognito), `01-serverless-api.md` (API Gateway), `03-static-site.md` (web hosting for Expo-for-web builds).
- Sibling skill: `dynamodb-design` — when mobile edits conflict with concurrent writes, `03-write-correctness.md` §optimistic-locking explains the server-side semantics the mobile client must handle.
```

- [ ] **Step 3: Verify SKILL.md loads cleanly**

Run: `cat plugins/dev-patterns/skills/expo-react-native/SKILL.md | head -50`
Expected: Frontmatter parses, routing table readable.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/
git commit -m "feat(expo-react-native): scaffold skill directory and SKILL.md router"
```

---

## Task 2: Write `00-architecture.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/00-architecture.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites header (matches `aws-cdk-patterns` reference file format)
2. Contents (numbered TOC)
3. Workflow choice — managed + dev client vs bare; when each is right. Recommended: managed + dev client.
4. Scaffold — `create-expo-app` with TypeScript template; prune to feature-folder / DDD structure. Show the target tree with `src/features/<domain>/` (with `screens/`, `components/`, `services/`, `types.ts`), `src/shared/`, and `app/` (expo-router).
5. Config plugins — what they are, `app.config.ts` authoring, reading order with `expo prebuild`, idempotency requirements, `--clean` lifecycle.
6. Environment / secrets — `app.config.ts` access, `process.env.EXPO_PUBLIC_*` for client-safe values, EAS secrets for build-time values, `.env` loading with `dotenv` in the Expo config, never committing `.env`.
7. EAS profiles — `development` / `preview` / `production` profile conventions, channel + distribution config, per-profile bundle identifiers (`com.acme.app` vs `com.acme.app.dev`).
8. Worked-example intro — e-commerce mobile client: explain what it is, which sibling skill's backend it consumes, and how later references build on it.
9. Gotchas (subset — architecture-specific)
10. Verification — `npx expo doctor`, `eas build:configure`, `npx expo prebuild --platform ios --clean`
11. Further reading

- [ ] **Step 2: Verify current Expo APIs via context7**

```
mcp__context7__resolve-library-id("expo")
mcp__context7__query-docs for "expo managed workflow vs bare dev client"
mcp__context7__query-docs for "eas build profile configuration"
mcp__context7__query-docs for "expo app config plugin prebuild lifecycle"
```

Confirm: current SDK version, EAS profile schema, config plugin API.

- [ ] **Step 3: Write the file**

Target ~600-800 lines. Code blocks for: feature-folder tree (ASCII), `app.config.ts` with profile-aware env injection, a minimal config plugin that adds an Info.plist key, an `eas.json` with three profiles.

- [ ] **Step 4: Spot-check**

Run: `grep -nE 'expo-cli|react-native init' plugins/dev-patterns/skills/expo-react-native/references/00-architecture.md`
Expected: zero matches. `expo-cli` is deprecated (replaced by `npx expo`); `react-native init` is for the bare workflow we explicitly exclude.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/00-architecture.md
git commit -m "feat(expo-react-native): add 00-architecture.md"
```

---

## Task 3: Write `01-navigation.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/01-navigation.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. `expo-router` file-based routing — `app/` directory conventions, `_layout.tsx`, `index.tsx`, route groups `(auth)` / `(app)`, catch-all `[...slug].tsx`.
4. Nested layouts — stacks inside tabs inside a root layout; modal presentation mode; shared headers; back-behavior customization.
5. Typed routes — `experiments.typedRoutes: true` in `app.config.ts`, typed `router.push({ pathname, params })`, typed `<Link href={}>`.
6. Protected routes — auth guard pattern with `<Redirect href="/login" />` inside `_layout.tsx`; loading state to avoid flash; splash-screen integration with `expo-splash-screen`.
7. Deep links — universal links (iOS) / app links (Android) setup, domain association file requirements, `expo-linking` for URL parsing and programmatic generation, cold-start vs warm-start handling via `Linking.useURL()`.
8. Paywall deep-link entry — scenario: open `/paywall?sku=premium_monthly` from push notification or email. Code pattern: `router.replace` vs `router.push`, handling auth state before paywall. Cross-reference to `09-monetization.md`.
9. Gotchas (nav-specific) — typed-routes not regenerating after new file, deep links not working in TestFlight but fine in dev, tab bar flash on protected-route redirect.
10. Verification — `npx expo-router list`, typed-routes type-check, simulator deep-link tests (`xcrun simctl openurl`, `adb shell am start`).
11. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "expo-router file-based routing typed routes"
mcp__context7__query-docs for "expo-router protected route redirect auth"
mcp__context7__query-docs for "expo-linking universal links app links"
```

Confirm: current `expo-router` API (v3+), `<Redirect>` vs imperative redirect, `Linking` vs `expo-linking` split.

- [ ] **Step 3: Write the file**

Target ~500-700 lines. Code blocks for: `app/_layout.tsx` root, `app/(app)/_layout.tsx` tabs-with-guard, `app/(auth)/_layout.tsx` stack, `app/product/[id].tsx` detail screen (typed params), deep-link handler in `app/_layout.tsx`.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/01-navigation.md
git commit -m "feat(expo-react-native): add 01-navigation.md"
```

---

## Task 4: Write `02-state-and-data.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/02-state-and-data.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. Client state — Zustand recommended; when Redux Toolkit is warranted (team experience, dev-tools needs, action replay); why context is limited to theme/auth.
4. Server state — TanStack Query for network state; defaults (`staleTime: 5 * 60_000`, `gcTime: 24 * 3600_000`, `retry: 3`); offline + `networkMode: 'offlineFirst'`; optimistic mutations with `onMutate` / `onError` / `onSettled` + snapshot rollback.
5. Storage tradeoffs — decision table:
   - `expo-secure-store` → tokens, biometric-guarded secrets (iOS keychain, Android keystore)
   - `react-native-mmkv` → high-frequency app state, sync reads, encrypted by default, 30x faster than AsyncStorage
   - `AsyncStorage` → legacy; avoid unless compatibility forces it
6. Offline sync — mutation queue pattern: persist pending mutations to MMKV, replay on network return, detect stale state via server `version` on hydration (cross-link to `dynamodb-design/03-write-correctness.md` §optimistic-locking).
7. Optimistic updates — full cart-increment example with TanStack Query: `onMutate` cancels in-flight queries, snapshots current data, applies optimistic patch; `onError` rolls back; `onSettled` invalidates. Visual feedback pattern (subtle pending-state UI).
8. Background sync — `expo-task-manager` for iOS/Android background fetch; constraints (not guaranteed timing; iOS minimum 15min interval); when a dedicated push-driven sync is better.
9. Gotchas (state/data-specific) — Zustand persist without MMKV performance penalty, TanStack Query `gcTime` naming change from v4, secure-store biometric prompt blocking on app resume.
10. Verification — React Query Devtools flipper-style; MMKV read perf sanity check.
11. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "zustand persist middleware react native mmkv"
mcp__context7__query-docs for "@tanstack/react-query optimistic updates onMutate rollback"
mcp__context7__query-docs for "@tanstack/react-query networkMode offlineFirst"
mcp__context7__query-docs for "react-native-mmkv encryption api"
mcp__context7__query-docs for "expo-secure-store keychain keystore"
```

Confirm: current TanStack Query v5 API (`gcTime` vs old `cacheTime`), MMKV encryption config, `expo-task-manager` min interval.

- [ ] **Step 3: Write the file**

Target ~700-900 lines. Full TS for: Zustand store with MMKV persist, TanStack Query provider, optimistic-cart-mutation hook, offline mutation queue writer/replayer, token cache with SecureStore wrapper.

- [ ] **Step 4: Spot-check**

Run: `grep -nE 'cacheTime|AsyncStorage' plugins/dev-patterns/skills/expo-react-native/references/02-state-and-data.md`
Expected: `cacheTime` appears only in a migration note ("renamed to `gcTime` in v5"); `AsyncStorage` only in the decision table's "avoid" row.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/02-state-and-data.md
git commit -m "feat(expo-react-native): add 02-state-and-data.md"
```

---

## Task 5: Write `03-auth-and-networking.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/03-auth-and-networking.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. Cognito + Google federation — `expo-auth-session` with `AuthRequest` + PKCE; Cognito hosted UI as the IdP broker; required config (`userPoolId`, `userPoolWebClientId`, `domain`, `redirectUri` matching what `aws-cdk-patterns` provisioned). Cross-link to `aws-cdk-patterns/02-auth-stack.md` for pool setup.
4. Token storage — access / ID / refresh tokens in `expo-secure-store`; never in AsyncStorage; never in Zustand persist without encryption. Code: `tokenStore.ts` wrapper with `get`, `set`, `clear`.
5. Refresh flow — detect 401 in a fetch interceptor, queue concurrent requests during refresh (single-flight pattern), handle refresh failure by signing out and redirecting to login. Full TS for the interceptor.
6. Networking abstraction — single `apiClient` wrapper around `fetch`: base URL per EAS profile, auth interceptor, retry with exponential backoff + jitter, timeout, typed response envelopes matching `aws-cdk-patterns` `ApiResponse<T>` / `ErrorCodes`.
7. SigV4 vs JWT — when each applies. JWT is the default for API Gateway with Cognito authorizer. SigV4 only when mobile calls IAM-authorized APIs directly (rare; requires Cognito Identity Pool).
8. Stale-data conflicts — `ConditionalCheckFailedException` surfaces as HTTP 409 from backend; UI pattern "this item changed; refresh to see the latest" with a retry affordance. Cross-link to `dynamodb-design/03-write-correctness.md` §optimistic-locking.
9. Biometric unlock — `expo-local-authentication` gating access to the stored refresh token on cold start / app resume; handling "user cancelled" vs "biometrics not enrolled" vs "hardware missing".
10. Gotchas (auth-specific) — Cognito redirect loop from callback URL mismatch, SecureStore biometric prompt blocking on app resume, single-flight refresh not covering concurrent 401s, JWT clock skew.
11. Verification — `expo-auth-session` discovery document fetch sanity check, forced-401 retry test.
12. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "expo-auth-session AuthRequest PKCE cognito hosted ui"
mcp__context7__query-docs for "expo-secure-store options iOS keychain android keystore"
mcp__context7__query-docs for "expo-local-authentication biometric fallback"
```

Confirm: `expo-auth-session` API version (v5+), SecureStore `requireAuthentication` option, `LocalAuthentication.authenticateAsync` response shape.

- [ ] **Step 3: Write the file**

Target ~700-900 lines. Full TS for: `tokenStore.ts`, `apiClient.ts` (with interceptor + single-flight refresh + retry), `useAuth.tsx` Zustand hook, `signInWithGoogle.ts` via `expo-auth-session`, 409-conflict UI example.

- [ ] **Step 4: Spot-check cross-references**

Run: `grep -nE 'aws-cdk-patterns|dynamodb-design' plugins/dev-patterns/skills/expo-react-native/references/03-auth-and-networking.md`
Expected: at least one link to `../../aws-cdk-patterns/references/02-auth-stack.md` and one to `../../dynamodb-design/references/03-write-correctness.md`.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/03-auth-and-networking.md
git commit -m "feat(expo-react-native): add 03-auth-and-networking.md"
```

---

## Task 6: Write `04-native-and-release.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/04-native-and-release.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. Expo modules API — when to reach for it vs a config plugin vs a community package; building a minimal Expo module for a platform-specific capability; when the managed workflow escape hatch is needed.
4. Config plugins in practice — authoring a plugin that adds an iOS entitlement + an Android permission + an Info.plist key; plugin idempotency and `--clean` lifecycle; common pitfalls (plugin order, missing in `app.config.ts`).
5. Push notifications — `expo-notifications` with FCM (Android) + APNS (iOS) direct. Token registration flow: `getExpoPushTokenAsync` vs direct native tokens; foreground vs background handling via `setNotificationHandler` + `addNotificationResponseReceivedListener`; notification categories / actions; deep-link from notification payload → `router.push`. Optional: AWS SNS / Pinpoint as broker with brief note.
6. iOS entitlements + APNS key — App Store Connect key upload to EAS; foreground vs background entitlement config.
7. Android 13+ `POST_NOTIFICATIONS` — runtime permission flow, handling denial gracefully.
8. OTA updates — `expo-updates` channels crossed with EAS profiles; update strategy (`checkForUpdateAsync` on app start vs on resume); rollback via republishing previous bundle; testing updates in preview profile.
9. EAS Build — build profiles, credentials management (Apple distribution cert + APNS key + Android keystore), EAS secrets vs `process.env.EXPO_PUBLIC_*` (which is which), build caching gotchas, iOS simulator builds for CI.
10. EAS Submit — automated submission to App Store Connect + Play Console, metadata handling, initial-submission vs update flow, `eas submit --profile production`.
11. In-app purchases setup — native-side config: `In-App Purchase` capability (iOS), `com.android.vending.BILLING` permission (Android). EAS config. App Store Connect + Play Console product creation. **Implementation lives in `09-monetization.md`.**
12. iOS privacy manifests (iOS 17+) — required `PrivacyInfo.xcprivacy`; how EAS auto-generates for first-party modules; how to add for third-party modules that don't ship one; common rejection patterns.
13. Gotchas (native/release-specific) — push tokens silent when APNS key expired, OTA bundle not delivered due to channel/profile mismatch, config plugin not re-run after `prebuild --clean`, iOS build rejected for missing privacy manifest, Android foreground-service type missing on Android 14.
14. Verification — `eas build --profile preview --platform ios --local` smoke, `eas channel:view preview`, push-token echo test.
15. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "expo-notifications ios apns android fcm setup"
mcp__context7__query-docs for "expo-updates channels eas profile"
mcp__context7__query-docs for "eas build credentials apple android"
mcp__context7__query-docs for "eas submit app store connect play console"
mcp__context7__query-docs for "ios privacy manifest xcprivacy 2024"
mcp__context7__query-docs for "expo config plugin authoring"
```

Confirm: `expo-notifications` current listener API, `expo-updates` channel config, privacy manifest requirement scope.

- [ ] **Step 3: Write the file**

Target ~800-1100 lines. Full TS for: `expo-notifications` registration + handler + deep-link-from-payload, OTA `useUpdates` hook, minimal config plugin adding entitlement + permission, `eas.json` with three build profiles + submit profile.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/04-native-and-release.md
git commit -m "feat(expo-react-native): add 04-native-and-release.md"
```

---

## Task 7: Write `05-cross-platform-web.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/05-cross-platform-web.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. When Expo-for-web is viable — UI-heavy / form-driven apps that share 80%+ logic; when to build a separate React or Next.js app instead (SEO-critical, heavy desktop-only features).
4. Build config — `npx expo export --platform web`, output folder, static-hosting expectations.
5. `Platform.select` patterns — platform-specific files (`.ios.tsx` / `.android.tsx` / `.web.tsx`), avoiding if/else sprawl, feature-flag abstractions for capability detection.
6. Responsive layouts — `useWindowDimensions`, breakpoint helpers (`isPhone`, `isTablet`, `isDesktop`), layout components that switch between mobile-first and desktop shells.
7. NativeWind vs StyleSheet — tradeoffs: NativeWind (Tailwind-on-RN) for rapid UI consistent across platforms; StyleSheet for perf-critical paths or when Tailwind's footprint is undesirable. Decision guidance.
8. PWA gotchas — `manifest.json` generation, service worker when targeting installable web, `expo-web-browser` vs in-app browser navigation, SEO caveats (Expo-for-web is CSR; SSR requires Next.js).
9. Deployment — brief note: static hosting with S3 + CloudFront per `aws-cdk-patterns/03-static-site.md` — cross-link.
10. Gotchas (web-specific) — NativeWind classes not applied on web (missing content glob), `expo-image` web fallback, native-only module imports breaking web bundle, flex behavior diffs on web.
11. Verification — `npx expo export --platform web`, bundle-size check, Lighthouse PWA score.
12. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "expo for web export platform web"
mcp__context7__query-docs for "nativewind tailwind react native web config"
```

Confirm: current web-target build command, NativeWind config syntax.

- [ ] **Step 3: Write the file**

Target ~400-600 lines. Code blocks for: `Platform.select` examples, responsive layout component, NativeWind config with web content glob, PWA manifest template.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/05-cross-platform-web.md
git commit -m "feat(expo-react-native): add 05-cross-platform-web.md"
```

---

## Task 8: Write `06-performance-and-testing.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/06-performance-and-testing.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. Hermes — default JS engine since SDK 50; profiling via Hermes profiler; bridgeless mode; when to turn off (rare, specific legacy-module incompatibilities).
4. New architecture (Fabric + TurboModules) — current status via context7 verification at write-time; migration checklist for existing apps; which libraries are Fabric-ready vs interop-via-bridge.
5. Lists — `FlatList` pitfalls (inline render functions causing re-renders, missing `keyExtractor`, lack of `getItemLayout` for large item counts); `FlashList` (Shopify) for long / heterogeneous lists; comparison table.
6. Animations — `react-native-reanimated` v3 worklets, shared values, layout animations (`LinearTransition`); avoiding JS bridge during animation (worklet-only paths); `Gesture.Pan` + `useAnimatedStyle`.
7. Images — `expo-image` caching, placeholder strategies (`blurhash`), dimension hints to avoid layout thrash, priority prop for above-the-fold.
8. Bundle size — analyzing with `expo export --dump-assetmap`, tree-shaking pitfalls (named imports from barrel files), lazy loading screens via `expo-router` groups (each group bundles together).
9. Testing — Jest + React Native Testing Library for components and hooks; MSW (`msw/native`) for network mocking; Detox vs Maestro comparison (Maestro recommended for simpler setup, Detox for deeper control over native state); testing deep links via `expo-linking` mocks; testing push-notification handlers.
10. CI integration — running unit + lint + type-check in GitHub Actions; E2E on EAS Build preview via Maestro Cloud; sample workflow YAML.
11. Gotchas (perf/test-specific) — Jest + Expo config missing, RNTL not rendering `expo-router` screens (need test wrapper with `ExpoRouter` provider), Maestro flakes on iOS simulator Rosetta, FlatList jank from inline image sizes.
12. Verification — `npm test`, `npx maestro test`, Hermes profiler recording.
13. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "expo sdk new architecture fabric turbomodules status"
mcp__context7__query-docs for "@shopify/flash-list api props"
mcp__context7__query-docs for "react-native-reanimated v3 worklets shared values"
mcp__context7__query-docs for "expo-image props caching priority"
mcp__context7__query-docs for "@testing-library/react-native jest-expo preset"
mcp__context7__query-docs for "maestro test flows ios android"
```

Confirm: new-architecture opt-in vs default status at write time, FlashList v2 API, RNTL + Expo preset config.

- [ ] **Step 3: Write the file**

Target ~700-900 lines. Full TS for: FlashList config with `estimatedItemSize`, reanimated shared-value animation, RNTL component test, Maestro flow YAML, GitHub Actions workflow snippet.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/06-performance-and-testing.md
git commit -m "feat(expo-react-native): add 06-performance-and-testing.md"
```

---

## Task 9: Write `07-i18n-and-accessibility.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/07-i18n-and-accessibility.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. i18n setup — `expo-localization` for device locale detection; `i18next` + `react-i18next` for string tables; namespace-per-feature convention (`features/checkout/locales/en.json`); translation-key extraction workflow with `i18next-parser`.
4. Pluralization and interpolation — ICU messageFormat via `i18next-icu`; avoiding string concatenation; gender/count handling.
5. Date / number formatting — `Intl.DateTimeFormat` / `Intl.NumberFormat` via Hermes; relative time with `date-fns` / `dayjs`; currency formatting for e-commerce.
6. RTL handling — `I18nManager.forceRTL`, app-restart requirement on iOS, `flexDirection: 'row-reverse'` patterns, icons that should mirror vs stay fixed (mnemonic: directional = mirror; symbolic = fixed).
7. Accessibility APIs — `accessibilityLabel`, `accessibilityHint`, `accessibilityRole`, `accessibilityState`; `accessibilityLiveRegion` for dynamic updates; `accessible={true}` to treat a group as one element; `importantForAccessibility` on Android.
8. Focus order — checklist: logical reading order, focus-trap in modals, `accessibilityViewIsModal`, proper focus on screen transitions.
9. Testing with VoiceOver (iOS) and TalkBack (Android) — how to enable, gesture basics, what to listen for, common failure patterns (custom buttons that aren't announced, form fields without labels, decorative icons read aloud).
10. Automated a11y checks — `eslint-plugin-react-native-a11y` rules and setup; CI step to catch regressions; limits of static analysis.
11. Gotchas (i18n/a11y-specific) — translation keys missing after feature merge (extraction workflow bypass), RTL not applied after first install (iOS cache requires reinstall), VoiceOver focus stuck on hidden view, dynamic-font-size breaking layouts.
12. Verification — snapshot test per locale, a11y lint pass in CI, manual VoiceOver/TalkBack pass checklist.
13. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "expo-localization getLocales current api"
mcp__context7__query-docs for "i18next react-i18next setup expo"
mcp__context7__query-docs for "react native accessibility props label role state"
mcp__context7__query-docs for "eslint-plugin-react-native-a11y rules"
```

Confirm: `expo-localization` `getLocales()` vs deprecated `locale`, `react-i18next` provider pattern, accessibility API field names.

- [ ] **Step 3: Write the file**

Target ~500-700 lines. Full TS for: i18next init with namespace loader and MMKV-cached language choice, RTL-aware layout component, accessible custom button, a11y test suite example.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/07-i18n-and-accessibility.md
git commit -m "feat(expo-react-native): add 07-i18n-and-accessibility.md"
```

---

## Task 10: Write `08-observability.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/08-observability.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. Sentry — setup via `@sentry/react-native` + Expo config plugin (`@sentry/react-native/expo`); source map upload in EAS Build via post-build hook; crash + JS error + performance monitoring in one; session replay (privacy implications).
4. Privacy scrubbing — `beforeSend` hook to redact PII; masking sensitive fields (`password`, `token`, email patterns).
5. Analytics — PostHog recommended (open source, privacy-first, feature flags in one); Amplitude as alternative; Firebase Analytics when Google ecosystem dominates. Decision table.
6. Event taxonomy — standardize on `noun_verb` naming (`checkout_started`, `paywall_viewed`); include a shared `eventName` constants file; never ship ad-hoc strings. Show extracted event catalog for e-commerce.
7. User identification — post-login `Sentry.setUser({ id })` + analytics `identify`; post-logout `Sentry.setUser(null)` + `reset` to avoid cross-contamination on shared devices.
8. Release health — session tracking (`Sentry.startSession`), crash-free user rate as a production quality KPI; when to block a release on crash-free regression.
9. Debug vs production — disable tracking in dev; sample rate config for performance traces (`tracesSampleRate: 0.1` in prod, not 1.0); avoid flooding analytics with dev events.
10. Privacy manifests — third-party SDK declarations per iOS 17; Sentry's manifest bundled; PostHog / Amplitude may require manual addition; cross-link to `04-native-and-release.md`.
11. Gotchas (observability-specific) — source maps not resolving in Sentry (upload step missing from EAS hook), Sentry double-init on hot reload, analytics events firing in dev, PII leaking into breadcrumbs, PostHog feature flags cache on app start causing stale evaluation.
12. Verification — trigger a test crash in a release build, verify it appears in Sentry with resolved source map; verify `checkout_started` event lands in analytics dashboard with expected properties.
13. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "@sentry/react-native expo config plugin setup"
mcp__context7__query-docs for "@sentry/react-native source maps eas build"
mcp__context7__query-docs for "posthog-react-native setup identify events"
```

Confirm: Sentry's current `@sentry/react-native/expo` plugin location, source map upload steps, PostHog React Native v3 API.

- [ ] **Step 3: Write the file**

Target ~500-700 lines. Full TS for: Sentry init in root layout with `beforeSend` scrubber, EAS `postBuild` hook for source map upload (shell), PostHog provider + event helper + identify/reset on auth change.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/08-observability.md
git commit -m "feat(expo-react-native): add 08-observability.md"
```

---

## Task 11: Write `09-monetization.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/09-monetization.md`

- [ ] **Step 1: Outline sections**

1. Purpose + prerequisites
2. Contents
3. RevenueCat as default — why: unified subscription logic across App Store and Play Store, entitlement abstraction, server-side receipt validation, webhook integration. When `react-native-iap` is appropriate instead (strict no-SaaS requirement, self-hosted entitlement service).
4. Subscription model — entitlements vs products vs offerings in RevenueCat; how A/B price tests work via the dashboard; offering groups for experimentation.
5. Paywall patterns — paywall screen invoked on gated action; paywall reached via deep link (`/paywall?sku=...`; cross-link to `01-navigation.md`); analytics funnel for paywall view → purchase attempt → purchase success (cross-link to `08-observability.md` event taxonomy).
6. Receipt validation — RevenueCat does it server-side by default; if using `react-native-iap`, validate receipts server-side via App Store / Play Store APIs; **never** trust client-reported purchase state alone (receipt-replay fraud).
7. Restore purchases — required for App Store approval; UI placement (settings screen); `Purchases.restorePurchases()` flow; conflict when restoring across accounts.
8. Subscription management deep links — `https://apps.apple.com/account/subscriptions` (iOS), Play Store equivalent (Android); launch from settings with `Linking.openURL`.
9. Webhook → backend — RevenueCat → API Gateway → Lambda → DynamoDB for provisioning premium features / entitlements on the server. Cross-link to `aws-cdk-patterns/01-serverless-api.md` for the endpoint and `dynamodb-design/03-write-correctness.md` for the entitlement-update pattern (optimistic locking on the user entitlement record).
10. App Store / Play Store gotchas — sandbox vs production accounts; introductory pricing rules (free trial + intro offer); family sharing; grace periods on renewal failure; renewal notifications vs real-time webhook lag.
11. Gotchas (monetization-specific) — subscription product not returned (TestFlight tester not in sandbox account), webhook fires before client `Purchases.getCustomerInfo()` refreshes (client cache; use server as source of truth), restore purchases returns empty on fresh install after account switch, Play Store testing track requires signed upload, receipts not ready on app open (delay with `addCustomerInfoUpdateListener`).
12. Verification — sandbox purchase in TestFlight, webhook smoke test in RevenueCat dashboard, restore purchases on reinstall.
13. Further reading

- [ ] **Step 2: Verify via context7**

```
mcp__context7__query-docs for "react-native-purchases revenuecat setup entitlements offerings"
mcp__context7__query-docs for "revenuecat webhook events subscription lifecycle"
mcp__context7__query-docs for "react-native-iap receipt validation ios android"
```

Confirm: RevenueCat React Native SDK current API (`Purchases.configure`, `Purchases.getOfferings`, `Purchases.purchasePackage`), webhook event payload schema.

- [ ] **Step 3: Write the file**

Target ~600-800 lines. Full TS for: RevenueCat config plugin entry, `PaywallScreen.tsx` with offerings + purchase button + analytics, `usePremiumEntitlement.tsx` hook, `restorePurchases.ts` helper, webhook Lambda handler sketch (TypeScript) cross-referencing `aws-cdk-patterns`.

- [ ] **Step 4: Spot-check cross-references**

Run: `grep -nE 'aws-cdk-patterns|dynamodb-design|01-navigation|08-observability' plugins/dev-patterns/skills/expo-react-native/references/09-monetization.md`
Expected: links to `../../aws-cdk-patterns/references/01-serverless-api.md`, `../../dynamodb-design/references/03-write-correctness.md`, `./01-navigation.md`, and `./08-observability.md`.

- [ ] **Step 5: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/09-monetization.md
git commit -m "feat(expo-react-native): add 09-monetization.md"
```

---

## Task 12: Write `10-gotchas.md`

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/references/10-gotchas.md`

- [ ] **Step 1: Outline**

1. Purpose + prerequisites
2. Contents (TOC with category anchors)
3. Gotchas table — one row per issue: **Symptom | Root cause | Fix**. Group by theme, minimum coverage:

**Architecture / scaffold**
- Config plugin not applied (forgot `expo prebuild --clean` after plugin change)
- `EXPO_PUBLIC_*` value undefined at runtime (missing from `app.config.ts` `extra` or loaded after first read)
- `.env` committed to git (missing from `.gitignore`)

**Navigation**
- `expo-router` typed routes not picked up (forgot experiments flag or VS Code TS restart)
- Deep link works in Safari / dev, fails in TestFlight (missing universal-link association file on server)
- Tab bar flashes before redirect on protected route (auth state not loaded from SecureStore yet)

**State / data**
- Zustand `persist` silent failure (MMKV storage adapter not wrapped in `createJSONStorage`)
- TanStack Query mutation rolls back visually but server succeeded (network flake during `onSuccess` — use `onSettled` for invalidation)
- SecureStore biometric prompt blocks app resume (wrap access behind a gated hook)

**Auth / networking**
- Cognito hosted UI redirect loop (callback URL mismatch between app config and user pool)
- 401 retry storm (missing single-flight refresh coordination)
- JWT rejected for clock skew (>30s mobile-to-server drift; validate NTP on server rather than client)

**Native / release**
- iOS build fails with missing privacy manifest (iOS 17+ requires `PrivacyInfo.xcprivacy`)
- Android 14 `ForegroundServiceStartNotAllowedException` (missing foreground-service type declaration)
- OTA update not received in TestFlight (channel mismatch with EAS profile)
- Push notifications silent on iOS (APNS key expired or wrong team)
- Push notifications silent on Android (FCM server key rotated; regenerate in Firebase console)
- EAS Build works locally, fails on EAS (environment-specific secrets missing from build profile)
- EAS Build iOS simulator build rejected by TestFlight (wrong export method; simulator builds can't be submitted)

**Web / PWA**
- NativeWind classes not applied on web but fine on native (missing `tailwind.config.js` web content glob)
- Native-only module imported on web bundle (add Metro `resolver.platforms` entry)

**Performance / testing**
- `FlatList` jank with images (missing `getItemLayout` or dimension hints on image source)
- Metro bundler "cannot resolve module" after adding native package (forgot `expo prebuild` or Metro cache stale)
- Jest + `expo-router` test failure (missing `jest-expo` preset or router provider wrapper in test setup)
- Hermes debugger attach fails on simulator (network vs localhost config; `localhost` only works on simulator, not device)
- Maestro flakes on iOS simulator (Rosetta vs Apple Silicon; force Rosetta for AMD64 simulator)

**i18n / a11y**
- RTL layout breaks an icon that should stay pointing right (missing `I18nManager.isRTL` guard)
- VoiceOver announces nothing on a custom button (missing `accessibilityLabel` + `accessibilityRole`)
- Translation key missing after feature merge (extraction workflow bypass or untranslated fallback hidden)

**Observability**
- Sentry source maps not resolving (upload step missing from EAS hook or uploaded to wrong release)
- Analytics events firing in dev (missing `__DEV__` guard in provider)
- PostHog feature flag cache stale on app start (call `reloadFeatureFlagsAsync` on sign-in)

**Monetization**
- Subscription product not returned (TestFlight tester not in sandbox account)
- RevenueCat webhook fires before `Purchases.getCustomerInfo()` propagates (use webhook payload as source of truth, not client cache)
- Restore purchases returns empty after account switch (App Store account ≠ RevenueCat app user ID; prompt re-login)
- iOS: `StoreKit` error on sandbox user (Settings → App Store → Sandbox Account not set)
- Android Play Store testing track rejects AAB (version code not incremented or unsigned upload)

4. Cross-reference note: for AWS backend issues, see `aws-cdk-patterns/07-gotchas` (if present) and `dynamodb-design/07-gotchas.md`.
5. Further reading

Target 40-60 rows.

- [ ] **Step 2: Verify ambiguous gotchas via context7**

```
mcp__context7__query-docs for "ios privacy manifest PrivacyInfo xcprivacy 2024 requirement"
mcp__context7__query-docs for "android 14 foreground service type declaration"
mcp__context7__query-docs for "expo-router typed routes regeneration"
```

Confirm the ones that have evolved recently match current reality.

- [ ] **Step 3: Write the file**

Target ~400-600 lines. Dense table — this is a lookup reference, not a tutorial.

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/expo-react-native/references/10-gotchas.md
git commit -m "feat(expo-react-native): add 10-gotchas.md"
```

---

## Task 13: Testing harness (scripts + scenarios)

**Files:**
- Create: `plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.ps1`
- Create: `plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.sh`
- Create: `plugins/dev-patterns/skills/expo-react-native/tests/scenarios.txt`
- Delete: `plugins/dev-patterns/skills/expo-react-native/scripts/.gitkeep`, `plugins/dev-patterns/skills/expo-react-native/tests/.gitkeep`

- [ ] **Step 1: Copy harness from `dynamodb-design` as the baseline**

Read `plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.ps1` and `test-skill.sh` and copy verbatim to the new location. Update variable names and output directory prefix (`dynamodb-design-skill-test-` → `expo-react-native-skill-test-`) and the plugin path inside the script to the new skill.

- [ ] **Step 2: Write `tests/scenarios.txt`**

Exactly eight scenarios, one per line (no trailing blank):

```
Scaffold a new Expo app with expo-router, Zustand, TanStack Query, and a Cognito login screen. Show the feature-folder structure and eas.json with three profiles.
Add a protected /settings route with a sign-out button to an existing expo-router app. The user must be redirected to /login if not authenticated, without a tab-bar flash.
Wire Cognito + Google federation via expo-auth-session, including token refresh on 401 with single-flight coordination and SecureStore token caching.
Add push notifications via expo-notifications with APNS and FCM, including a deep link that opens /orders/:id when the user taps the notification.
Implement offline sync for cart mutations with TanStack Query optimistic updates and a retry queue that survives app restart. Handle stale-data 409 conflicts from the server.
Add a RevenueCat paywall reachable from a deep link at /paywall?sku=premium_monthly, with restore-purchases flow and post-purchase entitlement check.
Audit this screen for VoiceOver / TalkBack accessibility and RTL support. Return a checklist of issues with fixes.
Diagnose: my OTA update is published with `eas update --channel production` but TestFlight devices on preview profile never receive it.
```

- [ ] **Step 3: Adapt PowerShell script**

Runs RED (no skill) and GREEN (skill loaded via `--plugin-dir` + `--add-dir` + `--setting-sources project`) for each scenario. Outputs to `$env:TEMP\expo-react-native-skill-test-<timestamp>\`. Keep the "do not run inside an active Claude Code session" warning at the top.

- [ ] **Step 4: Adapt bash script**

Same as PowerShell; output to `/tmp/expo-react-native-skill-test-<timestamp>/`.

- [ ] **Step 5: Syntax-check both scripts**

Run:
```bash
bash -n plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.sh
pwsh -NoProfile -Command '$null = [scriptblock]::Create((Get-Content plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.ps1 -Raw))'
```
Expected: both exit 0.

- [ ] **Step 6: Remove placeholder `.gitkeep` files and commit**

```bash
rm plugins/dev-patterns/skills/expo-react-native/scripts/.gitkeep \
   plugins/dev-patterns/skills/expo-react-native/tests/.gitkeep
git add plugins/dev-patterns/skills/expo-react-native/scripts/ \
        plugins/dev-patterns/skills/expo-react-native/tests/
git commit -m "feat(expo-react-native): add RED/GREEN test harness and scenarios"
```

---

## Task 14: Add cross-link from `aws-cdk-patterns/02-auth-stack.md`

**Files:**
- Modify: `plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md`

- [ ] **Step 1: Read the file and find the Google IdP section**

Open the file and locate the section covering Cognito User Pool + Google federated identity (look for heading containing "Google" or "federation"). This is where the mobile consumer link belongs.

- [ ] **Step 2: Add a one-line cross-link at the end of that section**

Append a line (before any following heading):

```markdown
**Mobile consumer:** For the Expo / React Native client that integrates with this Cognito pool (PKCE flow, refresh handling, SecureStore token cache), see `../../expo-react-native/references/03-auth-and-networking.md`.
```

- [ ] **Step 3: Verify the relative path resolves**

Run:
```bash
ls plugins/dev-patterns/skills/expo-react-native/references/03-auth-and-networking.md
```
Expected: file exists (Task 5 created it).

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/skills/aws-cdk-patterns/references/02-auth-stack.md
git commit -m "docs(aws-cdk-patterns): cross-link 02-auth-stack to expo-react-native/03-auth-and-networking"
```

---

## Task 15: Update `plugins/dev-patterns/README.md`

**Files:**
- Modify: `plugins/dev-patterns/README.md`

- [ ] **Step 1: Read the current README structure**

Identify the `### dynamodb-design` section and mirror its shape for `expo-react-native`.

- [ ] **Step 2: Add a new `### expo-react-native` section after `### dynamodb-design`**

Content:

```markdown
### `expo-react-native`

End-to-end patterns for building Expo / React Native apps with the managed workflow + dev client. Closes the three-skill roadmap of `dev-patterns` — covers greenfield scaffolding, extension patterns, and backend integration with `aws-cdk-patterns` + `dynamodb-design`.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Starting a new Expo app | `00-architecture.md` + `01-navigation.md` |
| Adding a new screen or route | `01-navigation.md` |
| Client state, server state, or offline sync | `02-state-and-data.md` |
| Cognito / Google sign-in, API calls with auth | `03-auth-and-networking.md` |
| Push notifications, OTA updates, EAS Build / Submit, IAP config | `04-native-and-release.md` |
| Shipping to web / PWA | `05-cross-platform-web.md` |
| Performance tuning or test setup | `06-performance-and-testing.md` |
| Localization, RTL, or accessibility audit | `07-i18n-and-accessibility.md` |
| Crash reporting or analytics | `08-observability.md` |
| Subscriptions, paywalls, receipt validation | `09-monetization.md` |
| Diagnosing a production symptom | `10-gotchas.md` |

**Key topics covered:**

- Project scaffold (feature-folder / DDD structure, managed workflow + dev client, config plugins, EAS profiles with per-environment bundle IDs and channels)
- `expo-router` file-based routing, nested layouts, typed routes, protected routes with `<Redirect />`, universal / app links, paywall deep-link entry
- Client state (Zustand with MMKV persist) + server state (TanStack Query with optimistic updates + offline queue), storage tradeoffs (SecureStore / MMKV / AsyncStorage decision table), mutation queue surviving app restart
- Cognito + Google federation via `expo-auth-session` (PKCE), single-flight 401 refresh, typed `apiClient` matching `aws-cdk-patterns` `ApiResponse<T>`, biometric unlock via `expo-local-authentication`, 409 stale-data UI pattern
- Push notifications (`expo-notifications` with APNS + FCM, deep-link from payload), OTA updates (`expo-updates` channels), EAS Build + Submit (credentials, secrets, simulator builds for CI), iOS privacy manifests (iOS 17+), Android 13+ `POST_NOTIFICATIONS` runtime flow, Android 14 foreground-service types
- Expo for web (when viable vs Next.js), `Platform.select` patterns, responsive layouts, NativeWind vs StyleSheet tradeoffs, PWA manifest + service worker
- Performance — Hermes, new architecture (Fabric + TurboModules) status, `FlashList` over `FlatList`, `react-native-reanimated` v3 worklets, `expo-image` caching, bundle-size analysis
- Testing — Jest + React Native Testing Library, MSW (`msw/native`) for network mocks, Maestro (recommended) vs Detox for E2E, CI workflow with type-check + lint + unit + preview-build E2E
- i18n with `expo-localization` + `i18next` + ICU, RTL handling, accessibility APIs (`accessibilityLabel` / `Role` / `State`), VoiceOver + TalkBack testing checklist, `eslint-plugin-react-native-a11y`
- Observability — Sentry (crashes + JS errors + perf + session replay) with source maps via EAS, privacy scrubbing, PostHog for analytics with `noun_verb` event taxonomy, release health tracking
- Monetization — RevenueCat default (entitlements + offerings + server-side receipt validation + webhooks), paywall deep links, restore purchases, subscription-management deep links, webhook → Lambda → DynamoDB entitlement provisioning (cross-references `aws-cdk-patterns` + `dynamodb-design`)
- Gotchas catalog (40-60 rows) across architecture / navigation / state / auth / native / web / performance / i18n-a11y / observability / monetization themes

Test with the harness in `plugins/dev-patterns/skills/expo-react-native/scripts/` (RED/GREEN scenarios same pattern as `dynamodb-design`).
```

- [ ] **Step 3: Update the "Testing the skills" section**

Add PowerShell and bash invocations for the new harness, following the pattern already there for `dynamodb-design`:

```markdown
**`expo-react-native` — Windows (PowerShell 7+):**

\`\`\`powershell
.\plugins\dev-patterns\skills\expo-react-native\scripts\test-skill.ps1
\`\`\`

**`expo-react-native` — Mac / Linux / Git Bash:**

\`\`\`bash
./plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.sh
\`\`\`
```

(Use real triple-backticks when writing — escaped above for planning doc clarity.)

- [ ] **Step 4: Commit**

```bash
git add plugins/dev-patterns/README.md
git commit -m "docs(dev-patterns): add expo-react-native skill to plugin README"
```

---

## Task 16: Update root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the plugin table**

Change the `dev-patterns` row in the "Available Plugins" table. Current value: `| **[dev-patterns](plugins/dev-patterns)** | Cross-cutting reference patterns for common tech stacks (AWS CDK + DynamoDB design) | 2 skills |`. New value: `| **[dev-patterns](plugins/dev-patterns)** | Cross-cutting reference patterns for common tech stacks (AWS CDK + DynamoDB design + Expo / React Native) | 3 skills |`.

- [ ] **Step 2: Add an `expo-react-native` detail section under `### dev-patterns`**

Mirror the format of the existing `dynamodb-design` detail block. Include:
- One-paragraph description
- Reference file list: `00-architecture`, `01-navigation`, `02-state-and-data`, `03-auth-and-networking`, `04-native-and-release`, `05-cross-platform-web`, `06-performance-and-testing`, `07-i18n-and-accessibility`, `08-observability`, `09-monetization`, `10-gotchas`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add expo-react-native to root README"
```

---

## Task 17: Run harness + review diffs + iterate

**Files:** (may modify any reference file based on findings)

- [ ] **Step 1: Run the test harness on Unix**

```bash
./plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.sh
```
Expected: exits 0, output directory printed with RED/GREEN outputs + diffs per scenario.

- [ ] **Step 2: Run the test harness on Windows (PowerShell)**

```powershell
.\plugins\dev-patterns\skills\expo-react-native\scripts\test-skill.ps1
```
Expected: same as above.

**Reminder:** do NOT run the harness from inside an active Claude Code session — `claude -p` spawned recursively deadlocks on interactive prompts. Launch a plain terminal.

- [ ] **Step 3: Review diffs against the success criteria in the spec**

For each of the eight scenarios in `tests/scenarios.txt`, open the unified diff between RED and GREEN output. Success criteria per scenario:

1. **Scaffold** — GREEN produces a feature-folder tree with `app/` + `src/features/` + `src/shared/`, an `eas.json` with three profiles, and a Cognito login hook sketch; RED produces ad-hoc structure or skips EAS profiles.
2. **Protected route** — GREEN uses `<Redirect />` inside a group `_layout.tsx` with loading-state gating (no flash); RED uses an imperative `router.replace` in a screen component with flash.
3. **Cognito + Google** — GREEN uses `expo-auth-session` PKCE with SecureStore token cache + single-flight refresh; RED misses PKCE or lets 401s cause parallel refresh requests.
4. **Push + deep link** — GREEN wires both APNS and FCM, handles foreground/background, and routes from payload with `router.push`; RED covers only one platform or forgets payload handling.
5. **Offline sync + 409** — GREEN implements TanStack Query `onMutate` rollback + persisted mutation queue in MMKV + 409 UI pattern; RED skips the queue or the 409 UI.
6. **RevenueCat paywall** — GREEN uses `Purchases.getOfferings` + `Purchases.purchasePackage` + restore flow + entitlement check, reached via deep link; RED uses raw `react-native-iap` without receipt validation or misses restore.
7. **A11y / RTL audit** — GREEN returns a checklist covering `accessibilityLabel` / `Role` / `State`, focus order, RTL `flexDirection: 'row-reverse'`, directional-vs-symbolic icon mirroring; RED gives vague advice.
8. **OTA diagnosis** — GREEN identifies channel-vs-profile mismatch and prescribes `eas channel:view preview` + `eas update --channel preview`; RED blames build or asks for more info.

- [ ] **Step 4: Record scenarios where GREEN did not meaningfully improve RED**

If ≥ 2 scenarios fail to show improvement, identify which reference file is the weak link (based on scenario → file mapping) and plan targeted fixes.

- [ ] **Step 5: Iterate**

For each weak scenario: edit the relevant reference file, re-run (preferably only that scenario if the harness supports it, otherwise all), re-review.

- [ ] **Step 6: Commit the fixes**

```bash
git add plugins/dev-patterns/skills/expo-react-native/
git commit -m "fix(expo-react-native): improve <file> for <scenario> weakness"
```

- [ ] **Step 7: Final status summary**

Write a short summary comment to stdout: which scenarios passed GREEN review on the first run, which required iteration, and which reference files were edited. This is the completion signal.

---

## Self-Review (post-write, pre-execution)

- [x] Every spec section has at least one task. §3 integration → Task 14. §4 structure → Tasks 1-12. §5 per-ref → Tasks 2-12. §6 code conventions → applied throughout (context7 step in every writing task). §7 harness → Task 13. §8 README updates → Tasks 14-16. §9 success criteria → Task 17.
- [x] No "TBD" / "implement later" / "add error handling" placeholders.
- [x] Cross-reference paths are consistent (`../../aws-cdk-patterns/references/<file>.md`, `../../dynamodb-design/references/<file>.md`) and resolvable.
- [x] Commit messages follow a single convention (`feat(expo-react-native):` / `docs(expo-react-native):` / `docs(aws-cdk-patterns):` / `docs(dev-patterns):` / `docs:` for root README).
- [x] Test harness (Task 13) comes before docs that mention it (Tasks 15-16) and before the iteration task (Task 17).
- [x] Task 14 (cross-link to auth-stack) depends on Task 5 having written `03-auth-and-networking.md` first — ordering respected.
- [x] context7 verification step in every reference-writing task (Tasks 2-12) — matches the spec's conventions section and the user's global CLAUDE.md rule.

---

## Execution options

Plan complete and saved to `plans/2026-04-23-expo-react-native-skill-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Tasks 2-12 (reference file writing) are the most token-intensive. Subagent-driven is likely the better fit: each reference file gets a dedicated subagent with fresh context, the spec + this plan loaded, and context7 verification scoped to that file's libraries. Matches the execution approach used for `dynamodb-design`.
