// shared/test/photo-guard.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ROOT } from './helpers/harness';
function folders(files: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'photos-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  const out = execFileSync('bash', [`${ROOT}scripts/ci/expected-photo-folders.sh`, dir], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}
it('a script that is fully test.fixme is discounted: its folder never exists and the guard turned a green smoke red', () => {
  expect(folders({
    'a.smoke.spec.ts': "test.fixme('later', async ({ page }) => { photographer(page, 'flow-a'); });",
    'b.smoke.spec.ts': "test('now', async ({ page }) => { photographer(page, 'flow-b'); });",
  })).toEqual(['flow-b']);
});
it('a test.fixme in the middle of a live script does not discount it', () => {
  expect(folders({
    'c.smoke.spec.ts': "test('live', async ({ page }) => { photographer(page, 'flow-c'); });\ntest.fixme('part', async () => {});",
  })).toEqual(['flow-c']);
});
it('the derived list is empty when no spec calls photographer, so the workflow step can fail closed', () => { expect(folders({ 'd.smoke.spec.ts': "test('x', async () => {});" })).toEqual([]); });
