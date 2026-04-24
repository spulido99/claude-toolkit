# Internationalization and accessibility

**Builds:** The i18n and a11y spine for Acme Shop — `expo-localization` 55 for device-locale detection and RTL bootstrap, `i18next` 26 + `react-i18next` 17 for string tables with namespace-per-feature, `i18next-icu` 2.4 for ICU MessageFormat (pluralization, gender), `i18next-parser` 9 for extraction, MMKV for caching the user's explicit language choice, React Native's built-in `AccessibilityInfo` / `accessibilityRole` / `accessibilityState` / `accessibilityLiveRegion` props for screen-reader exposure, `eslint-plugin-react-native-a11y` 3.5 as the CI gate against a11y regressions, and a manual VoiceOver + TalkBack pass on every release candidate.
**When to use:** Adding a new locale to Acme Shop (the product went from EN-only to EN + ES + AR this quarter; this doc is the playbook), fixing "the translation key shows instead of the string" bugs that show up after a merge, shipping an Arabic build and discovering the cart flyout stays left-anchored, responding to an App Store rejection for missing VoiceOver labels on the checkout button, or writing the per-locale snapshot test that catches price-formatting regressions. Read §3 before touching any user-facing string; §6 before the first RTL build; §7 before any Pressable that is not a stock `Button`; §9 before release candidate testing.
**Prerequisites:** `./00-architecture.md` (project layout — locales live under `features/*/locales/<lng>.json`), `./02-state-and-data.md` §6 (MMKV — the cached language choice is stored in the `user-prefs` MMKV instance), `./06-performance-and-testing.md` §7 (RNTL — the a11y test suite is an extension of the existing component-test harness). Required packages: `expo-localization@~55`, `i18next@^26`, `react-i18next@^17`, `i18next-icu@^2`, `intl-pluralrules` (Hermes polyfill), `eslint-plugin-react-native-a11y@^3.5`.

> Examples verified against Expo SDK 54 + `expo-localization` 55.0.13 + `i18next` 26.0.7 + `react-i18next` 17.0.4 + `i18next-icu` 2.4.3 + `i18next-parser` 9.4.0 + `eslint-plugin-react-native-a11y` 3.5.1 on 2026-04-23. Re-verify via context7 before porting to a newer SDK — `expo-localization` replaced the deprecated scalar `locale`/`region` exports with the `getLocales()` / `getCalendars()` array-returning accessors in SDK 49, and `i18next` v26 split `intl-pluralrules` out into a peer dep you must add manually on Hermes.

## Contents

1. **i18n setup** — The three packages, why each one; the `i18n.ts` init module; namespace-per-feature convention (`features/checkout/locales/en.json`); the `i18next-parser` extraction workflow; the MMKV-cached language choice vs `expo-localization` device default.
2. **Pluralization and interpolation** — ICU MessageFormat via `i18next-icu`; why `_one`/`_other` suffixes are a trap in non-English plurals; gender/context via the `context` option; the "never concatenate strings" rule.
3. **Date / number formatting** — `Intl.DateTimeFormat` / `Intl.NumberFormat` via Hermes (works out of the box with the `intl` polyfill shipped by Hermes); relative time via `date-fns` (bundle-size-conscious alternative to `Intl.RelativeTimeFormat`); currency formatting per locale for the product grid and cart.
4. **RTL handling** — `I18nManager.forceRTL`, the app-reload requirement, `flexDirection` patterns, the `start`/`end` style shorthands, icon-mirroring decision tree (directional mirrors; symbolic does not), the "first install sees LTR" iOS gotcha.
5. **Accessibility APIs** — `accessibilityLabel`, `accessibilityHint`, `accessibilityRole`, `accessibilityState`, `accessibilityLiveRegion` (Android) + `AccessibilityInfo.announceForAccessibility` (iOS), `accessible={true}` for grouping, `importantForAccessibility` on Android.
6. **Focus order** — The logical-reading-order rule; focus-trap in modals via `accessibilityViewIsModal`; `AccessibilityInfo.setAccessibilityFocus`; the screen-transition focus reset; a checklist.
7. **Testing with VoiceOver and TalkBack** — How to enable each; the six gestures you actually use; what to listen for; the common failure patterns (custom buttons unannounced, form fields without labels, decorative icons read aloud).
8. **Automated a11y checks** — The `eslint-plugin-react-native-a11y` ruleset, the minimum-viable CI config, and the hard limit of static analysis.
9. **Gotchas (i18n/a11y-specific)** — Missing keys after a feature merge (extraction bypass), iOS RTL cache requires reinstall, VoiceOver focus stuck on a hidden view, dynamic-font-size breaking checkout layout, Hermes `Intl.PluralRules` polyfill missing, the `_one` trap in Arabic (six plural forms).
10. **Verification** — Snapshot test per locale, a11y lint pass in CI, manual VoiceOver/TalkBack checklist, per-locale Maestro flow for the "add to cart in Arabic" smoke.
11. **Further reading** — Pointers into the rest of this skill and external canonical docs.

---

## Section 1: i18n setup

Three packages, each with one job:

- **`expo-localization`** — Reads the OS-level language and locale settings. Used exactly once at app start to pick the initial language when the user has not explicitly chosen one. Also exposes `isRTL` and calendar info.
- **`i18next`** — The runtime. Holds string tables, resolves keys, handles plurals and interpolation, fires `languageChanged` events.
- **`react-i18next`** — The React glue: `useTranslation()` hook, `Trans` component for mixed-markup translations, `I18nextProvider` for nested instance isolation (rarely needed).

Do not mix libraries. `lingui`, `formatjs`, and `polyglot` are all viable on their own, but the moment you mix two you get doubled bundle size, two extraction tools, and two plural-rule engines that disagree on Arabic.

### 1.1 The `i18n.ts` init module

```ts
// src/i18n/index.ts
import { getLocales } from "expo-localization";
import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import { MMKV } from "react-native-mmkv";
import "intl-pluralrules"; // Hermes polyfill for i18next v26+ plurals

import enCheckout from "@/features/checkout/locales/en.json";
import esCheckout from "@/features/checkout/locales/es.json";
import arCheckout from "@/features/checkout/locales/ar.json";
import enCatalog from "@/features/catalog/locales/en.json";
import esCatalog from "@/features/catalog/locales/es.json";
import arCatalog from "@/features/catalog/locales/ar.json";
import enCommon from "@/i18n/locales/en/common.json";
import esCommon from "@/i18n/locales/es/common.json";
import arCommon from "@/i18n/locales/ar/common.json";

export const SUPPORTED_LANGUAGES = ["en", "es", "ar"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_KEY = "user.language";
const userPrefs = new MMKV({ id: "user-prefs" });

function pickInitialLanguage(): SupportedLanguage {
  // 1. Explicit user choice wins.
  const saved = userPrefs.getString(LANGUAGE_KEY);
  if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
    return saved as SupportedLanguage;
  }
  // 2. Device preference list. Walk in order — an AR+EN user should get `ar`.
  for (const locale of getLocales()) {
    const code = locale.languageCode;
    if (code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code)) {
      return code as SupportedLanguage;
    }
  }
  return "en";
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: pickInitialLanguage(),
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: "common",
    ns: ["common", "catalog", "checkout"],
    resources: {
      en: { common: enCommon, catalog: enCatalog, checkout: enCheckout },
      es: { common: esCommon, catalog: esCatalog, checkout: esCheckout },
      ar: { common: arCommon, catalog: arCatalog, checkout: arCheckout },
    },
    interpolation: { escapeValue: false }, // React escapes; double-escape mangles apostrophes.
    react: { useSuspense: false }, // resources are static imports; Suspense not needed.
    returnNull: false,
    returnEmptyString: false,
    saveMissing: __DEV__,
    missingKeyHandler: (lngs, ns, key) => {
      if (__DEV__) console.warn(`[i18n] missing: ${lngs.join(",")}/${ns}/${key}`);
    },
  });

export async function changeLanguage(lng: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lng);
  userPrefs.set(LANGUAGE_KEY, lng);
}

export default i18n;
```

Import this module once from the root layout so the side-effect `init()` runs before any `useTranslation()` call:

```tsx
// src/app/_layout.tsx
import "@/i18n"; // side-effect init. Must be the first app-owned import.
import { Stack } from "expo-router";

export default function RootLayout(): JSX.Element {
  return <Stack />;
}
```

### 1.2 Namespace-per-feature convention

One namespace per feature folder, one JSON file per language:

```
src/features/catalog/locales/{en,es,ar}.json        # namespace: "catalog"
src/features/checkout/locales/{en,es,ar}.json       # namespace: "checkout"
src/features/cart/locales/{en,es,ar}.json           # namespace: "cart"
src/i18n/locales/{en,es,ar}/common.json             # app-wide: Loading, Retry, Cancel
src/i18n/index.ts                                    # init module from §1.1
```

The rule: a string belongs in the namespace of the feature that owns the screen it renders on. "Add to cart" lives in `catalog` (or `cart` if the button is unique there) — pick one, do not duplicate. App-wide strings go in `common`.

Use a namespace in a component:

```tsx
const { t } = useTranslation("catalog");
t("title");                       // catalog.title

const { t } = useTranslation(["catalog", "common"]);
t("catalog:title");               // explicit
t("loading");                     // falls through to common (first is default)
```

### 1.3 Extraction workflow with `i18next-parser`

Maintaining `en.json` by hand is how keys go missing. `i18next-parser` scans the codebase for every `t("...")` call and updates the JSON files.

```js
// i18next-parser.config.js
module.exports = {
  locales: ["en", "es", "ar"],
  input: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
  output: "src/features/$NAMESPACE/locales/$LOCALE.json",
  defaultNamespace: "common",
  namespaceSeparator: ":",
  keySeparator: ".",
  keepRemoved: false,
  sort: false,
  pluralSeparator: "_",
  createOldCatalogs: false,
};
```

Scripts (`package.json`):

```json
{
  "scripts": {
    "i18n:extract": "i18next --config i18next-parser.config.js",
    "i18n:check": "i18next --config i18next-parser.config.js --fail-on-update"
  }
}
```

`extract` runs in the pre-commit hook; `check` runs in CI and fails if the committed JSON is out of date relative to `t()` calls. This is the #1 fix for the "translations missing after merge" bug. Without CI enforcement it rots.

---

## Section 2: Pluralization and interpolation

Every language pluralizes differently. English has two forms (1 item, N items). Spanish has two (1 ítem, N ítems). Arabic has **six** (zero, one, two, few, many, other). Russian has four. i18next implements the Unicode CLDR plural rules, which covers this correctly — your job is not to pre-compute which form to use, it is to provide all forms in the JSON and let the runtime pick.

### 2.1 ICU MessageFormat

`i18next-icu` adds ICU MessageFormat syntax on top of i18next's default `{{var}}` interpolation. ICU is the standard format for plurals and selects — same syntax as `formatjs`, Java, and `gettext`.

```bash
npx expo install i18next-icu intl-pluralrules
```

`intl-pluralrules` is the `Intl.PluralRules` polyfill for Hermes. Without it, `t("key", { count })` throws on Android in release builds. ~30 KB, non-optional.

Plural example (checkout line-item count):

```json
// en.json
{ "itemsInCart": "{count, plural, one {# item} other {# items}} in your cart" }

// ar.json — six forms, all required
{ "itemsInCart": "{count, plural, zero {لا توجد عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}} في سلتك" }
```

```tsx
t("itemsInCart", { count: cart.items.length });
```

**The `_one` / `_other` trap.** i18next's non-ICU shorthand uses JSON keys with `_one`, `_other`, `_zero` suffixes. This only handles English-style two-form plurals and silently breaks on Arabic (six), Russian (four), Polish (three). Use ICU MessageFormat — never the suffix shorthand — as soon as you have a non-English locale.

### 2.2 Gender and context

Use ICU `select` for gender / variant selection. Always include `other` as the default:

```json
{ "orderConfirmation": "{gender, select, male {Your order is on its way, Mr. {name}} female {Your order is on its way, Ms. {name}} other {Your order is on its way, {name}}}" }
```

### 2.3 Never concatenate strings

Every time you see this in a PR, reject it:

```tsx
// WRONG
<Text>{t("greeting")} {user.name}, {t("cartHas")} {count} {t("items")}</Text>
```

Reasons: (1) word order — `"Sie haben"` (DE) precedes the count, `"لديك"` (AR) follows and reads RTL; concatenation is LTR-English-biased. (2) gender agreement — `"1 artículo"` vs `"2 artículos"` needs plural-aware resolution the translator controls, not JS `+`. (3) translator context — `"has"` in isolation could be a verb or German "Has" (hare). They need the full sentence.

Correct form: one template per sentence.

```tsx
<Text>{t("cartSummary", { name: user.name, count })}</Text>
```

```json
{ "cartSummary": "Hello {name}, {count, plural, one {you have # item} other {you have # items}} in your cart" }
```

---

## Section 3: Date / number formatting

Hermes ships with `Intl.DateTimeFormat` and `Intl.NumberFormat` built in. You do not polyfill these. You do polyfill `Intl.PluralRules` (§2.1) and, if you use it, `Intl.RelativeTimeFormat`.

### 3.1 Currency, dates, and relative time

Prices come from the backend in minor units (cents). Format per user locale:

```ts
// src/i18n/format.ts
import { formatDistanceToNow } from "date-fns";
import { enUS, es, arSA } from "date-fns/locale";

const dateFnsLocale = { en: enUS, es, ar: arSA } as const;

export function formatCurrency(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

export function formatOrderDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" })
    .format(new Date(iso));
}

export function formatShippedAgo(iso: string, lng: "en" | "es" | "ar"): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: dateFnsLocale[lng] });
}
```

Examples:

- `formatCurrency(1299, "USD", "en-US")` → `"$12.99"`
- `formatCurrency(1299, "EUR", "es-ES")` → `"12,99 €"`
- `formatCurrency(4999, "SAR", "ar-SA")` → `"٤٩٫٩٩ ر.س.‏"` (Arabic digits, RTL)
- `formatOrderDate("2026-04-23…", "ar-SA")` → `"٢٣ أبريل ٢٠٢٦"`
- `formatShippedAgo(…, "ar")` → `"منذ ساعتين"`

Three subtleties:

1. **Minor units.** Never divide at the API layer. Keep cents through your state, divide only in the formatter — floating-point rounding on a 5000-row catalog is a real bug.
2. **Currency from backend, locale from user.** A Saudi user browsing a US store sees `"$12.99"` (USD code) rendered by the `ar-SA` formatter (Arabic digits, RTL-aware). Currency is a store property, not a user property.
3. **Why `date-fns` over `Intl.RelativeTimeFormat`.** `Intl.RelativeTimeFormat` exists on Hermes but is expensive to initialize and does not handle "ago" context well. `date-fns` is ~8 KB per locale tree-shaken. `dayjs` is equivalent; pick one.

---

## Section 4: RTL handling

RTL is the single biggest source of "i18n worked fine in EN and ES, then Arabic broke everything" bug reports. The rules:

1. **Detect RTL once, at init.** `I18nManager.forceRTL(true)` flips the entire app's `flexDirection` default. It requires an app reload to take effect (iOS) or re-launch (Android). Do not call it in a render path.
2. **Use logical properties (`start`/`end`) by default.** `marginStart: 16` flips to margin-right on RTL; `marginLeft: 16` does not. Same for `paddingStart`, `borderStartWidth`, `start` / `end` positioning.
3. **Adapt `flexDirection: "row"` only when the direction is content-driven.** A row of semantic steps (step 1 → step 2 → step 3) should reverse in RTL. A row of three equal-width tabs need not.
4. **Mirror directional icons; keep symbolic ones fixed.** Back-arrow, forward-chevron, timeline markers → mirror. Heart, cart, search lens → do not mirror.

### 4.1 RTL bootstrap

```ts
// src/i18n/rtl.ts
import { I18nManager, Platform } from "react-native";
import * as Updates from "expo-updates";
import { MMKV } from "react-native-mmkv";

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);
const userPrefs = new MMKV({ id: "user-prefs" });
const RTL_FLAG_KEY = "rtl.lastApplied";

/** Call once from the root layout. No-op if already applied. */
export async function applyRTLForLanguage(lng: string): Promise<void> {
  const shouldBeRTL = RTL_LANGUAGES.has(lng);
  if (userPrefs.getBoolean(RTL_FLAG_KEY) === shouldBeRTL) return;
  if (Platform.OS === "web") return; // web CSS uses `dir` attribute.

  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);
  userPrefs.set(RTL_FLAG_KEY, shouldBeRTL);
  await Updates.reloadAsync(); // iOS requires reload to pick up flexDirection flip. See §9.2.
}
```

Wire into the root layout next to the i18n init:

```tsx
// src/app/_layout.tsx
import "@/i18n";
import { Stack } from "expo-router";
import { useEffect } from "react";
import i18n from "@/i18n";
import { applyRTLForLanguage } from "@/i18n/rtl";

export default function RootLayout(): JSX.Element {
  useEffect(() => {
    void applyRTLForLanguage(i18n.language);
    const onChange = (lng: string): void => void applyRTLForLanguage(lng);
    i18n.on("languageChanged", onChange);
    return () => i18n.off("languageChanged", onChange);
  }, []);
  return <Stack />;
}
```

### 4.2 RTL-aware layout component

```tsx
// src/components/row.tsx
import { I18nManager, View, type ViewProps } from "react-native";

type RowProps = ViewProps & { reverseInRTL?: boolean };

/** Use logical `marginStart`/`marginEnd` on children; Row handles flexDirection only. */
export function Row({ reverseInRTL = true, style, ...rest }: RowProps): JSX.Element {
  const flexDirection = reverseInRTL && I18nManager.isRTL ? "row-reverse" : "row";
  return <View {...rest} style={[{ flexDirection }, style]} />;
}
```

Checkout breadcrumb (reverses in Arabic so step 1 appears on the right):

```tsx
<Row reverseInRTL>
  <Step index={1} label={t("catalog")} />
  <Step index={2} label={t("checkout")} />
  <Step index={3} label={t("confirmation")} />
</Row>
```

Tab bar (three fixed-position tabs regardless of language): `<Row reverseInRTL={false}>`.

### 4.3 Icon mirroring decision tree

- **Directional icons mirror.** Back-arrow (←), forward-chevron (›), next-step (→), progress bars, playhead scrubbers.
- **Symbolic icons stay fixed.** Heart, star, cart, search lens, camera, checkmark. These are symbols, not direction indicators — mirroring reads as a defect, not localization.

```tsx
import { I18nManager } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Directional
const BackIcon = (): JSX.Element => (
  <Ionicons name="chevron-back" size={24}
    style={{ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }} />
);

// Symbolic
const CartIcon = (): JSX.Element => <Ionicons name="cart" size={24} />;
```

---

## Section 5: Accessibility APIs

React Native exposes the platform's accessibility APIs through a small set of props on every `View` / `Pressable` / `Text` descendant. The goal: every interactive element is announced correctly by VoiceOver (iOS) and TalkBack (Android).

### 5.1 The five props that matter

| Prop | Purpose | Example |
|---|---|---|
| `accessibilityLabel` | What the screen reader announces for this element. Overrides child text when set. | `"Add to cart"` |
| `accessibilityHint` | Additional context about what tapping does. Announced after a pause. | `"Adds this product to your cart"` |
| `accessibilityRole` | What kind of element this is: `button`, `header`, `link`, `image`, `imagebutton`, etc. | `"button"` |
| `accessibilityState` | Dynamic state: `disabled`, `selected`, `checked`, `busy`, `expanded`. | `{ disabled: true, busy: isLoading }` |
| `accessible` | Treat this view and all descendants as a single focusable element. | `{true}` on a card |

Rule of thumb: if a `Pressable` has no label text child (just an icon), you **must** set `accessibilityLabel`. If the label text is not a full sentence, set `accessibilityHint` to explain what happens on tap. Always set `accessibilityRole` on anything that is not a plain `Text` or `View`.

### 5.2 Accessible custom button

The Acme Shop "Add to cart" is `Pressable` + `Animated.View` (Reanimated feedback), not a stock `Button`. The a11y surface is manual:

```tsx
// src/features/catalog/components/add-to-cart-button.tsx
import { useTranslation } from "react-i18next";
import { Pressable, Text } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import type { Product } from "@/features/catalog/types";

type Props = { product: Product; isAdding: boolean; onAdd: () => void };

export function AddToCartButton({ product, isAdding, onAdd }: Props): JSX.Element {
  const { t } = useTranslation("catalog");
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPress={() => {
        if (isAdding) return;
        scale.value = withSpring(0.95, { damping: 10, stiffness: 300 },
          () => { scale.value = withSpring(1); });
        onAdd();
      }}
      disabled={isAdding}
      // Label includes the product so users hear what they are adding, not the generic action.
      accessibilityLabel={t("addToCartLabel", { product: product.title })}
      accessibilityHint={t("addToCartHint")}
      accessibilityRole="button"
      accessibilityState={{ disabled: isAdding, busy: isAdding }}
      testID={`add-to-cart-${product.id}`}
    >
      <Animated.View style={[{ padding: 12, backgroundColor: "#000" }, animatedStyle]}>
        <Text style={{ color: "#fff" }}>{isAdding ? t("adding") : t("addToCart")}</Text>
      </Animated.View>
    </Pressable>
  );
}
```

```json
{
  "addToCart": "Add to cart",
  "adding": "Adding…",
  "addToCartLabel": "Add {{product}} to cart",
  "addToCartHint": "Adds this product to your shopping cart"
}
```

### 5.3 Live regions — the cart badge

Content that updates *without* a navigation event (cart count, stock banner) must announce proactively. Android: `accessibilityLiveRegion`. iOS: `AccessibilityInfo.announceForAccessibility`.

```tsx
// src/features/cart/components/cart-badge.tsx
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useCartCount } from "@/features/cart/hooks/use-cart-count";

export function CartBadge(): JSX.Element {
  const count = useCartCount();
  const { t } = useTranslation("cart");
  const previousCount = useRef(count);

  useEffect(() => {
    // Only announce increases — decreases come from the user's own tap, which already spoke feedback.
    if (Platform.OS === "ios" && count > previousCount.current) {
      AccessibilityInfo.announceForAccessibility(t("cartUpdated", { count }));
    }
    previousCount.current = count;
  }, [count, t]);

  return (
    <View
      // "polite" waits for the current utterance; "assertive" interrupts — never use for non-critical UI.
      accessibilityLiveRegion={Platform.OS === "android" ? "polite" : "none"}
      accessibilityLabel={t("cartCount", { count })}
      accessibilityRole="text"
    >
      <Text>{count}</Text>
    </View>
  );
}
```

Strings:

```json
{
  "cartCount": "{count, plural, =0 {Cart empty} one {# item in cart} other {# items in cart}}",
  "cartUpdated": "{count, plural, one {Cart updated. # item.} other {Cart updated. # items.}}"
}
```

### 5.4 Grouping — the product card

A product card has thumbnail + title + price + rating. Without grouping, VoiceOver focuses each element separately ("Image. Foo Shirt. $29.99. Four stars." — four taps). With `accessible`, one stop: "Foo Shirt, $29.99, four stars. Button."

```tsx
// src/features/catalog/components/product-card.tsx
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/i18n/format";
import i18n from "@/i18n";

export function ProductCard({ product, onPress }: {
  product: Product;
  onPress: (id: string) => void;
}): JSX.Element {
  const { t } = useTranslation("catalog");
  const price = formatCurrency(product.priceCents, product.currency, i18n.language);

  return (
    <Pressable
      onPress={() => onPress(product.id)}
      accessible                                   // group as a single focus stop
      accessibilityRole="button"
      accessibilityLabel={t("productCardLabel", {
        title: product.title, price, rating: product.ratingAverage,
      })}
      accessibilityHint={t("productCardHint")}
    >
      <View>
        <Image
          source={product.imageUrl}
          style={{ aspectRatio: 1 }}
          accessibilityLabel=""                    // decorative; summarized in card label
          importantForAccessibility="no"           // Android-specific reinforcement
        />
        <Text>{product.title}</Text>
        <Text>{price}</Text>
      </View>
    </Pressable>
  );
}
```

On iOS, empty `accessibilityLabel` + parent `accessible` suppresses the child. On Android, add `importantForAccessibility="no"` belt-and-braces.

---

## Section 6: Focus order

Screen readers move through a screen in DOM order by default. This is correct 80% of the time and wrong 20%, typically on modals and screen transitions.

### 6.1 Focus-trap in modals

Use `accessibilityViewIsModal` on the iOS background view. If you build a custom Android overlay (not the native `<Modal>`), also set `importantForAccessibility="no-hide-descendants"` on the background:

```tsx
// src/features/checkout/components/confirm-purchase-modal.tsx
import { Modal, View } from "react-native";

export function ConfirmPurchaseModal({ visible, onDismiss, children }: {
  visible: boolean; onDismiss: () => void; children: React.ReactNode;
}): JSX.Element {
  return (
    <Modal visible={visible} transparent onRequestClose={onDismiss} animationType="fade">
      <View
        accessibilityViewIsModal                   // iOS: VoiceOver cannot escape this subtree
        style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)" }}
      >
        <View style={{ margin: 24, padding: 24, backgroundColor: "#fff", borderRadius: 12 }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}
```

### 6.2 Focus on screen transition

On navigation, screen readers hold focus on the previous screen's (now-unmounted) element. Explicitly set focus on the new screen's primary element:

```tsx
// src/features/catalog/screens/product-detail.tsx
import { useEffect, useRef } from "react";
import { findNodeHandle, AccessibilityInfo, Text, View } from "react-native";

export function ProductDetailScreen(): JSX.Element {
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    const node = findNodeHandle(titleRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  return (
    <View>
      <Text ref={titleRef} accessibilityRole="header">Product title</Text>
    </View>
  );
}
```

### 6.3 The focus-order checklist

- [ ] Swipe right from the top. Focus moves in visual reading order (LTR or RTL).
- [ ] Modal: swiping past the last element wraps, does not leak to background.
- [ ] On navigation, the first announcement names the new screen.
- [ ] Headers marked `accessibilityRole="header"` so VoiceOver rotor → Headings works.
- [ ] Every tappable has a role (`button`, `link`, `imagebutton`) and either visible text or `accessibilityLabel`.

---

## Section 7: Testing with VoiceOver and TalkBack

There is no automated screen-reader harness. Pretending otherwise is how apps ship where the label says "Cart" but VoiceOver speaks "Cart dot png". You do a manual pass per release candidate. These are the gestures and patterns.

### 7.1 Enabling the screen reader

- **iOS — VoiceOver:** Settings → Accessibility → VoiceOver → On. Set the triple-click side button shortcut for fast toggling. Gesture simulation on simulator is unreliable — use a physical device for ship-gate passes.
- **Android — TalkBack:** Settings → Accessibility → TalkBack → On. Volume-button shortcut (hold both 3s). Works on emulator; physical device preferred for throughput.

### 7.2 The six gestures

| Gesture | VoiceOver | TalkBack |
|---|---|---|
| Next / previous element | Swipe right / left (1 finger) | Swipe right / left (1 finger) |
| Activate focused element | Double-tap anywhere | Double-tap anywhere |
| Scroll | 3-finger swipe up/down | 2-finger swipe up/down |
| Stop utterance | 2-finger tap | 2-finger tap |
| Read from here | 2-finger swipe down | Volume-both + "Read from next item" |

Rotor (VoiceOver) / reading controls (TalkBack) are optional — not required for a ship-gate pass.

### 7.3 What to listen for

1. **Open the app.** First announced element should be the screen title ("Acme Shop, catalog, heading"), not "Image".
2. **Swipe through the catalog.** Each product card announces as one element with name + price + rating — not four separate stops (§5.4).
3. **Activate a product card.** Product detail screen announces its title as the first element (§6.2).
4. **Tap "Add to cart".** Label names the product, not the generic action (§5.2).
5. **Observe cart badge.** New count announces without re-focusing the badge (§5.3).
6. **Open checkout modal.** Cannot swipe past the modal into the catalog behind it (§6.1).
7. **Switch to Arabic, reload, repeat.** Focus order follows RTL reading.

### 7.4 Common failure patterns

| Fingerprint | Cause | Fix |
|---|---|---|
| Icon-only button reads as "Button", no label | Missing `accessibilityLabel` | Add translated label (§5.2) |
| Form field reads value only, no label | `TextInput` unpaired with label | Set `accessibilityLabel` or group with labelled parent |
| Decorative icon reads "Star, image" | Default a11y exposure | `accessibilityLabel=""` + `importantForAccessibility="no"` |
| Card sub-elements focus separately | Outer Pressable missing `accessible` | §5.4 |
| Toast / badge does not announce | Missing live region or `announceForAccessibility` | §5.3 |
| Modal background still focusable | Missing `accessibilityViewIsModal` | §6.1 |
| After nav, focus stuck or silent | No post-mount focus set | §6.2 |

---

## Section 8: Automated a11y checks

Static analysis catches the obvious regressions: `Pressable` without a label, invalid `accessibilityRole` value, nested touchables. It does **not** catch semantic errors ("label says X, but hint says Y, which is wrong given the UI state"). That is what the manual pass covers.

### 8.1 ESLint plugin setup

```bash
npx expo install --save-dev eslint-plugin-react-native-a11y
```

Flat config (`eslint.config.js`):

```js
import a11y from "eslint-plugin-react-native-a11y";

export default [
  // ... other configs (expo, tseslint, etc.)
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-native-a11y": a11y },
    rules: {
      "react-native-a11y/has-accessibility-hint": "off", // labels required, hints aspirational
      "react-native-a11y/has-valid-accessibility-role": "error",
      "react-native-a11y/has-valid-accessibility-state": "error",
      "react-native-a11y/has-valid-accessibility-value": "error",
      "react-native-a11y/has-valid-accessibility-actions": "error",
      "react-native-a11y/has-valid-accessibility-descriptors": "error",
      "react-native-a11y/no-nested-touchables": "error",
      "react-native-a11y/has-valid-accessibility-live-region": "error", // Android
      "react-native-a11y/has-valid-important-for-accessibility": "error", // Android
    },
  },
];
```

Legacy `.eslintrc`: `{ "plugins": ["react-native-a11y"], "extends": ["plugin:react-native-a11y/all"] }`. Run: `npx eslint . --max-warnings=0`.

### 8.2 What static analysis cannot catch

Real Acme Shop PRs that lint passed but manual review rejected:

- Label said `"Add to cart"` but the dynamically-appended product title landed in the wrong grammatical slot for Spanish.
- `accessibilityState={{ disabled: true }}` set, but the button was not disabled in business logic — double-tap spawned two requests.
- `accessibilityLiveRegion="polite"` on a banner re-rendering every 500 ms during API retry, causing VoiceOver stutter.

Mitigation: the manual VoiceOver/TalkBack pass + per-locale snapshot tests (§10).

### 8.3 Component-level a11y test suite

Extend the RNTL setup from `./06-performance-and-testing.md` §7 with a11y assertions (`getByRole`, `toBeDisabled`, `toHaveAccessibilityState`). Extend `renderWithProviders` with a `language` option:

```tsx
// src/test/render-with-providers.tsx (extends 06/§7.5)
import { render } from "@testing-library/react-native";
import i18n from "@/i18n";

type Options = { language?: "en" | "es" | "ar" };

export async function renderWithProviders(
  ui: React.ReactElement,
  { language = "en" }: Options = {},
): Promise<ReturnType<typeof render>> {
  await i18n.changeLanguage(language);
  return render(ui);
}
```

```tsx
// src/features/catalog/components/__tests__/add-to-cart-button.test.tsx
import { screen } from "@testing-library/react-native";
import { AddToCartButton } from "../add-to-cart-button";
import { renderWithProviders } from "@/test/render-with-providers";

const product = {
  id: "p1", title: "Foo Shirt", priceCents: 2999, currency: "USD",
  imageUrl: "https://cdn.example.com/p1.jpg", ratingAverage: 4,
} as const;

describe("AddToCartButton a11y", () => {
  it("exposes a button role with a localized label", async () => {
    await renderWithProviders(
      <AddToCartButton product={product} isAdding={false} onAdd={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /add foo shirt to cart/i })).toBeOnTheScreen();
  });

  it("reports disabled+busy state while adding", async () => {
    await renderWithProviders(
      <AddToCartButton product={product} isAdding onAdd={() => {}} />,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibilityState({ disabled: true, busy: true });
  });

  it("reads a different label in Spanish", async () => {
    await renderWithProviders(
      <AddToCartButton product={product} isAdding={false} onAdd={() => {}} />,
      { language: "es" },
    );
    expect(screen.getByRole("button", { name: /añadir foo shirt al carrito/i })).toBeOnTheScreen();
  });
});
```

Run all three locales on every component test — the cheapest guard against "works in English, breaks in Arabic" regressions.

---

## Section 9: Gotchas (i18n and a11y)

The recurring failures. Each has a fingerprint and a fix.

### 9.1 Translation keys missing after feature merge

**Fingerprint:** Developer adds `t("newFeature.title")`, tests locally, ships. Non-EN users see `newFeature.title` as literal text.

**Cause:** `i18n:extract` ran locally and updated `en.json` but not the other locales. No CI gate caught it.

**Fix:** Enforce `npm run i18n:check` in CI (§1.3). Every non-EN locale should be a translation-service output (Crowdin/Lokalise) or a committed file with explicit fallbacks; never stale.

### 9.2 RTL not applied after first install on iOS

**Fingerprint:** User installs the Arabic build. App opens LTR. They close and reopen — now RTL.

**Cause:** `I18nManager.forceRTL(true)` requires a reload. On first launch, `Updates.reloadAsync()` fires but iOS sometimes caches the original JS bundle and does not flip `I18nManager.isRTL` until the next cold start.

**Fix:** Set `supportsRTL: true` in `app.config.ts` via the `expo-localization` plugin as baseline. Do not preset `forcesRTL` at build time. Accept first-launch LTR; after `reloadAsync()`, if `I18nManager.isRTL` still does not match, surface a one-time toast ("Restart to apply right-to-left layout"). Document in release notes — the deeper fix requires a native change Expo does not yet expose.

### 9.3 VoiceOver focus stuck on hidden view

**Fingerprint:** After checkout completes, order confirmation animates in. VoiceOver announces nothing and swipe-right does nothing. Force-quit and reopen fixes it.

**Cause:** The previous screen's focused element (e.g., "Pay now") unmounts, but VO still holds a reference to the ghost node.

**Fix:** Always call `AccessibilityInfo.setAccessibilityFocus()` on screen mount (§6.2). Put it in the base screen template.

### 9.4 Dynamic font size breaks checkout layout

**Fingerprint:** At maximum iOS Dynamic Type, "Place order" button wraps to three lines and clips behind the keyboard.

**Cause:** Fixed `height: 48` on the button row + Dynamic Type on `Text`.

**Fix:** Replace `height` with `minHeight`; test at 200% Dynamic Type. As a last-resort cap, set `maxFontSizeMultiplier={1.3}` on the specific `Text`. Never set `allowFontScaling={false}` globally — that breaks accessibility for users who need it.

### 9.5 Hermes `Intl.PluralRules` polyfill missing

**Fingerprint:** Release-build Android throws `Intl.PluralRules is not a function` on the first pluralized string.

**Cause:** Hermes ships `Intl.NumberFormat` and `Intl.DateTimeFormat` but not `Intl.PluralRules`. i18next v26 requires it.

**Fix:** `import "intl-pluralrules"` once before i18n init (already in §1.1). If you see this error, the import was dropped in a refactor.

### 9.6 The `_one` trap in Arabic

**Fingerprint:** Translator wrote `"item_one"` and `"item_other"` in `ar.json`, copying the EN structure. Arabic UI shows correct text for count=1 and count=5, but wrong text for count=2 (dual form) and count≥11.

**Cause:** Arabic has six CLDR plural forms; `_one`/`_other` only expresses two. Counts 2, 3–10, 11–99, 100+ all fall back to `_other`, which is ungrammatical for the dual (2) and for counts ≥ 11.

**Fix:** ICU MessageFormat (§2.1) in JSON forces all six forms. Only translation QA catches this — budget for it.

### 9.7 Android `accessibilityLiveRegion` spam

**Fingerprint:** TalkBack users report the cart screen "talks over itself" — the live region re-announces every React render.

**Cause:** `accessibilityLiveRegion="polite"` on a `View` whose text changes every render (e.g., a countdown timer).

**Fix:** Live regions only for semantic changes (count 1 → 2), not presentational tick (timer). For the latter, set `accessibilityLiveRegion="none"` and announce discrete milestones via `AccessibilityInfo.announceForAccessibility`.

---

## Section 10: Verification

Pre-RC gates:

```bash
npx tsc --noEmit                                     # type-check
npx eslint . --max-warnings=0                        # lint (includes a11y plugin)
npm run i18n:check                                   # extraction up to date
npm test -- --coverage                               # unit tests across locales
npm test -- --snapshot                               # per-locale component snapshots
LOCALE=ar maestro test .maestro/flows/checkout-rtl.yaml  # RTL smoke
```

### 10.1 Manual VoiceOver + TalkBack checklist

Pin in the RC ticket template:

- [ ] VoiceOver iOS (physical device): full checkout flow in English.
- [ ] VoiceOver iOS: full checkout flow in Arabic (RTL focus order).
- [ ] TalkBack Android: full checkout flow in English.
- [ ] TalkBack Android: full checkout flow in Arabic.
- [ ] Product card reads as one element (§5.4).
- [ ] Cart badge announces changes (§5.3).
- [ ] Checkout modal traps focus (§6.1).
- [ ] Screen transitions announce new screen first (§6.2).
- [ ] 200% Dynamic Type: no clipping on primary buttons (§9.4).

No automation replaces this list. Skipping it costs an App Store rejection or a crashing TalkBack user — both strictly more expensive than 20 minutes with a screen reader.

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — Project layout; the feature folders that hold `locales/` dirs.
  - `./02-state-and-data.md` §6 — MMKV setup; the `user-prefs` instance that caches the language choice.
  - `./06-performance-and-testing.md` §7 — RNTL `renderWithProviders` base, extended here with the `language` option.
  - `./10-gotchas.md` — Full diagnostic catalogue; §9 above is the i18n/a11y-specific slice.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — The backend that returns prices in minor units and currency codes the formatter here consumes.
- **External documentation:**
  - [Expo Localization guide](https://docs.expo.dev/guides/localization/) — `getLocales()` API, RTL configuration, `supportsRTL` plugin options.
  - [i18next documentation](https://www.i18next.com/) — Full API; translation-function options (`count`, `context`); plurals page.
  - [react-i18next documentation](https://react.i18next.com/) — `useTranslation` hook, `Trans` component, SSR patterns (mostly not applicable on native).
  - [i18next-icu](https://github.com/i18next/i18next-icu) — ICU MessageFormat integration; selectOrdinal and other less-common formatters.
  - [i18next-parser](https://github.com/i18next/i18next-parser) — Config reference; output patterns; key extraction.
  - [React Native Accessibility](https://reactnative.dev/docs/accessibility) — Canonical prop reference for `accessibilityLabel`, `accessibilityRole`, `accessibilityState`, `AccessibilityInfo`.
  - [eslint-plugin-react-native-a11y](https://github.com/FormidableLabs/eslint-plugin-react-native-a11y) — Rule list, per-rule docs, flat-config examples.
  - [Apple — Testing with VoiceOver](https://developer.apple.com/library/archive/featuredarticles/iPhoneAccessibility/Testing_with_VoiceOver/TestingwithVoiceOver.html) — Gestures, simulator caveats, rotor reference.
  - [Android — Get started with TalkBack](https://support.google.com/accessibility/android/answer/6283677) — Enabling, gestures, reading controls.
  - [Unicode CLDR Plural Rules](https://unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) — The authoritative list of which languages have which plural forms; the source of truth for translators.
