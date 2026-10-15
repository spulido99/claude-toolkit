# Multi-User Flows, Waits, and Time

**Builds:** A suite that models each person in a flow with their own browser context, waits for the backend with a condition instead of a sleep, controls the clock, and counts how often a race goes wrong across many rounds. Each rule has a check that fails when the rule is broken.

**When to use:** Modelling two phones or an operator console next to a customer, waiting for eventual consistency, using `page.clock` or fixing a date that went stale, measuring a race with a counter, or fixing a test that shows an empty queue row or fails in strict mode.

**Prerequisites:** [04, section 2](./04-test-data.md) for `resetLocker()` and [03, section 2](./03-auth-and-test-users.md) for `openConsole`.

> Verified on 2026-10-14 against `@playwright/test` 1.64 and Node 22; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. One browser context per person
2. Waiting for the backend
3. Time
4. Race counters

---

## Section 1: One browser context per person

Two people are two `browser.newContext()` calls, because a second tab of the same context is not a second person.

### 1.1 Why tabs fail

- Tabs of one context share `localStorage`. The second person inherited the first person's session, and the sign-up of the second person failed with "you already created a user on this phone". Five scripts failed at once *(observed)*.
- A background tab is `hidden`. The app's polling checks the page visibility and stops, so the screen of the background tab never refreshes.

### 1.2 The pattern

`newPhone` builds a context with an explicit viewport, so each phone size is visible in the spec (the reason is in [02, section 4.1](./02-config-runtime.md)):

```ts
async function newPhone(browser: Browser): Promise<Phone> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return { ctx, page: await ctx.newPage() };
}
```

`beforeEach` resets the locker and opens two phones. `afterEach` closes both contexts first and resets the locker last, so no open tab resubscribes to the clean locker ([04, section 2.4](./04-test-data.md)). The close calls use optional chaining, because when `beforeEach` fails, a `TypeError` in `afterEach` would hide the real error.

[`assets/two-phones.smoke.spec.ts`](../assets/two-phones.smoke.spec.ts) is the whole spec, imports included, to copy as `e2e/two-phones.smoke.spec.ts`. It also registers the request guard on both phones and asserts that no paid call was attempted ([08, section 1](./08-third-parties-payments-and-messaging.md)). Read it when you write a spec with two people; to review one or answer a question about it, this section is enough.

### 1.3 Smaller rules from the same specs

- Wait for a heading only the joined person sees (`Locker L3`). A person waiting for approval never sees it, so give that case its own helper.
- Polling on the second phone shows the first person's items as an "added" toast. Assert on the row, not on `getByText(name)`, because the text now appears twice and strict mode throws.
- The operator console next to a customer is a second context with a desktop viewport, such as `{ width: 1440, height: 900 }`, and its token seeded with `openConsole` ([03, section 2](./03-auth-and-test-users.md)).
- A side-by-side photo of two phones is built by opening a throwaway page with `browser.newPage()`, setting its content to two `<img>` elements with `data:` URIs, taking one screenshot, and closing the page. It needs no extra dependency. Photo conventions are in [11, section 2](./11-skipped-scripts-and-photos.md).

The guard test for this rule requires `.newContext(` in the helper that builds a second person, and fails when the helper calls `context.newPage()` for a person.

---

## Section 2: Waiting for the backend

A fixed `waitForTimeout` is too short on a cold Lambda and too long everywhere else, so wait for the condition.

### 2.1 `eventually`, `expect.poll`, and `toPass`

| Tool | Use it when |
|---|---|
| `expect(locator).toBeVisible()` and other web-first assertions | The condition is on the page. They retry until the `expect` timeout. |
| `expect.poll(fn, { timeout }).toBe(x)` | The condition is a value from an API call or a file. |
| `expect(async () => { ... }).toPass({ timeout })` | The condition is a block of several steps that must succeed together. |
| `eventually(what, attempt, opts)` | The attempt returns an object you need afterwards, or must put the name of the waited-for event in the error. |

```ts
// e2e/lib/eventually.ts
export async function eventually<T>(
  what: string, attempt: () => Promise<T | null>, { timeoutMs = 60_000, everyMs = 2_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await attempt();
      if (value !== null) return value;
    } catch (e) { lastError = e; }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`${what}: did not happen within ${timeoutMs} ms${lastError ? ` (last error: ${(lastError as Error).message})` : ''}`);
}
```

The error names what was awaited, where "Timeout 60000 ms exceeded" tells the reader nothing. The default window of 60 s covers the path outbox, stream, bus, Lambda *(observed)*.

### 2.2 Projections that lag the bus

The queue in the console is a projection built from events on the EventBridge bus. After the customer acts, the row appears seconds later. If the console never refetches on its own, waiting 30 s on the same screen cannot succeed. Reload the console and reopen the desk until the row appears.

```ts
await expect(async () => {
  await consolePage.reload();
  await consolePage.getByRole('link', { name: 'Support queue' }).click();
  await expect(consolePage.getByRole('row', { name: new RegExp(customer.sub) })).toBeVisible({ timeout: 2_000 });
}).toPass({ timeout: 60_000, intervals: [2_000, 3_000, 5_000] });
```

When a decision depends on that projected row, such as taking a support case, the server enforces the rule inside its per-thread lock and answers 409 with the current owner, and the local double models the lag. A decision made from the lagging row alone lets two operators take the same case.

The local lane doubles can model this lag with an option that hides a new row for a short window (see [00, section 3](./00-lanes-and-decisions.md)).

### 2.3 Wait for the real write, then reload

An optimistic UI paints the new entry before the server accepts it. A rejected write (HTTP 400) leaves the entry on screen, and a test that only looks at the screen passes. In one project, two kinds of entries never persisted, because the app sent full timestamps where the API expected plain dates, while the UI looked fine *(observed)*. Wait for the response of the write, check `ok()`, then reload and assert again from the server's data. Register `waitForResponse` before the click, because a fast response is missed when it is registered after:

```ts
const write = page.waitForResponse((r) => r.url().includes('/orders') && r.request().method() === 'POST');
await page.getByRole('button', { name: 'Save order' }).click();
expect((await write).ok()).toBe(true);

await page.reload();
await expect(page.getByRole('row', { name: /espresso/i })).toBeVisible();
```

### 2.4 Before a reload, wait for the request that proves the state exists

A reload about one second after opening the assistant happened before the provisional session existed (it takes about 2 s). The "returning" app was a new person, and the test was flaky *(observed)*. Wait for the request that creates the state, then reload:

```ts
await Promise.all([
  page.waitForRequest((r) => r.url().includes('/assistant/turn')),
  page.getByRole('button', { name: 'Ask the assistant' }).click(),
]);
await page.reload();
```

---

## Section 3: Time

### 3.1 `page.clock`

`page.clock` fakes `Date`, timers, and animation frames in the page. Playwright's documentation says `install` must come before any other clock call, and its examples call `install` or `setFixedTime` before `page.goto()`. The docs do not say what happens when `install` runs after the page loaded, so install first.

| Method | Effect |
|---|---|
| `page.clock.setFixedTime(date)` | `Date.now()` and `new Date()` return a fixed value, and timers keep running. The simplest choice when the test only needs a known "now". |
| `page.clock.install({ time })` | Takes control of timers. Required before `pauseAt`, `fastForward`, `runFor`, and `resume`. |
| `page.clock.pauseAt(date)` | Jumps to `date` and stops time. |
| `page.clock.fastForward('30:00')` | Jumps ahead; due timers fire once, as in a real browser that was asleep. |
| `page.clock.runFor(ms)` | Ticks through the interval and fires every timer and animation frame in it. |

```ts
await page.clock.install({ time: new Date('2026-06-01T10:00:00Z') });
await page.goto('/orders/open');
await page.clock.fastForward('10:00');
await expect(page.getByText('This order has been idle for 10 minutes')).toBeVisible();
```

### 3.2 Why the order matters

An app that captures a time reference before the clock is installed keeps reading real time afterwards. The stuck-bill warning of one project never appeared, because the client had stored `Date.now` before the test moved the clock *(observed)*. Install before `goto`, and when a flow needs the clock to move after the client exists, advance it with `fastForward` or `runFor` rather than replacing the clock.

### 3.3 Fixtures use relative dates

A fixture with a literal date such as `2026-08-24T09:00:00.000Z` compared against the real clock turned the integration branch red by itself 24 hours later *(observed)*. Compute the date from today, as in `isoDate` in [04, section 1](./04-test-data.md). For a test that waits "60 minutes ago", write a helper `minutesAgo(60)` and use it in every fixture.

Pin the time zone with `timezoneId: 'UTC'` when fixtures seed dates in UTC; the reason is in [02, section 4.2](./02-config-runtime.md).

---

## Section 4: Race counters

A screenshot shows one race. An API-level spec fires the race many times and counts how often it went wrong, which turns "I think it is fixed" into a number.

### 4.1 The spec

The spec mints two identities without a browser, caches their credentials first so both requests leave in the same tick (not separated by a credentials call), and sends the two requests with `Promise.all`. It repeats the round N times (default 20, overridable with an environment variable) and counts the rounds in which the resource ended up split.

```ts
// e2e/locker-claim-race.smoke.spec.ts (imports: test, expect, mintIdentity, signedFetch)
const ROUNDS = Number(process.env.RACE_ROUNDS ?? 20);

test('two people claiming the same locker never both win', async () => {
  test.setTimeout(ROUNDS * 15_000);
  let split = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const [a, b] = await Promise.all([mintIdentity(), mintIdentity()]);
    await Promise.all([a.warm(), b.warm()]); // credentials cached before the race
    const results = await Promise.all([a, b].map((who) => signedFetch(who, 'POST', '/reservations', { lockerId: 'L4' })));
    if (results.filter((r) => r.status === 201).length !== 1) split++;
    await resetLockerViaApi('L4');
  }
  console.log(`race result: ${split}/${ROUNDS} rounds split the locker`);
  expect(split, `${split} of ${ROUNDS} rounds split the locker`).toBe(0);
});
```

### 4.2 Record the counts

Before the fix, 16 of 20 double claims split the resource. After the fix (a claim row written in the same transaction as the reservation), 0 of 20 did *(observed)*. A second race on open orders went from 15 of 20 rounds with two open orders to 0 of 20 *(observed)*. Save both outputs in the evidence folder of the change ([12, section 2](./12-proving-a-fix.md)).

Keep the spec in the suite as a regression belt. Costs are small: 20 rounds take under a minute and the requests are free.

---

## Verification

Test checklist, one per mechanical rule:

- [ ] Source-scan guard: customer helpers build each person with `.newContext(`, and a helper that calls `context.newPage()` for a person fails the scan (section 1).
- [ ] Source-scan guard: no `waitForTimeout` in `e2e/` outside an allow-listed settle wait with a comment (section 2).
- [ ] Source-scan guard: specs that use `page.clock` call `install` or `setFixedTime` before `goto` (section 3.1).
- [ ] Race counter spec records `split/ROUNDS` and expects 0 (section 4).

## Further reading

- Playwright clock: https://playwright.dev/docs/clock
- Playwright assertions (`expect.poll`, `toPass`): https://playwright.dev/docs/test-assertions
