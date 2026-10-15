# Running the lanes from GitHub Actions

**Builds:** The GitHub Actions side of the suite: a deploy workflow whose last jobs run the smoke lane against the stack it just deployed, a separate AWS role for tests with a trust policy that matches the branches allowed to run them, triggers and concurrency groups that keep two runs from resetting each other's fixtures, artifacts and alerts that leave evidence when a run goes red, and a short document that tells coding agents which run is the green that counts.

**When to use:** Adding the smoke lane to a deploy workflow, writing or widening the OIDC role the tests assume, deciding how a branch can run the suite, choosing a concurrency key, wiring failure alerts, ordering agent evals after the smoke, or writing the rules an AI agent follows when it has to run or wait for the suite.

**Prerequisites:** [00, section 5](./00-lanes-and-decisions.md) (the three CI shapes) and [01, section 2](./01-config-lanes-and-target.md) (how the config resolves `baseURL`). The deploy workflow itself (stages, `stackSuffix`, pre-deploy checks) is in [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md).

> Verified on 2026-10-14 against `@playwright/test` 1.64, GitHub Actions documentation (events, concurrency, OpenID Connect) and the AWS CLI and DynamoDB IAM documentation; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation. Examples pin actions by major version for readability; production repos pin each action by its full 40-character commit SHA, because a major tag can be moved to different code after you reviewed it (the guard test is in [10, section 1.2](./10-guard-tests.md)).

## Contents

1. The smoke job inside the deploy workflow
2. OIDC roles for tests
3. Triggers
4. Concurrency
5. Artifacts and reports
6. Notifications
7. Agent evals and the smoke
8. Timeouts
9. Rules for AI agents that run or wait for the suite

---

## Section 1: The smoke job inside the deploy workflow

The smoke lane runs in the same workflow that deploys, in the steps right after `cdk deploy`. A red run then means the code that is now deployed is broken, and the person who pushed it sees the result without opening a second workflow ([00, section 5](./00-lanes-and-decisions.md), shape 1).

### 1.1 Order of the steps

The order is fixed, and a guard test pins it ([10, section 1](./10-guard-tests.md)):

1. Guard step: reject refs the OIDC trust policy does not accept (section 2.6).
2. Check out the exact commit.
3. Install dependencies and Playwright's Chromium.
4. Create empty `dist/` stub folders, deploy the backend, build the web bundle with the backend outputs baked in, deploy the frontend (section 1.3).
5. Derive `SMOKE_URL` from the stack outputs and fail when it is `null` or empty.
6. Switch to the test role (section 2.1), then check the preconditions the smoke needs (for example, that the role can read the operator secret with `get-secret-value`, because `describe-secret` succeeds without that permission), so a missing permission fails the run instead of making scripts skip themselves ([11, section 1](./11-skipped-scripts-and-photos.md)).
7. Run the smoke from the repository root, with `npx playwright test --config e2e/playwright.smoke.config.ts` and no `working-directory`, so the report and the photos land in `e2e/playwright-report/` and `e2e/artifacts/`, the paths the upload step reads.
8. Upload artifacts with `if: always()`.
9. Check that the evidence exists.
10. Run agent evals (section 7).
11. Notify on failure (section 6).

### 1.2 Check out and test the exact commit

When the workflow starts from `workflow_run`, check out `github.event.workflow_run.head_sha`. The default checkout of a `workflow_run` workflow is the latest commit of the default branch, not the commit the upstream workflow validated, so a plain checkout deploys and tests the wrong code. Direct pushes and dispatches use `github.sha` or the dispatched ref. One expression covers both: `ref: ${{ github.event.workflow_run.head_sha || github.sha }}`.

### 1.3 Two-phase deploy when the bundle bakes backend outputs

The web build reads the API URL, pool ids, and agent ARN from `VITE_*` or `EXPO_PUBLIC_*` variables at build time. On the first deploy of a new stack those values do not exist yet, so the workflow deploys the backend first, reads its outputs, builds the web bundle with them, and then deploys the frontend. The same order on every run keeps the first deploy of a fresh `dev-<developer>` stack from being a special case *(observed)*. `ENV_SUFFIX` is the stack suffix such as `dev-alex`, so the stacks are `Acme-Backend-${ENV_SUFFIX}` and `Acme-Frontend-${ENV_SUFFIX}`. The deploy steps run with `working-directory: infra` and write `--outputs-file cdk-outputs-backend.json` and `--outputs-file cdk-outputs-frontend.json`, which are `infra/cdk-outputs-backend.json` and `infra/cdk-outputs-frontend.json` from the repository root, where the later steps read them.

Frontend stacks that reference `apps/web/dist` as a CDK asset fail at synth when the folder does not exist yet. Create empty stub folders before the backend deploy (`mkdir -p apps/web/dist apps/console/dist`), because `cdk deploy` synthesizes every stack in the app even when you deploy one *(observed)*.

### 1.4 Derive the target from the stack outputs

The smoke config resolves `SMOKE_URL` before anything else and throws when it is empty ([01, section 2](./01-config-lanes-and-target.md)). The workflow supplies it from the file `cdk deploy --outputs-file` wrote. A `jq` expression that matches nothing prints the string `null`, so the step checks for that value explicitly. A stale default URL once let the smoke lane skip itself against a dead distribution *(observed)*.

```yaml
      - name: Derive SMOKE_URL from the stack outputs
        id: target
        run: |
          url="$(jq -r '.[] | .AppUrl // empty' infra/cdk-outputs-frontend.json | head -n1)"
          if [ -z "$url" ] || [ "$url" = "null" ]; then
            echo "::error::AppUrl missing from the frontend stack outputs"; exit 1
          fi
          echo "SMOKE_URL=$url" >> "$GITHUB_ENV"
```

The step runs from the repository root. The build step also appends `API_URL`, `USER_POOL_ID`, and `USER_POOL_CLIENT_ID` to `$GITHUB_ENV`, and the smoke step's `env` sets `QA_FREE_SECRET_ID`, `QA_PREMIUM_SECRET_ID`, and `QA_OPERATOR_SECRET_ID` to `acme/${ENV_SUFFIX}/e2e/<role>`, the variables that setup and the specs read. [03, section 2.1](./03-auth-and-test-users.md) shows the setup file reading them, and [03, section 3.1](./03-auth-and-test-users.md) explains the secret names. The smoke step also runs from the repository root, with the config given as `--config e2e/playwright.smoke.config.ts`.

The `.[] | .AppUrl // empty` filter works because `--outputs-file` writes `{ "<StackName>": { "<OutputName>": "<value>" } }`. Match on the output name, and pick the stack by name when two stacks export the same output name.

### 1.5 The complete workflow

[`assets/deploy-dev.yml`](../assets/deploy-dev.yml) is the whole workflow, with the steps of section 1.1 in order. The file starts with a comment to pin each action by its full commit SHA before use, because the guard test fails on tags. Read it when you write the deploy workflow of a project or add a step to one. To review a workflow or answer a question about one step, sections 1.1 to 1.4 are enough.

---

## Section 2: OIDC roles for tests

### 2.1 Two roles, not one

| Role | Used by | Can do | Trusted refs |
|---|---|---|---|
| `acme-ci-deploy` | Deploy steps | CloudFormation, IAM, Lambda, S3, CloudFront through the CDK bootstrap roles | `main`, and the personal-stack branches only when the workflow deploys personal stacks |
| `acme-e2e-ci` | Test steps, probes, branch dispatches | Read stack outputs, read the test-user secrets, reset test tables, invoke the one Lambda a test triggers, sign in the QA users | `main` plus every branch pattern allowed to run tests |

A branch that an agent writes without supervision receives only the test role. The deploy role has write access to the account, and handing it to a branch means anyone who can push that branch can change infrastructure *(observed)*. A workflow that both deploys and tests switches credentials in the middle of the job: configure the deploy role, deploy, then run `configure-aws-credentials` again for the test role with a distinct `role-session-name`. These two roles belong to the personal-stack workflow; the staging role that publishes verdicts and the production role that reads them ([07, section 4](./07-release-gate.md)) are separate roles with their own trust policies.

### 2.2 What the test role needs, and why

| Permission | Scope | Why the test needs it |
|---|---|---|
| `cloudformation:DescribeStacks` | `stack/Acme-*-*/*` with wildcards for stage and suffix | Global setup reads outputs. A role pinned to one developer's suffix failed with `AccessDenied` against the `dev-e2e` stack *(observed)*. |
| `secretsmanager:GetSecretValue` | The exact test-user and webhook secrets, by name prefix | Sign in as the QA users and sign synthetic webhooks. |
| `dynamodb:Scan`, `Query`, `DeleteItem` | `table/acme-orders-*` and `/index/*` | Find seed rows and reset fixtures. |
| `lambda:InvokeFunction` | The one reconcile function tests trigger | A test forces a job that would otherwise run on a schedule. |
| `bedrock:InvokeModel` | The model that judges the evals | The evals step grades the agent's answers with a model, and the call is made with the test role. |
| `bedrock-agentcore:InvokeAgentRuntime` | The agent runtime of the stack | The evals step calls the deployed agent to get the answers it grades. |
| `cognito-idp:AdminInitiateAuth` | `userpool/*` in the account | Sign in the QA users. Creating them is the provisioning script's job, run with admin credentials ([03, section 3](./03-auth-and-test-users.md)). The pool id changes with every stack, and the role is created before the stack exists, so it cannot name the pool. |

The evals step runs under the test role, so the two Bedrock permissions above belong to it and not to the deploy role. Give the role the secrets through the secret's resource policy rather than an identity policy when the role is created outside the repository: in the same account, an allow in the resource policy is enough *(observed)*. Why the credentials live in Secrets Manager is in [03, section 3.1](./03-auth-and-test-users.md).

When a test only needs the keys of a table, restrict the scan to keys so the role can never return item contents. DynamoDB documents two condition keys for this: `dynamodb:Attributes` lists the top-level attributes a request names, and `dynamodb:Select` constrains the request's `Select` parameter. Without a `ProjectionExpression`, a read returns every attribute whatever `dynamodb:Attributes` says, so the policy also requires `Select` to be `SPECIFIC_ATTRIBUTES`.

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

// Inside the stack that owns the CI role. Table name pattern covers every stage and suffix.
role.addToPolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:Scan'],
    resources: [`arn:aws:dynamodb:${region}:${account}:table/acme-threads-*`],
    conditions: {
      'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['PK', 'SK'] },
      StringEquals: { 'dynamodb:Select': 'SPECIFIC_ATTRIBUTES' },
    },
  }),
);
```

The DynamoDB documentation says that when you use `dynamodb:Attributes` you must list every primary-key and index-key attribute of the table, otherwise DynamoDB cannot use the keys to run the request. The scan in the test then passes `ProjectionExpression: 'PK, SK'` and `Select: 'SPECIFIC_ATTRIBUTES'`. The cost of leaving this out is that the test role reads conversation content it never needed.

Delete permissions nobody exercises. Two inline policies stayed attached to a CI role for months after the code that used them was gone, and an unused permission is attack surface with no benefit *(observed)*. A guard test over the CDK template or a quarterly review of the role's last-used data catches the drift.

### 2.3 Trust policy `sub` patterns

The `sub` claim of the GitHub OIDC token names where the run came from. The formats GitHub documents are:

| Run source | `sub` value |
|---|---|
| Branch | `repo:<org>/<repo>:ref:refs/heads/<branch>` |
| GitHub Environment | `repo:<org>/<repo>:environment:<name>` |
| Wildcard example in the GitHub docs | `repo:<org>/<repo>:*` (any branch, pull-request merge ref, or environment) |

Use `StringLike` with the exact `aud` check, and list each allowed branch pattern on its own line:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:<org>/<repo>:ref:refs/heads/main",
            "repo:<org>/<repo>:ref:refs/heads/agent-development-*"
          ]
        }
      }
    }
  ]
}
```

When the repository's plan supports GitHub Environments with protection rules, scope the deploy role by environment (`environment:staging`, `environment:prod`) so the prod role cannot be assumed except through the gated environment, and declare `environment:` on every job that assumes a role, including the release gate job ([07, section 6](./07-release-gate.md)). On GitHub Free, private repositories get no protection rules, so the environment only shapes the `sub` value ([07, section 6](./07-release-gate.md)).

GitHub's documentation also states that repositories created after July 15, 2026 use a different default `sub` format that includes the owner and repository ids. Read the `sub` of a real token (print it from a throwaway job with `id-token: write`) before copying the patterns above into a trust policy for a new repository.

Writing the role by hand outside the repository is acceptable for the first version. The trust policy is the security boundary, not the role ARN, so a hardcoded ARN in the workflow file is fine. Record the policy document in `docs/agents/e2e.md` so the next person can recreate the role.

### 2.4 Change the trust policy without losing `main`

`aws iam update-assume-role-policy --policy-document` takes the complete trust policy document. The AWS CLI reference documents the parameter as "the policy that grants an entity permission to assume the role", and the underlying IAM operation overwrites the existing document. A command that lists only the new branch pattern removes `main`, and the next deploy fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. Always include every ref that should stay trusted, then read the result back:

```bash
aws iam update-assume-role-policy \
  --role-name acme-e2e-ci \
  --policy-document file://trust-policy.json

aws iam get-role --role-name acme-e2e-ci --query 'Role.AssumeRolePolicyDocument'
```

A dispatch from a branch the policy did not list died this way for weeks while a document claimed the policy was already widened *(observed)*. Check the live role, not the document.

### 2.5 Grant `id-token: write` only to workflows that run trusted code

A workflow with `id-token: write` that triggers on `pull_request` hands the OIDC token to any pull request, because opening one is enough to start the run. Tests that need AWS run on `push`, `workflow_dispatch`, or `workflow_run`, where someone with write access already chose to start them. Workflows triggered by `pull_request` stay read-only: `contents: read`, and no AWS step. A guard test asserts both ([10, section 1](./10-guard-tests.md)).

### 2.6 A guard step that fails in seconds

The first step of every workflow that assumes a role checks `GITHUB_REF_NAME` against the patterns the trust policy accepts and exits with a clear message (step 1 in section 1.1). Without it, a ref outside the policy fails at `configure-aws-credentials` minutes later with an opaque `AccessDenied` *(observed)*. The guard runs before checkout so it costs a few seconds. A guard test checks the patterns in the workflow and in the trust policy document agree.

---

## Section 3: Triggers

### 3.1 Which trigger for which run

| Trigger | Use it for | Rule |
|---|---|---|
| `push` to `agent-development-*` | Deploy the personal stack and run the smoke | The glob must match any developer's branch; the suffix comes from the branch name, with no allowlist of developers. |
| `workflow_dispatch` | Run the suite by hand from any branch, with inputs for opt-in lanes | See 3.2. |
| `workflow_run` | Chain a deploy after a CI workflow on `main` | See 3.3. |
| `pull_request` | Typecheck, unit tests, local lane, and a comment-only reminder | Read-only permissions, and `id-token: write` is never granted (section 2.5). |

A pull request stacked on another branch gets no checks when a `pull_request.branches` filter excludes its base, because retargeting does not fire the default trigger set. Drop the `branches:` filter, add the `edited` type, and let the concurrency group cancel redundant runs.

### 3.2 `workflow_dispatch` from a branch

GitHub documents that a `workflow_dispatch` workflow triggers only if the workflow file exists on the default branch, and that the "Run workflow" button appears only for such files. Once the workflow has run at least once, you can dispatch it against any branch or tag through the API or `gh workflow run --ref <branch>`. The run uses the code at the ref you dispatch.

Two consequences follow:

- A new e2e workflow cannot be dispatched from a feature branch until it has been merged once. Merge the workflow file first, then iterate on specs from branches.
- A branch dispatch that does not deploy tests whatever is already deployed on the target stack. It validates a spec-only change and never an app change. A pull request that changed app code and shows a green branch dispatch has tested the old app.

Dispatch inputs carry the opt-in lanes (`ai_probe: boolean` and `notifier_real: boolean`, both default `false`, and `notification_phone: string`, the phone number that the real-message run sends to), so the default run never spends money or sends messages ([08, section 3](./08-third-parties-payments-and-messaging.md)).

### 3.3 `workflow_run` runs the default branch's file

GitHub documents that `workflow_run` triggers only if the workflow file exists on the default branch, and the events table lists the default branch as the ref and its latest commit as the SHA for the run. The consequence for e2e: a chain built with `workflow_run` does not run on a feature branch until the workflow merges to the default branch. That is why a project that works in feature branches runs its e2e as a job inside the deploy workflow (section 1) instead of chaining a second workflow *(observed)*. Use `workflow_run` where the upstream run lives on `main`, such as a staging deploy that follows the CI workflow, and read the tested commit from `github.event.workflow_run.head_sha`.

### 3.4 A reminder on pull requests, in its own file

When the smoke runs only after merge ([00, section 5](./00-lanes-and-decisions.md), shapes 1 and 2), a pull request that changes app code has not been tested against the deployed stack yet. A small workflow posts one comment saying so, with `paths:` limited to app code and permissions limited to `pull-requests: write` and `contents: read`. It lives in its own file with no AWS permissions, so nobody can later add `id-token: write` to it by editing a file that already looks harmless *(observed)*. Skip fork pull requests with `if: github.event.pull_request.head.repo.full_name == github.repository`, because GitHub gives the token read-only permissions on forks. A marker string in the comment lets the workflow comment once and update it afterwards.

### 3.5 Skip the deploy when only tests or docs changed

A push that touches only `e2e/`, `docs/`, agent eval files, or root `.md` files does not need a 25-minute deploy. A `changes` step lists the files changed since the last green run of the same workflow on the same branch, not since the previous commit:

```bash
last_green_sha="$(gh run list --workflow deploy-dev.yml --branch "$GITHUB_REF_NAME" \
  --status success --limit 1 --json headSha --jq '.[0].headSha')"
```

After a red deploy, what is deployed is the last green commit, not the previous commit, so a diff against the previous commit would skip a deploy the stack still needs *(observed)*. When every changed file is on the skip list, the job skips build and deploy and runs the smoke against the existing deployment, reading the URL from `aws cloudformation describe-stacks` rewritten into the same JSON shape as `--outputs-file`. Deploy everything on any doubt: a manual dispatch, no previous green run, a force-pushed base, or a failed `git diff`. A `.md` file inside a folder that ships in a Lambda zip does not count as docs. The skip filter always runs the smoke, the evidence guard, and the evals.

---

## Section 4: Concurrency

GitHub documents that, by default, at most one run per concurrency group is `pending` and a newly queued run replaces an older pending one, that running jobs are cancelled only when `cancel-in-progress: true`, and that group names are case-insensitive. Pick the group key from what the runs share.

| Workflow | Group | `cancel-in-progress` | Reason |
|---|---|---|---|
| Deploy to a personal stack | `deploy-dev-${{ github.ref_name }}` | `false` | One branch is one stack. A cancelled `cdk deploy` leaves the stack in `UPDATE_ROLLBACK` and blocks the next deploy *(observed)*. |
| Suite against a shared stack | `e2e-${{ vars.STAGE }}-${{ vars.SUFFIX }}` | `false` | Two runs on one stack reset each other's seed tables. A group keyed on `github.ref` lets them run in parallel and corrupt each other's fixtures. |
| PR checks | `pr-checks-${{ github.event.pull_request.number }}` | `true` | A new push makes the previous run obsolete, and nothing is deployed. |
| Probes that reset the QA users | The deploy's group | `false` | See below. |

Probes that share QA users with the deploy must share its concurrency group. A paid-checkout probe turns the free QA user into a premium user through a real purchase, and the setup project of a concurrent deploy run normalizes that user back to free in the middle of the purchase. Three workflows with three different groups made that race possible even though no incident had happened yet. Put the setup, the probes, and the next deploy in one group.

The default of one pending run means a burst of three pushes runs the first, queues the last, and drops the middle one. That is acceptable for deploys because the last push contains the earlier ones. Verify it before relying on it for a workflow where every run must complete.

---

## Section 5: Artifacts and reports

### 5.1 What to upload, and when

| Artifact | Contents | Condition | Retention |
|---|---|---|---|
| `smoke-<suffix>-<run id>` | HTML report, screenshots, step photos | `if: always() && steps.smoke.conclusion != 'skipped'` | 30 days |
| `deployed-env-<suffix>-<run id>` | `deployed-env.json` (URL, commit, whether this run deployed) | `if: always()` after the step that writes it | 90 days |
| `playwright-report-<run id>` for probes | Report of a failed probe | On failure | 14 days |

`if: always()` matters because the photos of a failure are the evidence, and an upload that runs only on success discards them when they are needed. The second clause, `steps.smoke.conclusion != 'skipped'`, matters because when an earlier step fails and the smoke never runs, `if-no-files-found: error` would report "no files found" and hide the real failure *(observed)*.

The upload needs the HTML reporter ([02, section 3](./02-config-runtime.md)).

Artifacts are scoped to a run and expire. When a release gate needs the report months later, publish it to S3 as well ([07, section 2](./07-release-gate.md)).

### 5.2 Job summary and `deployed-env.json`

Write a job summary with the commit, the URL under test, and whether this run deployed or tested an existing deployment (section 3.5). A reader who opens a red run needs those three facts before reading logs, and a spec-only run that skipped the deploy looks identical to a full run without them.

`deployed-env.json` records what is running on the stack: `{ url, sha, suffix, deployed }`. Humans and agents answer "which commit is on `dev-<developer>` right now?" without opening the deploy logs: agents run the section 9.4 helper, which prints the commit, the conclusion, and the run URL of the last deploy run for the branch, or download the `deployed-env` artifact. Write it before the smoke, so it exists when the smoke fails.

---

## Section 6: Notifications

### 6.1 Page someone when the deploy goes red

A failed deploy-and-smoke run sends a message to a channel (ntfy, Slack, email) from a final `if: failure()` step. A dev app served without its backend for a day and a half with every run red, and nobody noticed until a demo needed the photos *(observed)*. Put the run URL and the stack name in the message, because the person who reads it is usually not the one who pushed.

### 6.2 One open issue per alert label

Probes and post-deploy smokes that never block a merge still need a place where a failure stays visible. On failure, the workflow looks for an open issue with the workflow's label (`ai-analysis-alert`, `checkout-alert`). If one exists, it adds a comment with the run URL and the failing test. If none exists, it creates one. On the next green run, a recovery step closes every open issue with that label and a comment:

```yaml
      - name: Alert issue on failure
        if: failure()
        env:
          GH_TOKEN: ${{ github.token }}
          LABEL: ai-analysis-alert
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          existing="$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number')"
          if [ -n "$existing" ]; then
            gh issue comment "$existing" --body "Still red: $RUN_URL"
          else
            gh issue create --label "$LABEL" --title "AI analysis probe is red" --body "First red run: $RUN_URL"
          fi

      - name: Close alert issues on recovery
        if: success()
        env:
          GH_TOKEN: ${{ github.token }}
          LABEL: ai-analysis-alert
        run: |
          for n in $(gh issue list --label "$LABEL" --state open --json number --jq '.[].number'); do
            gh issue close "$n" --comment "Green again: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
          done
```

The job needs `permissions: issues: write`. One issue per label means the issue carries the history of the outage, and the open issue always shows the current state instead of a stale failure.

---

## Section 7: Agent evals and the smoke

Run the agent evals after the smoke and after the evidence guard. A model judge sometimes grades the same answer differently on two runs. When the evals ran first, one such grading failed the job before the smoke started, and four attempts in a row never reached the smoke *(observed)*. In the order of section 1.1, a flaky judge can only fail the last step, and the smoke result is already recorded.

The smoke and the evals answer different questions, so each runs in its own lane. The smoke asserts that the deployed agent answers at all ([09, section 1](./09-llm-and-agent-flows.md)). The evals score the quality of the answers against a dataset: see [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md) for how to build and run them. If the evals gate a release, publish their result as their own verdict file ([07, section 3](./07-release-gate.md)).

---

## Section 8: Timeouts

Set `timeout-minutes` on every job. The default is six hours, and a run that stalled about 12 minutes inside `npm ci` would have used the whole allowance if nothing had stopped it *(observed)*.

| Job | Budget | Measured basis |
|---|---|---|
| PR checks (typecheck, unit, local lane) | 30 min | Measured run plus headroom. |
| Gate job that aggregates PR results | 5 min | Only reads results. |
| Deploy and smoke on a personal stack | 75 min | 40 min covered build and deploy; the smoke with real sign-ups added the rest *(observed)*. |
| Suite on a dedicated e2e stack | 30 min | Raised from 15 when the stack count grew *(observed)*. |
| Probe | 30 min | One spec plus install. |
| Release gate | 5 min | Reads two files from S3. |

Choose each budget from the measured duration of recent green runs, about 1.5 times the slowest one, and write the measured value in a comment next to the number. A guard test asserts that every job has `timeout-minutes` ([10, section 1](./10-guard-tests.md)).

---

## Section 9: Rules for AI agents that run or wait for the suite

Coding agents work unattended, so the repository has to tell them which run counts and what to do when the platform refuses them. Write these rules once in `docs/agents/e2e.md` and add a short pointer in `CLAUDE.md`.

### 9.1 Which run is the green that counts

| Kind of change | The green that counts | Where it arrives |
|---|---|---|
| Spec-only change in `e2e/` | A branch dispatch of the suite workflow against the existing stack | The Actions run of the dispatch |
| App or infra change | The smoke that runs after the push on the personal stack, which deployed this commit | The `deploy-dev` run for the branch |
| Change that touches a probe's subject (AI answers, checkout) | The probe, dispatched by hand with its input | The probe run and its alert issue |

State plainly in the document where each green arrives and what does not count. A document once told agents to wait for a green run before merging, but the dispatch tested an old deployment and never the pull request's code; the document promised a gate nobody ran ([10, section 1](./10-guard-tests.md), docs-honesty test).

### 9.2 `AccessDenied` is a missing permission

An `AccessDenied` or `Not authorized to perform sts:AssumeRoleWithWebIdentity` when a run assumes the role means the trust policy or the role lacks a permission. It says nothing about the code. The rule for agents: record the error in the pull request, keep working the ticket, and leave the role change to a session with AWS credentials. An agent that read "no merge without a green run" as absolute stopped a whole unattended overnight run of agents at this error *(observed)*. Write the recipe for widening the trust policy (section 2.4) in the same document so the human session can do it in one step.

### 9.3 Agents without AWS credentials

Cloud sessions have no AWS credentials. The task list for a feature that changes what a person sees ends with "deploy, run the e2e, take the photos". An agent without credentials writes the spec and the code, opens a draft pull request, and leaves that last task undone and named in the description. A person or a local session with credentials runs it, optionally in a batch script that waits for the deploy workflow to be idle, takes the "before" photos against the deployed base, deploys the branch, takes the "after" photos, and commits them ([12, section 1](./12-proving-a-fix.md)).

### 9.4 Helper scripts that read CI state without full logs

Reading a 25-minute deploy log fills an agent's context with noise. Two small scripts answer the usual questions through `gh`, with no AWS credentials:

- `node scripts/ci/deployed-env.mjs <branch>` prints the commit, the conclusion, and the run URL of the last deploy run for the branch.
- `node scripts/ci/run-failures.mjs <run-id>` prints only the failing tests and the lines around each failure.

Each script has its own unit test in `shared/test/`, which runs the script as a child process on a fixture, as [10, section 1.10](./10-guard-tests.md) describes. Name both in `CLAUDE.md`, because an agent that does not know they exist reads the raw logs.

```javascript
// scripts/ci/deployed-env.mjs
import { execFileSync } from 'node:child_process';

export function lastDeployRun(branch, exec = execFileSync) {
  const out = exec(
    'gh',
    ['run', 'list', '--workflow', 'deploy-dev.yml', '--branch', branch, '--limit', '1',
     '--json', 'databaseId,headSha,conclusion,status,url'],
    { encoding: 'utf8' },
  );
  const [run] = JSON.parse(out);
  if (!run) throw new Error(`No deploy-dev run found for branch ${branch}`);
  return run;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const branch = process.argv[2];
  if (!branch) {
    console.error('usage: node scripts/ci/deployed-env.mjs <branch>');
    process.exit(2);
  }
  const run = lastDeployRun(branch);
  console.log(`${branch}: ${run.headSha.slice(0, 7)} ${run.conclusion ?? run.status} ${run.url}`);
}
```

### 9.5 Before merging to the integration branch

A merge to the integration branch triggers a deploy of about 25 minutes. Before merging, run `deployed-env.mjs` for that branch and check the last run. Merge only on top of a green run: the new deploy would start from a broken base, and the red cause would be hidden under new changes. Tell anyone testing by hand on the stack that a deploy is about to replace it. Parallel feature pull requests merged in one batch broke each other's specs *(observed)*, so merge one, wait for its deploy and smoke, then merge the next.

### 9.6 Keep the document honest

A guard test reads `docs/agents/e2e.md`, `CLAUDE.md`, and the reminder workflow, and asserts that each place repeating a rule still says the current wording and none says the old one ([10, section 1](./10-guard-tests.md)). Without the test, a document that promised a gate nobody ran stayed in place until an agent obeyed it *(observed)*.

---

## Verification

Commands that confirm the workflow side works:

```bash
# Workflow and docs guard tests (run by the normal CI test command)
npm test -w shared

# Lint the workflow files if actionlint is installed
actionlint .github/workflows/*.yml

# Confirm the live trust policy lists every ref you expect
aws iam get-role --role-name acme-e2e-ci --query 'Role.AssumeRolePolicyDocument'

# Dispatch the personal-stack workflow from a branch and watch it
gh workflow run deploy-dev.yml --ref "$(git branch --show-current)"
gh run watch

# Check what is deployed on a branch
node scripts/ci/deployed-env.mjs agent-development-<developer>
```

Test checklist, one per mechanical rule:

- Guard test: the deploy workflow parses, and its steps appear in the order of section 1.1 (guard first, smoke after the frontend deploy and before evals, upload after the smoke).
- Guard test: `SMOKE_URL` comes only from the stack outputs file, and the step fails on `null`.
- Guard test: the smoke step has no `continue-on-error`, and the upload step's `if` contains `always()` and `steps.smoke.conclusion != 'skipped'`.
- Guard test: no workflow with `id-token: write` has a `pull_request` trigger, and the reminder workflow has no `id-token`, no `configure-aws-credentials`, no `playwright test`, and no `cdk deploy`.
- Guard test: the branch patterns in the guard step equal the `sub` patterns of the trust policy document kept in the repository.
- Guard test: the concurrency group of the suite workflow references the stage and suffix variables and not `github.ref`, with `cancel-in-progress: false`.
- Guard test: every job has `timeout-minutes`.
- Guard test: the change filter always runs the smoke, the evidence guard, and the evals, and falls back to a full deploy on any doubt.
- CDK synth test: the test role's `dynamodb:Scan` statement carries both the `dynamodb:Attributes` and `dynamodb:Select` conditions.
- Docs-honesty test: `docs/agents/e2e.md`, `CLAUDE.md`, and the reminder each state where the green that counts arrives and mention `AccessDenied`.
- Unit tests in `shared/test/` for `deployed-env.mjs` and `run-failures.mjs` that run each script as a child process on a fixture ([10, section 1.10](./10-guard-tests.md)).

---

## Further reading

- [`03-auth-and-test-users.md`](./03-auth-and-test-users.md): the secrets and QA users the test role reads.
- [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md): stages, `stackSuffix`, and pre-deploy checks.
- [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md): agent evals.
- GitHub Docs, events that trigger workflows: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
- GitHub Docs, concurrency: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs
- GitHub Docs, OpenID Connect in AWS: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
- AWS CLI, `update-assume-role-policy`: https://docs.aws.amazon.com/cli/latest/reference/iam/update-assume-role-policy.html
- DynamoDB, IAM conditions for fine-grained access: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html
