# Proving a Fix

**Builds:** The evidence a pull request carries when it changes what a person sees, a transcript that proves a flake is fixed instead of lucky, and a habit of checking that new assertions can fail.

**When to use:** A pull request changes what a person sees; you fixed a flake and must show it; you suspect an assertion cannot fail.

**Prerequisites:** None.

> Verified on 2026-10-14 against `@playwright/test` 1.64; the projects behind the *(observed)* facts ran Playwright 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Evidence for a pull request that changes what a person sees
2. Proving a flake is fixed
3. Assertions that cannot fail

---

## Section 1: Evidence for a pull request that changes what a person sees

A suite stays green when no assertion looks at the wrong part of a wrong screen. One production project shipped a header that showed an internal id instead of a table number; the fix reached three of four places, and the unfixed one lived for a month with the whole suite green because nobody looked at the screen *(observed)*. The rule that came out of it: a pull request that changes what a person sees carries photos of that screen before and after.

- Take the before and after photos of the same screen, in the same environment, with the same crop. A different crop or viewport makes the pair impossible to compare.
- Take the "before" against the deployed old base, not against your branch with the change reverted. The old base is what users have now.
- Store the files under `docs/evidence/<ticket>-<slug>/`, named `before-<environment>-<what-is-shown>.png` and `after-<environment>-<what-is-shown>.png`. Crop to the changed element and keep each file near 200 KB, because the repo keeps them forever.
- Link them in the pull request body with a raw URL that includes the commit SHA (`https://raw.githubusercontent.com/<org>/<repo>/<sha>/docs/evidence/...`). On private repos a branch-relative image link stops resolving once the branch is deleted, and the SHA keeps it alive.
- For changes nobody sees, the evidence is real output: the test run, a `cdk diff`, the webhook log line, the message on a phone.
- Take the photos used as demo material from a CI run (the artifact of the smoke), not from a laptop, because a laptop run proves nothing about the deployed stack.

Photos are review artifacts. They are not visual regression tests. Add `toHaveScreenshot` only when the design is final and CI can anchor the baselines, because the baseline differs per browser and platform and so a baseline taken on a Mac fails on a Linux runner ([Playwright, "Visual comparisons"](https://playwright.dev/docs/test-snapshots)).

An agent without AWS credentials (a cloud session) hands over a draft pull request with the spec written and "deploy, run the e2e, take the photos" left open for a session with credentials. See [06, section 9](./06-ci-workflows.md).

One shared dev stack serves both the CI deploys and manual evidence runs. A manual run that overlaps a CI deploy produces useless photos and false reds *(observed)*. Before taking evidence, wait until the deploy workflow has no unfinished run, check twice in a row, and count a failed `gh` call as busy:

```bash
#!/usr/bin/env bash
# scripts/evidence/wait-for-idle-deploy.sh
quiet=0
while [ "$quiet" -lt 2 ]; do
  active="$(gh run list --workflow deploy-dev.yml --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null)" || active=1
  if [ "${active:-1}" = "0" ]; then quiet=$((quiet + 1)); else quiet=0; fi
  sleep 20
done
```

---

## Section 2: Proving a flake is fixed

A flake that passes once after a change is not fixed. Write a transcript file with the facts a reviewer needs, and store it next to the photos: `docs/evidence/<ticket>-<slug>/e2e-<n>-runs.txt`.

The transcript holds:

- **Environment and commit.** The stack name and the commit SHA the run tested.
- **Command and date.** The exact command, with `--retries=0`, because a retry hides the failure you are trying to remove.
- **Before.** The CI run ids where the spec failed (and then passed on retry). They show the flake was real.
- **After.** N consecutive green runs at `--retries=0`, each with its duration. Pick N from how often it failed: a flake that failed in 3 of 3 consecutive CI runs needs at least 3 clean runs, and one that failed once in 20 needs far more than 5. State the failure rate you based N on.
- **Limit of the evidence**, when the run cannot force the failing condition.

Example transcript:

```text
Ticket: 412 stale order total after reload
Environment: Acme-Backend-dev-e2e, deployed from 4b1f0c2
Command: npx playwright test --config e2e/playwright.smoke.config.ts e2e/order-total.smoke.spec.ts --retries=0 --repeat-each=1
Date: 2026-10-02
Before (CI): runs 1001, 1007, 1012 failed with "element detached from the DOM", passed on retry.
After: run 1/5 passed (27 s), 2/5 (25 s), 3/5 (29 s), 4/5 (26 s), 5/5 (25 s). No other deploy ran during these runs.
Regression: orders, payments and reload specs, 17 passed in 5.9 min.
Limit of this evidence: the failure needs the subscribe acknowledgement to arrive after the first HTTP
response, which happens on a cold Lambda right after a backend deploy. These runs do not force that
start. The mechanism is proven by the unit test order-store.stale-snapshot.test.tsx, red without the fix
and green with it.
```

The "limit" line is part of the evidence. It stops a reviewer from reading five green runs as proof of something they cannot prove, and it points to the test that does prove the mechanism. If the mechanism has no unit test, write one; evidence that rests on luck is not evidence.

For races, use the race counter from [05, section 4](./05-multi-user-waits-and-time.md). It runs the race N times and counts failures, so the transcript records numbers instead of a feeling, for example "before the fix: 16 of 20 rounds split the resource; after the fix: 0 of 20".

`npx playwright test --config e2e/playwright.smoke.config.ts e2e/order-total.smoke.spec.ts --repeat-each=10 --retries=0` runs the spec ten times in one command (see the [CLI reference](https://playwright.dev/docs/test-cli)). Repeats in one run share the warm Lambdas of that run, so they prove less than five separate CI runs. Use them to find a flake, and use separate runs to prove it fixed.

---

## Section 3: Assertions that cannot fail

An assertion that cannot fail is a false green with a good-looking test name. The usual cause is that the assertion targets something that is not on the screen. A `toHaveCount(0)` on a notice that renders inside a screen hidden behind another screen is true before and after the fix, so the spec passed against the bug *(observed)*. A reviewer caught it; the suite did not.

Follow these steps for every new assertion that expects something to be absent:

1. Check that the assertion targets a visible screen. Navigate to the screen first (in the example, close the receipt and return to the order view), then assert absence there.
2. Run the spec once against the unfixed build and watch it go red. A test that has never failed has not shown that it can. The "before" run in section 2 is exactly this run, so doing it costs nothing extra.
3. Prefer an assertion on presence of the replacement over absence of the old thing, when the screen has a replacement (`toBeVisible()` on the new text).

Frameworks that keep left screens mounted but hidden need one more rule. Expo Router keeps them in the DOM. `getByText('Total').first()` can return the hidden copy from a previous visit, and `toBeVisible()` then fails with "not visible" on text that is on screen *(observed)*. Narrow the locator to visible elements and take the newest:

```ts
// e2e/screen.ts
import type { Locator, Page } from '@playwright/test';
// Only the copy the user can see; the newest mount wins when a screen was re-entered.
export const onScreen = (page: Page, text: string | RegExp): Locator =>
  page.getByText(text).filter({ visible: true }).last();
```

Use `onScreen(page, 'Order confirmed')` with Expo Router or any router that keeps previous screens mounted. With `toHaveCount(0)` and `toBeHidden()`, the visible filter makes the assertion mean what it says: no visible copy exists.

---

## Verification

This file has no commands to run. Check these rules by reading the pull request and the transcript:

- [ ] A pull request that changes what a person sees carries before and after photos of the same screen, the same environment and the same crop (1).
- [ ] Every flake-fix transcript names the stack, the commit, the command with `--retries=0`, the CI run ids before, N consecutive green runs after, and the limit of the evidence (2).
- [ ] Every new absence assertion was seen red against the unfixed build (3).

## Further reading

- Playwright, [Visual comparisons](https://playwright.dev/docs/test-snapshots), [Command line](https://playwright.dev/docs/test-cli).
