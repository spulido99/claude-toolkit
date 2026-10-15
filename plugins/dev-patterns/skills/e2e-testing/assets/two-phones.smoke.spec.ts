// e2e/two-phones.smoke.spec.ts
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { guardExternalServices } from './lib/guard';
import { resetLocker } from './lib/locker';

const LOCKER_ID = 'L3';
interface Phone { ctx: BrowserContext; page: Page }

async function newPhone(browser: Browser): Promise<Phone> {
  // An explicit viewport keeps each phone size visible in the spec.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return { ctx, page: await ctx.newPage() };
}

let first: Phone, second: Phone;

test.beforeEach(async ({ browser }) => {
  await resetLocker(LOCKER_ID);
  first = await newPhone(browser);
  second = await newPhone(browser);
});

test.afterEach(async () => {
  // Optional chaining: when beforeEach failed, a TypeError here would hide the real error.
  await first?.ctx.close();
  await second?.ctx.close();
  await resetLocker(LOCKER_ID); // contexts first, so no open tab resubscribes to the clean locker (e2e-testing references/04-test-data.md, section 2.4)
});

test('the second person sees the item the first person added', async () => {
  // Every spec that opens a page guards the paid areas and asserts that nothing reached them.
  const attemptsFirst = await guardExternalServices(first.page, process.env.API_URL!, ['assistant', 'payments', 'notify']);
  const attemptsSecond = await guardExternalServices(second.page, process.env.API_URL!, ['assistant', 'payments', 'notify']);
  await first.page.goto(`/locker/${LOCKER_ID}`);
  await first.page.getByRole('button', { name: 'Add espresso' }).click();
  await second.page.goto(`/locker/${LOCKER_ID}`);
  await expect(second.page.getByRole('row', { name: /espresso/i })).toBeVisible();
  expect([...attemptsFirst(), ...attemptsSecond()]).toEqual([]);
});
