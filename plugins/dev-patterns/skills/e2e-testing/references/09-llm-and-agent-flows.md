# LLM and Agent Flows

**Builds:** A suite that proves the assistant works without pinning what it says. The smoke lane asserts that a real turn finishes and the screen is usable. An opt-in probe checks the shape of a structured answer. A free contract spec checks that the API accepts exactly the payload the agent emits, and rare events such as a turn deadline are forced on purpose in dev instead of waited for.

**When to use:** Testing the assistant in the smoke lane, writing the assistant probe, writing the contract spec for the agent's payload, and forcing rare events.

**Prerequisites:** [01, section 1](./01-config-lanes-and-target.md) for the opt-in project wiring. [`03-auth-and-test-users.md`](./03-auth-and-test-users.md) for the QA users. [08, section 1](./08-third-parties-payments-and-messaging.md) for `guardExternalServices`, which the specs below call.

> Verified on 2026-10-14 against `@playwright/test` 1.64; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. The assistant in the smoke lane: assert liveness and leave the wording unpinned
2. An assistant probe with structured output
3. A contract spec for the agent's payload
4. Forcing rare events

---

## Section 1: The assistant in the smoke lane: assert liveness and leave the wording unpinned

The smoke lane runs the real assistant when the point is to prove the whole path works: browser, API Gateway, Lambda, AgentCore runtime, and back. No double stands in for the model. One production project's rule was "no mocks in the front", and the local lane there asserted only that the app says the assistant is not connected, because tests that waited for canned lines left the local test run red for a night *(observed)*.

Assert that the turn finished and the screen is usable, and leave the model's wording unpinned, because the wording changes between runs and pinning it turns the script into a prompt test that goes red for no product reason.

| Assert | Why it can fail for a real reason |
|---|---|
| The busy indicator ("Assistant is typing...") is hidden within the window | The turn never ended or the stream broke |
| The input is enabled again and focused | The UI stayed locked after the turn |
| The fixed error copy ("I can't answer right now") has count 0 | The backend returned its failure path |
| A turn container (`getByTestId('assistant-turn').first()`) is visible | Nothing rendered at all |
| Legal copy ("You are talking to an automated assistant, not a person") matches verbatim before the first message | Required product text was removed; it is product copy, not model output |

```ts
// e2e/assistant.smoke.spec.ts
import { test, expect } from '@playwright/test';
import { guardExternalServices } from './lib/guard';

test('the assistant answers a question and the screen is usable again', async ({ page }) => {
  test.setTimeout(150_000);
  const attempts = await guardExternalServices(page, process.env.API_URL!, ['payments', 'notify']);
  // The smoke project starts signed in: auth.setup.ts wrote the storageState (03, section 2.1).
  await page.goto('/assistant');

  await expect(page.getByText(/automated assistant, not a person/i)).toBeVisible({ timeout: 20_000 });

  const input = page.getByRole('textbox', { name: 'Ask the assistant' });
  await input.fill('Where is my order?');
  await input.press('Enter');

  await expect(page.getByText('Assistant is typing...')).toBeHidden({ timeout: 60_000 });
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(page.getByText(/I can't answer right now/)).toHaveCount(0);
  await expect(page.getByTestId('assistant-turn').first()).toBeVisible();
  expect(attempts()).toEqual([]);
});
```

### 1.1 Say which failure happened

Three different failures look like one red test. The message must tell them apart, because the fix differs: a screen that was not ready is an app bug, a slow model is a budget problem, and a 504 means the answer exceeded API Gateway's limit of about 29 seconds.

- No request left the page: the screen was not ready when the test pressed the button. Record `page.on('request')` for the assistant route and throw "Pressing Ask sent no request: the screen was not ready" when the list is empty.
- No answer within the window: throw "No answer to POST /assistant/ask within 60 s".
- Status 504: attach the reason to the status assertion, as in `expect(response.status(), response.status() === 504 ? 'the answer hit the API Gateway 29 s limit' : 'unexpected status').toBe(200)`.

Wait for the precondition before pressing. In one project the app booted with a default "free" subscription until `GET /subscription` answered, and a premium user who pressed "Analyze" in that window was sent to the paywall. The probe found a real app bug. Wait for the unlocked copy to be visible, then press *(observed)*.

### 1.2 Budgets from measurements

A text answer took 16 to 23 s and a photo answer 23 to 26 s *(observed)*. The response wait is 60 s: a 504 always arrives well inside it, and waiting longer than needed costs nothing while keeping a slow round trip from being reported as "the app never called the API", which is a different bug *(observed)*. Test timeouts were 120 s for text and 180 s for photo, and 60 s for a model turn in the UI. Use `expect(async () => { ... }).toPass({ timeout: 90_000 })` for the thread after a reload, and give raw runtime calls `request.post(url, { timeout: 120_000 })`. `toPass` has no timeout unless you set one, so always pass it.

Deterministic assertions about the agent's tools belong in the agent's own unit tests. Answer quality belongs to evals; see section 1.3 for their place in CI.

### 1.3 Where evals sit

Evals grade quality with a model judge, and a judge sometimes grades the same answer differently. In one project the evals ran before the smoke, a judge failure turned the run red, and the smoke did not run for four attempts in a row *(observed)*. Evals run after the smoke and the evidence guard; the order and its reason are in [06, section 7](./06-ci-workflows.md). The evals themselves are in [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md), section 6. An eval measures whether the answer is good; the smoke measures whether the path works. Each runs in its own lane.

---

## Section 2: An assistant probe with structured output

When the assistant returns a structured result the app renders (a classification badge, a name, numbers, a list of details), the blocking lanes never trigger it, so nothing checks that the feature the product sells works. One project shipped with the analysis broken and every blocking test green, because the blocking suite aborted every assistant request by design *(observed)*. The probe closes that gap.

The probe is the opt-in project `probe-llm` of `playwright.smoke.config.ts`, which exists only when `E2E_PROBE_LLM=1` is set and runs against the deployed stack; the wiring is in [01, section 1](./01-config-lanes-and-target.md). The probe signs in as the premium user through the `setup-premium` project, which also runs the CORS canary of setup. It runs after the staging deploy and never blocks it. Its verdict can block a release; see [07, section 3](./07-release-gate.md).

### 2.1 Loose on numbers, strict on shape

The same input gave 550 and 569 on two runs, and 293 and 344 on two others *(observed)*. Pinning a number makes the probe fail for no product reason. Pin the things that must always hold.

| Strict (shape) | Loose (values) |
|---|---|
| Status 200 | Numbers are greater than 0, not equal to a value |
| Badge text matches an enum regex, `/^(Low|Moderate|High|Very High) risk$/` | Name is non-empty and not `/unknown/i` |
| The details section is visible and has at least one row | Totals fall in a wide range instead of matching an exact figure |
| Every numeric field is a number greater than or equal to 0 | |

Add one domain sanity assertion that must go red if the answer is dangerously wrong. Choose an input whose class is known without a model. In the example app, a customer order that contains a restricted item must come back flagged. The comment in the spec says what failure it guards, so nobody loosens it later.

[`assets/assistant-analysis.probe.spec.ts`](../assets/assistant-analysis.probe.spec.ts) is the whole probe, to copy as `e2e/assistant-analysis.probe.spec.ts`. Read it when you write or change the probe; to review one or answer a question about it, this section is enough. The spec guards `payments` and `notify` so only the assistant door is open, records every request to `/assistant/analyze-order` so a missing response can be told from a screen that was not ready, waits for the unlocked button because the app boots with a default plan until `GET /subscription` answers, sets the response wait to 60 s (measured 16 to 26 s, while API Gateway cuts at about 29 s), and fails with a message that names which of the three failures in section 1.1 happened. It ends with the sanity assertion: the comment "if the app ever calls a restricted-item order low risk, this goes red" sits above the check that the badge says High or Very High.

An upload variant uses the file chooser: `const chooser = page.waitForEvent('filechooser')`, click the upload button, `await (await chooser).setFiles('fixtures/parcel.jpg')`, and wait for the presigned `PUT` to S3 to return 200 before pressing Analyze. Commit the fixture image to the repo. A probe that already depends on the model being up should not also depend on a bucket being readable *(observed)*.

### 2.2 One retry, with the cost next to it

Set `retries: process.env.CI ? 1 : 0` on the `probe-llm` project (rule in [00, section 6](./00-lanes-and-decisions.md)), with the reason in a comment: "One retry: an analysis that brushes the API Gateway limit is a timing loss, not a broken feature. About two cents a retry." *(observed)* Two cents is the project's figure; write your own next to the number. More retries multiply the bill and hide a feature that fails half the time.

### 2.3 The limit that will change

A synchronous call against a 29 s ceiling loses runs: before the agent-side fixes, 4 of 5 real invocations died at the limit in one project *(observed)*. The structural fix is an asynchronous design (a job id and polling, or streaming), and the probe changes with it: it then waits for the job result, not for the first response. Long turns are in [`bedrock-agentcore/references/03-long-turns-and-state.md`](../../bedrock-agentcore/references/03-long-turns-and-state.md).

### 2.4 Evals and the probe

The probe checks that the path works with one case and shape-only assertions, automatically after each staging deploy. Evals check answer quality with many cases against ground truth. Keep both, and keep the eval cases out of the probe.

---

## Section 3: A contract spec for the agent's payload

The agent's output is stored by the API, and the blocking lanes never see it. One project lost every assistant-analysed record: the agent emitted `null` for two optional fields, the server schema accepted a missing field but not `null`, and the API answered 400. Hand-written test payloads never contained `null`, so the suite stayed green *(observed)*.

The free, deterministic fix is a spec that posts exactly what the agent emits, nulls included, to the endpoint that stores it, then reads the record back. Copy the payload from the agent's result builder, not from memory. It uses raw `fetch` because the app's API client throws on any non-2xx status, and the status code is the point.

[`assets/assistant-payload.smoke.spec.ts`](../assets/assistant-payload.smoke.spec.ts) is the whole spec, to copy as `e2e/assistant-payload.smoke.spec.ts`. Read it when you write or change the contract spec; to review one or answer a question about it, this section is enough. It reads the QA user's token from `.auth/session.json`, which the setup project writes ([03, section 2.1](./03-auth-and-test-users.md)). It posts an order whose `analysis` carries `weightKg: null` and `note: null`, expects a 201, reads the order back, and asserts that the risk level survived and that the two null fields are stored as absent (`'weightKg' in stored.analysis` and `'note' in stored.analysis` are both false). The status assertion carries the failure message:

```ts
  expect(created.status, `POST /orders rejected the agent's payload: ${await created.clone().text()}`).toBe(201);
```

The assertion message names the failure that justified the spec, so whoever sees it red knows what came back. When the server schema changes, update the payload from the agent's code in the same change. A unit test on the server that uses the same payload shape keeps the two from drifting.

---

## Section 4: Forcing rare events

Some events happen only at the edge: a turn that exceeds its deadline, an undo window that expires, a retry that exhausts. Waiting for them is slow and the test would pass by luck. In one project a turn took 5 to 9 s and the deadline was 120 s, so waiting for the overrun "would be a coincidence, not a test" *(observed)*.

### 4.1 A probe phrase, dev only

The service recognises one fixed phrase and treats it as an instruction to hit its turn deadline. The recognition is active only when a dev-only environment variable is set, and the CDK stack writes that variable only for dev. Staging and prod never receive it, so the phrase is plain text there.

```ts
// infra/lib/assistant-service.ts (excerpt)
const environment: Record<string, string> = {
  TURN_DEADLINE_SECONDS: '120',
  ...(isDevStage(stage) ? { TURN_DEADLINE_PROBE_PHRASE: 'acme: turn deadline probe' } : {}),
};
```

One turn then checks three things: the UI warning appears at the slow-turn threshold without closing anything (about 15 s), the service writes its timeout log line at the cap, and the CloudWatch alarm for timed-out turns goes to `ALARM`. Read the alarm with the AWS CLI; when the run has no AWS credentials, announce loudly that the alarm check was skipped and run the first two checks.

Force the event with a phrase the service recognises, never with a tool the model could choose. A tool the model can pick can be picked in production, and then a customer's turn times out on purpose.

A guard test reads the CDK synth output for the staging and prod stacks and fails when the probe variable appears in either. The test is in [10, section 1.8](./10-guard-tests.md).

### 4.2 Knobs that shorten waits in dev

Set the wait per level, in config, so dev is fast and prod keeps its real value. In one project the undo window was 30 s in dev and 5 min in prod, and the smoke lane went from 12.5 min to the length of its longest script after that change plus a worker ceiling *(observed)*; the worker ceiling is in [02, section 1](./02-config-runtime.md).

```ts
// infra/config/assistant.ts
export const undoWindowSeconds: Record<Stage, number> = {
  'dev-e2e': 30,
  dev: 30,
  staging: 300,
  prod: 300,
};
```

A guard test pins staging and prod to the real value. A short window that reaches prod is a product bug, and only the config can show it.

---

## Verification

```bash
# Opt-in run selects exactly the probe project
E2E_PROBE_LLM=1 npx playwright test --config e2e/playwright.smoke.config.ts --list --project=probe-llm

# The source-scan and config guard tests (run by the normal CI test command)
npm test -w shared
```

### Test checklist, one per mechanical rule

| Rule | Check |
|---|---|
| The assistant smoke leaves model wording unpinned | Source-scan guard test: no `toHaveText`/`toContainText` with a string literal inside `assistant.smoke.spec.ts` except the legal-copy line |
| The agent's payload is accepted by the API, nulls included | `assistant-payload.smoke.spec.ts`, plus a server unit test with the same payload |
| The deadline probe phrase exists only in dev stacks | CDK synth test: the probe variable is absent from the staging and prod stacks |
| Staging and prod keep the real undo window | Config unit test pinning the values |

## Further reading

- [`bedrock-agentcore/references/04-observability-and-evals.md`](../../bedrock-agentcore/references/04-observability-and-evals.md), section 6 for evals.
- [`bedrock-agentcore/references/03-long-turns-and-state.md`](../../bedrock-agentcore/references/03-long-turns-and-state.md) for turns longer than API Gateway allows.
- Playwright: https://playwright.dev/docs/test-assertions (`expect.poll`, `toPass`), https://playwright.dev/docs/test-projects
