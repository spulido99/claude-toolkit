# Observability and Evals

**Builds:** Traces, metrics, alarms, evals, and smoke tests for a Python agent running on AgentCore Runtime as direct code (zip in S3, `entryPoint: ['main.py']`). The example agent is `support_agent`.

**When to use:** Turning on traces for a runtime, debugging "turns work but the trace is empty", deciding what a span may carry, wiring an alarm for failed or timed-out turns, or building the eval and smoke steps that run after a deploy.

**Prerequisites:** A deployed runtime and its execution role, covered in [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md). Turn deadlines (the timeout that produces a "timed out" turn) live in [`03-long-turns-and-state.md`](./03-long-turns-and-state.md); this file owns the signals they emit.

> Verified on 2026-10-12 against `aws-opentelemetry-distro` 0.19.0, `opentelemetry-util-genai` 1.1b0, `bedrock-agentcore` Python SDK 1.22.0, and `aws-cdk-lib` 2.261. Facts marked *(observed)* were measured in production projects, not taken from AWS docs; re-check them when you upgrade ADOT or the SDK.

## Contents

1. Tracing on a direct-code runtime: starting ADOT from `main.py`
2. IAM and account setup: what the role and the account need before a span leaves the process
3. Privacy: what a span and a metric may carry
4. Logs and retention
5. Alarms: no turn fails silently
6. Evals: what they target, how they judge, where they run
7. Smoke tests after a deploy
8. AgentCore Evaluations
9. Verification
10. Further reading

---

## Section 1: Tracing on a direct-code runtime

### 1.1 There is no `opentelemetry-instrument` wrapper

AWS documents running the agent as `opentelemetry-instrument python main.py`. With direct-code deployment the runtime's `entryPoint` is `main.py`, so there is nowhere to put that prefix. `main.py` starts the exporter itself, in this order:

```python
# main.py
import os
from opentelemetry.metrics import get_meter
from support_agent.configuration import read_configuration
from support_agent.tracing import start_tracing
from support_agent.metrics import TurnMetrics, METER_NAME

# 1. Read configuration first. ADOT calls os.environ.setdefault() on the
#    content-capture variable while starting; reading config afterwards would
#    validate ADOT's default instead of what the deployment declared.
configuration = read_configuration(os.environ)

# 2. Start the trace exporter.
start_tracing()

# 3. Ask for the meter only now. Before start_tracing() you get the no-op meter
#    and the alarm counters never leave the process.
metrics = TurnMetrics(get_meter(METER_NAME))
```

`read_configuration` is the configuration reader from section 2.1 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md). All three steps run at module scope. Starting the exporter at import worked on platform V2 in production *(observed)*: creating the exporter opens no connection and reads no secret, so it respects the rule in 01 that nothing at import touches the network or reads secrets.

### 1.2 Load no auto-instrumentors, or only the ones you use

ADOT ships about 50 instrumentors and imports every one that is not disabled. Two problems follow:

- **Cold start.** Loading the full set cost about 1.9 s per new session (52 instrumentors) *(observed)*.
- **Double spans with Bedrock.** `botocore` is not in the list ADOT disables, and its Bedrock extension traces `Converse` on its own. With a LangChain or util-genai span already covering the model call, every call leaves two `chat` spans and token counts double in the GenAI dashboard *(observed)*.

Pick one of two shapes.

**Option A: no instrumentors.** The agent writes its own spans through `opentelemetry-util-genai` (`TelemetryHandler`), which knows the GenAI semantic-convention attributes. The bootstrap installs the provider and exporter and nothing else:

```python
# support_agent/tracing.py
from opentelemetry.trace import ProxyTracerProvider, get_tracer_provider

def start_tracing() -> bool:
    """Install ADOT's provider and exporter, without auto-instrumentors."""
    if not isinstance(get_tracer_provider(), ProxyTracerProvider):
        return False  # the host already started one; starting twice duplicates every span
    # Private module of opentelemetry-instrumentation; pinned through the ADOT version.
    from opentelemetry.instrumentation.auto_instrumentation._load import (
        _load_configurators,
        _load_distro,
    )
    _load_distro().configure()
    _load_configurators()
    return True
```

**Option B: only the instrumentors in use.** Disable the rest by name, then call ADOT's `initialize()`. Keep `botocore` out of the set when the model is called through Bedrock.

```python
from importlib.metadata import entry_points

IN_USE = frozenset({"httpx", "langchain", "logging", "threading", "starlette"})

def _unused() -> str:
    names = {ep.name for ep in entry_points(group="opentelemetry_instrumentor")}
    return ",".join(sorted(names - IN_USE))

os.environ.setdefault("OTEL_PYTHON_DISABLED_INSTRUMENTATIONS", _unused())
from opentelemetry.instrumentation.auto_instrumentation import initialize
initialize()
```

Keep `threading` in the set when tools fan out over a `ThreadPoolExecutor`; without it child spans lose their parent.

### 1.3 Fail loudly or degrade

`initialize()` swallows exceptions and leaves the no-op provider in place: the process starts healthy and answers turns without recording any. Decide per agent:

- **The trace is a required record** (audit, regulated data, the only way to explain an old turn): let `start_tracing()` raise, so the process never reports healthy without it. This is the default.
- **The trace is a debugging aid**: catch the error, log one line, and keep serving.

Either way, honour `DISABLE_ADOT_OBSERVABILITY=true` in your bootstrap so one environment variable on the runtime turns tracing off without a code change.

### 1.4 Environment variables to declare explicitly

AgentCore and ADOT set defaults for some of these. Declare all of them in the runtime's environment anyway: a default nobody chose can change between versions, and with both the AWS distro and the base distro installed, entry-point order decides which one loads.

| Variable | Value | Why |
|---|---|---|
| `AGENT_OBSERVABILITY_ENABLED` | `true` | Turns on ADOT's agent mode. |
| `OTEL_PYTHON_DISTRO` | `aws_distro` | Pins the AWS distro over the base one. |
| `OTEL_PYTHON_CONFIGURATOR` | `aws_configurator` | Same reason. |
| `UNIFIED_TRACES_DESTINATION_ENABLED` | `true` | Sends spans to the runtime's own log group instead of the shared `aws/spans`, so your retention applies to them. Needs ADOT 0.18.0 or later and `logs:PutResourcePolicy` (section 2). |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `NO_CONTENT` in staging and production, `SPAN_ONLY` in a dev stage with synthetic data | See section 3.1. The process refuses to start without it. |
| `AGENT_VERSION` | The S3 key of the code artifact (it contains the commit SHA) | Becomes `gen_ai.agent.version` on the span, so a trace months later says which code served the turn. |
| `OTEL_METRICS_EXPORTER` | `awsemf` | Turns OpenTelemetry counters into CloudWatch metrics through Embedded Metric Format. |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS` | `x-aws-log-group=/aws/bedrock-agentcore/turn-metrics-<stage>,x-aws-log-stream=turn,x-aws-metric-namespace=bedrock-agentcore` | Where EMF lands. Without the namespace the metric appears under `default`. |
| `TRACELOOP_TRACE_CONTENT` | `false` | Only with the LangChain (Traceloop) instrumentor from option B: it has its own content switch. Set it in the runtime and default it in code. |

These variables count against the runtime's environment-variable size limit on platform V2; see [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md).

### 1.5 Pins

Pin both packages in `requirements.txt`; the zip must contain the tree the test suite ran against.

```text
aws-opentelemetry-distro==0.19.0   # 0.18.0 is the minimum that honours the unified traces destination
opentelemetry-util-genai==1.1b0    # arrives unpinned through ADOT; 1.2b0 stopped writing gen_ai.agent.version on local-agent spans
```

---

## Section 2: IAM and account setup

### 2.1 Runtime role

Without these statements the exporter signs with the runtime role, receives a 403, and turns keep answering normally while the trace stays empty. Nothing in the turn's response tells you.

```ts
// X-Ray ingestion and sampling have no resource ARNs.
role.addToPolicy(new iam.PolicyStatement({
  actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
  resources: ['*'],
}));

// PutMetricData accepts no resource, so the condition is what keeps this role
// from writing over another service's metrics.
role.addToPolicy(new iam.PolicyStatement({
  actions: ['cloudwatch:PutMetricData'],
  resources: ['*'],
  conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
}));

// Lets AgentCore attach the resource policy X-Ray needs to write spans into the
// runtime's own log group (the unified traces destination).
role.addToPolicy(new iam.PolicyStatement({
  actions: ['logs:PutResourcePolicy', 'logs:DescribeLogStreams'],
  resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`],
}));
```

The rest of the role (artifact, model, data) lives in [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md).

### 2.2 Transaction Search (once per account and region)

Transaction Search is the account-level switch that indexes spans in CloudWatch. CloudFormation does not create the CloudWatch Logs resource policy X-Ray needs, and the config resource fails with `XRay does not have permission to call PutLogEvents on the aws/spans Log Group`. Create the policy and make the config depend on it:

```ts
const spansPolicy = new logs.CfnResourcePolicy(this, 'TransactionSearchLogsPolicy', {
  policyName: 'TransactionSearchXRayAccess',
  policyDocument: cdk.Stack.of(this).toJsonString({
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { Service: 'xray.amazonaws.com' },
      Action: 'logs:PutLogEvents',
      Resource: [
        `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:aws/spans:*`,
        `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/application-signals/data:*`,
      ],
      Condition: {
        ArnLike: { 'aws:SourceArn': `arn:${this.partition}:xray:${this.region}:${this.account}:*` },
        StringEquals: { 'aws:SourceAccount': this.account },
      },
    }],
  }),
});

const transactionSearch = new xray.CfnTransactionSearchConfig(this, 'TransactionSearch', { indexingPercentage: 100 });
transactionSearch.addDependency(spansPolicy);
```

Put this in an account-level stack, not in each stage: there is one per account and region.

### 2.3 Check

```ts
const template = Template.fromStack(stack);
template.hasResourceProperties('AWS::IAM::Policy', {
  PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
    Action: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
    Resource: '*',
  })]) },
});
template.hasResourceProperties('AWS::IAM::Policy', {
  PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
    Action: 'cloudwatch:PutMetricData',
    Condition: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
  })]) },
});
```

---

## Section 3: Privacy

### 3.1 Message content in spans

`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` has two incompatible readings today. `opentelemetry-util-genai` reads it as an enum (`NO_CONTENT`, `SPAN_ONLY`, `EVENT_ONLY`, `SPAN_AND_EVENT`); older instrumentors read it as a boolean. ADOT, when agent observability is on, runs `setdefault(..., "true")`. util-genai rejects `"true"`, logs a warning, and falls back to `NO_CONTENT` *(observed on ADOT 0.19.0)*. Content is off today by accident, one ADOT fix away from being on in every stage.

Make it a decision instead: the stack writes the variable in every stage, and the process refuses to start when it is missing or holds a value util-genai does not accept. Add this check to `read_configuration` (section 2.1 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md)) rather than writing a second configuration reader:

```python
# support_agent/configuration.py, called from read_configuration()
CONTENT_CAPTURE_VARIABLE = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"
CONTENT_CAPTURE_MODES = ("NO_CONTENT", "SPAN_ONLY", "EVENT_ONLY", "SPAN_AND_EVENT")

def _check_content_capture(env):
    value = env.get(CONTENT_CAPTURE_VARIABLE)
    if not value:
        raise ValueError(f"missing {CONTENT_CAPTURE_VARIABLE}: ADOT would choose for you")
    if value not in CONTENT_CAPTURE_MODES:
        raise ValueError(f"{CONTENT_CAPTURE_VARIABLE}={value!r} is not one of {CONTENT_CAPTURE_MODES}")
```

```python
# tests/test_configuration.py
def test_refuses_to_start_without_content_capture(valid_env):
    del valid_env["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"]
    with pytest.raises(ValueError, match="CAPTURE_MESSAGE_CONTENT"):
        read_configuration(valid_env)

def test_rejects_the_adot_boolean_default(valid_env):
    valid_env["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "true"
    with pytest.raises(ValueError):
        read_configuration(valid_env)
```

Use `NO_CONTENT` whenever conversations hold personal, health, or financial data. As a second barrier, have your LangChain callback adapter skip converting message text when capture is off, so a library bug cannot leak what it was never given.

### 3.2 The trace outlives the conversation

Trace retention (often a year) is usually longer than the conversation's (deleted when the user cancels or after a TTL). Keep anything that identifies the user out of span attributes: no thread id tied to a user, no `sub`, no email. The opaque session id (`session.id`) is what the GenAI dashboard groups by and is fine. Counters carry no attributes at all, because metric attributes become CloudWatch dimensions that last as long as the metric.

A span that records a human operator reading someone's conversation is the one place a thread reference belongs: the access itself is the fact to record. It still carries no message text.

Test it with an in-memory exporter: run a turn with a fake model and assert that no span attribute contains the user's message.

```python
def test_trace_carries_no_message_text(service, memory_exporter):
    service.turn(session="s" * 33, prompt="my card number is 4111 1111 1111 1111")
    for span in memory_exporter.get_finished_spans():
        assert not any("4111" in str(v) for v in span.attributes.values())
```

### 3.3 Secrets and URLs

HTTP client spans and the `httpx` INFO log record the full URL. An API key in a query string ended up in exported spans and in CloudWatch logs *(observed)*. Send keys in a header (`X-Api-Key`), set the `httpx` logger to `WARNING` after tracing starts, and exclude hosts whose URLs carry user data with `OTEL_PYTHON_HTTPX_EXCLUDED_URLS`.

```python
def test_api_key_travels_in_a_header(httpx_mock):
    client.search("query")
    request = httpx_mock.get_request()
    assert "api_key" not in str(request.url)
    assert request.headers["X-Api-Key"]
```

---

## Section 4: Logs and retention

**The runtime's log group.** AgentCore creates `/aws/bedrock-agentcore/runtimes/<runtimeId>-<endpointName>` on the first invocation, and spans land there when the unified destination is on. A `new logs.LogGroup(...)` with that name collides with AgentCore's the day the order flips. `logs.LogRetention` is deprecated in recent `aws-cdk-lib`, but it is the construct that sets retention on a log group that already exists, which is the case here because AgentCore created it. Use it until CDK offers a supported way to adopt an existing group:

```ts
new logs.LogRetention(this, 'RuntimeTraceRetention', {
  // L2 alpha: runtime.agentRuntimeId (and runtime.agentRuntimeArn).
  // L1 CfnRuntime: runtime.attrAgentRuntimeId (and runtime.attrAgentRuntimeArn).
  logGroupName: `/aws/bedrock-agentcore/runtimes/${runtime.agentRuntimeId}-DEFAULT`,
  retention: logs.RetentionDays.ONE_YEAR,
  removalPolicy: RemovalPolicy.RETAIN, // traces explain past turns; keep them after the stage is torn down
});
```

Deleting a runtime leaves its log group behind with whatever retention it had; CloudWatch's default is to keep logs forever *(observed)*.

**The metrics log group** (where EMF lands) is yours: create it under `/aws/bedrock-agentcore/` with the stage in the name, so dev and production counters never mix, and give it a short retention (30 days). CloudWatch keeps the metric itself for 15 months independently of this group.

```ts
template.hasResourceProperties('Custom::LogRetention', { RetentionInDays: 365 });
```

---

## Section 5: Alarms

AgentCore emits no signal for a turn that failed or ran out of time. The agent emits it: two counters, because a timed-out turn was working and a failed turn is broken, and they are fixed in different places.

```python
# support_agent/metrics.py
METER_NAME = "support_agent.turn"

class TurnMetrics:
    def __init__(self, meter):
        # No attributes: they would become dimensions holding user data.
        self._timed_out = meter.create_counter("turn_timed_out", unit="1")
        self._failed = meter.create_counter("turn_failed", unit="1")

    def timed_out(self): self._timed_out.add(1)
    def failed(self): self._failed.add(1)
```

The counters leave the process through the EMF exporter (section 1.4), so the code never calls `PutMetricData` itself. The alarm fires on a single case:

```ts
for (const metricName of ['turn_timed_out', 'turn_failed']) {
  new cloudwatch.Alarm(this, `${metricName}Alarm`, {
    alarmName: `${metricName}-${stage}`,
    metric: new cloudwatch.Metric({
      namespace: 'bedrock-agentcore',
      metricName,
      statistic: cloudwatch.Stats.SUM, // count cases; the average of a counter published only on failure is always 1
      period: Duration.minutes(1),
    }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, // no bad turns means no datapoints
  }).addAlarmAction(new cloudwatchActions.SnsAction(noticesTopic));
}
```

**Behind an API.** When every Lambda sits behind one API Gateway, one 5xx alarm per stage (`api.metricServerError({ statistic: 'Sum', period: Duration.minutes(5) })`, threshold 1, missing data not breaching) gives most of the signal of per-function alarms at a fraction of the cost. Skip it in dev. Map expected client errors to 4xx so they never reach it: S3 reports a missing object as `NoSuchKey` from `GetObject` and `NotFound` from `HeadObject`, and the SDK v3 has no common class, so compare on `error.name`.

---

## Section 6: Evals

### 6.1 Two targets

Every target receives the same `POST /invocations` request; only the way the harness reaches it changes.

| Target | What runs | When |
|---|---|---|
| Local | The same `main.py`, started on an ephemeral port, reading configuration with the same function the runtime uses, with fake downstream APIs | Development loop; full suite, by hand |
| Deployed | The runtime the pipeline just deployed, reached by its ARN | CI after every deploy; the subset that needs no seeded data |

In CI, nothing of the agent runs on the runner. A copy started on the runner measures the copy, not the deployment. The runner hosts only the harness and the judge.

### 6.2 Entering the deployed runtime

Enter the way real callers do. For a runtime behind a JWT authorizer, get a token the way the app gets one (for example, the endpoint that creates a provisional user), then call the runtime with it; one new user per scenario keeps scenarios from sharing a thread when the thread derives from the token's `sub`. For a runtime behind IAM, sign with the CI role, which needs `bedrock-agentcore:InvokeAgentRuntime`. Calling the runtime is covered in [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md).

Read the runtime ARN and the auth endpoint from the deploy outputs (`cdk-outputs.json`) and fail the step with a clear message when either is missing. Read the judge model id from the same config file the stack uses, not from a literal in the workflow.

### 6.3 Two kinds of judge

- **Literal checks**, done by code: forbidden strings and numbers, the sequence of tools called, where the turn sent the user. One failing run fails the scenario.
- **Model-judged checks**: what the answer must convey and must not do, written as plain-language rules. One rule per judge call, a binary verdict, "unsure" counts as a failure, reasoning before the verdict. Each scenario runs 3 times and these checks pass by majority (2 of 3). Requiring all runs to pass turned the gate into a lottery *(observed)*.

The judge model is a different model from the agent's. Handle parameters per model family (some reject `temperature`), and enable model access for the judge in the account: a missing model agreement shows up as `AccessDenied` on the judge, not on the agent.

### 6.4 Gates and information

Separate what blocks from what informs:

| Block | Examples | Effect |
|---|---|---|
| Ground truth | Share of cases inside the expected range, category accuracy | Gate |
| Safety | A high-risk case classified as harmless | Gate; one violation blocks |
| Latency | p95 of the agent's turn | Gate |
| Drift against a previous implementation | Agreement with the previous system's answers | Information only; the previous system is not ground truth |

### 6.5 Where evals run in the pipeline

Run evals last, after the smoke tests. While they ran first, one noisy judge verdict left the run red before the smoke tests ever ran *(observed)*. Running last also gives a freshly created runtime a few minutes: the first turn against a brand-new runtime measures startup, not the agent. Cap concurrency against the deployment (for example, 4 turns in flight).

Give latency gates no retries. A retry turned a 504 into "flaky" and let the commit go green *(observed)*.

---

## Section 7: Smoke tests after a deploy

- **Call the runtime directly**, bypassing the API in front of it, so a failure points at the runtime. For a runtime behind IAM:

  ```bash
  aws bedrock-agentcore invoke-agent-runtime \
    --agent-runtime-arn "$RUNTIME_ARN" \
    --qualifier DEFAULT \
    --runtime-session-id "smoke-$(uuidgen)" \
    --payload '{"prompt": "ping"}' \
    --cli-binary-format raw-in-base64-out \
    /tmp/smoke-response.json && cat /tmp/smoke-response.json
  ```

  `smoke-` plus a 36-character UUID clears the 33-character minimum; hyphens are allowed in session ids. Real callers build the id from the user and the conversation as described in [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md). A runtime behind a JWT authorizer accepts only bearer tokens; call its HTTPS endpoint with a token instead (same file).
- **Check that unauthenticated requests are rejected.** Send one request without credentials and assert a 4xx (401 from an API Gateway authorizer, a 4xx from the runtime). It proves the authorizer is wired.
- **Read the ARN from what you shipped.** When the client bundle carries the runtime ARN, the smoke test extracts it from the deployed bundle (`/arn:aws:bedrock-agentcore:[a-z0-9-]+:\d+:runtime\/[A-Za-z0-9_-]+/`) instead of from config. That also proves the build baked it in.
- **Exercise the timeout path.** A dev-only probe (an exact phrase the process recognises when a dev-only variable is set, never a tool the model could choose) forces a turn past its deadline, so the smoke test proves the timed-out event and the alarm. Staging and production never receive the variable.
- **Archive the verdict per commit.** Write `passed` or `failed` to `s3://<bucket>/e2e-reports/<sha>/ai-status.json` and make the production deploy refuse a commit without `passed`. A missing file means "never ran", which is different from "ran and failed".
- **One alert, many failures.** A failing probe that does not block staging opens or updates a single labelled issue and comments on it; a green run closes it.

---

## Section 8: AgentCore Evaluations

AgentCore Evaluations, including its dataset (batch) mode, was not generally available when last checked (2026-09-17). Keep the harness from section 6 and reopen the choice when it reaches GA; the adopt-or-defer record for each AgentCore service is in [`00-decisions.md`](./00-decisions.md).

---

## Verification

```bash
# Spans reach the runtime's log group (unified destination on):
aws logs describe-log-groups --log-group-name-prefix /aws/bedrock-agentcore/runtimes/ \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output table
# Expect your runtime with a retention value, not "None".

# The counters are published under the right namespace (after one failed or timed-out turn):
aws cloudwatch list-metrics --namespace bedrock-agentcore --query 'Metrics[].MetricName'

# The process refuses to start without the content-capture variable:
env -u OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT python main.py; echo "exit=$?"   # expect a non-zero exit
```

Test checklist, one per mechanical rule:

- Configuration rejects a missing or boolean content-capture value (section 3.1).
- An in-memory exporter shows exactly one `chat` span per model call and no message text (sections 1.2 and 3.2).
- Template assertions for the four X-Ray actions, the `PutMetricData` condition, and the log retention (sections 2.3 and 4).
- HTTP clients send keys in headers (section 3.3).
- Alarms exist with threshold 1 and `NOT_BREACHING` (section 5).

## Further reading

- Inside this skill: [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) for the rest of the runtime role and the environment-variable limit; [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) for calling the runtime with a token or SigV4; [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) for the turn deadline that produces `turn_timed_out`; [`05-gotchas.md`](./05-gotchas.md) for the symptom lookup.
- Sibling skill: [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md) for the pipeline these steps plug into.
- [Configure observability in AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html).
- [OpenTelemetry GenAI attribute registry](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md).
- [`aws-otel-python-instrumentation`](https://github.com/aws-observability/aws-otel-python-instrumentation): read `aws_opentelemetry_distro.py` to see which defaults ADOT sets on your version.
