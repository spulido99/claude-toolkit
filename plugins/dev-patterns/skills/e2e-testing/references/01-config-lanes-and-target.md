# Config for Lanes and Target

**Builds:** The Playwright configs of an `e2e/` folder with one config per lane: a local config that serves the built web export on a per-run port, a smoke config that fails closed when it has no deployed URL, opt-in probe projects that a plain `playwright test` can never reach, a setup project, and a way to find the backend addresses in the built bundle.

**When to use:** Creating `playwright.config.ts` or `playwright.smoke.config.ts` for each lane, adding an opt-in probe project, adding a setup project, resolving `baseURL` from the deploy outputs, configuring the local `webServer`, finding backend addresses in the built bundle, or debugging a run that targeted the wrong environment.

**Prerequisites:** None.

> Verified on 2026-10-14 against `@playwright/test` 1.64 and Node 22; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. One config per lane, and opt-in probe projects
2. `baseURL` fails closed
3. Local lane `webServer`
4. Discovering the deployed backend from the bundle

---

## Section 1: One config per lane, and opt-in probe projects

The `e2e/` folder of `acme` holds several kinds of files, and each kind is picked up by exactly one config.

| File pattern | Lane | Config | Command |
|---|---|---|---|
| `*.spec.ts` | local lane | `playwright.config.ts` | `npm run test:e2e` |
| `*.smoke.spec.ts` | smoke lane | `playwright.smoke.config.ts` | `npm run test:smoke` |
| `*.probe.spec.ts` | probe lanes | `playwright.smoke.config.ts`, only when an env var is set | `npm run test:probe:llm` |
| `*.setup.ts` | setup | `auth.setup.ts` goes to the `setup` project and `premium.setup.ts` to the `setup-premium` project, both in `playwright.smoke.config.ts` and both running before the smoke project | runs as a dependency of `npm run test:smoke` |
| helpers | none | not matched by any `testMatch` | imported by specs |

Use a file suffix to separate the lanes, so the config can match by pattern and a new spec lands in the right lane just by its name. The local config ignores the suffixes it does not own, and the smoke config matches only its own.

The two configs differ in what they target, so keep them as two files. Playwright can also run both as projects of one config; this works when the local lane and the smoke lane share the same `use` options, but each project then needs its own `baseURL`, and the `webServer` of the local lane starts even for a smoke run. Two files avoid that.

### 1.1 The local config

[`assets/playwright.config.ts`](../assets/playwright.config.ts) is the whole local config, to copy as `e2e/playwright.config.ts`. It holds the local lane only and has no probe projects. Read it when you write or change the config; to review one or answer a question about it, this section is enough.

The local project matches `**/*.spec.ts` and lists `**/*.smoke.spec.ts` and `**/*.probe.spec.ts` in `testIgnore`, because the `*.spec.ts` pattern would otherwise match both. A plain `playwright test` with the local config can then never reach a paid or deployed spec.

### 1.2 Probe projects in the smoke config

The probe projects live in `e2e/playwright.smoke.config.ts`, because a probe runs against the deployed stack. Each one exists only when its env var is set, and the smoke project lists the probe files in `testIgnore`:

```ts
// e2e/playwright.smoke.config.ts (excerpt)
const probeProjects = [
  ...(process.env.E2E_PROBE_LLM
    ? [{
        name: 'probe-llm',
        testMatch: /assistant-analysis\.probe\.spec\.ts$/,
        retries: process.env.CI ? 1 : 0, // each retry costs one real model call, see 00, section 6
        dependencies: ['setup-premium'],
        use: { ...devices['Pixel 7'], storageState: '.auth/premium-state.json' },
      }]
    : []),
  ...(process.env.E2E_PROBE_PAYMENTS
    ? [{
        name: 'probe-payments',
        testMatch: /payments\.probe\.spec\.ts$/,
        retries: process.env.CI ? 1 : 0, // a sandbox purchase per attempt, see 00, section 6
        use: { ...devices['Pixel 7'] },
      }]
    : []),
];
// ...
projects: [
  { name: 'setup', testMatch: /auth\.setup\.ts$/ },
  { name: 'setup-premium', testMatch: /premium\.setup\.ts$/, dependencies: ['setup'] },
  {
    name: 'smoke',
    testMatch: '**/*.smoke.spec.ts',
    testIgnore: ['**/*.probe.spec.ts'],
    dependencies: ['setup', 'setup-premium'],
  },
  ...probeProjects,
],
```

The retry numbers and their reasons are in [00, section 6](./00-lanes-and-decisions.md).

Two things make a probe unreachable by accident. The probe project exists only when its env var is set, and the smoke project lists the probe files in `testIgnore`. Both are needed: without the second, the smoke project would also match a probe file through a broad pattern, and a plain smoke run would spend model tokens. A third line of defence, the route guard that aborts the paid request, is in [08, section 1](./08-third-parties-payments-and-messaging.md).

Messaging has no Playwright opt-in. Real messages need the deploy flag `notifierEnabled` ([08, section 3](./08-third-parties-payments-and-messaging.md)), so no env var and no tag turns them on from the test side.

### 1.3 Tag-based opt-in

When a probe lives inside a file that also holds free tests, tag the `describe` title and exclude the tag by default with `grepInvert`. The payments probe uses this when its checkout test shares setup with free tests: the tag `@real-payments` is excluded unless `E2E_PROBE_PAYMENTS` is set, so turning on the payment sandbox does not turn on anything else.

```ts
// e2e/playwright.smoke.config.ts (excerpt)
export default defineConfig({
  // ...
  grepInvert: process.env.E2E_PROBE_PAYMENTS ? undefined : /@real-payments/,
});
```

Prefer a separate `*.probe.spec.ts` file and the project approach in section 1.2 when you can, because a file-level exclusion cannot be defeated by a forgotten tag. Use tags when the probe shares setup with free tests in the same `describe`.

### 1.4 Setup projects

A setup project runs once before the projects that depend on it, and writes state those projects read. Login lives here (see [03, section 2](./03-auth-and-test-users.md)).

```ts
// e2e/playwright.smoke.config.ts (excerpt)
projects: [
  {
    name: 'setup',
    testMatch: /auth\.setup\.ts$/,
    timeout: 120_000, // provisioning calls cold Lambdas
  },
  { name: 'setup-premium', testMatch: /premium\.setup\.ts$/, dependencies: ['setup'], timeout: 120_000 },
  {
    name: 'smoke',
    testMatch: '**/*.smoke.spec.ts',
    testIgnore: ['**/*.probe.spec.ts'],
    dependencies: ['setup', 'setup-premium'],
    use: { ...devices['Pixel 7'], storageState: '.auth/state.json' },
  },
],
```

The `setup-premium` project depends on `setup`, so the free session exists when the premium login runs ([03, section 3.3](./03-auth-and-test-users.md)). A spec that needs no login overrides the state with `test.use({ storageState: { cookies: [], origins: [] } })`.

---

## Section 2: `baseURL` fails closed

The smoke config resolves its URL in this order: the `SMOKE_URL` env var, then the CDK `--outputs-file` JSON, then a thrown error that says how to fix it. There is no hardcoded default URL.

Reasons, each one an incident:
- A stale default URL once made the smoke lane skip itself against a dead distribution, with the message "this deploy has no backend" *(observed)*. Failing at startup is better than starting against the wrong environment.
- Another project had a default that pointed at a different environment, and the suite went green without testing the new commit *(observed)*.

### 2.1 The resolver

Put the logic in a pure function so a unit test can call it with fake inputs.

[`assets/target.ts`](../assets/target.ts) is the whole resolver, to copy as `e2e/lib/target.ts`. Read it when you write or change the resolver; to review one or answer a question about it, this section is enough.

The resolver treats an empty `SMOKE_URL` as unset, because `vars.SMOKE_URL || ''` in GitHub Actions yields `""` and `??` does not fall back on `""`. It reads `AppUrl` from the output of the stack whose name starts with `Acme-Frontend-`. The outputs file path is optional: by default the resolver builds `infra/cdk-outputs-frontend.json` from its own file location, so the smoke works from the repository root and from inside `e2e/`; a test passes its own path.

The config calls it once:

```ts
// e2e/playwright.smoke.config.ts (excerpt)
import { resolveSmokeUrl } from './lib/target';

const baseURL = resolveSmokeUrl({ env: process.env });
// The resolver reads infra/cdk-outputs-frontend.json by a path built from its own file location
// (path.resolve(__dirname, '..', '..', 'infra', ...)), so a run from the repository root or from e2e/ finds the same file.
```

Use `||` or an explicit empty-string check when you read env vars that CI may set to an empty string, because `??` does not fall back on `""`.

### 2.2 Resolve in CI, not in `globalSetup`

Resolve the URL in a workflow step before Playwright starts, and pass it as an env var. The step that derives `SMOKE_URL` from `infra/cdk-outputs-frontend.json` is in [06, section 1.4](./06-ci-workflows.md); this file does not repeat it.

Set the URL before Playwright starts instead of retargeting `use.baseURL` from `globalSetup`. Whether a change that `globalSetup` makes to `process.env` reaches the config that each worker loads is an implementation detail of Playwright; one project treated it as unsafe after a near miss *(observed)*. A value set before the process starts is always visible.

### 2.3 Test the resolver

[`assets/target.test.ts`](../assets/target.test.ts) is the whole test file, a Vitest file to copy as `shared/test/target.test.ts`, so `npm test -w shared` runs it. Read it when you write or change the test; to review one or answer a question about it, this section is enough.

It has four cases: the env var wins over the outputs file; an empty `SMOKE_URL` counts as unset and does not become the target; `AppUrl` of the frontend stack is read from the CDK outputs file; and nothing resolving throws with instructions that mention `SMOKE_URL`.

---

## Section 3: Local lane `webServer`

The local lane serves the built export with a static server (`expo serve` for an Expo web export, `vite preview` for a Vite SPA), because Metro and Vite dev servers do not reproduce what CloudFront and S3 do (see [00, section 2](./00-lanes-and-decisions.md)).

The `webServer` block of the local config sets three things:

```ts
webServer: {
  command: 'npm run serve:web -w @acme/web',
  url: baseURL,
  reuseExistingServer: false,
  timeout: 60_000,
},
```

- `reuseExistingServer: false`. With `true`, Playwright reuses any server already listening on the port, which may be a server started from an older build. With `false`, Playwright throws when a process already listens on the port or URL, so the lane tests the export you just built or fails loudly. Playwright's docs recommend `!process.env.CI` for local development; this lane picks `false` everywhere because the stale build is the failure it exists to catch.
- `timeout: 60_000`, which is Playwright's default startup wait, written out so a slow server start has a visible number to raise.
- `url` instead of the deprecated `port`, so Playwright waits for a real response (2xx, 3xx, 400, 401, 402, or 403).

### 3.1 A port per run

```ts
const port = Number(process.env.E2E_PORT ?? 8788 + (process.pid % 200));
process.env.E2E_PORT = String(port);
```

A fixed port collided when several agents ran the local lane in parallel git worktrees: the port is machine-wide, but each worktree has its own `dist/`. The second run failed on the port collision, not on the code, and that failure held back a correct change *(observed)*.

Export the chosen port back to `process.env` for two reasons. The `webServer.command` reads it (`expo serve --port ${E2E_PORT:-8788}`). And Playwright loads the config again inside each worker process, where `process.pid` is different; the worker would compute another port if it did not find `E2E_PORT` already set, which it does because workers inherit the environment of the main process.

Pass the port through an env var that both the start script and the config read, so the two always agree on it.

---

## Section 4: Discovering the deployed backend from the bundle

The smoke lane needs to call the backend directly sometimes (the runtime, a health route). Reading the addresses from the built bundle, instead of from config, does two jobs: no resource id is hard-coded in the specs, and the lookup proves the build baked the backend addresses in. A bundle built without them (for example, a plain `npm run build` that skipped the stack outputs) is silently broken, and this lookup fails on it *(observed)*.

[`assets/backend-from-bundle.ts`](../assets/backend-from-bundle.ts) is the whole helper, to copy as `e2e/lib/backend-from-bundle.ts`. Read it when you write or change the helper; to review one or answer a question about it, this section is enough.

The helper has two functions. `discoverBackend` downloads the HTML of the app, finds the script path with this line, downloads the bundle, and extracts the runtime ARN and the `execute-api` URLs, throwing when either is missing:

```ts
const scriptPath = html.match(/src="([^"]*\/static\/js\/[^"]+\.js)"/)?.[1];
```

`apiOf` maps each API to its service by asking `/health`, so specs never guess which URL is which.

Check the bundle path pattern for your framework: an Expo web export writes `/_expo/static/js/...`, a Vite build writes `/assets/index-<hash>.js`. A direct call to the runtime from the smoke needs the runtime session id and the bearer token; the CLI form of the runtime smoke is in [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md), section 7.

A direct runtime spec asserts two status codes without a UI: no token returns 401 (the JWT authorizer), a valid customer token returns 200 with a reply of type `turn`. It also asserts that routes removed from the API return 404: "there is no route", which differs from "the route is closed" *(observed)*.

---

## Verification

```bash
# the configs load and list tests without running them
npx playwright test --config e2e/playwright.config.ts --list
SMOKE_URL=https://smoke.example.test npx playwright test --config e2e/playwright.smoke.config.ts --list

# the smoke config refuses to start without a target
env -u SMOKE_URL npx playwright test --config e2e/playwright.smoke.config.ts --list   # must exit non-zero with "No smoke target"

# a plain run lists no probe test
npx playwright test --config e2e/playwright.config.ts --list | grep -c "probe"        # must print 0
SMOKE_URL=https://smoke.example.test npx playwright test --config e2e/playwright.smoke.config.ts --list | grep -c "probe"   # must print 0

# guard test
npx vitest run shared/test/target.test.ts
```

Test checklist, one per mechanical rule:

- [ ] `shared/test/target.test.ts`: environment variable wins; an empty string counts as unset; outputs file is read; nothing resolves, so it throws with instructions.
- [ ] A test or CI step that lists tests with no opt-in variables set, in both configs, and finds no `*.probe.spec.ts` (the `grep -c` above).
- [ ] A setup assertion or CI step that fails when `SMOKE_URL` resolves to `null` or an empty string (the workflow step in [06, section 1.4](./06-ci-workflows.md)).

## Further reading

- [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md): `--outputs-file` and `stackSuffix`.
- [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md): the CLI runtime smoke.
- Playwright test configuration: https://playwright.dev/docs/test-configuration
- Playwright `webServer`: https://playwright.dev/docs/test-webserver
- Playwright `TestConfig` reference: https://playwright.dev/docs/api/class-testconfig
