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
