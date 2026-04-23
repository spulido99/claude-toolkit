# Performance and testing

**Builds:** The performance and quality spine for Acme Shop — Hermes as the JS engine, the new architecture (Fabric + TurboModules) enabled by default, FlashList for the catalog grid, `react-native-reanimated` v3 worklets for the Add-to-cart button's tactile feedback, `expo-image` with blurhash placeholders for product thumbnails, `@testing-library/react-native` v14 for component and hook tests, MSW for request mocking, Maestro for end-to-end flows run in CI, and a GitHub Actions workflow that gates PRs on type-check + lint + unit tests and gates merges to `main` on Maestro Cloud runs against an EAS preview build.
**When to use:** Onboarding a new component that scrolls a long list, diagnosing a "scroll feels janky" report, wiring your first test suite on a fresh project, adding a regression test for a shipped bug, deciding between Maestro and Detox for a new app, debugging "works in dev, slow in release", or writing the CI workflow that blocks flaky PRs. Read Sections 1-5 before touching any perf-sensitive UI; Section 7 (testing) before writing the first test; Section 9 (CI) once at least one unit test and one Maestro flow exist.
**Prerequisites:** `./00-architecture.md` (project layout, `app.config.ts`, EAS profiles — tests run against the same project), `./01-navigation.md` (expo-router routes — tests render screens through a router wrapper), and `./02-state-and-data.md` (TanStack Query, Zustand cart, MMKV — tests mock the query client, not the network layer below it). MSW and jest-expo are installed on top of that foundation.

> Examples verified against Expo SDK 54 + `@shopify/flash-list` v2.0.0-rc.1 + `react-native-reanimated` 3.17.x + `expo-image` 2.x + `@testing-library/react-native` v14.3.x + `msw` 2.x + `maestro` >= 1.39 on 2026-04-23. Re-verify via context7 before porting to a newer SDK — FlashList v2 **removes** `estimatedItemSize`, `estimatedListSize`, and `estimatedFirstItemOffset` (v1 required them; v2 auto-sizes), RNTL v14 `render` is async (v13 was sync), and MSW 2 dropped the `rest` handler in favour of `http`.

## Contents

1. **Hermes** — Default JS engine since SDK 50; profiling via the Hermes sampling profiler; when to turn it off (rare; specific legacy-module incompatibilities that no longer apply to most apps).
2. **New architecture (Fabric + TurboModules)** — Default on from SDK 54 (verified against context7 at write time); the migration checklist for older apps; which libraries are Fabric-ready out of the box and which still go through the interop bridge.
3. **Lists** — `FlatList` pitfalls (inline `renderItem`, missing `keyExtractor`, `getItemLayout` for known heights); FlashList v2 for long and heterogeneous lists; the comparison table; an Acme Shop product-grid example.
4. **Animations** — Reanimated v3 worklets, shared values, `LinearTransition` on the cart badge, `Gesture.Pan` + `useAnimatedStyle`; the Add-to-cart button's scale-and-bounce feedback, worklet-only paths.
5. **Images** — `expo-image` caching, `blurhash` placeholders, dimension hints, `priority` prop for above-the-fold thumbnails, `prefetch` for the next page of products.
6. **Bundle size** — `npx expo export --dump-assetmap`, tree-shaking pitfalls (named imports from barrel files), lazy-loading screens via expo-router groups, the "5 MB" ratchet.
7. **Testing — unit and integration** — `jest-expo` preset, `@testing-library/react-native` v14 (async `render`), MSW for network mocking, test utilities (`renderWithProviders`) that mount TanStack Query + expo-router test providers, a product-card test, a `useAddToCart` hook test.
8. **Testing — end-to-end** — Maestro vs Detox; why Maestro is the default; a `sign-in-and-add-to-cart.yaml` flow; the short "when Detox is worth it" note.
9. **CI integration** — GitHub Actions workflow: type-check + lint + unit on every PR; Maestro Cloud against EAS preview build on merge candidates; the sample workflow YAML.
10. **Gotchas (perf + test)** — Jest transform-ignore for Expo packages, MSW polyfills missing in React Native runtime, RNTL not finding `expo-router` screens, Maestro iOS simulator Rosetta flakes, FlatList jank from inline image sizes, FlashList v1-to-v2 migration silent footgun.
11. **Verification** — `npm test`, `maestro test`, Hermes profile recording, bundle-size ratchet check.
12. **Further reading** — Pointers into the rest of this skill and external canonical docs.

---

## Section 1: Hermes

Hermes is the default JavaScript engine on iOS and Android for every Expo SDK from 50 onward. It is the assumption for every code snippet in this skill. You opt **out** with `jsEngine: "jsc"` in `app.config.ts` only if you have a concrete reason; there is almost never a concrete reason in 2026.

Hermes differs from JavaScriptCore in ways that matter for performance and debugging:

- **Startup.** Hermes precompiles JS to bytecode at build time, so the cold-start parse/compile cost is paid on the CI box, not the user's device. Expect 200-400 ms faster TTI for a typical 3-5 MB Acme Shop bundle on a mid-tier Android phone.
- **Memory.** Lower steady-state heap use — often 30-40% lower on Android. The ceiling matters more on Android than iOS; Hermes is why Android parity does not require a separate memory-optimization pass.
- **Profiler.** Chrome DevTools → React Native menu → **Start Hermes Sampling Profiler**. Capture 15-30 seconds of the specific jank (scroll a long list, navigate between screens). Save the trace, open it in Chrome DevTools `Performance` tab, look for wide bars on the JS thread.

### 1.1 When not to use Hermes

Only three reasons to disable it:

1. A **native module** you must ship does not support Hermes. Rare in 2026 — every mainstream module has been Hermes-compatible for years. If you find one, file an issue upstream and try to patch it locally rather than losing Hermes.
2. A **JS library** depends on an engine-specific API (e.g., a very old `intl` polyfill assuming JSC's `Intl.DateTimeFormat` behaviour). Fix the library; do not give up Hermes.
3. You are **debugging a Hermes-specific bug** and want to A/B confirm. Flip `jsEngine: "jsc"`, reproduce, flip back. Do not ship with JSC.

### 1.2 Bridgeless mode

Hermes + the new architecture enable bridgeless mode: there is no single serialized JSON bridge between JS and native. TurboModules talk to native via JSI synchronously; Fabric talks via the shadow tree. **You do not opt in manually.** SDK 54's default template has bridgeless on because the new architecture is on. If you opt out of the new architecture (§2), you opt out of bridgeless as a side-effect.

---

## Section 2: New architecture (Fabric + TurboModules)

> **Verified status (2026-04-23, context7):** Expo SDK 54 ships with the new architecture **enabled by default**. The old architecture (bridge + paper renderer) is still supported for apps that opt out via `newArchEnabled: false` in `app.config.ts`, but it is the minority path and will be removed in a future SDK. Re-verify this section's status before porting to SDK 55 or later.

The new architecture is two things:

- **Fabric** — the renderer that replaced the old "paper" renderer. Views are reconciled against a shadow tree written in C++ and synchronized to the native view hierarchy without a JSON bridge round-trip per frame.
- **TurboModules** — the native-module replacement. JS calls into native methods synchronously via JSI; there is no serialization to cross the bridge.

For a new Acme Shop you get both without configuration. The `newArchEnabled: true` default lives in the Expo template.

### 2.1 Migration checklist (for existing apps on the old architecture)

If you inherit an Expo app from SDK 52 or earlier that has `newArchEnabled: false` explicitly set, turn it on in a dedicated PR:

1. **Audit third-party native modules.** `npx expo-doctor` flags any module that declares it does not support the new architecture. For each hit, check the library's latest release notes — most have shipped Fabric-ready versions by now.
2. **Remove patch-package entries** related to the old architecture. Many older apps have patches for libraries that are now Fabric-ready in their published versions.
3. **Run `npx expo prebuild --clean`.** The new architecture changes the generated native project. Stale `ios/` or `android/` folders will corrupt the build.
4. **EAS build a preview profile on both platforms.** Test on-device; simulator is not sufficient for Fabric regressions, which often manifest as off-screen clipping or gesture-area mismatches.
5. **Smoke the four most interactive screens** — a long scroll, an animation-heavy screen, any screen with a `Modal` or `BottomSheet`, and any screen with a `TextInput`. Modal and TextInput are the two highest-risk primitives during a migration.

### 2.2 Which libraries are Fabric-ready

As of SDK 54, the mainstream Acme Shop stack is Fabric-native:

| Library | Status |
|---|---|
| `react-native-reanimated` v3.6+ | Fabric-native |
| `react-native-gesture-handler` v2.13+ | Fabric-native |
| `@shopify/flash-list` v2.0.0-rc.1 | Fabric-native (rewritten; v1 used the interop bridge) |
| `expo-image` 2.x | Fabric-native |
| `expo-router` v5 | Fabric-native |
| `@tanstack/react-query` v5 | N/A (pure JS, no native module) |
| `zustand` | N/A (pure JS) |
| `react-native-mmkv` v2 | Interop via bridge; v3 (when released) is Fabric-native |
| `react-native-purchases` (RevenueCat) | Fabric-native |

"Interop via bridge" means the old architecture path still works for that module; you do not have to replace it. Fabric-native means the module skips the interop layer and runs synchronously via JSI. For Acme Shop the only interop path is MMKV v2; the overhead is nanoseconds per `getString` and does not matter in practice.

---

## Section 3: Lists

Two goals: keep scroll frame rate at 60 fps (120 on ProMotion iPhones) and keep memory bounded regardless of `data` length. Every perf report we have ever seen on this codebase traces back to one of four mistakes:

- Inline `renderItem` that re-creates a new function every parent render, defeating memoization.
- Missing `keyExtractor`, forcing React to rerender whole rows instead of keying them.
- Missing `getItemLayout` on a `FlatList` with known-height items, forcing the runtime to measure every row.
- Loading full-resolution product images without dimension hints or an `expo-image` `placeholder`, causing synchronous layout thrash on first render.

### 3.1 FlatList pitfalls (and why we do not use it for the catalog)

`FlatList` is fine for lists of **fixed-height** items shorter than ~200 entries. It is the wrong tool for the Acme Shop catalog (variable-height product cards, 500-5000 entries, heavy images). We document these pitfalls so that if you see `FlatList` anywhere in the codebase, you know how to make it not-terrible:

```tsx
// src/features/catalog/screens/__do-not-copy__/flatlist-antipattern.tsx
// This is the WRONG pattern. See the FlashList version below.
import type { Product } from "@/features/catalog/types";
import { FlatList, View, Text } from "react-native";

type Props = { products: Product[] };

export function FlatListAntipattern({ products }: Props): JSX.Element {
  return (
    <FlatList
      data={products}
      // Anti-pattern 1: inline renderItem. New function every parent render.
      renderItem={({ item }) => (
        <View>
          <Text>{item.title}</Text>
        </View>
      )}
      // Anti-pattern 2: no keyExtractor. React falls back to item index, which
      // breaks when the list reorders (e.g., "sort by price").
      // Anti-pattern 3: no getItemLayout. Every row measured on first paint.
    />
  );
}
```

The "correct FlatList" form — hoist `renderItem` out of render, give it `React.memo` if the row itself has local state, provide `keyExtractor`, provide `getItemLayout` when rows are the same height — is fine for short lists. It is not fine for Acme Shop's catalog. See §3.3.

### 3.2 FlashList v2 — the catalog's list component

FlashList v2 (Shopify) is the list component for anything over ~200 entries or with variable heights. The v1 → v2 transition is load-bearing enough that it earns its own subsection (§3.4).

Key v2 behaviour:

- **No size estimation props.** `estimatedItemSize`, `estimatedListSize`, and `estimatedFirstItemOffset` existed in v1 and are **gone in v2**. FlashList v2 measures items the first time they render and caches the dimensions.
- **Auto-recycling.** Cells are reused as they scroll off-screen. Your `renderItem` receives a new `item` but the underlying view tree is reused — so do not hold per-row state in refs tied to the view; hold it in `item.id`-keyed structures.
- **Works with masonry.** Set `masonry` and `numColumns` for heterogeneous-height grid layouts (the wishlist screen uses this; the main catalog does not).

Acme Shop catalog list:

```tsx
// src/features/catalog/components/product-grid.tsx
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Product } from "@/features/catalog/types";

type ProductGridProps = {
  products: Product[];
  onEndReached: () => void;
  isFetchingNextPage: boolean;
};

// Hoisted outside the component: stable reference across parent renders.
// The row receives `item` as a prop; nothing else is read from closure.
const ProductRow = ({ item, onPress }: { item: Product; onPress: (id: string) => void }): JSX.Element => (
  <Pressable onPress={() => onPress(item.id)} style={{ flex: 1, padding: 8 }}>
    <Image
      source={item.imageUrl}
      // Tell the layout engine the aspect ratio so the placeholder does not
      // collapse to height 0 and thrash when the real image loads. See §5.
      style={{ aspectRatio: 1, borderRadius: 8 }}
      placeholder={{ blurhash: item.blurhash }}
      contentFit="cover"
      transition={200}
      priority="high"
    />
    <Text numberOfLines={2}>{item.title}</Text>
    <Text>${item.priceCents / 100}</Text>
  </Pressable>
);

export function ProductGrid({ products, onEndReached, isFetchingNextPage }: ProductGridProps): JSX.Element {
  const router = useRouter();

  // Stable callback: does not change across renders. Passed to ProductRow,
  // which is memoized inside FlashList's recycler.
  const handleOpen = useCallback(
    (id: string) => {
      router.push(`/product/${id}`);
    },
    [router],
  );

  // Stable renderItem: hoisted and parameterized via closure over handleOpen.
  // The closure is stable because handleOpen is stable.
  const renderItem: ListRenderItem<Product> = useCallback(
    ({ item }) => <ProductRow item={item} onPress={handleOpen} />,
    [handleOpen],
  );

  return (
    <FlashList
      data={products}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      numColumns={2}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      // No estimatedItemSize — gone in v2.
      ListFooterComponent={isFetchingNextPage ? <LoadingFooter /> : null}
    />
  );
}

function LoadingFooter(): JSX.Element {
  return (
    <View style={{ padding: 16 }}>
      <Text>Loading more products…</Text>
    </View>
  );
}
```

Three design choices worth calling out:

1. **`ProductRow` is hoisted and takes `onPress` as a prop, not via closure.** This is why `renderItem` can be memoized without holding onto a stale `router` reference across renders.
2. **`aspectRatio: 1` on the image, not `height: 200`.** Lets the cell take its natural width and scale the image. Works on phones, tablets, and the web target.
3. **`priority="high"` on above-the-fold thumbnails.** See §5. For paginated loads beyond the first screenful, drop this to `"normal"` or omit it.

### 3.3 Comparison table

| | `FlatList` | `FlashList` v2 |
|---|---|---|
| Setup | Built-in to React Native | `npm install @shopify/flash-list` |
| Size estimation | `getItemLayout` for fixed heights; otherwise measured on first paint | Auto-measured and cached; no props |
| Recycling | Virtualized window only; view trees not reused | Recycles view trees across items |
| Heterogeneous types | Requires manual `getItemType` + `CellRendererComponent` trickery | First-class `getItemType` prop |
| Masonry | Not supported | `masonry` + `numColumns` props |
| Web target | Works on Expo-for-web | Works on Expo-for-web (v2 shipped web support) |
| Memory for 5k items | Grows with scroll position | Bounded regardless of `data.length` |
| When to pick | <200 fixed-height items; settings screens; short static lists | Catalogs, feeds, chat histories, any list that paginates |

### 3.4 v1 → v2 migration note

If you are inheriting an Acme Shop branch on FlashList v1, the migration is short but has one silent footgun:

- Remove `estimatedItemSize`, `estimatedListSize`, `estimatedFirstItemOffset`. **TypeScript will not flag these if your `@shopify/flash-list` types are out of date.** Upgrade the package and type-check strictly.
- Replace `MasonryFlashList` imports with `FlashList` + `masonry` + `numColumns`. `getColumnFlex` is not supported in v2; if you needed per-column flex, restructure the layout.
- The `estimatedItemSize` gotcha is worth the gotcha-list entry in §10.5.

---

## Section 4: Animations

`react-native-reanimated` v3 is the animation layer. Its defining idea: animations run on the UI thread via **worklets**, tiny JS functions compiled to run off the JS thread. The JS thread may stall (garbage collection, a heavy `useEffect`, a sync `MMKV.getAllKeys`) without the animation dropping frames.

### 4.1 Core primitives

- **`useSharedValue(initial)`** — a value readable and writable from both the JS and UI threads. Writes from JS cross the thread boundary; writes from worklets stay on UI.
- **`useAnimatedStyle(worklet)`** — derives a style object from shared values. Re-runs on the UI thread whenever any read shared value changes. The returned style is spread onto an `Animated.View`.
- **`withSpring(target, config?)`, `withTiming(target, config?)`** — animation primitives. Assign the result to a shared value's `value`. They are worklet-only; calling them from JS is fine because the assignment crosses to the UI thread.
- **`Gesture.Pan()` / `Gesture.Tap()`** (from `react-native-gesture-handler`) — worklet-based gesture handlers. Their `onUpdate` callbacks run on the UI thread and may write to shared values directly.

### 4.2 Add-to-cart button — tactile feedback

A tap on the Add-to-cart button should feel physical: it presses down 5%, releases with a small spring overshoot, and the cart badge slides in from above with `LinearTransition`. Zero JS thread involvement except the initial tap event.

```tsx
// src/features/cart/components/add-to-cart-button.tsx
import { useAddToCartMutation } from "@/features/cart/hooks/use-add-to-cart-mutation";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Text } from "react-native";

type AddToCartButtonProps = {
  productId: string;
  label: string;
};

export function AddToCartButton({ productId, label }: AddToCartButtonProps): JSX.Element {
  const scale = useSharedValue(1);
  const { mutate: addToCart, isPending } = useAddToCartMutation();

  // Tap gesture. onBegin runs on UI thread when the finger lands; onFinalize
  // runs on UI thread when it lifts. The mutation itself runs on JS.
  const tap = Gesture.Tap()
    .onBegin(() => {
      // Worklet. Runs on UI thread. Direct write, no JS round-trip.
      "worklet";
      scale.value = withTiming(0.95, { duration: 90 });
    })
    .onFinalize((_event, success) => {
      "worklet";
      scale.value = withSpring(1, { damping: 10, stiffness: 180 });
      if (success) {
        // runOnJS is not needed here because the mutation is triggered
        // through a wrapping onTap handler on the native side below.
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: isPending ? 0.6 : 1,
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={`Add ${label} to cart`}
        accessibilityState={{ disabled: isPending, busy: isPending }}
        onTouchEnd={() => addToCart({ productId })}
        style={[
          {
            backgroundColor: "#111",
            paddingVertical: 14,
            paddingHorizontal: 24,
            borderRadius: 10,
            alignItems: "center",
          },
          animatedStyle,
        ]}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>Add to cart</Text>
      </Animated.View>
    </GestureDetector>
  );
}
```

Four things to note:

1. **The `'worklet';` directive.** Every callback that runs on the UI thread must be a worklet. Reanimated v3 infers this for `useAnimatedStyle`, but callbacks passed to `Gesture.*` need the explicit directive if you want the predictable runtime error if you accidentally reference a closed-over JS value.
2. **No bridge traffic during the animation.** The scale changes, the style recomputes, the view commits — all on UI. The JS thread is free to run the TanStack Query mutation in parallel without the animation stuttering.
3. **Mutation path is separate from animation path.** The `onTouchEnd` JS handler triggers the mutation; the gesture worklet drives the visual. We keep these decoupled because the visual feedback must fire even if the mutation is rejected (offline, conflict) — the rollback is handled by the TanStack onError path (see `./02-state-and-data.md` §5).
4. **`opacity: isPending ? 0.6 : 1` is a JS-driven style.** The gesture animation (scale) runs on UI; the pending opacity runs on JS. This is fine because opacity is cheap and only changes on mutation start/end, not per frame.

### 4.3 Cart badge — `LinearTransition`

When the cart count changes from 0 → 1 (or 2 → 3), the badge should slide in from above with a small bounce. `LinearTransition` animates layout changes automatically, no imperative code.

```tsx
// src/features/cart/components/cart-badge.tsx
import Animated, { LinearTransition } from "react-native-reanimated";
import { useCartStore } from "@/features/cart/state/cart-store";
import { Text } from "react-native";

export function CartBadge(): JSX.Element | null {
  const count = useCartStore((state) => state.itemCount());
  if (count === 0) return null;

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(14)}
      style={{
        position: "absolute",
        top: -4,
        right: -6,
        backgroundColor: "#c80000",
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 4,
      }}
    >
      <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>{count}</Text>
    </Animated.View>
  );
}
```

`LinearTransition.springify().damping(14)` gives a gentle overshoot. Tuning lives in §4.5.

### 4.4 `Gesture.Pan` — swipe-to-delete on cart lines

The cart line has a swipe-to-delete interaction. Drag right to reveal a Delete button; drag past a threshold to commit.

```tsx
// src/features/cart/components/cart-line-row.tsx
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { View, Text, Pressable } from "react-native";
import { useRemoveCartLineMutation } from "@/features/cart/hooks/use-remove-cart-line-mutation";
import type { CartLine } from "@/features/cart/types";

type CartLineRowProps = { line: CartLine };

const SWIPE_THRESHOLD = 120;
const MAX_SWIPE = 160;

export function CartLineRow({ line }: CartLineRowProps): JSX.Element {
  const translateX = useSharedValue(0);
  const saved = useSharedValue(0);
  const { mutate: removeLine } = useRemoveCartLineMutation();

  const pan = Gesture.Pan()
    .onStart(() => {
      "worklet";
      saved.value = translateX.value;
    })
    .onUpdate((event) => {
      "worklet";
      // Clamp the drag to the open direction and cap it.
      const next = Math.min(Math.max(saved.value + event.translationX, -MAX_SWIPE), 0);
      translateX.value = next;
    })
    .onEnd(() => {
      "worklet";
      if (translateX.value <= -SWIPE_THRESHOLD) {
        translateX.value = withSpring(-MAX_SWIPE, { damping: 14 });
      } else {
        translateX.value = withSpring(0, { damping: 14 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={{ position: "relative", overflow: "hidden" }}>
      {/* Delete action lives behind the card. Tap to commit. */}
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: MAX_SWIPE,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#c80000",
        }}
      >
        <Pressable onPress={() => removeLine({ lineId: line.id })}>
          <Text style={{ color: "white", fontWeight: "700" }}>Delete</Text>
        </Pressable>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[{ padding: 16, backgroundColor: "white" }, cardStyle]}>
          <Text>{line.productTitle}</Text>
          <Text>Qty: {line.quantity}</Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
```

This is purely worklet-driven. The JS thread does not see the drag; it only hears about it when the user commits the delete via the Delete Pressable.

### 4.5 When to step back to JS-driven animations

Reanimated's worklet model covers 95% of Acme Shop. Stay on JS-driven (`Animated` from `react-native`, or plain state + `requestAnimationFrame`) when:

- The animation depends on a server response per frame (unlikely, but e.g., a live chart from a websocket). Then accept the JS-thread cost; the payload was already on JS anyway.
- You are animating a very small number of elements (a loading indicator spinning) and the simplicity of `Animated.timing` beats the worklet setup. Fine for prototyping; migrate if it becomes perf-critical.
- You have no native module available (web-only development surface). Expo-for-web uses Reanimated's web shim, which compiles worklets to plain JS functions — still faster than hand-rolled RAF loops.

---

## Section 5: Images

`expo-image` replaces the React Native `Image` primitive. The reasons are the same everywhere: disk and memory caching by default, blurhash/thumbhash placeholders, smooth transitions on source change, `cachePolicy` control, and a `priority` prop that the native layer actually honours.

### 5.1 Core usage

```tsx
import { Image } from "expo-image";
import type { Product } from "@/features/catalog/types";

type ProductThumbnailProps = { product: Product; aboveTheFold: boolean };

export function ProductThumbnail({ product, aboveTheFold }: ProductThumbnailProps): JSX.Element {
  return (
    <Image
      source={product.imageUrl}
      style={{ aspectRatio: 1, borderRadius: 8 }}
      // Blurhash: a 20-30 character string representing a blurry preview.
      // Generated at ingestion time on the backend and stored per product.
      placeholder={{ blurhash: product.blurhash }}
      contentFit="cover"
      transition={200}
      priority={aboveTheFold ? "high" : "normal"}
      cachePolicy="memory-disk"
      accessibilityLabel={product.title}
    />
  );
}
```

Property-by-property:

- **`source`** — accepts a URL string, a required() local asset, or an `{ uri, width, height }` object. Prefer passing width/height hints when you know them — see `./05-cross-platform-web.md` §9 gotcha on `expo-image`'s web fallback.
- **`placeholder={{ blurhash }}`** — the blurhash is rendered by the native library while the real image downloads. Compact (20-30 chars, fits in a DynamoDB item; see `./02-state-and-data.md` §server-state).
- **`contentFit: "cover"`** — equivalent to CSS `object-fit: cover`. Fills the frame, crops overflow. Alternatives: `"contain"` (fit inside, letterbox), `"fill"` (stretch), `"scale-down"`.
- **`transition={200}`** — cross-dissolve duration in ms between placeholder and real image. Set to 0 for instant swap; useful on tiny thumbnails where the 200 ms crossfade is distracting.
- **`priority="high"`** — tells the native downloader (SDWebImage on iOS, Glide on Android) to schedule this fetch ahead of others. Use it for above-the-fold content. Every image at `"high"` is no different from every image at `"normal"`; it is a relative hint.
- **`cachePolicy="memory-disk"`** — memory cache (session) plus disk cache (persists across app launches). Alternatives: `"memory"` (session only), `"disk"` (skip memory), `"none"` (always fetch).

### 5.2 Blurhash generation

Blurhash is generated from the source image at ingest time, not on the client. On Acme Shop's product-ingest Lambda (see `../../aws-cdk-patterns/references/01-serverless-api.md`), when a merchant uploads a product image we run a short `sharp` + `blurhash-encoder` pipeline:

```ts
// Server-side (Lambda). Not on the device.
import { encode } from "blurhash";
import sharp from "sharp";

export async function generateBlurhash(imageBuffer: Buffer): Promise<string> {
  const { data, info } = await sharp(imageBuffer)
    .raw()
    .ensureAlpha()
    .resize(32, 32, { fit: "inside" })
    .toBuffer({ resolveWithObject: true });
  return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 4);
}
```

Generate once, store in the product record alongside `imageUrl`, ship to the client in the catalog query. Never generate on the device.

### 5.3 Prefetching the next page

When the user is near the bottom of the catalog, we've already fetched the next page's data (via TanStack Query's `fetchNextPage`). Prefetch the images too:

```tsx
// src/features/catalog/hooks/use-prefetch-next-page.ts
import { Image } from "expo-image";
import type { Product } from "@/features/catalog/types";

export async function prefetchProductImages(products: Product[]): Promise<void> {
  // Fire-and-forget: we do not await individual prefetches.
  await Image.prefetch(
    products.map((p) => p.imageUrl),
    { cachePolicy: "memory-disk" },
  );
}
```

Call this inside the `onSuccess` of the `fetchNextPage` result. The user scrolls into the next page and the images are already warm in the memory cache.

### 5.4 Dimension hints to avoid layout thrash

The single biggest "why is the list janky" cause is cells collapsing to height 0 before the image loads, then jumping to final height on load. Two fixes:

- **Always set `aspectRatio`** on the `Image` style when you know the source's aspect ratio. Products are 1:1 on Acme Shop; the `Image` style is `{ aspectRatio: 1, ... }`.
- **For variable-aspect sources** (user-uploaded photos in a feed), pass `width` and `height` on the `source` object: `source={{ uri, width: 800, height: 600 }}`. The layout engine uses these before the image resolves.

---

## Section 6: Bundle size

A 3-5 MB JS bundle (minified, Hermes-compiled) is healthy for an app of Acme Shop's size. 10 MB+ suggests a native module that dragged in a 2 MB JS polyfill or a barrel import that defeated tree-shaking.

### 6.1 Measuring

```bash
# Export a production bundle and emit the asset map.
npx expo export --platform ios --output-dir ./dist-ios --dump-assetmap

# Bundle size smoke.
du -sh ./dist-ios/

# Per-chunk breakdown.
find ./dist-ios -name '*.js' -exec du -h {} + | sort -rh | head

# Asset map: which source files produce which chunks.
cat ./dist-ios/assetmap.json | jq 'keys | length'
```

The assetmap tells you which source modules landed in which JS chunk. Combined with an expo-router groups layout (§6.3), you can confirm that a rarely-visited screen (say `/account/data-export`) is in its own chunk and not blocking initial load.

### 6.2 Tree-shaking pitfalls

Barrel files (`index.ts` re-exporting a domain's public surface) are the most common cause of tree-shaking failure. Example:

```ts
// src/features/catalog/index.ts — BAD barrel
export * from "./components/product-grid";
export * from "./components/product-card";
export * from "./screens/catalog.screen";
export * from "./screens/product-detail.screen";
export * from "./hooks/use-products";
export * from "./hooks/use-product";
// ... 15 more exports
```

When a component imports `{ ProductGrid } from "@/features/catalog"`, Metro's static analysis sometimes cannot prove that the other 20 exports are unused, so it bundles all of them. The fix:

```ts
// BETTER: import directly from the source file.
import { ProductGrid } from "@/features/catalog/components/product-grid";
```

Keep barrel files for the top-level domain module only if every export is genuinely part of the public surface. For Acme Shop we have barrel files at the **hook** layer (`@/features/cart/hooks`) and nowhere else; screens and components are imported directly.

### 6.3 Lazy-loading screens via expo-router groups

Expo Router's group segments (`(shop)`, `(auth)`) correspond to code-split chunks in the static web export. On native, the chunks are not split per-group (native bundles are monolithic), but the **imports** at the group-layout level still matter. If `app/(account)/_layout.tsx` imports a heavy charting library used only in `/account/analytics`, that chart library pays the import cost on every `(account)` group mount.

The rule: a group's `_layout.tsx` imports **only** navigation primitives and the shared screen wrappers. Heavy screen-specific dependencies live in the screen file, which is imported lazily by the router.

### 6.4 Bundle-size ratchet in CI

See §9 for the workflow. The pattern: on every PR, export the bundle, compare its size against the `main` branch's size, fail if it grew by more than 5%. This catches "I added a library to fix a small bug, and it dragged in Moment.js" the day it happens.

---

## Section 7: Testing — unit and integration

`jest-expo` is the canonical Jest preset. It wires Hermes-compatible transforms, the Metro resolver for `@/` path aliases, and the test environment for React Native's globals. Do not roll a custom Jest config unless you are debugging a specific transform issue.

### 7.1 Setup

```bash
# In a fresh Expo project:
npx expo install --dev jest jest-expo @testing-library/react-native @testing-library/jest-native msw

# Polyfills needed for MSW in React Native runtime.
npx expo install fast-text-encoding react-native-url-polyfill
```

`package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "preset": "jest-expo",
    "setupFilesAfterEach": ["<rootDir>/jest.setup.ts"],
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/flash-list|msw))"
    ]
  }
}
```

`jest.setup.ts`:

```ts
// jest.setup.ts
import "@testing-library/jest-native/extend-expect";

// Quiet the act() warnings that RNTL v14 throws for async-render idioms.
// Upstream issue tracked; safe to suppress while waiting for RNTL v15.
jest.spyOn(console, "error").mockImplementation((message: string) => {
  if (typeof message === "string" && message.includes("Warning: An update to")) return;
});

// MMKV is native-module-only; stub it in the test runtime.
jest.mock("react-native-mmkv", () => {
  const store = new Map<string, string>();
  return {
    createMMKV: () => ({
      set: (k: string, v: string) => store.set(k, v),
      getString: (k: string) => store.get(k) ?? undefined,
      delete: (k: string) => store.delete(k),
      clearAll: () => store.clear(),
    }),
  };
});
```

The `transformIgnorePatterns` list is tedious and bugs bite hard when a new package is added. See §10.1 for the fingerprint.

### 7.2 MSW setup for React Native

MSW intercepts `fetch` via platform-specific adapters. In React Native, the adapter lives at `msw/native` — **not** `msw/node`.

```ts
// src/mocks/handlers.ts
import { http, HttpResponse } from "msw";
import type { Product } from "@/features/catalog/types";

const FAKE_PRODUCTS: Product[] = [
  {
    id: "prod-1",
    title: "Acme Widget",
    priceCents: 1999,
    imageUrl: "https://cdn.acmeshop.example/widget.jpg",
    blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
  },
];

export const handlers = [
  http.get("https://api.acmeshop.example/v1/products", () => {
    return HttpResponse.json({ items: FAKE_PRODUCTS, nextCursor: null });
  }),
  http.post("https://api.acmeshop.example/v1/cart/add", async ({ request }) => {
    const body = (await request.json()) as { productId: string };
    return HttpResponse.json({ lineId: `line-${body.productId}`, quantity: 1 });
  }),
];
```

```ts
// src/mocks/server.ts
import { setupServer } from "msw/native"; // NOTE: "native", not "node"
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

```ts
// msw.polyfills.ts — imported from jest.setup.ts and index.ts (dev only).
import "fast-text-encoding";
import "react-native-url-polyfill/auto";
```

Tests start and stop the server per file:

```ts
// src/features/catalog/__tests__/product-card.test.tsx
import { server } from "@/mocks/server";

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" }); // fail on unmocked requests
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
```

### 7.3 `renderWithProviders` — the test utility every component test uses

Real Acme Shop components read from the TanStack query client, the Zustand cart store, and (for screens) expo-router. A test helper mounts all three:

```tsx
// src/test-utils/render-with-providers.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

type ProvidersProps = { children: ReactNode };

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { queryClient?: QueryClient },
): ReturnType<typeof render> & { queryClient: QueryClient } {
  const queryClient = options?.queryClient ?? makeQueryClient();

  function Providers({ children }: ProvidersProps): JSX.Element {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </GestureHandlerRootView>
    );
  }

  return {
    ...render(ui, { wrapper: Providers, ...options }),
    queryClient,
  };
}
```

Three design notes:

1. **Each test gets a fresh QueryClient.** Preventing cross-test cache leakage is worth the setup cost.
2. **`retry: false`**: a failed test should surface one error, not three retried errors.
3. **`GestureHandlerRootView` at the root.** Without it, `GestureDetector` children throw at render time — see §10.3.

For screen tests that exercise navigation, wrap with an expo-router test provider. The minimum wrapper looks like this:

```tsx
// src/test-utils/router-mock.tsx
import type { ReactNode } from "react";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  Link: ({ children }: { children: ReactNode }) => children,
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
```

For tests that need to assert on a specific route or `useLocalSearchParams` payload, replace the mocked implementations per-test with `jest.mocked(useLocalSearchParams).mockReturnValue({ id: "prod-1" })`. The full wrapper that exercises real route resolution lives in the expo-router test utilities and is the right tool once you need it; the mock above covers 80% of component tests that only need the hooks not to throw.

### 7.4 Component test — product card

```tsx
// src/features/catalog/__tests__/product-card.test.tsx
import { ProductCard } from "@/features/catalog/components/product-card";
import { renderWithProviders } from "@/test-utils/render-with-providers";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { screen, userEvent } from "@testing-library/react-native";

jest.useFakeTimers();

const FAKE_PRODUCT = {
  id: "prod-1",
  title: "Acme Widget",
  priceCents: 1999,
  imageUrl: "https://cdn.acmeshop.example/widget.jpg",
  blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
};

describe("ProductCard", () => {
  it("renders title and price", async () => {
    await renderWithProviders(<ProductCard product={FAKE_PRODUCT} />);

    expect(await screen.findByText("Acme Widget")).toBeOnTheScreen();
    expect(screen.getByText("$19.99")).toBeOnTheScreen();

    // No assertion on the image URL — expo-image is not network-loaded in
    // Jest; we trust the source string is wired and validate visually in
    // the Maestro flow.
  });

  it("triggers the add-to-cart mutation on press", async () => {
    const user = userEvent.setup();
    let receivedBody: { productId: string } | null = null;
    server.use(
      http.post("https://api.acmeshop.example/v1/cart/add", async ({ request }) => {
        receivedBody = (await request.json()) as { productId: string };
        return HttpResponse.json({ lineId: "line-1", quantity: 1 });
      }),
    );

    await renderWithProviders(<ProductCard product={FAKE_PRODUCT} />);

    const addButton = await screen.findByRole("button", { name: /add acme widget to cart/i });
    await user.press(addButton);

    // The mutation is fire-and-forget from the UI's perspective; TanStack
    // Query optimistically updates the cart store and replays the mutation
    // on reconnect. We assert MSW saw the request.
    jest.runAllTimers();
    await new Promise((r) => setImmediate(r));

    expect(receivedBody).toEqual({ productId: "prod-1" });
  });
});
```

### 7.5 Hook test — `useAddToCart`

```ts
// src/features/cart/__tests__/use-add-to-cart-mutation.test.ts
import { useAddToCartMutation } from "@/features/cart/hooks/use-add-to-cart-mutation";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { ReactNode } from "react";

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAddToCartMutation", () => {
  it("posts to /cart/add and returns the line id", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const { result } = await renderHook(() => useAddToCartMutation(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ productId: "prod-1" });
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ lineId: "line-prod-1", quantity: 1 });
    });
  });

  it("rolls back optimistic update on server error", async () => {
    server.use(
      http.post("https://api.acmeshop.example/v1/cart/add", () => {
        return HttpResponse.json({ error: "out_of_stock" }, { status: 409 });
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = await renderHook(() => useAddToCartMutation(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ productId: "prod-out" });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Rollback assertion: the optimistic cart update was undone.
    // See `./02-state-and-data.md` §5 for the onError rollback wiring.
    const cartState = queryClient.getQueryData(["cart"]);
    expect(cartState).toBeUndefined();
  });
});
```

### 7.6 Testing deep links

Deep links set the initial `useLocalSearchParams` payload. Mock it per-test:

```tsx
import * as ExpoRouter from "expo-router";

// Declared once per test file.
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

it("renders the product detail for the deep-linked id", async () => {
  jest.mocked(ExpoRouter.useLocalSearchParams).mockReturnValue({ id: "prod-1" });

  await renderWithProviders(<ProductDetailBody />);
  expect(await screen.findByText("Acme Widget")).toBeOnTheScreen();
});
```

For end-to-end deep-link testing — tapping a notification and landing on the right screen — use Maestro's `openLink` command:

```yaml
- openLink:
    link: "acmeshop://orders/ord-42"
- assertVisible: "Order ord-42"
```

### 7.7 Testing push-notification handlers

Push-notification response handlers run outside the React tree (`addNotificationResponseReceivedListener` from `./04-native-and-release.md` §3). Test them directly:

```ts
// src/features/notifications/__tests__/handle-notification-response.test.ts
import { handleNotificationResponse } from "@/features/notifications/handle-notification-response";
import { router } from "expo-router";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));

describe("handleNotificationResponse", () => {
  afterEach(() => jest.clearAllMocks());

  it("navigates to the order detail for an order-status push", () => {
    handleNotificationResponse({
      notification: {
        request: {
          content: {
            data: { kind: "order_status", orderId: "ord-42" },
          },
        },
      },
    } as unknown as Parameters<typeof handleNotificationResponse>[0]);

    expect(router.push).toHaveBeenCalledWith("/orders/ord-42");
  });
});
```

---

## Section 8: Testing — end-to-end

Unit tests cover components and hooks in isolation. End-to-end tests drive a real build on a real simulator (or device, or cloud) and assert on the user-visible behaviour. For Acme Shop the end-to-end tool is **Maestro**.

### 8.1 Maestro vs Detox — the recommendation

Maestro is the default. Detox is worth the extra complexity **only** if you meet at least one of three criteria (see §8.4). For every new Acme Shop app we write a Maestro suite first and revisit if we hit Maestro's limits.

Why Maestro wins the default slot:

- **YAML flows.** No test code; no language-specific assertion library; no brittle ElementMatchers DSL. A flow reads like a user journey.
- **Built-in flakiness tolerance.** Maestro retries taps and text inputs with an exponential backoff before failing. This kills the "simulator is slow today" class of flakes.
- **Cloud runner.** Maestro Cloud runs flows against EAS-produced builds without provisioning our own CI simulators. Pay per minute.
- **Works on physical devices.** Same flow runs on simulator (local), cloud, and a physical device (`maestro test --device <udid>`).

### 8.2 Installing Maestro

```bash
# macOS + Linux:
curl -Ls "https://get.maestro.mobile.dev" | bash
# Windows: use WSL2 (Maestro's native Windows support is experimental).

# Sanity check:
maestro --version
```

Flows live in `.maestro/` at the repo root:

```
.maestro/
├── flows/
│   ├── sign-in-and-add-to-cart.yaml
│   ├── checkout-happy-path.yaml
│   └── recover-from-offline.yaml
└── config.yaml            # optional: Maestro-wide config (e.g., custom WebDriver port)
```

### 8.3 Sign-in-and-add-to-cart flow

```yaml
# .maestro/flows/sign-in-and-add-to-cart.yaml
appId: ${APP_ID}
name: Sign in and add to cart
tags:
  - smoke
  - critical-path
env:
  TEST_USERNAME: ${TEST_USERNAME}
  TEST_PASSWORD: ${TEST_PASSWORD}
---
- launchApp:
    clearState: true
    clearKeychain: true
    arguments:
      EXPO_PUBLIC_API_BASE_URL: "https://api-preview.acmeshop.example"
      EXPO_PUBLIC_USE_MSW: "false"
- assertVisible: "Welcome to Acme Shop"
- tapOn: "Sign in"

# Login screen.
- assertVisible: "Email"
- tapOn:
    id: "email-input"
- inputText: ${TEST_USERNAME}
- hideKeyboard
- tapOn:
    id: "password-input"
- inputText: ${TEST_PASSWORD}
- hideKeyboard
- tapOn: "Sign in"

# Catalog grid. Flakiness tolerance: the grid may show a skeleton for
# up to 3s while the initial products fetch resolves.
- assertVisible:
    text: "Catalog"
    timeout: 8000
- assertVisible: "Acme Widget"

# Open the product detail and add to cart.
- tapOn: "Acme Widget"
- assertVisible: "$19.99"
- tapOn:
    text: "Add to cart"
    waitToSettleTimeoutMs: 2000

# Back to catalog, confirm cart badge updated.
- back
- assertVisible:
    id: "cart-badge"
- assertVisible:
    text: "1"
    withinViewWith:
      id: "cart-badge"

# Open cart and assert the item is there.
- tapOn:
    id: "cart-tab"
- assertVisible: "Acme Widget"
- assertVisible: "Qty: 1"
```

Two patterns worth noting:

1. **`appId: ${APP_ID}`** — parameterized so the same flow runs against both platforms. `APP_ID=com.acmeshop.preview maestro test` on Android; `APP_ID=com.acmeshop.preview maestro test` on iOS (same reverse-dns identifier).
2. **`clearState: true, clearKeychain: true`** — the flow assumes a fresh install. Without `clearKeychain`, a previous run's `tokenStore` entries persist across flows and the "Welcome" screen is skipped.

### 8.4 When Detox is worth it

Three situations justify the Detox complexity:

1. **You need to synchronize the test with specific native async state** — e.g., asserting that a background task completed before the next interaction. Detox's "synchronization" understands React Native internals (timers, bridge activity) in ways Maestro does not.
2. **You need to stub a native module at runtime** — e.g., faking `expo-location` to return a specific coordinate. Maestro has no native-side mocking; Detox's `launchApp` with an injected environment can wire a mock.
3. **You are in a legacy RN app** that already has a Detox suite of hundreds of tests. Migrating to Maestro is a separate project.

For Acme Shop we hit none of these. The cart flow does not need native sync; we mock the API via a preview EAS build pointing at a staging API; we have no legacy suite.

---

## Section 9: CI integration

The GitHub Actions workflow lives in `.github/workflows/ci.yml`. Three jobs:

1. **Static checks** on every PR — type-check, ESLint, unit tests, bundle-size ratchet.
2. **Maestro Cloud** on every PR that adds the `e2e` label (to avoid paying for Maestro minutes on every push).
3. **Release** on every tag — EAS build + EAS submit; out of scope for this section (see `./04-native-and-release.md` §7).

### 9.1 The workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  static-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install
        run: npm ci

      - name: Type-check
        run: npx tsc --noEmit

      - name: Lint
        run: npx eslint . --max-warnings=0

      - name: Unit tests
        run: npm test -- --coverage --maxWorkers=2

      - name: Export bundle for size check
        # Only on PRs; main-branch builds export during release.
        if: github.event_name == 'pull_request'
        run: npx expo export --platform ios --output-dir dist-ios

      - name: Bundle-size ratchet
        if: github.event_name == 'pull_request'
        run: node scripts/check-bundle-size.js dist-ios 5  # fail if grew >5%

  maestro-cloud:
    # Only run on PRs tagged `e2e` or pushes to main.
    if: |
      (github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'e2e')) ||
      github.event_name == 'push'
    runs-on: ubuntu-latest
    needs: [static-checks]
    steps:
      - uses: actions/checkout@v4

      - name: Install EAS CLI
        run: npm install -g eas-cli

      - name: Build preview APK on EAS (Android)
        id: eas-build
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          eas build \
            --platform android \
            --profile preview \
            --non-interactive \
            --no-wait \
            --json > build-result.json
          BUILD_ID=$(jq -r '.[0].id' build-result.json)
          echo "build-id=$BUILD_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for EAS build
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          eas build:wait --build-id=${{ steps.eas-build.outputs.build-id }}
          eas build:view ${{ steps.eas-build.outputs.build-id }} --json > build-info.json
          APK_URL=$(jq -r '.artifacts.buildUrl' build-info.json)
          curl -sL "$APK_URL" -o ./acme-shop-preview.apk

      - name: Run Maestro Cloud
        id: maestro
        uses: mobile-dev-inc/action-maestro-cloud@v2
        with:
          api-key: ${{ secrets.MAESTRO_CLOUD_API_KEY }}
          project-id: ${{ vars.MAESTRO_PROJECT_ID }}
          app-file: ./acme-shop-preview.apk
          workspace: .maestro
          android-api-level: 34
          include-tags: smoke
          env: |
            APP_ID=com.acmeshop.preview
            TEST_USERNAME=${{ secrets.MAESTRO_TEST_USERNAME }}
            TEST_PASSWORD=${{ secrets.MAESTRO_TEST_PASSWORD }}

      - name: Comment Maestro console URL on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const url = "${{ steps.maestro.outputs.MAESTRO_CLOUD_CONSOLE_URL }}";
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `Maestro Cloud results: ${url}`,
            });
```

Three design notes:

1. **Static checks run on every PR.** They are cheap and block merges fast.
2. **Maestro runs only on labelled PRs and on main.** Maestro Cloud minutes cost money; not every "fix a typo" PR needs a Maestro run.
3. **EAS build before Maestro.** The preview APK is fresh for each run, which catches "CI produces a different bundle than the local dev build" regressions. EAS caches a lot of this; a typical preview build is 4-8 minutes.

### 9.2 The bundle-size ratchet script

```js
// scripts/check-bundle-size.js
// Usage: node scripts/check-bundle-size.js <dist-dir> <max-growth-pct>
const fs = require("fs");
const path = require("path");
const https = require("https");

const [, , distDir, maxGrowthPct] = process.argv;
const maxGrowth = Number(maxGrowthPct) / 100;

function totalBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += totalBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

const currentBytes = totalBytes(distDir);

// Fetch main-branch reference size from a pinned artifact. Out of scope for
// this snippet; teams usually keep it in a Gist or S3 object.
const BASELINE_URL = process.env.BUNDLE_SIZE_BASELINE_URL;
if (!BASELINE_URL) {
  console.log(`No baseline set. Current bundle: ${currentBytes} bytes. Skipping ratchet.`);
  process.exit(0);
}

https.get(BASELINE_URL, (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    const baselineBytes = Number(body.trim());
    const delta = (currentBytes - baselineBytes) / baselineBytes;
    console.log(`Baseline: ${baselineBytes}, current: ${currentBytes}, delta: ${(delta * 100).toFixed(2)}%`);
    if (delta > maxGrowth) {
      console.error(`Bundle grew by ${(delta * 100).toFixed(2)}%, limit is ${(maxGrowth * 100).toFixed(2)}%`);
      process.exit(1);
    }
  });
});
```

Publish the new `currentBytes` to `BUNDLE_SIZE_BASELINE_URL` from the `main` branch job so subsequent PRs compare against it. A 5% threshold is generous; tighten over time.

---

## Section 10: Gotchas (perf + test)

Five gotchas that eat a day each if you have not seen them before. The full diagnostic catalogue (across all slices) lives in `./10-gotchas.md`; this is a curated perf/test-specific subset.

### 10.1 Jest says "SyntaxError: Unexpected token 'export'" on an Expo package

**Fingerprint:** `npm test` explodes on import of `expo-something` or `@shopify/flash-list` with `SyntaxError: Unexpected token 'export'`.

**Cause:** `transformIgnorePatterns` excludes that package from Babel transformation. Expo packages ship as ESM; Jest with the default `transformIgnorePatterns` does not transform anything in `node_modules`, so ESM `export` hits the raw Node runtime and blows up.

**Fix:** Add the offending package to the `transformIgnorePatterns` negative lookahead. The full list for a typical Acme Shop (reproduced from §7.1):

```json
"transformIgnorePatterns": [
  "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@shopify/flash-list|msw))"
]
```

This is the one area where `jest-expo` does not give you a clean escape — you need to maintain this list as dependencies change.

### 10.2 MSW: "The fetch mock is not installed" or "Unknown response type"

**Fingerprint:** Tests import `setupServer`, call `server.listen()`, and every request throws `MSW: Unable to intercept request` or behaves as if MSW is not there.

**Cause:** Imported from `msw/node` instead of `msw/native`. The node adapter uses Undici; the native adapter uses React Native's `fetch` polyfill chain. Undici is not available in the RN runtime and silently no-ops.

**Fix:** The single-line diff is in §7.2. Check every `from "msw/node"` in the codebase with a project-wide grep.

### 10.3 RNTL renders `null` for an expo-router screen

**Fingerprint:** `renderWithProviders(<CatalogScreen />)` produces an empty render output. `screen.debug()` shows `<></>`.

**Cause:** The screen uses `useLocalSearchParams()` or `useRouter()` from expo-router. Without an expo-router provider, those hooks return `undefined` and the screen bails out.

**Fix:** Use the `jest.mock("expo-router", ...)` block from §7.3. For tests that do not care about routing, render the underlying component, not the route file:

```tsx
// Instead of:
render(<CatalogScreen />);
// Do:
render(<CatalogScreenBody products={FAKE_PRODUCTS} />);
```

Separating the "route wrapper" from the "body" during the initial component authoring makes this trivial; retrofitting it is a 15-minute refactor.

### 10.4 Maestro flakes on iOS simulator with Rosetta

**Fingerprint:** Maestro flows succeed on Android but fail intermittently on an Apple Silicon Mac running the iOS simulator. Errors look like `element not found within timeout` on the very first tap.

**Cause:** The iOS simulator is running under Rosetta because the Mac is Apple Silicon and the Xcode install is x86_64. Maestro's WebDriverAgent build takes 3-5x longer and the first few taps miss their timeout.

**Fix:** Use an arm64 Xcode (`softwareupdate --install-rosetta --agree-to-license` is not the fix; reinstall Xcode from the App Store on Apple Silicon). Confirm with `xcrun simctl runtime list | grep arm64`.

### 10.5 FlashList silent v1→v2 footgun

**Fingerprint:** `FlashList` still renders after a v2 upgrade, but performance is worse than v1 and the type-check passes. A ts-expect-error is suppressing `estimatedItemSize`.

**Cause:** FlashList v2 removed `estimatedItemSize` but older `@types/react-native` may not flag the prop because FlashList's own types do not emit a deprecation warning. The v1 `estimatedItemSize` prop is silently ignored.

**Fix:** Delete every `estimatedItemSize`, `estimatedListSize`, `estimatedFirstItemOffset` in the codebase. Run type-check against the current `@shopify/flash-list`. See §3.4.

### 10.6 Reanimated: "Reading from `.value` on the UI thread" warning

**Fingerprint:** Yellow warning at dev time: `[Reanimated] Reading from 'value' during component render is not recommended`.

**Cause:** Reading `sharedValue.value` inside the component body (during render) instead of inside a worklet or `useAnimatedStyle`. Common when porting from `Animated`:

```tsx
// WRONG
const scale = useSharedValue(1);
return <View style={{ transform: [{ scale: scale.value }] }} />;
```

**Fix:** Route the read through `useAnimatedStyle`:

```tsx
const scale = useSharedValue(1);
const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
return <Animated.View style={animatedStyle} />;
```

### 10.7 FlatList jank from inline image dimensions

**Fingerprint:** Catalog scroll is smooth at 60 fps until the user reaches rows with newly loaded images, then drops to 20-30 fps for half a second. Jank-bar heatmap shows frame misses correlate with image loads.

**Cause:** Images without dimension hints force synchronous layout on load: the cell's height snaps from 0 to N pixels, every row below re-lays out, and the UI thread stalls. Compounded if the FlatList does not have `getItemLayout`.

**Fix:** Always set `aspectRatio` (or explicit `width`/`height`) on `expo-image` styles; see §5.4. Use FlashList for heterogeneous-height content; FlashList re-measures without the full-list relayout cost.

---

## Section 11: Verification

Verification gates for the perf/test slice:

```bash
# 1. Type-check. The single most important gate.
npx tsc --noEmit

# 2. Lint.
npx eslint . --max-warnings=0

# 3. Unit + hook tests.
npm test -- --coverage

# 4. Bundle export + size smoke.
npx expo export --platform ios --output-dir ./dist-ios
du -sh ./dist-ios/
# Per-chunk breakdown.
find ./dist-ios -name '*.js' -exec du -h {} + | sort -rh | head

# 5. Maestro local smoke. Runs against a running simulator.
APP_ID=com.acmeshop.preview \
TEST_USERNAME="$TEST_USERNAME" \
TEST_PASSWORD="$TEST_PASSWORD" \
maestro test .maestro/flows/sign-in-and-add-to-cart.yaml

# 6. Hermes sampling profiler (manual).
# a) `npx expo start` then shake to open the dev menu.
# b) Tap "Start Hermes Sampling Profiler".
# c) Do the janky interaction (scroll the catalog, animate the cart badge).
# d) Tap "Stop". The .cpuprofile drops into your project root.
# e) Open in Chrome DevTools → Performance tab.
```

For CI, #1-#4 run on every PR; #5 on labelled PRs and merge candidates; #6 is always a manual debugging tool.

---

## Further reading

- **Inside this skill:**
  - `./00-architecture.md` — Project layout and EAS profiles; the `preview` profile the Maestro flow builds against.
  - `./01-navigation.md` — expo-router route tree and deep-link patterns the tests here mock.
  - `./02-state-and-data.md` §5 — The TanStack Query optimistic-update pattern the `useAddToCart` test asserts the rollback for; the Zustand cart store that `CartBadge` reads.
  - `./04-native-and-release.md` §3 — `expo-notifications` response handler whose push-to-route logic is the hook test in §7.7.
  - `./05-cross-platform-web.md` §9 — Web-specific gotchas for `expo-image`; the web bundle exported by `expo export --platform web`.
  - `./10-gotchas.md` — Full diagnostic catalogue; §10 above is a curated perf/test-specific slice.
- **Sibling skills:**
  - `../../aws-cdk-patterns/references/01-serverless-api.md` — The backend the preview build points at; the Lambda that generates `blurhash` at ingest time.
- **External documentation:**
  - [Hermes profiler](https://reactnative.dev/docs/profile-hermes) — Canonical steps for capturing a sampling trace and opening it in Chrome DevTools.
  - [Expo — New Architecture](https://docs.expo.dev/guides/new-architecture/) — Current default status, opt-out instructions, module compatibility list.
  - [FlashList v2 migration](https://shopify.github.io/flash-list/docs/v2-migration) — The `estimatedItemSize` removal and every other v1→v2 rename.
  - [FlashList fundamentals](https://shopify.github.io/flash-list/docs/fundamentals/usage) — Current API, props, recycling model.
  - [Reanimated v3 — worklets](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/worklets) — The worklet directive, cross-thread semantics, runOnJS.
  - [Reanimated v3 — layout animations](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/layout-transitions) — `LinearTransition`, `EntryExitTransition`, and the full entering/exiting catalogue.
  - [expo-image reference](https://docs.expo.dev/versions/latest/sdk/image/) — Props, cache policies, blurhash generation, prefetch API.
  - [@testing-library/react-native v14](https://callstack.github.io/react-native-testing-library/) — Async `render`, userEvent patterns, renderHook.
  - [MSW — React Native integration](https://mswjs.io/docs/integrations/react-native) — `msw/native` setup, polyfills, conditional enablement.
  - [Maestro docs](https://docs.maestro.dev/) — YAML reference, commands (tapOn, inputText, assertVisible), environment variables.
  - [Maestro Cloud GitHub Action](https://github.com/mobile-dev-inc/action-maestro-cloud) — Action inputs, outputs, tag filtering.
