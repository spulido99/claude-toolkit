// e2e/photos.ts
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, type Locator, type Page, type TestInfo } from '@playwright/test';
const ROOT = resolve(__dirname, 'artifacts'); // from this file's folder, so a run from the repository root or from e2e/ lands in e2e/artifacts/
// Photos are optional on the local lane (PHOTOS=1) and always on in CI.
const ENABLED = !!process.env.CI || process.env.PHOTOS === '1';
export interface Photographer { shoot(name: string, target?: Locator): Promise<void> }
export function photographer(page: Page, flow: string): Photographer {
  const dir = join(ROOT, flow);
  if (ENABLED) {
    // The folder always reflects the last run of this flow.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  let n = 0;
  return {
    async shoot(name, target) {
      if (!ENABLED) return;
      n += 1;
      const file = join(dir, `${String(n).padStart(2, '0')}-${name}.png`);
      // Chromium sometimes fails one Page.captureScreenshot (observed); retry, then throw after three attempts (`step` and `photographWhereItFailed` swallow that error).
      for (let attempt = 1; ; attempt += 1) {
        try {
          await waitForStableRender(page);
          if (target) await target.screenshot({ path: file });
          else await page.screenshot({ path: file, fullPage: true });
          return;
        } catch (error) {
          if (attempt === 3) throw error;
          await page.waitForTimeout(250 * attempt);
        }
      }
    },
  };
}
async function waitForStableRender(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
}
// test.step that photographs in `finally`: a red run leaves the photo of the failure.
export async function step<T>(shooter: Photographer, name: string, fn: () => Promise<T>, takePhoto = true): Promise<T> {
  return test.step(name, async () => {
    try { return await fn(); }
    finally { if (takePhoto) await shooter.shoot(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).catch(() => undefined); }
  });
}
// Register once per spec file: the photo of the screen where a failing test stopped.
export function photographWhereItFailed(flow: string): void {
  test.afterEach(async ({ page }, info: TestInfo) => {
    if (info.status === info.expectedStatus) return;
    await photographer(page, `${flow}-failed`).shoot('99-where-it-failed').catch(() => undefined);
  });
}
