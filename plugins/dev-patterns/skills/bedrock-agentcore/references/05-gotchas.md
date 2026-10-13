# Gotchas Catalog

**Builds:** Nothing. This is a lookup table: find the symptom, read the cause, apply the fix, and follow the link for the full pattern.

**When to use:** An AgentCore deploy fails, an invocation returns an unexpected status, a turn is slow or silent, traces are empty, or evals flip without a code change. Start from the Symptom column.

**Prerequisites:** None. Rows repeat the key facts of the other references on purpose, so a symptom can be resolved from this file alone; the linked section stays the single place where the pattern is explained.

> Verified on 2026-10-12. Most rows come from deploy failures and fixes in production projects; rows that AWS does not document are marked *(observed)* in the linked reference.

## Contents

1. Deploy and packaging
2. Startup
3. Sessions and invocation
4. Auth and identity
5. Long turns, progress and state
6. Observability
7. Evals and CI
8. Bedrock models and guardrails

---

## Section 1: Deploy and packaging

| Symptom | Cause | Fix | See |
|---|---|---|---|
| The deploy rejects the runtime name, while synth passes | The name contains a hyphen; only letters, digits and underscores are accepted | Build it with `replace(/[^A-Za-z0-9]/g, '_')` and pin the shape with a template test | [01, section 4](./01-runtime-and-deploy.md) |
| First deploy fails with `Access denied while validating ECR URI` (or the same validation for the S3 artifact) | The runtime depends only on the role ARN, while the role's policy is created in parallel | `runtime.node.addDependency(role)` | [01, section 5](./01-runtime-and-deploy.md) |
| A new deploy keeps serving the old code | The runtime keeps the artifact it read when it was created; the S3 key did not change | Upload each build under a new key (the commit sha), or use an L2 code asset, whose hash changes the key | [01, section 6](./01-runtime-and-deploy.md) |
| The first deploy has no bucket to upload the zip to | The bucket sits in the agent stack behind a condition on the artifact key | Move the bucket to a stack that deploys first and export it unconditionally | [01, section 6](./01-runtime-and-deploy.md) |
| `UPDATE_FAILED … incompatible Python cache files` | Local `__pycache__` folders (left by pytest) ended up in the artifact | Filter `__pycache__` and `*.pyc` when copying sources into the zip | [01, section 3](./01-runtime-and-deploy.md) |
| `CreateAgentRuntime` fails and leaves the environment half-deployed | The zip is over a quota: 250 MB compressed or 750 MB uncompressed; the uncompressed one is usually hit first | Measure both in the build script before uploading | [01, section 3](./01-runtime-and-deploy.md) |
| `import pydantic_core` (or another binary wheel) crashes after deploy | Wheels were resolved for the build machine's platform | `--platform manylinux2014_aarch64 --python-version 3.13 --only-binary=:all:` | [01, section 3](./01-runtime-and-deploy.md) |
| `ImportError: botocore` in the runtime | The direct-code runtime does not ship `botocore` | Ship `boto3` and `botocore` inside the zip and check they are there | [01, section 3](./01-runtime-and-deploy.md) |
| A dependency is missing from the deployed zip, or its version differs from the one tested | `requirements.txt` is kept by hand with `>=` beside `uv.lock` | Generate it from the lock file and diff it in CI | [01, section 3](./01-runtime-and-deploy.md) |
| Python files misbehave only in the runtime after a checkout on Windows | CRLF line endings reached the Linux runtime | `.gitattributes` with `*.py text eol=lf` and `*.txt text eol=lf` | [01, section 3](./01-runtime-and-deploy.md) |
| The runtime runs V1 although V2 was intended, and `get-agent-runtime` shows no platform version | `PlatformVersion` is not typed in CDK, and the API does not return it | `addPropertyOverride('PlatformVersion', 'V2')`; verify it in the synthesized template or in CloudFormation | [01, section 4](./01-runtime-and-deploy.md) |
| A V2 deploy fails after adding an environment variable, while synth is green | V2 caps a direct-code runtime's environment variables at 1.5 KB in total | A template test that measures the variables with intrinsics resolved to their worst case | [01, section 4](./01-runtime-and-deploy.md) |
| `WARNING: Invalid HTTP request received.` on every invocation | V2 log noise *(observed)* | Ignore it | [01, section 4](./01-runtime-and-deploy.md) |
| `Export … cannot be removed as it is in use` when retiring an old resource | The export was removed in the same deploy that stops consuming it | Two deploys: stop consuming first, remove the export second | [`aws-cdk-patterns` database gotchas](../../aws-cdk-patterns/references/04-database.md) |
| jest or synth is slow or hangs in CI | Template tests bundle the Python asset | Context `'aws:cdk:bundling-stacks': []` in template tests | [01, section 7](./01-runtime-and-deploy.md) |

## Section 2: Startup

| Symptom | Cause | Fix | See |
|---|---|---|---|
| `Runtime initialization time exceeded` on a V1 runtime | Heavy imports and agent construction ran at module load and took more than 30 s | On V1, build the agent on the first invocation | [01, section 2](./01-runtime-and-deploy.md) |
| V2 sessions start no faster than V1 | Everything was deferred to the first invocation, so the snapshot had nothing to keep | On V2, move heavy imports to module scope; keep secrets and network clients in the first invocation | [01, section 2](./01-runtime-and-deploy.md) |
| Secrets or credentials are stale or shared across sessions on V2 | They were created at import and frozen into the snapshot | Create them on the first invocation; keep a test that imports `main` with AWS blocked | [01, section 2](./01-runtime-and-deploy.md) |
| `NoRegionError` when reading a secret | AgentCore does not always set `AWS_REGION` | Fall back to `AWS_DEFAULT_REGION`, then to the region inside the secret's ARN | [01, section 2](./01-runtime-and-deploy.md) |
| Code that signs requests (AppSync, a custom API) finds no credentials | It reads `AWS_ACCESS_KEY_ID`, but credentials arrive through instance metadata | Use the default credential chain (`botocore.session.Session().get_credentials()`) | [01, section 2](./01-runtime-and-deploy.md) |
| A misconfigured runtime reports healthy and fails on the first real turn | Configuration is read lazily | Read and validate configuration at import; raise on any missing variable | [01, section 2](./01-runtime-and-deploy.md) |

## Section 3: Sessions and invocation

| Symptom | Cause | Fix | See |
|---|---|---|---|
| Every message takes 7–12 s while the container log shows 0.5–1.4 s of work | A new `runtimeSessionId` per call starts a new microVM each time | Derive the session id from the conversation and reuse it | [02, section 2](./02-invocation-and-sessions.md) |
| App and backend touch the same conversation and both stay slow | Each caller builds a slightly different session id, so they land in two microVMs | One derivation function per language, with the same literal pinned in each test suite | [02, section 2](./02-invocation-and-sessions.md) |
| An unexplained 503 instead of a turn | `runtimeSessionId` is shorter than 33 characters *(observed)* | Build it from the Cognito `sub` (a UUID) plus a conversation name, and validate `^[A-Za-z0-9-]{33,256}$` before sending | [02, section 2](./02-invocation-and-sessions.md) |
| `Runtime initialization time exceeded` in the middle of a long turn | The idle timeout is shorter than the turn, and work that outlives the request counts as idle; the message is misleading for this case *(observed)* | Idle timeout at least the longest turn plus margin, or register the work with `add_async_task` | [02, section 3](./02-invocation-and-sessions.md) |
| The AgentCore bill is dominated by idle sessions | The default idle timeout (900 s) on sessions that evals and smoke tests never reuse | Set the idle timeout per stage (for example 180 s in dev) | [02, section 3](./02-invocation-and-sessions.md) |
| 409 `RetryableConflictException` or `Session operation in progress` | The session is starting or stopping | Retry after 250, 500, 1000 and 2000 ms | [02, section 4](./02-invocation-and-sessions.md) |
| 424 `Received error (502) from runtime` about 4.5 s after a session started | The second request to a freshly started session does not reach the container *(observed)* | The same retry, matched on the response body | [02, section 4](./02-invocation-and-sessions.md) |
| The retry never fires in the browser | `x-amzn-errortype` is not readable cross-origin | Read the body through `response.clone()` | [02, section 4](./02-invocation-and-sessions.md) |
| The backend gets an empty result or a JSON parse error from `InvokeAgentRuntimeCommand` | `response.response` is raw bytes with SSE `data: ` lines split across chunks | Accumulate chunks, split lines, strip the `data: ` prefix | [02, section 8](./02-invocation-and-sessions.md) |
| A warm Lambda that starts several runs begins failing every call | The unread response body keeps the keep-alive socket taken | `response.response?.destroy?.()` when you do not wait for the result | [02, section 8](./02-invocation-and-sessions.md) |
| A Lambda proxy returns 504 near 29–30 s | API Gateway caps the request (29 s REST, 30 s HTTP API) whatever the Lambda timeout | Fire-and-forget turn with live progress | [03, section 1](./03-long-turns-and-state.md) |
| The user loses the answer after a dropped connection | A running stream cannot be reattached, while the process keeps running | Deliver the result through a store or channel the client can re-read | [02, section 10](./02-invocation-and-sessions.md) |

## Section 4: Auth and identity

| Symptom | Cause | Fix | See |
|---|---|---|---|
| 401 from the process with a valid token | The JWT gate consumes `Authorization` and does not forward it | `requestHeaderConfiguration.requestHeaderAllowlist: ['Authorization']` | [02, section 6](./02-invocation-and-sessions.md) |
| Every valid Cognito access token is rejected at the gate | The authorizer checks `allowedAudience`, but access tokens carry `client_id`, not `aud` | Use `allowedClients` | [02, section 6](./02-invocation-and-sessions.md) |
| A backend cannot call a runtime that the app calls with a JWT | A runtime accepts SigV4 or JWT, never both | Give the backend a Cognito machine client (client credentials) listed in `allowedClients` | [02, section 5](./02-invocation-and-sessions.md) |
| A user can act on someone else's thread | Identity taken from the payload, the session id or `X-Amzn-Bedrock-AgentCore-Runtime-User-Id` | Take `sub` only from the forwarded token and pass it to tools through `config` | [02, section 9](./02-invocation-and-sessions.md) |
| A Gateway tool would call your API with the gateway's credential instead of the user's | OpenAPI targets cannot forward the inbound token | Keep tools in the agent process, forwarding the user's token; defer Gateway | [00, section 1](./00-decisions.md) |

## Section 5: Long turns, progress and state

| Symptom | Cause | Fix | See |
|---|---|---|---|
| The acknowledgement of an async entrypoint takes 26–28 s, or the caller gets a 504 | The ack leaves only when the background task reaches its first `await` (measured on SDK 1.6.3); blocking imports, secrets or agent construction hold the event loop | Run every blocking step with `asyncio.to_thread` | [03, section 3](./03-long-turns-and-state.md) |
| A background turn stops partway with no error | `asyncio.create_task` keeps only a weak reference, so the task is garbage-collected | Hold tasks in a module-level set and discard them in `add_done_callback` | [03, section 2](./03-long-turns-and-state.md) |
| The session stays `HealthyBusy` and keeps billing after a failed turn | `complete_async_task` is not called on the error path | Call `app.complete_async_task(task_id)` in `finally` | [03, section 2](./03-long-turns-and-state.md) |
| A cancelled or replaced run overwrites the user's edit or a newer result | The agent writes without a condition, or without the run id | Condition every write on status, `runId` and `attribute_not_exists(deletedAt)`; treat `ConditionalCheckFailedException` as discard | [03, section 4](./03-long-turns-and-state.md) |
| The agent's conditional writes all fail right after invoking | The runtime was invoked before the record with its status and run id existed | Create the record first, then invoke | [03, section 4](./03-long-turns-and-state.md) |
| Results get rejected downstream with 400 | The model returned `null` for "does not apply" and the null was stored and re-sent | Drop `None` fields before writing | [03, section 4](./03-long-turns-and-state.md) |
| One external API outage burns the whole turn deadline | The model rephrases the failing lookup again and again | Circuit breaker (open 60 s after 2 service failures) and a tool result that tells the model the service is down | [03, section 5](./03-long-turns-and-state.md) |
| A turn hangs with no answer and no alarm | No hard cap inside the runtime, or slow and broken share one signal | Hard cap with a fallback reply and close event; count `turn_timed_out` apart from `turn_failed` | [03, section 6](./03-long-turns-and-state.md) |
| Model and tool spans have no parent turn span | The graph runs in a worker thread without the tracing context | Submit `contextvars.copy_context().run` to the pool | [03, section 6](./03-long-turns-and-state.md) |
| Deploy fails with `Error processing APPSYNC_JS code` | The channel namespace handler exports something besides its handlers | Export only `onPublish` and `onSubscribe` | [03, section 7](./03-long-turns-and-state.md) |
| The AppSync subscription never opens (`UnsupportedOperation`) | The subscription id contains the channel path | Use `crypto.randomUUID()` as the id | [03, section 7](./03-long-turns-and-state.md) |
| "Typing…" spins forever although the turn finished | The WebSocket died without a clean close, so the close event reached nobody | Reopen at most 3 times, re-read the thread, and re-read once more 15 s after sending | [03, section 7](./03-long-turns-and-state.md) |
| Reading the checkpoint table directly returns an empty thread | LangGraph stores deltas; the latest checkpoint has empty `channel_values` | Read through `graph.get_state`, never the saver's raw items | [03, section 9](./03-long-turns-and-state.md) |
| A deleted thread leaves a last checkpoint behind | The per-thread lock lives in the runtime process; a turn in flight writes after the deletion Lambda runs | Delete twice, the second pass delayed past the hard cap | [03, section 9](./03-long-turns-and-state.md) |
| A pending confirmation disappears after an outside message is added to the thread | `update_state` dropped the pending `Interrupt` *(observed)* | Keep pending state in a graph-state field; the node that waits has no side effects | [03, section 9](./03-long-turns-and-state.md) |
| The AgentCore Memory checkpointer throttles on short turns | Quota of 10 `CreateEvent` per second per actor and session, against 13–19 checkpoint events written within a second or two | `DynamoDBSaver` with TTL; `AgentCoreMemoryStore` only for long-term memory | [00, section 6](./00-decisions.md) |
| The agent uses AgentCore Memory but threads are not kept, and the deploy succeeded | The `Memory` resource was never created, or its id never reached the runtime | Create it in CDK, pass its id, and refuse to start without it | [00, section 6](./00-decisions.md) |

## Section 6: Observability

| Symptom | Cause | Fix | See |
|---|---|---|---|
| Turns answer fine but the trace is empty | The runtime role lacks the four X-Ray actions, so the exporter gets a silent 403 | `xray:PutTraceSegments`, `PutTelemetryRecords`, `GetSamplingRules`, `GetSamplingTargets` on `*`, plus `cloudwatch:PutMetricData` limited to namespace `bedrock-agentcore` | [04, section 2](./04-observability-and-evals.md) |
| `CREATE_FAILED AWS::XRay::TransactionSearchConfig … XRay does not have permission to call PutLogEvents on the aws/spans Log Group` | CloudFormation does not create the CloudWatch Logs resource policy X-Ray needs | Create the resource policy for `xray.amazonaws.com` and make Transaction Search depend on it | [04, section 2](./04-observability-and-evals.md) |
| Spans land in the shared `aws/spans` group and your retention does not apply | The unified destination is off, ADOT is older than 0.18, or the role lacks `logs:PutResourcePolicy` | `UNIFIED_TRACES_DESTINATION_ENABLED=true`, ADOT 0.18 or later, `logs:PutResourcePolicy` on the runtime's log groups | [04, sections 1 and 2](./04-observability-and-evals.md) |
| Every model call shows two spans and token counts double | The botocore Bedrock instrumentation also traces the call | Load no auto-instrumentors, or only the ones in use without `botocore` | [04, section 1](./04-observability-and-evals.md) |
| Each new session takes about 1.9 s longer to start | ADOT loads its full instrumentor set *(observed)* | Disable unused instrumentors or skip auto-instrumentation | [04, section 1](./04-observability-and-evals.md) |
| Message content in spans flips on or off without anyone changing it | ADOT defaults the content-capture variable to `"true"`, which util-genai rejects and replaces with `NO_CONTENT` | Declare `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` in every stage and refuse to start without it | [04, section 3](./04-observability-and-evals.md) |
| Spans lose `gen_ai.agent.version` after a rebuild | `opentelemetry-util-genai` 1.2b0 arrived unpinned | Pin `opentelemetry-util-genai==1.1b0` | [04, section 1](./04-observability-and-evals.md) |
| The process starts healthy but records no traces | The tracing initializer swallows exceptions and leaves the no-op provider in place | Raise from `start_tracing()` when the trace is a required record | [04, section 1](./04-observability-and-evals.md) |
| Alarm counters never reach CloudWatch | The meter was requested before the exporter started, or the EMF variables are missing | Request the meter after `start_tracing()`; set the EMF exporter variables | [04, section 1](./04-observability-and-evals.md) |
| An API key shows up in spans and CloudWatch logs | The key traveled in the query string, which HTTP spans and `httpx` INFO logs record | Send it in a header and set the `httpx` logger to WARNING | [04, section 3](./04-observability-and-evals.md) |
| Runtime logs are kept forever, even after the runtime is deleted | AgentCore creates its log group with no retention and leaves it behind on delete | Set retention on the runtime's log group explicitly | [04, section 4](./04-observability-and-evals.md) |
| The API 5xx alarm fires on requests for objects that do not exist | S3 `NoSuchKey` reaches the client as a 500 | Map it to a 4xx | [04, section 5](./04-observability-and-evals.md) |

## Section 7: Evals and CI

| Symptom | Cause | Fix | See |
|---|---|---|---|
| Evals are red or green by chance | The LLM judge ran once per scenario | Run 3 times and pass model-judged checks by majority; literal checks stay binary | [04, section 6](./04-observability-and-evals.md) |
| The eval judge fails with `AccessDenied` or rejects a parameter | The judge's model has no access in the account, or rejects `temperature` | Enable access, use a judge model different from the agent's, set parameters per model family | [04, section 6](./04-observability-and-evals.md) |
| Evals pass in CI but production behaves differently | CI started a copy of the agent on the runner | Point CI evals at the deployed runtime, entering with a real token | [04, section 6](./04-observability-and-evals.md) |
| A latency regression ships green | The gate retried, so a 504 passed as "flaky" | Latency gates run with zero retries | [04, section 6](./04-observability-and-evals.md) |
| The first eval turn after a deploy is slow | It measures the new runtime's first session start | Run evals last, after the smoke tests | [04, section 6](./04-observability-and-evals.md) |
| A smoke test passes although the authorizer is not wired | Only authenticated requests were tested | Also send a request without a token and expect a 4xx | [04, section 7](./04-observability-and-evals.md) |

## Section 8: Bedrock models and guardrails

These belong to Bedrock rather than AgentCore, but they surface first when the agent runs in the runtime. Rows without a link have no deeper reference in this skill; the row is the whole fix.

| Symptom | Cause | Fix | See |
|---|---|---|---|
| `Model use case details have not been submitted` while the console shows the model as active | Model access is not fully granted to the account | Complete the model access request, or switch to a provider API with its key in Secrets Manager | [00, section 7](./00-decisions.md) |
| `AccessDenied` from the model once a call is routed outside the home region | IAM grants only the inference profile, or only one region | Grant the profile ARN and the foundation-model ARNs in every region the profile routes to | [01, section 5](./01-runtime-and-deploy.md) |
| `ParamValidationError` on `streamProcessingMode` | That field exists only in `ConverseStream`, not `Converse` | Send it only with `ConverseStream` | — |
| A guardrail is rejected at deploy while synth is green | Guardrail name longer than 50 characters, or a topic definition longer than 200 characters on the Classic tier | Shorten the name (derive it from the stage suffix) and pin both limits with tests | — |
| A guardrail blocks correct answers | Classic tier with an ambiguous topic definition (it blocked most correct answers in one eval set) | Standard tier, which needs `bedrock:ApplyGuardrail` on the cross-region profile in each destination region | — |
