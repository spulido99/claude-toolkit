// e2e/assistant-payload.smoke.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('the API stores the exact payload the assistant emits, nulls included', async () => {
  const apiUrl = process.env.API_URL!.replace(/\/$/, '');
  // The setup project (03, section 2.1) wrote the signed-in QA user's token here.
  const { idToken: token } = JSON.parse(readFileSync('.auth/session.json', 'utf8')) as { idToken: string };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Copied from what the agent's result builder emits, including its nulls.
  const analysis = {
    riskLevel: 'High',
    riskScore: 87,
    weightKg: null,
    note: null,
    details: [{ item: 'bleach', quantity: 2 }],
  };
  const clientId = `e2e-${Date.now().toString(36)}`;

  const created = await fetch(`${apiUrl}/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clientId, description: 'Two bottles of bleach', analysis }),
  });
  expect(created.status, `POST /orders rejected the agent's payload: ${await created.clone().text()}`).toBe(201);

  const read = await fetch(`${apiUrl}/orders/${clientId}`, { headers });
  const stored = (await read.json()) as { analysis: Record<string, unknown> };
  expect(stored.analysis.riskLevel).toBe('High');
  expect('weightKg' in stored.analysis, 'null fields are stored as absent').toBe(false);
  expect('note' in stored.analysis, 'null fields are stored as absent').toBe(false);
});
