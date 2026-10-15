# Gotchas Catalog

**Builds:** Nothing. This is a lookup table: find the symptom, read the cause, apply the fix, and follow the link for the full pattern.

**When to use:** A Playwright suite for the `acme` app is red, flaky, slow, or green for a suspicious reason; a CI run cannot assume its AWS role or loses its evidence; a release gate blocks; or you are about to add a rule and want to know which incident it came from. Start from the Symptom column.

**Prerequisites:** None. Rows repeat the key facts of the other references on purpose, so a symptom can be resolved from this file alone; the linked section stays the single place where the pattern is explained.

> Verified on 2026-10-14 against `@playwright/test` 1.64; the projects behind the *(observed)* facts ran 1.60 to 1.62. Most rows come from incidents in production projects; rows that vendors do not document are marked *(observed)* in the linked reference.

## Contents

1. Target and configuration
2. Auth and identities
3. Test data and isolation
4. Multi-user and timing
5. CI, OIDC and permissions
6. Third parties and LLM
7. False greens
8. Evidence and guard tests

---

## Section 1: Target and configuration

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| Every spec fails with `Cannot navigate to invalid URL` in CI only, or `SMOKE_URL` is the literal string `null` | Actions passes `vars.X \|\| ''`, so the env var is the empty string and `??` does not fall back on `""`; or `jq` printed `null` because the stack output name did not match | Treat an empty, blank, or `null` value as unset in a pure resolver, unit test the empty-string case, and fail the workflow step with `::error::` | [01, section 2](./01-config-lanes-and-target.md) |
| `globalSetup` sets the target, but the config already read the old one | The config resolves `baseURL` when it loads, before `globalSetup` runs, and workers load the config again | Resolve the URL in a workflow step before Playwright starts and pass it as an env var | [01, section 2](./01-config-lanes-and-target.md) |
| The first deploy of a new stack fails at synth with `CannotFindAsset` | `cdk deploy` synthesizes every stack in the app, and the frontend stack points at a `dist/` folder that does not exist yet | `mkdir -p apps/web/dist apps/console/dist` before the backend deploy | [06, section 1](./06-ci-workflows.md) |
| The deployed app calls an empty or stale API URL | The bundle bakes backend outputs at build time, and a plain `npm run build` skipped them | Use the two-phase deploy: backend, then build with the outputs, then frontend; check the bundle for the baked addresses | [06, section 1](./06-ci-workflows.md) |
| A second local run fails on the port, and a correct change is held back | The fixed web-server port is machine-wide while several worktrees run the lane in parallel *(observed)* | Pick the port from `E2E_PORT` or from the process id, and export it back to `process.env` | [01, section 3](./01-config-lanes-and-target.md) |
| `/console/` returns 403 or shows the customer app on the deployed stack | S3 with Origin Access Control has no directory index, and the CloudFront function rewrote only some directories | Make the function rewrite every app directory, pin the list in a stack test, and add a smoke spec that loads each app URL | [00, section 2](./00-lanes-and-decisions.md) |
| A plain `npx playwright test` spent model tokens or bought something | The default project matched the probe files through `**/*.spec.ts` | Create the probe project only when its env var is set, and list the probe files in the default project's `testIgnore` | [01, section 1](./01-config-lanes-and-target.md) |
| A journey dies on its total time while every step is healthy | The default 30 s test timeout is below the measured 35 to 45 s of three real sign-ups on cold Lambdas *(observed)* | Set `timeout` to about three times the measurement and write the measurement in a comment | [02, section 2](./02-config-runtime.md) |
| Specs corrupt each other's data, or seeding is throttled | `workers` was left at the default of half the CPU cores while specs share one QA user and seed tables | Set `workers` explicitly: `1` for shared fixtures, a measured ceiling for self-contained specs, and pin it with a guard test | [02, section 1](./02-config-runtime.md) |
| Green in CI, red on a laptop in the evening | Fixtures seed dates in UTC while the app reads "today" in the browser's time zone, and CI runners are UTC | Set `timezoneId: 'UTC'` in `use` | [02, section 4](./02-config-runtime.md) |
| A camera flow fails on CI before it reaches the code under test | The runner has no camera and no one answers the permission prompt | Pass `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream`, and grant `camera` | [02, section 4](./02-config-runtime.md) |
| A type error or a dangling reference after an auth migration shows up as a 401 in the deployed smoke, or crashes setup with a `ReferenceError` | Playwright does not typecheck, and `e2e/` and `scripts/` are not workspaces the root `typecheck` visits *(observed)* | Add `e2e/tsconfig.json`, call `tsc -p e2e/tsconfig.json` from the root script, pin both with a guard test, and run the setup project in the pull request that changes auth | [02, section 5](./02-config-runtime.md) |

---

## Section 2: Auth and identities

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| The operator console redirects to Google and the test times out | Google blocks automated logins, so no test can use the federated screen | Add a test-only app client with `ADMIN_USER_PASSWORD_AUTH`, sign in from setup code, and inject the token | [03, section 1](./03-auth-and-test-users.md) |
| A password flow exists on a production app client | The test-only client was created without the `stage !== 'prod'` condition, or a refactor dropped it | Add a synth test that fails when any production client lists a `*PASSWORD_AUTH` flow, with a check that clients exist | [03, section 1](./03-auth-and-test-users.md) |
| Sign-in returns no tokens, with the challenge `NEW_PASSWORD_REQUIRED` | The QA user was created without a permanent password, so it stays in `FORCE_CHANGE_PASSWORD` | Call `AdminSetUserPassword` with `Permanent: true` in an idempotent provisioning script | [03, section 3](./03-auth-and-test-users.md) |
| The backend rejects the token or misses the approver's email | The access token of Cognito carries no email, and the backend reads it from claims | Send the ID token | [03, section 1](./03-auth-and-test-users.md) |
| `Secret ... does not exist` or an empty credential in setup | The QA user was never provisioned for this stage | Run the provisioning script once per stage, and make the reader throw a message that names the script | [03, section 3](./03-auth-and-test-users.md) |
| A console spec times out waiting for the queue | `addInitScript` was registered after `goto`, so the console read an empty store and redirected to Google *(observed)* | Open the console only through a helper that seeds `sessionStorage` before the first navigation, and scan specs for it | [03, section 2](./03-auth-and-test-users.md) |
| Two scripts that started together share one customer, and the second logs in as the first | The synthetic phone came from `Date.now()`, and both read the same millisecond *(observed)* | Derive the phone from `crypto.randomInt` in a reserved range | [03, section 3](./03-auth-and-test-users.md) |
| A test that needs the premium UI sees the free one, or one test flips the other's user | One QA user is normalized to free by setup while another test needs premium | Keep one QA user per variant, each with its own secret and `storageState`, plus a setup assertion that the two users differ | [03, section 3](./03-auth-and-test-users.md) |

---

## Section 3: Test data and isolation

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| A re-seeded order never appears and the write returned success | The backend soft-deletes, and an idempotent create finds the old tombstone and does nothing | Add a per-run suffix to every client id | [04, section 1](./04-test-data.md) |
| Seeding fails with 429 or 502 that look like a product bug | A new AWS account has a Lambda concurrency quota of 10, and the seed fired many requests at once *(observed)* | Seed in a sequential loop and raise the setup timeout to 120 s | [04, section 1](./04-test-data.md) |
| The QA user is premium or has a stale renewal date after a crashed probe | A real or synthetic subscription was left behind | Restore third-party state in setup on every run, and call the normalizer in the probe's `beforeAll` and `afterAll` | [04, section 1](./04-test-data.md) |
| A join test gets 403 instead of 409 | `resetLocker()` deleted one row (`Limit 1`) of a shared index key and left an old open order attached *(observed)* | Query in a loop until the page is empty, and add a fence that polls until every data model reports the locker free | [04, section 2](./04-test-data.md) |
| A locker reset is undone by a session that appears right after it, or a later spec sees a sold-out item | A browser tab was still open and resubscribed to the cleaned locker; or the spec changed global data that `resetLocker()` does not touch | Close every context first, then reset; restore any global value in `finally` or `afterAll` | [04, section 2](./04-test-data.md) |
| The smoke fails with `RoundFrozenError`, or two lanes break each other's locker | The smoke joined a locker that a concurrent spec holds and freezes | Give each spec file one locker, keep the smoke and the e2e specs on disjoint lockers, and name the owner next to each constant | [04, section 2](./04-test-data.md) |
| The test's own case is not found in the shared queue, or a pagination spec fails against a queue other scripts change | The queue is ordered by due date, each green run left about 8 open cases (109 in total), and the new case fell off page one; the spec also compared the UI count with an API walk taken seconds earlier *(observed)* | Track every seeded case, close it in `afterEach`, page through "Load more", and assert only about the spec's own cases | [04, section 3](./04-test-data.md) |
| A leftover sweep deleted data in a stage that was not disposable | The sweep script had no guard on the environment | Refuse to run unless `SWEEP_ENVIRONMENT` starts with `dev` | [04, section 3](./04-test-data.md) |
| A DynamoDB scan helper fails with an empty error and looks like a permissions problem | An unfiltered scan returned 1.6 MB, above the default 1 MiB `maxBuffer`, so Node killed the child process with no stderr *(observed)* | Filter and project on the server, set `maxBuffer`, and put `error.message` in the thrown error | [04, section 3](./04-test-data.md) |
| `aws lambda invoke` fails with exit 255 and empty stderr in CI only | The response was written to `/dev/stdout` under a pipe, where it collides with the CLI's own output; a terminal hides it | Write the response to a temporary file and pass the payload with `--cli-binary-format raw-in-base64-out` | [04, section 2](./04-test-data.md) |

---

## Section 4: Multi-user and timing

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| The second person's sign-up fails with "you already created a user on this phone" | Two tabs of one browser context share `localStorage`, so the second person inherited the first session (five scripts failed at once) *(observed)* | Open each person with `browser.newContext()` and pass the viewport explicitly | [05, section 1](./05-multi-user-waits-and-time.md) |
| A screen in a background tab never refreshes | A background tab is `hidden`, and the app's polling stops when the page is hidden | Use one context per person and bring each page to the front only when it is the one under test | [05, section 1](./05-multi-user-waits-and-time.md) |
| A fixed `waitForTimeout` passes on a warm Lambda and fails on a cold one | The sleep is a guess about backend latency | Wait for the condition with `expect.poll`, `toPass`, or `eventually`, and name the waited-for event in the error | [05, section 2](./05-multi-user-waits-and-time.md) |
| The console row never appears even after 30 s | The queue is a projection that lags the bus, and the console never refetches on its own | Reload the console and reopen the desk inside `toPass` until the row appears | [05, section 2](./05-multi-user-waits-and-time.md) |
| Two operators took the same support case | The decision was made from a lagging projected row | Enforce the rule inside the server's per-thread lock (409 with the current owner), and make the local double model the lag | [05, section 2](./05-multi-user-waits-and-time.md) |
| A returning-user test behaves like a new person | The reload came about 1 s after opening the assistant, before the provisional session existed (about 2 s) *(observed)* | Wait for the request that creates the state, then reload | [05, section 2](./05-multi-user-waits-and-time.md) |
| A time-based warning (stuck bill) never appears under `page.clock` | The client stored `Date.now` before the clock was installed, or the clock was installed after `goto` | Install the clock before `goto`, and advance it with `fastForward` or `runFor` | [05, section 3](./05-multi-user-waits-and-time.md) |
| A premium user who presses Analyze right after load lands on the paywall | The app boots with a default free subscription until `GET /subscription` answers | Wait for the unlocked copy to be visible before pressing; the app should treat "unknown" as its own state | [09, section 1](./09-llm-and-agent-flows.md) |
| `element is not attached to the DOM`, passing on retry, in three CI runs in a row | A state change committed one render with the new value and the old view mode, which remounted the view and closed the open card | Prove it with repeated runs at `--retries=0`, derive the state during render, and add a unit test that fails without the fix | [12, section 2](./12-proving-a-fix.md) |
| The table is back to empty after a cold-start run, and the CTA unmounts | A subscribe acknowledgement with an old snapshot arrived after the first HTTP response and overwrote the fresh state | Discard a same-session snapshot with a lower version; record the limit of the evidence because the run cannot force a cold start | [12, section 2](./12-proving-a-fix.md) |
| A spec red after merge while its own run was green | Two pull requests were built on one base and merged in one batch, and the second changed the text the first spec expected | Merge one pull request, wait for its deploy and smoke, then merge the next | [06, section 9](./06-ci-workflows.md) |

---

## Section 5: CI, OIDC and permissions

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` on a branch dispatch | The trust policy does not list that branch pattern | Add the pattern to the trust policy, and add a first workflow step that rejects refs the policy does not accept | [06, section 2](./06-ci-workflows.md) |
| After widening the trust policy `main` can no longer deploy, or a document says it was widened and dispatches still fail | `update-assume-role-policy` replaces the whole document and the command listed only the new branch; or nobody checked the live role *(observed)* | Send the full document with every trusted ref, then read `Role.AssumeRolePolicyDocument` back from AWS, not from the document | [06, section 2](./06-ci-workflows.md) |
| `AccessDenied` on `cloudformation:DescribeStacks` for the shared e2e stack, or `lambda:InvokeFunction` denied in a spec that forces a job | The test role was pinned to one developer's suffix, or cannot invoke the one function the test triggers | Use wildcards for stage and suffix in the stack and table ARNs; grant `lambda:InvokeFunction` on that one function and document it | [06, section 2](./06-ci-workflows.md) |
| An unsupervised branch can change infrastructure | The deploy role was trusted for a branch an agent writes | Give such branches only the test role, and switch credentials mid-job with a distinct `role-session-name` when the workflow also deploys | [06, section 2](./06-ci-workflows.md) |
| Any pull request can receive the OIDC role | A workflow with `id-token: write` triggers on `pull_request` | Run AWS workflows on `push`, `workflow_dispatch`, or `workflow_run`, and pin the rule with a guard test | [06, section 2](./06-ci-workflows.md) |
| A new e2e workflow cannot be dispatched from a feature branch | `workflow_dispatch` works only for a workflow file that exists on the default branch | Merge the workflow file first, then iterate on specs from branches | [06, section 3](./06-ci-workflows.md) |
| A `workflow_run` workflow deploys and tests the wrong code | Its default checkout is the latest commit of the default branch | Check out `github.event.workflow_run.head_sha` | [06, section 1](./06-ci-workflows.md) |
| A pull request stacked on another branch got no checks | A `pull_request.branches` filter excluded the base, and retargeting does not fire the default trigger set | Drop the `branches:` filter, add the `edited` type, and let the concurrency group cancel redundant runs | [06, section 3](./06-ci-workflows.md) |
| The upload step reports "no files found" and hides the real failure | An earlier step failed, the smoke never ran, and `if-no-files-found: error` fired | Use `if: always() && steps.smoke.conclusion != 'skipped'` | [06, section 5](./06-ci-workflows.md) |
| Five specs stayed red for days while every pull request check was green *(observed)* | The suite runs after merge and does not block | Open a follow-up ticket whenever the post-merge run goes red, and add the comment-only pull request reminder | [00, section 5](./00-lanes-and-decisions.md) |
| A cancelled deploy leaves the stack in `UPDATE_ROLLBACK` | The concurrency group cancelled a running `cdk deploy` | Use `cancel-in-progress: false` for deploys | [06, section 4](./06-ci-workflows.md) |
| Two runs on one stack wipe each other's fixtures, or a concurrent setup turns the QA user back to free in the middle of a checkout probe | The group was keyed on the ref instead of the stack, or the setup, the probes, and the deploy ran under three different groups | Put setup, probes, and the next deploy in one group per stack, keyed on stage and suffix | [06, section 4](./06-ci-workflows.md) |
| A 25-minute deploy runs for a docs-only push, or a needed deploy is skipped | The change filter compared with the previous commit, while the stack holds the last green commit | Diff against the last green run of the same workflow and branch, and deploy on any doubt | [06, section 3](./06-ci-workflows.md) |
| An agent stops a whole shift at `AccessDenied`, or a cloud agent cannot finish the "deploy, run the e2e, take the photos" task | It read "no merge without a green run" as absolute, or it has no AWS credentials | Write in `docs/agents/e2e.md` that `AccessDenied` is a missing permission to record; otherwise open a draft pull request naming the open task for a session with credentials | [06, section 9](./06-ci-workflows.md) |
| A release is tagged on a commit that never passed staging | The production workflow re-ran only the fast unit tests | Gate on a per-commit verdict that the staging deploy wrote | [07, section 1](./07-release-gate.md) |
| A tag cut on a side branch reaches the production role | Nothing checked that the tag is on `main` before assuming the role | Run `merge-base --is-ancestor` in a job without AWS access, with `fetch-depth: 0` | [07, section 1](./07-release-gate.md) |
| A `v*` tag push deployed to production with no approval | GitHub Free private repositories cannot have environment protection rules (the API answered 422) *(observed)* | Use `workflow_dispatch` with a `tag` input and keep `environment: prod` only for the OIDC subject | [07, section 6](./07-release-gate.md) |
| The production deploy starts although the unit tests failed | `deploy` listed only `e2e-gate` in `needs` | List `assert-on-main`, `verify`, and `e2e-gate` in `needs` and pin it with a workflow test | [07, section 6](./07-release-gate.md) |
| The gate cannot tell a failed commit from one that never ran, or reports "never ran" for a commit whose probe was green | The workflow wrote the verdict only on pass; or the probe writes its verdict a few minutes after the staging deploy and the tag came first | Publish on pass and on fail with `!cancelled()` and outcome `success` or `failure`; for the late probe, wait for its run and tag again | [07, section 3](./07-release-gate.md) |
| The gate shows `403 Access Denied` for a missing verdict | The production role lacks `s3:ListBucket`, so S3 hides the difference between a missing key and a denied read | Grant `s3:ListBucket` to the production role only | [07, section 4](./07-release-gate.md) |
| A deploy role could forge the evidence it needs | The production role could write to the verdict bucket | Staging writes and cannot read; production reads and cannot write; pin both with a template test | [07, section 4](./07-release-gate.md) |

---

## Section 6: Third parties and LLM

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| A screenshot spec clicked a button that reached a paid service | Only a README told people not to run the probes | Add the guard that aborts and records assistant, payment, and notifier requests, and assert the attempts list is empty in `afterEach` | [08, section 1](./08-third-parties-payments-and-messaging.md) |
| The preflight froze an old origin after a parameter change | API Gateway kept the allowed origin it read on the first deploy, and a parameter change creates no new deployment | Resolve the origin at synth time and pin the CORS configuration per stage in a synth test | [08, section 1](./08-third-parties-payments-and-messaging.md) |
| The assistant smoke goes red after a wording change | The spec pinned what the model said | Assert liveness: busy indicator hidden, input enabled and focused, fixed error copy absent, a turn container visible | [09, section 1](./09-llm-and-agent-flows.md) |
| The assistant returns 504 | The answer passed the API Gateway limit of about 29 s; a text answer took 16 to 23 s and a photo 23 to 26 s *(observed)* | Wait up to 60 s for the response, retry once in CI, and plan an asynchronous design | [09, section 2](./09-llm-and-agent-flows.md) |
| A probe fails because a number differed between runs | The same input gave 550 and 569 on two runs *(observed)* | Be strict on shape and loose on values, and add one domain sanity assertion | [09, section 2](./09-llm-and-agent-flows.md) |
| A rare event (turn deadline) is never exercised, or a dev-only knob reaches production | Waiting for the event is slow and a pass would be luck; the probe variable or a short undo window was written for every stage | Add a dev-only probe phrase the service recognises, and pin staging and prod to the real values in a config test and a synth test | [09, section 4](./09-llm-and-agent-flows.md) |
| The local lane fails all night waiting for canned assistant lines | The "no mocks in the front" rule removed the scripted agent, and two specs still waited for it | Assert the honest fallback ("not connected") in the local lane, and cover the real assistant in the smoke | [09, section 1](./09-llm-and-agent-flows.md) |
| The evals judge disagreed with itself and the smoke never ran for four attempts *(observed)* | The evals ran before the smoke, and a model judge grades the same answer differently on two runs | Run the smoke first, the evidence guard second, the evals last | [06, section 7](./06-ci-workflows.md) |
| The real checkout form looks complete and Pay does nothing | A broad selector matched hidden duplicate fields in wallet iframes, the payment element renders late, and the popup kept an opener relation | Open the checkout in a clean context, use the frozen selector recipe, pick the Card tab, and keep the documented settle wait | [08, section 2](./08-third-parties-payments-and-messaging.md) |
| Cancelling or expiring a subscription left users premium | The webhook store keyed idempotency on the subscription id, which is the same for the whole lifecycle | Key on a hash of the raw body, and send `created` then `expired` with the same id in the webhook spec | [08, section 2](./08-third-parties-payments-and-messaging.md) |
| A multi-payer flow cannot be tested end to end, or the mock provider exists in a stack real customers use | A real provider needs a person to confirm each payment; the mock flag defaulted on or was copied between stacks | Deploy a mock provider that auto-confirms only with an explicit CDK context flag, default it off, and add a synth test that finds no mock resources without it | [08, section 2](./08-third-parties-payments-and-messaging.md) |
| Every merge sent about seven messages to a real phone *(observed)* | The real notifier was deployed on every stack | Use a null channel by default and a `notifier_real` dispatch input that deploys the flag and runs one spec | [08, section 3](./08-third-parties-payments-and-messaging.md) |
| One checkout probe bills up to three real purchases per run | The blocking suite's retries of 2 applied to a paid probe | Set `retries: process.env.CI ? 1 : 0` ([00, section 6](./00-lanes-and-decisions.md)) on paid and third-party probes, with the cost beside the number | [08, section 4](./08-third-parties-payments-and-messaging.md) |

---

## Section 7: False greens

Each row says what passed and what it did not test.

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| The suite passed and the new commit was never tested, or the smoke lane skips itself with "this deploy has no backend" | A hardcoded default URL pointed at an old stack that no longer exists *(observed)* | Resolve the URL from `SMOKE_URL`, then from the CDK outputs file, then throw when every source is empty | [01, section 2](./01-config-lanes-and-target.md) |
| "Passed, 3 skipped": the console scripts passed by skipping, or a helper returned `null` without AWS credentials and scripts skipped themselves | The CI role could not read the operator secret, the scripts called `test.skip`, and the helper chose a silent fallback | Fail instead of skipping in CI, make the helper throw, check the secret before the smoke, and check the photo folders after it | [11, section 1](./11-skipped-scripts-and-photos.md) |
| Every browser spec passed, and the CORS preflight was never tested; a broken preflight stayed green for months | `page.route` interception skipped the browser's CORS check *(observed)* | Run a Node-side `OPTIONS` canary in the setup project, which no interception can touch | [08, section 1](./08-third-parties-payments-and-messaging.md) |
| The entry appeared on screen, and the server never accepted it | An optimistic UI painted the entry while the server answered 400 | Wait for the write's response, check `ok()`, then reload and assert from the server | [05, section 2](./05-multi-user-waits-and-time.md) |
| A console test passed for weeks while the console read a dead store | The local double returned a fixed response, which looks the same before and after the user acts | Back the double with a store that the fake endpoints read and write | [00, section 3](./00-lanes-and-decisions.md) |
| A subscription test passed against a double that accepted any topic, or a live desk never connects on the deployment but works locally | The fake WebSocket applied no gatekeeper rule, so it hid a real authorization bug (the channel was requested before the case was taken) | Make the double reject what the real gatekeeper rejects, and request the channel after taking the case | [00, section 3](./00-lanes-and-decisions.md) |
| Local flows passed after the real contract changed, or passed on the dev server while the deployed app breaks on routing or CORS | The double kept answering the old contract, and the framework dev server rewrites routes and ignores the CloudFront function | Serve the built export with `expo serve` or `vite preview`, and give every flow that uses a double a smoke spec against the real backend | [00, section 2](./00-lanes-and-decisions.md) |
| The local or smoke lane passes against an old build | `reuseExistingServer: true` reused a server started from an earlier export, or the PWA service worker served cached files from the previous deploy | Set `reuseExistingServer: false` so Playwright throws when the port is taken, and set `serviceWorkers: 'block'` | [01, section 3](./01-config-lanes-and-target.md) |
| `toHaveCount(0)` passed before and after the fix | The notice rendered in a screen that was mounted but hidden behind another screen | Navigate to the visible screen first, run the spec against the unfixed build, and prefer asserting the replacement is visible | [12, section 3](./12-proving-a-fix.md) |
| `toBeVisible()` failed on text that was on screen, or `.first()` asserted on a stale copy | Expo Router keeps left screens mounted but hidden, and `.first()` found the old copy | Use `getByText(...).filter({ visible: true }).last()` | [12, section 3](./12-proving-a-fix.md) |
| The suite passed with the agent's payload broken; every analysed record was lost with a 400 | The agent emitted `null` for optional fields, the server schema accepted only a missing field, and hand-written test payloads had no nulls | Post the exact payload the agent builds, nulls included, to the endpoint that stores it and read it back | [09, section 3](./09-llm-and-agent-flows.md) |
| Twenty-one blocking cases passed with the headline feature broken | The suite aborts the assistant by design, so it never ran | Add the opt-in assistant probe that runs after the staging deploy and make its verdict required by the release gate | [09, section 2](./09-llm-and-agent-flows.md) |
| The screen showed a wrong header for a month with the suite green | One of four places kept the old value and no assertion looked at it | Attach before and after photos of the same screen to any pull request that changes what a person sees | [12, section 1](./12-proving-a-fix.md) |
| The required pull request check was green with no tests run | The gate job had no `if`, so a skipped need skipped the gate, and GitHub counts a skipped required check as passing | Give the gate job `if: ${{ !cancelled() }}`, `needs` on every job, and check each result | [10, section 1](./10-guard-tests.md) |
| Guard tests were red or unrun for months | No workflow executed the folder that holds them, or a `paths:` filter skipped them | Put them in a workspace that the CI test command runs, with no `paths:` filter, and test that the workflow exists | [10, section 1](./10-guard-tests.md) |
| A guard test or photo guard passed while checking nothing, even after a helper rename | It looped over an empty list, compared `-1` with `-1`, or `grep` matched nothing | Add a vacuity check, make step lookup throw when nothing matches, and make shell guards fail on an empty derived list | [10, section 1](./10-guard-tests.md) |
| A document told agents a gate existed that nobody ran, or a runbook describes a check the script no longer performs *(observed)* | The rule asked for a green that a branch dispatch cannot give for app code, or the script began requiring two verdicts and the docs went stale | Write where the green arrives, name the job and the script, and add a docs-honesty test that bans the old wording and requires the new | [10, section 1](./10-guard-tests.md) |
| A branch dispatch is green, and the app change was never tested | A dispatch that does not deploy tests whatever is already on the stack | Treat it as proof for spec-only changes; for app changes the green that counts is the smoke after the push on the personal stack | [06, section 3](./06-ci-workflows.md) |
| An old green stays green for a changed environment | The gate accepts a `passed` verdict of any age | Compare `completedAt` with `maxAgeDays` on probes that depend on outside services | [07, section 7](./07-release-gate.md) |
| A flake or race was declared fixed after one green run, by feel, or after `--repeat-each=10` | The run may have retried, a global retry hid the failure, repeats in one run share the warm Lambdas, and a screenshot shows one race | Show N separate CI runs at `--retries=0` plus a line that states the limit of the evidence; count race rounds with a race-counter spec and record `split/ROUNDS` before and after | [12, section 2](./12-proving-a-fix.md) |
| A new assertion has never failed | Nobody ran it against the unfixed build | Watch it go red once before trusting it | [12, section 3](./12-proving-a-fix.md) |
| The suite stays green for weeks with specs quarantined by `describe.skip` | The quarantine has no owner and no expiry | Quarantine with an issue reference and a date, and have a guard count and list skipped specs | [11, section 1](./11-skipped-scripts-and-photos.md) |
| A webhook spec passes without changing anything on its second run | It reused a subscription id from an earlier run, and the store treated it as a duplicate | Use a unique subscription id per run | [08, section 2](./08-third-parties-payments-and-messaging.md) |
| The photo guard is satisfied by an old folder | The folder came from an earlier run | Wipe the flow's folder when the flow starts | [11, section 2](./11-skipped-scripts-and-photos.md) |

---

## Section 8: Evidence and guard tests

| Symptom | Cause | Fix | Pattern |
|---|---|---|---|
| The smoke passed and the run is red because of a missing photo folder | A script that is fully `test.fixme` never creates its folder | Discount only top-level `test.fixme(` in a file with no live test, and print a notice; a `fixme` in the middle of a live script still counts | [11, section 1](./11-skipped-scripts-and-photos.md) |
| A photo shows half-loaded images, fallback fonts, or an empty or loading screen | The capture ran before fonts and images finished, or before the content assertion | Assert the content that makes the screen what it claims to be, wait for `document.fonts.ready` and every image to be `complete` with `naturalWidth > 0`, then shoot | [11, section 2](./11-skipped-scripts-and-photos.md) |
| The merge gate is red with `Protocol error (Page.captureScreenshot)` | Chromium sometimes fails a single capture | Retry the capture up to three times with a short back-off, then throw | [11, section 2](./11-skipped-scripts-and-photos.md) |
| A failed run leaves no photo of the failing step | The photo was taken after the step on success only | Take the step photo in `finally`, and register a `where it failed` photo in `afterEach` under its own folder name | [11, section 2](./11-skipped-scripts-and-photos.md) |
| A workflow guard test fails on a comment | The forbidden literal appears in a comment that documents what must not happen | Parse the YAML for steps, and read the text with comment lines removed for "must not appear" rules | [10, section 1](./10-guard-tests.md) |
| A guard test that re-implements the workflow's `awk` logic passes while the workflow is wrong | It proves the copy, not the workflow | Move the logic to `scripts/ci/` and let the test run that same script on a fixture | [10, section 1](./10-guard-tests.md) |
| The `tsc` guard test or the stack synth tests time out on a busy machine | The runner's default 5 s test timeout is below the 6 to 8 s `tsc` took under load *(observed)*, and the default hook timeout is too low once stacks grew | Set the test timeout to 60 s, raise `hookTimeout`, and drop esbuild bundling from test synth | [10, section 1](./10-guard-tests.md) |
| Photos in a pull request stop loading after the branch is deleted | The image link was branch-relative | Link a raw URL that includes the commit SHA | [12, section 1](./12-proving-a-fix.md) |
| Evidence photos from a manual run are useless and show false reds | The run overlapped a CI deploy on the shared stack | Wait until the deploy workflow has no unfinished run, check twice, and count a failed `gh` call as busy | [12, section 1](./12-proving-a-fix.md) |
| `toHaveScreenshot` fails on the Linux runner but passes on a Mac | Baselines differ per browser and platform | Add it only when the design is final and CI anchors the baselines; use photos for review | [12, section 1](./12-proving-a-fix.md) |

---

## Further reading

- [`../../bedrock-agentcore/references/05-gotchas.md`](../../bedrock-agentcore/references/05-gotchas.md): AgentCore runtime behaviour itself, such as session readiness retries (424 and 409), idle timeouts, and cold starts.
