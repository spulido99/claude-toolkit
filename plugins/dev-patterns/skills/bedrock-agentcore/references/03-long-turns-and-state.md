# Long Turns and State

**Builds:** An agent turn that outlives the request that started it: the caller gets an acknowledgement at once, the agent finishes the work in the background, writes the result to durable state with conditional writes, and pushes progress to the client over AppSync Events. Also the thread memory behind it: a LangGraph `DynamoDBSaver` checkpoint with TTL, and a deletion path that leaves nothing behind.

**When to use:** A turn can take longer than the 29–30 s that API Gateway allows, the user should see progress while the agent works, the result must survive the user closing the app, or you are wiring checkpoint storage and thread deletion. Read section 3 before writing any `async` entrypoint.

**Prerequisites:** The sync entrypoint skeleton and the runtime IAM role from [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md). The session id, idle timeout and runtime call from [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md). The choice between waiting for the answer and fire-and-forget is made in section 5 of [`00-decisions.md`](./00-decisions.md).

> Verified on 2026-10-12 against `bedrock-agentcore` Python SDK 1.22.0 (the acknowledgement delay in section 3 was measured on 1.6.3), `langgraph-checkpoint-aws` 1.2.3 and `deepagents` 0.7.13. Facts marked *(observed)* were measured in production projects, not taken from AWS documentation.

## Contents

1. Why fire-and-forget
2. The async entrypoint
3. Keeping the event loop free
4. Writing results from a run that outlives its caller
5. Retries inside the background task
6. Turn deadlines
7. Live progress over AppSync Events
8. Alternatives that were rejected
9. Thread memory and deletion

---

## Section 1: Why fire-and-forget

API Gateway cuts every request at 29 s (REST) or 30 s (HTTP API), and neither limit can be raised. An agent turn with a few tool calls routinely takes longer: in one project 4 of 5 real invocations died at that ceiling *(observed)*. Raising the Lambda timeout changes nothing, because the edge still cuts the request.

The fix is to stop waiting. The caller gets an acknowledgement, the agent runs the turn to the end on its own, persists the outcome, and publishes progress on a channel the client listens to. Two variants work in production:

- **(a) The client invokes the runtime directly** with its Cognito access token (JWT inbound auth) and does not read the response body. Progress and the final answer arrive over AppSync Events. No Lambda, no API Gateway in the turn path.
- **(b) A backend Lambda invokes the runtime** with SigV4, returns `201` to its caller immediately, and destroys the response stream without reading it. The agent writes progress and the result into the backend's table and publishes to AppSync Events.

AppSync Events stores nothing: an event published while the client was offline is gone. The client reads the durable state once when it opens the screen, then subscribes.

The runtime process keeps running after the caller disconnects *(observed: the closing event was published 19.7 s and 129.7 s after the client cut the connection)*. Once no request is in flight, the session counts as idle. The async entrypoint in section 2 registers the work with `add_async_task`, so `/ping` reports `HealthyBusy` and the idle timeout leaves the session alone until the work completes. The idle timeout rule for every other case is in section 3 of [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md). Calling the runtime and destroying the stream are in section 8 of that file; the runtime limits are in its last section.

## Section 2: The async entrypoint

Both variants use this handler. Only the caller differs: in variant (a) the client sends its JWT and ignores the `{"status": "accepted"}` body; in variant (b) the Lambda signs with SigV4 and destroys the stream. The handler does four things in order: validate, register the work so `/ping` reports `HealthyBusy`, start the background task, acknowledge.

```python
import asyncio
import logging

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from support_agent.request import InvalidPayload, parse_request
from support_agent.runner import run_turn

logger = logging.getLogger(__name__)
app = BedrockAgentCoreApp()

# asyncio keeps only a weak reference to a running task; without this set the
# turn can be garbage-collected mid-run.
_BACKGROUND_TASKS: set[asyncio.Task] = set()


async def _run_in_background(request, task_id: int) -> str:
    try:
        return await run_turn(request)
    finally:
        app.complete_async_task(task_id)  # releases HealthyBusy, even on failure


@app.entrypoint
async def support_turn(payload: dict) -> dict:
    try:
        request = parse_request(payload)
    except InvalidPayload as e:
        logger.warning("rejected payload: %s", e)
        return {"status": "rejected", "code": "invalid_payload", "message": str(e)}

    task_id = app.add_async_task("support-turn", {"threadId": request.thread_id})
    task = asyncio.create_task(_run_in_background(request, task_id))
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return {"status": "accepted"}


if __name__ == "__main__":
    app.run()
```

The payload is the turn payload `{"prompt": "..."}` plus what the run needs to write its result: the record keys, the `runId` from section 4, and S3 object keys. Let the agent read each object with its own role; one project went from about 2 MB of base64 per request to about 200 bytes this way.

**Check** — the busy flag is always released:

```python
import pytest
from unittest.mock import patch

import main


@pytest.mark.asyncio
async def test_busy_flag_released_when_turn_raises():
    with patch.object(main, "run_turn", side_effect=RuntimeError("boom")), \
         patch.object(main.app, "add_async_task", return_value=7), \
         patch.object(main.app, "complete_async_task") as complete:
        ack = await main.support_turn(VALID_PAYLOAD)
        await asyncio.gather(*main._BACKGROUND_TASKS, return_exceptions=True)
    assert ack == {"status": "accepted"}
    complete.assert_called_once_with(7)
```

## Section 3: Keeping the event loop free

An `async` handler runs on one event loop per microVM. The acknowledgement cannot leave until the loop is free, and the loop is busy until the background task reaches its first real `await` *(observed on SDK 1.6.3)*. Anything blocking at the start of the task (heavy imports, reading secrets, building the agent, a synchronous boto3 call) holds the acknowledgement back. In one project the acknowledgement took 26–28 s and the caller got `504`. A minimal reproduction: 3 s of blocking work at the top of the task produced a 3.01 s acknowledgement.

Put every blocking call in `asyncio.to_thread` so the loop stays free. This is one attempt at the turn; section 5 wraps it in the retry loop:

```python
# support_agent/turn.py
import asyncio


async def attempt_turn(request) -> dict:
    agent = await asyncio.to_thread(ensure_agent)                     # imports, secrets, agent build
    attachment = await asyncio.to_thread(fetch_attachment, request.attachment_key)
    answer = None
    async for update in agent.astream({"messages": [build_message(request, attachment)]}, stream_mode="updates"):
        await asyncio.to_thread(report_step, request, update)        # conditional write + publish
        answer = final_answer(update) or answer
    if answer is None:
        raise RuntimeError("agent produced no answer")               # transient: section 5 retries it
    return answer
```

An `await asyncio.sleep(0)` at the top lets the acknowledgement leave, but the blocking work after it still stalls the loop, so `/ping` and any other request to the same session wait behind it. Two turns routed to the same session also share that loop, so blocking code in one delays the other.

How the work is split between import time and first invocation depends on the platform version; see section 2 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md). Run the latency gate that catches this with zero retries; see section 6 of [`04-observability-and-evals.md`](./04-observability-and-evals.md).

**Check** — the loop stays responsive while the turn starts:

```python
import time

from support_agent import turn


@pytest.mark.asyncio
async def test_event_loop_stays_free_during_slow_start():
    def slow_build():
        time.sleep(3)  # stands in for imports + secrets + agent construction
        return FAKE_AGENT

    with patch.object(turn, "ensure_agent", slow_build), \
         patch.object(main.app, "add_async_task", return_value=1), \
         patch.object(main.app, "complete_async_task"):
        start = time.monotonic()
        await main.support_turn(VALID_PAYLOAD)
        await asyncio.sleep(0.01)  # completes only when the loop is free
        assert time.monotonic() - start < 1.0
```

## Section 4: Writing results from a run that outlives its caller

Nothing waits for a background run, so it can finish after the user cancelled, edited the record by hand, deleted it, or started a new run. Every write the agent makes carries one condition: the record is still in an expected state, it still belongs to this run, and it is not deleted. That condition is what makes the pattern correct; stopping the session on cancel is only an optimization.

```python
from botocore.exceptions import ClientError


def _condition(request, states: tuple[str, ...]) -> tuple[str, dict]:
    values = {f":s{i}": s for i, s in enumerate(states)}
    condition = f"turnStatus IN ({', '.join(values)})"
    if request.run_id:                      # a retry puts the record back to "running"
        condition += " AND runId = :run"    # so the old run must not match it
        values[":run"] = request.run_id
    return f"{condition} AND attribute_not_exists(deletedAt)", values


def write_result(table, request, result: dict) -> bool:
    condition, values = _condition(request, ("running",))
    try:
        table.update_item(
            Key={"PK": request.pk, "SK": request.sk},
            UpdateExpression="SET turnStatus = :done, turnResult = :result",
            ConditionExpression=condition,
            ExpressionAttributeValues={**values, ":done": "done", ":result": drop_nulls(result)},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False   # nobody wants this result anymore: discard, do not retry
        raise
    return True
```

- Generate `runId` when the run is created, store it on the record, and send it in the payload. Without it, a cancelled run's late result passes the status check and overwrites the run the user actually asked for.
- Drop `None` before writing. Models mark "does not apply" with `null`; a stored `NULL` travelled back to a client that re-sent it to an API that rejected it, and every result record was lost until the fix *(observed)*.
- Charge quota or usage when the result is delivered, not when the run starts, so a run that fails or is cancelled costs the user nothing. The backend decides the quota and sends the agent the exact counter to increment; the agent executes that instruction and decides nothing about limits.
- Create the record, with its initial status and `runId`, before invoking the runtime. An agent started first would write against a record that does not exist yet, and every conditional write would fail.

**Check** — a late write is discarded, not raised (moto):

```python
from moto import mock_aws


@mock_aws
def test_late_result_is_discarded():
    table = make_table()
    table.put_item(Item={"PK": "U#1", "SK": "T#1", "turnStatus": "running", "runId": "new"})
    stale = Request(pk="U#1", sk="T#1", run_id="old")
    assert write_result(table, stale, {"answer": "x"}) is False
    assert "turnResult" not in table.get_item(Key={"PK": "U#1", "SK": "T#1"})["Item"]


def test_nulls_are_dropped():
    assert drop_nulls({"a": 1, "b": None, "c": [None, {"d": None}]}) == {"a": 1, "c": [{}]}
```

## Section 5: Retries inside the background task

A background run has no caller to time it out, so the run itself needs a ceiling. Retry transient failures with exponential backoff until a deadline, fail fast on errors that a retry cannot fix, and end with one of two outcomes the client can tell apart.

```python
# support_agent/runner.py — section 2's _run_in_background calls run_turn(request)
import asyncio
import time

from support_agent.turn import attempt_turn

RETRY_CEILING_SECONDS = 600
FIRST_BACKOFF_SECONDS = 2.0
MAX_BACKOFF_SECONDS = 60.0
FAILURE_TOOK_TOO_LONG = "agent_timeout"   # retrying later is reasonable
FAILURE_BROKE = "agent_error"             # bad payload, missing object: retrying won't help


async def run_turn(request, attempt=attempt_turn, *, sleep=asyncio.sleep, monotonic=time.monotonic) -> str:
    if not mark_running(request):
        return "discarded"
    deadline = monotonic() + RETRY_CEILING_SECONDS
    backoff = FIRST_BACKOFF_SECONDS
    while True:
        try:
            result = await attempt(request)
        except TurnAbandoned:
            return "discarded"             # a conditional write failed mid-run
        except PermanentTurnError:
            announce_failure(request, FAILURE_BROKE)
            return "failed"
        except Exception:
            if backoff >= deadline - monotonic():
                announce_failure(request, FAILURE_TOOK_TOO_LONG)
                return "failed"
            await sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            continue
        if not write_result(request, result):
            return "discarded"
        publish_done(request)
        charge_quota(request)
        return "done"
```

Put a circuit breaker on every flaky external API the tools call. Without one, an outage makes the model rephrase the same lookup again and again until it burns the whole deadline. A shape that worked: after 2 consecutive service-level failures (timeout, HTTP error, network error; "no results" is not a failure) the breaker opens for 60 s, every lookup returns a miss at once, and the tool's result tells the model the service is down and not to retry with rephrased queries.

Keep API keys in headers, never in query strings. HTTP client exceptions and debug logs include the full URL, and traces export it; see section 3 of [`04-observability-and-evals.md`](./04-observability-and-evals.md).

**Check** — permanent errors do not retry, transient ones stop at the ceiling:

```python
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_permanent_error_fails_once():
    attempt = AsyncMock(side_effect=PermanentTurnError("missing object"))
    assert await run_turn(REQ, attempt, sleep=AsyncMock()) == "failed"
    assert attempt.await_count == 1


@pytest.mark.asyncio
async def test_transient_errors_stop_at_ceiling():
    clock = FakeClock()
    attempt = AsyncMock(side_effect=RuntimeError("throttled"))
    assert await run_turn(REQ, attempt, sleep=clock.sleep, monotonic=clock.now) == "failed"
    assert clock.now() <= RETRY_CEILING_SECONDS
```

## Section 6: Turn deadlines

Give each interactive turn two limits so it never fails silently:

- **A soft notice on the client** (for example 15 s with no event): tell the user the answer may not come. Close nothing; if an event arrives later, show it.
- **A hard cap inside the runtime** (for example 120 s): the service stops waiting, writes a fallback reply to the thread ("I couldn't answer, please ask again"), publishes the turn-closed event, and counts a `turn_timed_out` metric. A crash counts `turn_failed` instead, so "too slow" and "broken" read as different incidents.

In the async entrypoint, wrap each attempt in `asyncio.wait_for(attempt_turn(request), cap_seconds)`; `asyncio.to_thread` already copies the context into its worker thread. In a synchronous handler, run the graph in a worker thread and wait on it with a timeout. A bare `ThreadPoolExecutor` does not copy the context, so copy it yourself, or the model and tool spans lose their parent turn span:

```python
import contextvars
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

_graph_pool = ThreadPoolExecutor(thread_name_prefix="support-turn")


def answer_within_cap(respond, request, channel, cap_seconds: float) -> str:
    future = _graph_pool.submit(contextvars.copy_context().run, respond, request, channel)
    try:
        return future.result(timeout=cap_seconds)
    except FutureTimeout as expiry:
        raise TurnTimedOut(f"no answer within {cap_seconds:g} s") from expiry
```

Seal the progress channel before you compose the closing event, so a graph that keeps running after the cap cannot add more notices.

The graph the cap abandoned keeps running and holds its pool thread until it ends. If it writes checkpoints, those writes land outside the per-thread lock, so once the graph writes checkpoints the cap has to cancel the graph instead of only abandoning it.

For a synchronous handler, keep the idle timeout above the hard cap; the rule is in section 3 of [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md). The async entrypoint registers `add_async_task`, so the idle timeout does not apply to it while the work runs. The alarms on both metrics are in section 5 of [`04-observability-and-evals.md`](./04-observability-and-evals.md).

## Section 7: Live progress over AppSync Events

### 7.1 Publishing from the agent

The agent publishes with SigV4, signing with its runtime role through botocore's default credential chain; why the chain matters on a direct-code runtime is in section 2 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md).

```python
import json
import urllib.error
import urllib.request

from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import Session


class AppSyncEventsPublisher:
    def __init__(self, http_endpoint: str, region: str, session: Session | None = None):
        self._endpoint = http_endpoint.removeprefix("https://").rstrip("/")
        self._region = region
        self._session = session or Session()

    def publish(self, channel: str, message: dict) -> None:
        body = json.dumps({
            "channel": channel.lstrip("/"),       # sent without the leading slash
            "events": [json.dumps(message)],      # a list of JSON *strings*, not objects
        }).encode()
        request = AWSRequest(method="POST", url=f"https://{self._endpoint}/event", data=body,
                             headers={"content-type": "application/json", "host": self._endpoint})
        SigV4Auth(self._session.get_credentials(), "appsync", self._region).add_auth(request)
        try:
            urllib.request.urlopen(urllib.request.Request(
                request.url, data=body, headers=dict(request.headers), method="POST"), timeout=10)
        except urllib.error.HTTPError:
            raise                                  # rejected: permission or payload, log the body
        except urllib.error.URLError as e:
            raise ChannelUnreachable(str(e.reason)) from e   # nothing reachable: DNS, local harness
```

Keep the two failures apart in logs and code: an `HTTPError` is a rejection (often a missing permission) and must never read as "the process was gone".

Rules that go with it:

- **One channel per user and thread**, built from the token's `sub` and nothing else: `/threads/{sub}/{thread-name}`.
- **The runtime role may only publish**, on its own namespace. It never subscribes, so a prompt injection cannot read anyone else's channel. Add this statement to the role from section 5 of [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md):

```ts
role.addToPolicy(new iam.PolicyStatement({
  actions: ['appsync:EventPublish'],
  resources: [`${eventApi.attrApiArn}/channelNamespace/${THREADS_NAMESPACE}`],
}));
```

- **Emit progress only from code wrappers around tools** (`get_stream_writer()` inside the tool) and from graph node transitions (`stream_mode="updates"`). If the model called the tool, the event goes out, and the model cannot skip, duplicate or invent steps. The system prompt and the tool catalog stay about the task; progress reporting lives entirely in code. The event may carry the tool's argument (for example "searching: order 1042"), trimmed and shown as-is.

### 7.2 Authorizing subscriptions in the namespace handler

The authorization mode only says someone is signed in; an `onSubscribe` handler on the namespace says who may listen to which channel. Accept exactly `/threads/{sub}/{thread-name}` for the caller's own `sub`. The bare namespace, a wildcard, a shorter path or another user's `sub` would carry one person's events to another person's screen, so all of them are rejected.

```js
// threads-namespace-handler.js — APPSYNC_JS code that runs inside AppSync, not a Node module.
// `util` is a global here. The file ships as-is: no build step, no relative imports.
const NAMESPACE = 'threads';

export function onSubscribe(ctx) {
  const sub = ctx.identity && ctx.identity.sub ? ctx.identity.sub : '';
  const segments = normalizeChannel(ctx.info.channel.path).split('/').filter((s) => s !== '');
  if (!sub || segments.length !== 3 || segments[0] !== NAMESPACE || segments[1] !== sub || segments[2] === '*') {
    util.unauthorized();
  }
}

/** Leading and trailing slashes are optional in the protocol; the channel is not. */
function normalizeChannel(path) {
  const withLeading = path.charAt(0) === '/' ? path : `/${path}`;
  return withLeading.length > 1 && withLeading.charAt(withLeading.length - 1) === '/'
    ? withLeading.slice(0, -1)
    : withLeading;
}
```

Without an `onPublish` handler AppSync forwards events as published, and the IAM-only publish mode already limits publishing to the runtime role. Add `export function onPublish(ctx) { return ctx.events; }` if you want the namespace to keep a gatekeeper should the auth mode change.

The `APPSYNC_JS` runtime accepts only the handler exports (`onPublish`, `onSubscribe`). Any other `export`, even a constant a test wants to read, invalidates the whole module with "Error processing APPSYNC_JS code" at deploy time *(observed)*. Keep constants unexported and have tests read them from the file text.

### 7.3 Subscribing from the client

Subscribe with the same Cognito token the client already uses. The protocol is a handful of messages, so a small hand-written client avoids pulling in a full SDK:

```ts
const auth = { Authorization: accessToken, host: httpEndpoint };
const socket = new WebSocket(`wss://${realtimeEndpoint}/event/realtime`, [
  'aws-appsync-event-ws',
  `header-${base64Url(JSON.stringify(auth))}`,
]);
const subscriptionId = crypto.randomUUID(); // never the channel path

socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));
socket.onmessage = (message) => {
  const payload = JSON.parse(String(message.data));
  if (payload.type === 'connection_ack') {
    keepaliveTimeoutMs = payload.connectionTimeoutMs ?? 300_000;
    socket.send(JSON.stringify({ type: 'subscribe', id: subscriptionId, channel, authorization: auth }));
  } else if (payload.type === 'subscribe_success') {
    listening = true;
    socket.onclose = socket.onerror = onLost;   // from here on, a close is a lost channel
    resetKeepalive();
  } else if (payload.type === 'data') {
    for (const raw of [].concat(payload.event ?? [])) onEvent(JSON.parse(raw));
  }
  if (listening) resetKeepalive();               // any message, including "ka", proves life
};
```

- A subscription id that contains the channel path is rejected with `UnsupportedOperation`, and the subscription never opens *(observed)*. Use `crypto.randomUUID()`.
- The WebSocket can die without a clean close *(observed: the server logged the unsubscribe without the disconnect, and the next turn's closing event went to a channel with no listener)*. After `subscribe_success`, keep watching `close`, `error` and the keepalive deadline that `connection_ack` announces (300 s). When any of them fires, reopen the channel (at most 3 times per screen load) and re-read the thread from the durable state, because whatever was published while nobody listened lives only there.
- If a turn has produced no event 15 s after sending (the soft notice from section 6), re-read the thread once. This covers a connection that died silently before the keepalive deadline expired. A re-read triggered by an event is not polling; there is no periodic fallback.

**Check** — the namespace handler exports only handlers, accepts only the owner's channel, and the subscription id is not the path. The handler is not a Node module, so the test strips the `export` keywords and injects a `util` that throws:

```ts
import { readFileSync } from 'node:fs';

const source = readFileSync('infra/threads-namespace-handler.js', 'utf8');

test('APPSYNC_JS handler exports only handlers', () => {
  const exported = [...source.matchAll(/^export\s+(?:const|function|let|class)\s+(\w+)/gm)].map((m) => m[1]);
  expect(exported.every((name) => ['onPublish', 'onSubscribe'].includes(name))).toBe(true);
});

class Unauthorized extends Error {}
const onSubscribe = new Function('util', `${source.replace(/^export /gm, '')}\nreturn onSubscribe;`)({
  unauthorized: () => { throw new Unauthorized(); },
});
const ctx = (path: string, sub: string) => ({ identity: { sub }, info: { channel: { path } } });

test.each(['/threads/u1/support', 'threads/u1/support/'])('owner may subscribe to %s', (path) => {
  expect(() => onSubscribe(ctx(path, 'u1'))).not.toThrow();
});

test.each(['/threads/u2/support', '/threads/u1', '/threads', '/threads/u1/*', '/other/u1/support'])(
  'rejects %s', (path) => {
    expect(() => onSubscribe(ctx(path, 'u1'))).toThrow(Unauthorized);
  });

test('subscribe message uses an opaque id', () => {
  const sent = captureSubscribeMessage(); // drive openThreadChannel against a fake WebSocket
  expect(sent.id).not.toContain('/');
  expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
});
```

## Section 8: Alternatives that were rejected

| Option | Why it lost |
|---|---|
| Raise the Lambda timeout | API Gateway still cuts the request at 29–30 s. |
| Keep the request open with SSE streaming | The run is lost when the app closes unless you persist state anyway, which is the hard part. Mobile `fetch` streaming was unreliable on the SDK in use. API Gateway streaming exists only on REST APIs. |
| AgentCore's HTTP response stream as the only channel | It dies with the connection, so it cannot survive the user leaving, and a second listener (a human operator) cannot join it. You cannot reattach to a stream in progress. |
| A Lambda that consumes the stream and forwards it | One more piece in the path, doing what the agent can publish itself. |
| API Gateway WebSocket | You build `$connect`/`$disconnect`, a connections table with expiry and cleanup, and dead-connection handling. No native Cognito authorizer, 10 min idle and 2 h max per connection. |
| AppSync GraphQL subscriptions | A full schema to carry a small progress message, at several times the cost per operation. |
| Polling every 2 s | Workable, but AppSync Events turned out lighter: native Cognito auth with the existing token, a stable CDK L2, and about 80 lines of client code. |
| SQS or Step Functions in front of the agent | The async agent already outlives its invoker and persists its result. An outage longer than the retry ceiling deserves an honest failure, not more retries. |
| Calling the runtime from the browser with SigV4 | Users never hold IAM credentials. A browser can call the runtime only in JWT mode, which is variant (a) in section 1. |

## Section 9: Thread memory and deletion

The default thread store is LangGraph's `DynamoDBSaver` from `langgraph-checkpoint-aws`, with a TTL on every item. The reasons for choosing it over AgentCore Memory are in section 6 of [`00-decisions.md`](./00-decisions.md).

```python
from langgraph_checkpoint_aws import DynamoDBSaver

# Built once per process: the saver holds a boto3 client, and building one per
# invocation pays credential resolution on every turn.
saver = DynamoDBSaver(
    table_name=config.thread_table,
    region_name=config.region,
    endpoint_url=config.dynamodb_endpoint,  # only for the local harness
    ttl_seconds=config.retention_days * 86_400,
)
graph = create_support_graph(config, checkpointer=saver)
```

- The package imposes the key schema (`PK` / `SK`) and writes the TTL attribute (`ttl`) on every item it creates; declare the same attribute in the table's `TimeToLiveSpecification`. Design anything else you put in that table with the [`dynamodb-design`](../../dynamodb-design/SKILL.md) skill, and give your own items a key prefix that cannot collide with the saver's (`CHECKPOINT_`, `CHUNK_`, `WRITES_`) and the same TTL.
- Read a thread through the graph (`graph.get_state(config)`), never by reading the saver's items. LangGraph stores channels as deltas: the latest checkpoint has empty `channel_values` and the conversation is spread across its parents, so a raw read returns an empty thread *(observed on 1.2.3)*. A thread that never existed and one that expired by TTL read the same way.
- Delete a thread with the saver's `delete_thread`, never with `DeleteItem` per row. One turn with an interrupt left 34 items across four key families *(observed)*; deleting them by hand is how a deletion stays half done without anyone noticing.
- Delete twice. A per-thread lock is a `threading.Lock` inside the runtime process, and a deletion Lambda does not share it, so a turn in flight can write its last checkpoint after the first delete. Delete when the event arrives, re-enqueue once with a delay longer than the hard cap from section 6 (for example 10 min with SQS `DelaySeconds`), and delete again; `delete_thread` on a missing thread is a no-op. TTL is not a deletion mechanism: DynamoDB removes expired items "within a few days".
- Keep pending human-confirmation state in a field of the graph state, and read it from there. `update_state` (for example, appending a message from a human operator) made the pending `Interrupt` disappear from the checkpoint *(observed)*. The node that parks the operation must have no side effects, because it runs again when the graph resumes.

**Check** — after both deletion passes, nothing of the thread remains (run against a deployed table in a smoke test):

```python
def test_thread_fully_erased(table_name, thread_id):
    erase_thread(thread_id)          # first pass
    erase_thread(thread_id)          # the delayed second pass, run immediately here
    assert graph.get_state({"configurable": {"thread_id": thread_id}}).values == {}
    items = scan_items_containing(table_name, thread_id)  # every key family, incl. your own prefixes
    assert items == []
```

## Verification

- `pytest` covers sections 2–7: the busy flag is released on failure, the event loop stays free with a 3 s blocking stub, a late write returns `False` and leaves the record untouched, nulls are dropped, permanent errors do not retry, transient errors stop at the ceiling.
- `jest` covers the namespace handler exports and the opaque subscription id.
- Against a deployed stage: invoke the runtime, close the client at once, and confirm the closing event still reaches a second subscriber and the result lands in the table. Then cancel a run mid-flight and confirm its late result is discarded.
- Watch the acknowledgement latency of the invoking Lambda (or the client's `POST`) in CloudWatch; anything above 1 s means something blocks the event loop (section 3).

## Further reading

- **Inside this skill:**
  - [`00-decisions.md`](./00-decisions.md) — choosing between waiting for the answer and fire-and-forget (section 5); `DynamoDBSaver` against AgentCore Memory (section 6).
  - [`01-runtime-and-deploy.md`](./01-runtime-and-deploy.md) — the sync entrypoint, startup rules per platform version, and the runtime IAM role.
  - [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) — session ids, the idle timeout rule, retries on session start, JWT and SigV4 callers, destroying the response stream, limits.
  - [`04-observability-and-evals.md`](./04-observability-and-evals.md) — `turn_timed_out` and `turn_failed` alarms, keeping secrets out of traces.
  - [`05-gotchas.md`](./05-gotchas.md) — symptom lookup.
- **Sibling skills:**
  - [`dynamodb-design`](../../dynamodb-design/SKILL.md) — conditional writes and optimistic locking (`references/03-write-correctness.md`), table design for the thread store.
  - [`aws-cdk-patterns`](../../aws-cdk-patterns/SKILL.md) — the Lambda and API Gateway in front of variant (b).
- **External documentation:**
  - [AgentCore long-running agents](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-long-run.html) — `add_async_task`, `complete_async_task`, `HealthyBusy`.
  - [AppSync Events: publishing over HTTP](https://docs.aws.amazon.com/appsync/latest/eventapi/publish-http.html) and [channel namespace handlers](https://docs.aws.amazon.com/appsync/latest/eventapi/channel-namespace-handlers.html).
  - [AppSync Events authorization](https://docs.aws.amazon.com/appsync/latest/eventapi/configure-event-api-auth.html).
  - [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html) — why TTL is not a deletion guarantee.
