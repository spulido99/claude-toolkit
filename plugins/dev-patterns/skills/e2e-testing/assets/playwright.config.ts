// e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 8788 + (process.pid % 200));
process.env.E2E_PORT = String(port);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: '.',
  outputDir: '.test-results',
  forbidOnly: !!process.env.CI,
  retries: 0, // local lane: the doubles are deterministic, so a retry would hide a real race (reference 00, section 6)
  workers: 2, // stated on purpose: a change of runner size must not change how the specs interact
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL,
    ...devices['Pixel 7'],
    serviceWorkers: 'block',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run serve:web -w @acme/web',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'local',
      testMatch: '**/*.spec.ts',
      // Probe projects live in playwright.smoke.config.ts; the probe files are
      // still ignored here because **/*.spec.ts would match them.
      testIgnore: ['**/*.smoke.spec.ts', '**/*.probe.spec.ts'],
    },
  ],
});
