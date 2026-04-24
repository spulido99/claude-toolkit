# Gotchas Catalog

**Builds:** Nothing — this is a pure lookup reference. Scan by symptom to find root cause and fix.

**When to use:** When an Expo / React Native behavior is surprising, wrong, slow, or broken on
release but not in dev. Start from the Symptom column; follow the Fix to the relevant deeper
reference file.

**Prerequisites:** None specific. This file intentionally duplicates key gotcha rows from other
reference files in this skill — redundancy is the point for a symptom-first lookup catalog.

**Examples verified against Expo SDK 54 on 2026-04-23. Re-verify via context7 before porting to a
newer SDK.**

---

## Contents

1. [Architecture / scaffold](#section-1-architecture--scaffold) — config plugins, `EXPO_PUBLIC_*`
   loading, `.env` leakage, `prebuild --clean` requirements.
2. [Navigation](#section-2-navigation) — `expo-router` typed routes, universal links, deep-link
   verification, protected-route splash race.
3. [State / data](#section-3-state--data) — Zustand `persist` + MMKV, TanStack Query v5 renames,
   mutation retry semantics, biometric-gated resume.
4. [Auth / networking](#section-4-auth--networking) — Cognito redirect mismatch, 401 single-flight
   refresh, JWT clock skew, PKCE memoization.
5. [Native / release](#section-5-native--release) — privacy manifests, Android 14 foreground
   services, OTA channel mismatch, APNS / FCM key rotation, EAS Build environment drift.
6. [Web / PWA](#section-6-web--pwa) — Tailwind content glob, native-module leaks, `expo-image`
   CORS, OAuth proxy on web.
7. [Performance / testing](#section-7-performance--testing) — `FlatList` jank, Metro cache,
   `jest-expo` preset, Hermes debugger, Maestro under Rosetta.
8. [i18n / a11y](#section-8-i18n--a11y) — RTL layout, VoiceOver focus, Dynamic Type,
   Hermes `Intl.PluralRules`, CLDR plural forms.
9. [Observability](#section-9-observability) — Sentry source maps, `__DEV__` guards, PostHog flag
   freshness, PII in breadcrumbs, session-replay masking.
10. [Monetization](#section-10-monetization) — sandbox testers, RevenueCat webhooks vs client
    cache, restore purchases after account switch, Play Store testing tracks.
11. [Cross-reference: AWS backend gotchas](#section-11-cross-reference--aws-backend-gotchas)
12. [Further reading](#section-12-further-reading)

---

## Section 1: Architecture / scaffold

> Quick scan: The most common first-time build break is a config-plugin change that never took
> effect because `prebuild --clean` was skipped. The second is an `EXPO_PUBLIC_*` variable that
> is undefined at runtime because Metro was started in a shell that did not load `.env`.

| Symptom | Root cause | Fix |
|---|---|---|
| `Info.plist` / `AndroidManifest.xml` is missing the entry a config plugin should have added; plugin changes to `app.config.ts` have no effect after `prebuild`. | `npx expo prebuild` was run without `--clean` after changing a plugin. Plugins mutate existing generated native projects and some mutations (removals, reorderings, conditional branches that now take a different path) do not roll back cleanly on the second run. | Delete `ios/` and `android/`, then run `npx expo prebuild --clean`. Alternatively, always let EAS Build regenerate native projects — the build servers start from a clean state. See `./00-architecture.md` §7. |
| Runtime crash at cold start: `Cannot read properties of undefined (reading 'split')` or a config helper throws `EXPO_PUBLIC_API_BASE_URL is not defined`. | `EXPO_PUBLIC_*` variable was renamed, removed, the bundle was cached from a previous build, or Metro was started in a shell that did not load `.env`. Common on CI where the Metro process does not source the same `.env` as the developer machine. | Restart Metro with `npx expo start --clear`. In EAS Build, set `EXPO_PUBLIC_*` on the build profile (not just locally). Wrap reads in a `requirePublic(name)` helper that throws at module-load time instead of silently returning `undefined`. See `./00-architecture.md` §4. |
| A secret (API token, Stripe key, signing key) is present in `git log`. | `.gitignore` was not set up before first commit, or a profile-specific `.env.<profile>` file was added outside the ignore pattern. | (1) Rotate every credential in the file immediately. (2) Rewrite history with `git filter-repo` — `git rm --cached` leaves the value in prior commits. (3) `.gitignore` should ignore `.env*` and whitelist only `.env.example`. (4) Add a pre-commit hook that fails on `.env` in the staged diff. |
| `app.config.ts` edits take effect locally but EAS Build ignores them and ships the previous native project. | EAS Build caches `ios/` and `android/`. A plugin edit should invalidate the cache, but if the git diff only touches `plugins/` and not `app.config.ts`, the fingerprint sometimes misses. | Explicitly clear: `eas build --clear-cache --profile <name> --platform <os>`. For local: `npx expo prebuild --clean` before `eas build --local`. Touching `app.config.ts` (add a no-op whitespace change) forces a fingerprint miss. See `./04-native-and-release.md` §11.3. |
| `npx expo-doctor` reports a dependency incompatibility (a transitive package pinned to an older React Native). | A library in the dependency tree specifies a narrower `react-native` peer range than the installed version. Common after an SDK upgrade. | Fix with `npx expo install <pkg>@latest` on the offending package before proceeding. A dirty doctor report cascades into build failures that are substantially harder to debug than the peer-range bump. See `./00-architecture.md` §8. |
| Two devices with the same build show different `Updates.channel` values. | The app was built with one EAS profile and sideloaded onto a device that never downloaded an OTA for that channel. `Updates.channel` reads the embedded value at build time. | Read `Updates.channel` with a debug-drawer line in dev builds; ensure every OTA-eligible install path uses the same channel name. Never hand-edit `Updates.channel` or the `runtimeVersion`; let the EAS profile drive it. |

---

## Section 2: Navigation

> Quick scan: Typed-route type errors after adding a file are almost always a Metro cache issue —
> restart with `--clear`. Deep links that work in dev and fail in TestFlight are a universal-link
> association problem; verify the `.well-known` file with `curl` before anything else.

| Symptom | Root cause | Fix |
|---|---|---|
| New route file exists under `app/`, `npx expo-router list` prints it, but `router.push("/new-route")` shows TypeScript error `Type '"/new-route"' is not assignable to…`. | Typed-routes regenerate during Metro's `expo-router` transformation; Metro caches the generated `.expo/types/router.d.ts` aggressively. A new file added while Metro is running leaves types stale. | Restart Metro with `npx expo start --clear`. If types still stale, delete `.expo/types/` and restart. Verify `experiments.typedRoutes: true` is set in the **current** `app.config.ts` (not an older `app.json`). Restart VS Code TS server (`Cmd+Shift+P` → "TypeScript: Restart TS Server"). See `./01-navigation.md` §7. |
| Deep link works in `expo start` on simulator, but tapping `https://acme.example/orders/ord_9f2` in TestFlight opens the website instead of the app. | The domain-association file is unreachable, returns the wrong `Content-Type`, or the SHA256 fingerprint in `assetlinks.json` doesn't match the keystore TestFlight used. | For iOS: `curl -I https://acme.example/.well-known/apple-app-site-association` must return `200`, `Content-Type: application/json`, no `Content-Encoding`. Reinstall the app after fixing. For Android: `adb shell pm get-app-links <pkg>` must say `verified`; if `legacy_failure`, re-verify with `adb shell pm verify-app-links --re-verify <pkg>`. See `./01-navigation.md` §7. |
| Tapping a protected route from a signed-out cold start briefly shows the tab bar before the redirect fires. User reports "glitchy startup". | Splash hid before the auth state resolved from SecureStore, revealing the protected layout for one frame before `<Redirect />` fired. Usually caused by `SplashScreen.preventAutoHideAsync()` called in a `useEffect` (late) instead of module scope (on time). | Make `SplashScreen.preventAutoHideAsync()` the very first executable line of `app/_layout.tsx`. Hide the splash only inside a `useEffect` that depends on `isLoading`, and only once. See `./01-navigation.md` §2. |
| `useLocalSearchParams()` returns `{}` or `undefined` fields on first render; values populate on the second render. | `expo-router` hydrates params asynchronously after the layout mounts. Reading params in a sync render path hits the empty state once. | Type params as `Partial<…>` and guard rendering on the required fields being present. Do not use `useLocalSearchParams()` during render-time decisions that cause layout shift; resolve inside a `useEffect` or gate the screen on presence. |
| Deep link opens the app but lands on the initial route instead of the targeted screen. | `Linking.getInitialURL()` was read before the router finished initializing, or the router was re-initialized after the URL was consumed. | Use `expo-linking`'s URL listener (`Linking.useURL()`) in the root layout and route the URL through `router.replace()` once the router is ready. The listener handles both cold-start URLs and runtime URLs consistently. |
| Tab bar appears for one frame over a stack screen that should be tab-less. | Route group `(tabs)` layout hasn't applied `headerShown` / `tabBarStyle: { display: "none" }` before the screen paints, or the screen is rendering outside the correct layout segment. | Place stack-only screens in a separate route group (e.g., `app/(modal)/<screen>.tsx`) with its own layout file that sets `presentation: 'modal'`. Do not rely on per-screen overrides to hide the tab bar. |

---

## Section 3: State / data

> Quick scan: Zustand `persist` silent failure almost always = missing `createJSONStorage` wrapper
> around MMKV. TanStack Query v5 renames (`cacheTime` → `gcTime`, `keepPreviousData` →
> `placeholderData`) silently ignore the old name. If a mutation `onSuccess` rollback surprises
> you, the right hook is `onSettled`.

| Symptom | Root cause | Fix |
|---|---|---|
| Zustand store with `persist` never rehydrates; every app start reads default state. No error in console. | MMKV storage adapter passed directly to `persist({ storage })` without wrapping in `createJSONStorage`. Zustand silently falls back to in-memory when the adapter shape doesn't match its `PersistStorage` interface. | Wrap with `createJSONStorage(() => ({ getItem, setItem, removeItem }))` where the inner object adapts MMKV's API. See `./02-state-and-data.md` §3 for the canonical adapter. |
| `TypeError: cacheTime is not a valid option` in logs after TanStack Query v4 → v5 upgrade; memory grows unbounded on long sessions. | v5 renamed `cacheTime` → `gcTime`. Unknown options are silently ignored; the old name is gone. `keepPreviousData: true` was also renamed to `placeholderData: (prev) => prev`. | Project-wide `grep -r 'cacheTime' src/` and rename. Same pass for `keepPreviousData`. See `./02-state-and-data.md` §7. |
| Zustand store with `persist` + MMKV is slow on large state — 30 ms per `set()` on a cart with 200 lines. | `persist` calls `storage.setItem(name, JSON.stringify(wholeState))` on every `set()`. Serialization is O(state size) on the JS thread; MMKV writes are fast, the bottleneck is `JSON.stringify`. | Use `partialize` to persist only a minimal shape (drop derived fields, snapshots). For legitimately large hot state, bypass `persist` and write to MMKV directly via a `subscribeWithSelector` listener with debouncing. See `./02-state-and-data.md` §7. |
| TanStack Query mutation `onSuccess` runs, cache is invalidated, but UI still shows old data for 30–60s. | Network flake: the optimistic update rolled back visually in `onError`, but the server actually committed the change. The rollback removed the optimistic state without triggering a refetch of the real server state. | Use `onSettled` for invalidation, not `onSuccess`. `onSettled` runs on both success and error paths, guaranteeing the cache is refreshed regardless of network outcome. |
| App resumes from background; UI frozen 10–30 s; no console error. | `SecureStore.getItemAsync` with `requireAuthentication: true` blocks the JS thread on Face ID. Called in a `useEffect` on resume, every render path waits on biometrics. | Guard behind an explicit user action or an `AppState` listener, never a render-time read. Never call the biometric-gated key during layout mount. See `./03-auth-and-networking.md` §8.2. |
| Mutation queue replayer keeps retrying the same mutation after reconnect; all subsequent mutations block. Sentry logs the same `409 Conflict`. | Expected version stale. The mutation was enqueued against `version: 5`; another device pushed the server to `version: 7`. The replayer retries verbatim; server keeps rejecting, blocking drainage. | On `409`, ack (drop) the mutation and invalidate the relevant queries. The user's old intent is now stale; let them see server state and retry if they still want to. See `./02-state-and-data.md` §4. |
| A component using `useMMKVKeys(storage)` re-renders twice on every `set`. | The listener fires before React commits the preceding render. One `storage.set()` triggers a re-render; React then flushes the pending listener, causing another. | Replace `useMMKVKeys` with a derived value from Zustand or TanStack Query. Listener-based hooks are convenient for prototypes but add non-trivial re-render cost at scale. See `./02-state-and-data.md` §7. |
| `useQuery` returns stale data after navigating back from a detail screen that mutated the list. | Default `staleTime: 0` means the query is stale; but `refetchOnMount: 'always'` is not the default. The query returns cached data and only refetches on focus/network events, which may not fire on the route transition. | Invalidate the parent list query from the detail screen's mutation `onSettled`, not just on navigation back. Or set `refetchOnMount: 'always'` on the list query if it must always refetch. |

---

## Section 4: Auth / networking

> Quick scan: Cognito `redirect_mismatch` is a byte-for-byte URL comparison; trailing slashes
> matter. 401 retry storms come from multiple concurrent requests each starting their own refresh;
> coordinate with a single in-flight promise. JWT clock skew almost always resolves by trusting
> network time on the server, not the client.

| Symptom | Root cause | Fix |
|---|---|---|
| "Sign in with Google" returns to a Cognito error page saying `redirect_mismatch`, or the web view closes and sign-in screen reappears with no error. | The `redirectUri` the app sends is not in the Cognito App Client's `CallbackURLs` list. Cognito compares byte-for-byte including trailing slashes and URL-encoding. | Log the actual `redirectUri` before `promptAsync`. Compare to the CDK stack's `oAuth.callbackUrls`. Add the exact URI — no wildcards (Cognito rejects wildcard lists entirely). See `./03-auth-and-networking.md` §8.1. |
| Under network flakiness, two concurrent API calls both 401, both call `refreshTokens()`; one succeeds, one silently logs the user out. | If `inFlight` promise resolves between the first 401 and the second's check, the second request sees `inFlight === null` and starts its own refresh. With Cognito rotation on, only one refresh keeps a valid refresh token; the other revokes. | Do not set `inFlight = null` until the retry of the original request also completes. Use a generation counter if aggressive parallelism is expected. See `./03-auth-and-networking.md` §8.3. |
| Fresh access tokens rejected by API Gateway with `Unauthorized` / `token_expired`; token was issued seconds ago. | Device clock is off by >5 minutes from AWS. Cognito's token `iat` is later than server's current time, or device is ahead and the token hasn't "started" yet. | Trust network time on the server. The 401 path will refresh, which usually gets a server-dated token. Do not let users override the device clock in production. Detect via `Math.abs(Date.now() - serverTimeFromResponseHeader) > 60_000` and surface a UX hint. See `./03-auth-and-networking.md` §8.4. |
| `useAuthRequest` returns a stable `request` that doesn't update when `clientId` changes. | `useAuthRequest` memoizes on the initial props by design — PKCE requires a stable verifier across a single flow. | Use `new AuthRequest(...)` directly, or remount the component by keying it on `clientId`. See `./03-auth-and-networking.md` §8.5. |
| Fetch requests hang on Android physical devices only; simulator / iOS work. | Android blocks cleartext HTTP by default and enforces `usesCleartextTraffic=false` in the release manifest. Calls to `http://` (not `https://`) fail silently or time out. | Use HTTPS in production. For local dev against `http://192.168.x.x`, add `android.config.usesCleartextTraffic: true` to `app.config.ts` **only for development builds**. Never enable in production. |
| API calls work on the main bundle but fail inside an inline WebView or embedded frame. | `Origin: null` header from opaque origins. Backend CORS policy rejects null origins. | Explicitly allow the embedded origin, or route the call through the parent app instead of the WebView. Never set `Access-Control-Allow-Origin: *` with credentials — it silently fails CORS preflight. |
| `fetch` with `AbortController` on React Native does not cancel the network request; only the JS promise rejects. | RN's `fetch` polyfill historically ignored the `AbortSignal` for the underlying native request. Fixed in RN 0.74+, but older SDKs still leak the request. | Upgrade to Expo SDK 54+ (RN 0.76+). For SDKs before that, accept the leak and ensure cancellation only affects UI state; do not rely on cancellation for rate-limited APIs. |

---

## Section 5: Native / release

> Quick scan: iOS 17+ privacy manifests, Android 14 foreground-service types, and APNS / FCM key
> rotation are the three most common post-SDK-54 release blockers. Always test `eas submit`
> against sandbox / internal testing tracks before production; simulator builds cannot be
> submitted to TestFlight.

| Symptom | Root cause | Fix |
|---|---|---|
| `eas submit` succeeds, but 30 minutes later Apple emails "We have discovered one or more issues... missing API declaration." | A dependency uses a required-reason API and its `PrivacyInfo.xcprivacy` is missing or not aggregated. iOS 17+ enforces this. | Read Apple's email — it lists the exact API category. Add a matching `NSPrivacyAccessedAPITypes` entry under `ios.privacyManifests` in `app.config.ts`. Rebuild, resubmit. See `./04-native-and-release.md` §11.4. |
| App crashes on launch on Android 14 devices with `SecurityException: Starting FGS with type none ... targetSDK=34`. | You declared `FOREGROUND_SERVICE` permission (directly or via `expo-background-fetch`, `expo-task-manager`, `expo-audio`) but did not declare an `android:foregroundServiceType` nor the matching typed permission. | Add the typed permission (e.g., `FOREGROUND_SERVICE_DATA_SYNC`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_LOCATION`). Config plugins for expo-audio / expo-location do this automatically — if you're writing a custom service, do it manually in the `<service>` element. See `./04-native-and-release.md` §11.5. |
| `eas update --branch production` reports success; no user gets the update. | Channel / profile mismatch. The production **build** has `channel: "prod"` (or a typo) in `eas.json`; the **update** went to branch `production`. Channel ≠ branch → no client polls. | Run `eas channel:view production` and `eas update:list --branch production`. Both must show the same name. In-app, log `Updates.channel` to confirm. See `./04-native-and-release.md` §11.2. |
| Pushes that worked in production suddenly stop; backend SNS/APNS logs show `InvalidToken` or 403. iOS only. | APNS `.p8` key has been revoked (rotated by a teammate, or the original creator's Apple Developer access removed). The key doesn't expire by time but does by human action. | Generate a new key in App Store Connect, upload via `eas credentials --platform ios`, update backend APNS config, redeploy backend. No app rebuild needed. See `./04-native-and-release.md` §11.1. |
| Android pushes suddenly stop; FCM backend shows 401/403 on send. | FCM server key rotated in Firebase Console, or the project was migrated from Legacy FCM to FCM HTTP v1 without updating the backend. | Regenerate in Firebase Console → Project Settings → Cloud Messaging. Update backend config to use the new service-account JSON (HTTP v1). If still on legacy keys, migrate — Google deprecated them on 2024-06-20. |
| `getExpoPushTokenAsync` returns a token in dev; same call in TestFlight returns nothing or throws. | APNS key not uploaded to EAS. The dev client routes through Expo's sandbox APNS; TestFlight and App Store builds need the real APNS key. | Upload the APNS `.p8` via `eas credentials` → Push Notifications. Rebuild. See `./04-native-and-release.md` §11.6. |
| Android notification icon is a white square instead of the app icon. | Android 5+ requires notification icons to be **monochrome** (alpha channel only; system tints the color). A full-color PNG renders as white. | Provide a monochrome `notification.icon` asset via the `expo-notifications` config plugin in `app.config.ts`. See `./04-native-and-release.md` §11.7. |
| `eas submit` rejects with `missing_export_method` or "simulator build cannot be submitted". | The EAS build profile used `"simulator": true` or `"distribution": "simulator"`. Simulator builds are Mach-O simulator-only binaries; App Store / TestFlight require device builds (`arm64` only). | Use a separate EAS profile for submission — set `distribution: "store"` and omit `simulator`. Common error after copy-pasting a `preview` profile that was originally simulator-only. |
| EAS Build works on a teammate's machine but fails on EAS with `Environment variable 'X' is not defined`. | Profile-specific environment variables / EAS secrets are missing from the build profile. Local builds inherit the dev shell's `.env`; EAS Build does not. | Set via `eas secret:create` or declare under `eas.json`'s `build.<profile>.env`. Never commit secrets to `eas.json` — use `eas secret:create` for sensitive values. |
| iOS build fails on EAS with `CocoaPods could not find compatible versions for pod 'ExpoModulesCore'` after adding a dependency. | The dependency ships with a newer `ExpoModulesCore` peer than your SDK. Usually an Expo-ecosystem package was installed with `npm install` instead of `expo install`. | `npx expo install <pkg>@latest` re-resolves against the installed SDK. Delete `ios/Podfile.lock` and `ios/` (if checked in), run `npx expo prebuild --clean`, retry. |
| OTA update downloads but never applies; app always shows the baseline bundle. | `Updates.checkForUpdateAsync` runs but the fetched update's `runtimeVersion` doesn't match the installed binary's. EAS Update silently skips incompatible runtime versions. | Bump `runtimeVersion` on every native change; keep it stable across OTA-only JS-level changes. Use `runtimeVersion: { policy: "fingerprint" }` to let EAS compute it from the native project state. |

---

## Section 6: Web / PWA

> Quick scan: NativeWind "works on native, broken on web" is almost always a Tailwind `content`
> glob miss. Native-only modules crashing the web bundle is solved with `.web.ts` / `.native.ts`
> suffix overrides, not Metro `resolver.platforms` tweaks.

| Symptom | Root cause | Fix |
|---|---|---|
| NativeWind classes apply on iOS / Android; web build has unstyled elements. | `tailwind.config.js` `content` glob is missing the directory that uses the class. NativeWind's native runtime computes styles at render time regardless of glob; web relies on Tailwind-generated CSS, which only includes classes the glob saw. | Update the glob to cover every directory with `className` usage. Rerun `npx expo export --platform web`. Verify with `grep 'bg-brand-500' dist/` that the class landed in the CSS. See `./05-cross-platform-web.md` §9. |
| Web bundle crashes at load with `undefined is not a function` or `Cannot read properties of undefined` from a module import. Same code runs on mobile. | A native-only module (e.g., `expo-local-authentication`, `react-native-purchases`, anything pulling `react-native/Libraries/NativeModules`) was imported at module scope. Metro ships the import in the web bundle; the module's web build is empty or throws. | Move the import behind a `.native.ts` vs `.web.ts` capability hook. Never import native-only modules at the top of a universal file. See `./05-cross-platform-web.md` §9. Metro `resolver.platforms` rarely helps — the right fix is platform file extensions. |
| `expo-image` renders placeholder only on web; images load fine on mobile. | `expo-image`'s web implementation uses a canvas internally and fails silently if the image URL's CORS headers block canvas reads. | Verify the CDN returns `Access-Control-Allow-Origin: *` (or specific origin). For S3: set bucket CORS policy. Fallback to `<Image>` from `react-native` on web if CORS can't be fixed. See `./05-cross-platform-web.md` §9. |
| Flex layouts differ between web and mobile — children stacking vertically on web, horizontally on mobile. | React Native's default `flexDirection` is `column`; web's is `row`. `react-native-web` reconciles this but a component that omits `flexDirection` or sets it conditionally hits the default-mismatch edge case. | Always set `flexDirection` explicitly when the layout depends on it. Lint rule: forbid `<View>` with `flex: 1` + children unless `flexDirection` is set. See `./05-cross-platform-web.md` §9. |
| OAuth redirect comes back to the app on mobile but lands on a blank white page on web. | `expo-auth-session`'s `auth.expo.io` proxy is native-only. On web, the redirect must go back to the app's own origin (e.g., `https://shop.acmeshop.example/auth/callback`), and Cognito must have that URL registered. | Use the `.web.tsx` sign-in pattern — plain `window.location.href` redirect. Add the web origin's `/auth/callback` to the Cognito app client allow-list. Never use the native-proxy path on web. See `./05-cross-platform-web.md` §9. |
| SPA deep link (paste URL into fresh tab) shows blank page / 404; navigation from inside the app works. | The static host isn't configured for SPA fallback (all routes → `index.html`). Common on Netlify without `_redirects`, on CloudFront without a 403/404 error-response rewrite. | Configure the host: Netlify `/* /index.html 200`; CloudFront custom error response `403 → /index.html → 200`. Verify locally with `npx serve dist --single`. |
| Web PWA install prompt doesn't appear on Android Chrome even though `manifest.json` is served. | Lighthouse PWA audit has an unmet criterion: missing maskable icon, missing `start_url` reachable offline, or `display: "standalone"` not set. | Run Lighthouse in Chrome DevTools → PWA audit. Fix each flagged item. `expo-web-browser` / `app.config.ts` `web.shortName` is not enough; the manifest must satisfy the full PWA criteria. |

---

## Section 7: Performance / testing

> Quick scan: Jest failures on Expo packages are almost always a `transformIgnorePatterns` miss.
> `FlatList` jank is usually missing `getItemLayout` or unconstrained image sources. Maestro
> flakes on Apple Silicon are a Rosetta-simulator issue — reinstall Xcode from the App Store.

| Symptom | Root cause | Fix |
|---|---|---|
| Jest fails on `SyntaxError: Unexpected token 'export'` importing an Expo package or `@shopify/flash-list`. | `transformIgnorePatterns` excludes that package from Babel transformation. Expo packages ship as ESM; the default Jest config does not transform `node_modules`. | Add the package to the negative lookahead in `transformIgnorePatterns`. Reference list in `./06-performance-and-testing.md` §10.1. `jest-expo` preset helps but does not cover every third-party package. |
| MSW tests throw `MSW: Unable to intercept request` or behave as if MSW is not installed. | Imported from `msw/node` (Undici-based) instead of `msw/native` (React Native fetch polyfill). | `grep -rn "from 'msw/node'"` across the repo; switch to `msw/native`. See `./06-performance-and-testing.md` §10.2. |
| `renderWithProviders(<CatalogScreen />)` from `@testing-library/react-native` renders `null`. `screen.debug()` shows `<></>`. | Screen uses `useLocalSearchParams()` or `useRouter()` from `expo-router`; without a router provider / mock, those hooks return `undefined` and the screen bails out. | Add `jest.mock("expo-router", …)` with a minimal mock, OR render the body component (`<CatalogScreenBody products={…} />`) instead of the route file. See `./06-performance-and-testing.md` §10.3. |
| Maestro flows succeed on Android but flake on iOS simulator on Apple Silicon Mac (elements not found, first-tap timeouts). | Simulator runs under Rosetta because Xcode install is x86_64. WebDriverAgent build takes 3–5× longer; first taps miss their timeout. | Reinstall Xcode from the App Store on Apple Silicon (not `softwareupdate --install-rosetta`). Confirm with `xcrun simctl runtime list \| grep arm64`. See `./06-performance-and-testing.md` §10.4. |
| `FlatList` janky when scrolling through images. Frame drops to 20–30 fps. | Missing `getItemLayout` (or `estimatedItemSize` on FlashList v1), images have no dimension hints, and `initialNumToRender` / `maxToRenderPerBatch` are defaults. On FlashList v2, dimension auto-inference replaces `estimatedItemSize` but images still need explicit `width`/`height`. | Prefer FlashList v2 over `FlatList` for long lists. Always pass explicit `width`/`height` (or `aspectRatio`) to image sources; use `expo-image`'s `recyclingKey` prop to reduce reallocations. Profile with Flipper or the Hermes sampling profiler. |
| Metro bundler "Cannot resolve module <native-pkg>" after adding a native dependency. | Metro cache is stale from before the package was installed, OR `expo prebuild` was not run after installing a package that requires native code. | `npx expo start --clear` clears the Metro cache. If a native build is needed, run `npx expo prebuild` (or let EAS Build do it). For packages that require CocoaPods integration, run `cd ios && pod install` after prebuild. |
| Hermes debugger / Flipper fails to attach on a physical device; works on simulator. | `localhost` in the debugger config only works on simulator. Physical device needs the Mac's LAN IP, or USB port forwarding on Android (`adb reverse tcp:8081 tcp:8081`). | For iOS: use `adb`-equivalent tunneling via Expo dev client QR code. For Android: `adb reverse tcp:8081 tcp:8081`. Debugger config: `localhost` → Mac's LAN IP on the device. |
| FlashList v2 performance is worse than v1 after upgrade; type-check passes. | FlashList v2 removed `estimatedItemSize`; old v1 props (`estimatedItemSize`, `estimatedListSize`, `estimatedFirstItemOffset`) are silently ignored, causing the v2 runtime to fall back to generic sizing. | Delete every `estimatedItemSize` / `estimatedListSize` / `estimatedFirstItemOffset` in the codebase. v2 auto-infers; no replacement prop is needed. See `./06-performance-and-testing.md` §10.5. |
| React Native app exits with "JavaScript heap out of memory" on large data operations. | JS heap default is 512 MB on Hermes; a data transform loading a 100 MB JSON onto the JS thread exhausts it. | Stream / chunk large data; do the heavy lift on a native thread via `react-native-turbo-module` or `react-native-executorch`. Avoid loading whole datasets into JS state. |
| Integration test fails in CI with `ENOTCONN` or `ECONNREFUSED` on the first network call; passes locally. | CI provisions the network after the test runner starts, or the test mock server races with the first test. | Add a health-check wait step in CI before running tests; or use `--testTimeout=10000` and retry-on-network-flake in the integration layer. |

---

## Section 8: i18n / a11y

> Quick scan: RTL issues on iOS usually resolve after a cold restart; VoiceOver focus stuck on
> unmounted views needs `AccessibilityInfo.setAccessibilityFocus()` on screen mount. Hermes
> `Intl.PluralRules` missing crashes any release Android build that does pluralization — always
> `import "intl-pluralrules"` before i18n init.

| Symptom | Root cause | Fix |
|---|---|---|
| Developer adds `t("newFeature.title")`, tests locally, ships. Non-EN users see `newFeature.title` as literal text. | `i18n:extract` ran locally and updated `en.json` but not other locales. No CI gate caught it. | Enforce `npm run i18n:check` in CI. Every non-EN locale should be a translation-service output or committed with explicit fallbacks, never stale. See `./07-i18n-and-accessibility.md` §9.1. |
| User installs Arabic build on iOS. First launch LTR; close and reopen, now RTL. | `I18nManager.forceRTL(true)` requires a reload; `Updates.reloadAsync()` fires but iOS sometimes caches the original JS bundle until the next cold start. | Set `supportsRTL: true` in `app.config.ts` via `expo-localization`. Accept first-launch LTR; after `reloadAsync()`, surface a toast if `I18nManager.isRTL` still doesn't match. Deeper fix requires a native change Expo doesn't expose. See `./07-i18n-and-accessibility.md` §9.2. |
| A chevron-right icon doesn't flip to chevron-left in Arabic layout. | Icon rendered via `<Icon name="chevron-right" />` without an `I18nManager.isRTL` guard. Text flips automatically; icons don't unless you explicitly mirror them. | For directional icons that should flip: `{I18nManager.isRTL ? 'chevron-left' : 'chevron-right'}`. For icons that should stay pointing right regardless (e.g., play button): no guard needed but comment the decision. |
| VoiceOver announces nothing after a custom `<Pressable>` is tapped. | Custom `<Pressable>` is missing `accessibilityLabel` and `accessibilityRole="button"`. RN only auto-applies these for `<Button>` (stock). | Add `accessibilityRole="button"` and `accessibilityLabel="..."` to every `<Pressable>` used as a button. Lint rule: forbid `<Pressable>` without `accessibilityLabel` when `onPress` is defined. |
| VoiceOver focus stuck on a hidden / unmounted view after screen transition; swipe-right does nothing. | Previous screen's focused element unmounted while VO still held a reference. | Call `AccessibilityInfo.setAccessibilityFocus(ref.current)` on screen mount for the main interactive element. Add it to the base screen template. See `./07-i18n-and-accessibility.md` §9.3. |
| At maximum iOS Dynamic Type, a primary action button wraps to three lines and clips behind the keyboard. | Fixed `height: 48` on the button row + Dynamic Type scaling on `<Text>`. | Replace `height` with `minHeight`; test at 200% Dynamic Type. As a last resort: `maxFontSizeMultiplier={1.3}` on the specific `<Text>`. Never `allowFontScaling={false}` globally. See `./07-i18n-and-accessibility.md` §9.4. |
| Release-build Android throws `Intl.PluralRules is not a function` on the first pluralized string. | Hermes ships `Intl.NumberFormat` and `Intl.DateTimeFormat` but not `Intl.PluralRules`. i18next v26 requires it. | `import "intl-pluralrules"` once before i18n init at the top of `app/_layout.tsx` or your i18n config file. See `./07-i18n-and-accessibility.md` §9.5. |
| Arabic translator wrote `"item_one"` and `"item_other"` copying EN structure. UI shows correct for count=1 and 5, wrong for count=2 and count≥11. | Arabic has six CLDR plural forms; `_one`/`_other` only expresses two. Counts 2 (dual), 3–10, 11–99, 100+ fall back to `_other`, which is ungrammatical for many forms. | Author Arabic translations with all six forms: `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`. Lint: for locales whose CLDR form count > 2, require a full set of plural keys. See `./07-i18n-and-accessibility.md` §9.6. |
| `Locale.current` returns `en-US` on a Spanish-language iOS device. | `expo-localization` reads the app's locale, not the device's preferred locale list, if the app's `Info.plist` `CFBundleLocalizations` doesn't include Spanish. | Ensure `CFBundleLocalizations` includes every supported locale via `expo-localization` plugin config: `locales: ["en", "es", "ar", …]`. Rebuild. |

---

## Section 9: Observability

> Quick scan: Sentry source-map mismatches are almost always a release-string drift or a missing
> upload step in the EAS hook. Analytics events firing in dev = missing `__DEV__` guard.
> PostHog feature flags stale = missing `reloadFeatureFlagsAsync` on sign-in.

| Symptom | Root cause | Fix |
|---|---|---|
| Release crash in Sentry shows `index.android.bundle:1:42981` instead of `src/features/cart/useCart.ts:42`. Sentry shows the map as uploaded. | `release` string in `Sentry.init` doesn't match the release the map was uploaded against. The Expo config plugin auto-detects the release; a manual `Sentry.init` overwrote it with a different string. | Drop the `release:` from `Sentry.init` and trust the plugin, OR make both match exactly. Plugin format: `${bundleIdentifier}@${version}+${buildNumber}`. Second cause: `debugId` mismatch — clean build with `eas build --clear-cache`. See `./08-observability.md` §12.1. |
| In dev, errors show up twice in Metro console; in prod, once. | `Sentry.init` called on every fast refresh because `app/_layout.tsx` re-evaluates. | Guard with `if (!__DEV__) Sentry.init(...)`. The "no Sentry in dev" rule avoids dev noise entirely. See `./08-observability.md` §12.2. |
| PostHog dashboard shows 20× more `cart_item_added` events than users; half from `<laptop-hostname>` on `development`. | `useAnalytics` hook lost the `__DEV__` guard in a refactor; events fire in dev. | Guard with `__DEV__` in the analytics provider. Unit test: assert `posthog.capture` is not called when `__DEV__` is true. See `./08-observability.md` §12.3. |
| A Sentry crash report contains a breadcrumb like `POST /auth/login — body: {"email":"...","password":"..."}`. | The SDK's default XHR breadcrumb captures request bodies. `beforeSend` scrubs, but breadcrumbs pass through `beforeBreadcrumb` first. | Strip `data.body` from XHR breadcrumbs via `beforeBreadcrumb`. See `./08-observability.md` §12.4. |
| PostHog feature flag flip in the dashboard takes 24 hours to propagate to users. | PostHog caches flag evaluations on disk; uses cache on cold start. Missing `reloadFeatureFlagsAsync` call. | `await client.reloadFeatureFlagsAsync()` on init and on sign-in, with `Promise.race` timeout so it never blocks startup >2s. See `./08-observability.md` §12.5. |
| Session replay shows the user typing a credit-card number into an embedded payment WebView. | `maskAllText` masks React Native `<Text>`; WebView renders HTML outside the SDK's tree. | Set `maskAllInputs: true` on WebView pages, or exclude WebViews from replay entirely via the SDK's allow-list. See `./08-observability.md` §12.6. |
| Sentry event volume exceeds quota; most events are low-priority warnings. | Default sample rates for `tracesSampleRate` and `profilesSampleRate` (1.0) send every event. | Set `tracesSampleRate: 0.1` in production (10%) and `0.0` in dev. Sample based on transaction name for high-traffic screens (e.g., home screen at 0.01). |

---

## Section 10: Monetization

> Quick scan: Subscription product not returned = App Store Connect status / sandbox tester
> territory / bundle ID mismatch. Restore purchases returning empty after device switch = Apple
> ID mismatch between Settings and the app. Android Play Store testing track requires signed
> upload via `eas submit`, not ADB sideload.

| Symptom | Root cause | Fix |
|---|---|---|
| `Purchases.getOfferings()` returns offering but `availablePackages[n].product` is null; paywall shows nothing. | Product in App Store Connect is "Waiting for Review" / "Developer Action Needed". Only "Ready to Submit" and "Approved" return for sandbox purchases. | Verify in App Store Connect; product must be in "Ready to Submit" or later. Also check: sandbox tester territory matches product price-tier territory; bundle ID matches (prod vs dev variants attach to different products). See `./09-monetization.md` §12.1. |
| User subscribes; backend DB has `plus: true` in 2s; client cache still `isPlus: false` for 15–30s. | RevenueCat SDK's `addCustomerInfoUpdateListener` fires after native StoreKit transaction completes (~1–3s). Race: client `purchasePackage` resolves, user navigates away before listener fires. | Explicit `Purchases.getCustomerInfo()` on mount of any entitlement-gated screen. For backend-first UX, query your own backend endpoint (webhook-updated) instead of the SDK cache. See `./09-monetization.md` §12.2. |
| User signs into a second device with same Apple ID, fresh install. Taps "Restore Purchases" — gets "No previous subscriptions". But active subscription exists. | Apple ID in device Settings → Media & Purchases ≠ Apple ID signed into the App Store. Receipt is tied to the App Store Apple ID, not your app's user. | Check Settings → [User] → Media & Purchases → Apple ID. Document in UI help copy that subscriptions tie to the Apple ID in the App Store, not the app's user. See `./09-monetization.md` §12.3. |
| On Android, `Purchases.getOfferings()` returns empty on an internal test build. RC dashboard shows products as active. | Play Store only returns products for builds uploaded to a Play Console track. A local `eas build --profile development` installed via ADB does NOT get products. | `eas submit --profile preview` uploads to Play Console Internal Testing track. Install from the Play Store on a listed tester device. ADB install after upload still fails — Play checks install origin. See `./09-monetization.md` §12.4. |
| On cold start, `Purchases.getCustomerInfo()` returns `entitlements.active = {}` even though user is subscribed. 2–5s later it updates. | SDK's local receipt cache is initialising async. Code that reads the cache immediately on app open gets stale / empty state. | Treat pre-init state as "loading", not "not subscribed". UI shows spinner or defaults to Plus-off until the hook resolves. See `./09-monetization.md` §12.5. |
| `StoreKit` error on sandbox user: "Cannot connect to iTunes Store". | Device's sandbox account isn't set (or expired). Settings → App Store → Sandbox Account must be signed in. | Sign into the sandbox account in Settings → App Store → Sandbox Account. Sandbox accounts are separate from production Apple IDs; they can't be used on prod App Store. Create in App Store Connect → Users and Access → Sandbox Testers. |
| First-time user purchases before signing up; after they sign up, their subscription attaches to the anonymous RC `app_user_id`, not their real user ID. | `Purchases.configure` runs before auth is known; anonymous purchase is the normal flow for pre-login paywalls. | Call `Purchases.logIn(user.id)` after auth. RC's alias merges the anonymous ID into the real user. Cross-device anonymous-then-login case requires a manual restore on device B. See `./09-monetization.md` §12.6. |
| Android Play Console rejects uploaded AAB with `The Android App Bundle was not signed` or `Version code X is already in use`. | Either the AAB wasn't signed (expired keystore, wrong profile) OR `versionCode` wasn't incremented since the last upload. | Increment `android.versionCode` in `app.config.ts` before every upload (EAS auto-increments if configured). Verify signing via `eas credentials --platform android`. Version codes are append-only — Play rejects downgrades. |
| iOS subscription renews correctly but the user's `entitlements.active` doesn't refresh on app open. | RevenueCat's receipt refresh depends on the app calling `syncPurchases` or having `autoSync` enabled. Without it, renewal events are backend-only until the user restarts. | Enable `autoSync` in `Purchases.configure` (on by default in v10+). For immediate post-renewal state, call `Purchases.syncPurchases()` on `AppState` `active` transitions. |

---

## Section 11: Cross-reference — AWS backend gotchas

This file covers **client-side** gotchas: Expo SDK, React Native runtime, device behavior, and
store submission. It does not cover backend provisioning.

AWS CDK / DynamoDB gotchas the mobile app consumes live in:

- **`../../aws-cdk-patterns/references/04-database.md` §7** — Aurora Serverless v2 engine
  requirements, cross-stack exports, GSI-query-then-write race, CDK-side TTL misconfigurations.
- **`../../aws-cdk-patterns/references/02-auth-stack.md`** — Cognito user pool configuration and
  federation setup that `./03-auth-and-networking.md` consumes client-side.
- **`../../dynamodb-design/references/07-gotchas.md`** — DynamoDB access-pattern gotchas:
  `BatchWrite` unprocessed items, `TransactWrite` cancellation inspection, stream `IteratorAge`,
  GSI sparse indexes, schema evolution. The mobile client's offline queue (`./02-state-and-data.md`
  §4) interacts with several of these — especially the `409 Conflict` row in Section 3 of this file.

If a symptom involves a CDK synth error, a CloudFormation deploy failure, a DynamoDB throttle,
or a GSI projection issue, start in one of those files.

---

## Section 12: Further reading

### Inside this skill

- `./00-architecture.md` — Project layout, `app.config.ts` authoring, `EXPO_PUBLIC_*` helpers,
  config plugins, `.env` hygiene.
- `./01-navigation.md` — `expo-router` typed routes, deep links, universal-link verification,
  protected-route splash pattern.
- `./02-state-and-data.md` — Zustand + MMKV persistence, TanStack Query v5 setup, offline queue
  with conflict handling.
- `./03-auth-and-networking.md` — Cognito hosted UI, Google federation via `expo-auth-session`,
  single-flight 401 refresh, clock-skew handling.
- `./04-native-and-release.md` — EAS Build / Submit / Update, OTA channels, APNS / FCM keys,
  config-plugin authoring, privacy manifests, Android 14 foreground-service types.
- `./05-cross-platform-web.md` — NativeWind on web, native-only module isolation,
  `expo-image` CORS, OAuth-on-web, SPA fallback, PWA manifest.
- `./06-performance-and-testing.md` — Jest + `jest-expo`, MSW native, `expo-router` test wrappers,
  FlashList v2, Hermes profiler, Maestro E2E.
- `./07-i18n-and-accessibility.md` — `expo-localization`, RTL, Dynamic Type, VoiceOver focus,
  `Intl.PluralRules`, CLDR plural forms.
- `./08-observability.md` — Sentry source maps, `__DEV__` guards, PostHog feature-flag cache,
  breadcrumb PII scrubbing, session-replay masking.
- `./09-monetization.md` — RevenueCat + StoreKit + Play Billing, sandbox testing, webhooks,
  restore purchases, cross-device subscription continuity.

### Sibling skills

- `../../aws-cdk-patterns/references/02-auth-stack.md` — Cognito user pool + Google federation.
- `../../aws-cdk-patterns/references/04-database.md` §7 — CDK-side DynamoDB and Aurora gotchas.
- `../../dynamodb-design/references/07-gotchas.md` — DynamoDB access-pattern gotchas.

### External documentation

- [Expo SDK 54 release notes](https://expo.dev/changelog) — What changed since SDK 53.
- [Apple — Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing_data_use_in_privacy_manifests)
  — Authoritative reference for `PrivacyInfo.xcprivacy` (iOS 17+).
- [Android — Foreground service types](https://developer.android.com/about/versions/14/changes/fgs-types-required)
  — Android 14 `targetSdk=34` requirements for typed foreground services.
- [EAS Build — Build profiles](https://docs.expo.dev/build/eas-json/) — `eas.json` schema,
  environment variables, channels vs branches.
- [EAS Update — Channels and branches](https://docs.expo.dev/eas-update/how-it-works/) —
  Relationship between `channel` (build-side) and `branch` (update-side).
- [expo-router — Typed routes](https://docs.expo.dev/router/reference/typed-routes/) —
  `experiments.typedRoutes`, regeneration behavior.
- [expo-linking — Into your app](https://docs.expo.dev/linking/into-your-app/) — Custom schemes,
  universal links, app links.
- [TanStack Query v5 migration guide](https://tanstack.com/query/v5/docs/react/guides/migrating-to-v5)
  — `cacheTime` → `gcTime`, `keepPreviousData` → `placeholderData`, and other renames.
- [Sentry — React Native source maps](https://docs.sentry.io/platforms/react-native/sourcemaps/) —
  Release string format, `debugId` mechanics, EAS hook integration.
- [RevenueCat — Testing purchases](https://www.revenuecat.com/docs/test-and-launch/sandbox) —
  iOS sandbox accounts, Play Store testing tracks, cross-device restore.
- [Google Firebase Cloud Messaging — HTTP v1 migration](https://firebase.google.com/docs/cloud-messaging/migrate-v1)
  — FCM legacy API deprecation (ended 2024-06-20) and service-account migration.
- [Apple — App Store Connect help: Sandbox testers](https://developer.apple.com/help/app-store-connect/test-in-app-purchases-with-sandbox-apple-accounts/)
  — Creating sandbox testers, setting territory, signing in on device.
