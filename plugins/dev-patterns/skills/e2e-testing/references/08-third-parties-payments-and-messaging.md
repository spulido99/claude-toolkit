# Third Parties, Payments, and Messaging

**Builds:** A suite where the payment provider, the message channel, and the assistant never run by accident. The blocking lanes block and record every request to them, and a Node-side canary catches the CORS failures that interception hides. Payments are covered in pieces (signed synthetic webhooks, a mock provider, one sandbox probe), messaging goes through a null channel by default, and every probe follows the same hygiene rules.

**When to use:** Keeping paid and third-party calls out of blocking lanes (the request guard and the CORS canary), testing a checkout or a webhook, testing a WhatsApp or SMS notification, and setting up a probe that talks to a third party.

**Prerequisites:** [01, section 1](./01-config-lanes-and-target.md) for the opt-in project wiring. [`03-auth-and-test-users.md`](./03-auth-and-test-users.md) for the QA users.

> Verified on 2026-10-14 against `@playwright/test` 1.64; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Keeping them out of the blocking lanes structurally
2. Payments
3. Messaging
4. Third-party probe hygiene

---

## Section 1: Keeping them out of the blocking lanes structurally

Three flows cost money or touch the outside world: an assistant turn (tokens), a checkout (a real purchase in the provider's sandbox), and a message send (a real phone). A rule in a README is not enough, because the next person runs `npx playwright test` with the right credentials and spends the money. The blocking lanes make the cost impossible by three layers, each catching what the previous one misses.

| Layer | What it does | Catches |
|---|---|---|
| Opt-in project in `playwright.smoke.config.ts`, absent unless an env var is set, and its files in the smoke project's `testIgnore` | A plain `playwright test` never selects the probe spec | Someone runs the whole suite |
| `guardExternalServices` in `beforeEach` | Aborts any browser request to the assistant, payment, or notifier routes and records it | A screenshot spec that clicks a button that reaches a paid service |
| `expect(attempts()).toEqual([])` in `afterEach` | Fails the test if anything tried | The abort hid the attempt and the screen still looked fine |

The first layer is configuration, owned by [01, section 1](./01-config-lanes-and-target.md). The second and third are code in `e2e/lib/guard.ts`.

### 1.1 The guard

The guard aborts and records. Every blocked request stays a visible failure, because a faked answer would make the spec pass against a feature that did not run, which is a false green. It only covers browser requests. API-level specs that use Node `fetch` (the signed webhook in section 2, the contract spec in [09, section 3](./09-llm-and-agent-flows.md)) reach `/webhooks/` and `/orders`, which are outside its patterns.

[`assets/guard.ts`](../assets/guard.ts) is the whole guard, to copy as `e2e/lib/guard.ts`. Read it when you write or change the guard; to review one or answer a question about it, this section is enough. It exports `guardExternalServices(page, apiUrl, areas)`, which takes the areas `'assistant' | 'payments' | 'notify'`, aborts every request to those API areas with `blockedbyclient`, and returns a function that lists the recorded attempts. Each area is the first path segment of the API route it blocks (`/assistant/...`, `/payments/...`, `/notify/...`). Blocking specs guard every area. The one exception is `assistant.smoke.spec.ts` in [09, section 1](./09-llm-and-agent-flows.md), which guards `['payments', 'notify']` because the assistant answering at all stays in the smoke lane; the assistant probe guards the same two areas, so opening one door does not open the others.

```ts
// e2e/screens.smoke.spec.ts (excerpt)
import { test, expect } from '@playwright/test';
import { guardExternalServices } from './lib/guard';

let attempts: () => string[];

test.beforeEach(async ({ page }) => {
  attempts = await guardExternalServices(page, process.env.API_URL!, ['assistant', 'payments', 'notify']);
});

test.afterEach(() => {
  expect(attempts(), 'no assistant, payment, or notifier request may leave the page').toEqual([]);
});
```

Register the guard in every browser spec of a blocking lane. The source-scan guard test in [10, section 1.6](./10-guard-tests.md) fails when a `*.smoke.spec.ts` file opens a page without calling `guardExternalServices`, because a new spec that forgets it is the only way the layers fail.

A screenshot spec for the paid screen opens the unlocked UI and asserts that the "Ask the assistant" button is pressable and stops there. Pressing it is the probe's job.

### 1.2 Interception hides CORS failures

Playwright's `page.route` sits between the page and the network stack. In production, every browser spec of one project enabled `page.route`, and a broken CORS preflight between the CDN origin and the API stayed green for months *(observed)*. Chromium did not enforce CORS on intercepted requests in that setup *(observed)*. The Playwright network documentation does not state this either way, so treat it as a measured behaviour, not a documented one.

The fix is a canary the interception cannot touch: a Node-side `fetch` sends the preflight in the setup project. Node has no browser, so nothing intercepts or relaxes the request.

```ts
// e2e/auth.setup.ts (excerpt)
import { test as setup } from '@playwright/test';

setup('API answers the CORS preflight for the app origin', async ({ baseURL }) => {
  const apiUrl = process.env.API_URL!;
  const origin = new URL(baseURL!).origin;
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/orders`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const allowed = response.headers.get('access-control-allow-origin');
  if (allowed !== '*' && allowed !== origin) {
    throw new Error(
      `CORS preflight to ${apiUrl} returned access-control-allow-origin=${allowed ?? '(none)'} for origin ${origin}. ` +
        'Browsers will block every call from the app. Fix the API CORS configuration.',
    );
  }
});
```

Run the canary against the lane that has a real API (the smoke lane). The cause in production was an API Gateway preflight that froze the allowed origin from a placeholder value read on the first deploy, and a later parameter change did not redeploy the API *(observed)*. A CDK synth test that pins the CORS configuration per stage belongs next to it; see [10, section 1.8](./10-guard-tests.md).

---

## Section 2: Payments

A headless browser cannot confirm a payment end to end, because confirmation arrives as a server-to-server webhook. Cover the pieces separately, cheapest first.

| Piece | Where it runs | Cost | Blocks |
|---|---|---|---|
| Server side of the webhook: signed synthetic events | Smoke lane, Node `fetch` | Free | Yes |
| Whole purchase flow with a mock provider | Smoke lane on the `dev-e2e` stack | Free | Yes |
| The signed redirect boundary | Opt-in `probe-payments` project | Free | No |
| A real purchase in the provider's sandbox | Probe lane | A sandbox purchase | No |

### 2.1 A mock provider, deployed only on request

The `dev-e2e` stack deploys a mock payment provider that auto-confirms payments through its own queue. That is how a multi-payer flow can be tested end to end on a stack no real customer touches, which is impossible against the real provider headlessly *(observed)*. The mock deploys only when the CDK context flag `-c mockPaymentsEnabled=true` is on; the environment table is in [00, section 4](./00-lanes-and-decisions.md). The flag defaults to off, so a personal stack and staging fail closed: without it the real provider's adapter is the only one wired. The synth test that pins this is in [10, section 1.8](./10-guard-tests.md).

### 2.2 Real-provider specs assert only the signed boundary

A spec in the `probe-payments` project opens checkout against the real adapter and asserts only what the app controls: the redirect URL is signed and the amount equals the payer's share, not the whole order. It does not try to pay. The project exists only when `E2E_PROBE_PAYMENTS=1` is set, and the smoke project lists the spec in `testIgnore`; the wiring is in [01, section 1](./01-config-lanes-and-target.md).

### 2.3 Signed synthetic webhooks

The server side of the integration is free to test: build an event with the provider's real payload shape and sign it with the real staging webhook secret. The signature is the HMAC-SHA256 of the raw body, hex-encoded, sent in the signature header. The CI role reads the secret from Secrets Manager.

```ts
// e2e/lib/payments.ts
import { createHmac } from 'node:crypto';

export function buildSubscriptionEvent(opts: {
  type: 'subscription_created' | 'subscription_expired';
  userId: string;
  subscriptionId: string;
}) {
  return JSON.stringify({
    meta: { event_name: opts.type, test_mode: true, custom_data: { user_id: opts.userId } },
    data: { id: opts.subscriptionId, attributes: { status: opts.type === 'subscription_created' ? 'active' : 'expired', variant_name: 'monthly' } },
  });
}

export function sign(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}
```

[`assets/subscription-webhook.smoke.spec.ts`](../assets/subscription-webhook.smoke.spec.ts) is the whole spec, to copy as `e2e/subscription-webhook.smoke.spec.ts`. Read it when you write or change the webhook spec; to review one or answer a question about it, this section is enough. It has two tests. The first sends a body signed with a wrong secret and asserts a 401 and that the user's plan is still `free`. The second sends a signed `subscription_created` event, polls until the plan is `premium` (30 s, polling at 1 s and then 2 s), then sends a signed `subscription_expired` event and polls until the plan is `free` again. The expired event reuses the created event's subscription id on purpose:

```ts
  // Same subscription id on purpose: a lifecycle shares one id, and a store that
  // dedupes by id would drop this event and leave the user premium.
  const expired = buildSubscriptionEvent({ type: 'subscription_expired', userId: user.id, subscriptionId });
  expect((await post(expired, sign(expired, secret))).status).toBe(200);
  await expect.poll(() => getPlan(user), { timeout: 30_000, intervals: [1_000, 2_000] }).toBe('free');
```

Three rules come from incidents. Use a unique subscription id per run, because the same id across runs hits the store's idempotency. Send the expired event with the same id as the created event, because an idempotency key built on the subscription id discarded every later event of a lifecycle, and cancellations silently left users premium *(observed)*. The server fix keyed on a hash of the raw body, and the spec is the sentinel for it. Make the last test return the user to free, so the next run's screenshots of the free plan start clean.

Reading the webhook secret also exposes the provider's API key if both live in one secret. Split them in Secrets Manager, or accept the risk in writing when the staging account is permanently in the provider's test mode.

### 2.4 The real sandbox probe

The probe buys once in the provider's sandbox and proves the real webhook reaches staging. It is the most brittle test in the suite, because it drives a third party's page. Every rule below comes from an incident *(observed)*.

- **Open the checkout in a clean browser context.** Click the app's button, wait for the popup with `Promise.all([context.waitForEvent('page'), page.waitForResponse(...), click])`, assert the popup URL is the provider's domain, then close it and open `browser.newContext({ ...devices['Pixel 7'], locale: 'en-US' })` with the original signed checkout URL from the API response. In the app's context the provider accepted the form and never processed the payment, because of the opener relation and the interception; the same steps on an isolated page completed every time.
- **Pin the locale.** The provider localises its checkout from the browser language. `locale: 'en-US'` keeps labels stable.
- **Freeze the selector recipe.** The sandbox's card fields live in the payment processor's iframes. Scan all frames and take the first visible match, retrying (about 40 attempts, 500 ms apart). A broader selector (every `autocomplete="cc-*"` input) also matched hidden duplicate fields in the wallet and saved-card iframes. Filling those left the form looking complete while Pay silently did nothing. The comment above the recipe says "do not broaden these".
- **Use the provider's documented test card and its own stable test hooks** (the `data-*` attributes it publishes for tests), not text selectors.
- **Keep the settle wait and document it.** The payment element renders late and re-renders as it settles. Interacting before a flat 8 s wait left its confirm state broken: the form looked perfect, Pay was enabled, and the click was ignored. Write `// intentional settle, do not remove: the element re-renders` next to the `waitForTimeout`. Pick the Card tab explicitly when wallet tiles steal the default selection in headless Chromium. Choose the state from a typeahead by clicking the option; pressing Enter while it shows "Loading..." cancels the choice.
- **Assert on backend state, not on the thank-you text.** The real webhook can take minutes. Poll the plan: `expect.poll(() => getPlan(user), { timeout: 240_000, intervals: [2_000, 5_000] }).toBe('premium')`, then assert the plan name, the status, and that the stored subscription id is the provider's real numeric id, which distinguishes it from the synthetic `e2e-*` ids. Keep the thank-you text wait soft (`.catch(() => {})`), since it is localised.
- **Budget the test at about 8 minutes** (`test.setTimeout(480_000)`), with 60 s for the checkout response and 30 s for the popup URL.
- **Clean up in `beforeAll` and `afterAll`.** Cancel the subscription at the provider (`DELETE` on its API; a 404 counts as clean) and send a synthetic signed `subscription_expired` to your webhook. Run the same normalisation in the setup project of every other lane ([04, section 1.5](./04-test-data.md)), so a crashed probe cannot leave the QA user premium and break the next suite's free-plan assertions.

---

## Section 3: Messaging

A message send reaches a real phone, so the default is a null channel. On any stack deployed without the notifier flag, the adapter writes `channel off` to the log, marks the message as sent, and the flow completes. Specs assert the app's state (the order ends `SENT`) rather than delivery.

The real send is a manual dispatch input. `workflow_dispatch` takes `notifier_real` (boolean, default false) and `notification_phone`. Only when the input is on does the workflow deploy the stack with `-c notifierEnabled=true`, and the e2e job runs only the one spec that sends (selected with an `E2E_SPEC` env var). The next push redeploys the stack without the flag. Without this gate every merge sends about seven messages to the test phone *(observed)*.

```yaml
on:
  workflow_dispatch:
    inputs:
      notifier_real:
        description: 'Deploy with the real WhatsApp/SMS notifier and run only the order-confirmation spec'
        type: boolean
        default: false
      notification_phone:
        description: 'Phone that receives the real message (E.164)'
        type: string
        required: false
```

Playwright cannot read the phone, so the evidence for a real send has two parts that must show the same order and time: the dispatch log line with the provider message id (for example `[notifier] sent messageId=... orderId=...`), and a screenshot of the receiving phone. The message id in the log is what tells the real adapter apart from the null channel. Store both under `docs/evidence/<ticket>-<slug>/`; the convention is in [12, section 1](./12-proving-a-fix.md).

A guard test on the workflow pins that the default input is `false` and that the deploy step passes the flag only when the input is true.

---

## Section 4: Third-party probe hygiene

- **One retry, then the alert.** Set `retries: process.env.CI ? 1 : 0` on any probe project that costs money or talks to a third party, with the reason beside the number; the rule is in [00, section 6](./00-lanes-and-decisions.md). The blocking suite's retries of 2 would mean up to three real purchases per run *(observed)*. After the retry, the workflow creates or comments on one open issue per label and closes it on the next green run; see [06, section 6](./06-ci-workflows.md).
- **One verdict file per probe.** The assistant probe writes `ai-status.json` and the checkout probe writes its own file, so re-running one cannot overwrite the other. See [07, section 3](./07-release-gate.md).
- **Share the concurrency group with anything that resets the same users.** Probes that reset the same QA users use the concurrency group of the stack they reset, with the reason and the rule in [06, section 4](./06-ci-workflows.md).
- **Tell the people who deploy about timing.** A probe that starts after the staging deploy writes its verdict minutes later. Tagging a release right after a deploy can block on a verdict that does not exist yet. The reason and the wait message are in [07, section 7](./07-release-gate.md).
- **Run on deploy, not on a schedule, only if you accept the gap.** Probes triggered by the staging deploy never notice a third party that breaks between deploys. Add a cron trigger on the probe workflow when that gap matters.
- **Tell a skipped probe job from a failed probe.** Probe workflows run only when the deploy succeeded. If the blocking suite fails, the probes skip and the release lacks its probe verdict, which blocks correctly, but the message says "never ran", not "the suite failed". Read the run list before concluding a probe is broken.

---

## Verification

```bash
# The local lane and the smoke lane must not select any probe without its env var
npx playwright test --config e2e/playwright.config.ts --list | grep -c "probe"        # must print 0
SMOKE_URL=https://smoke.example.test npx playwright test --config e2e/playwright.smoke.config.ts --list | grep -c "probe"   # must print 0

# The guard and webhook tests
npx playwright test --config e2e/playwright.smoke.config.ts --project=smoke e2e/subscription-webhook.smoke.spec.ts

# The source-scan and config guard tests (run by the normal CI test command)
npm test -w shared
```

### Test checklist, one per mechanical rule

| Rule | Check |
|---|---|
| A plain `playwright test` selects no probe spec | Config guard test imports both configs and asserts the smoke project's `testIgnore` matches every probe file, and that `probe-llm` and `probe-payments` exist only when `E2E_PROBE_LLM` or `E2E_PROBE_PAYMENTS` is set (see [01, section 1](./01-config-lanes-and-target.md)) |
| Every browser spec of a blocking lane registers the guard and asserts it empty | Source-scan guard test over `e2e/*.smoke.spec.ts`: each file that opens a `page` calls `guardExternalServices` and `expect(attempts()).toEqual([])` |
| Nothing in a blocking lane reaches the assistant, payment, or notifier routes | `afterEach` assertion on `attempts()` |
| The CORS preflight works for the app origin, outside any interception | Node-side `OPTIONS` canary in the setup project |
| The mock payment provider deploys only with the flag | CDK synth test: no mock resources without `-c mockPaymentsEnabled=true` |
| Webhook signatures are verified | `subscription-webhook.smoke.spec.ts` tampered-signature case returns 401 |
| The real notifier deploys only on request | Workflow guard test: `notifier_real` defaults to `false` and gates the deploy flag |
| Probes retry at most once in CI | Config guard test asserts `retries` of the `probe-llm` and `probe-payments` projects |
| Probes share the deploy's concurrency group | Workflow guard test compares the `concurrency.group` values |

## Further reading

- [04, section 1.5](./04-test-data.md) for restoring third-party state in setup.
- [09, section 1](./09-llm-and-agent-flows.md) for the assistant in the smoke lane, which relies on the guard in section 1 of this file.
- Playwright: https://playwright.dev/docs/network, https://playwright.dev/docs/test-projects
