# expo-react-native skill — Design

**Status:** Draft
**Date:** 2026-04-23
**Plugin:** `dev-patterns`
**Spec author:** Claude (with user oversight)

## 1. Overview

A new skill under the `dev-patterns` plugin that teaches Claude how to **build, ship, and maintain Expo / React Native mobile apps** end-to-end, with tight integration to the AWS backend patterns already in the plugin. Closes the three-skill roadmap for `dev-patterns` (`aws-cdk-patterns`, `dynamodb-design`, `expo-react-native`).

Skill slug: `expo-react-native`.

## 2. Jobs-to-be-done

Three JTBDs covered as branches of a single skill:

1. **Greenfield** — Scaffold a new Expo app with opinionated defaults (feature-folder / DDD layout, `expo-router`, Zustand + TanStack Query, Cognito auth, EAS profiles).
2. **Extension** — Work inside an existing Expo app: add a screen, a native capability (push, OTA, IAP), a new locale, analytics, a11y audit, etc. Covers the full gotchas catalog.
3. **Backend integration** — Mobile client of an AWS backend built with `aws-cdk-patterns`. Cognito + Google federation, SigV4 / JWT, optimistic locking on writes that hit DynamoDB, offline/sync patterns.

The architecture section (00) introduces the scaffold once; the rest of the references are theme files that serve all three JTBDs.

## 3. Relationship to sibling skills

**Principle: cross-reference by default; no canonical ownership moves from other skills.** `expo-react-native` is fresh content — no existing skill covers mobile specifically, so this is all net-new material with bidirectional links back to `aws-cdk-patterns` and `dynamodb-design` at the integration seams.

Cross-references:

- `03-auth-and-networking.md` ↔ `aws-cdk-patterns/02-auth-stack.md` (Cognito User Pool + Google IdP — mobile consumes what CDK provisions). Bidirectional: `aws-cdk-patterns/02-auth-stack.md` gets a one-line link forward to the mobile side.
- `03-auth-and-networking.md` → `dynamodb-design/03-write-correctness.md` (mobile client sending `version` on PUT requests, handling `ConditionalCheckFailedException` responses as stale-data conflicts).
- `04-native-and-release.md` (push notifications section) → `aws-cdk-patterns/00-architecture.md` (SNS / Pinpoint provisioning note — forward link only; CDK skill doesn't currently cover mobile push infrastructure in depth, so this is a one-way reference).
- `SKILL.md` "Further reading" section lists both sibling skills.

After the skill ships, one small update to `aws-cdk-patterns/02-auth-stack.md`: add a "Mobile consumer" cross-link at the end of the Google IdP section pointing to `expo-react-native/03-auth-and-networking.md`. No other edits to sibling skills.

## 4. Skill structure (Theme-oriented, 11 reference files)

```
plugins/dev-patterns/skills/expo-react-native/
├── SKILL.md                                   # lean router with decision tree
├── references/
│   ├── 00-architecture.md                     # scaffold, feature folders, config plugins, EAS profiles
│   ├── 01-navigation.md                       # expo-router, nested layouts, deep links, typed links
│   ├── 02-state-and-data.md                   # Zustand + TanStack Query, SecureStore/MMKV/AsyncStorage, offline sync
│   ├── 03-auth-and-networking.md              # Cognito+Google via expo-auth-session, SigV4/JWT, refresh
│   ├── 04-native-and-release.md               # Expo modules, config plugins, push, OTA, EAS Build/Submit
│   ├── 05-cross-platform-web.md               # Expo for web, Platform.select, NativeWind, PWA gotchas
│   ├── 06-performance-and-testing.md          # Hermes/Fabric, FlashList, reanimated, Jest+RNTL, Detox/Maestro
│   ├── 07-i18n-and-accessibility.md           # expo-localization + i18next, RTL, a11y labels, VoiceOver/TalkBack
│   ├── 08-observability.md                    # Sentry, analytics (PostHog/Amplitude), source maps via EAS
│   ├── 09-monetization.md                     # react-native-iap / RevenueCat, subscriptions, paywall deep links
│   └── 10-gotchas.md                          # full catalog
├── scripts/
│   ├── test-skill.ps1                         # Windows harness (mirrors aws-cdk-patterns / dynamodb-design)
│   └── test-skill.sh                          # Unix harness
└── tests/
    └── scenarios.txt                          # RED/GREEN prompts
```

## 5. Per-reference scope

### SKILL.md (lean router)

Frontmatter: `name: expo-react-native`, description optimized for Claude Search Optimization (CSO) triggers. Mirrors `dynamodb-design/SKILL.md` format.

Body: 1-paragraph intro + decision tree table routing by task:

| Task | Reference |
|------|-----------|
| Starting a new Expo app | `00-architecture.md` + `01-navigation.md` |
| Adding a new screen / route | `01-navigation.md` |
| Client state, server state, or offline sync | `02-state-and-data.md` |
| Cognito / Google sign-in, API calls with auth | `03-auth-and-networking.md` |
| Push notifications, OTA updates, EAS Build / Submit, IAP config | `04-native-and-release.md` |
| Shipping to web / PWA | `05-cross-platform-web.md` |
| Performance tuning or test setup | `06-performance-and-testing.md` |
| Localization, RTL, or accessibility audit | `07-i18n-and-accessibility.md` |
| Crash reporting or analytics | `08-observability.md` |
| Subscriptions, paywalls, receipt validation | `09-monetization.md` |
| Diagnosing a symptom | `10-gotchas.md` |

"Further reading" section: links to `aws-cdk-patterns` (backend) and `dynamodb-design` (write correctness on mobile edits).

### 00-architecture.md

- **Workflow choice** — Managed workflow vs dev client vs bare. Recommended default: Expo managed + dev client (config plugins cover almost everything without ejecting).
- **Scaffold** — `create-expo-app` with TypeScript template; prune to a feature-folder / DDD structure (`src/features/<domain>/` with `screens/`, `components/`, `services/`, `types.ts` per feature; `src/shared/` for cross-cutting).
- **Config plugins** — What they are, when to write one, reading order with `expo prebuild`, common pitfalls (plugin not re-run after `prebuild --clean`).
- **Environment / secrets** — `app.config.ts` vs `app.json`, `process.env.EXPO_PUBLIC_*` for client-safe values, EAS secrets for build-time values, never committing `.env`.
- **EAS profiles** — `development` / `preview` / `production` profile conventions, channel + distribution config, per-profile bundle identifiers for simultaneous install.
- **Worked example intro** — e-commerce mobile client (catalog, cart, checkout, order history) that threads through every subsequent reference. Consumes the backend from `aws-cdk-patterns` + `dynamodb-design`.

### 01-navigation.md

- **`expo-router` file-based routing** — Conventions (`app/` directory, `_layout.tsx`, route groups `(auth)` / `(app)`).
- **Nested layouts** — Stacks inside tabs, modal presentation, shared headers, back behavior.
- **Typed routes** — `href` type safety with the `experiments.typedRoutes` flag, typed `router.push`, typed params.
- **Protected routes** — Auth guard pattern with `<Redirect />` in `_layout.tsx`, handling loading state to avoid flash.
- **Deep links** — Universal links (iOS) / App links (Android) config, `expo-linking` for programmatic URL building, handling cold-start vs warm-start deep links, test deep links in simulator and TestFlight.
- **Paywall deep-link entry** — Link that opens directly to `/paywall?sku=...` from push notification, email, or external referral; cross-link to `09-monetization.md`.

### 02-state-and-data.md

- **Client state** — Zustand recommended; when Redux Toolkit is warranted; why avoid context for anything beyond theme/auth.
- **Server state** — TanStack Query (React Query) for network state; defaults (`staleTime`, `gcTime`), offline + retry config, optimistic mutations with rollback on conflict.
- **Storage tradeoffs** — `expo-secure-store` (keychain / keystore for tokens), `react-native-mmkv` (fast sync KV for app state; supports encryption), `AsyncStorage` (legacy; avoid unless compatibility forces it). Decision table.
- **Offline sync** — Queue pattern for mutations while offline, conflict handling (last-write-wins vs version check; cross-link to `dynamodb-design/03-write-correctness.md` for server-side semantics), background sync with `expo-task-manager`.
- **Optimistic updates** — TanStack Query `onMutate` / `onError` / `onSettled`, snapshot-rollback pattern, visual feedback for pending state.

### 03-auth-and-networking.md

- **Cognito + Google federation** — `expo-auth-session` with `AuthRequest` + PKCE; Cognito hosted UI as the IdP broker; config (`userPoolId`, `userPoolWebClientId`, `identityPoolId`, `domain`). Cross-link to `aws-cdk-patterns/02-auth-stack.md` for how the pool is provisioned.
- **Token storage** — Access / ID / refresh tokens in `expo-secure-store`; never in AsyncStorage; never in Zustand persist without encryption.
- **Refresh flow** — Detect 401 in fetch interceptor, queue concurrent requests during refresh, handle refresh failure (sign out + redirect to login).
- **Networking abstraction** — Single `apiClient` wrapper around `fetch`: base URL per EAS profile, auth interceptor, retry with exponential backoff, timeout, typed response envelopes matching `aws-cdk-patterns` `ApiResponse<T>`.
- **SigV4 vs JWT** — When each is appropriate; JWT is the default for API Gateway with Cognito authorizer; SigV4 only if calling IAM-authorized APIs directly from mobile (rare).
- **Handling stale-data conflicts** — `ConditionalCheckFailedException` surfaces as HTTP 409; UI pattern for "someone else edited this" with refresh-and-retry. Cross-link to `dynamodb-design/03-write-correctness.md`.
- **Biometric unlock** — `expo-local-authentication` gating access to the stored refresh token on app open.

### 04-native-and-release.md

- **Expo modules API** — When to reach for it vs a config plugin vs a community package; when to prefer managed workflow; escape hatch.
- **Config plugins in practice** — Writing a plugin for a native capability (e.g., custom URL schemes, entitlements, Info.plist additions). Pitfalls (plugin idempotency, `prebuild --clean` lifecycle).
- **Push notifications** — `expo-notifications` with FCM (Android) + APNS (iOS) direct, *or* AWS SNS / Pinpoint as broker. Token registration flow, foreground vs background handling, notification categories / actions, deep-link from notification payload. iOS entitlements + APNS key setup. Android 13+ `POST_NOTIFICATIONS` permission flow.
- **OTA updates** — `expo-updates` channels crossed with EAS profiles; update strategy (on app start vs on resume); rollback via republishing previous bundle; testing updates in preview profile.
- **EAS Build** — Build profiles, credentials management (Apple cert + APNS key + keystore), EAS secrets vs env vars (which is which), build caching gotchas, iOS simulator builds for CI.
- **EAS Submit** — Automated submission to App Store Connect + Play Console, metadata handling, initial submission vs updates.
- **In-app purchases setup** — `react-native-iap` vs RevenueCat decision (RevenueCat recommended for subscriptions + entitlements); EAS config (`In-App Purchase` capability iOS, `com.android.vending.BILLING` permission Android); App Store Connect + Play Console product creation. Implementation detail lives in `09-monetization.md`.
- **Privacy manifests (iOS 17+)** — Required declarations; how EAS handles it; common rejection patterns.

### 05-cross-platform-web.md

- **Expo for web** — When the web target is viable (UI-heavy, form-driven apps) vs when to build a separate React app. Build config (`expo export --platform web`).
- **`Platform.select` patterns** — Platform-specific imports (`.ios.tsx` / `.android.tsx` / `.web.tsx`), avoiding if/else sprawl, feature-flag abstractions.
- **Responsive layouts** — `useWindowDimensions`, breakpoint helpers, layout split between mobile-first and desktop.
- **NativeWind vs StyleSheet** — Tradeoffs; NativeWind for rapid UI consistent across platforms; StyleSheet for performance-critical paths or when Tailwind's footprint is undesirable.
- **PWA gotchas** — `manifest.json` + service worker when targeting installable web; `expo-web-browser` vs real navigation; SEO caveats (SSR is not in Expo's wheelhouse — prefer Next.js if SEO matters).
- **Deployment** — Static hosting (S3 + CloudFront per `aws-cdk-patterns/03-static-site.md`); not covered here in depth — cross-link.

### 06-performance-and-testing.md

- **Hermes** — Default engine since SDK 50; profiling with Hermes profiler; when to turn it off (rare).
- **New architecture (Fabric + TurboModules)** — Status (opt-in as of current SDK; verify via context7 before writing); migration checklist for existing apps; which libraries are Fabric-ready.
- **Lists** — `FlatList` pitfalls (inline render functions causing re-renders, missing `keyExtractor`); `FlashList` (Shopify) for long / heterogeneous lists.
- **Animations** — `react-native-reanimated` v3 worklets, shared values, layout animations; avoiding JS bridge during animations.
- **Images** — `expo-image` caching, placeholder strategies, dimension hints to avoid layout thrash.
- **Bundle size** — Analyzing with `expo export` output, tree-shaking pitfalls, lazy-loading screens via `expo-router` groups.
- **Testing** — Jest + React Native Testing Library for components/hooks; MSW for network mocking; Detox vs Maestro for E2E (Maestro recommended for easier setup, Detox for deeper control); testing deep links, push payloads.
- **CI integration** — Running unit tests + lint + type-check in GitHub Actions; E2E on EAS Build previews with Maestro Cloud.

### 07-i18n-and-accessibility.md

- **i18n setup** — `expo-localization` for device locale detection; `i18next` + `react-i18next` for string tables; namespace-per-feature convention; extraction workflow.
- **Pluralization and interpolation** — ICU messageFormat via `i18next-icu`; avoiding concatenation.
- **Date / number formatting** — `Intl.DateTimeFormat` / `Intl.NumberFormat` (available via Hermes); relative time with `date-fns` / `dayjs`.
- **RTL handling** — `I18nManager.forceRTL`; `flexDirection: 'row-reverse'` patterns; icons that should mirror vs stay fixed.
- **Accessibility** — `accessibilityLabel`, `accessibilityHint`, `accessibilityRole`, `accessibilityState`; `accessibilityLiveRegion` for dynamic updates; `accessible` vs treating a group as one element.
- **Testing with VoiceOver and TalkBack** — How to enable, focus order checklist, common mistakes (custom buttons that aren't announced, form fields without labels).
- **Automated a11y checks** — ESLint plugin `eslint-plugin-react-native-a11y`; CI step to catch regressions.

### 08-observability.md

- **Sentry** — Setup via `@sentry/react-native` + Expo config plugin; source map upload in EAS Build; crash + JS error + performance monitoring in one; privacy config (scrubbing PII).
- **Analytics** — PostHog for product analytics (recommended for open source + privacy-first); Amplitude as alternative; Firebase Analytics when Google ecosystem dominates. Event taxonomy — standardize on `noun_verb` naming (`checkout_started` not `startedCheckout`).
- **User identification** — Post-login `Sentry.setUser` + analytics identify; post-logout clear to avoid cross-contamination.
- **Release health** — Session tracking, crash-free user rate as a production quality KPI.
- **Debug vs production** — Disabling tracking in dev; sample rate config for performance traces (not 100% in prod).
- **Privacy manifests** — Declaring third-party SDKs per iOS 17 requirements; cross-link to `04-native-and-release.md`.

### 09-monetization.md

- **RevenueCat as default** — Why: unified subscription logic across App Store / Play Store, entitlement system, server-side receipt validation, webhooks for backend. `react-native-iap` only when RevenueCat is not allowed (e.g., strict no-SaaS requirement).
- **Subscription model** — Entitlements vs products; offering groups; A/B price tests via RevenueCat dashboard.
- **Paywall patterns** — Paywall screen invoked on gated action; paywall reached via deep link (cross-link `01-navigation.md`); reporting paywall funnel to analytics.
- **Receipt validation** — RevenueCat handles it server-side by default; for `react-native-iap`, validating receipts server-side via App Store / Play Store APIs; never trusting client-reported purchase state alone.
- **Restore purchases** — Required flow for App Store approval; UI placement (settings screen).
- **Subscription management deep links** — `apps.apple.com/account/subscriptions` on iOS, Play Store equivalent on Android; opening from settings.
- **Webhook → backend** — RevenueCat → AWS (API Gateway → Lambda → DynamoDB) for provisioning premium features; cross-link to `aws-cdk-patterns/01-serverless-api.md`.
- **App Store / Play Store gotchas** — Sandbox vs production accounts, introductory pricing rules, family sharing, grace periods, renewal notifications.

### 10-gotchas.md

Symptom → root cause → fix table covering at least:

- iOS build fails with missing privacy manifest (iOS 17+ requires `PrivacyInfo.xcprivacy`)
- Android 14 `ForegroundServiceStartNotAllowedException` (foreground service types)
- Metro bundler "cannot resolve module" after adding a native package (forgot `expo prebuild` or Metro cache)
- EAS Build works locally, fails on EAS (environment-specific secrets missing)
- Config plugin not applied (forgot `expo prebuild --clean` after plugin change)
- OTA update not received in TestFlight (channel mismatch with profile)
- Deep link works in Safari / dev, fails in TestFlight (missing universal link association file)
- Push notifications silent on iOS (APNS key expired or wrong team)
- Push notifications silent on Android (FCM server key rotated)
- `expo-router` typed routes not picked up (forgot experiments flag or VS Code restart)
- Hermes attach fails on simulator (network vs localhost config)
- `FlatList` jank with images (missing `getItemLayout` or dimension hints)
- Subscription product not returned (TestFlight tester not in sandbox account)
- Cognito hosted UI redirect loop (callback URL mismatch between app config and pool)
- Silent refresh fails (SecureStore access during biometric prompt blocks main queue)
- VoiceOver announces nothing on a custom button (missing `accessibilityLabel` + `accessibilityRole`)
- RTL layout breaks an icon that should stay pointing right (missing `I18nManager.isRTL` check)
- NativeWind classes not applied on web but fine on native (missing `tailwind.config.js` content glob)
- EAS Build iOS simulator build rejected by TestFlight (wrong export method)
- Sentry source maps not resolving (sourcemap upload step missing from EAS hook)
- RevenueCat webhook fires before entitlement propagates to `Purchases.getCustomerInfo()` (client cache; use event payload)

Catalog targets 40-60 rows across Architecture / Navigation / State / Auth / Native / Web / Performance / i18n-a11y / Observability / Monetization / Gotchas themes.

## 6. Code-example conventions

- **Language: TypeScript** (`strict: true`), matching `aws-cdk-patterns`.
- **Expo SDK**: target the latest stable SDK at the time of writing each reference. **Each subagent verifies the current SDK version and library APIs via context7** (`resolve-library-id` → `query-docs`) before writing code — no reliance on training-data memory. This applies to Expo SDK, `expo-router`, `expo-auth-session`, `expo-notifications`, `expo-updates`, `@tanstack/react-query`, `zustand`, `@sentry/react-native`, `react-native-iap` / `react-native-purchases`, `react-native-mmkv`, `react-native-reanimated`, `@shopify/flash-list`, `i18next` / `react-i18next`, `@opensearch-project/opensearch`, etc.
- **SDK version noted inline** in each reference's intro: "Examples verified against Expo SDK X and libraries listed in §2." So a future reader knows when to re-verify.
- Imports explicit, no `any`, no omitted error handling.
- Units documented (`ms`, `bytes`, `dp`, `px`) wherever numeric.

## 7. Testing harness

Mirror `dynamodb-design` (which itself mirrors `aws-cdk-patterns`):

- `scripts/test-skill.ps1` and `scripts/test-skill.sh` — both run the same two-phase scenario suite (RED: baseline without skill, GREEN: skill loaded via `--plugin-dir` + `--add-dir` + `--setting-sources project`).
- `tests/scenarios.txt` — one prompt per line, designed to exercise the skill's claims. Candidate scenarios (8):
  1. "Scaffold a new Expo app with `expo-router`, Zustand, TanStack Query, and a Cognito login screen."
  2. "Add a protected `/settings` route with a sign-out button to an existing `expo-router` app."
  3. "Wire Cognito + Google federation via `expo-auth-session`, including token refresh on 401."
  4. "Add push notifications via `expo-notifications` with APNS + FCM, including a deep link to a specific order screen from the notification payload."
  5. "Implement offline sync for cart mutations with TanStack Query optimistic updates and a retry queue that survives app restart."
  6. "Add a RevenueCat paywall reachable from a deep link, with restore purchases flow."
  7. "Audit this screen for accessibility (VoiceOver + TalkBack) and RTL support."
  8. "Diagnose: 'my OTA update is published but TestFlight devices never receive it.'"
- Per-scenario outputs + unified diffs written to a timestamped directory (`$env:TEMP\expo-react-native-skill-test-<ts>\` on Windows, `/tmp/expo-react-native-skill-test-<ts>/` on Unix).
- Same "do not run inside an active Claude Code session" warning in README.

## 8. README updates

- `plugins/dev-patterns/README.md` — add a "Skills included" entry for `expo-react-native` with decision-tree excerpt and key-topics list, mirroring the `dynamodb-design` format.
- Root `README.md` — update the dev-patterns row ("2 skills" → "3 skills") and add an `expo-react-native` detail section with reference file list.
- `aws-cdk-patterns/02-auth-stack.md` — add a one-line "Mobile consumer" cross-link at the end of the Google IdP section pointing to `expo-react-native/03-auth-and-networking.md`.

## 9. Success criteria

Skill is considered done when:

1. All 11 reference files + `SKILL.md` written, each following the established format (purpose statement, prerequisites, TOC, sections, gotchas, verification, further reading).
2. Every TypeScript / config-plugin code snippet validated against the current library APIs via context7 before commit.
3. Cross-references to `aws-cdk-patterns` and `dynamodb-design` in place both ways where applicable.
4. Testing harness runs end-to-end on Windows (ps1) and Unix (sh).
5. RED/GREEN diff review shows measurable improvement on at least 6 of the 8 scenarios.
6. READMEs updated (root + plugin + `aws-cdk-patterns/02-auth-stack.md` cross-link added).
7. Commit messages follow repo convention; all commits pushed to `master`.

## 10. Non-goals

- **Not covered**: Bare React Native workflow (Expo managed + dev client is the recommended default — bare is an escape hatch with its own book-length gotchas); multi-platform design systems (Storybook, Tamagui UI kits — too framework-ish for this skill); iOS / Android native code in Swift / Kotlin (Expo modules API is the boundary); game engines / 3D (react-three-fiber, Skia beyond basic use).
- **Not a replacement** for the Expo Docs or React Native docs. The skill is opinionated shortcuts + known-good patterns, not exhaustive reference.
- **No CDK** provisioning code. Backend infrastructure lives in `aws-cdk-patterns`.

## 11. Risks

- **SDK drift**: Expo ships major SDK updates ~3x per year; library APIs evolve fast. Mitigation: every reference includes an "Examples verified against Expo SDK X" footer, and context7 verification is built into the implementation workflow so each subagent pulls current docs.
- **Skill sprawl**: 11 reference files is the upper bound of what a lean SKILL.md can route cleanly. Mitigation: aggressive decision-tree routing in SKILL.md so Claude loads only the relevant ref for a given task; gotchas catalog kept scannable with clear section dividers.
- **Testing harness false confidence**: scenarios exercise what the skill *claims* to improve, but a human still reads the diffs. The harness is a regression catcher, not a correctness proof.
- **Monetization library churn**: `react-native-iap` and RevenueCat both evolve quickly; receipt-validation APIs from Apple / Google change. Mitigation: `09-monetization.md` leans on RevenueCat's abstraction to reduce exposure, and context7 verification before code.

## 12. Open questions

None at spec time. Scope, structure, integration with sibling skills, testing approach, and language conventions are all confirmed.
