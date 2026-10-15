# Lanes and Decisions

**Builds:** The set of choices you make once per project before writing the first spec: which suite tests what, which environment each suite targets, when each suite runs in CI and whether a red result blocks anything, and how many retries each suite gets. The result is a short decision record (an ADR) that every other file in this skill implements.

**When to use:** Starting an end-to-end suite for a web app or PWA on an AWS serverless stack, writing the ADR for one, deciding where a new scenario belongs, or reconsidering a choice after a measured problem (a suite that went red for days, a green run that tested the wrong environment, a probe that spent money on every merge). Read the section for the decision at hand; each one links to the file that owns the implementation.

**Prerequisites:** None. The deploy workflow itself (stages, `stackSuffix`, pre-deploy checks) is covered in [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md); this file covers where the tests plug into it.

> Verified on 2026-10-14 against `@playwright/test` 1.64; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. **The vocabulary** — what probe, false green, guard test, verdict, and the green that counts imply.
2. **Test what ships** — the local lane serves the built export, the smoke lane hits the deployed stack; what only shows up deployed.
3. **Which lane a scenario goes to** — decision table and the rules for local doubles.
4. **Environments the lanes target** — local export, `dev-e2e`, personal stacks, staging, production.
5. **When each lane runs and whether it blocks** — three proven CI shapes and the recommendation.
6. **Retries policy** — zero outside CI, a number with a written reason per lane in CI.
7. **Decision record** — the choices to write in an ADR when you start.

---

## Section 1: The vocabulary

The words are defined in the vocabulary table of `SKILL.md`. This section adds what probe, false green, guard test, verdict, and the green that counts imply for the rest of the design.

### 1.1 Probe

A probe runs after the deploy, and a red probe leaves that deploy green, because the dependency can fail for reasons that have nothing to do with the commit and each run costs money or sends a real message. Its verdict can block a release, because a release should not go out when the thing the probe covers has been red since the last good commit. The implementation is in [08, section 1](./08-third-parties-payments-and-messaging.md) and the release gate is in [07, section 1](./07-release-gate.md).

### 1.2 False green

Hunting false greens is the central theme of this skill. The shapes that production projects actually hit:

- The suite ran against another environment, because a hardcoded default URL pointed at an old stack.
- Scripts skipped themselves because the infrastructure they needed was missing, and skipped tests do not fail the run.
- `page.route` hid a CORS failure, because intercepted requests in that page no longer go through the browser's CORS check *(observed)*.
- An optimistic UI hid a rejected write: the screen looked right while the server answered 400 *(observed)*.
- A double that returned a fixed response kept answering the old contract after the real contract changed.
- An assertion targeted a screen that was mounted but hidden, so it could not fail.
- A document told agents a gate existed that nobody ran.

Every rule in the other files names the false green it prevents. When you add a rule, say which one.

### 1.3 Guard test

The e2e suite cannot see its own misconfiguration: a workflow without `if: always()` on the artifact upload still passes while it loses the evidence. A guard test pins that property in the unit-test run that every pull request already pays for. Guard tests cover workflow YAML, Playwright configs, IAM in the CDK template, documentation wording, and source scans over spec files. The catalog is in [10, section 1](./10-guard-tests.md).

### 1.4 Verdict and the green that counts

Beside passed and failed, a missing verdict is a third state that means "never ran", and a gate treats it differently from "failed" ([07, section 3](./07-release-gate.md)).

The green that counts must be written down where agents read it, because an agent that treats the wrong run as proof either merges a regression or waits forever for a signal that cannot arrive. [06, section 9](./06-ci-workflows.md) shows the wording.

---

## Section 2: Test what ships

**Rule.** The local lane serves the built export, the output of `expo export --platform web` or `vite build`, with a static server (`expo serve` or `vite preview`). The smoke lane hits the deployed stack through its CloudFront URL.

**Why.** Metro and Vite dev servers rewrite routes, serve files from memory, ignore the CloudFront function and inject their own environment variables. A suite that passes against a dev server proves the dev server works. The built export is the artifact that gets uploaded to S3, so it is the closest thing to production that runs on a laptop.

The implementation of the `webServer` block, including the per-run port, is in [01, section 3](./01-config-lanes-and-target.md).

### 2.1 What only shows up deployed

These failures cannot occur on localhost. Each one was found in a deployed smoke and missed everywhere else *(observed)*.

| Failure | Why only the deployed stack shows it |
|---|---|
| CORS preflight between CloudFront and `execute-api` rejects the app's origin | Locally the app and the API share an origin or the request is intercepted. Only a real browser on the CloudFront origin sends the preflight to the real API. |
| `/console/` returns 403 or the wrong page | S3 with Origin Access Control has no directory index. A CloudFront function must rewrite `/console/` to `/console/index.html`; the dev server does it for you. |
| The bundle calls an empty or stale API URL | Backend outputs (`VITE_API_URL`, `EXPO_PUBLIC_API_URL`) are baked into the bundle at build time. A build made before the backend deploy carries the previous value. |
| The first request times out | Cold Lambdas, a cold Cognito pool and a first-use DynamoDB table add seconds that a warm local mock never shows. |
| Deep links return the S3 error page | The CloudFront function rewrite for single-page routes is part of the stack, not of the app. |

A smoke spec for each row costs one request or one page load. Write them first; they catch the failures that make an entire deploy useless.

---

## Section 3: Which lane a scenario goes to

Decide by what the scenario depends on, not by how important it is.

| The scenario | Lane | Reason |
|---|---|---|
| Deterministic, free, and uses only your own backend | Smoke lane | The real backend is the only thing that proves the contract, CORS, auth and eventual consistency together. |
| Deterministic, and provable from the built export with stateful doubles | Local lane | It runs on every pull request without a deploy. Use it for flows whose risk lives in the front end. |
| Design parity, rendering, layout at a given viewport | Local lane | No backend state is needed, and the result is stable. |
| Browser API behaviour such as camera tracks and permissions | Local lane | Fake devices are a browser flag, and a deployed run adds nothing. |
| Costs money (LLM tokens, a real purchase) | Probe lane | A suite that runs on every merge would bill every merge. |
| Gives a non-deterministic answer (an LLM, a third-party page) | Probe lane | A flaky blocking test teaches the team to ignore red. |
| Sends a side effect into a third-party system (a real SMS, a real checkout) | Probe lane | Every run creates real data or messages that someone must clean up. |

Two scenarios that look like probes stay in the smoke lane: the assistant answering at all (assert that it responds, not what it says, see [09, section 1](./09-llm-and-agent-flows.md)) and the payment flow against the mock provider (free and deterministic).

### 3.1 Rules for local doubles

**A double keeps state.** Back the fake API with a store (a `Map` of orders) that the fake endpoints read and write. Return state from the store on every read. A fixed response looks identical before and after the user acts, so a test that checks "the order appears in the console" passes whether or not the write ever happened. One project kept a console test green for weeks while the console read a dead store *(observed)*. A double that fronts a projection hides a new row for a short window, the way the real projection lags the bus.

**A double applies the real gatekeeper rules.** If the real API rejects a request without a valid token, or the real channel refuses a subscription for another user's topic, the double rejects the same request. A fake WebSocket that accepted every subscription hid a real authorization bug *(observed)*.

**The smoke lane covers the same flow against the real backend.** A double can drift from the real contract without any local test noticing, so every flow the local lane proves with doubles also has a smoke spec that composes the real services. A drifted double then shows up as a red smoke run instead of a silent local green.

The local lane asserts only what the doubles can prove. For anything that needs the real service, the local lane checks the honest fallback instead: the assistant bar says "not connected" rather than waiting for an answer that cannot come *(observed)*.

---

## Section 4: Environments the lanes target

| Environment | What runs there | Providers | Notes |
|---|---|---|---|
| Local export | Local lane | Stateful doubles | Built export on `localhost`, port chosen per run ([01, section 3](./01-config-lanes-and-target.md)). |
| `dev-e2e` stack | Smoke lane after merge, plus probes | Mock payment and messaging providers, deployed only when an explicit flag is on | A dedicated stack that no developer deploys to by hand, so fixtures stay predictable. |
| `dev-<developer>` stack | Smoke lane inside the deploy workflow of an `agent-development-<developer>` branch | Same mock providers | Personal stack; the green that counts for that developer's app changes. |
| `staging` | Blocking suite inside the staging deploy, then probes | Provider sandboxes | The commit that reaches production passes here first ([07](./07-release-gate.md)). |
| `prod` | One read-only post-deploy check | Real | No spec that writes. |

**The `dev-e2e` stack.** The mock payment provider exists only when a CDK context flag (`-c mockPaymentsEnabled=true`) is set. Every other stack is deployed without the flag, so the mock is missing there and a request to it fails closed; the reason and the guard test are in [08, section 2.1](./08-third-parties-payments-and-messaging.md).

**Shared secrets.** Account-level secrets (the provider API keys, the QA user passwords) are imported by name instead of created per stack, so several stacks can coexist in one account without each owning a copy.

**Personal stacks.** A developer's stack and its suffix come from the branch name, so two developers never reset each other's fixtures. The suffix handling is in [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md).

**Production stays free of write-capable automated tests.** One project ran a real-payment probe against production; the test sessions it created became visible to real users, and the team removed the job and kept only a read-only check *(observed)*. The read-only check is an anonymous GET of the catalog endpoint and of each app URL after the deploy, with a loud failure and a pointer to the rollback runbook. It does not roll back by itself.

---

## Section 5: When each lane runs and whether it blocks

Three shapes ran in production. They differ in one thing: how soon a regression turns something red, and whether that red can stop a merge or a release.

| | Shape 1: smoke inside the deploy workflow | Shape 2: non-blocking post-merge on a dedicated stack | Shape 3: blocking suite in the staging deploy, probes, release gate |
|---|---|---|---|
| When it runs | Right after each deploy of a personal or dev stack | After a merge to the default branch, and by manual dispatch | Inside the staging deploy; probes run after it |
| What a red run means | The code just deployed is broken | Some commit since the last green broke something | The staging deploy failed, or a probe went red |
| Blocks a merge | The PR workflow blocks on typecheck, unit tests and the local lane; the smoke does not block the merge but follows it within minutes | No | The staging deploy blocks the tag |
| Blocks a release | No | No | Yes: the production deploy requires a passing verdict per lane for the exact commit |
| How soon a regression shows | Minutes after the deploy | After the merge, possibly days before anyone looks | At the staging deploy |
| Main cost | A deploy per push | Regressions reach the default branch; one project had 5 specs red for days because nobody was watching a non-blocking run *(observed)* | A bucket, a gate script and a verdict per lane |
| Main benefit | The test runs against code that actually deployed | Merges stay fast | Production only ships commits that passed |

### 5.1 Shape 1: smoke inside the deploy workflow

The dev deploy workflow runs the smoke lane in the steps right after the deploy, in the same job. It reads the stack outputs the deploy just wrote, derives the app URL, fails when the URL is missing, and runs the smoke lane against it. A red run means the deployed code is broken, which is a statement about the commit, not about a stack of unknown age.

A separate pull request workflow runs typecheck, unit tests, guard tests and the local lane before merge. It has no AWS credentials, so a pull request from a branch cannot assume a role.

The order of the steps and the reason for each is in [06, section 1](./06-ci-workflows.md).

### 5.2 Shape 2: non-blocking post-merge against a dedicated stack

A workflow triggered by a push to the default branch deploys `dev-e2e` and runs the suite against it. It is not a required check. It has `id-token: write`, so it runs only on push and manual dispatch ([06, section 2.5](./06-ci-workflows.md)). A comment-only reminder workflow in its own file, without AWS permissions, tells the author on app-code pull requests that the e2e run happens after merge ([06, section 3](./06-ci-workflows.md)).

This shape suits teams whose deploy takes too long to run per push. Its cost is real: a regression is caught after the merge, so you need the habit of opening a follow-up ticket when the post-merge run goes red. Without it, 5 specs stayed red for days while every pull request check was green *(observed)*.

### 5.3 Shape 3: blocking suite in the staging deploy, probes, and a release gate

The staging deploy runs the blocking suite as its last job. A red suite fails the deploy. After the deploy, opt-in probes run in their own workflows and write their own verdict. A production deploy refuses to start unless the tagged commit has a passing verdict for every lane the team requires. The verdicts live in S3, keyed by commit, because the gate must prove that this exact commit passed and a re-run would only test whatever staging holds now ([07, section 1](./07-release-gate.md)).

### 5.4 Recommendation

- Start with Shape 1 in every project. It needs no extra infrastructure and it tests the code that deployed.
- Add the release gate from Shape 3 as soon as a production environment exists. The gate is what keeps a red probe from being ignored.
- Choose Shape 2 only when a deploy per merge is too slow for the team, and then adopt the follow-up ticket habit and the pull request reminder together with it.
- Whichever shape you pick, every lane that spends money or touches a third party stays a probe: opt-in, its own workflow or job, its own verdict, and the concurrency group of the stack it resets ([06, section 4](./06-ci-workflows.md)).

---

## Section 6: Retries policy

**Outside CI, `retries` is 0.** Local runs and evidence runs then see a flaky test as a failure. Playwright's default is also 0, but write it down: a later edit that adds a global retry would hide every flake without anyone deciding to.

**In CI, each lane sets its own number in its config or project, as `retries: process.env.CI ? N : 0`, with the reason in a comment beside it.** This is the only place that states the numbers; every other file links here.

| Lane | CI retries | Reason to write in the config |
|---|---|---|
| Blocking suite | 1 or 2 | A cold Lambda or a slow Cognito call can lose a single attempt; two failures in a row are not noise. |
| Paid probe | 1 | Each retry costs money or buys something real (one real model call, one sandbox purchase), so a failed probe spends at most two attempts, and an answer that brushes API Gateway's 29 s limit is a timing loss, not a broken feature *(observed)*. |
| Third-party probe | 1 | The third party is outside your control; after one retry, open the alert issue instead of retrying more. |
| Local lane | 0 | The doubles are deterministic. A retry here hides a real race. |

Apply retries per Playwright project or per config so the number sits beside the explanation. One project passed `--retries=1` only on the command line of two workflows, which kept the config honest but left the reason in two places *(observed)*; the config is the better home.

**A flake fix is proven by consecutive runs at `--retries=0`.** A fix is not shown by a green run that retried. Run the spec N times back to back at zero retries and record the count in the evidence file ([12, section 2](./12-proving-a-fix.md)).

---

## Section 7: Decision record

Write these choices in an ADR when you start, one line each with the reason. Copy the table and fill it in.

| # | Choice | Options in this file | Your answer |
|---|---|---|---|
| 1 | Which lanes exist | Local lane, smoke lane, probe lanes (section 3) | |
| 2 | What each lane targets | Built export, `dev-e2e`, personal stack, staging (section 4) | |
| 3 | Which probes exist and which dependency each covers | LLM, payments, messaging, other third parties | |
| 4 | Which CI shape | Shape 1, 2 or 3 (section 5) | |
| 5 | Which lanes block, and what they block | Merge, staging deploy, production deploy | |
| 6 | Retries per lane, with the reason | Section 6 | |
| 7 | Who can trigger runs, from which refs | Branch dispatch, tag, manual input ([06, section 3](./06-ci-workflows.md)) | |
| 8 | Where verdicts live and which are required for release | S3 bucket, one file per lane ([07, section 2](./07-release-gate.md)) | |
| 9 | How test users are created and where their credentials live | [03, section 3](./03-auth-and-test-users.md) | |
| 10 | What production gets | Read-only check only (section 4) | |
| 11 | Which run is the green that counts for app changes and for spec-only changes | [06, section 9](./06-ci-workflows.md) | |

---

## Verification

Commands that confirm the decisions are wired the way the ADR says:

```bash
# The config pins zero retries
grep -n "retries" e2e/playwright.config.ts e2e/playwright.smoke.config.ts

# Production workflows contain no write-capable test run
grep -n "playwright test" .github/workflows/deploy-prod.yml || echo "ok: no playwright in prod"

# The smoke step comes after the deploy steps
yq '.jobs.deploy-and-smoke.steps[].name' .github/workflows/deploy-dev.yml

# The local lane serves a built export, not a dev server
grep -nE "webServer|command" e2e/playwright.config.ts
```

Test checklist, one per mechanical rule:

- [ ] Config test: both configs set `retries` explicitly, and the local lane's value is 0 ([10, section 1](./10-guard-tests.md)).
- [ ] Config test: the `webServer` command of the local lane starts a static server over the build output, not `expo start` or `vite` in dev mode ([01, section 3](./01-config-lanes-and-target.md)).
- [ ] Workflow test: the smoke step comes after the deploy steps, and no workflow with `id-token: write` triggers on `pull_request` ([10, section 1](./10-guard-tests.md)).
- [ ] Workflow test: the production workflow has no Playwright run apart from the read-only check.
- [ ] CDK synth test: the mock payment provider is absent from every stack deployed without the flag.
- [ ] Every local-lane flow that uses a double has a smoke spec for the same flow against the deployed stack.
- [ ] The ADR exists and answers the eleven rows of section 7.

## Further reading

- [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md) for the deploy workflow basics.
- [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md) for agent answer quality, which stays outside this skill.
- [`expo-react-native/references/06-performance-and-testing.md`](../../expo-react-native/references/06-performance-and-testing.md) for native mobile e2e.
- Playwright test configuration: https://playwright.dev/docs/test-configuration
- Playwright retries: https://playwright.dev/docs/test-retries
