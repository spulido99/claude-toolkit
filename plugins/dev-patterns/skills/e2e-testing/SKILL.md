---
name: e2e-testing
description: Playwright end-to-end (e2e) tests on AWS. Use when deciding what runs against the local build, the deployed stack (smoke), or opt-in probes; configuring Playwright; logging test users in through Cognito; seeding and cleaning shared test data; running the suite from GitHub Actions with OIDC; blocking a production deploy until the commit passed e2e in staging; testing LLM, payment, or messaging flows; or diagnosing a flaky or falsely green suite and proving the fix.
---

# End-to-end testing

Reference for Playwright end-to-end tests of a web app or PWA (including an Expo web export) on an AWS serverless stack, run from GitHub Actions with OIDC. The patterns come from three production projects, where most incidents were **false greens**. Facts marked *(observed)* were measured in those projects, not taken from vendor documentation.

## Vocabulary

Every reference uses these words with one meaning each:

| Word | Meaning | Example in `acme` |
|---|---|---|
| **lane** | A Playwright suite with one subject and one target, run by its own command and its own config or project. | The smoke lane runs `npm run test:smoke` against the deployed `dev-e2e` stack. |
| **local lane** | The built web export served on localhost, with the backend replaced by stateful doubles. | `vite preview` serves `apps/web/dist`; a fake orders API keeps orders in memory. |
| **smoke lane** | The deployed stack with the real backend. | A spec signs in as the QA user, places an order and sees it in the console. |
| **probe lane** | An opt-in lane that exercises one paid, non-deterministic, or third-party dependency for real. | A spec asks the assistant a question and checks that an answer arrives. |
| **false green** | A run that passes without having tested what it claims. | The suite ran against an old stack because the config had a default URL. |
| **guard test** | A fast unit test, run by the normal CI test command, that pins a property of the harness itself. | A test that reads `deploy-dev.yml` and fails if the smoke step comes before the deploy step. |
| **verdict** | A small JSON file, one per lane and per commit, written on pass and on fail, that a release gate reads. | `e2e-reports/<sha>/status.json` with `{ "status": "passed" }`. |
| **the green that counts** | The run whose result validates a given change. For app code, it is the smoke run against a stack deployed from that code. | A merge to `agent-development-alex` deploys `dev-alex`, and the smoke that follows is the green for that merge. |

## When to load each reference

| Task | Reference file |
|------|----------------|
| Starting a suite, deciding which lane a scenario goes to, which environment each lane targets, which CI shape to use, retries policy | `references/00-lanes-and-decisions.md` (required for a new suite) |
| `playwright.config.ts` for each lane, opt-in probe projects, setup projects, resolving `baseURL` from the deploy outputs, the local `webServer`, finding backend addresses in the built bundle | `references/01-config-lanes-and-target.md` |
| Workers, timeouts, reporters and artifacts, browser and device options, typechecking `e2e/`, pinning the Playwright version | `references/02-config-runtime.md` |
| Logging test users in through Cognito without the UI, injecting the session, QA users and their secrets | `references/03-auth-and-test-users.md` |
| Seeding, shared fixtures on a deployed stack, cleanup that verifies, isolation between runs | `references/04-test-data.md` |
| Several people in one flow, waiting for eventual consistency, `page.clock` and dates, race counters | `references/05-multi-user-waits-and-time.md` |
| GitHub Actions: the smoke job in the deploy workflow, OIDC roles, triggers, concurrency, artifacts, notifications, evals order, job timeouts, rules for agents that run the suite | `references/06-ci-workflows.md` |
| Blocking a production deploy until the exact commit passed e2e in staging | `references/07-release-gate.md` |
| Keeping paid and third-party calls out of blocking lanes, the CORS canary that request interception hides, payments, WhatsApp/SMS, probe hygiene | `references/08-third-parties-payments-and-messaging.md` |
| LLM or agent answers: the assistant in the smoke lane, the assistant probe, the agent's payload, forcing rare events | `references/09-llm-and-agent-flows.md` |
| Guard tests that pin the harness: workflows, the gate job of the pull-request checks, configs, source scans, docs wording, IAM | `references/10-guard-tests.md` |
| Scripts that skip themselves, checking preconditions and evidence around the smoke, step photos | `references/11-skipped-scripts-and-photos.md` |
| Proving a flake is fixed, before and after evidence on a pull request, assertions that cannot fail | `references/12-proving-a-fix.md` |
| Diagnosing a red, flaky, or suspiciously green run | `references/13-gotchas.md` |

## Cross-cutting principles

Each rule is explained in the reference it points to:

- Test what ships: the local lane serves the built export (`vite preview`, `expo serve`) and the smoke lane hits the deployed stack. See section 2 of `00-lanes-and-decisions.md`.
- Resolve the target URL from the deploy outputs and fail when it is missing; a default URL once made a whole suite go green against another environment. See section 2 of `01-config-lanes-and-target.md`.
- Keep paid, non-deterministic, and third-party flows out of blocking lanes by structure (opt-in project, aborted requests that are asserted absent), and cover them with a probe. See section 1 of `08-third-parties-payments-and-messaging.md`.
- Every run seeds what it reads and cleans what it creates, with ids unique per run (`04-test-data.md`), and gives each person in a flow their own browser context (section 1 of `05-multi-user-waits-and-time.md`).
- Every way a run can pass without testing gets a guard test or a CI check, run by the normal CI test command. See `10-guard-tests.md` and section 1 of `11-skipped-scripts-and-photos.md`.
- The production deploy reads the verdict of every required lane for the tagged commit. The staging role writes verdicts on pass and on fail and cannot read them; the production role reads them and cannot write them. See `07-release-gate.md`.
- Retries are 0 outside CI; in CI each lane sets its number in its config with the reason beside it (section 6 of `00-lanes-and-decisions.md`). A flake fix is proven by consecutive runs at `--retries=0` (section 2 of `12-proving-a-fix.md`).
- Write down for agents which run is the green that counts for each kind of change, and that an `AccessDenied` on the CI role is a missing permission, not a verdict on the code. See section 9 of `06-ci-workflows.md`.

## Scope

This skill covers browser end-to-end tests and the CI around them. Neighbouring topics live elsewhere:

- Native mobile end-to-end tests (Maestro, Detox): sibling skill `expo-react-native`, `references/06-performance-and-testing.md`.
- Agent answer quality (eval datasets, LLM judges) and the CLI smoke of an AgentCore runtime: sibling skill `bedrock-agentcore`, `references/04-observability-and-evals.md`, and the `deepagents-builder` plugin's `evals` skill.
- CDK stages, stack suffixes, and the deploy workflow itself: sibling skill `aws-cdk-patterns`, `references/06-deploy-workflow.md`.
- DynamoDB Local and testcontainers for integration tests: sibling skill `dynamodb-design`, `references/06-testing-local-dev.md`.

## Conventions

- Examples use one app, `acme`: a mobile-first customer PWA plus an operator console under `/console/`, on API Gateway, Lambda, DynamoDB, Cognito, and CloudFront, with an AI assistant on Bedrock AgentCore.
- Every mechanical rule ships with a check (a guard test, a setup assertion, or a CI step). Copy the assertion; replace the fixtures with your project's.
