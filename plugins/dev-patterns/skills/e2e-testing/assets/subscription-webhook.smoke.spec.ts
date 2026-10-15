// e2e/subscription-webhook.smoke.spec.ts
import { test, expect } from '@playwright/test';
import { buildSubscriptionEvent, sign } from './lib/payments';
import { getWebhookSecret, getPlan, getQaUser } from './lib/backend';

const apiUrl = process.env.API_URL!.replace(/\/$/, '');
const post = (body: string, signature: string) =>
  fetch(`${apiUrl}/webhooks/payments`, { method: 'POST', headers: { 'X-Signature': signature, 'Content-Type': 'application/json' }, body });

test('a tampered signature is rejected and changes nothing', async () => {
  const user = await getQaUser();
  const body = buildSubscriptionEvent({ type: 'subscription_created', userId: user.id, subscriptionId: `e2e-${Date.now().toString(36)}` });
  const response = await post(body, sign(body, 'not-the-secret'));
  expect(response.status).toBe(401);
  expect(await getPlan(user)).toBe('free');
});

test('a signed created event makes the user premium; the same subscription expiring returns them to free', async () => {
  const secret = await getWebhookSecret();
  const user = await getQaUser();
  const subscriptionId = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const created = buildSubscriptionEvent({ type: 'subscription_created', userId: user.id, subscriptionId });
  expect((await post(created, sign(created, secret))).status).toBe(200);
  await expect.poll(() => getPlan(user), { timeout: 30_000, intervals: [1_000, 2_000] }).toBe('premium');

  // Same subscription id on purpose: a lifecycle shares one id, and a store that
  // dedupes by id would drop this event and leave the user premium.
  const expired = buildSubscriptionEvent({ type: 'subscription_expired', userId: user.id, subscriptionId });
  expect((await post(expired, sign(expired, secret))).status).toBe(200);
  await expect.poll(() => getPlan(user), { timeout: 30_000, intervals: [1_000, 2_000] }).toBe('free');
});
