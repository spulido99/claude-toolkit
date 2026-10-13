---
name: bedrock-agentcore
description: Use when building or running an agent on Amazon Bedrock AgentCore Runtime — choosing which AgentCore services to adopt, packaging and deploying the runtime with CDK, invoking it from an app or backend (runtimeSessionId, Cognito JWT, SigV4), running turns longer than API Gateway allows with live progress, tracing and evaluating the deployed runtime, or diagnosing AgentCore deploy and invocation errors.
---

# Bedrock AgentCore

Reference skill for running a Python agent (LangGraph or deepagents) on Amazon Bedrock AgentCore Runtime: what to adopt from AgentCore, how to package and deploy it, how clients call it, how long turns report progress, and how to trace and evaluate it. Facts marked *(observed)* were measured in production projects, not taken from AWS documentation.

## When to load each reference

| Task | Reference file |
|------|----------------|
| Starting a new agent on AgentCore, or choosing between zip and container, L1 and L2 constructs, AgentCore Memory and your own checkpointer, Bedrock and a provider API | `references/00-decisions.md` (required for a new project) |
| Writing `main.py`, packaging the zip, the CDK runtime construct, the runtime IAM role, deploy order in CI | `references/01-runtime-and-deploy.md` |
| Calling the runtime from an app or a backend: `runtimeSessionId`, idle timeout, Cognito JWT authorizer, SigV4, retries, limits | `references/02-invocation-and-sessions.md` |
| Turns longer than API Gateway's 29–30 s, fire-and-forget handlers, live progress over AppSync Events, thread memory | `references/03-long-turns-and-state.md` |
| Traces, alarms, evals against the deployed runtime, smoke tests | `references/04-observability-and-evals.md` |
| Diagnosing an AgentCore error or surprising behavior | `references/05-gotchas.md` |

## Cross-cutting principles

Each rule is explained in the reference it points to:

- Before building any piece around the agent (thread memory, identity, tool access, observability, evals, policies), check whether AgentCore offers it, and build your own only with the reason written in an ADR. See section 1 of `00-decisions.md`.
- Derive `runtimeSessionId` from the conversation (33 characters or more) and reuse it on every call: a new id means a new microVM and a cold start. See `02-invocation-and-sessions.md`.
- Take the caller's identity from the authenticated token and pass it to tools through configuration, never through the payload, the session id, or the prompt. See `02-invocation-and-sessions.md`.
- Upload every artifact under a new key: the runtime keeps the artifact it read when it was created. See `01-runtime-and-deploy.md`.
- Set `idleRuntimeSessionTimeout` on purpose: idle microVMs are billed, and background work that is not registered as a task counts as idle. See `02-invocation-and-sessions.md`.
- Run CI evals against the deployed runtime through real authentication. See `04-observability-and-evals.md`.
- AgentCore changes fast: before relying on a limit, quota, or "not supported", re-check the dated line at the top of the reference against the AWS documentation.

## Scope

This skill covers AgentCore Runtime and the services around it. Neighbouring topics live elsewhere:

- Agent design inside the graph (prompts, tools, topology, eval scenarios): the `deepagents-builder` plugin.
- General CDK (Lambda, API Gateway, Cognito, deploy workflow): sibling skill `aws-cdk-patterns`.
- The checkpoint table and any other DynamoDB schema: sibling skill `dynamodb-design`.
- Claude model ids and request parameters: the `claude-api` skill.

## Conventions

- Agent code is Python 3.13 with the `bedrock-agentcore` SDK; infrastructure is AWS CDK in TypeScript; client examples are TypeScript.
- Each reference pins its verification date and the versions it was checked against.
- Every mechanical rule ships with a check (pytest, jest, or shell). The assertion is meant to be copied; fixtures such as a fake table or clock belong to your project.
