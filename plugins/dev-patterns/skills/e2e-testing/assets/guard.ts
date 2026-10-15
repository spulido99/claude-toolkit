// e2e/lib/guard.ts
import type { Page } from '@playwright/test';

export type ExternalArea = 'assistant' | 'payments' | 'notify';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Aborts every request to the given API areas and records each attempt.
 * Each area is the first path segment of the API route it blocks.
 * Pass only the areas the spec must not reach: a probe for the assistant
 * guards ['payments', 'notify'] so opening one door does not open the others.
 */
export async function guardExternalServices(
  page: Page,
  apiUrl: string,
  areas: ExternalArea[],
): Promise<() => string[]> {
  const attempts: string[] = [];
  const base = escape(apiUrl.replace(/\/$/, ''));
  const pattern = new RegExp(`^${base}/(${areas.join('|')})(/|\\?|$)`);
  await page.route(pattern, (route) => {
    const request = route.request();
    attempts.push(`${request.method()} ${request.url()}`);
    return route.abort('blockedbyclient');
  });
  return () => attempts;
}
