// shared/test/target.test.ts
import { test, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSmokeUrl } from '../../e2e/lib/target';

const missing = '/nonexistent/outputs.json';

test('env var wins over the outputs file', () => {
  const url = resolveSmokeUrl({ env: { SMOKE_URL: 'https://a.test' }, outputsFile: missing });
  expect(url).toBe('https://a.test');
});

test('an empty SMOKE_URL counts as unset and does not become the target', () => {
  expect(() => resolveSmokeUrl({ env: { SMOKE_URL: '' }, outputsFile: missing })).toThrow(/No smoke target/);
});

test('reads AppUrl of the frontend stack from the CDK outputs file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'out-')), 'o.json');
  writeFileSync(file, JSON.stringify({ 'Acme-Frontend-dev-x': { AppUrl: 'https://b.test' } }));
  expect(resolveSmokeUrl({ env: {}, outputsFile: file })).toBe('https://b.test');
});

test('throws with instructions when nothing resolves', () => {
  expect(() => resolveSmokeUrl({ env: {}, outputsFile: missing })).toThrow(/SMOKE_URL/);
});
