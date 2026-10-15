// scripts/e2e-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_VERDICT, SUITE_VERDICT, evaluate, fetchVerdict, runGate, summaryLines } from './e2e-gate.mjs';

const SHA = '9f2c1d0e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d';
const BUCKET = 'acme-e2e-reports-test';
const RUN_URL = 'https://github.com/example-org/acme/actions/runs/1';
const verdict = (status, sha = SHA) => JSON.stringify({ sha, status, runUrl: RUN_URL, completedAt: '2026-10-14T15:04:05Z' });

// A fake exec backed by a map from file name to stdout, or to an Error for a failed read.
const fakeExec = (files) => (command, args) => {
  const key = args[2].split('/').pop();
  const value = files[key];
  if (value instanceof Error || value === undefined) throw value ?? Object.assign(new Error('failed'), { stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' });
  return value;
};

test('1. fetchVerdict reads e2e-reports/<sha>/status.json from the bucket', () => {
  const calls = [];
  fetchVerdict((c, a) => { calls.push([c, a]); return '{}'; }, BUCKET, SHA, 'status.json');
  assert.deepEqual(calls[0], ['aws', ['s3', 'cp', `s3://${BUCKET}/e2e-reports/${SHA}/status.json`, '-']]);
});

test('2. a failed read returns a missing marker that keeps the error text', () => {
  const result = fetchVerdict(fakeExec({}), BUCKET, SHA, 'status.json');
  assert.equal(result.missing, true);
  assert.match(result.error, /404/);
});

test('3. a missing verdict blocks, names the sha, and says the commit never ran', () => {
  const r = evaluate({ missing: true, error: '404' }, SHA, SUITE_VERDICT);
  assert.equal(r.ok, false);
  assert.match(r.reason, new RegExp(SHA));
  assert.match(r.reason, /never ran/);
});

test('4. a failed verdict blocks and surfaces the run url', () => {
  const r = evaluate(verdict('failed'), SHA, SUITE_VERDICT);
  assert.equal(r.ok, false);
  assert.equal(r.runUrl, RUN_URL);
});

test('5. a passed verdict for this sha passes', () => {
  assert.equal(evaluate(verdict('passed'), SHA, SUITE_VERDICT).ok, true);
});

test('6. corrupt JSON blocks instead of passing or throwing', () => {
  const r = evaluate('{"status":"pass', SHA, SUITE_VERDICT);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not valid JSON/);
});

test('7. the summary shows the run url, the archive prefix, and the fetch command', () => {
  const { results } = runGate({ exec: fakeExec({ 'status.json': verdict('failed'), 'ai-status.json': verdict('passed') }), bucket: BUCKET, sha: SHA });
  const text = summaryLines(results, BUCKET, SHA).join('\n');
  assert.match(text, new RegExp(RUN_URL));
  assert.match(text, new RegExp(`s3://${BUCKET}/e2e-reports/${SHA}/`));
  assert.match(text, /fetch-report\.mjs/);
});

test('8. the assistant probe reads its own file, so one probe cannot overwrite the other', () => {
  const files = [];
  runGate({ exec: (c, a) => { files.push(a[2].split('/').pop()); return verdict('passed'); }, bucket: BUCKET, sha: SHA });
  assert.deepEqual(files, ['status.json', 'ai-status.json']);
});

test('9. an absent assistant verdict blocks and the message names the assistant probe', () => {
  const { ok, results } = runGate({ exec: fakeExec({ 'status.json': verdict('passed') }), bucket: BUCKET, sha: SHA });
  assert.equal(ok, false);
  assert.match(results[1].reason, /assistant probe/);
});

test('10. a failed assistant verdict blocks even when the suite passed', () => {
  const { ok } = runGate({ exec: fakeExec({ 'status.json': verdict('passed'), 'ai-status.json': verdict('failed') }), bucket: BUCKET, sha: SHA });
  assert.equal(ok, false);
});

test('11. both verdicts passed gives a green gate', () => {
  const { ok } = runGate({ exec: fakeExec({ 'status.json': verdict('passed'), 'ai-status.json': verdict('passed') }), bucket: BUCKET, sha: SHA });
  assert.equal(ok, true);
});

test('12. every red verdict is listed with its own label, so a blocked deploy says which lane is red', () => {
  const { results } = runGate({ exec: fakeExec({ 'status.json': verdict('failed') }), bucket: BUCKET, sha: SHA });
  const reds = results.filter((r) => !r.ok).map((r) => r.probe.label);
  assert.deepEqual(reds, [SUITE_VERDICT.label, AI_VERDICT.label]);
});

test('a verdict that names another commit blocks, so a file copied to the wrong prefix cannot pass', () => {
  const other = '0'.repeat(40);
  assert.equal(evaluate(verdict('passed', other), SHA, SUITE_VERDICT).ok, false);
});

test('a status other than "passed" blocks, so "ok", "success" or a typo never opens the gate', () => {
  assert.equal(evaluate(verdict('success'), SHA, SUITE_VERDICT).ok, false);
});
