# Skipped Scripts and Step Photos

**Builds:** A CI check that catches scripts that skipped themselves (a helper that fails instead of skipping in CI, a precondition step before the smoke, and a photo completeness step after it), plus a step-photo helper that leaves evidence on red and green runs.

**When to use:** Scripts that skip themselves, checking preconditions before the smoke and evidence after it, step photos.

**Prerequisites:** [`06-ci-workflows.md`](./06-ci-workflows.md) for the smoke job whose steps these checks join.

> Verified on 2026-10-14 against `@playwright/test` 1.64, Vitest 3 and bash; the projects behind the *(observed)* facts ran Playwright 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Detecting skipped scripts
2. Step photos

---

## Section 1: Detecting skipped scripts

A smoke script that calls `test.skip` when infrastructure is missing turns a broken environment into a green run. The suite reports "passed, 3 skipped" and the pull request gets the check mark. In one project the operator credentials were unreadable in CI, the operator scripts skipped themselves, and the run was green with no photos from those scripts *(observed)*. This is a false green.

Apply three measures together.

### 1.1 Fail in CI instead of skipping

A script may skip on a laptop without AWS credentials. In CI the same condition is a failure. Put the decision in one helper so one place decides for every script:

```ts
// e2e/skip-policy.ts
import { test } from '@playwright/test';
export function skipLocallyFailInCi(condition: boolean, reason: string): void {
  if (!condition) return;
  if (process.env.CI) throw new Error(`Precondition missing in CI: ${reason}`);
  test.skip(true, reason);
}
```

Credentials in CI come from the OIDC role. In CI, leave the profile unset so the SDK uses the OIDC credentials; a local profile name forced in CI made the operator lookup fail and skip the scripts *(observed)*:

```ts
const profile = process.env.CI ? undefined : process.env.AWS_PROFILE;
```

The same rule covers quarantine. A script quarantined with `describe.skip` stays green for weeks with no owner, so each quarantine carries an issue reference and a date in a comment, and a guard test counts and lists the skipped specs and fails once a date has passed.

### 1.2 Check preconditions before the smoke

Add a step before the smoke that proves the role can read what the scripts need. It fails in seconds with a readable message, instead of a skip minutes later. `QA_OPERATOR_SECRET_ID` holds the secret name `acme/<stack>/e2e/operator` (see [03, section 3](./03-auth-and-test-users.md)). The check calls `get-secret-value`, because `describe-secret` succeeds without the `GetSecretValue` permission the scripts need:

```yaml
      - name: Check CI can read the operator secret
        run: |
          aws secretsmanager get-secret-value \
            --secret-id "$QA_OPERATOR_SECRET_ID" > /dev/null \
            || { echo "::error::The CI role cannot read the operator secret; the console scripts would skip themselves"; exit 1; }
```

### 1.3 Check the evidence after the smoke

After the upload step, list the evidence folders the specs promise (see section 2) and fail if any is missing. Derive the list from the spec source, so adding a script adds its expectation:

```bash
#!/usr/bin/env bash
# scripts/ci/expected-photo-folders.sh <spec-dir>
set -euo pipefail
dir="${1:-e2e}"
for f in "$dir"/*.smoke.spec.ts; do
  [ -e "$f" ] || continue
  # A fixme script never runs, so it never creates its folder. A fixme in the middle of a live script does not count.
  if awk '/^test\(/ {live=1} /^test\.fixme\(/ {fx=1} END {exit !(fx && !live)}' "$f"; then
    echo "::notice::$f is fully test.fixme; its photos are not expected" >&2
    continue
  fi
  grep -ho "photographer(page, '[^']*'" "$f" | sed "s/.*, '//; s/'\$//" || true
done | sort -u
```

```yaml
      - name: Photo completeness guard
        if: steps.smoke.conclusion == 'success'
        run: |
          expected="$(bash scripts/ci/expected-photo-folders.sh e2e)"
          if [ -z "$expected" ]; then
            echo "::error::The derived list of photo folders is empty; the guard would pass with nothing checked"
            exit 1
          fi
          for flow in $expected; do
            [ -d "e2e/artifacts/$flow" ] || missing="$missing $flow"
          done
          [ -z "${missing:-}" ] || { echo "::error::The smoke passed but the artifact lacks the photos of:$missing. A script skipped itself."; exit 1; }
```

The empty-list check makes the guard fail closed. Without it, a renamed helper makes `grep` match nothing, the loop checks nothing, and the guard passes forever.

The `fixme` discount exists because of one real failure: a script that was fully `test.fixme` never created its folder, so the smoke passed completely and the run still went red *(observed)*. The awk treats only top-level `test.fixme(` in a file with no live `test(` as discounted, and prints a notice so the skipped script is visible in the log. A script that wraps tests in `test.describe(...)` needs the awk pattern adjusted to your style.

Test the script with a guard test that runs the same file, not a copy. [`assets/photo-guard.test.ts`](../assets/photo-guard.test.ts) is the whole test file, to copy as `shared/test/photo-guard.test.ts`. Read it when you write or change the test; to review one or answer a question about it, this section is enough. It writes spec files into a temporary folder, runs `scripts/ci/expected-photo-folders.sh` on that folder, and checks three cases:

- A script that is fully `test.fixme` is discounted, because its folder never exists and the guard turned a green smoke red.
- A `test.fixme` in the middle of a live script does not discount it.
- The derived list is empty when no spec calls `photographer`, so the workflow step can fail closed.

Add a workflow test ([10, section 1.2](./10-guard-tests.md) style) that this step exists, runs after the upload step, and calls the script.

---

## Section 2: Step photos

Photos of each step are the evidence a person reviews: they show what the run saw, they are the only record when a run goes red, and they prove that every promised script ran (section 1). A photo is evidence, not an assertion, so a failed capture must not fail a passing test: the helper retries three times and then throws, and `step` and `photographWhereItFailed` swallow that error.

### 2.1 The `photographer` helper

[`assets/photos.ts`](../assets/photos.ts) is the whole helper, to copy as `e2e/photos.ts`. Read it when you write or change the helper; to review one or answer a question about it, this section is enough. It exports `photographer`, `step` and `photographWhereItFailed`:

- Photos are optional on the local lane (`PHOTOS=1`) and always on in CI.
- Before each shot the helper waits for a stable render: `document.fonts.ready` resolved and every image loaded.
- Chromium sometimes fails one `Page.captureScreenshot` *(observed)*, so the helper retries up to three attempts, waiting 250 ms times the attempt number between them, before it gives up.
- `step` wraps `test.step` and photographs in `finally`, so a red run leaves the photo of the failure.
- `photographWhereItFailed` registers once per spec file and photographs the screen where a failing test stopped.

The lines that the design points below discuss:

```ts
export function photographer(page: Page, flow: string): Photographer {
  const dir = join(ROOT, flow);
  if (ENABLED) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  // ...
}
export function photographWhereItFailed(flow: string): void {
  test.afterEach(async ({ page }, info: TestInfo) => {
    if (info.status === info.expectedStatus) return;
    await photographer(page, `${flow}-failed`).shoot('99-where-it-failed').catch(() => undefined);
```

Three design points:

- The helper wipes its own folder when the flow starts, so a folder from an earlier run cannot satisfy the completeness guard in section 1.
- The failure photo goes to its own folder name (`<flow>-failed`) so it does not erase the numbered photos of the same flow. Pass a different `flow` string if you prefer one folder; in that case call `photographWhereItFailed` before creating the photographer, or the wipe removes it.
- Photos live in `e2e/artifacts/`, which is gitignored and kept apart from `outputDir` (see [02, section 3](./02-config-runtime.md)), because Playwright empties `outputDir` at the start of each run. The helper resolves that folder from its own file location, so a run started from the repository root or from `e2e/` writes to the same `e2e/artifacts/` that the workflow guard and the upload step read.

### 2.2 Assert before you photograph

A photo of an empty or loading screen is a failure, not evidence. Assert the content that makes the screen what it claims to be, and then shoot. `step` photographs in `finally`, after the assertion, so a green photo shows the asserted state and a red photo shows what the screen held when the assertion gave up:

```ts
// e2e/place-order.smoke.spec.ts
import { expect, test } from '@playwright/test';
import { guardExternalServices } from './lib/guard';
import { photographer, photographWhereItFailed, step } from './photos';
photographWhereItFailed('place-order');
test('a new customer places an order from the catalog', async ({ page }) => {
  const attempts = await guardExternalServices(page, process.env.API_URL!, ['assistant', 'payments', 'notify']);
  const shoot = photographer(page, 'place-order');
  await step(shoot, 'Catalog', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  });
  await step(shoot, 'Order confirmed', async () => {
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText(/order confirmed/i)).toBeVisible();
  });
  expect(attempts()).toEqual([]);
});
```

The completeness guard in section 1 finds `place-order` because the spec calls `photographer(page, 'place-order'`. Keep that call shape (single quotes, flow name as a literal string), or update the script's grep when you change it.

---

## Verification

Commands that confirm the checks run and pass:

```bash
# The completeness script against the real specs (must print at least one folder)
bash scripts/ci/expected-photo-folders.sh e2e
```

Break one rule on purpose in a scratch branch (rename the `photographer` helper) and confirm the completeness step fails on an empty list. A check that has never gone red is the same kind of false green as [12, section 3](./12-proving-a-fix.md).

Test checklist, one per mechanical rule introduced in this file:

- [ ] The CI role can read the operator secret with `get-secret-value` before the smoke (1.2).
- [ ] Quarantined specs carry an issue and a date, and a guard lists them (1.1).
- [ ] `expected-photo-folders.sh` discounts fully-fixme specs only, and returns an empty list when nothing matches (1.3).
- [ ] The photo completeness step exists, runs after the upload, fails on an empty list (1.3).
- [ ] Specs fail in CI instead of skipping on a missing precondition (1.1).

## Further reading

- Playwright, [Test annotations](https://playwright.dev/docs/test-annotations) (`test.skip` and `test.fixme`).
- [10, section 1.2](./10-guard-tests.md): the workflow-test style that the photo completeness step in section 1.3 is pinned with.
