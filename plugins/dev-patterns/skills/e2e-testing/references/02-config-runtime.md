# Config Runtime Settings

**Builds:** The runtime settings of the Playwright configs: a pinned worker count, timeouts taken from measurements, reporters that always leave evidence, a mobile browser profile, a typecheck of `e2e/` that runs before the deploy, and an exact Playwright version.

**When to use:** Changing workers or timeouts, choosing reporters and artifact options, setting browser and device options, finding out why a type error in `e2e/` only showed up in the deployed smoke, or pinning the Playwright version.

**Prerequisites:** [`01-config-lanes-and-target.md`](./01-config-lanes-and-target.md) for the configs these settings go into.

> Verified on 2026-10-14 against `@playwright/test` 1.64 and Node 22; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Parallelism
2. Timeouts
3. Reporters and artifacts
4. Browser and device
5. Typechecking `e2e/`
6. Version pinning

---

## Section 1: Parallelism

Playwright's default for `workers` is half of the logical CPU cores, on a laptop and on CI alike. The common line `workers: process.env.CI ? 1 : undefined` comes from the generated config template; it is a choice, not a default. State the number you want in every config, so a change of runner size cannot change how your tests interact.

`fullyParallel: false` (the default) runs the tests inside one file in order, but different files still run in parallel across workers. To run everything one after another, set `workers: 1`.

| Situation | Setting | Reason |
|---|---|---|
| Spec files share fixtures: seed tables, one QA user, a shared console queue | `workers: 1`, `fullyParallel: false` | Parallel flows would change the data another spec is photographing, and seeding in parallel throttled Lambdas on a new account *(observed)*. With one worker, files run in alphabetical order, so numeric prefixes (`01-screens`, `02-flows`) give a stable order. |
| Each spec seeds its own data and looks only at its own data | A measured ceiling, for example `workers: 4` | The ceiling protects Cognito and the provider sandbox from many simultaneous real sign-ups. Going from one worker to four took a smoke lane from 12.5 minutes to roughly the length of its longest script *(observed)*. |

### 1.1 Pin the worker count with a guard test

A worker count that can drift silently is a performance and isolation setting nobody reviews. [10, section 1.4](./10-guard-tests.md) pins the number: it imports the smoke config with the URL stubbed and asserts the agreed worker count. If you set `workers: 1` because specs share fixtures, the same test pins `1`, so a well-meant speed-up does not make the specs corrupt each other.

---

## Section 2: Timeouts

Playwright's defaults are 30 s per test and 5 s per `expect`. `actionTimeout` and `navigationTimeout` default to 0, meaning no limit other than the test timeout. Raise a budget only from a measurement, and set it to about three times the measured duration.

Example: a registration journey does three real Cognito sign-ups on cold Lambdas. It measured 35-45 s *(observed)*. With the default 30 s the test died on its total budget even though every step was healthy. The smoke config sets `timeout: 120_000`, three times the measurement.

```ts
// e2e/playwright.smoke.config.ts (excerpt)
export default defineConfig({
  timeout: 120_000, // 3x the measured 35-45 s of the sign-up journey
  expect: { timeout: 10_000 },
  workers: 4,
  // ...
});
```

| Level | Where | Use |
|---|---|---|
| Test | `timeout` in config | One default for the lane, from the typical journey |
| Long script | `test.setTimeout(240_000)` at the top of the test | Scripts with a known long wait; write the measured wait in a comment next to the number |
| Setup project | `timeout` on the project | Provisioning calls cold Lambdas; 120 s was used *(observed)* |
| Assertion | `expect(...).toBeVisible({ timeout: 20_000 })` | The first assertion after navigation |
| Backend wait | `expect.poll(...)` or `toPass({ timeout })` | See [05, section 2](./05-multi-user-waits-and-time.md) |

Give the first assertion after a navigation a longer timeout (20 s was used *(observed)*). That is the one that waits for a cold Lambda behind the first API call and for the single-page app to boot. Later assertions in the same screen can keep the shorter default.

Two other limits matter when you pick a number:
- API Gateway cuts a response at about 29 s, so a UI waiting on one request longer than that sees a 504 (see [09, section 1](./09-llm-and-agent-flows.md)).
- A GitHub Actions job needs its own `timeout-minutes` above the sum of the longest scripts divided by workers (see [06, section 8](./06-ci-workflows.md)).

---

## Section 3: Reporters and artifacts

The CI reporter list is `[['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]`. If you set `reporter` yourself, Playwright's default (`dot` on CI, `list` elsewhere) no longer applies.

| Reporter | Why it is there |
|---|---|
| `github` | Puts failures as annotations on the pull request and the run summary |
| `list` | One line per test in the job log, so a failure is readable without opening an artifact |
| `html` with `open: 'never'` and `outputFolder: 'playwright-report'` | Creates `playwright-report/`, which the artifact upload and the release gate need. Without it, the upload step finds no files and no run leaves inspectable evidence. `open: 'never'` stops it from launching a browser on a failure (the default is `'on-failure'`, which hangs a headless runner). |

One project that configured only the HTML reporter had almost nothing in its Actions logs when a test failed *(observed)*. Keep `list` next to it.

### 3.1 Artifact options

| Option | Value | Playwright default | Reason |
|---|---|---|---|
| `trace` | `'retain-on-failure'`, or `'on-first-retry'` when `retries > 0` | `'off'` | With `retries: 0`, `'on-first-retry'` never records anything, so the first lane uses `'retain-on-failure'` |
| `screenshot` | `'only-on-failure'` | `'off'` | The failure screen is the first thing a reviewer looks at |
| `video` | `'retain-on-failure'`, only for lanes where traces are not enough | `'off'` | Videos are large; most projects found traces enough *(observed)* |
| `outputDir` | `'.test-results'` | `test-results` next to `package.json` | Keep it outside the folder where your own step photos go ([11, section 2](./11-skipped-scripts-and-photos.md)), so a flow named `test-results` cannot collide with it |
| `forbidOnly` | `!!process.env.CI` | not set | A committed `test.only` would silently run one test and report green |

Set `outputFolder` explicitly because, when it is not set, Playwright writes the HTML report next to the nearest `package.json` above the config, and `e2e/` is usually not a workspace, so the report would land in the repository root. A relative `outputFolder` resolves from the config's folder, so the report lands in `e2e/playwright-report/`, where the upload steps look. The same holds for `outputDir`: a relative value resolves from the config's folder.

Add `.test-results/`, `playwright-report/`, and `.auth/` to the `.gitignore` of `e2e/`.

---

## Section 4: Browser and device

### 4.1 A phone, not a desktop

Playwright's default browser profile is Desktop Chrome at 1280x720. For a mobile-first app that is a layout no customer uses, so a suite on it passes screens the customer never sees. Use `devices['Pixel 7']` (a 412x915 touch device) as the base for the customer lanes.

The operator console is a desktop tool. Override the viewport per file:

```ts
// e2e/console-queue.spec.ts
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } }); // the three-column desk does not fit a phone

test('the queue lists open orders', async ({ page }) => { /* ... */ });
```

A context you create yourself with `browser.newContext()` inside a test inherits the options of the `use` section, according to the Playwright docs. Pass `viewport` explicitly anyway when a spec opens several contexts of different sizes (a phone and a desktop console), so each size is visible in the spec and does not depend on what the context inherits; one project saw a hand-made context ignore the file's `test.use` viewport *(observed)*:

```ts
const operator = await browser.newContext({ viewport: { width: 1440, height: 900 } });
```

### 4.2 Option reference

| Option | Value | Reason |
|---|---|---|
| `timezoneId` | `'UTC'` | The app reads "today" in the browser's time zone, while fixtures seed dates in UTC. These agree on a UTC runner and disagree on a laptop west of Greenwich during the evening, so the suite was green in CI and red on a laptop *(observed)*. Pinning the browser makes every machine read the same |
| `serviceWorkers` | `'block'` (Playwright default `'allow'`) | The service worker of a PWA serves cached assets of the previous deploy, so a smoke run would test the old build |
| `locale` | `'en-US'` on probes that open a third-party page | A payment page localizes itself from the browser language; pin it so selectors stay stable. The default is `en-US`, but the machine may override it, so a probe states it |
| `permissions` | `['camera']` | Needed for flows that open `getUserMedia` |
| `launchOptions.args` | `['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']` | The first flag gives a synthetic camera stream, the second answers the permission prompt. Without them a CI runner has no camera and the flow fails before the code under test |
| Browser | Chromium only | One engine keeps the runs short. CI installs it with `npx playwright install --with-deps chromium` |

Camera flags live in `use` for the whole lane:

```ts
use: {
  ...devices['Pixel 7'],
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
},
```

A test of the "camera denied" path overrides the lane with `test.use({ permissions: [] })` and replaces `navigator.mediaDevices.getUserMedia` through `page.addInitScript`.

---

## Section 5: Typechecking `e2e/`

Playwright transpiles TypeScript without typechecking it. The `e2e/` folder is often not an npm workspace, so the root `typecheck` script never visits it. In one project a seeding helper kept an old function signature, and the error showed up as a 401 inside the deployed smoke, minutes after the deploy *(observed)*.

Three parts close this gap.

### 5.1 A tsconfig for `e2e/`

```json
// e2e/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", ".auth", ".test-results", "artifacts"]
}
```

### 5.2 The root script includes it

```json
{
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present && tsc -p e2e/tsconfig.json"
  }
}
```

### 5.3 A guard test that checks the check

The root script can lose the `e2e` part in a refactor, and the `include` can stop matching new files. The test pins both.

The guard test is in [10, section 1.5](./10-guard-tests.md). The `scripts/` folder is not typechecked either, because it is not a workspace that the root `typecheck` visits. Run the `setup` project in the pull request that changes authentication, because a dangling reference after an auth migration crashes setup with a `ReferenceError` or surfaces as a 401 in the deployed smoke.

---

## Section 6: Version pinning

Pin `@playwright/test` to an exact version, or rely on the committed lockfile and install with `npm ci`. A caret range lets a fresh install pick a newer Playwright than the browsers cached on the runner expect, and a minor release can change defaults.

```bash
npm install --save-exact --save-dev @playwright/test@1.64.0
```

Install the browsers after `npm ci`, with the matching CLI, so the browser build and the library agree:

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
```

`--with-deps` installs the operating-system libraries Chromium needs on a fresh runner. Include the Playwright version in the key of any cache of `~/.cache/ms-playwright`.

A guard test keeps the pin from drifting; it is in [10, section 1.4](./10-guard-tests.md).

---

## Verification

```bash
# guard tests
npm test -w shared
```

Test checklist, one per mechanical rule:

- [ ] The `workers` test of [10, section 1.4](./10-guard-tests.md): `workers` equals the agreed number.
- [ ] The typecheck test of [10, section 1.5](./10-guard-tests.md): the root script mentions `e2e/tsconfig.json`, every `.ts` file is covered, and `tsc` output is empty.
- [ ] The pin test of [10, section 1.4](./10-guard-tests.md): `@playwright/test` has an exact version.

## Further reading

- Playwright parallelism: https://playwright.dev/docs/test-parallel
- Playwright `TestConfig` reference: https://playwright.dev/docs/api/class-testconfig
- Playwright `TestOptions` reference: https://playwright.dev/docs/api/class-testoptions
