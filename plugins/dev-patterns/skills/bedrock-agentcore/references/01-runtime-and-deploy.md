# Runtime and Deploy

**Builds:** A Python agent served by `BedrockAgentCoreApp`, packaged as a direct-code zip for Linux ARM64, and deployed as an AgentCore Runtime with CDK (L1 `CfnRuntime` or the L2 alpha construct), with a least-privilege execution role and an artifact key that changes with every commit.

**When to use:** Writing the agent's `main.py`, building the zip, writing or reviewing the CDK for the runtime and its role, wiring the deploy pipeline, or diagnosing a deploy that fails or a runtime that keeps serving old code.

**Prerequisites:** The choices in [`00-decisions.md`](./00-decisions.md) (direct code vs container, L1 vs L2, V1 vs V2) are made. The graph inside the agent is out of scope here; it is the territory of the `deepagents-builder` plugin.

> Verified on 2026-10-12 against `bedrock-agentcore` (Python SDK) 1.22.0, `aws-cdk-lib` 2.261, `@aws-cdk/aws-bedrock-agentcore-alpha` 2.250.0-alpha.0, `deepagents` 0.7.13. Facts marked *(observed)* were measured in production projects, not taken from AWS docs; re-check them when AWS changes the service.

## Contents

1. **Entrypoint skeleton** — `BedrockAgentCoreApp`, `@app.entrypoint`, one `main.py` for local and deployed.
2. **Startup rules** — fail-fast configuration, what runs at import on V1 and V2, secrets, credentials.
3. **Packaging the zip** — pinned requirements, ARM64 wheels, the SDK inside the zip, cache files, line endings, quotas.
4. **CDK construct** — L1 and L2 snippets, runtime name, `PlatformVersion`, environment variables.
5. **Execution role** — the role, its dependency, and one grant per real action.
6. **Artifact keying and deploy order** — why replacing the S3 object changes nothing, and where the bucket lives.
7. **CI** — template tests without bundling, the agent's own test lane.

---

## Section 1: Entrypoint skeleton

The SDK serves the two routes AgentCore calls: `POST /invocations` (one per call to `InvokeAgentRuntime`) and `GET /ping` (health). Your code defines only the entrypoint function. Port 8080 is the AgentCore contract; the port variable exists so a local harness starts this same file on a free port instead of serving its own copy of the contract.

```python
# main.py — synchronous variant.
# The async (fire-and-forget) variant is in section 2 of 03-long-turns-and-state.md.
import logging
import os

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from support_agent.configuration import read_configuration
from support_agent.secrets import ensure_secrets
from support_agent.service import build_agent

logging.basicConfig(level=logging.INFO)

configuration = read_configuration(os.environ)  # raises on a missing variable (section 2.1)
# Tracing starts here, right after the configuration (code in section 1 of 04-observability-and-evals.md).

_agent = None


def ensure_agent():
    global _agent
    if _agent is None:
        ensure_secrets()                       # section 2.3
        _agent = build_agent(configuration)    # model and AWS clients connect here, never at import (section 2.2)
    return _agent


app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload: dict, context) -> dict:
    # payload is {"prompt": "..."}; context.session_id is the runtimeSessionId the caller sent (section 2 of 02-invocation-and-sessions.md).
    # Identity comes from the authenticated request, never from the payload (section 6 of 02-invocation-and-sessions.md).
    return ensure_agent().respond(payload["prompt"], session_id=getattr(context, "session_id", None))


if __name__ == "__main__":
    app.run(port=int(os.environ.get("AGENT_PORT", "8080")))
```

**Check** (local smoke):

```bash
AGENT_PORT=8080 python main.py &
curl -fsS localhost:8080/ping
curl -fsS -X POST localhost:8080/invocations -H 'content-type: application/json' -d '{"prompt":"hello"}'
```

---

## Section 2: Startup rules

### 2.1 Configuration fails fast at import

Read and validate every environment variable at import. A process with a missing model id or table name then never answers `/ping` as healthy, and AgentCore never routes traffic to it. Failing at startup beats failing in front of a user.

```python
# support_agent/configuration.py
REQUIRED = ("AGENT_MODEL_ID", "THREAD_TABLE", "AGENT_VERSION")

def read_configuration(env) -> Configuration:
    missing = [name for name in REQUIRED if not env.get(name)]
    if missing:
        raise ValueError(f"missing environment variables: {', '.join(missing)}")
    return Configuration(model_id=env["AGENT_MODEL_ID"], thread_table=env["THREAD_TABLE"], agent_version=env["AGENT_VERSION"])
```

This function is the one list of required variables. Other references add to it: the OpenTelemetry content-capture and tracing variables (section 1 of [`04-observability-and-evals.md`](./04-observability-and-evals.md)) and the memory id when AgentCore Memory is chosen (section 6 of [`00-decisions.md`](./00-decisions.md)). Every variable, the `OTEL_*` ones included, counts toward the V2 1.5 KB limit in section 4.5.

**Check:** `pytest` calls `read_configuration({})` and asserts the `ValueError` names every missing variable.

### 2.2 What runs at import depends on the platform version

The platform version is chosen in [`00-decisions.md`](./00-decisions.md). Write the code for the one you deploy, in every stage.

- **V1:** import plus initialization must finish within 30 s or the session fails with `Runtime initialization time exceeded`. *(observed)* Importing `deepagents`/LangGraph and building the agent at module load crossed that limit; building the agent on the first invocation fixed it.
- **V2:** AgentCore snapshots the process after the first healthy `/ping` and restores that snapshot for each new session (AWS docs, "Optimize your agent for AgentCore Runtime V2"). Put heavy imports, configuration, and tracing setup at module scope so the snapshot carries them; *(observed)* creating the OpenTelemetry exporter at import works on V2 in production because it opens no connection. Nothing at import connects to the network or reads secrets or credentials: whatever exists at snapshot time is frozen and shared by every session, including AWS credentials that expire. `ensure_agent()` in section 1 does that work on the first invocation. *(observed)* A V2 agent that deferred everything, imports included, to the first invocation (a habit carried over from V1) got no benefit from the snapshot.

**Check** (pytest; import with the network blocked, which also blocks secret reads and IMDS credentials):

```python
def test_importing_main_opens_no_connection_and_builds_no_agent():
    probe = (
        "import os, socket\n"
        "def refuse(*a, **k): raise AssertionError('network touched at import')\n"
        "socket.socket.connect = socket.socket.connect_ex = refuse\n"
        "import main\n"
        "assert main._agent is None\n"
        "assert 'MODEL_API_KEY' not in os.environ\n"
    )
    env = {k: v for k, v in os.environ.items() if k not in ("MODEL_API_KEY", "PYTHONPATH")}
    env |= {"PYTHONPATH": str(SRC), "MODEL_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:x", **REQUIRED_ENV}
    result = subprocess.run([sys.executable, "-c", probe], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
```

### 2.3 Secrets

Environment variables carry the secret's ARN, never its value. The agent reads the secret on the first invocation. A variable already set wins, so local runs use a plain environment variable and skip Secrets Manager.

*(observed)* AgentCore does not always set `AWS_REGION`, and a client built without a region fails with `NoRegionError`. Take the region from `AWS_REGION`, then `AWS_DEFAULT_REGION`, then the ARN itself.

```python
# support_agent/secrets.py
def ensure_secrets() -> None:
    _ensure_secret("MODEL_API_KEY", "MODEL_SECRET_ARN")   # one call per secret the agent needs


def _ensure_secret(value_var: str, arn_var: str) -> None:
    if os.environ.get(value_var):
        return
    secret_arn = os.environ.get(arn_var)
    if not secret_arn:
        return
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or secret_arn.split(":")[3]
    client = boto3.client("secretsmanager", region_name=region)
    os.environ[value_var] = client.get_secret_value(SecretId=secret_arn)["SecretString"]
```

**Check:** a moto test with `AWS_REGION` and `AWS_DEFAULT_REGION` unset asserts the value is read using the ARN's region.

### 2.4 Credentials

*(observed)* The execution role's credentials reach the direct-code process through IMDS: the environment has neither `AWS_ACCESS_KEY_ID` nor `AWS_CONTAINER_CREDENTIALS_*`. boto3's default credential chain finds them. Code that signs requests by reading `AWS_ACCESS_KEY_ID` gets nothing; use `boto3.Session().get_credentials()`.

---

## Section 3: Packaging the zip

The artifact is a zip with `main.py`, your package, and every dependency, built for the runtime's platform: Linux ARM64, Python 3.13.

### 3.1 Pin dependencies from the lock file

The zip must hold the same dependency tree the test suite ran with. Export `requirements.txt` from the lock instead of keeping a hand-written list of `>=` ranges next to `uv.lock`; a hand-kept list drifts (a dependency declared in `pyproject.toml` silently missing from the zip, or a newer minor arriving on deploy day).

```bash
uv export --format requirements-txt --no-hashes --no-dev --no-emit-project --frozen -o requirements.txt
```

Libraries that must move together (the SDK, the agent framework, the checkpointer, the OpenTelemetry distro) are upgraded in one commit.

**Check** (CI): `uv export --format requirements-txt --no-hashes --no-dev --no-emit-project --frozen | diff - requirements.txt`

### 3.2 Install wheels for the runtime's platform

Without `--platform`, pip installs wheels for the build machine, and the process crashes on `import pydantic_core` once deployed. Without `--only-binary=:all:`, pip compiles missing wheels for the build machine and the failure appears only after deploy.

```bash
pip install -r requirements.txt --target dist \
  --platform manylinux2014_aarch64 --python-version 3.13 --only-binary=:all:
# uv equivalent:
uv pip install -r requirements.txt --target dist \
  --python-platform aarch64-manylinux2014 --python-version 3.13 --only-binary=:all:
```

*(observed)* The direct-code runtime does not ship `botocore`: `import botocore` raises `ImportError`. `boto3` and `botocore` must be inside the zip. They arrive as dependencies of `bedrock-agentcore`; the check in section 3.4 keeps it that way.

### 3.3 Keep cache files and CRLF out

*(observed)* Local `pytest` leaves `__pycache__` built for the developer's machine under the source tree, and the deploy fails with `UPDATE_FAILED … incompatible Python cache files`. Exclude `__pycache__` and `*.pyc` from the copy.

A checkout on Windows can turn Python files into CRLF. Pin LF in the agent's `.gitattributes`:

```gitattributes
*.py text eol=lf
*.txt text eol=lf
```

### 3.4 Check both quotas before upload

The direct-code artifact has two quotas, neither adjustable (AWS docs, "AgentCore Runtime Service Quotas"): 250 MB zipped and 750 MB unzipped. *(observed)* A `deepagents` tree compresses about 2.75×, so the unzipped quota is the one that bites first, and the zip size alone does not show it. Check both while building: after the upload, the one who finds out is `CreateAgentRuntime`, with the environment already half-changed.

```python
# build.py (excerpt)
COMPRESSED_LIMIT = 250_000_000
UNCOMPRESSED_LIMIT = 750_000_000

def build() -> Path:
    shutil.rmtree(DIST, ignore_errors=True); DIST.mkdir(parents=True)
    install(HERE / "requirements.txt", DIST)                       # command from section 3.2
    shutil.copy2(HERE / "main.py", DIST / "main.py")
    shutil.copytree(HERE / "support_agent", DIST / "support_agent", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    uncompressed = zip_tree(DIST, ARCHIVE)                          # returns the sum of file sizes
    check_quota(compressed=ARCHIVE.stat().st_size, uncompressed=uncompressed)
    return ARCHIVE

def check_quota(compressed: int, uncompressed: int) -> None:
    if compressed > COMPRESSED_LIMIT:
        raise ArtifactTooLarge(f"zip is {compressed / 1e6:.1f} MB; quota is 250 MB zipped")
    if uncompressed > UNCOMPRESSED_LIMIT:
        raise ArtifactTooLarge(f"zip is {uncompressed / 1e6:.1f} MB unzipped; quota is 750 MB")
```

*(observed)* A `deepagents` + `langchain-aws` + `langgraph-checkpoint-aws` tree measured 73 MB zipped and 202 MB unzipped; adding `aws-opentelemetry-distro` took it to 86 MB and 236 MB. The distro's roughly 13 MB are instrumentors the agent may not use; trimming them is the first lever if the artifact gets tight.

**Checks:**

```bash
python build.py
unzip -l dist.zip | grep -E '__pycache__|\.pyc$' && exit 1     # no cache files
unzip -l dist.zip | grep -q ' botocore/' || exit 1              # SDK is inside the zip
git ls-files --eol -- '*.py' | grep -v 'i/lf' && exit 1         # every Python file is LF in the index
```

Plus pytest cases that call `check_quota` one byte over each limit and assert `ArtifactTooLarge`.

---

## Section 4: CDK construct

### 4.1 L1 `CfnRuntime` (zip uploaded outside CDK)

```ts
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';

const runtime = new bedrockagentcore.CfnRuntime(this, 'SupportAgentRuntime', {
  agentRuntimeName: `support_agent_${envSuffix.replace(/[^A-Za-z0-9]/g, '_')}`,
  agentRuntimeArtifact: {
    codeConfiguration: {
      code: { s3: { bucket: codeBucket.bucketName, prefix: codeObjectKey } },  // a new key per commit (section 6)
      runtime: 'PYTHON_3_13',
      entryPoint: ['main.py'],
    },
  },
  networkConfiguration: { networkMode: 'PUBLIC' },
  protocolConfiguration: 'HTTP',
  roleArn: role.roleArn,
  lifecycleConfiguration: { idleRuntimeSessionTimeout: idleSeconds },        // values: section 3 of 02-invocation-and-sessions.md
  authorizerConfiguration: { customJwtAuthorizer: { discoveryUrl, allowedClients: [appClientId] } },  // rules: section 6 of 02
  requestHeaderConfiguration: { requestHeaderAllowlist: ['Authorization'] }, // why: section 6 of 02
  environmentVariables: {
    AGENT_MODEL_ID: modelId,
    THREAD_TABLE: threadTable.tableName,
    MODEL_SECRET_ARN: modelSecret.secretArn,   // the ARN, never the value
    AGENT_VERSION: codeObjectKey,              // a trace then says which code served it
  },
});
runtime.addPropertyOverride('PlatformVersion', 'V2');   // section 4.4
runtime.node.addDependency(role);                       // section 5
```

### 4.2 L2 alpha with a CDK-bundled code asset

The L2 construct builds and uploads the zip itself, and the asset hash changes the key whenever the code changes (section 6). Bundling prefers a local `uv` and falls back to a Docker ARM64 build image.

```ts
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

export function includeInArtifact(src: string): boolean {
  return !src.split(path.sep).includes('__pycache__') && !src.endsWith('.pyc');
}

const artifact = agentcore.AgentRuntimeArtifact.fromCodeAsset({
  path: sourceDir,
  runtime: agentcore.AgentCoreRuntime.PYTHON_3_13,
  entrypoint: ['main.py'],
  bundling: {
    image: cdk.DockerImage.fromRegistry('public.ecr.aws/sam/build-python3.13:latest-arm64'),
    command: ['bash', '-c', 'pip install --no-cache-dir -r requirements.txt -t /asset-output && cp -r . /asset-output && find /asset-output -name __pycache__ -type d -prune -exec rm -rf {} +'],
    local: {
      tryBundle(outputDir: string): boolean {
        try { execSync('uv --version', { stdio: 'pipe' }); } catch { return false; }  // fall back to Docker
        execSync(`uv pip install --python-platform aarch64-manylinux2014 --python-version 3.13 --target "${outputDir}" --only-binary=:all: -r "${requirementsPath}"`, { stdio: 'inherit' });
        fs.cpSync(sourceDir, outputDir, { recursive: true, filter: includeInArtifact });
        return true;
      },
    },
  },
});

const runtime = new agentcore.Runtime(this, 'Runtime', {
  runtimeName: `support_agent_${stage.replace(/[^A-Za-z0-9]/g, '_')}`,
  agentRuntimeArtifact: artifact,
  executionRole: role,                                   // section 5
  environmentVariables: {
    AGENT_MODEL_ID: modelId,
    THREAD_TABLE: table.tableName,
    MODEL_SECRET_ARN: modelSecret.secretArn,
    AGENT_VERSION: commitSha,                            // passed as CDK context
  },
  lifecycleConfiguration: { idleRuntimeSessionTimeout: cdk.Duration.seconds(idleSeconds) },     // values: section 3 of 02
  authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(userPool, [appClient]),  // rules: section 6 of 02
  requestHeaderConfiguration: { allowlistedHeaders: ['Authorization'] },                         // why: section 6 of 02
});
(runtime.node.defaultChild as cdk.CfnResource).addPropertyOverride('PlatformVersion', 'V2');  // section 4.4
runtime.node.addDependency(role);                                                              // section 5
```

The L2 types every field above except `PlatformVersion`; `usingJWT(discoveryUrl, allowedClients)` replaces `usingCognito` for a non-Cognito issuer. Read the runtime's ARN and id from `runtime.agentRuntimeArn` and `runtime.agentRuntimeId` (on the L1: `attrAgentRuntimeArn` and `attrAgentRuntimeId`). `Runtime` is grantable: `table.grantReadWriteData(runtime)` and `secret.grantRead(runtime.role)` attach to its role.

### 4.3 Runtime name

AgentCore accepts letters, digits, and underscores only. A hyphen is rejected by the deploy, not by `cdk synth`, so derive the name with `replace(/[^A-Za-z0-9]/g, '_')` from any stage or suffix that may carry a hyphen.

### 4.4 `PlatformVersion`

Neither `CfnRuntime` (`aws-cdk-lib` 2.261) nor the L2 alpha (2.250.0-alpha.0) types `PlatformVersion`, so V2 is set with `addPropertyOverride`; it is the only runtime property that needs an override. The AWS docs (2026-10-12) say CloudFormation and CDK do not support `platformVersion` yet, but two production projects deployed V2 through this override *(observed)*. V1 is the service default. V2 is offered in us-east-1, us-east-2, us-west-2, eu-west-1 and ap-northeast-1, and the process must report healthy on `/ping` within 120 s. Remove the override once the construct exposes it.

`aws bedrock-agentcore-control get-agent-runtime` does not return the platform version *(observed)*. Verify it in the synthesized template or the deployed CloudFormation template, never by reading CI logs:

```bash
aws cloudformation get-template --stack-name "$STACK" --query 'TemplateBody' --output json | grep -o '"PlatformVersion": *"V2"'
```

*(observed)* A V2 runtime logs `WARNING: Invalid HTTP request received.` on every invocation; it does not affect the turn.

### 4.5 Environment variables

Variables carry identifiers and ARNs: model id, table name, secret ARN, artifact key. Secret values go through section 2.3.

V2 limits a direct-code runtime's environment variables to 1.5 KB (1,536 bytes) in total; container agents get 2.5 KB and V1 gets 4 KB (AWS docs, 2026-10-12). `cdk synth` does not catch an overflow; the deploy does. Measure each stage in a template test, with every intrinsic (`Ref`, `Fn::GetAtt`, `Fn::Join`, pseudo-parameters) resolved to its longest plausible length (255 bytes for an unresolved attribute).

**Checks** (jest, `aws-cdk-lib/assertions`):

```ts
const [runtime] = Object.values(template.findResources('AWS::BedrockAgentCore::Runtime')) as any[];

test('runtime name is letters, digits and underscores', () => {
  expect(runtime.Properties.AgentRuntimeName).toMatch(/^[A-Za-z0-9_]+$/);
});

test.each(STAGES)('runs on V2 in %s', (stage) => {
  synth(stage).hasResourceProperties('AWS::BedrockAgentCore::Runtime', { PlatformVersion: 'V2' });
});

test.each(STAGES)('environment variables fit in 1.5 KB in %s', (stage) => {
  const [r] = Object.values(synth(stage).findResources('AWS::BedrockAgentCore::Runtime')) as any[];
  expect(envVarBytes(r.Properties.EnvironmentVariables)).toBeLessThanOrEqual(1536);  // envVarBytes resolves intrinsics pessimistically
});
```

---

## Section 5: Execution role

Declare the role explicitly, assumed by `bedrock-agentcore.amazonaws.com`, and give it one grant per action the agent really performs. A prompt injection can then reach nothing beyond the agent's own thread.

```ts
const role = new iam.Role(this, 'SupportAgentRuntimeRole', {
  assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
});
role.addToPolicy(new iam.PolicyStatement({
  actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
  resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`],
}));
role.addToPolicy(new iam.PolicyStatement({          // its own object, not the bucket
  actions: ['s3:GetObject'],
  resources: [codeBucket.arnForObjects(codeObjectKey)],
}));
role.addToPolicy(new iam.PolicyStatement({          // the profile AND the models it routes to, in every region
  actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
  resources: [
    `arn:aws:bedrock:*:${this.account}:inference-profile/${modelId}`,
    'arn:aws:bedrock:*::foundation-model/*',
  ],
}));
threadTable.grantReadWriteData(role);                // one grant per real write
// Tracing permissions (X-Ray, logs resource policy, PutMetricData): section 2 of 04-observability-and-evals.md
runtime.node.addDependency(role);
```

- **`addDependency(role)`, on both constructs whenever you pass your own role:** `roleArn` (L1) or `executionRole` (L2) makes the runtime depend on the role, but the role's policy is a separate resource that CloudFormation creates in parallel. AgentCore validates at creation that the role can fetch the artifact, so without the dependency the first deploy fails. *(observed)* With an image artifact the message was `Access denied while validating ECR URI`; direct code goes through the same validation.
- **Model permissions:** a cross-region inference profile routes to foundation models in several regions; grant the profile ARN and the foundation-model ARNs in every region the profile can route to, or calls fail with `AccessDenied` once routed outside the home region.
- **Permissions to invoke this runtime** belong to the caller's role, not this one: section 8 of [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md).

**Checks** (jest):

```ts
test('runtime waits for the role policy, not only the role', () => {
  expect(runtime.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/RuntimeRoleDefaultPolicy/)]));
});

test('role reads only its own code object', () => {
  const getObject = allStatements(template).filter((s) => [s.Action].flat().includes('s3:GetObject'));
  expect(JSON.stringify(getObject)).not.toMatch(/\/\*"/);   // no bucket-wide wildcard
});
```

---

## Section 6: Artifact keying and deploy order

AgentCore reads the artifact when it creates or updates the runtime and keeps that copy. Replacing the S3 object under the same key changes nothing: the runtime keeps serving the old code. A new version needs a new key.

Two ways to get one:

- **CDK asset (L2, section 4.2):** the asset hash is part of the key, so a code change produces a new key and CloudFormation updates the runtime.
- **Out-of-band upload (L1, section 4.1):** build and upload to a key that contains the commit sha, then pass the key as CDK context.

```bash
# Deploy pipeline, after the stack that owns the bucket is deployed
python agent/build.py
AGENT_CODE_OBJECT_KEY="agent/support-agent-$GITHUB_SHA.zip"
aws s3 cp agent/dist.zip "s3://$AGENT_CODE_BUCKET/$AGENT_CODE_OBJECT_KEY"
aws s3api head-object --bucket "$AGENT_CODE_BUCKET" --key "$AGENT_CODE_OBJECT_KEY" > /dev/null
npx cdk deploy "AgentStack-$ENV" -c agentCodeObjectKey="$AGENT_CODE_OBJECT_KEY" --require-approval never
```

The object must exist before the runtime names it. Put the bucket in a stack deployed earlier (a shared stack), not inside the agent stack behind a condition on the key: there it cannot exist on the first deploy, so there is nowhere to upload the zip. Give the bucket a predictable name so the CI role's upload policy can name that one bucket. Export the bucket name and ARN unconditionally, because the shared stack is synthesized without the agent stack consuming them; a conditional export gets removed while still in use (see the `Export … in use` row in [`aws-cdk-patterns/references/04-database.md`](../../aws-cdk-patterns/references/04-database.md)).

*(observed)* Deleting a runtime leaves its log group behind with indefinite retention; retention is set in section 4 of [`04-observability-and-evals.md`](./04-observability-and-evals.md).

---

## Section 7: CI

- **Template tests skip bundling.** A test that calls `Template.fromStack` on a stack with a code asset runs the uv or Docker bundle. Skip it in tests that only inspect templates: `new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })`.
- **The bundling construct test runs off the fast lane.** The one test that really bundles the asset takes about a minute; run it in its own job or before release, not on every PR.
- **The agent has its own test lane.** The Python suite never runs inside the backend's jest run. Give it a job that triggers on the agent's path and installs exactly what the lock pins: `uv sync --locked` then `uv run --no-sync pytest`. `--locked` fails instead of re-resolving.
- **The lock check runs in that lane** (section 3.1), together with the build and the zip checks from section 3.4.
- **Retiring resources across stacks takes two deploys:** first stop consuming, then remove the producer (gotchas table of [`aws-cdk-patterns/references/04-database.md`](../../aws-cdk-patterns/references/04-database.md)).

---

## Verification

```bash
# 1. Agent suite, exactly as locked
uv sync --locked && uv run --no-sync pytest

# 2. Lock and requirements agree
uv export --format requirements-txt --no-hashes --no-dev --no-emit-project --frozen | diff - requirements.txt

# 3. Build, then inspect the zip
python build.py
unzip -l dist.zip | grep -E '__pycache__|\.pyc$' && echo "cache files in zip" && exit 1
unzip -l dist.zip | grep -q ' botocore/' || { echo "botocore missing"; exit 1; }

# 4. Template tests (name, PlatformVersion, env var size, DependsOn, role scope)
npx jest --testPathPattern runtime

# 5. After deploy: V2 really applied, runtime READY
aws cloudformation get-template --stack-name "$STACK" --query TemplateBody --output json | grep -q '"PlatformVersion": *"V2"'
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RUNTIME_ID" --query status
```

Invoking the deployed runtime end to end is the smoke test in section 7 of [`04-observability-and-evals.md`](./04-observability-and-evals.md).

## Further reading

- **Inside this skill:**
  - [`00-decisions.md`](./00-decisions.md) — direct code vs container, L1 vs L2, V1 vs V2, model provider.
  - [`02-invocation-and-sessions.md`](./02-invocation-and-sessions.md) — session id, idle timeout values, JWT authorizer rules, caller permissions, limits.
  - [`03-long-turns-and-state.md`](./03-long-turns-and-state.md) — the async entrypoint variant and the checkpointer table.
  - [`04-observability-and-evals.md`](./04-observability-and-evals.md) — tracing permissions, log retention, alarms, smoke and evals.
  - [`05-gotchas.md`](./05-gotchas.md) — symptom-first lookup.
- **Sibling skills:**
  - [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md) — stages, suffixes, pre-deploy checklist.
  - [`aws-cdk-patterns/references/04-database.md`](../../aws-cdk-patterns/references/04-database.md) — the cross-stack export gotcha.
- **External documentation:**
  - [AgentCore Runtime developer guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html) — entrypoint contract, direct code deployment, quotas.
  - [AgentCore Runtime service quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html) — the 250 MB and 750 MB artifact quotas.
  - [`AWS::BedrockAgentCore::Runtime` CloudFormation reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrockagentcore-runtime.html) — properties, including the ones CDK does not type yet.
