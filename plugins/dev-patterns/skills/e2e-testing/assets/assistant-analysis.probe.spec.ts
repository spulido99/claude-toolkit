// e2e/assistant-analysis.probe.spec.ts
import { test, expect } from '@playwright/test';
import { guardExternalServices } from './lib/guard';

const ANALYSIS_TIMEOUT = 60_000; // measured 16-26 s; API Gateway cuts at ~29 s

test('the assistant classifies an order with a restricted item as high risk', async ({ page }) => {
  test.setTimeout(120_000);
  await guardExternalServices(page, process.env.API_URL!, ['payments', 'notify']);

  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assistant/analyze-order')) requests.push(r.url());
  });

  await page.goto('/orders/new');
  // The app boots with a default plan until GET /subscription answers.
  await expect(page.getByText('Analyze with the assistant')).toBeEnabled({ timeout: 20_000 });
  await page.getByLabel('Order description').fill('Two bottles of bleach and a gas canister');

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/assistant/analyze-order') && r.request().method() === 'POST',
    { timeout: ANALYSIS_TIMEOUT },
  );
  await page.getByRole('button', { name: 'Analyze with the assistant' }).click();

  let response;
  try {
    response = await responsePromise;
  } catch {
    throw new Error(
      requests.length === 0
        ? 'Pressing Analyze sent no request: the screen was not ready.'
        : `No answer to POST /assistant/analyze-order within ${ANALYSIS_TIMEOUT / 1000} s.`,
    );
  }
  expect(response.status(), response.status() === 504 ? 'the analysis hit the API Gateway 29 s limit' : 'unexpected status').toBe(200);

  const badge = page.getByTestId('risk-badge');
  await expect(badge).toHaveText(/^(Low|Moderate|High|Very High) risk$/, { timeout: 15_000 });
  await expect(page.getByText('Analysis details')).toBeVisible();
  await expect(page.getByTestId('order-name')).not.toHaveText(/^$|unknown/i);
  await expect
    .poll(async () => Number(await page.getByTestId('risk-score').innerText()))
    .toBeGreaterThan(0);

  // Sanity: if the app ever calls a restricted-item order low risk, this goes red.
  await expect(badge).toHaveText(/^(High|Very High) risk$/);
});
