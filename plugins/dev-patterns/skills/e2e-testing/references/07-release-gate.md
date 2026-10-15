# Gating a release on per-commit e2e verdicts

**Builds:** A private S3 archive that holds one verdict file per lane and per commit, a staging role that can write verdicts but not read them, a production role that can read them but not write them, a gate script that blocks the production deploy unless every required verdict for the tagged commit says `passed`, and a production workflow that runs the gate before it deploys anything.

**When to use:** The project has a production environment and you want the e2e result of the exact commit to decide whether it can ship. Also use it when a tag was cut on a commit that never went through staging, when an opt-in probe must be able to block a release without blocking the staging deploy, or when you need to download the report of an old commit.

**Prerequisites:** [`06-ci-workflows.md`](./06-ci-workflows.md) for the OIDC roles and the staging deploy workflow that publishes the verdicts. [09, section 2](./09-llm-and-agent-flows.md) for the probe that writes `ai-status.json`.

> Verified on 2026-10-14 against `@playwright/test` 1.64, `aws-cdk-lib` 2.x, and Node 22 (`node:test`); the projects behind the *(observed)* facts ran Playwright 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Why the gate works per commit
2. The archive
3. Publishing verdicts
4. The write and read asymmetry
5. The gate script
6. The production workflow
7. Timing and freshness
8. Retrieving a report

---

## Section 1: Why the gate works per commit

The production deploy has to prove that the exact commit being tagged passed in staging. A re-run of the suite at release time would test what staging holds now, which can be a later commit, so a green re-run says nothing about the tag.

The gate therefore reads evidence that the staging deploy wrote for that commit. The evidence is a verdict. The gate never runs Playwright and never opens a browser.

Three rules keep the gate honest before it reads any verdict:

| Rule | Reason |
|---|---|
| Re-run the unit tests on the tagged commit in the production workflow | A tag skips the pull request checks, so nothing else proves the tagged commit passes the normal test command *(observed)* |
| Assert the tag is reachable from `main` before any job assumes an AWS role | A tag cut on a side branch has never been through the merge checks, and the production role should not be assumed for it |
| Evaluate every required verdict, not only the first red one | One run should tell the person everything to fix before tagging again |

The reachability check is one command, run after a checkout with full history:

```bash
git fetch --force --tags origin main
SHA=$(git rev-parse HEAD)
git merge-base --is-ancestor "$SHA" origin/main || {
  echo "::error::Only deploy tags already merged to main."
  exit 1
}
```

`actions/checkout` fetches one commit by default, so the checkout step needs `fetch-depth: 0`. Without it `merge-base --is-ancestor` fails for the wrong reason.

---

## Section 2: The archive

The archive is a private S3 bucket. Screenshots in the report show test-user data, so the bucket blocks all public access, encrypts at rest, accepts only TLS, and is never served by CloudFront.

S3 is the right place and Actions artifacts are not, because artifacts belong to one run and expire (90 days by default, and the retention is shorter when a workflow sets it). The gate has to answer "did this commit pass" for a commit tagged weeks after its staging run.

The bucket is the durable record of what passed, so it uses `RemovalPolicy.RETAIN` and deleting the stack does not delete it. A lifecycle rule expires objects after 365 days, because the gate only needs recent commits.

[`assets/e2e-archive-stack.ts`](../assets/e2e-archive-stack.ts) is the whole stack, to copy as `infra/lib/e2e-archive-stack.ts`. Read it when you write or change the archive stack; to review one or answer a question about it, this section is enough.

Deploy this stack once, outside the per-stage deploy workflow. The deploy roles are granted access to the bucket by the stack that creates the roles (section 4), and a deploy role cannot create the trust that lets it deploy.

### 2.1 Layout and verdict schema

```
s3://<bucket>/e2e-reports/<sha>/report/**     full Playwright HTML report of the blocking suite
s3://<bucket>/e2e-reports/<sha>/status.json   verdict of the blocking suite (smoke lane)
s3://<bucket>/e2e-reports/<sha>/ai-status.json  verdict of the assistant probe
```

Each verdict is a small JSON file with exactly these four fields:

```json
{
  "sha": "9f2c1d0e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d",
  "status": "passed",
  "runUrl": "https://github.com/example-org/acme/actions/runs/1234567890",
  "completedAt": "2026-10-14T15:04:05Z"
}
```

`status` is `"passed"` or `"failed"`. Any other value, a missing field, or invalid JSON blocks the gate. `runUrl` is what the person clicks to see why the commit is red. `completedAt` is recorded for the freshness check in section 7.

---

## Section 3: Publishing verdicts

The workflow that runs a lane writes the lane's verdict at the end of the job, on pass and on fail. A missing verdict has to mean "this commit never ran", and a red run has to mean "ran and failed". If the workflow wrote a verdict only on pass, the gate could not tell the two apart and could not show the run URL of the failure.

### 3.1 The publish step in the staging deploy

```yaml
# .github/workflows/deploy-staging.yml (excerpt; the job already assumed the staging role)
      - name: Run the blocking suite
        id: e2e
        run: npx playwright test --config e2e/playwright.smoke.config.ts

      - name: Publish report and verdict
        # Run on pass and on fail. Skip when the run was cancelled or the suite never started:
        # in those cases the right evidence is "no verdict".
        if: ${{ !cancelled() && (steps.e2e.outcome == 'success' || steps.e2e.outcome == 'failure') }}
        env:
          BUCKET: ${{ vars.E2E_REPORTS_BUCKET }}
          SHA: ${{ github.sha }}
          E2E_OUTCOME: ${{ steps.e2e.outcome }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          set -euo pipefail
          STATUS=$([ "$E2E_OUTCOME" = "success" ] && echo passed || echo failed)
          aws s3 cp e2e/playwright-report "s3://$BUCKET/e2e-reports/$SHA/report" --recursive --no-progress
          printf '{"sha":"%s","status":"%s","runUrl":"%s","completedAt":"%s"}\n' \
            "$SHA" "$STATUS" "$RUN_URL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > status.json
          aws s3 cp status.json "s3://$BUCKET/e2e-reports/$SHA/status.json" --no-progress
```

Three details matter here:

- The `if` uses `steps.e2e.outcome`, not `steps.e2e.conclusion`. With `continue-on-error: true` the conclusion is `success` even when the step failed, and the outcome is the raw result. Leave `continue-on-error` off the smoke step ([10, section 1](./10-guard-tests.md)).
- The report folder is uploaded before the verdict, so a verdict never points at a report that is still being copied.
- The report needs the HTML reporter enabled ([02, section 3](./02-config-runtime.md)).

### 3.2 One verdict file per lane

Each lane writes its own file: `status.json` for the blocking suite and `ai-status.json` for the assistant probe. A rerun of one probe then cannot overwrite the verdict of another lane.

The probe runs in its own workflow, triggered after the staging deploy succeeds ([06, section 3](./06-ci-workflows.md)). It never blocks that deploy, and it opens an alert issue when it fails ([06, section 6](./06-ci-workflows.md)). Its verdict blocks only the production gate.

```yaml
# .github/workflows/assistant-probe.yml (excerpt)
      - name: Publish probe verdict
        if: ${{ !cancelled() && (steps.probe.outcome == 'success' || steps.probe.outcome == 'failure') }}
        env:
          BUCKET: ${{ vars.E2E_REPORTS_BUCKET }}
          SHA: ${{ github.event.workflow_run.head_sha || github.sha }}
          PROBE_OUTCOME: ${{ steps.probe.outcome }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          set -euo pipefail
          STATUS=$([ "$PROBE_OUTCOME" = "success" ] && echo passed || echo failed)
          printf '{"sha":"%s","status":"%s","runUrl":"%s","completedAt":"%s"}\n' \
            "$SHA" "$STATUS" "$RUN_URL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ai-status.json
          aws s3 cp ai-status.json "s3://$BUCKET/e2e-reports/$SHA/ai-status.json" --no-progress
```

The SHA comes from `workflow_run.head_sha`, the commit the staging deploy built. `github.sha` in a `workflow_run` workflow is the latest commit of the default branch, which can be a later commit than the one that was deployed.

If the blocking suite fails, the probe workflow does not start (its trigger requires a successful deploy), so the commit has no `ai-status.json` either. The gate reports both verdicts, and the first one explains the second.

---

## Section 4: The write and read asymmetry

The staging role can write verdicts and cannot read them. The production role can read verdicts and cannot write them. A production deploy that could write to the archive could forge the evidence that lets it deploy, so the split is deliberate.

```ts
// infra/lib/github-oidc-stack.ts (excerpt)
import * as iam from 'aws-cdk-lib/aws-iam';

// stagingRole and prodRole are the two OIDC roles created earlier in this stack;
// reportsBucket is imported by name from the archive stack's output.
stagingRole.addToPolicy(new iam.PolicyStatement({
  sid: 'E2eReportsPublish',
  actions: ['s3:PutObject'],
  resources: [reportsBucket.arnForObjects('*')],
}));

prodRole.addToPolicy(new iam.PolicyStatement({
  sid: 'E2eReportsRead',
  actions: ['s3:GetObject'],
  resources: [reportsBucket.arnForObjects('*')],
}));

prodRole.addToPolicy(new iam.PolicyStatement({
  sid: 'E2eReportsList',
  actions: ['s3:ListBucket'],
  resources: [reportsBucket.bucketArn],
}));
```

The production role also gets `s3:ListBucket`. When the caller lacks that permission, S3 answers a missing key with `403 Access Denied` instead of `404 Not Found` (documented for `GetObject`: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html>). With the permission, a missing verdict is a clean 404, and a 403 then means the role is misconfigured, which is a different problem from "never ran".

The gate script treats every failed read as "no verdict" (section 5). The error text from the AWS CLI goes into the reason, so a 403 and a 404 stay distinguishable in the log.

### 4.1 A template test that pins both directions

This test fails when someone gives the production role write access or the staging role read access. The mutation it prevents is quiet: nothing breaks until someone forges or leaks evidence.

[`assets/github-oidc-stack.test.ts`](../assets/github-oidc-stack.test.ts) is the whole test, to copy as `infra/test/github-oidc-stack.test.ts`. Read it when you write or change this test; to review it or answer a question about it, this section is enough.

Wildcards such as `s3:*` or `s3:Put*` slip past an exact `toContain`. If the stack ever uses wildcards for S3 actions, extend `actionsOf` to expand them, or fail the test on any `s3:*` action.

A second test pins the bucket itself: `PublicAccessBlockConfiguration` has all four flags true, `BucketEncryption` is present, and the bucket policy has a `Deny` with `aws:SecureTransport` false.

---

## Section 5: The gate script

The gate is a Node script with a pure decision function and an injected command runner. The decision function takes the raw text of a verdict and returns an outcome, so every case is unit tested without AWS. The command-line wrapper runs only when the file is executed directly.

The script is ESM (`.mjs`), has no dependencies, and runs on the runner's preinstalled Node and AWS CLI. [`assets/e2e-gate.mjs`](../assets/e2e-gate.mjs) is the whole script, to copy as `scripts/e2e-gate.mjs` when you build the gate or change what it checks. To review a gate or explain why it blocked, the parts and choices below are enough:

- `fetchVerdict` reads `s3://<bucket>/e2e-reports/<sha>/<file>` and returns the raw text, or a marker with the error text when the read fails. A missing key (404) and a denied read (403) both land there, and the error text tells them apart.
- `evaluate` is the pure decision: a verdict lets the release through only when its `sha` is the requested commit and its `status` is exactly `"passed"`.
- `runGate` evaluates every required verdict (`SUITE_VERDICT` for `status.json`, `AI_VERDICT` for `ai-status.json`) before deciding, so one run reports every red verdict.
- `main` checks the arguments, writes one line per verdict to the job summary with the archive path and the command that fetches the report, and exits.

Design choices that carry a reason:

- `aws s3 cp ... -` writes the object to stdout, so the script needs no temporary file and no SDK dependency.
- `evaluate` checks the `sha` inside the file against the requested one, so a verdict copied to the wrong prefix cannot pass.
- Missing, corrupt, and red are three distinct messages, because the fix differs: wait or deploy to staging, fix the workflow, or fix the failing test.
- Exit code 2 is for a bad invocation and 1 is for a blocked release, so a caller can tell a typo from a real block.
- The script never retries a read. A retry would hide a permission error behind a delay.

### 5.1 Unit tests

The tests run with `node --test`, which needs no extra dependency. They cover the decision function and the read layer with a fake runner. [`assets/e2e-gate.test.mjs`](../assets/e2e-gate.test.mjs) has the fourteen tests, to copy next to the script. Read it when you write or change the tests; to review them, this section is enough: the first twelve cover missing, corrupt, red, and green verdicts, two probes, and the summary; the last two pin the `sha` check and the explicit `"passed"` comparison.

Run them in the workspace that CI already tests, and confirm the CI test command picks the file up. Guard tests that nobody ran were found in two projects *(observed)*; see [10, section 1](./10-guard-tests.md).

A workflow test also pins the contract between the writer and the reader: the file names and JSON keys the publish steps write must be the ones `SUITE_VERDICT`, `AI_VERDICT`, and `evaluate` read. Without it, someone renames `ai-status.json` in the workflow and the gate blocks every release with "never ran", or worse, a probe is dropped from the gate list and stops being required.

---

## Section 6: The production workflow

The production deploy is started by hand with `workflow_dispatch` and a `tag` input. The input is the human gate.

GitHub Free private repositories cannot use required reviewers or other deployment protection rules: the docs state "Users with GitHub Free plans can only configure environments for public repositories" (<https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>). A workflow written as "push a `v*` tag and the reviewer approves" therefore deploys to production with no approval at all. The API refused to create the protection rule with a 422 *(observed)*.

When the plan does have environment reviewers, keep the dispatch trigger and add the reviewers on top. Stay on the dispatch trigger instead of a tag-push trigger, because a push is easier to do by accident than a dispatch.

[`assets/deploy-prod.yml`](../assets/deploy-prod.yml) is the whole workflow, to copy when you build the production deploy or change its jobs. It has four jobs: `assert-on-main` resolves the tag and fails unless the commit is on `main`; `verify` runs the typecheck and the normal test command on that commit; `e2e-gate` assumes the production role and runs `node scripts/e2e-gate.mjs "$SHA"`; `deploy` deploys. The `deploy` job ends at a placeholder for your own role, `cdk deploy`, and post-deploy check.

Why each piece is there:

- `assert-on-main` runs first and has no AWS access. `e2e-gate` and `deploy` both `need` it, so a tag outside `main` never reaches an AWS role.
- `e2e-gate` is its own job and not a step in `deploy`, so a red gate is visible as a separate red box and the deploy job never starts.
- `deploy` lists all three jobs in `needs`. Listing only `e2e-gate` would let the deploy start when `verify` is red, because a job runs when its direct needs succeed.
- `environment: prod` on the gate job is there for the OIDC trust condition. If the trust policy matches `repo:<org>/<repo>:environment:prod`, the production role cannot be assumed from a job that did not declare the environment ([06, section 2](./06-ci-workflows.md)).
- The `concurrency` group queues two production dispatches instead of cancelling one in the middle of `cdk deploy`.

A workflow test pins the shape: `deploy` has `needs` containing `e2e-gate`, `verify`, and `assert-on-main`; the trigger is `workflow_dispatch` and not `push`; `e2e-gate` calls `scripts/e2e-gate.mjs`. See [10, section 1](./10-guard-tests.md) for how to parse the YAML.

Docs and comments about the gate go stale quickly. In one project a workflow comment said the gate checked one verdict after the script had started requiring two, and a runbook said a local `deploy:prod` script ran the gate when only the workflow job does *(observed)*. Name the job and the script in the docs, and add the wording to the docs-honesty test in [10, section 1](./10-guard-tests.md).

---

## Section 7: Timing and freshness

### 7.1 A probe writes its verdict after the deploy

The blocking suite writes `status.json` inside the staging deploy job. The assistant probe starts after that job succeeds and writes `ai-status.json` a few minutes later. Tagging the moment the staging deploy turns green can block on a verdict that does not exist yet.

The gate's "missing" message says so: wait for the probe run to finish, then tag again. The message is part of the unit tests (case 3), so nobody shortens it to "verdict not found".

Alternatives and why the default is to wait:

| Option | Effect |
|---|---|
| Tell the person to wait (default) | One extra dispatch when the person is fast; no hidden polling in the gate |
| The gate polls for the missing verdict for a few minutes | Hides a probe that never started; needs a timeout and a second failure message |
| Make the probe part of the staging deploy | Puts a paid, non-deterministic call in the blocking lane, which [00, section 3](./00-lanes-and-decisions.md) rules out |

### 7.2 Freshness

The gate above accepts a `passed` verdict of any age for that commit. A commit does not change, so an old green stays true for the code. What goes stale is the environment: a probe that passed against last quarter's model or payment sandbox says little about today's.

Add a freshness check when the probe depends on something outside the repository. The check compares `completedAt` with a maximum age and returns its own blocked message.

```js
// scripts/e2e-gate.mjs (addition inside evaluate, after the status check)
const maxAgeMs = (probe.maxAgeDays ?? Infinity) * 24 * 60 * 60 * 1000;
const age = Date.now() - Date.parse(verdict.completedAt);
if (!Number.isFinite(age)) {
  return { ok: false, probe, reason: `The verdict of the ${probe.label} has no valid completedAt.`, runUrl: verdict.runUrl };
}
if (age > maxAgeMs) {
  return { ok: false, probe, reason: `The ${probe.label} passed for ${sha} more than ${probe.maxAgeDays} days ago. Re-run it and tag again.`, runUrl: verdict.runUrl };
}
```

Set `maxAgeDays` on `AI_VERDICT` only. Two unit tests pin it: a verdict older than the limit blocks, and a verdict without `maxAgeDays` on its probe never expires. The bucket lifecycle of 365 days is the only other expiry.

---

## Section 8: Retrieving a report

A private bucket cannot serve a multi-file Playwright report over a plain URL, because the report is an `index.html` plus a `data/` folder and the browser needs all of it. The person who approves a release downloads the report with their own credentials and opens it locally.

```js
// scripts/fetch-report.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const sha = process.argv[2];
const bucket = process.env.E2E_REPORTS_BUCKET;
if (!sha || !bucket) {
  console.error('Usage: E2E_REPORTS_BUCKET=<bucket> node scripts/fetch-report.mjs <40-hex-sha>');
  process.exit(2);
}

const dest = path.join('fetched-reports', sha);
mkdirSync(dest, { recursive: true });
const prefix = `s3://${bucket}/e2e-reports/${sha}`;

// Print the verdict first, so the person sees pass or fail and the run URL before opening anything.
console.log(execFileSync('aws', ['s3', 'cp', `${prefix}/status.json`, '-'], { encoding: 'utf8' }));
execFileSync('aws', ['s3', 'cp', `${prefix}/report`, path.join(dest, 'report'), '--recursive', '--no-progress'], { stdio: 'inherit' });
spawnSync('npx', ['playwright', 'show-report', path.join(dest, 'report')], { stdio: 'inherit' });
```

Add `fetched-reports/` to `.gitignore`, because the screenshots hold test-user data. The command needs credentials that can read the bucket, so it is meant for a person with a read profile, not for the staging role. Locally, set `AWS_PROFILE` before running it.

The gate prints this command in the step summary with the exact SHA, so the approver copies it from the run page.

The human review of screenshots is a visual check on top of the automated verdict. The gate decides on the verdict, and the report is for the person to open when the verdict alone is not enough ([12, section 1](./12-proving-a-fix.md)).

---

## Verification

Commands:

```bash
node --test scripts/e2e-gate.test.mjs
npx vitest run infra/test/github-oidc-stack.test.ts
# Dry run of the gate against a commit you know is green and one that never ran
E2E_REPORTS_BUCKET=<bucket> node scripts/e2e-gate.mjs <green-sha>; echo "exit $?"
E2E_REPORTS_BUCKET=<bucket> node scripts/e2e-gate.mjs 0000000000000000000000000000000000000000; echo "exit $?"
```

The first dry run must print `PASSED` lines and exit 0. The second must print the "never ran" message and exit 1. Run both once with the production role's credentials before the first real release, so the 403 versus 404 behaviour is seen in your own account.

Test checklist, one per mechanical rule:

- [ ] Gate decision: twelve cases for missing, corrupt, red, green, two probes, and the summary (section 5.1)
- [ ] Gate rejects a verdict whose `sha` differs from the requested one
- [ ] Gate rejects any `status` other than `"passed"`
- [ ] Gate freshness: expired and non-expiring verdicts (section 7.2), when the check is enabled
- [ ] IAM template test: staging has `s3:PutObject` and no `s3:GetObject`; production has `s3:GetObject` and `s3:ListBucket` and no `s3:PutObject` (section 4.1)
- [ ] Bucket template test: all four public-access flags, encryption, TLS-only policy, `RETAIN` (section 2)
- [ ] Workflow test: the verdict publish steps use `!cancelled()` with outcome `success` or `failure` (section 3.1)
- [ ] Workflow test: the file names and JSON keys the workflows write match what the gate reads (section 5.1)
- [ ] Workflow test: production `deploy` needs `assert-on-main`, `verify`, and `e2e-gate`; the trigger is `workflow_dispatch` (section 6)
- [ ] Workflow test: `assert-on-main` checks out with `fetch-depth: 0` and runs `merge-base --is-ancestor` (section 1)
- [ ] CI check: the workspace that holds these tests is run by the normal CI test command

## Further reading

- [`00-lanes-and-decisions.md`](./00-lanes-and-decisions.md): which lanes block ([00, section 5](./00-lanes-and-decisions.md)).
- [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md): stages and the deploy workflow this gate sits behind.
- [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md): the assistant evals; this file is the home of the per-commit verdict archive.
- GitHub environments: <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- S3 `GetObject` error behaviour: <https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html>
- Node test runner: <https://nodejs.org/api/test.html>
