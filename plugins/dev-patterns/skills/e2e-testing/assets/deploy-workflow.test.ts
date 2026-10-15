// shared/test/deploy-workflow.test.ts
import { describe, expect, it } from 'vitest';
import { loadWorkflow, readWithoutComments, stepIndex } from './helpers/harness';
const FILE = '.github/workflows/deploy-dev.yml';
const wf = loadWorkflow(FILE);
const job = wf.jobs['deploy-and-smoke'];
const SMOKE = /playwright test.*smoke|test:smoke/;
describe('deploy-dev workflow', () => {
  it('the first step rejects refs the OIDC trust policy does not accept: otherwise the run dies five minutes later with an opaque AccessDenied', () => {
    expect(job.steps[0].run).toMatch(/GITHUB_REF_NAME/);
    expect(job.steps[0].run).toMatch(/exit 1/);
  });
  it('the concurrency group is per personal stack and never cancels: two runs against one stack reset each other fixtures, and a cancelled cdk deploy leaves UPDATE_ROLLBACK', () => {
    expect(wf.concurrency?.group).toBe('deploy-dev-${{ github.ref_name }}');
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false);
  });
  it('no pull_request trigger: a workflow with id-token write would hand the OIDC role to any pull request', () => {
    expect(Object.keys(wf.on)).not.toContain('pull_request');
    expect(wf.permissions?.['id-token']).toBe('write');
  });
  it('the smoke runs after the deploy and before the evals: a model judge that grades one answer differently on each run must not stop the smoke from running', () => {
    const [deploy, smoke, evals] = [/cdk deploy/, SMOKE, /npm run evals/].map((p) => stepIndex(job, p));
    expect(deploy).toBeLessThan(smoke);
    expect(smoke).toBeLessThan(evals);
  });
  it('the frontend deploy comes before the smoke and the report upload after it: the smoke must test the deployed frontend, and the upload must find the report the smoke wrote', () => {
    const [frontend, smoke, upload] = [/Deploy frontend/, SMOKE, /actions\/upload-artifact/].map((p) => stepIndex(job, p));
    expect(frontend).toBeLessThan(smoke);
    expect(smoke).toBeLessThan(upload);
  });
  it('SMOKE_URL is derived from the stack outputs and fails when empty: a literal URL once pointed the lane at a dead distribution', () => {
    const step = job.steps[stepIndex(job, /SMOKE_URL/)];
    expect(step.run).toMatch(/jq/);
    expect(step.run).toMatch(/null/);
    expect(readWithoutComments(FILE)).not.toMatch(/SMOKE_URL:\s*https?:\/\//);
  });
  it('the smoke has no continue-on-error: a red smoke must turn the run red', () => { expect(job.steps[stepIndex(job, SMOKE)]['continue-on-error']).toBeUndefined(); });
  it('the artifact upload runs with always() but not when the smoke was skipped: the photos of the failure are the evidence, and a "no files found" error must not mask the real failure', () => {
    const upload = job.steps[stepIndex(job, /actions\/upload-artifact/)];
    expect(upload.if).toContain('always()');
    expect(upload.if).toContain("steps.smoke.conclusion != 'skipped'");
  });
  it('every job has a timeout: a stalled npm ci would burn six hours', () => { for (const [name, j] of Object.entries(wf.jobs)) expect(j['timeout-minutes'], name).toBeGreaterThan(0); });
  it.each([FILE, '.github/workflows/deploy-prod.yml'])('third-party actions in %s are pinned by a 40-hex commit SHA: a moved tag would run new code with the OIDC role', (file) => {
    const uses = [...readWithoutComments(file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length, 'vacuity check: the workflow should use actions').toBeGreaterThan(0);
    for (const u of uses.filter((x) => !x.startsWith('./'))) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
});
