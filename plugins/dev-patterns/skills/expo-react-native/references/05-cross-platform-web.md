# Cross-platform web

**Builds:** The web target for Acme Shop — `npx expo export --platform web` producing a static bundle that deploys to S3 + CloudFront, platform-specific files (`.web.tsx`) for the sign-in and checkout branches that only work on mobile, responsive layouts that switch from a phone-style single column to a desktop catalog shell, NativeWind wired so the same utility classes apply on iOS, Android, and web, and a PWA `manifest.json` that makes catalog.acmeshop.example installable on desktop Chrome.
**When to use:** Deciding whether to ship a web target at all (viable ~70% of the time; not viable the rest), standing up a web build after the mobile app is already shipping, chasing a "works on phone but blank on web" bug, wiring NativeWind so it applies on every platform, or drafting the `manifest.json` for a PWA submission. Read Sections 1-2 first — they answer the viability question so you do not write a web target you shouldn't ship. Sections 6-8 are the day-to-day web-specific plumbing.
**Prerequisites:** `./00-architecture.md` (project layout, `app.config.ts`, EAS profiles — the web build reuses the same project), `./01-navigation.md` (expo-router routes; web uses the same route tree with one platform-specific file split), and `./03-auth-and-networking.md` (web-friendly auth-session flow, since `expo-auth-session`'s native proxy is the #1 "works on iOS, blank on web" problem). For the hosting layer, see `../../aws-cdk-patterns/references/03-static-site.md`.

> Examples verified against Expo SDK 54 + `nativewind` 4.2.x on 2026-04-23. Re-verify via context7 before porting to a newer SDK — NativeWind v5 (pre-release as of this date) changes the Babel / Metro pipeline and should be treated as a separate migration.

## Contents

1. **Is a web target viable?** — The 80%-shared-logic rule; when to ship Expo-for-web vs stand up a separate Next.js app; the four disqualifying constraints (SEO-critical landing pages, desktop-only advanced UI, heavy document editing, offline-first desktop apps).
2. **Build config** — `npx expo export --platform web` produces `dist/`; how Metro resolves platform extensions for the web target; the `public/` folder; output shape and static-hosting expectations.
3. **`Platform.select` and platform-specific files** — Runtime `Platform.OS === 'web'` vs compile-time `.web.tsx` split; when to pick which; how to avoid the if/else sprawl that calcifies every component around a platform check.
4. **Responsive layouts** — `useWindowDimensions` + a breakpoint helper (`isPhone` / `isTablet` / `isDesktop`); layout components that switch from a mobile stack to a desktop shell at a named breakpoint; keeping the mobile layout unchanged.
5. **NativeWind vs `StyleSheet`** — NativeWind for rapid cross-platform UI consistency; `StyleSheet` for perf-critical lists and when the Tailwind footprint is undesirable; the decision rule.
6. **NativeWind setup for web** — `tailwind.config.js` content glob that includes web files; `metro.config.js` with `withNativeWind`; `babel.config.js` with `jsxImportSource`; `global.css` wired as the Metro input; the one class of bug — "classes apply on iOS/Android, blank on web" — this section exists to prevent.
7. **PWA plumbing** — `manifest.json` generation, when a service worker is worth the effort, `expo-web-browser` vs `Linking.openURL` (web opens in the same tab vs a new one), the SEO caveat (Expo-for-web is CSR only).
8. **Deployment** — Brief note: static hosting of `dist/` on S3 + CloudFront. Full CDK stack lives in `../../aws-cdk-patterns/references/03-static-site.md`.
9. **Gotchas (web-specific)** — NativeWind classes silently dropped, `expo-image` web fallback, a native-only module pulling the entire web bundle to `undefined`, `flex` default-direction differences, `expo-auth-session` redirect mismatch.
10. **Verification** — `npx expo export --platform web`, bundle-size smoke, Lighthouse PWA score, manual sanity on desktop Chrome + mobile Safari.
11. **Further reading**

---

## Section 1: Is a web target viable?

Before writing a single line of web-specific code, answer this: **does Acme Shop on the web need to share ≥80% of its logic with mobile, or is the web experience different enough that a separate Next.js app would ship faster and better?**

Expo-for-web gives you one codebase, one team, one bug list. It gives back a PWA that runs in any modern browser and is installable on desktop Chrome. It does **not** give you server-side rendering, SEO-friendly HTML, or native desktop widgets.

### When Expo-for-web is viable

Ship Expo-for-web when **all** of the following hold:

- The app is primarily **UI- or form-driven** — catalog browsing, a dashboard, settings, a chat surface. The desktop experience is "more of the same, wider."
- You share **auth, data model, API surface, and ≥80% of business logic** with the mobile client. The web target reuses `apiClient`, `tokenStore`, the Zustand cart, TanStack Query caches, and all domain logic.
- **SEO is not critical.** Either the surface is gated behind auth (cart, order history) or it is a PWA users install from an internal link.
- **Desktop-only advanced interactions are rare.** Multi-pane split views, heavy keyboard shortcuts, drag-and-drop between zones, and context menus are nice-to-haves, not core workflow.

### When to build a separate web app instead

Spin up a Next.js app (different repo) when **any** of the following holds:

- **SEO-critical public pages** — marketing, product pages that need to rank on Google. Expo-for-web is CSR; the initial HTML is an empty `<div id="root">`. You will lose to a Next.js site on Core Web Vitals.
- **Complex desktop-only UI** — Google Docs-class editors, Figma-class canvases, Airtable-class spreadsheets. The primitives optimize for phone-style UI; desktop-native ergonomics land badly.
- **Offline-first desktop app** requirements beyond service-worker + IndexedDB.
- **A web-first product** where mobile is a follow-on. Expo-for-web is "mobile first, share with web." If web is primary, start from Next.js.

### Acme Shop's choice

Acme Shop ships Expo-for-web for the authenticated surface — catalog browsing, cart, checkout, order history, account settings. The marketing site (`https://www.acmeshop.example`) is a separate Next.js app on a different S3 + CloudFront stack. **This reference only covers the Expo-for-web target.** Next.js setup is out of scope. If SEO mattered, we would not be writing this file.

---

## Section 2: Build config

### The command

```bash
# One-shot export for production. Output goes to ./dist/.
npx expo export --platform web
```

Output shape (slightly abridged):

```
dist/
├── index.html                           # Single CSR entry; hydrates the JS bundle
├── favicon.ico
├── manifest.json                        # PWA manifest (Section 7)
├── assets/
│   └── _expo/static/js/web/             # Code-split JS chunks (hashed filenames)
│       ├── index-<hash>.js              # Main bundle
│       └── AsyncBoundary-<hash>.js      # Lazy-loaded chunk per lazy() boundary
└── (copies of everything under public/)
```

Every file `dist/public/<path>` came from your project's `public/` folder at export time. Put static assets (robots.txt, favicons, the `manifest.json` if you author it manually, any image a service worker needs to cache) in `public/` before running `expo export`.

### How Metro resolves files for the web target

Metro sees `--platform web` and walks the platform extension chain for every `import`:

```
Foo.web.tsx → Foo.tsx (fallback)
```

It does **not** consider `Foo.native.tsx` or `Foo.ios.tsx` / `Foo.android.tsx` when bundling for web. This is how you write a native-only module and a web-only module that share a component name (`AuthSessionBranch.native.tsx` and `AuthSessionBranch.web.tsx`); each platform sees only its file.

The rule for expo-router route files: **a platform-specific route file requires a non-platform sibling.** An `app/about.web.tsx` without `app/about.tsx` is an error — expo-router needs the universal entry so deep links resolve on every platform. Section 3 covers the pattern.

### Static-hosting expectations

The `dist/` folder is a regular static site. Any static host serves it: S3 + CloudFront (our default), Cloudflare Pages, Netlify, Vercel static. Requirements:

- **SPA fallback** — every unknown path rewrites to `/index.html`. On CloudFront, a "custom error response" maps `403` and `404` to `/index.html` with a 200 status. `../../aws-cdk-patterns/references/03-static-site.md` §5 has the CDK snippet.
- **Cache headers** — `/assets/_expo/static/**` gets a year (content-hashed filenames). `/index.html` and `/manifest.json` get zero.
- **Content type** — serve `manifest.json` as `application/manifest+json`. Browsers accept the default `application/json`; Lighthouse complains.

`public/` is copied verbatim. Secrets, `.env` files, and backend API keys do **not** belong there — they ship as world-readable URLs.

---

## Section 3: `Platform.select` and platform-specific files

Two tools. One rule for picking between them.

- **Runtime split** — `Platform.OS === 'web'` or `Platform.select({ web: ..., default: ... })`. Both branches ship in every bundle. Use this when the platform-specific code is ≤10 lines and you do not pull in a heavy native-only or web-only module.
- **Compile-time split** — `Foo.web.tsx` vs `Foo.tsx`. The non-matching file never ships. Use this when the code is ≥10 lines or when one side imports a module that cannot be bundled on the other platform.

### Runtime split — `Platform.select`

```tsx
// domains/shared/ui/ShopLink.tsx
import { Platform, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export function openShopLink(url: string) {
  // Web: open in a new tab, which is what users expect.
  // Native: open in an in-app browser so auth cookies survive the round-trip.
  return Platform.select({
    web: () => window.open(url, '_blank', 'noopener,noreferrer'),
    default: () => WebBrowser.openBrowserAsync(url),
  })!();
}

// Styles can also differ per platform.
const styles = {
  container: {
    padding: 16,
    // Web gets a hover cursor; RN ignores unknown keys on native.
    ...Platform.select({ web: { cursor: 'pointer' as const }, default: {} }),
  },
};
```

`Platform.select` returns the value for the matching platform or `default`. The `web` key wins on the web bundle, `ios` / `android` / `native` win on their respective platforms, `default` is the fallback. Omitting `default` and hitting a platform you didn't list returns `undefined` — a common silent-failure source.

### Compile-time split — `.web.tsx` vs `.tsx`

When the branches diverge significantly, use file-based splits:

```
domains/auth/screens/SignInScreen.tsx           # Universal entry (required)
domains/auth/screens/SignInScreen.web.tsx       # Web-only implementation
```

`SignInScreen.tsx` (the default) uses `expo-auth-session` with the native proxy. `SignInScreen.web.tsx` uses a plain redirect to Cognito Hosted UI — the native proxy does not work on web, and the web-friendly path would pull in web-only globals (`window.location`) that fail on native.

```tsx
// domains/auth/screens/SignInScreen.web.tsx
import { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';

const COGNITO_DOMAIN = process.env.EXPO_PUBLIC_COGNITO_DOMAIN!;
const CLIENT_ID = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID!;

export default function SignInScreen() {
  useEffect(() => {
    // If we came back from Cognito with a ?code=..., hand off to the token swap hook.
    // (See 03-auth-and-networking.md §4.)
  }, []);

  const signIn = () => {
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    window.location.href =
      `https://${COGNITO_DOMAIN}/oauth2/authorize` +
      `?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&scope=openid+email+profile`;
  };

  return (
    <View style={{ padding: 32 }}>
      <Text>Sign in to Acme Shop</Text>
      <Pressable onPress={signIn}>
        <Text>Continue with Cognito</Text>
      </Pressable>
    </View>
  );
}
```

The native `SignInScreen.tsx` stays unchanged from what `03-auth-and-networking.md` §3 documents. expo-router picks `.web.tsx` at bundle time for the web target and ignores it on iOS / Android.

### Avoiding the if/else sprawl

Scatter enough `Platform.OS === 'web'` checks through a component and you get code that is unreadable on every platform. Two refactors that help:

1. **Hoist the branch to the edge.** Push platform detection to the component boundary (a wrapper, a prop, a file split), not to every method.
2. **Feature-flag abstractions.** When the platform difference is about capability (can we open the camera? does this device have biometrics?), wrap it in a capability hook: `useCamera()`, `useBiometrics()`. Each platform's implementation of the hook encodes the check once.

```tsx
// domains/shared/capabilities/useBiometrics.ts — native
import * as LocalAuthentication from 'expo-local-authentication';
export function useBiometrics() {
  return {
    available: true,
    authenticate: () => LocalAuthentication.authenticateAsync(),
  };
}

// domains/shared/capabilities/useBiometrics.web.ts — web
export function useBiometrics() {
  return {
    available: false,
    authenticate: async () => ({ success: false, error: 'unavailable_on_web' as const }),
  };
}
```

Call sites never see `Platform.OS`. They see a capability with a known shape on every platform. `useBiometrics().available` is the check; `useBiometrics().authenticate()` is the action.

---

## Section 4: Responsive layouts

Phones are portrait, narrow, one-hand. Desktops are landscape, wide, mouse-and-keyboard. A catalog that shows one product per row on phone should show four per row on desktop. The layout change is driven by a **breakpoint helper** backed by `useWindowDimensions`.

### Breakpoint hook

```tsx
// domains/shared/layout/useBreakpoint.ts
import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

// Mobile-first thresholds. Match Tailwind defaults so NativeWind classes line up.
const BREAKPOINTS = { tablet: 768, desktop: 1024 };

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  const bp: Breakpoint =
    width >= BREAKPOINTS.desktop ? 'desktop' : width >= BREAKPOINTS.tablet ? 'tablet' : 'phone';
  return {
    bp,
    isPhone: bp === 'phone',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
    width,
  };
}
```

`useWindowDimensions` re-renders on orientation change and window resize — on web, dragging the browser edge re-evaluates the breakpoint. No manual listener.

### Responsive layout component

Acme Shop's catalog is a single column on phone and a four-up grid on desktop. One layout component handles both:

```tsx
// domains/shop/catalog/CatalogLayout.tsx
import { View, ScrollView } from 'react-native';
import { useBreakpoint } from '@/domains/shared/layout/useBreakpoint';
import type { Product } from '@/domains/shop/catalog/types';
import { ProductCard } from './ProductCard';

export function CatalogLayout({ products }: { products: Product[] }) {
  const { isDesktop, isTablet } = useBreakpoint();
  const columns = isDesktop ? 4 : isTablet ? 2 : 1;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: isDesktop ? 48 : 16 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        {products.map((p) => (
          <View key={p.id} style={{ width: `${100 / columns}%` }}>
            <ProductCard product={p} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
```

On phone: one column, tight padding. On tablet: two columns, medium padding. On desktop: four columns, generous padding. No branching inside `ProductCard` — the card renders the same on every breakpoint; only the grid around it changes.

### Desktop shells

Deeper than a grid — the catalog screen on desktop wants a left sidebar (filters) and a main area (products). On phone, filters live behind a button that opens a sheet. Same screen, two layouts:

```tsx
// app/(shop)/index.tsx — the route
import { CatalogLayout } from '@/domains/shop/catalog/CatalogLayout';
import { useBreakpoint } from '@/domains/shared/layout/useBreakpoint';
import { FilterSidebar, FilterSheet } from '@/domains/shop/catalog/Filters';
import { View } from 'react-native';

export default function Catalog() {
  const { isDesktop } = useBreakpoint();

  if (isDesktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: 280 }}>
          <FilterSidebar />
        </View>
        <View style={{ flex: 1 }}>
          <CatalogLayout products={/* ... */ []} />
        </View>
      </View>
    );
  }

  // Phone / tablet: filters in a bottom sheet.
  return (
    <View style={{ flex: 1 }}>
      <CatalogLayout products={/* ... */ []} />
      <FilterSheet />
    </View>
  );
}
```

The breakpoint check lives at exactly one spot — the screen root. `FilterSidebar` and `FilterSheet` are platform-agnostic; they just need to know whether to render as a docked pane or a slide-up sheet.

---

## Section 5: NativeWind vs `StyleSheet`

Two viable styling approaches for cross-platform Expo. Pick one per project.

### NativeWind — Tailwind classes on React Native

```tsx
<View className="flex-row items-center gap-4 p-4 bg-white dark:bg-neutral-900">
  <Text className="text-lg font-semibold">Total</Text>
  <Text className="ml-auto text-base">$42.00</Text>
</View>
```

**Pros.** One vocabulary across iOS, Android, and web. Dark-mode utilities (`dark:`) built in. Design tokens centralized in `tailwind.config.js`. Shared vocabulary with web teams already fluent in Tailwind.

**Cons.** Adds build-time transformation (Babel preset + Metro transformer). Slight runtime cost from the JSX transform on every render. Class-name strings are stringly-typed unless you layer `tailwind-variants` or similar.

### `StyleSheet` — React Native's native styling

```tsx
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  label: { fontSize: 18, fontWeight: '600' },
});
```

**Pros.** Zero build-time cost. `StyleSheet.create` freezes styles so reference equality works in lists — measurable FPS win in FlashList rows. The React Native default; every teammate will recognize it.

**Cons.** No design-token centralization unless you build one. No dark-mode helpers — branch on `useColorScheme()` manually. No implicit responsive utilities.

### Decision rule

- **New project, UI-heavy, desktop + mobile:** NativeWind.
- **Perf-critical list items (500+ row FlashList, 60fps target):** `StyleSheet` for the row component; NativeWind is fine elsewhere.
- **Mobile-only minimal-dependency tool:** `StyleSheet`. The Tailwind pipeline is not worth the dependency.

Acme Shop uses NativeWind for 95% of screens and `StyleSheet` for `ProductCard` (the row that renders in a 500+ item FlashList). This is the mix most projects converge to.

---

## Section 6: NativeWind setup for web

NativeWind v4 works on web, iOS, and Android out of the box, but **the web target silently drops your utility classes** if the Metro / Babel / Tailwind trio is misconfigured. This section is the canonical wiring so that does not happen. If you see "classes apply on iOS, blank on web," check every file below.

### `tailwind.config.js`

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  // CRITICAL: content glob must cover every file that uses className. Missing
  // an entry means Tailwind strips those classes from the production web
  // bundle. Native still works (NativeWind's runtime generates styles at
  // render time); web relies on the Tailwind-generated CSS.
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './domains/**/*.{js,jsx,ts,tsx}',
    // For monorepo packages, include: '../shared-ui/src/**/*.{js,jsx,ts,tsx}'
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: { brand: { 50: '#eef9ff', 500: '#0284c7', 900: '#0c4a6e' } },
    },
  },
  plugins: [],
};
```

The `nativewind/preset` line lets Tailwind emit RN-compatible style maps. Without it, `className` on native is a no-op.

### `metro.config.js`

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
```

`input` must point at a real file. The file tells Tailwind which CSS layers to emit. Minimal `global.css`:

```css
/* global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### `babel.config.js`

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource turns `className` into a NativeWind-aware JSX call.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

### `tsconfig.json`

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "jsxImportSource": "nativewind",
    "strict": true
  }
}
```

The tsconfig matches the babel preset. Without this line, TypeScript complains that `className` is not a valid prop on RN primitives.

### `app/_layout.tsx`

```tsx
// Import the generated CSS exactly once, at the root layout, so web picks it up.
import '../global.css';

import { Stack } from 'expo-router';
export default function RootLayout() {
  return <Stack />;
}
```

### The smoke test

Run the web build and check one utility class:

```bash
npx expo export --platform web
grep -r 'bg-brand-500' dist/assets/_expo/static/ | head -1
```

If the grep hits, NativeWind is wired for web. If not, the content glob is missing the file that uses `bg-brand-500`.

---

## Section 7: PWA plumbing

### `manifest.json`

Place this at `public/manifest.json`. Expo copies it verbatim into `dist/` at export time.

```json
{
  "name": "Acme Shop",
  "short_name": "Acme",
  "description": "Browse the Acme catalog and manage your orders.",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#ffffff",
  "theme_color": "#0284c7",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Wire it into `index.html` via `public/index.html` (Expo lets you override the default):

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0284c7" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

The maskable icon is what lets Android home screens render your icon in a circle without cropping; Lighthouse flags its absence.

### Service worker

Only add one if you need **installability** (the "Add to Home Screen" button) or **offline browsing**. For an app where every screen hits the API and the user can't do anything useful offline, a service worker is a liability — you will debug stale-cache bugs for a week.

If you do want one, generate a static service worker at build time with a small post-export script that runs `workbox` and outputs `dist/sw.js`; register it from `public/index.html`. `vite-plugin-pwa` does not apply (we are on Metro, not Vite).

Acme Shop ships the manifest but not a service worker. "Installable catalog app that hits the API live" is the target; offline browsing is not a requirement.

### `expo-web-browser` vs `Linking.openURL`

On native, `WebBrowser.openBrowserAsync` opens an in-app browser that can share cookies and be dismissed back to your app — the right choice for OAuth flows, help links, and terms-of-service pages. On web, `WebBrowser.openBrowserAsync` falls back to `window.open(url)`, which opens in a new tab.

Two gotchas:

- `WebBrowser.openBrowserAsync` on web opens a **new tab** unless you pass `{ windowFeatures: '_self' }`. Your copy ("see our terms") may imply same-tab navigation; be explicit.
- For plain external links where you **want** a new tab on web and an in-app browser on native, the `openShopLink` helper in Section 3 is the canonical pattern.

### SEO caveat

Expo-for-web is **client-side rendered**. The initial HTML is an empty `<div id="root">` and a JS bundle. Googlebot renders JS, but slower than it crawls HTML, and canonical URLs / per-page meta tags have to be set via `expo-router/head` — a fallible and ordering-sensitive API compared to Next.js metadata. If SEO is critical, use Next.js. This is not something we can engineer around inside Expo-for-web.

---

## Section 8: Deployment

Deployment is out of scope for this file. The short version:

1. `npx expo export --platform web` — produces `dist/`.
2. Sync `dist/` to an S3 bucket; invalidate the CloudFront distribution.
3. CloudFront is configured with SPA-fallback error responses, per-extension cache headers, and a 301 to `https`.

The full CDK stack — bucket policy, CloudFront behaviors, OAC, custom domain, ACM certificate — is in `../../aws-cdk-patterns/references/03-static-site.md`. Cross-reference it instead of duplicating the CDK here.

The CI hand-off looks like:

```bash
# In your deploy job after `npx expo export --platform web`
aws s3 sync dist/ s3://acmeshop-web-${ENVIRONMENT}/ --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" --exclude "manifest.json"

aws s3 cp dist/index.html s3://acmeshop-web-${ENVIRONMENT}/index.html \
  --cache-control "public, max-age=0, must-revalidate" \
  --content-type "text/html"

aws s3 cp dist/manifest.json s3://acmeshop-web-${ENVIRONMENT}/manifest.json \
  --cache-control "public, max-age=0, must-revalidate" \
  --content-type "application/manifest+json"

aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*"
```

Hashed assets get a year; HTML and the manifest get zero; CloudFront gets a fresh invalidation. The `aws-cdk-patterns` reference wires these as a CDK output that CI can read.

---

## Section 9: Gotchas (web-specific)

Full catalogue in `./10-gotchas.md`. The five below are web-specific and account for most of the "works on mobile, broken on web" bug reports.

| Symptom | Root cause | Fix |
|---|---|---|
| NativeWind classes apply on iOS and Android; the web build has unstyled elements. Tailwind JIT did not emit the utility class. | `tailwind.config.js` `content` glob is missing the directory that uses the class. NativeWind's native runtime computes styles at render time regardless of the glob; web relies on the Tailwind-generated CSS, which only includes classes the glob saw. | Update the glob to cover every directory with `className` usage. Rerun `npx expo export --platform web`. Confirm with the `grep 'bg-brand-500' dist/` smoke from §6. |
| Web bundle crashes at load with `undefined is not a function` or `Cannot read properties of undefined` from a module import. The same code runs on mobile. | A native-only module (e.g., `expo-local-authentication`, `react-native-purchases`, anything pulling `react-native/Libraries/NativeModules`) was imported at module scope and doesn't polyfill on web. Metro ships the import in the web bundle; the module's web build is either empty or throws. | Move the import behind a `.native.ts` vs `.web.ts` capability hook (pattern in §3). Never import native-only modules at the top of a universal file. |
| `expo-image` renders placeholder only on web; images load fine on mobile. | `expo-image`'s web implementation requires `react-native-web` CSS reset and fails silently if the image URL's CORS headers block the canvas element it uses internally. | Verify the image CDN returns `Access-Control-Allow-Origin: *` (or the specific origin). For S3 images, set the bucket CORS policy. If you can't fix CORS, fall back to `<Image>` from `react-native` on web — it is less feature-rich but tolerant of restrictive CORS. |
| Flex layouts look different on web and mobile — children stacking vertically on web, horizontally on mobile, or vice versa. | React Native's default `flexDirection` is `column`; the web's default is `row`. `react-native-web` reconciles this, but a component that sets `flexDirection` conditionally (or omits it) hits a default mismatch in edge cases. | Always set `flexDirection` explicitly when the layout depends on it. Do not rely on platform defaults. Lint rule: forbid `View` with `flex: 1` + children unless `flexDirection` is set. |
| OAuth redirect comes back to the app on mobile but to a blank white page on web. `expo-auth-session`'s proxy is involved. | The proxy URL (`auth.expo.io/...`) is native-only. On web, the redirect must go back to the app's own origin (`https://shop.acmeshop.example/auth/callback`), and the Cognito app client must have that URL registered as an allowed callback. | Use the `.web.tsx` sign-in pattern in §3 (plain `window.location.href` redirect). Add the web origin's `/auth/callback` to the Cognito app client allow-list. Do not use the native-proxy `expo-auth-session` path on web. |

---

## Section 10: Verification

Run these after every web-impacting change.

```bash
# 1. Static export. The only gate that catches "this doesn't build for web at all."
npx expo export --platform web

# 2. Bundle-size smoke. If this number jumped 3x without a reason, a heavy native
#    module leaked into the web bundle. 4-5 MB is normal; 15 MB is not.
du -sh dist/
# Per-chunk breakdown:
find dist -name '*.js' -exec du -h {} + | sort -rh | head

# 3. Manifest check. Lighthouse will complain if the content-type is wrong on the
#    deployed artifact; this verifies the file is present and parseable.
cat dist/manifest.json | jq .

# 4. Serve the dist folder locally and open it. Confirm the catalog loads, a
#    product detail page loads, and a route deep-link (paste a URL into a fresh
#    tab) works — SPA fallback is the #1 deploy bug.
npx serve dist -p 4173 --single
open http://localhost:4173
open http://localhost:4173/orders/test-order-id  # SPA fallback check

# 5. Lighthouse PWA score. Chrome DevTools > Lighthouse > PWA + Performance.
#    Aim for PWA score of 90+, with the maskable-icon caveat from §7.
```

For CI, run #1 and #2 on every PR. A bundle-size ratchet (`dist/` must not grow by more than X% vs main) catches native-module leaks the day they happen, not three releases later.

For a manual smoke before production deploy: #4 on your machine, then in the staging environment, then Lighthouse (#5).

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — Project layout, `app.config.ts`, EAS profiles the web build inherits from.
  - `./01-navigation.md` — expo-router route tree, deep linking, typed routes. Web uses the same tree with the `.web.tsx` split.
  - `./03-auth-and-networking.md` — `apiClient`, `tokenStore`, the `expo-auth-session` native flow the web target splits from.
  - `./10-gotchas.md` — Full diagnostic catalogue; §9 above is a curated web-specific slice.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/03-static-site.md` — S3 + CloudFront stack for hosting `dist/`; SPA-fallback config, cache headers, OAC, custom domain, ACM certificate.
  - `../../aws-cdk-patterns/references/02-auth-stack.md` — Cognito app-client configuration that must include the web origin's `/auth/callback` URL (Section 9 gotcha 5).
- **External documentation:**
  - [Expo — `expo export`](https://docs.expo.dev/more/expo-cli/#exporting) — Full flag reference; `--platform web`, `--output-dir`, `--source-maps`.
  - [Expo — Publishing websites](https://docs.expo.dev/guides/publishing-websites/) — Output folder shape, static-hosting expectations, service worker guidance.
  - [Expo — Platform-specific modules](https://docs.expo.dev/router/advanced/platform-specific-modules/) — `.web.tsx` vs `.tsx` rules, expo-router specifics, resolver chain.
  - [NativeWind — Installation with Expo](https://www.nativewind.dev/docs/getting-started/installation) — Canonical `tailwind.config.js`, `metro.config.js`, `babel.config.js` setup.
  - [NativeWind — Metro + `withNativeWind`](https://www.nativewind.dev/docs/api/with-nativewind) — Transformer configuration, CSS-input semantics.
  - [Tailwind CSS — Content configuration](https://tailwindcss.com/docs/content-configuration) — Why the content glob matters; why classes go missing without it.
  - [Web App Manifest (MDN)](https://developer.mozilla.org/en-US/docs/Web/Manifest) — Full `manifest.json` schema, `purpose: maskable` icon semantics.
  - [Lighthouse — PWA audits](https://developer.chrome.com/docs/lighthouse/pwa/) — The specific checks Lighthouse runs against a static PWA export.
</content>
</invoke>