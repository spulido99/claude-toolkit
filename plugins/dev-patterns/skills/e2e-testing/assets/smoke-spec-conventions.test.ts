// shared/test/smoke-spec-conventions.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/harness';
const dir = `${ROOT}e2e`;
const specs = readdirSync(dir).filter((f) => f.endsWith('.smoke.spec.ts'));
it('the scan found spec files: an empty list would make every rule below pass', () => { expect(specs.length).toBeGreaterThan(5); });
describe.each(specs)('%s', (file) => {
  const src = readFileSync(`${dir}/${file}`, 'utf8');
  it('seeds nothing without closing it in afterEach: each green run left about eight open cases in the shared queue until it held 109', () => {
    // One helper list for the whole suite: add each new seeding helper here in the same change.
    if (/raiseDisputeCase\(|openCaseInDesk\(|seedCase\(/.test(src)) {
      expect(src).toMatch(/test\.afterEach\([^)]*\)?\s*=>?[\s\S]*?closeSeededCases/);
    }
  });
  it('opens each person in browser.newContext(), never a second tab: tabs of one context share localStorage and the second person inherited the first session', () => {
    if (/customerSession|signUpCustomer/.test(src) && /newPage\(\)/.test(src)) {
      expect(src).toMatch(/\.newContext\(/);
    }
  });
  it('seeds the console token before the first goto to the console: after navigation the app has already redirected to the Google login', () => {
    const goto = src.search(/goto\(['"`]\/console/);
    if (goto === -1) return;
    const seed = src.search(/addInitScript|operatorSession\(/);
    expect(seed, 'token seeded').toBeGreaterThan(-1);
    expect(seed).toBeLessThan(goto);
  });
  it('never reads page 1 of a shared queue as if it were the whole queue: other runs add rows, so the row you seeded may be on page 2', () => { expect(src).not.toMatch(/queue-row['"`]\)\.first\(\)/); });
  it('guards the external areas and asserts that nothing reached them: a new spec that forgets the guard is the only way a paid call reaches a blocking lane', () => {
    if (/\.goto\(|newPage\(/.test(src)) {
      expect(src).toMatch(/guardExternalServices\(/);
      expect(src).toMatch(/attempts\w*\(\)[\s\S]*\.toEqual\(\[\]\)/);
    }
  });
});
