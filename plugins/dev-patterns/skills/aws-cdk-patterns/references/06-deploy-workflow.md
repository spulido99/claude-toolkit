# Deploy Workflow

**Builds:** A repeatable CDK deploy workflow covering the mandatory pre-deploy checklist, the stage/suffix naming system that isolates developer environments, a stack separation decision tree, the two-stack deploy sequence, CloudFront domain registration, binary `isProd` configuration branching, basic rollback, a Windows/PowerShell pager note, and a catalog of common failure modes.
**When to use:** Before deploying any CDK stack to any environment (dev, staging, prod). Use as the reference for setting `stage` and `suffix` context values, deciding how to split stacks, ordering build and deploy steps, and diagnosing common deploy errors.
**Prerequisites:** `00-architecture.md` (stack overview and cross-stack reference patterns), `03-static-site.md` (CloudFront distribution and domain registration details).

## Contents

1. **Pre-deploy checklist (mandatory)** — Four required steps before every deploy: diff review, profile verification, secrets check, and git state.
2. **Stage and suffix system** — How `stage` and `suffix` context values compose stack names, why dev requires a suffix, and the `bin/app.ts` validation.
3. **Stack separation decision tree** — When stateful/stateless separation applies (instance-backed resources only) versus when a single backend stack is correct.
4. **Two-stack deploy workflow** — Build ordering, full deploy command, per-stack deploy commands, and why `dist/` must exist before synth.
5. **CloudFront domain registration** — When to trigger, the two-deploy sequence, and how the domain propagates to CORS and Cognito callbacks.
6. **Binary isProd branching** — Concrete `isProd` flag pattern for Lambda, log retention, and database configuration; when a second tier is justified.
7. **Rollback** — Basic rollback via deploy tags and `git checkout`; pre-conditions, schema caveats, and snapshot discipline.
8. **Windows / PowerShell note** — AWS CLI pager hang in Git Bash and how to suppress it.
9. **Gotchas catalog** — Seven common failure modes with root cause and fix.
10. **Further reading** — CDK CLI docs, context docs, CodeDeploy reference, and sibling files.

## Section 1: Pre-deploy checklist (mandatory)

Run all four steps before every deploy. These are mandatory, not suggested.

### Step 1 — Run `cdk diff`

Review every affected resource before applying changes:

```bash
cdk diff --all -c stage=<stage> -c suffix=<suffix> --profile <project>
```

Look for:

- **Replacements** — Any replacement of a stateful resource (Aurora cluster, RDS instance, Cognito User Pool, OpenSearch domain) must be intentional. CDK marks these with `[~] Replace` in the diff output. If a replacement is unexpected, stop and investigate before proceeding.
- **Deletions** — Review all `[-]` lines. A deleted resource may have data attached.
- **New IAM permissions** — Every new `Allow` statement in the diff warrants a read. Over-permissive policies introduced here compound over time.
- **Security group changes** — Inbound and outbound rule changes affect network exposure. Confirm the change is intentional.

### Step 2 — Verify `--profile <project>` is set

Never deploy using the default AWS profile. The default profile may point to a different account than intended:

```bash
echo $AWS_PROFILE
aws sts get-caller-identity --profile <project>
```

Confirm the returned `Account` and `Arn` match the target environment before continuing.

### Step 3 — Verify no hardcoded secrets appear in the diff

Scan the `cdk diff` output for any literal secret values. Secrets must appear only as Secrets Manager ARN references — never as plain strings embedded in Lambda environment variables or CloudFormation parameters.

If a literal password, API key, or token appears in the diff, stop the deploy. Identify how the value entered the CDK source, replace it with a Secrets Manager reference, re-diff, and confirm the value is gone before deploying.

### Step 4 — Verify git state

Confirm the working tree is clean or intentionally dirty with awareness of what is staged. Tag every deploy so rollback targets are easy to locate:

```bash
git status
git tag -a deploy-<stage>-<suffix>-$(date +%Y%m%d-%H%M%S) -m "Known-good deploy"
```

Keep at least five recent deploy tags per stage. Push tags to the remote so the team shares the rollback history.

## Section 2: Stage and suffix system

### Stages

Three valid stages: `dev`, `staging`, `prod`.

- `dev` — Individual developer environments. Requires a `suffix` so concurrent developers can deploy without colliding on stack names and resource names.
- `staging` — Single shared pre-production environment. No suffix.
- `prod` — Single production environment. No suffix.

### How suffix composes names

The suffix becomes part of every stack name and every resource name. A deploy with `stage=dev suffix=alice` creates:

- Stack: `App-BackendStack-dev-alice`
- DynamoDB table: `orders-dev-alice`
- Cognito User Pool name: `app-dev-alice`
- S3 bucket prefix: `app-frontend-dev-alice`

Two developers working on the same branch can both deploy without overwriting each other. PR preview environments are trivial to create and destroy using the PR number as the suffix.

### Validation in `bin/app.ts`

Enforce stage and suffix rules at synth time so invalid combinations fail immediately:

```typescript
const stage = app.node.tryGetContext("stage");
const suffix = app.node.tryGetContext("suffix");

if (!["dev", "staging", "prod"].includes(stage)) {
  throw new Error(`Invalid stage: ${stage}. Must be dev, staging, or prod.`);
}
if (stage === "dev" && !suffix) {
  throw new Error("Dev deployments require -c suffix=<name>");
}
if (stage !== "dev" && suffix) {
  throw new Error("Suffix only allowed for dev stage");
}

const stackSuffix = stage === "dev" ? `${stage}-${suffix}` : stage;

new BackendStack(app, `App-BackendStack-${stackSuffix}`, { stage, suffix });
new FrontendStack(app, `App-FrontendStack-${stackSuffix}`, {
  stage,
  suffix,
  // pass backend outputs via stack reference or SSM
});
```

## Section 3: Stack separation decision tree

### When stateful/stateless separation applies

Separate stacks only when the backend contains instance-backed resources:

- Aurora Serverless v2 or RDS instances
- OpenSearch Domain (instance-backed, not serverless)
- ElastiCache cluster (Memcached or Redis)
- EC2 instances

For these architectures, split into two stacks:

- `StatefulStack` — Aurora cluster, RDS instances, OpenSearch domain, ElastiCache cluster. Deploy rarely. Change carefully.
- `StatelessStack` — Lambdas, API Gateway, Cognito (if not shared state), CloudFront. Deploy freely.

Separating compute from stateful resources prevents accidental replacement of a database when a compute change triggers a stack update. CDK cannot replace a running Aurora cluster and silently leave it intact — a replacement is a new cluster with an empty schema.

### When separation does NOT apply

100% serverless architectures (DynamoDB + Lambda + API Gateway + Cognito + S3 + Secrets Manager + EventBridge) do not need stateful/stateless separation. All these resources are AWS-managed at the service level — there is no instance to accidentally replace. Group them in a single `BackendStack`.

### Typical split for serverless projects

- `BackendStack` — Cognito, API Gateway, Lambdas, DynamoDB tables, EventBridge, Secrets Manager references. All together, no harm in grouping.
- `FrontendStack` — S3 bucket, CloudFront distribution, `config.json` upload. Separate because the ACM certificate must live in `us-east-1` regardless of the backend region, and the frontend has a distinct deployment lifecycle from the backend.

Cross-reference: `00-architecture.md` Section 4 for stack dependency patterns and cross-stack output references.

## Section 4: Two-stack deploy workflow

Deploy order: build the frontend first, then deploy both stacks. `FrontendStack` depends on `BackendStack` outputs, and `s3-deployment.BucketDeployment` expects `dist/` to exist as a bundled asset at synth time.

### Full deploy (recommended)

```bash
# Build the frontend so dist/ exists before CDK synth resolves assets.
cd frontend && npm run build && cd ..

# Deploy both stacks. CDK resolves dependency order automatically.
cdk deploy --all -c stage=dev -c suffix=alice --profile <project>
```

CDK infers deployment order from cross-stack references. `FrontendStack` references `BackendStack` outputs (API URL, Cognito User Pool ID, Cognito App Client ID), so CDK always deploys `BackendStack` first.

### Per-stack deploy (when only one stack changed)

```bash
# Backend only.
cdk deploy App-BackendStack-dev-alice -c stage=dev -c suffix=alice --profile <project>

# Frontend only (requires dist/ to be built first).
cd frontend && npm run build && cd ..
cdk deploy App-FrontendStack-dev-alice -c stage=dev -c suffix=alice --profile <project>
```

### Why build before deploy

`s3-deployment.BucketDeployment` resolves `dist/` as a CDK asset during `cdk synth`. If `dist/` is absent or empty when `cdk deploy` runs (which internally runs synth), the asset bundling either fails with "Cannot find asset" or uploads an empty directory silently. Build first, every time.

## Section 5: CloudFront domain registration

Full workflow is in `03-static-site.md` Section 3. This section covers when to trigger and how it fits into the deploy sequence.

### When to trigger

- After the first deploy of any new stage/suffix combination.
- After the CloudFront distribution is recreated (e.g., after a distribution replacement forced by a change to the `S3Origin`).

### Two-deploy sequence

1. **First deploy** — `cdk deploy --all` completes. Note the CloudFront domain from `App-FrontendStack-<stackSuffix>` stack outputs (e.g., `d1abc2defgh3ij.cloudfront.net`).
2. **Register domain** — Add the domain to `cdk.json` under `context.cloudfrontDomains[<stackSuffix>]`.
3. **Second deploy** — `cdk deploy --all` re-runs. `BackendStack` reads the registered domain and sets it as an allowed CORS origin on API Gateway and as a callback/logout URL in the Cognito App Client.
4. **Commit `cdk.json`** — The domain registration is infrastructure state. Commit it so team members and CI/CD pipelines pick it up.

### Expected behavior on first deploy

Auth and CORS will fail after the first deploy of a new environment. This is expected. The CloudFront domain does not exist until after the first deploy, so it cannot be registered before it. The second deploy resolves the issue. Document this two-deploy requirement in team runbooks.

## Section 6: Binary isProd branching

Use a single `isProd` boolean derived from `props.stage`. Avoid staging-specific branches unless there is a documented regulatory reason.

```typescript
const isProd = props.stage === "prod";

const lambdaConfig = {
  memorySize: isProd ? 1024 : 256,
  timeout: cdk.Duration.seconds(isProd ? 30 : 10),
  retentionDays: isProd
    ? logs.RetentionDays.SIX_MONTHS
    : logs.RetentionDays.ONE_WEEK,
};

const dbConfig = {
  backupRetention: isProd ? cdk.Duration.days(30) : cdk.Duration.days(1),
  deletionProtection: isProd,
  removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
  minCapacity: 0,        // always scale-to-zero in dev and staging
  maxCapacity: isProd ? 16 : 2,
};
```

### Why binary

Staging environments that try to mirror prod via a separate `isStaging` branch get out of sync. The staging configuration diverges silently from prod because changes to the prod branch get applied, but staging-specific overrides accumulate and are never reviewed.

If staging must truly match prod for SOC2 audit parity or similar compliance requirements, introduce an explicit `mirrorProdConfig` boolean instead of a staging-specific branch. Keep the flag named after its purpose, not its environment.

### When a second tier is justified

Regulatory requirements can mandate distinct behavior for staging — for example, different log retention to satisfy an audit trail requirement, or a separate KMS key policy. When introducing a second tier, document the reason explicitly in a comment adjacent to the branch:

```typescript
// SOC2 CC6.1: staging logs retained 90 days for audit review.
const retentionDays = isProd
  ? logs.RetentionDays.SIX_MONTHS
  : props.stage === "staging"
  ? logs.RetentionDays.THREE_MONTHS
  : logs.RetentionDays.ONE_WEEK;
```

Without a documented reason, treat staging-specific branches as technical debt and remove them.

## Section 7: Rollback

> **Scope of this skill:** This section covers the basic rollback pattern — checkout a known-good commit and redeploy. Advanced deployment strategies (blue/green, canary, feature flags, CodeDeploy-backed Lambda aliases) are out of scope. When those are needed, consult the AWS CodeDeploy documentation directly or future iterations of this skill.

### Basic rollback pattern

**Step 1 — Identify the last known-good commit.** Use the deploy tags created in Section 1 Step 4:

```bash
git tag --list "deploy-${stage}-*" --sort=-creatordate | head -5
```

**Step 2 — Check out that commit:**

```bash
git checkout <tag-or-sha>
```

**Step 3 — Rebuild and redeploy with the same stage and suffix:**

```bash
cd frontend && npm run build && cd ..
cdk deploy --all -c stage=<stage> -c suffix=<suffix> --profile <project>
```

### Pre-conditions and caveats

- The previous commit must deploy cleanly against the current AWS state. A CDK diff against the current CloudFormation state (`cdk diff --all`) before deploying the rollback is strongly recommended.
- **Schema migrations are not covered.** If a SQL migration ran after the known-good commit, rolling back the CDK code does not reverse the schema change. Plan the inverse migration as a separate deploy step. Do not attempt to roll back database schema via CDK.
- **DynamoDB** — Schema changes are typically additive. New GSIs cannot be removed in a rollback without a subsequent deploy that explicitly drops them.
- **Aurora** — Automatic snapshots provide an independent recovery path. Identify the snapshot taken before the problematic deploy and restore from it if the code rollback alone is insufficient.
- **DynamoDB PITR** — Point-in-time recovery covers the last 35 days. For data corruption, restoring a table from PITR is independent of the CDK rollback.

### Snapshot discipline

- Tag every known-good deploy (Section 1 Step 4). Push tags to the remote.
- Maintain at least five recent deploy tags per stage so rollback targets are always available.
- For Aurora, verify that automated snapshots are enabled and that the retention period covers the rollback window.

## Section 8: Windows / PowerShell note

AWS CLI v2 invoked from a Git Bash or MSYS2 shell on Windows can hang indefinitely when a command produces multi-page output (for example, `aws rds describe-db-clusters`). The CLI attempts to open a terminal pager and waits for TTY input that Git Bash does not provide.

**Workaround 1 — Use PowerShell for direct `aws` CLI calls:**

```powershell
powershell.exe -Command "aws rds describe-db-clusters --profile <project>"
```

**Workaround 2 — Disable the pager in Git Bash before invoking `aws`:**

```bash
export AWS_PAGER=""
aws rds describe-db-clusters --profile <project>
```

Add `export AWS_PAGER=""` to `.bashrc` or `.bash_profile` to disable the pager permanently for Git Bash sessions.

**CDK is not affected.** The CDK CLI (`cdk deploy`, `cdk diff`, `cdk synth`) does not use the AWS CLI pager. Only direct `aws` CLI invocations in Git Bash or MSYS2 are affected.

## Section 9: Gotchas catalog

| Symptom | Root cause | Fix |
|---|---|---|
| `Unable to resolve AWS account` on `cdk deploy` | `--profile <project>` is missing; CDK resolves account from the default profile, which may be unconfigured or wrong | Add `--profile <project>` to every `cdk` command; never rely on the default profile |
| Stack replacement from silent `env` changes | `env.account` or `env.region` computed from `process.env` shifted between deploys, producing a new stack identity | Read account and region from CDK context, not raw `process.env`; validate at synth time |
| `Export cannot be removed` CloudFormation error | A cross-stack reference is still actively consumed by a downstream stack; CloudFormation blocks removing the export | Remove the consumer stack's reference first, deploy, then remove the export from the producer stack and deploy again |
| `BucketDeployment` fails with "Cannot find asset" | Frontend `dist/` is absent or empty when `cdk deploy` runs synth; the asset bundler cannot locate the source directory | Build the frontend (`npm run build`) before running `cdk deploy --all` |
| First deploy succeeds but auth and CORS are broken | The CloudFront domain is not yet in `cdk.json` context; Cognito callbacks and API Gateway CORS rules were configured without it | Follow Section 5: register the domain in `cdk.json` and redeploy |
| `aws` CLI command hangs in Git Bash on Windows | The AWS CLI pager waits for TTY input that Git Bash does not provide | Set `export AWS_PAGER=""` or use PowerShell; see Section 8 |
| `git checkout <tag>` then `cdk deploy` triggers Aurora replacement | Schema drift between commits; the older CDK code defines a different Aurora configuration than what is currently deployed | Plan schema rollback as a separate migration; do not attempt to roll back database schema by redeploying older CDK code |

## Section 10: Further reading

- [CDK CLI — `cdk deploy`](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-deploy) — All flags, approval modes, and hotswap options.
- [CDK context](https://docs.aws.amazon.com/cdk/v2/guide/context.html) — How `cdk.json`, `--context`, and `app.node.tryGetContext` interact.
- [AWS CodeDeploy](https://docs.aws.amazon.com/codedeploy/latest/userguide/welcome.html) — Blue/green, canary, and linear deployment strategies for Lambda and EC2; out of scope for this skill.
- Sibling: `00-architecture.md` — Stack structure, cross-stack references, and `env` configuration.
- Sibling: `03-static-site.md` — Full CloudFront distribution setup and domain registration workflow.
