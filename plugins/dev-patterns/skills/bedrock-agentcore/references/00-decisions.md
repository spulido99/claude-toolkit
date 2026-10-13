# Decisions and Defaults

**Builds:** The set of choices you make once per agent before writing infrastructure: which AgentCore services to adopt, how the code ships, which CDK construct deploys it, who calls the runtime and how they authenticate, whether a turn is synchronous, where the conversation thread lives, which model provider answers, which platform version runs it, and how sessions are reused.

**When to use:** Starting a new agent on AgentCore Runtime, writing the ADR for one, or reconsidering a choice after a measured problem (slow turns, timeouts, cost). Read the section for the decision at hand; each one links to the reference file that owns the implementation.

**Prerequisites:** None. The agent's graph (prompt, tools, subagents) is designed separately with the `deepagents-builder` skills; this file covers what runs around the graph.

> Verified on 2026-10-12 against `bedrock-agentcore` Python SDK 1.22.0, `aws-cdk-lib` 2.261, `@aws-cdk/aws-bedrock-agentcore-alpha` 2.250.0-alpha.0, `deepagents` 0.7.13 and `langgraph-checkpoint-aws` 1.2.3. Facts marked *(observed)* were measured in production projects, not taken from AWS documentation. AgentCore changes quickly: re-check service availability and quotas in the AWS docs before relying on a reason below.

## Contents

1. **AgentCore first: the rule and the service inventory** — check AgentCore before building any piece around the agent; adopt/defer table for Runtime, Memory, Identity, Gateway, Policy, Evaluations, Observability.
2. **Artifact: direct code zip vs container image**
3. **CDK construct: L2 alpha `Runtime` vs L1 `CfnRuntime`**
4. **Who invokes the runtime: the client with a Cognito JWT vs a backend with SigV4**
5. **Turn shape: synchronous vs fire-and-forget with live progress**
6. **Thread memory: `DynamoDBSaver` vs AgentCore Memory**
7. **Model provider: Bedrock vs a provider API**
8. **Platform version: V2 vs V1**
9. **Session reuse: one session per conversation vs one per invocation**
10. **Decision checklist for a new agent** — the nine choices as a table to copy into the ADR.

---

## Section 1: AgentCore first: the rule and the service inventory

**The rule.** Before building any piece that surrounds the agent (thread memory, identity and credentials, tool access, observability, evaluations, policies), check whether AgentCore offers it as a service. Build your own only when an ADR records the reason: the service is not generally available, it cannot meet an obligation you have (for example deleting a user's thread on request), or it costs more than it saves. Logic inside the graph stays in native LangChain and LangGraph; the rule is about what runs around the agent, not how the agent is assembled.

**Why.** Every piece you build is code you test, operate and explain. Production projects that skipped the check rebuilt services AgentCore already had; projects that ran it found several services that did not fit yet, and wrote down what would make them fit.

The inventory below is the state on 2026-10-12. Each "defer" carries the condition that reopens it; put the same condition in your ADR so the next review knows when to look again.

| Service | Decision | Reason | Reopen when |
|---|---|---|---|
| **Runtime** | Adopt | Hosts the agent process in a per-session microVM with an inbound JWT or SigV4 gate. Everything in this skill assumes it. | — |
| **Identity (inbound)** | Adopt | The runtime's custom JWT authorizer *is* AgentCore Identity. Configuring it (section 4) is adopting it. | — |
| **Identity (outbound token vault)** | Defer | It stores credentials for calling third parties on the user's behalf. Tools that call your own APIs forward the user's token instead (section 4). | The first tool that calls a third party on behalf of the user. |
| **Memory (short-term, as checkpointer)** | Defer | The official saver writes the thread as blobs, and AgentCore does not extract blobs into long-term memory, so you get none of the summaries or search. See section 6 for quota and cost. | Never for the checkpointer alone; see the long-term row. |
| **Memory (long-term store)** | Defer until needed | `AgentCoreMemoryStore` is additive: it works next to any checkpointer, with a pre-model hook writing conversational payloads. | The agent must remember facts across conversations. Add the store; keep the checkpointer where it is. |
| **Gateway** | Defer | OpenAPI targets cannot forward the inbound user token: outbound auth is none, OAuth (2- or 3-legged), API key, or SigV4 with the gateway's role. `JWT_PASSTHROUGH` exists only on HTTP passthrough targets, which do not produce tools. A tool behind Gateway would call your API with the gateway's credential, so a prompt injection could read any user's data. | Tools for third-party services with their own credentials, or a catalog large enough that discovery and semantic search pay off. |
| **Policy** | Defer (depends on Gateway) | Policy only evaluates traffic that passes through a Gateway. Content filtering is a separate layer (Bedrock Guardrails). | Whatever reopens Gateway. |
| **AgentCore Evaluations** | Defer | Not generally available when last checked (2026-09-17). It evaluates sessions stored in CloudWatch from a runtime with observability enabled, and its dataset (batch) mode invokes the deployed agent and evaluates the resulting session. Keep a small own harness meanwhile. | General availability. Then port the scenarios and retire the own harness. |
| **Observability** | Adopt | OpenTelemetry spans to CloudWatch through ADOT and Transaction Search. | — |

**Details in:** [`04-observability-and-evals.md`](./04-observability-and-evals.md) for observability and the eval harness; [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) for the checkpointer.

---

## Section 2: Artifact: direct code zip vs container image

**Default:** direct code deployment. The runtime reads a zip from S3 with `runtime: 'PYTHON_3_13'` and `entryPoint: ['main.py']`. No ECR repository, no Docker build, no arm64 image to maintain.

**Choose a container image when:** the agent needs system packages or native binaries that have no `manylinux2014_aarch64` wheel, needs a language runtime that direct code does not offer, or the dependency tree exceeds the zip quotas below. The image must be `linux/arm64`.

**Why:** Three earlier projects shipped arm64 containers through ECR; the two most recent switched to the zip and removed the ECR repository, the image build and the Docker dependency from CI. A typical `deepagents` tree fits the zip quotas with room to spare; the quotas and a measured size are in section 3 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md).

**Details in:** [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) (packaging, wheel platform, quota check before upload, artifact keying).

---

## Section 3: CDK construct: L2 alpha `Runtime` vs L1 `CfnRuntime`

**Default:** the L2 alpha `Runtime` from `@aws-cdk/aws-bedrock-agentcore-alpha` with `AgentRuntimeArtifact.fromCodeAsset(...)` and a `bundling` block. CDK hashes the asset, so every code change produces a new S3 key and the runtime picks it up on deploy. The code lands in the bootstrap asset bucket, which already exists, so there is no bucket-before-runtime ordering to manage. Pin the exact alpha version: alpha modules can change between releases.

**Choose the L1 `CfnRuntime` when:** CI builds and uploads the zip outside CDK, or the team will not depend on an alpha module. The L2 types the execution role, the JWT authorizer (`usingCognito` / `usingJWT`) and the header allowlist; only `PlatformVersion` needs an override in either construct (section 4 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md)). With the L1 you own artifact keying (section 6 of the same file).

**Why:** Production projects used both and both work. The L1 project uploaded the zip outside CDK and needed the bucket in a shared stack deployed first; the L2 project let CDK bundle with `uv` for arm64 and never managed keys.

**Details in:** [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) (construct code for both, IAM role, `runtime.node.addDependency(role)`, deploy order).

---

## Section 4: Who invokes the runtime: the client with a Cognito JWT vs a backend with SigV4

A runtime accepts SigV4 or a JWT, never both. Pick one per runtime.

**Default for a user-facing app:** the client calls the runtime endpoint directly with the user's Cognito access token. The runtime's custom JWT authorizer validates it. There is no Lambda and no API Gateway between them, so the API Gateway 29–30 s cap does not apply. *(observed)* The endpoint answers browser requests with `access-control-allow-origin: *` (tested in us-east-1 and eu-west-1, September 2026); AWS does not document CORS for it.

- Every caller needs a Cognito identity, including users who have not signed up yet. Create a guest Cognito user (`AdminCreateUser`) before the first message, so every call carries a token.
- A machine caller (an operator console or a scheduled job) uses its own Cognito app client with the client-credentials grant, listed in `allowedClients` next to the user's app client. The agent tells them apart by the token's `client_id`.
- The agent takes the user's identity from the token's `sub`. Tools that call your own APIs forward the same token, so the agent never holds a credential broader than the current user's.

**Choose a backend caller with SigV4 when:** the caller is already a server (a webhook, a messaging integration, a queue consumer), a business check must run before every invocation (a usage quota, a billing gate) and you want it in one place, or the client cannot hold a Cognito token. The backend's role needs `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN and `ARN/*`.

**Why:** One project went client-direct to escape the 29–30 s cap and a WebSocket connection table. Another kept a Lambda in front because removing it would have duplicated its quota rule in the client, and the runtime cannot take both SigV4 (for the backend) and JWT (for the app).

**Details in:** [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) (authorizer config, the `Authorization` header allowlist, `allowedClients` vs `allowedAudience`, request URL, retries, IAM for SigV4 callers).

---

## Section 5: Turn shape: synchronous vs fire-and-forget with live progress

**Default when turns can exceed the caller's timeout:** fire-and-forget. The caller invokes the runtime and stops waiting. The agent keeps working, persists the result, and publishes progress events; the client follows them over a WebSocket subscription (AppSync Events) and re-reads the persisted state when it reconnects.

**Choose synchronous request/response when:** turns reliably finish well under every timeout on the path (API Gateway 29–30 s, the calling Lambda's timeout, the client's fetch), and the user waits for a single answer.

**Why:** Real turns hit the API Gateway cap, and the runtime process keeps working after the caller disconnects; the measurements are in section 1 of [`03-long-turns-and-state.md`](./03-long-turns-and-state.md). Two projects reached the same shape independently and rejected the same alternatives: an API Gateway WebSocket (needs a connection table), polling, a queue or Step Functions in front, and a Lambda that relays the runtime's stream.

AgentCore has no asynchronous invoke API and no way to re-attach to a stream in progress. Fire-and-forget is built in the application: the handler acknowledges, work continues in the process, and the session must stay alive until it finishes.

**Details in:** [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) (async handler, `add_async_task`, conditional writes, AppSync Events); [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) (idle timeout vs work that outlives the request).

---

## Section 6: Thread memory: `DynamoDBSaver` vs AgentCore Memory

**Default:** the LangGraph `DynamoDBSaver` from `langgraph-checkpoint-aws`, writing to your own DynamoDB table with a TTL attribute on every item. The thread expires whole without a sweeper job, and deleting it is one `delete_thread` call.

**Choose AgentCore Memory as the checkpointer when:** you have measured your events per turn against its quotas and the cost, and you need its managed retention more than one-call deletion. For long-term memory across conversations, add `AgentCoreMemoryStore` next to the DynamoDB checkpointer instead (section 1).

**Why:** *(observed)* A turn wrote 13 checkpoint events without tools and 19 with one tool call. AgentCore Memory allows 10 `CreateEvent` requests per second per actor and session for non-conversational payloads (5 with conversational payloads), not adjustable, and a turn writes its events within a second or two, so short turns get throttled in bursts. Deleting a 20-turn thread meant about 320 `DeleteEvent` calls at 5 per second per actor and session, roughly a minute inside a deletion Lambda; there is no bulk delete for events. Priced from the AWS price list (eu-west-1, September 2026), the measured volume cost about $40 a month on Memory against $0.41 on DynamoDB, about 100×. The saver's blobs are excluded from long-term extraction, so Memory added no summaries or search in exchange.

If you choose AgentCore Memory anyway, wire both halves: the `Memory` resource in CDK and its id in the runtime's environment. One project had the saver code but never created the resource, and nothing failed at deploy time. Make the process refuse to start when the id is missing (see Verification).

**Details in:** [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) (table keys imposed by the saver, TTL, deletion). For the table itself see [`dynamodb-design`](../../dynamodb-design/SKILL.md).

---

## Section 7: Model provider: Bedrock vs a provider API

**Default:** Bedrock through a cross-region inference profile, called with the runtime role (no secret to manage). The model id always comes from configuration, so moving to another profile (for example from `us.` to `eu.`) is a value change, not a code change.

**Choose a provider API (for example the Anthropic API) when:** Bedrock model access is blocked in the account, or the agent must match an existing service that already calls the provider API (same key, same model, same tokenizer, so an A/B comparison is fair). The API key lives in Secrets Manager; the runtime receives only the secret's ARN.

**Why:** One project switched after Bedrock answered `Model use case details have not been submitted` while the console showed the model as active. Pin the choice with a test so a later edit cannot silently add the other path (see Verification).

**Details in:** [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) (IAM for the inference profile and its foundation models in every region, secret loading on first invocation).

---

## Section 8: Platform version: V2 vs V1

**Default:** `PlatformVersion: 'V2'`. The runtime takes a snapshot of the process after the first healthy `/ping` and starts new sessions from it, so imported libraries cost nothing on later cold starts. Import heavy libraries at module scope to benefit from it.

**Details in:** section 2 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) for what may and may not run at import, and section 4 of the same file for the 1.5 KB environment-variable limit that comes with V2.

---

## Section 9: Session reuse: one session per conversation vs one per invocation

**Default:** one `runtimeSessionId` per conversation, derived from the conversation's identifier and identical across every caller that touches the same conversation. Each new session id is a new microVM with a cold start.

**Choose one session per invocation only with a written reason** (for example, strict isolation between independent jobs whose results are persisted, where the cold start is acceptable). Record the measured cold start next to the reason.

**Why:** A new session id per call adds a cold start to every message, and idle sessions bill memory until their timeout; both are measured in sections 1 and 3 of [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md).

**Details in:** [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) (id format and length, `idleRuntimeSessionTimeout`, `maxLifetime`, 409/424 retries while a session starts).

---

## Section 10: Decision checklist for a new agent

Copy this table into the agent's ADR and fill in the last column. A choice that differs from the default needs its reason next to it.

| # | Decision | Default | Your choice and reason |
|---|---|---|---|
| 1 | AgentCore services adopted | Runtime, inbound Identity, Observability | |
| 2 | Artifact | Direct code zip, `PYTHON_3_13` | |
| 3 | CDK construct | L2 alpha `Runtime` + `fromCodeAsset`, pinned version | |
| 4 | Caller and auth | User app with Cognito JWT; backend with SigV4 when the caller is a server | |
| 5 | Turn shape | Fire-and-forget + live progress when a turn can exceed the caller's timeout | |
| 6 | Thread memory | `DynamoDBSaver` + TTL | |
| 7 | Model provider | Bedrock inference profile, model id from config | |
| 8 | Platform version | V2 | |
| 9 | Session reuse | One session per conversation | |

---

## Verification

Template assertions with `aws-cdk-lib/assertions` that pin the decisions above. Adapt the stack constructor to your project.

```ts
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AgentStack } from '../lib/agent-stack';

const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } }); // skip Python bundling in unit tests
const template = Template.fromStack(new AgentStack(app, 'Test', { stageName: 'test' }));

test('runtime ships as a code zip on platform V2 (sections 2 and 8)', () => {
  template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
    PlatformVersion: 'V2',
    AgentRuntimeArtifact: { CodeConfiguration: Match.objectLike({ Runtime: 'PYTHON_3_13' }) },
  });
});

test('model provider is Bedrock (section 7)', () => {
  // Flip to `not.toContain` if the decision is a provider API.
  expect(JSON.stringify(template.findResources('AWS::IAM::Policy'))).toContain('bedrock:InvokeModel');
});

test('AgentCore Memory, if chosen, is created and wired (section 6)', () => {
  template.resourceCountIs('AWS::BedrockAgentCore::Memory', 1);
  template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
    EnvironmentVariables: Match.objectLike({ AGENTCORE_MEMORY_ID: Match.anyValue() }),
  });
});
```

The process side of section 6: refuse to start without the memory id, so a missing env var fails the first `/ping` instead of silently losing threads. The test extends `read_configuration` from section 2 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md), which owns it.

```python
def test_startup_requires_memory_id(monkeypatch):
    monkeypatch.delenv("AGENTCORE_MEMORY_ID", raising=False)
    with pytest.raises(ValueError, match="AGENTCORE_MEMORY_ID"):
        read_configuration(os.environ)
```

---

## Further reading

- **Inside this skill:**
  - [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) — entrypoint, V2 startup rules, packaging, CDK construct, IAM role, artifact keying.
  - [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) — session ids, idle timeout, JWT and SigV4 callers, retries, limits.
  - [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) — fire-and-forget turns, live progress, the checkpointer.
  - [`04-observability-and-evals.md`](./04-observability-and-evals.md) — tracing, alarms, evals against the deployed runtime.
  - [`05-gotchas.md`](./05-gotchas.md) — symptom lookup.
- **Sibling skills:**
  - [`aws-cdk-patterns` auth stack](../../aws-cdk-patterns/references/02-auth-stack.md) — the Cognito user pool the JWT authorizer trusts.
  - [`dynamodb-design`](../../dynamodb-design/SKILL.md) — the thread table and its TTL.
  - `deepagents-builder` plugin — the agent's graph: prompt, tools, topology.
- **External documentation:**
  - [AgentCore developer guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/) — start here for every service in section 1.
  - [AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html) — zip sizes, Memory event quotas, session limits; re-read before each decision review.
  - [Gateway OpenAPI targets, authorization strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-schema-openapi.html) and [HTTP passthrough targets](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-http-passthrough.html) — the token-forwarding limit behind section 1.
  - [Policy in AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html) — why it depends on Gateway.
  - [AgentCore Evaluations](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/evaluations.html) — check its availability status before keeping an own harness.
  - [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/) — Memory events vs DynamoDB requests for section 6.
