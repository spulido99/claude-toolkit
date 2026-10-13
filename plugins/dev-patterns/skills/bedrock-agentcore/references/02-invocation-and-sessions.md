# Invocation and Sessions

**Builds:** The calling side of an AgentCore Runtime agent: a `runtimeSessionId` derived from the conversation and shared by every caller, the retry wrapper for a session that is still starting, the JWT gate that forwards `Authorization` to the process, the SigV4 call from a backend, and the rule that identity reaches tools through `config`, never through the prompt.

**When to use:** Writing the client or backend code that calls `/invocations`, choosing `idleRuntimeSessionTimeout`, wiring a Cognito JWT authorizer, or diagnosing a slow first answer, a 401 with a valid token, a 409 or 424 from AgentCore, or a turn that dies in the middle.

**Prerequisites:** Section 4 of [`00-decisions.md`](./00-decisions.md) for whether the client calls the runtime directly with a JWT or a backend calls it with SigV4. [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) for the entrypoint and the CDK construct this file configures.

> Verified on 2026-10-12 against `bedrock-agentcore` Python SDK 1.22.0, `@aws-sdk/client-bedrock-agentcore` (v3), and `aws-cdk-lib` 2.261. Facts marked *(observed)* were measured against deployed runtimes in production projects and are not stated in the AWS docs; re-check them when AgentCore changes.

## Contents

1. Session model: one session, one microVM
2. `runtimeSessionId`: derive it from the conversation
3. Session lifecycle: idle timeout and max lifetime
4. Retrying while a session starts
5. Auth modes: SigV4 or JWT, one per runtime
6. JWT inbound: the gate and the forwarded header
7. Calling from a browser or mobile client with a JWT
8. Calling from a backend with SigV4
9. Identity reaches tools through `config`
10. Limits and what AgentCore does not offer
11. Verification
12. Further reading

---

## Section 1: Session model: one session, one microVM

AgentCore runs each session in its own microVM. Every invocation that carries the same `runtimeSessionId` is routed to the same microVM while it is alive, so the process keeps its in-memory state (loaded graph, clients, caches) between turns.

A new `runtimeSessionId` means a new microVM and a cold start. *(Observed)* a cold start cost 7–12 s per call from outside, while the work inside the container took 0.5–1.4 s. A project that generated a fresh id per call paid that cost on every message for two weeks before anyone measured it.

AgentCore does not bind a user to a session. Anyone who knows a session id and passes the gate lands in that microVM. Your code decides who owns a conversation, from the authenticated identity (sections 6 and 8), never from the session id.

## Section 2: `runtimeSessionId`: derive it from the conversation

Rules:

- Length 33–256 characters. A shorter id is rejected; *(observed)* the symptom was an unexplained 503 instead of a turn.
- Derive it from the conversation, one per conversation, never one per call.
- Build it from parts that are already restricted to `[A-Za-z0-9-]`, joined with `-`: the Cognito `sub` (a UUID) and a conversation name, for example `${sub}-${conversationName}`. The conversation name is the thread id when a user can hold several threads, and a fixed name (`support`) only when each user has a single thread with the agent. Validate the result against `^[A-Za-z0-9-]{33,256}$` and throw when it fails. Stripping or rewriting characters lets two references collide (`user-1/x` and `user1/x` would become the same id).
- Never shared across users: the `sub` in the id keeps two users apart.
- Every caller of the same conversation (the app, a backend, an operator console) must build the identical string. A one-character difference sends them to two microVMs, and the only symptom is slowness.
- The id is deterministic and authorizes nothing. Ownership of the thread comes from the token on every invocation (section 6).

Pass it as the `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header over HTTP, or as `runtimeSessionId` in the AWS SDK. Inside the entrypoint it arrives as `context.session_id`.

TypeScript, in a shared package so app and backend import one function:

```ts
// packages/core/src/agentSession.ts
const SESSION_ID = /^[A-Za-z0-9-]{33,256}$/;

export function agentCoreSessionId(sub: string, conversationName: string): string {
  const id = `${sub}-${conversationName}`;
  if (!SESSION_ID.test(id)) throw new Error(`invalid AgentCore session id: ${id}`);
  return id;
}
```

Python, for a caller that cannot import the TypeScript package. It copies the rule character for character:

```python
import re

SESSION_ID = re.compile(r"[A-Za-z0-9-]{33,256}")  # ASCII class on purpose: \w accepts accented letters


def agent_core_session_id(sub: str, conversation_name: str) -> str:
    session_id = f"{sub}-{conversation_name}"
    if not SESSION_ID.fullmatch(session_id):
        raise ValueError(f"invalid AgentCore session id: {session_id}")
    return session_id
```

Check: pin the same hand-written literal in both suites. A formula cannot be verified against itself; the literal is what proves both callers agree.

```ts
// agentSession.test.ts
const SUB = '3f1c9a52-7d4e-4b8a-9c61-2e5f0a7b8d90';

test('app and backend compose the same session id for the same conversation', () => {
  expect(agentCoreSessionId(SUB, 'support')).toBe('3f1c9a52-7d4e-4b8a-9c61-2e5f0a7b8d90-support');
});
test('an id outside the allowed shape throws instead of being rewritten', () => {
  expect(() => agentCoreSessionId('short', 'x')).toThrow();          // under 33 characters
  expect(() => agentCoreSessionId(SUB, 'support/chat')).toThrow();   // character outside [A-Za-z0-9-]
});
```

```python
# test_session_id.py
import pytest

SUB = "3f1c9a52-7d4e-4b8a-9c61-2e5f0a7b8d90"


def test_backend_composes_the_same_session_id_as_the_app():
    assert agent_core_session_id(SUB, "support") == "3f1c9a52-7d4e-4b8a-9c61-2e5f0a7b8d90-support"


def test_invalid_session_id_raises():
    with pytest.raises(ValueError):
        agent_core_session_id("short", "x")
```

## Section 3: Session lifecycle: idle timeout and max lifetime

Two settings in `lifecycleConfiguration` decide when AgentCore stops a session's microVM:

- `idleRuntimeSessionTimeout`: seconds without activity before the session stops. Default 900 s; minimum 60 s.
- `maxLifetime`: hard cap on a session's total life. Default and maximum 8 h.

AgentCore bills the microVM's memory for as long as the session is alive, idle or not; CPU is billed only while working. *(Observed)* idle sessions were 85% of one month's AgentCore bill in a project whose turns lasted about 14 s and whose sessions then stayed alive 15 more minutes.

Choose the idle timeout per stage on purpose:

- Production: keep 900 s when users come back to the same conversation within minutes. The next turn reuses the warm microVM instead of paying a cold start.
- Dev and CI: evals and smoke tests open a session per test and never return to it. Lower the timeout (for example 180 s) so those sessions stop billing soon.

Rule: work that outlives the request, and any turn longer than the idle timeout, is either registered with `app.add_async_task` or fits inside the idle timeout with margin. The floor is the longest turn, not the AgentCore minimum. The registration code lives in [`03-long-turns-and-state.md`](./03-long-turns-and-state.md).

Why: during a synchronous invocation the SDK's `/ping` answers `Healthy`, and AgentCore treats `Healthy` as stoppable once the idle timeout passes. `HealthyBusy` is reported only while a task registered with `add_async_task` is running, and the AWS docs state that a session returning `HealthyBusy` stays alive beyond the idle timeout. If you write your own `/ping` handler, leave `time_of_last_update` alone on routine pings: refreshing it every time keeps sessions alive until `maxLifetime`.

Evidence *(observed)*: with a 60 s idle timeout, a 125 s turn died mid-flight. The error was `Runtime initialization time exceeded`, which is misleading in this case: nothing was initializing, the session was stopped as idle.

Keep the per-stage value in configuration and test the floor:

```ts
// infra/config/agents.ts
export const LONGEST_TURN_SECONDS = 125; // turn deadline + margin
const DEV_IDLE_TIMEOUT_SECONDS = 180;
export function idleTimeoutSecondsFor(stage: 'dev' | 'prod'): number {
  return stage === 'dev' ? DEV_IDLE_TIMEOUT_SECONDS : 900;
}

// agents.test.ts
test.each(['dev', 'prod'] as const)('%s idle timeout outlives the longest turn', (stage) => {
  expect(idleTimeoutSecondsFor(stage)).toBeGreaterThan(LONGEST_TURN_SECONDS);
  expect(idleTimeoutSecondsFor(stage)).toBeGreaterThanOrEqual(60);
});
```

## Section 4: Retrying while a session starts

When an invocation reaches a session that is starting or stopping, AgentCore answers before your container sees the request. Two shapes:

- 409 with `RetryableConflictException` in the `x-amzn-errortype` header and `Session operation in progress` in the body. Documented.
- 424 with `Received error (502) from runtime` in the body. *(Observed, undocumented)* the second request to a freshly started session does not reach the container (the runtime log never records it) and comes back after about 4.5 s; by about 5 s requests get through. It appears only once sessions are reused (section 2), because a fresh session per call never receives a second request.

Retry those two, with short backoff: 250, 500, 1000, 2000 ms (under 4 s total, paid only on the first act of a conversation). Leave every other 409 alone: your own container may return 409 as a real answer (an expired pending action, a closed thread), and retrying it makes the user wait for nothing.

In a browser, read the body. `x-amzn-errortype` is not on the CORS safelist, so `response.headers.get('x-amzn-errortype')` returns `null` cross-origin even when AWS sends it.

```ts
const SESSION_START_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000];

async function isSessionStarting(response: Response): Promise<boolean> {
  if (response.status !== 409 && response.status !== 424) return false;
  if (response.headers.get('x-amzn-errortype')?.includes('RetryableConflictException')) return true;
  const body = await response.clone().text().catch(() => ''); // clone: the caller reads the original
  if (response.status === 424) return body.includes('Received error (502) from runtime');
  return body.includes('RetryableConflictException') || body.includes('Session operation in progress');
}

export async function invokeRuntime(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  // A fresh timeout per attempt: one signal shared by all attempts would expire during the retries.
  const attempt = () => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let response = await attempt();
  for (const delay of SESSION_START_RETRY_DELAYS_MS) {
    if (!(await isSessionStarting(response))) return response;
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await attempt();
  }
  return response;
}
```

A Python backend calling over HTTP uses the same predicate with delays `(0.25, 0.5, 1.0, 2.0)`. A backend calling through the AWS SDK (section 8) gets an exception instead of a `Response`; match the same strings on the error's name and message. The SDK path was not measured in the source projects, so log what you match the first time.

Check: unit-test the predicate with a 409 whose body comes from your own container (no retry) and a 424 with the AgentCore body (retry).

## Section 5: Auth modes: SigV4 or JWT, one per runtime

A runtime accepts exactly one inbound auth mode:

- **SigV4 (IAM)**, the default when no authorizer is configured. Callers sign with AWS credentials. Fits backends (Lambda, containers) that already have an IAM role.
- **JWT**, when `authorizerConfiguration.customJwtAuthorizer` is set. Callers send `Authorization: Bearer <token>`. Fits browsers and mobile apps, which have a Cognito token and no AWS credentials.

Never both on one runtime. Two consequences:

- A backend that must call a JWT runtime gets its own token, for example a Cognito app client with the client-credentials flow, listed in `allowedClients`. The process tells callers apart by the token's `client_id` claim (section 6).
- A design that needs both modes for the same agent needs two runtimes or a backend in front. Decide this in section 4 of [`00-decisions.md`](./00-decisions.md), before writing the client.

Every invocation is authenticated one of these two ways. There is no unauthenticated path to `/invocations`.

## Section 6: JWT inbound: the gate and the forwarded header

Configure the authorizer with the user pool and its allowed app clients, and allowlist `Authorization`. With the L2 construct (`@aws-cdk/aws-bedrock-agentcore-alpha`, the default in section 3 of [`00-decisions.md`](./00-decisions.md)):

```ts
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

const runtime = new agentcore.Runtime(this, 'SupportAgentRuntime', {
  // ...runtimeName, artifact, role: see 01-runtime-and-deploy.md
  authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(userPool, [appClient, machineClient]),
  // or, for any OIDC issuer: RuntimeAuthorizerConfiguration.usingJWT(discoveryUrl, allowedClients)
  requestHeaderConfiguration: { allowlistedHeaders: ['Authorization'] },
});
```

The same with the L1 construct (`aws-cdk-lib/aws-bedrockagentcore`):

```ts
const runtime = new bedrockagentcore.CfnRuntime(this, 'SupportAgentRuntime', {
  // ...artifact, role, network: see 01-runtime-and-deploy.md
  authorizerConfiguration: {
    customJwtAuthorizer: {
      discoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
      allowedClients: [appClient.userPoolClientId, machineClient.userPoolClientId],
    },
  },
  requestHeaderConfiguration: {
    requestHeaderAllowlist: ['Authorization'],
  },
});
```

Why each line:

- Allowed clients, not an allowed audience (`usingCognito` builds `allowedClients` for you; on L1, set `allowedClients` and leave `allowedAudience` out). Cognito access tokens carry `client_id` and no `aud`, so an audience check rejects every valid token, and the failure reads like "the agent is down".
- `Authorization` in the header allowlist (`allowlistedHeaders` on L2, `requestHeaderAllowlist` on L1). The gate validates the token and then drops the header. Without the allowlist the process receives no `Authorization` and your code answers 401 to a valid token. With it, the same token the gate already validated reaches the process.

Inside the process, read the identity from that header. Decode the claims without re-verifying the signature: the gate already verified signature, issuer, expiry, and client, and a second verification is a second implementation of the same rule that can drift. This is the pattern in the AWS inbound-auth guide.

```python
import base64
import json
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext

app = BedrockAgentCoreApp()


class MissingIdentity(Exception):
    pass


def caller_of(headers: dict[str, str] | None) -> tuple[str, str]:
    """Return (sub, client_id) from the Authorization header the gate validated."""
    for name, value in (headers or {}).items():
        if name.lower() != "authorization":  # header names are case-insensitive
            continue
        if not value.lower().startswith("bearer "):
            raise MissingIdentity("Authorization is not a Bearer token")
        payload = value[len("bearer "):].strip().split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise MissingIdentity("token has no sub")
        return sub, claims.get("client_id") or ""
    raise MissingIdentity("no Authorization header: check the runtime header allowlist")


@app.entrypoint
def invoke(payload: dict, context: RequestContext):
    sub, client_id = caller_of(context.request_headers)
    # The thread is derived from `sub`. The payload and the session id are written by the caller.
    ...
```

Take `sub` from the validated token, and authorize privileged callers (an operator console, a backend job) by its `client_id` claim. These other sources are written by the caller and are not trusted:

- The payload.
- The session id: it is deterministic and authorizes nothing (section 2).
- `X-Amzn-Bedrock-AgentCore-Runtime-User-Id`: the caller sets it and AgentCore does not check it against the authenticated identity. AWS marks it for development.
- Any field in the body that names a role or a user.

Other headers reach the process only when they carry the `X-Amzn-Bedrock-AgentCore-Runtime-Custom-` prefix and are allowlisted. Nobody validates their values, so treat them as caller input.

Check (CDK assertions):

```ts
const template = Template.fromStack(stack);
template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
  AuthorizerConfiguration: { CustomJWTAuthorizer: { DiscoveryUrl: Match.anyValue(), AllowedClients: Match.anyValue() } },
  RequestHeaderConfiguration: { RequestHeaderAllowlist: Match.arrayWith(['Authorization']) },
});
expect(JSON.stringify(template.toJSON())).not.toContain('AllowedAudience');
```

Check (pytest): `caller_of({"authorization": "Bearer <token>"})` and `caller_of({"Authorization": ...})` return the same `sub`; a payload carrying a different `user_id` changes nothing; no header raises `MissingIdentity`.

## Section 7: Calling from a browser or mobile client with a JWT

The public endpoint, with the runtime ARN URL-encoded:

```ts
function invocationsUrl(region: string, agentRuntimeArn: string): string {
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(agentRuntimeArn)}/invocations?qualifier=DEFAULT`;
}

const response = await invokeRuntime(invocationsUrl(region, agentRuntimeArn), {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken}`,
    'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': agentCoreSessionId(sub, 'support'),
  },
  body: JSON.stringify({ prompt }),
});
```

- Send the access token (it carries `client_id`, which the gate checks against the allowed clients), not the ID token. `sub` is read from that same token.
- `invokeRuntime` is the retry wrapper from section 4; it sets a fresh timeout on each attempt.
- *(Observed, undocumented)* the endpoint answers CORS preflights with `access-control-allow-origin: *` (measured in us-east-1 and eu-west-1, 2026-09). Browsers can call it directly, with no Lambda or API Gateway in front. Another production project designed around the opposite assumption (no CORS) and kept a Lambda in front, so measure with the `curl` in section 11 before relying on it, in every new region.
- For turns longer than a request should stay open, the client fires the request and gets progress over a separate channel. See [`03-long-turns-and-state.md`](./03-long-turns-and-state.md).

## Section 8: Calling from a backend with SigV4

The invoker's IAM policy names the runtime ARN and its sub-resources (endpoints):

```ts
invokerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['bedrock-agentcore:InvokeAgentRuntime'],
  resources: [runtime.agentRuntimeArn, `${runtime.agentRuntimeArn}/*`],
}));
```

`runtime.agentRuntimeArn` and `runtime.agentRuntimeId` are the L2 attributes; on the L1 `CfnRuntime` they are `attrAgentRuntimeArn` and `attrAgentRuntimeId`.

TypeScript (AWS SDK v3):

```ts
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

const agentCore = new BedrockAgentCoreClient({});

const response = await agentCore.send(new InvokeAgentRuntimeCommand({
  agentRuntimeArn: process.env.AGENT_RUNTIME_ARN!,
  runtimeSessionId: agentCoreSessionId(sub, 'support'),
  qualifier: 'DEFAULT',
  payload: Buffer.from(JSON.stringify(payload)),
}));
```

Reading the response: `response.response` is a Node `Readable` of raw bytes, not `{ chunk: { bytes } }` events. When the entrypoint yields (a generator), the body is Server-Sent Events: lines of `data: {...}` separated by blank lines, split arbitrarily across chunks. Accumulate, split on newlines, keep the trailing partial line, and strip the `data: ` prefix:

```ts
let buffer = '';
const decoder = new TextDecoder();
const events: unknown[] = [];
const handleLine = (line: string) => {
  const trimmed = line.trimEnd();
  if (!trimmed) return;
  const json = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
  try { events.push(JSON.parse(json)); } catch { /* heartbeat or comment */ }
};
for await (const chunk of response.response as AsyncIterable<Uint8Array>) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  lines.forEach(handleLine);
}
if (buffer) handleLine(buffer);
```

When you start the work and do not wait for the result (the backend side of a fire-and-forget turn, see [`03-long-turns-and-state.md`](./03-long-turns-and-state.md)), destroy the body. Otherwise the keep-alive socket stays taken, and a warm Lambda that starts several runs exhausts its sockets and fails every call after that:

```ts
(response as { response?: { destroy?: () => void } }).response?.destroy?.();
```

Python (boto3):

```python
import json
import boto3

client = boto3.client("bedrock-agentcore", region_name=region)
response = client.invoke_agent_runtime(
    agentRuntimeArn=runtime_arn,
    runtimeSessionId=agent_core_session_id(sub, "support"),
    qualifier="DEFAULT",
    payload=json.dumps({"prompt": prompt}).encode(),
)
result = json.loads(response["response"].read())  # non-streaming entrypoint (returns a dict)
```

A Lambda behind API Gateway that waits for the result is capped at 29–30 s by API Gateway (REST 29 s, HTTP API 30 s), whatever the Lambda timeout. Keep that design for turns well under that cap; past it, use the fire-and-forget turn.

## Section 9: Identity reaches tools through `config`

The entrypoint resolves identity (section 6 for JWT; for SigV4, the trusted backend passes it in the payload after its own auth) and hands it to tools through LangGraph's `config["configurable"]`, never through the prompt or the messages. The model cannot read or rewrite `config`, so a prompt injection cannot make a tool act for another user.

```python
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

INVALID_USER_IDS = {"", "anonymous", "unknown", "test"}


@app.entrypoint
def invoke(payload: dict, context: RequestContext):
    sub, _ = caller_of(context.request_headers)
    if sub in INVALID_USER_IDS:
        return {"error": "UNAUTHORIZED"}
    config = {"configurable": {"thread_id": f"{sub}-support", "user_id": sub}}
    result = get_agent().invoke({"messages": [{"role": "user", "content": payload["prompt"]}]}, config)
    return {"response": result["messages"][-1].content}


@tool
def get_my_orders(config: RunnableConfig) -> list[dict]:
    """List the caller's orders."""
    return orders_api.list(user_id=config["configurable"]["user_id"])
```

Tools that call your own APIs forward the caller's token (or sign with the runtime role plus the user id) so each API re-checks access on its own.

Check (pytest): invoke the entrypoint with a token for user A and a message asking for user B's data; assert the tool received `user_id == A`.

## Section 10: Limits and what AgentCore does not offer

As documented on the verification date. Check the AgentCore quotas page before designing around a number.

| Limit | Value |
|---|---|
| Synchronous request | 15 min |
| Streaming response | 60 min |
| Session max lifetime (and background work) | 8 h on microVMs |
| Idle timeout | 60 s minimum, 900 s default |
| Request payload | 100 MB |
| Streaming chunk | 10 MB |
| microVM per session | 2 vCPU, 8 GB |
| `runtimeSessionId` length | 33–256 characters |

What AgentCore does not offer, and what to do instead:

- **No configurable warm pool.** The only warm-up is invoking the session yourself before the user's first turn, with the sentinel payload `{"warmup": true}`, which the entrypoint answers before touching the model. Send it with the conversation's session id (section 2) so the warm microVM is the one the first turn reaches:

```python
@app.entrypoint
def invoke(payload: dict, context: RequestContext):
    if payload.get("warmup") is True:
        return {"status": "warm"}
    ...  # the turn: payload["prompt"]
```
- **No async-invoke API.** Fire-and-forget is built on the application side: return an acknowledgement, keep working in a task registered with `add_async_task`, persist the result yourself. See [`03-long-turns-and-state.md`](./03-long-turns-and-state.md).
- **No reattaching to a running stream.** If the client loses an SSE response it cannot resume it; deliver anything the user must not miss through a store or a channel the client can re-read.
- **The process keeps running after the client disconnects.** Design for a turn that finishes with nobody listening; the measurements are in section 1 of [`03-long-turns-and-state.md`](./03-long-turns-and-state.md).

## Section 11: Verification

Session reuse (expect the second call to be much faster than the first):

```bash
SID="smoke-$(uuidgen)"   # 42 characters, all in [A-Za-z0-9-]
for i in 1 2; do
  /usr/bin/time -p aws bedrock-agentcore invoke-agent-runtime \
    --agent-runtime-arn "$ARN" --runtime-session-id "$SID" --qualifier DEFAULT \
    --payload '{"warmup": true}' --cli-binary-format raw-in-base64-out \
    --profile "$PROFILE" /dev/stdout
done
```

JWT gate wired (expect 401 without a token, and CORS headers on the preflight):

```bash
URL="https://bedrock-agentcore.$REGION.amazonaws.com/runtimes/$(jq -rn --arg a "$ARN" '$a|@uri')/invocations?qualifier=DEFAULT"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL" -H 'content-type: application/json' -d '{}'
curl -s -i -X OPTIONS "$URL" -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' | grep -i access-control
```

Lifecycle and auth as deployed (compare with the values you meant to set):

```bash
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RUNTIME_ID" --profile "$PROFILE" \
  --query '{lifecycle: lifecycleConfiguration, authorizer: authorizerConfiguration, headers: requestHeaderConfiguration}'
```

Tests to keep in CI: the pinned session-id literal in every caller's suite (section 2), the idle-timeout floor (section 3), the retry predicate (section 4), the CDK assertions for `AllowedClients` and `RequestHeaderAllowlist` (section 6), and the identity-through-`config` test (section 9).

## Further reading

- Inside this skill: section 4 of [`00-decisions.md`](./00-decisions.md) (client-direct JWT versus backend SigV4), [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) (entrypoint skeleton, CDK construct, runtime role), [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) (fire-and-forget turns, `add_async_task`, progress over AppSync Events), [`04-observability-and-evals.md`](./04-observability-and-evals.md) (smoke tests against the deployed runtime), [`05-gotchas.md`](./05-gotchas.md) (symptom lookup).
- Sibling skills: [`aws-cdk-patterns/references/02-auth-stack.md`](../../aws-cdk-patterns/references/02-auth-stack.md) (the Cognito user pool and app clients), [`aws-cdk-patterns/references/01-serverless-api.md`](../../aws-cdk-patterns/references/01-serverless-api.md) (the API Gateway 29–30 s ceiling), [`expo-react-native/references/03-auth-and-networking.md`](../../expo-react-native/references/03-auth-and-networking.md) (getting a fresh access token on the client).
- AWS docs: [Runtime sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html), [Inbound and outbound auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html), [Passing headers to the runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-header-allowlist.html), [`CustomJWTAuthorizerConfiguration`](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CustomJWTAuthorizerConfiguration.html), [AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html).
