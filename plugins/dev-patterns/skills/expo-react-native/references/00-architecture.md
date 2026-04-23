# Architecture

**Builds:** A complete Expo mobile-app project layout — feature-folder DDD structure, `app.config.ts` authoring, config plugins, environment/secrets separation, and EAS build profiles. This file is the foundation that every subsequent reference extends.
**When to use:** Starting a new Expo / React Native project, or restructuring an existing app that outgrew a flat `src/` folder. Read it in full before touching `01-navigation.md` or later references.
**Prerequisites:** None. This is the backbone of the skill. For the AWS backend the worked-example app consumes, see `../../aws-cdk-patterns/references/00-architecture.md` and `../../dynamodb-design/references/00-methodology.md`.

> Examples verified against Expo SDK 54 on 2026-04-23. Re-verify via context7 before porting to a newer SDK.

## Contents

1. **Workflow choice** — Managed + dev client vs bare; when each is right; the default this skill assumes.
2. **Scaffold** — `create-expo-app` with the TypeScript template, then prune/extend to a feature-folder DDD layout. Target tree documented here.
3. **Config plugins** — What they are, `app.config.ts` authoring, the `prebuild` lifecycle, idempotency requirements, and the `--clean` rule.
4. **Environment and secrets** — `process.env.EXPO_PUBLIC_*` for client-safe values, EAS secrets / EAS environment variables for build-time values, `.env` loading in `app.config.ts`, what never to commit.
5. **EAS profiles** — `development` / `preview` / `production` conventions, channel + distribution config, per-profile bundle identifiers.
6. **Worked example — the e-commerce mobile client** — What we build across the skill; which sibling skill's backend it consumes; how later references extend it.
7. **Gotchas (architecture slice)** — Config plugin changes not re-run after `--clean`, committed `.env` files, `EXPO_PUBLIC_*` undefined at runtime.
8. **Verification** — `npx expo-doctor`, `eas build:configure`, `npx expo prebuild --platform ios --clean`.
9. **Further reading** — Pointers into the rest of this skill and the two sibling skills.

---

## Section 1: Workflow choice

Expo ships two workflows. Pick one per project; mixing them is painful.

### Managed workflow + dev client (this skill's default)

You write only JavaScript / TypeScript. Native code is generated on demand by `npx expo prebuild` and compiled by EAS Build. A **development client** (`expo-dev-client`) is a custom build of your app that includes:

- Every native module declared in `package.json` (including third-party modules that Expo Go does not ship).
- The developer launcher UI that connects to a local Metro bundler.

You install the dev client on a simulator or a real device once per native-dependency change. Day-to-day iteration is the same as Expo Go — save a file, Metro reloads, you see the change in under a second. You only rebuild the dev client when you add or remove a native module or change a config plugin.

**When managed + dev client is right** (almost always):

- You want fast JS iteration without maintaining `android/` and `ios/` directories.
- You depend on native modules that are not in Expo Go (Sentry, RevenueCat, a custom push provider, ML kit, etc.) — so Expo Go alone is insufficient, but you do not want to leave the managed workflow.
- You ship to both iOS and Android and want EAS Build to handle credentials, provisioning profiles, and Play Store signing.

### Bare workflow

You own full `android/` and `ios/` directories, just like a raw React Native project scaffolded directly with the React Native community CLI. You get maximum native flexibility at the cost of maintaining native build files through SDK upgrades and third-party library updates.

**When bare is right** (rare):

- You have a deeply custom native implementation (a custom C++ audio engine, an OEM-specific SDK, a fork of a native library you maintain).
- You have an existing brownfield native app and are embedding React Native as a view.

**This skill excludes bare workflow.** All examples assume managed + dev client. If you need bare, the Expo documentation's bare workflow guide is authoritative — but most of what this skill teaches (feature-folder layout, EAS profiles, environment handling, navigation patterns) still applies.

### Default for this skill

Managed workflow with `expo-dev-client` installed. Every code example assumes this. Every `eas.json` profile assumes this.

---

## Section 2: Scaffold

### Create the project

```bash
npx create-expo-app@latest mobile --template blank-typescript
cd mobile
npx expo install expo-dev-client expo-router react-native-screens react-native-safe-area-context
```

`create-expo-app@latest` uses the SDK 54 default template, which ships with TypeScript, the `app/` directory for expo-router, and a `tsconfig.json` extending `expo/tsconfig.base`. The `expo install` call pins each package to a version compatible with the installed SDK — use it instead of `npm install` for any package the Expo team maintains a compatibility matrix for.

### Target directory tree

The default template uses a flat structure. Prune it and extend to the feature-folder layout below. This layout mirrors the DDD module structure used in `../../aws-cdk-patterns/references/00-architecture.md` §3 — one folder per bounded context, with domain logic isolated from framework code.

```
mobile/
├── app/                              # expo-router file-based routes (URL surface only)
│   ├── _layout.tsx                   # Root Stack + providers (QueryClient, i18n, theme)
│   ├── index.tsx                     # Route "/" → re-exports CatalogScreen
│   ├── (auth)/                       # Route group — no URL segment; shared layout for auth
│   │   ├── _layout.tsx
│   │   └── sign-in.tsx               # "/sign-in"
│   ├── (shop)/                       # Route group — authenticated shopping routes
│   │   ├── _layout.tsx
│   │   ├── cart.tsx                  # "/cart"
│   │   ├── checkout.tsx              # "/checkout"
│   │   └── orders/
│   │       ├── index.tsx             # "/orders"
│   │       └── [orderId].tsx         # "/orders/:orderId"
│   └── +not-found.tsx
├── src/
│   ├── features/                     # One folder per bounded context
│   │   ├── catalog/
│   │   │   ├── screens/              # Presentational screens imported by app/
│   │   │   │   └── catalog.screen.tsx
│   │   │   ├── components/           # Feature-local components (no cross-feature imports)
│   │   │   │   ├── product-card.tsx
│   │   │   │   └── product-list.tsx
│   │   │   ├── services/             # Domain logic (pure TS; no React, no fetch directly)
│   │   │   │   └── catalog.service.ts
│   │   │   ├── hooks/                # Feature-specific hooks (useCatalog, useProduct)
│   │   │   │   └── use-catalog.ts
│   │   │   └── types.ts              # Zod schemas + exported types for the feature
│   │   ├── cart/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── hooks/
│   │   │   ├── store.ts              # Zustand slice (client state)
│   │   │   └── types.ts
│   │   ├── checkout/
│   │   │   └── ...
│   │   ├── orders/
│   │   │   └── ...
│   │   └── auth/
│   │       └── ...
│   ├── shared/                       # Cross-feature primitives (kept small and boring)
│   │   ├── api/                      # API client, error classes, SigV4/Bearer helpers
│   │   │   └── client.ts
│   │   ├── ui/                       # Design-system components (Button, Text, Screen)
│   │   ├── hooks/                    # Cross-cutting hooks (useDebounce, useAppState)
│   │   ├── i18n/                     # i18next setup, shared strings
│   │   ├── config/                   # Runtime config loader (reads from Constants.expoConfig)
│   │   │   └── runtime-config.ts
│   │   └── types/                    # Shared-kernel types (Money, UserId, ISO timestamps)
│   └── test-utils/                   # Render helpers, MSW handlers, fixtures
├── plugins/                          # Custom config plugins (one file per plugin)
│   └── with-app-tracking-transparency.ts
├── assets/                           # Fonts, images, app icon, splash
├── app.config.ts                     # Dynamic Expo config (replaces app.json)
├── eas.json                          # EAS Build + Submit profiles
├── package.json
├── tsconfig.json                     # strict: true, paths alias "@/*" → "src/*"
└── .env.example                      # Committed — template only, never real values
```

**Non-negotiable rules for this layout:**

- A feature never imports from another feature's `screens/`, `components/`, or `hooks/`. Cross-feature sharing goes through `src/shared/` or through explicit cross-feature hooks exposed from a feature's `index.ts`.
- The `app/` directory contains **only** route files that re-export screens from `src/features/<feature>/screens/`. No business logic, no hooks, no data fetching. This keeps the URL surface decoupled from the feature implementation — renaming a screen file does not break any routes, and `expo-router`'s typed-routes generator sees only the URL shape.
- Services are pure TypeScript. They do not import from `react`, `react-native`, or `expo-*` runtime modules. They receive their dependencies (API client, storage, clock) via parameters or constructor injection.
- Zod schemas for a feature live in that feature's `types.ts`. Export both the schema and the inferred TypeScript type. Never hand-write a type that duplicates a schema — use `z.infer<typeof Schema>`.

### `tsconfig.json`

Enforce strictness from day one. Retrofitting `strict: true` into a large codebase is painful.

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

Every example in this skill assumes `strict: true`. No `any`. No `// @ts-ignore`. Error handling is explicit.

---

## Section 3: Config plugins

### What they are

A config plugin is a TypeScript or JavaScript function that mutates the Expo config object during `npx expo prebuild`. It is the managed-workflow escape hatch for modifying native iOS / Android files — `Info.plist`, `AndroidManifest.xml`, `Podfile`, Gradle build files — without leaving the managed workflow.

Plugins fall into three tiers:

- **First-party** — shipped by Expo packages. You opt in by listing the package name in `plugins`. Example: `expo-router`, `expo-notifications`, `expo-build-properties`.
- **Third-party** — shipped by community packages. Same opt-in mechanism. Example: `@sentry/react-native/expo`, `react-native-reanimated/plugin`.
- **Custom** — written by you, under `plugins/`, for app-specific native tweaks (adding a custom `Info.plist` entry, registering an intent filter, injecting a Gradle dependency).

### `app.config.ts` authoring

Use the TypeScript variant (`app.config.ts`), not `app.json` or `app.config.js`. TypeScript gives you autocomplete on the `ExpoConfig` shape, catches typos at compile time, and lets you import typed config plugins written in TypeScript.

```typescript
// app.config.ts
import "tsx/cjs"; // required to load TypeScript config plugins at prebuild time
import type { ConfigContext, ExpoConfig } from "expo/config";
import * as dotenv from "dotenv";

// Load environment variables from .env.<profile> into process.env before the
// export runs. EAS Build injects `EAS_BUILD_PROFILE`; local commands inherit
// whatever the shell has. Never commit these files — see Section 4.
const profile = process.env.EAS_BUILD_PROFILE ?? process.env.APP_VARIANT ?? "development";
dotenv.config({ path: `.env.${profile}` });

type AppVariant = "development" | "preview" | "production";

const appVariant = (process.env.APP_VARIANT ?? "development") as AppVariant;

const getBundleIdentifier = (variant: AppVariant): string => {
  switch (variant) {
    case "production":
      return "com.acme.shop";
    case "preview":
      return "com.acme.shop.preview";
    case "development":
      return "com.acme.shop.dev";
  }
};

const getAppName = (variant: AppVariant): string => {
  switch (variant) {
    case "production":
      return "Acme Shop";
    case "preview":
      return "Acme Shop (Preview)";
    case "development":
      return "Acme Shop (Dev)";
  }
};

// `EXPO_PUBLIC_*` values are inlined into the JS bundle by Metro. Everything
// else in `extra` travels via expo-updates manifest and is available at runtime
// through `expo-constants`.
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable '${name}' for profile '${appVariant}'. ` +
        `Check .env.${profile} locally, or EAS environment variables for builds.`,
    );
  }
  return value;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: getAppName(appVariant),
  slug: "acme-shop",
  scheme: "acmeshop",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true, // Default in SDK 55+; explicit here for clarity
  ios: {
    bundleIdentifier: getBundleIdentifier(appVariant),
    supportsTablet: true,
    buildNumber: "1",
  },
  android: {
    package: getBundleIdentifier(appVariant),
    versionCode: 1,
  },
  web: {
    bundler: "metro",
    output: "static",
  },
  plugins: [
    "expo-router",
    "expo-dev-client",
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "15.1" },
        android: { compileSdkVersion: 34, targetSdkVersion: 34 },
      },
    ],
    ["./plugins/with-app-tracking-transparency.ts", { description: requireEnv("ATT_PROMPT") }],
  ],
  extra: {
    appVariant,
    apiBaseUrl: requireEnv("EXPO_PUBLIC_API_BASE_URL"),
    sentryDsn: process.env.SENTRY_DSN ?? null, // Never EXPO_PUBLIC_; loaded at runtime from Constants
    eas: {
      projectId: requireEnv("EAS_PROJECT_ID"),
    },
  },
  updates: {
    url: `https://u.expo.dev/${requireEnv("EAS_PROJECT_ID")}`,
    fallbackToCacheTimeout: 0, // ms; let the OTA check run and time out at the default 5000 ms
  },
  runtimeVersion: { policy: "appVersion" },
});
```

### A minimal custom config plugin

Custom plugins live under `plugins/`. The example below adds a `NSUserTrackingUsageDescription` entry to `Info.plist` — the string shown when iOS asks the user for App Tracking Transparency consent. The plugin receives typed props from `app.config.ts` (`{ description }`) and writes them into the generated `Info.plist`.

```typescript
// plugins/with-app-tracking-transparency.ts
import { withInfoPlist, type ConfigPlugin } from "expo/config-plugins";

interface Props {
  description: string;
}

const withAppTrackingTransparency: ConfigPlugin<Props> = (config, { description }) => {
  return withInfoPlist(config, (plistConfig) => {
    // Idempotency: overwriting is fine here because the key is either absent
    // or contains a value we already wrote. For plugins that *append* to
    // arrays, always check for the existing entry before pushing.
    plistConfig.modResults.NSUserTrackingUsageDescription = description;
    return plistConfig;
  });
};

export default withAppTrackingTransparency;
```

### The `prebuild` lifecycle

1. `npx expo prebuild` reads `app.config.ts`.
2. Each entry in `plugins` is evaluated in order. The config object threads through every plugin — plugin `n+1` sees the mutations from plugin `n`.
3. For every platform (`ios`, `android`), the generated native project is written to `ios/` and `android/` directories.
4. `--clean` deletes `ios/` and `android/` before running the plugins. Use it when a plugin changes or when a generated native file drifts from what the plugins describe.
5. Without `--clean`, plugins mutate the existing native project. This is why **plugins must be idempotent**: running the plugin twice against a project that already has the mutation should be a no-op. A plugin that appends a `pod` line without checking for the existing entry corrupts the Podfile on the second run.

### Idempotency rules

- **Writes that overwrite by key** (dictionary / plist entries, env keys, `ADD` operations on a map): idempotent by construction; safe to run repeatedly.
- **Writes that append to lists** (Podfile entries, Gradle dependencies, AndroidManifest intent filters): must check for the existing entry first. See the `withDangerousMod` Podfile example in the Expo docs — it uses `contents.includes("pod 'Alamofire'")` to guard the insertion.
- **Writes that wrap native code** (adding a Swift extension, patching a generated file): consider whether `withDangerousMod` is really the right tool; prefer first-party modifiers whenever one exists.

When in doubt, run `npx expo prebuild --clean` and inspect the diff against the previous generated project.

---

## Section 4: Environment and secrets

Three buckets of values, three different mechanisms. Mixing them is the #1 runtime bug in Expo projects.

### Bucket A — Client-safe values: `EXPO_PUBLIC_*`

Inlined into the JS bundle by Metro at build time. Visible to anyone who unzips the shipped app. Use for values that are safe to ship publicly: API base URLs, Cognito user pool IDs, Cognito app client IDs, feature flags, public analytics keys.

```bash
# .env.development
EXPO_PUBLIC_API_BASE_URL=https://dev-api.acme.example/v1
EXPO_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_devPool
EXPO_PUBLIC_COGNITO_CLIENT_ID=a1b2c3d4e5
```

Read from code with `process.env.EXPO_PUBLIC_*`:

```typescript
// src/shared/config/runtime-config.ts
const requirePublic = (name: `EXPO_PUBLIC_${string}`): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not defined. Check your .env file and rebuild.`);
  }
  return value;
};

export const runtimeConfig = {
  apiBaseUrl: requirePublic("EXPO_PUBLIC_API_BASE_URL"),
  cognitoUserPoolId: requirePublic("EXPO_PUBLIC_COGNITO_USER_POOL_ID"),
  cognitoClientId: requirePublic("EXPO_PUBLIC_COGNITO_CLIENT_ID"),
} as const;
```

The runtime check forces a clear error message when Metro was started without the env var set — more useful than a silent `undefined` deep inside an HTTP call.

### Bucket B — Build-time / private values: EAS environment variables and secrets

These are used by `app.config.ts` (at prebuild / build time) and are never inlined into the JS bundle. Use for: EAS project IDs, build-time API tokens (for example, a Sentry auth token used only by the bundler's source-map upload step), bundler options that depend on a private registry.

Stored and fetched via EAS:

```bash
# Store a build-time secret tied to the production environment
eas env:create --name SENTRY_AUTH_TOKEN --value <token> \
  --environment production --visibility secret

# Pull the current environment's variables into .env.local for local reproduction
eas env:pull --environment production
```

Reference from `app.config.ts`:

```typescript
// app.config.ts snippet
hooks: {
  postPublish: [
    {
      file: "sentry-expo/upload-sourcemaps",
      config: {
        authToken: process.env.SENTRY_AUTH_TOKEN, // set by EAS at build time
      },
    },
  ],
},
```

A value referenced from `app.config.ts` **is not** automatically inlined into the bundle. It becomes part of the generated native project or build pipeline only. If you need the value at runtime, either:

- Use `EXPO_PUBLIC_*` (only for non-secret values), or
- Put it in `extra` and read it via `expo-constants` at runtime (safe when the value is non-secret; the updates manifest is publicly fetchable).

**Secrets never go to the client.** A Stripe secret key, an AWS long-lived access key, a database connection string, an OpenAI API key, a JWT-signing secret — these values must never be referenced from runtime code, and never from `EXPO_PUBLIC_*`. Put them on the backend (`aws-cdk-patterns/05-shared-utilities.md` §secrets-loading) and call an authenticated API from the mobile client.

### Bucket C — `.env` loading in `app.config.ts`

The `dotenv.config({ path: \`.env.${profile}\` })` call at the top of `app.config.ts` loads profile-specific values at prebuild time. Conventions:

- `.env.example` — committed. Lists every variable the project uses, with placeholder values. New contributors copy it to `.env.development`.
- `.env.development`, `.env.preview`, `.env.production` — **never committed**. Add them to `.gitignore`.
- `.env.local` — **never committed**. Overrides everything; generated by `eas env:pull` when you want to match a remote environment locally.

### `.gitignore` entries

```gitignore
# Environment files — all variants, all profiles
.env
.env.*
!.env.example

# Generated native projects (managed workflow regenerates with `npx expo prebuild`)
/ios
/android
```

Committing `.env` or `.env.production` is the most common secret-leak path in Expo repositories. The second-most-common is committing `ios/` or `android/` — they are checked back in on the next prebuild, but in the meantime generated file changes mask the intended native project shape.

---

## Section 5: EAS profiles

`eas.json` defines one profile per environment. Each profile controls:

- **Distribution** — `internal` (install on team devices via a link) or `store` (production App Store / Play Store artifacts).
- **Channel** — which OTA-update channel the installed build listens to for updates.
- **Environment variables** — which EAS environment (`development`, `preview`, `production`) sources variables, plus per-profile literal overrides.
- **Build configuration** — Xcode scheme, Android build type, simulator vs device, resource class.

### Minimal three-profile `eas.json`

```json
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "environment": "development",
      "env": {
        "APP_VARIANT": "development"
      },
      "ios": {
        "simulator": true,
        "resourceClass": "m-medium"
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleDebug"
      }
    },
    "preview": {
      "extends": "development",
      "developmentClient": false,
      "distribution": "internal",
      "channel": "preview",
      "environment": "preview",
      "env": {
        "APP_VARIANT": "preview"
      },
      "ios": {
        "simulator": false
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      }
    },
    "production": {
      "autoIncrement": true,
      "channel": "production",
      "environment": "production",
      "distribution": "store",
      "env": {
        "APP_VARIANT": "production"
      },
      "ios": {
        "resourceClass": "m-medium"
      },
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "1234567890",
        "appleTeamId": "ABCDE12345"
      },
      "android": {
        "serviceAccountKeyPath": "./secrets/play-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

### Profile conventions

- **`development`** — Debug-build iOS simulator binary or an Android APK. Has the dev client launcher. Points at the dev backend. Installed on team devices via `eas build --profile development` then scanned-from-the-dashboard QR code.
- **`preview`** — Release-mode build, internal distribution, no dev client. Same code path as production but signed for internal installs. Used for QA, stakeholder demos, and reproducing production-only bugs against a staging backend.
- **`production`** — Store-ready artifact. Signed with production credentials. Auto-increments build number (`autoIncrement: true`). Submitted via `eas submit --profile production`.

### Per-profile bundle identifiers

The `APP_VARIANT` env var set per profile is read by `app.config.ts` (Section 3) to pick `com.acme.shop.dev`, `com.acme.shop.preview`, or `com.acme.shop`. **All three apps can be installed side-by-side on a single device** — different bundle IDs produce different iOS app icons and different Android launcher entries. This is essential for testing: a QA engineer can have the dev, preview, and production versions installed simultaneously without one overwriting another.

### Channels vs branches vs runtime versions

- **Channel** (`channel: "production"`) — The label built binaries subscribe to for OTA updates. Set once at build time; baked into the binary.
- **Branch** — The update label you publish with `eas update --branch production`. Channels point at branches; the mapping is managed in the EAS dashboard (or via `eas channel:edit`).
- **Runtime version** (`runtimeVersion` in `app.config.ts`) — A hash-like identifier that guarantees an OTA update is only delivered to binaries with the same native layer. `policy: "appVersion"` ties the runtime version to `version` so any `version` bump automatically invalidates old OTA targets — safer than manual hashes for most projects, but costs you one full store submission whenever you need to bump native code. See `04-native-and-release.md` §OTA-updates for the full decision tree.

---

## Section 6: Worked example — the e-commerce mobile client

Every subsequent reference extends the same application: **Acme Shop**, a small e-commerce mobile client.

### Scope

- **Catalog browse** (`01-navigation.md`, `02-state-and-data.md`) — Product grid, product detail, infinite scroll, search, category filter.
- **Cart** (`02-state-and-data.md`) — Add / remove / update quantity. Persisted locally via AsyncStorage. Synced to the backend on sign-in.
- **Checkout** (`03-auth-and-networking.md`, `09-monetization.md`) — Address entry, payment method (Apple Pay / Google Pay via RevenueCat for subscriptions, Stripe via a web-view fallback for one-shot purchases), order submission with optimistic locking against the backend.
- **Order history** (`01-navigation.md`, `06-performance-and-testing.md`) — List past orders, view details, download receipts, reorder.
- **Account** (`03-auth-and-networking.md`, `08-observability.md`) — Cognito sign-in with Google federation, profile edit, sign-out, linked devices.

### Backend contract

Acme Shop consumes a backend provisioned with the sibling skill `aws-cdk-patterns` and modeled with `dynamodb-design`:

- Authentication via Cognito user pool + Google federated identity. See `../../aws-cdk-patterns/references/02-auth-stack.md` for the server side; `03-auth-and-networking.md` in this skill for the mobile side.
- REST API fronted by API Gateway + Cognito authorizer. See `../../aws-cdk-patterns/references/01-serverless-api.md`.
- DynamoDB tables for users, orders, cart snapshots, catalog. Design documented in `../../dynamodb-design/references/00-methodology.md` §worked-example.
- Optimistic-locking contract for edits (cart updates, address changes). When the server rejects with a conflict, the mobile client follows the retry policy in `../../dynamodb-design/references/03-write-correctness.md` §optimistic-locking.

### How references compose

- `01-navigation.md` — Defines the route tree for Acme Shop: the `(auth)` and `(shop)` route groups, deep links (`acmeshop://orders/:orderId`), universal links for email receipts.
- `02-state-and-data.md` — Zustand store for the cart; TanStack Query for the catalog; offline sync for the cart queue.
- `03-auth-and-networking.md` — `expo-auth-session` against Cognito; API client with Bearer-token injection; refresh-on-401 flow; retry-on-5xx.
- `04-native-and-release.md` — Push notifications for order status; OTA updates per channel; EAS Build artifacts; IAP registration.
- `05-cross-platform-web.md` — Same codebase shipped as a PWA; SSR for the catalog pages; platform-specific sign-in branches.
- `06-performance-and-testing.md` — FlashList for the catalog; Reanimated for the cart drawer; unit + integration + Maestro end-to-end tests.
- `07-i18n-and-accessibility.md` — i18next + RTL; accessibility sweep for every screen.
- `08-observability.md` — Sentry wiring; analytics events; crash triage.
- `09-monetization.md` — RevenueCat for subscriptions (if Acme Shop adds a Premium tier); one-shot purchases via Stripe web view.
- `10-gotchas.md` — Everything that burned us while building this.

The application is the thread. Every code example either extends Acme Shop or uses the same contract shapes.

---

## Section 7: Gotchas (architecture slice)

Full catalogue in `10-gotchas.md`. The three below are architecture-specific and the most common source of a broken first-time build.

| Symptom | Root cause | Fix |
|---|---|---|
| `Info.plist` / `AndroidManifest.xml` missing the entry a plugin should have added; config plugin reads the old props; a recent `app.config.ts` edit has no effect. | `npx expo prebuild` was run without `--clean` after changing a plugin. Plugins mutate existing generated native projects, but some mutations (removals, reordering, conditional branches that now take a different path) do not roll back cleanly on the second run. | Delete `ios/` and `android/`, then run `npx expo prebuild --clean`. Alternatively, always run prebuild as part of EAS Build — the build servers always start from a clean state, so this class of drift does not appear in CI. |
| Repo contains `.env.production` (or `.env`) in `git log`. Commit history shows an API token, a Stripe key, or a signing secret. | `.gitignore` was not set up before first commit, or a profile-specific `.env.*` file was added outside the ignore pattern. | (1) Rotate every credential in the file immediately. (2) Remove from history with `git filter-repo` (do not stop at `git rm --cached` — the old commit still holds the value). (3) Harden `.gitignore` to `!` only `.env.example`. (4) Add a pre-commit hook or CI step that fails if `.env` or `.env.<profile>` appears in the staged diff. |
| Runtime crash: `Cannot read properties of undefined (reading 'split')` or a config-reading helper throws `EXPO_PUBLIC_API_BASE_URL is not defined` at cold start. | `EXPO_PUBLIC_*` variable was renamed or removed, the JS bundle was cached from a previous build, or Metro was started in a shell that did not have the `.env` variables loaded. Common on CI where the Metro process does not source the same `.env` the developer machine uses. | Restart Metro with `npx expo start --clear` so Metro re-reads the environment. In EAS Build, always set `APP_VARIANT` and the `EXPO_PUBLIC_*` variables on the profile (Section 5) — not just locally. The `requirePublic` helper from Section 4 turns a silent failure into a loud one. |

---

## Section 8: Verification

Run these after every architectural change. All three run in under a minute and catch 90% of structural issues before you hit a build.

```bash
# 1. Validate the project against Expo's built-in rules (compat matrix,
#    package.json shape, app config fields, React Native directory status).
npx expo-doctor

# 2. Re-verify eas.json against the installed EAS CLI schema. Run this after
#    every EAS CLI upgrade; the schema occasionally gains new required fields.
eas build:configure --non-interactive

# 3. Smoke-prebuild iOS to catch config-plugin errors without a full build.
#    --clean ensures we test the plugin chain from scratch.
npx expo prebuild --platform ios --clean
```

When `npx expo-doctor` reports a dependency incompatibility (a transitive package pinned to an older React Native), fix it by upgrading the offending package with `npx expo install <pkg>@latest` before proceeding. A dirty doctor report will cascade into build failures that are substantially harder to debug.

---

## Further reading

- **Inside this skill:**
  - `01-navigation.md` — expo-router routes, deep links, typed routes, navigation patterns for the Acme Shop tree above.
  - `04-native-and-release.md` — EAS Build / Submit / Update in depth; OTA-update rollout strategies; IAP registration.
  - `10-gotchas.md` — Full diagnostic catalogue; symptoms indexed by error message.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/00-architecture.md` — Backend architecture the mobile client consumes.
  - `../../aws-cdk-patterns/references/02-auth-stack.md` — Cognito user pool + Google federation (matches what `03-auth-and-networking.md` in this skill consumes from the client side).
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — API Gateway shape the mobile HTTP client targets.
  - `../../dynamodb-design/references/00-methodology.md` — Backend data model; the mobile catalog/cart/order screens mirror the access patterns documented there.
  - `../../dynamodb-design/references/03-write-correctness.md` — Optimistic locking and conditional-write semantics the mobile client must handle.
- **External documentation:**
  - [Expo SDK 54 release notes](https://expo.dev/changelog) — What changed since SDK 53.
  - [Expo config plugins reference](https://docs.expo.dev/config-plugins/plugins/) — First-party plugin catalogue and custom-plugin API.
  - [EAS Build configuration (`eas.json`) reference](https://docs.expo.dev/build/eas-json/) — Full schema, field-by-field.
  - [Expo environment variables](https://docs.expo.dev/guides/environment-variables/) — `EXPO_PUBLIC_*`, dotenv loading, EAS secrets.
