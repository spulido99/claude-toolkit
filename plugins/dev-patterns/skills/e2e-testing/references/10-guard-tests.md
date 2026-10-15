# Guard Tests

**Builds:** A set of fast guard tests that pin the properties of the e2e harness itself: workflow YAML, the pull-request gate job, Playwright config, `e2e/` types, spec conventions, docs wording, IAM and synthesized templates.

**When to use:** Setting up the harness checks of a new suite; adding a rule to the suite and needing the test that keeps it true.

**Prerequisites:** The tests below pin rules explained in [02, section 1](./02-config-runtime.md), [03, section 1](./03-auth-and-test-users.md), [06, section 9](./06-ci-workflows.md) and [07, section 4](./07-release-gate.md).

> Verified on 2026-10-14 against `@playwright/test` 1.64, Vitest 3, `yaml` 2 and Node 22 (`node --test` only for the variant in section 1.9); the projects behind the *(observed)* facts ran Playwright 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Guard tests: the catalog

---

## Section 1: Guard tests: the catalog

A workflow that deploys from the wrong branch, a config that runs 12 workers, a spec that forgets its cleanup, and a doc that promises a gate nobody runs all leave the e2e suite green. A guard test is a fast unit test that reads the harness files and fails when one of these properties changes.

### 1.1 Where guard tests live and how they are written

Put the guard tests in a workspace that the CI test command already runs, for example `shared/test/`. Rules about `e2e/` and `.github/` belong to no workspace, so without a deliberate home they are never run. Two projects had guard tests that no workflow executed for months, and two of them were red the whole time *(observed)*. CDK synth and IAM tests need `aws-cdk-lib`, so they live in `infra/test/` and run with the infra workspace's test command; Playwright config, workflow, docs, and source-scan guard tests live in `shared/test/`. After writing the first guard test, open the CI workflow that runs unit tests and confirm it reaches the file. Add a guard test for that too (see section 1.3).

Write each test title as a full sentence that states the rule and the failure it prevents, such as `playwright browsers are installed before the smoke: the runner ships without them and the lane would die before the first photo`. The title tells the next agent why it may not delete the test.

Read workflow files in one of two ways:

- Parse them with the `yaml` package and assert on the parsed object. Use this when you check steps, `needs`, `if`, or `concurrency`.
- Read the text with comment lines removed. Use this for "this string must not appear" rules. Workflow headers document what the workflow must NOT do, so the forbidden literals appear in comments, and a plain `includes` check would fail on the comment.

Shared helper, written once and imported by every Vitest example below:

```ts
// shared/test/helpers/harness.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const readText = (rel: string): string =>
  readFileSync(`${ROOT}${rel}`, 'utf8').replace(/\r\n/g, '\n');
// Comment lines document what must NOT happen; their literals are not configuration.
export const readWithoutComments = (rel: string): string =>
  readText(rel).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
export interface Step { name?: string; uses?: string; run?: string; if?: string; 'continue-on-error'?: boolean }
export interface Job { needs?: string | string[]; if?: string; 'timeout-minutes'?: number; steps: Step[] }
export interface Workflow { on: Record<string, unknown>; permissions?: Record<string, string>; concurrency?: { group: string; 'cancel-in-progress'?: boolean }; jobs: Record<string, Job> }
export const loadWorkflow = (rel: string): Workflow => parse(readText(rel)) as Workflow;
export function stepIndex(job: Job, pattern: RegExp): number {
  const i = job.steps.findIndex((s) => pattern.test(`${s.name ?? ''} ${s.uses ?? ''} ${s.run ?? ''}`));
  if (i === -1) throw new Error(`no step matches ${pattern}`);
  return i;
}
```

`stepIndex` throws when a step is missing, because a guard that returns `-1` and compares it with another `-1` passes while checking nothing.

### 1.2 Workflow tests

One test file per workflow that runs the lanes. This file covers the deploy workflow of the example app, `.github/workflows/deploy-dev.yml`, which deploys the personal stack and then runs the smoke.

[`assets/deploy-workflow.test.ts`](../assets/deploy-workflow.test.ts) is the whole test file, to copy as `shared/test/deploy-workflow.test.ts`. Read it when you write or change the workflow tests; to review one or answer a question about it, this section is enough. It pins these rules, each with the failure it prevents:

- The first step rejects refs the OIDC trust policy does not accept; otherwise the run dies five minutes later with an opaque `AccessDenied`.
- The concurrency group is exactly `deploy-dev-${{ github.ref_name }}`, one group per personal stack, and never cancels, because two runs against one stack reset each other's fixtures, and a cancelled `cdk deploy` leaves `UPDATE_ROLLBACK`. The shared-stack suite workflow uses `vars.STAGE` instead (see [06, section 4](./06-ci-workflows.md)).
- There is no `pull_request` trigger and `id-token` is `write`, because a workflow with `id-token: write` would hand the OIDC role to any pull request.
- The smoke runs after the deploy and before the evals, so a model judge that grades one answer differently on each run cannot stop the smoke from running.
- `SMOKE_URL` is derived from the stack outputs with `jq` and fails when empty, and the workflow never holds a literal URL, because a literal URL once pointed the lane at a dead distribution.
- The smoke has no `continue-on-error`, so a red smoke turns the run red.
- The artifact upload runs with `always()` but not when the smoke was skipped: the photos of the failure are the evidence, and a "no files found" error must not mask the real failure.
- Every job has a `timeout-minutes`, because a stalled `npm ci` would burn six hours.
- The frontend deploy step comes before the smoke and the report upload step comes after it, because the smoke must test the deployed frontend and the upload must find the report the smoke wrote.
- Third-party actions are pinned by a 40-hex commit SHA in both `deploy-dev.yml` and `deploy-prod.yml`, because a moved tag would run new code with the OIDC role. The test loops over both files, since the first line of `deploy-prod.yml` relies on it. The example workflows pin by major version for readability, so their first line says to pin by SHA before use, and this test fails until you do.

If the workflow deploys only from `main` while branch runs only test, add one more test: every step that assumes the deploy role, runs `cdk deploy`, or builds the frontends carries `if: github.ref == 'refs/heads/main'`, and the steps that assume the test role and run Playwright have no `if`. This was the rule behind an unsupervised night agent that must never receive the deploy role *(observed)*.

### 1.3 The gate job of the pull-request checks

A pull-request workflow with several jobs ends with one gate job, and branch protection requires only that job. GitHub skips a job whose `needs` job was skipped or failed, unless the job has its own `if` that overrides this ([GitHub Docs, "Using jobs in a workflow"](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-jobs-in-a-workflow)). GitHub treats a job skipped by its own condition as passing for a required check ([GitHub Docs, "Troubleshooting required status checks"](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)). So a gate with no `if` is skipped whenever one of its needs is skipped, and the required check reports success without testing anything. Two innocent YAML edits would have left the required check green with no tests run *(observed)*.

The gate needs every other job, has `if: ${{ !cancelled() }}`, and checks each result itself:

```yaml
  pr-checks:
    needs: [node, python]
    if: ${{ !cancelled() }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - run: echo '${{ toJSON(needs) }}' | jq -e 'all(.[]; .result == "success")'
```

```ts
// shared/test/pr-checks-workflow.test.ts
import { expect, it } from 'vitest';
import { loadWorkflow, readText } from './helpers/harness';
const wf = loadWorkflow('.github/workflows/pr-checks.yml');
it('the gate job needs every other job: a job it does not list can fail and the required check stays green', () => {
  const others = Object.keys(wf.jobs).filter((n) => n !== 'pr-checks');
  expect([wf.jobs['pr-checks'].needs].flat().sort()).toEqual(others.sort());
});
it('the gate job has if !cancelled(): without it a skipped need skips the gate, and a skipped required check counts as passing', () => { expect(wf.jobs['pr-checks'].if).toContain('!cancelled()'); });
it('the workflow that runs the guard tests exists and runs the unit tests without a paths filter: guard tests nobody runs stay red for months', () => {
  expect(readText('.github/workflows/pr-checks.yml')).toMatch(/npm test/);
  expect(Object.keys(wf.on)).toContain('pull_request');
  expect(JSON.stringify(wf.on)).not.toContain('paths');
});
```

### 1.4 Config tests

Import the real config and assert the properties you chose. A config that reads `SMOKE_URL` throws without it, so stub the variable first.

```ts
// shared/test/smoke-config.test.ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers/harness';
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('SMOKE_URL', 'https://app.example.test');
  vi.stubEnv('CI', '');
});
afterEach(() => vi.unstubAllEnvs());
it('the smoke lane runs at most 4 workers: each worker signs up real Cognito users, and more overloaded Cognito and the payment sandbox', async () => { expect((await import('../../e2e/playwright.smoke.config')).default.workers).toBe(4); });
it('retries is 0 outside CI: local and evidence runs see flakes honestly', async () => { expect((await import('../../e2e/playwright.smoke.config')).default.retries ?? 0).toBe(0); });
it('the local project lists the probe files in testIgnore: a plain playwright test must never spend tokens or buy something', async () => {
  const { default: config } = await import('../../e2e/playwright.config');
  expect(String(config.projects?.find((p) => p.name === 'local')?.testIgnore)).toMatch(/probe/);
});
it('the smoke project lists the probe files in testIgnore: a broad smoke pattern would otherwise match a probe file, and a plain smoke run would spend model tokens', async () => {
  const { default: config } = await import('../../e2e/playwright.smoke.config');
  expect(String(config.projects?.find((p) => p.name === 'smoke')?.testIgnore)).toMatch(/probe/);
});
it('the probe projects exist only when their env var is set: a plain run must never reach a paid lane', async () => {
  const names = async () => ((await import('../../e2e/playwright.smoke.config')).default.projects ?? []).map((p) => p.name);
  expect(await names()).not.toEqual(expect.arrayContaining(['probe-llm']));
  expect(await names()).not.toEqual(expect.arrayContaining(['probe-payments']));
  vi.resetModules();
  vi.stubEnv('E2E_PROBE_LLM', '1');
  vi.stubEnv('E2E_PROBE_PAYMENTS', '1');
  expect(await names()).toEqual(expect.arrayContaining(['probe-llm', 'probe-payments']));
});
it('with CI empty every project of both configs resolves to 0 retries: local and evidence runs see flakes honestly', async () => {
  for (const file of ['playwright.config', 'playwright.smoke.config']) {
    vi.stubEnv('E2E_PROBE_LLM', '1');
    vi.stubEnv('E2E_PROBE_PAYMENTS', '1');
    const { default: cfg } = await import(`../../e2e/${file}`);
    for (const p of cfg.projects ?? []) expect(p.retries ?? cfg.retries ?? 0, `${file} ${p.name}`).toBe(0);
    vi.resetModules();
  }
});
it('with CI set each probe project retries once: a retry costs a model call or a sandbox purchase, and two would triple the bill', async () => {
  vi.stubEnv('CI', '1');
  vi.stubEnv('E2E_PROBE_LLM', '1');
  vi.stubEnv('E2E_PROBE_PAYMENTS', '1');
  const { default: cfg } = await import('../../e2e/playwright.smoke.config');
  const probes = (cfg.projects ?? []).filter((p) => p.name?.startsWith('probe-'));
  expect(probes.length, 'vacuity check: both probe projects should exist').toBe(2);
  for (const p of probes) expect(p.retries, p.name).toBe(1);
});
it('@playwright/test is pinned to an exact version: a fresh install cannot change browser behaviour between runs', () => {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  const range = { ...pkg.dependencies, ...pkg.devDependencies }['@playwright/test'];
  expect(range).toMatch(/^\d+\.\d+\.\d+$/);
});
```

The first test pins the worker ceiling chosen in [02, section 1](./02-config-runtime.md). When someone raises it, the test sends them to the reason. The retries rule is in [00, section 6](./00-lanes-and-decisions.md): outside CI the number is 0, and in CI each lane sets its own. The retries test with `CI` empty resolves each project's retries the way Playwright does (the project's own value, then the config's, then 0) for both configs, with the probe env vars set so the probe projects are included, and the retries test with `CI` set pins each probe project to one retry. The two probe tests are the ones that the verification checklists of [08](./08-third-parties-payments-and-messaging.md) and [00](./00-lanes-and-decisions.md) promise: the smoke project's `testIgnore` covers `*.probe.spec.ts`, and the probe projects exist only when `E2E_PROBE_LLM` or `E2E_PROBE_PAYMENTS` is set. The last test is the Playwright version pin from [02, section 6](./02-config-runtime.md).

### 1.5 The `e2e/` typecheck test

Playwright transpiles TypeScript without checking types, and `e2e/` is usually not a workspace, so a stale helper signature surfaced only as a 401 in the deployed smoke *(observed)*. The rule and the config are in [02, section 5](./02-config-runtime.md). The guard test:

```ts
// shared/test/e2e-typecheck.test.ts
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ROOT } from './helpers/harness';
// tsc took 2.5 s on a quiet machine and 6-8 s under load; a 5 s limit turned a branch red.
const TSC_TIMEOUT = 60_000;
const tsc = (...args: string[]) =>
  execFileSync('npx', ['tsc', '-p', 'e2e/tsconfig.json', ...args], { cwd: ROOT, encoding: 'utf8' });
it('the root typecheck script covers e2e/: Playwright does not typecheck, so a wrong helper signature would only fail in the deployed smoke', () => {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  expect(pkg.scripts.typecheck).toContain('e2e/tsconfig.json');
});
it('tsconfig covers every .ts file in e2e/', () => {
  const listed = tsc('--listFilesOnly').split('\n');
  const sources = (readdirSync(`${ROOT}e2e`, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts') && !f.includes('node_modules') && !f.startsWith('artifacts'));
  expect(sources.length, 'vacuity check: the folder should not look empty').toBeGreaterThan(10);
  for (const f of sources) expect(listed.some((l) => l.endsWith(`/e2e/${f}`)), f).toBe(true);
}, TSC_TIMEOUT);
it('tsc reports no errors in e2e/', () => { expect(tsc('--noEmit')).toBe(''); }, TSC_TIMEOUT);
```

The `> 10` check stops the loop from passing on an empty folder or a wrong path. Set it to about half your real file count.

The synth tests of section 1.8 have the same timing problem. The runner's default test timeout is 5 s, so give them 60 s as well, raise `hookTimeout` for the `beforeAll` that synthesizes the stacks once they grow, and drop esbuild bundling from test synth (for example with the CDK context flag that skips asset bundling), because bundling dominates the synth time.

### 1.6 Source-scan tests over the spec files

Scan the text of `e2e/*.smoke.spec.ts` and fail when a file breaks a convention. Each rule below comes from an incident.

[`assets/smoke-spec-conventions.test.ts`](../assets/smoke-spec-conventions.test.ts) is the whole scan, to copy as `shared/test/smoke-spec-conventions.test.ts`. Read it when you write or change the scan; to review one or answer a question about it, this section is enough. It first asserts that the scan found more than 5 spec files, because an empty list would make every rule pass. Then, for each spec, it pins these rules:

- A spec that seeds data closes it in `afterEach`: each green run left about eight open cases in the shared queue until it held 109.
- Each person opens in `browser.newContext()`, never a second tab, because tabs of one context share `localStorage` and the second person inherited the first session.
- The console token is seeded before the first `goto` to the console, because after navigation the app has already redirected to the Google login.
- No spec reads page 1 of a shared queue as if it were the whole queue, because other runs add rows and the row you seeded may be on page 2.
- Every spec that opens a page calls `guardExternalServices` and asserts `attempts()` is empty: a new spec that forgets it is the only way a paid call reaches a blocking lane. The guard is in [08, section 1](./08-third-parties-payments-and-messaging.md).

These checks are text matches, so they are approximate on purpose. Tune each regex to the helper names of your suite, and keep the `if (...)` precondition so that a spec that does not use the helper is not forced to.

### 1.7 Docs-honesty test

Docs for agents are part of the harness. In one production project a doc said "do not merge without a green e2e run on your branch." The branch run could not deploy the new app code, so a green run only proved the old code, and an unsupervised night agent obeyed the doc, failed, and stopped *(observed)*. The fix rewrote the rule (see [06, section 9](./06-ci-workflows.md)) and added a test that bans the old wording and requires the new one in every place that repeats the rule.

```ts
// shared/test/e2e-docs-honesty.test.ts
import { expect, it } from 'vitest';
import { readText } from './helpers/harness';
const PLACES = ['docs/agents/e2e.md', 'CLAUDE.md', '.github/workflows/e2e-reminder.yml'];
it('no doc promises a gate the branch dispatch cannot give: a night agent obeyed it, failed, and stopped', () => {
  for (const p of PLACES) {
    expect(readText(p), p).not.toMatch(/do not merge without a green (e2e )?run/i);
    expect(readText(p), p).not.toMatch(/wait for the green before merging/i);
  }
});
it('every place that repeats the rule says where the green arrives and that AccessDenied is not a blocker', () => {
  for (const p of PLACES) {
    expect(readText(p), p).toMatch(/deploy-dev\.yml/);
    expect(readText(p), p).toMatch(/after (the )?merge/i);
    expect(readText(p), p).toMatch(/AccessDenied/);
  }
});
it('the IAM recipe that replaces the trust policy keeps every trusted ref: update-assume-role-policy replaces the whole document', () => {
  for (const ref of ['refs/heads/main', 'refs/heads/agent-development-*']) {
    expect(readText('docs/agents/e2e.md')).toContain(ref);
  }
});
```

Use this pattern for any doc that tells an agent to wait for something. State the false claim as a banned pattern, and state the true claim as a required pattern in each place.

### 1.8 IAM and synth tests

Synthesize the CDK stacks in a test and assert on the template. These tests pin the properties that the e2e suite can never observe, because they concern what the test role is not allowed to do. The two that matter most:

```ts
// infra/test/e2e-harness-stack.test.ts
import { Template } from 'aws-cdk-lib/assertions';
import { expect, it } from 'vitest';
import { synthAuthStack, synthBackendStack } from './helpers';
const ORIGINS: Record<string, string> = { dev: 'https://dev.app.example.test', staging: 'https://staging.app.example.test', prod: 'https://app.example.test' };
it('no production app client enables a password flow: the password flows exist only for the synthetic users outside production', () => {
  const t = Template.fromStack(synthAuthStack('prod'));
  const clients = Object.values(t.findResources('AWS::Cognito::UserPoolClient'));
  expect(clients.length).toBeGreaterThan(0);
  for (const c of clients) {
    const flows: string[] = c.Properties.ExplicitAuthFlows ?? [];
    expect(flows.filter((f) => /PASSWORD_AUTH/.test(f) && f !== 'ALLOW_REFRESH_TOKEN_AUTH')).toEqual([]);
  }
});
it.each(Object.keys(ORIGINS))('the %s API allows exactly the CloudFront origin of its stage: the browser blocks calls from the app to execute-api otherwise, and an origin frozen at the first deploy surfaces only in the deployed smoke', (stage) => {
  Template.fromStack(synthBackendStack(stage)).hasResourceProperties('AWS::ApiGatewayV2::Api', {
    CorsConfiguration: { AllowOrigins: [ORIGINS[stage]], AllowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] },
  });
});
it('staging and prod carry no TURN_DEADLINE_PROBE_PHRASE: the dev-only knob that forces the turn deadline must never reach a stack real customers use', () => {
  for (const stage of ['staging', 'prod']) {
    expect(JSON.stringify(Template.fromStack(synthBackendStack(stage)).toJSON()), stage).not.toContain('TURN_DEADLINE_PROBE_PHRASE');
  }
});
it('no stack synthesized without mockPaymentsEnabled has mock payment resources: the mock provider must not exist in a stack real customers use', () => {
  expect(JSON.stringify(Template.fromStack(synthBackendStack('prod')).toJSON())).not.toMatch(/MockPayment/i);
});
```

The verdict bucket asymmetry (staging role writes and cannot read, production role reads and cannot write) has its own test in [07, section 4](./07-release-gate.md). The password-flow rule is explained in [03, section 1](./03-auth-and-test-users.md). The phrase test belongs to the forcing pattern in [09, section 4](./09-llm-and-agent-flows.md), and the mock-payments test to the mock provider in [08, section 2](./08-third-parties-payments-and-messaging.md).

### 1.9 When the repo has no workspace test runner

If the repo has no Vitest or Jest workspace, put the guard tests in `scripts/` as `node --test` files. They need no dependencies except `yaml`, or none at all if they read comment-stripped text. This variant pins the same rules as section 1.2 for a post-merge workflow:

```js
// scripts/e2e-post-merge.workflow.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const text = readFileSync(new URL('../.github/workflows/e2e-post-merge.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
test('no pull_request trigger: the workflow has id-token write and a trigger would give the role to any pull request', () => {
  assert.doesNotMatch(text, /^\s*pull_request\s*:/m);
});
test('the concurrency group uses the stack variables, not the ref, and never cancels', () => {
  assert.match(text, /group:.*vars\.STAGE/);
  assert.doesNotMatch(text, /group:.*github\.ref/);
  assert.match(text, /cancel-in-progress:\s*false/);
});
```

Pin every action by SHA the same way with a regex over `uses:` lines, as in section 1.2. Then add a CI job that runs `node --test scripts/` on every pull request with no `paths:` filter. Without that job the tests are decoration (see section 1.1).

### 1.10 Shell logic in the workflow gets its own test

When a workflow step contains awk, grep, or jq logic that decides pass or fail, move the logic into a script under `scripts/ci/` and let the test run the same script against a fixture. A test that re-implements the logic proves the copy, not the workflow. [11, section 1](./11-skipped-scripts-and-photos.md) gives a worked example.

---

## Verification

Commands that confirm the harness checks run and pass:

```bash
# Guard tests, as CI runs them
npm test -w shared                        # Vitest workspace variant
node --test scripts/                      # node --test variant
# The e2e typecheck, the way the guard runs it
npx tsc -p e2e/tsconfig.json --noEmit
# Prove CI reaches the guard tests: the job that runs them must have no paths filter
grep -n "paths" .github/workflows/pr-checks.yml || echo "no paths filter"
```

Break one rule on purpose in a scratch branch (add `pull_request:` to the post-merge workflow) and confirm the matching guard test goes red. A guard that has never gone red is the same kind of false green as [12, section 3](./12-proving-a-fix.md).

Test checklist, one per mechanical rule introduced in this file:

- [ ] Deploy workflow: first step rejects refs the trust policy does not accept (1.2).
- [ ] Deploy workflow: concurrency group `deploy-dev-${{ github.ref_name }}`, `cancel-in-progress: false` (1.2).
- [ ] Workflows with `id-token: write` have no `pull_request` trigger (1.2, 1.9).
- [ ] Smoke runs after `cdk deploy` and the frontend deploy, and before the evals; the report upload runs after the smoke (1.2).
- [ ] `SMOKE_URL` is derived from outputs with `jq`, fails on `null`, and is never a literal (1.2).
- [ ] No `continue-on-error` on the smoke step (1.2).
- [ ] Artifact upload has `always()` and `steps.smoke.conclusion != 'skipped'` (1.2).
- [ ] Every job has `timeout-minutes` (1.2).
- [ ] Every third-party action in `deploy-dev.yml` and `deploy-prod.yml` is pinned by a 40-hex SHA (1.2, 1.9).
- [ ] Gate job of the pull-request checks needs every other job (1.3).
- [ ] Gate job has `if: ${{ !cancelled() }}` (1.3).
- [ ] The workflow that runs the guard tests exists and has no `paths` filter (1.3).
- [ ] Smoke config: `workers` pinned, every project of both configs at 0 retries outside CI, each probe project at 1 retry in CI, probe files in the `testIgnore` of the local and smoke projects, probe projects present only with their env var, `@playwright/test` pinned exactly (1.4).
- [ ] Root `typecheck` script covers `e2e/tsconfig.json`; `tsc` lists every `.ts` file, with a vacuity check; `tsc` reports nothing; 60 s timeout (1.5).
- [ ] Spec scan finds more than 5 specs (1.6).
- [ ] Specs that seed call the cleanup in `afterEach` (1.6).
- [ ] Specs with two people use `.newContext(` (1.6).
- [ ] Console specs seed the token before `goto` (1.6).
- [ ] No spec reads page 1 of a shared queue as the whole queue (1.6).
- [ ] Every spec that opens a page calls `guardExternalServices` and asserts `attempts()` is empty (1.6).
- [ ] Docs ban the old wording and require the new one in every place that repeats the rule (1.7).
- [ ] The trust-policy recipe in the docs lists every accepted ref (1.7).
- [ ] No production app client enables a password flow (1.8).
- [ ] Each stage's API allows exactly its CloudFront origin (1.8).
- [ ] Staging and prod carry no `TURN_DEADLINE_PROBE_PHRASE`; no stack without `mockPaymentsEnabled` has mock payment resources (1.8).

## Further reading

- [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md): deploy workflow basics.
- GitHub Docs, [Using jobs in a workflow](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-jobs-in-a-workflow) (behaviour of `needs` and skipped jobs).
- GitHub Docs, [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).
