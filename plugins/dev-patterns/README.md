# dev-patterns

Cross-cutting reference patterns and gotchas for common tech stacks. Each skill uses progressive disclosure: a lean `SKILL.md` routes Claude to detailed reference files, loaded only when needed.

## Skills included

### `aws-cdk-patterns`

Opinionated architecture for AWS CDK v2 in TypeScript. Builds on a recommended hexagonal + DDD structure, documents construct patterns for the most common use cases, and catalogs known gotchas with symptom → root cause → fix lookup tables in every reference file.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Starting a new CDK project | `00-architecture.md` |
| Adding a Lambda + DynamoDB endpoint | `00-architecture.md` + `01-serverless-api.md` |
| Adding Google Sign-In | `02-auth-stack.md` |
| Hosting a SPA with custom domain | `03-static-site.md` |
| Designing DynamoDB or Aurora access patterns | `04-database.md` |
| `parseBody` / `validateEnv` / CORS helpers | `05-shared-utilities.md` |
| Pre-deploy checklist / rollback / stages | `06-deploy-workflow.md` |

**Key topics covered:**

- Hexagonal Lambda modules (handler / service / port / adapter) inside DDD bounded contexts
- Two-stack backend + frontend split, with `config.json` bridge and CloudFront domain registration
- Shared infrastructure constructs (`CognitoConstruct`, `ApiGatewayConstruct`, `LambdaLayerConstruct` — full Docker-bundled example included, `AuditLogConstruct`, `EventBusConstruct`, `MonitoringConstruct`) injected through a typed `SharedInfra` prop
- `stackSuffix` naming pattern so two developers can deploy to the same AWS account without resource-name collisions
- Cognito User Pool with Google federated identity using `clientSecretValue: SecretValue` (no `unsafeUnwrap`)
- S3 + CloudFront + OAC SPA hosting (not OAI), SPA routing via `errorResponses`, the two-deploy CloudFront domain registration bootstrap
- Aurora Serverless v2 with scale-to-zero (current supported PostgreSQL minors) and Data API
- DynamoDB single-table vs multi-table decision tree, atomic uniqueness via `TransactWriteCommand` + lookup table, identity-verified updates, opaque base64 cursor pagination
- `parseBody` (Zod), `createResponse`, `withCors` that enforces CORS/security headers over any handler value, `validateEnv` (fail-fast, typed), `loadSecret` with cold-start cache, standardized `ApiResponse<T>` and `ErrorCodes`
- Pre-deploy checklist (`cdk diff`, profile verification, secret scanning with `gitleaks`/`trufflehog`, git tagging), stage + suffix system, binary `isProd` branching, basic rollback via deploy tags
- Construct-level testing with `aws-cdk-lib/assertions` (`Template.fromStack`, `hasResourceProperties`, `allResourcesProperties`, `Match.absent`) as a 4th layer alongside service / adapter / handler tests

### `dynamodb-design`

Stack-agnostic methodology for designing DynamoDB schemas from access patterns. Complements `aws-cdk-patterns` (which owns CDK provisioning and three canonical runtime patterns — atomic uniqueness, identity-verified updates, cursor pagination); this skill owns the upstream modeling work. Cross-references are bidirectional: `aws-cdk-patterns/04-database.md` §2 links here for the single-table vs multi-table decision tree, and the write-correctness reference here links to the CDK skill for the three runtime patterns with full TypeScript.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Designing a new schema from scratch | `00-methodology.md` + `01-modeling.md` |
| Adding a new access pattern to an existing table | `00-methodology.md` + `01-modeling.md` |
| Migrating a schema without downtime | `05-evolution.md` |
| Hot partition or throttling | `02-scaling.md` |
| Optimistic locking, atomic counters, batch ops | `03-write-correctness.md` |
| Wiring DynamoDB Streams or CDC | `04-streams-cdc.md` |
| Running DynamoDB locally for tests | `06-testing-local-dev.md` |
| Diagnosing a production symptom | `07-gotchas.md` |

**Key topics covered:**

- Six-step design methodology (inventory access patterns → classify → base keys → GSIs → validate → single-vs-multi) with greenfield / extension / migration branches and a worked e-commerce example
- Partition and sort key design, composite patterns, sort-key prefix conventions, key overloading and entity discrimination
- GSI design with projection-cost tradeoffs (`KEYS_ONLY` / `INCLUDE` / `ALL`), sparse indexes, adjacency list and hierarchical patterns
- Hot partition mitigation (write sharding, calendar-based sharding), item-size limits (400 KB hard limit, 1 KB WCU / 4 KB RCU boundaries), S3 offload with item pointers
- Cost modeling (`PAY_PER_REQUEST` vs `PROVISIONED` breakeven), GSI write amplification, auto-scaling behavior
- Optimistic locking with a `version` attribute, atomic counters, N-shard sharded counters, `BatchGet`/`BatchWrite` `UnprocessedItems` retry loops, `TransactWriteCommand` for multi-item atomic updates (money-transfer example)
- DynamoDB Streams view types, idempotent Lambda consumers with `eventID` dedup, OpenSearch projection example, DynamoDB Streams vs EventBridge Pipes decision tree
- Schema evolution without downtime — item versioning, live GSI backfill, attribute rename, dual-write + shadow reads + percentage rollout cutover, single↔multi table splits and consolidations
- Local testing with DynamoDB Local, testcontainers (`GenericContainer`), and LocalStack (for Streams + Lambda), per-access-pattern tests covering happy path + race + retry-cap-exceeded
- Gotchas catalog with 53 symptom → cause → fix rows across Design, Throughput, Write semantics, Streams, Evolution, Testing, and Expressions

### `expo-react-native`

End-to-end patterns for building Expo / React Native apps with the managed workflow + dev client. Closes the three-skill roadmap of `dev-patterns` — covers greenfield scaffolding, extension patterns, and backend integration with `aws-cdk-patterns` + `dynamodb-design`.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Starting a new Expo app | `00-architecture.md` + `01-navigation.md` |
| Adding a new screen or route | `01-navigation.md` |
| Client state, server state, or offline sync | `02-state-and-data.md` |
| Cognito / Google sign-in, API calls with auth | `03-auth-and-networking.md` |
| Push notifications, OTA updates, EAS Build / Submit, IAP config | `04-native-and-release.md` |
| Shipping to web / PWA | `05-cross-platform-web.md` |
| Performance tuning or test setup | `06-performance-and-testing.md` |
| Localization, RTL, or accessibility audit | `07-i18n-and-accessibility.md` |
| Crash reporting or analytics | `08-observability.md` |
| Subscriptions, paywalls, receipt validation | `09-monetization.md` |
| Diagnosing a production symptom | `10-gotchas.md` |

**Key topics covered:**

- Project scaffold (feature-folder / DDD structure, managed workflow + dev client, config plugins, EAS profiles with per-environment bundle IDs and channels)
- `expo-router` file-based routing, nested layouts, typed routes, protected routes with `<Redirect />`, universal / app links, paywall deep-link entry
- Client state (Zustand with MMKV persist) + server state (TanStack Query with optimistic updates + offline queue), storage tradeoffs (SecureStore / MMKV / AsyncStorage decision table), mutation queue surviving app restart
- Cognito + Google federation via `expo-auth-session` (PKCE), single-flight 401 refresh, typed `apiClient` matching `aws-cdk-patterns` `ApiResponse<T>`, biometric unlock via `expo-local-authentication`, 409 stale-data UI pattern
- Push notifications (`expo-notifications` with APNS + FCM, deep-link from payload), OTA updates (`expo-updates` channels), EAS Build + Submit (credentials, secrets, simulator builds for CI), iOS privacy manifests (iOS 17+), Android 13+ `POST_NOTIFICATIONS` runtime flow, Android 14 foreground-service types
- Expo for web (when viable vs Next.js), `Platform.select` patterns, responsive layouts, NativeWind vs StyleSheet tradeoffs, PWA manifest + service worker
- Performance — Hermes, new architecture (Fabric + TurboModules) status, `FlashList` over `FlatList`, `react-native-reanimated` v3 worklets, `expo-image` caching, bundle-size analysis
- Testing — Jest + React Native Testing Library, MSW (`msw/native`) for network mocks, Maestro (recommended) vs Detox for E2E, CI workflow with type-check + lint + unit + preview-build E2E
- i18n with `expo-localization` + `i18next` + ICU, RTL handling, accessibility APIs (`accessibilityLabel` / `Role` / `State`), VoiceOver + TalkBack testing checklist, `eslint-plugin-react-native-a11y`
- Observability — Sentry (crashes + JS errors + perf + session replay) with source maps via EAS, privacy scrubbing, PostHog for analytics with `noun_verb` event taxonomy, release health tracking
- Monetization — RevenueCat default (entitlements + offerings + server-side receipt validation + webhooks), paywall deep links, restore purchases, subscription-management deep links, webhook → Lambda → DynamoDB entitlement provisioning (cross-references `aws-cdk-patterns` + `dynamodb-design`)
- Gotchas catalog (80 rows) across architecture / navigation / state / auth / native / web / performance / i18n-a11y / observability / monetization themes

Test with the harness in `plugins/dev-patterns/skills/expo-react-native/scripts/` (RED/GREEN scenarios same pattern as `dynamodb-design`).

### `bedrock-agentcore`

Patterns for running a Python agent (LangGraph or deepagents) on Amazon Bedrock AgentCore Runtime, taken from the code and the deploy history of several production and prototype projects. It covers the runtime and the services around it. Agent design inside the graph stays in the `deepagents-builder` plugin, general CDK in `aws-cdk-patterns`, and the checkpoint table design in `dynamodb-design`.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Starting a new agent, or choosing zip vs container, L1 vs L2, AgentCore Memory vs own checkpointer, Bedrock vs provider API | `00-decisions.md` |
| `main.py`, zip packaging, CDK runtime construct, runtime IAM role, CI deploy order | `01-runtime-and-deploy.md` |
| `runtimeSessionId`, idle timeout, Cognito JWT authorizer, SigV4 invoker, retries, limits | `02-invocation-and-sessions.md` |
| Turns longer than 29 s, fire-and-forget handlers, live progress over AppSync Events, thread memory | `03-long-turns-and-state.md` |
| Traces, alarms, evals against the deployed runtime, smoke tests | `04-observability-and-evals.md` |
| Diagnosing an AgentCore error | `05-gotchas.md` |

**Key topics covered:**

- "AgentCore first" inventory: which AgentCore services to adopt now (Runtime, Observability), which to defer, and the condition to reopen each one
- Direct code deployment (zip in S3, `PYTHON_3_13`, arm64 wheels with `--only-binary=:all:`, both size quotas checked before upload) instead of a container image
- `CfnRuntime` (L1) and the alpha `Runtime` (L2) side by side, `PlatformVersion: V2` through a property override, a new artifact key on every deploy, `addDependency(role)`
- What runs at import and what waits for the first invocation, for V1's 30 s init limit and V2's snapshot start
- One `runtimeSessionId` per conversation (33+ characters, the same string from every caller), the idle-timeout cost, retries for 409 and 424 while a session starts
- Cognito JWT authorizer with `allowedClients` and `requestHeaderAllowlist: ['Authorization']`, SigV4 invocation from a backend, identity passed to tools through configuration
- Fire-and-forget turns with `add_async_task`, conditional writes for runs that outlive their caller, live progress over AppSync Events
- OpenTelemetry on a direct-code runtime, the IAM and account setup traces need, content capture off, alarms that fire on a single failed turn
- Evals and smoke tests that hit the deployed runtime through real authentication

Every mechanical rule ships with a check (pytest, jest, or shell). Test with the harness in `plugins/dev-patterns/skills/bedrock-agentcore/scripts/`.

### `e2e-testing`

Patterns for end-to-end tests written with Playwright for a web app or PWA (including an Expo web export) that runs on an AWS serverless stack, with the tests run from GitHub Actions. They come from the code and the incident history of three production projects. Most of those incidents were false greens: test runs that passed without testing what they claimed. Two examples: a suite that ran against an old environment because its URL had a default value, and test scripts that called `test.skip()` when a credential was missing, which marks those tests as skipped and does not fail the run. Two other skills in this plugin cover neighbouring topics. `expo-react-native` covers tests of native mobile apps on a device or simulator; this skill covers an Expo web export only when it runs in a browser. `bedrock-agentcore` measures whether an AI agent's answers are good; this skill only checks that the app shows an answer with the expected shape.

**Decision tree** (in `SKILL.md`) routes by task:

| Task | Reference file |
|------|----------------|
| Starting a suite: which tests run where, which environments, how CI runs them, how many retries | `00-lanes-and-decisions.md` |
| Playwright config for each kind of suite: the URL the tests run against, the local web server, the Playwright projects that call paid services only when an environment variable turns them on | `01-config-lanes-and-target.md` |
| Playwright settings: parallel workers, timeouts, reports, browser and device, type-checking the test folder, pinning the Playwright version | `02-config-runtime.md` |
| Logging test users into Cognito without the login screen, and managing those users | `03-auth-and-test-users.md` |
| Creating and cleaning test data on a deployed stack | `04-test-data.md` |
| Several users in one test, waiting for the backend, dates and time | `05-multi-user-waits-and-time.md` |
| GitHub Actions: running the tests right after a deploy, AWS roles, triggers, concurrency, artifacts | `06-ci-workflows.md` |
| Blocking a production deploy until the exact commit passed its end-to-end tests in staging | `07-release-gate.md` |
| Payments, WhatsApp/SMS, other third-party services, and keeping paid calls out of the normal runs | `08-third-parties-payments-and-messaging.md` |
| LLM and AI agent answers | `09-llm-and-agent-flows.md` |
| Unit tests that check the test setup itself | `10-guard-tests.md` |
| Spec files that skip themselves, and screenshots per step (the skill calls them step photos) | `11-skipped-scripts-and-photos.md` |
| Proving a fix: a flaky test, a screen that changed, an assertion that could never fail | `12-proving-a-fix.md` |
| Diagnosing a red, flaky, or suspiciously green run | `13-gotchas.md` |

**Key topics covered:**

- The skill separates three kinds of test suite, which it calls lanes: the local lane, the smoke lane (the tests that run against the stack deployed to AWS), and one probe lane per paid or unpredictable service. The local lane runs against the built app served on localhost, with fake backend services that store what the app writes, so a test that creates an order and then lists orders sees it; a fake that always returns the same canned answer would pass even when the write is broken. The smoke lane runs against the stack after it is deployed to AWS. A probe lane calls a service that costs money or answers differently each time (an LLM, a real payment); they run only when a workflow sets an environment variable that turns them on (for example `E2E_AI=1`), never on a plain test run.
- Where the smoke lane runs in CI, with three options that all ran in production. First, on every push to a developer's branch, the workflow that deploys that developer's stack runs the tests against it right after the deploy, so a red run means the commit just deployed is broken. Second, a workflow after each merge tests a shared test stack without blocking anything, which keeps merges fast but lets a regression sit on the main branch until someone looks. Third, in a project with a staging environment (the last one before production), the tests run inside the staging deploy, where a failing suite marks that deploy as failed (the deploy is not rolled back, so staging keeps the new code), and the production deploy refuses any commit that did not pass in staging.
- The URL the tests run against comes from the deploy outputs, and the run stops if it is missing, because a default URL once let a suite pass against the wrong environment.
- Playwright settings, each with the incident that motivated it. For example, the browser runs in the UTC time zone because a suite seeded dates in UTC and failed on a laptop every evening; the tests turn off the PWA's service worker with a Playwright setting, because it caches files and kept serving the previous deploy's version; and the test folder is type-checked because Playwright runs TypeScript without checking types, so a wrong argument only showed up as a 401 in the deployed run.
- Logging test users into Cognito without going through the login screen. The app signs users in with Google through Cognito, and Google blocks automated logins. So the tests sign in through a separate Cognito app client, created only for tests, that accepts a username and password, and that client exists only outside production. A unit test of the CDK code fails if the production stack ever gets that client, because in production users must sign in only with Google.
- Test data that each run creates and removes by itself, with ids unique per run so two runs never collide, a separate browser context (separate cookies and storage) for each simulated person, and repeated checks instead of fixed sleeps while the backend catches up.
- GitHub Actions setup: tests run with an AWS role that can read test data but cannot deploy, so a bug in a test cannot change the infrastructure, two runs never test the same stack at once, screenshots are kept when a run fails, and a failing scheduled check opens one GitHub issue that closes itself on the next passing run.
- A release gate. After the staging tests run, the staging pipeline writes a small file to a private S3 bucket saying whether that commit passed or failed. The production pipeline reads that file and refuses to deploy a commit without a pass. Only the staging pipeline's AWS role can write that file, and the production pipeline's role can only read it, so a production deploy cannot create a passing file for a commit that never passed.
- LLM answers checked by structure instead of exact wording: the answer arrives, has the expected fields, and the app's error message is absent. Real payments and real messages never run on every merge. Events that almost never happen on their own are triggered on purpose. For example, to test what happens when a request to the AI assistant runs past the backend's time limit, the project adds a switch to its backend that exists only in the dev environment: a fixed phrase that makes the backend wait until the limit. The test sends that phrase, then checks that the app warns the user that the answer is slow, that the backend logs the timeout, and that the CloudWatch alarm for timed-out requests goes off.
- Unit tests that check the test setup itself: that the workflows keep their safety settings, that the Playwright config keeps its settings (for example the number of parallel workers, and zero retries outside CI), and that the instructions written for AI coding agents (for example `docs/agents/e2e.md` or `CLAUDE.md`) do not contain a rule that CI no longer follows; the unit test reads those files and fails on the outdated wording. A spec file that skips itself does not fail the run (the `test.skip()` case above). To catch it, each spec file saves its screenshots in its own folder, which proves the file ran, and a CI step fails the run when a folder that should exist is missing.
- A catalog of known problems, each with symptom, cause, and fix.

Each mechanical rule in the skill comes with the check that enforces it (a unit test, an assertion in the test setup, or a CI step) as example code for you to copy into your project. Complete files to copy, such as the workflow that deploys a developer's stack and runs the tests, the production deploy workflow, and the script that refuses a production deploy without a passing staging run, are in `assets/`, and each reference says when to open them. To check that Claude finds this skill for the right questions, run the harness in `plugins/dev-patterns/skills/e2e-testing/scripts/`, which asks Claude the questions in `tests/scenarios.txt` with and without the skill installed (see "Testing the skills" below).

## Installation

This plugin is part of the `claude-skills` marketplace. Install via Claude Code plugin marketplace or clone the repo and point Claude Code at the plugin directory.

## Testing the skills

Each skill ships with its own RED/GREEN test harness. Pick the variant for your shell and point it at the skill you want to validate:

**`aws-cdk-patterns` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\scripts\test-skill.ps1
```

**`aws-cdk-patterns` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/scripts/test-skill.sh
```

**`dynamodb-design` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\skills\dynamodb-design\scripts\test-skill.ps1
```

**`dynamodb-design` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/skills/dynamodb-design/scripts/test-skill.sh
```

**`expo-react-native` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\skills\expo-react-native\scripts\test-skill.ps1
```

**`expo-react-native` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/skills/expo-react-native/scripts/test-skill.sh
```

**`bedrock-agentcore` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\skills\bedrock-agentcore\scripts\test-skill.ps1
```

**`bedrock-agentcore` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/skills/bedrock-agentcore/scripts/test-skill.sh
```

**`e2e-testing` — Windows (PowerShell 7+):**

```powershell
.\plugins\dev-patterns\skills\e2e-testing\scripts\test-skill.ps1
```

**`e2e-testing` — Mac / Linux / Git Bash:**

```bash
./plugins/dev-patterns/skills/e2e-testing/scripts/test-skill.sh
```

All variants run the same two phases for every scenario in the matching `tests/scenarios.txt`:

- **RED** — `claude -p --disable-slash-commands <prompt>` (baseline without any skill loaded)
- **GREEN** — `claude -p --plugin-dir <plugin> --add-dir <plugin> --setting-sources project <prompt>` (the skill loaded in isolation, reference files readable)

Per-scenario outputs and unified diffs are written to a timestamped directory (`/tmp/<skill>-skill-test-<ts>/` on Unix, `$env:TEMP\<skill>-skill-test-<ts>\` on Windows). A human reviews the diffs against the success criteria in the design spec.

**IMPORTANT:** Do not run these scripts from inside an active Claude Code session. `claude -p` spawned recursively from another Claude Code session deadlocks on interactive prompts. Use a plain terminal.
