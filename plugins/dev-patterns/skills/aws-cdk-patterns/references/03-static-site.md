# Static Site Hosting

**Builds:** An S3 + CloudFront + OAC stack for single-page application (SPA) hosting, wired to backend outputs (Cognito, API URL) via a generated `config.json`. Includes a CloudFront domain registration pattern that keeps CORS and Cognito callback URLs in sync across dev, staging, and prod without code changes.
**When to use:** Any CDK project with a React, Vue, or Angular frontend that needs a CDN-backed S3 deployment. Use after the backend stack is deployed and its outputs are available.
**Prerequisites:** `00-architecture.md` (two-stack split, how frontend consumes backend outputs).

---

## Contents

1. **Architecture** — S3, CloudFront OAC, ACM, Route53 wiring.
2. **Template — FrontendStack** — Full, copy-paste-ready CDK construct.
3. **CloudFront domain registration pattern** — Four-step `cdk.json` context flow for CORS / Cognito.
4. **Post-deploy step** — Manual `aws s3 sync` + invalidation for hot-fixes and CI.
5. **Gotchas catalog** — Seven common failure modes with root causes and fixes.
6. **Deployment notes + verification** — Deploy order, targeted deploy command, smoke-test curl.
7. **Further reading** — CDK construct docs and sibling reference files.

---

## Section 1: Architecture

```
Browser
  │
  ▼
Route53 A-record (alias)
  │
  ▼
CloudFront Distribution
  │  defaultRootObject: index.html
  │  errorResponses: 403/404 → /index.html (SPA routing)
  │  ACM certificate (us-east-1 — mandatory for CloudFront)
  │
  ▼ Origin Access Control (OAC)
S3 Bucket (private — blockPublicAccess: BLOCK_ALL)
  │
  ├── index.html, assets/, ...  (from BucketDeployment "DeployApp")
  └── config.json               (from BucketDeployment "DeployConfig", generated from backend outputs)
```

Key constraints:

- **OAC, not OAI.** Origin Access Identity (OAI) is the legacy mechanism. Use `S3BucketOrigin.withOriginAccessControl()` from `aws-cloudfront-origins`. OAC does not require a separate identity resource and supports SSE-KMS buckets.
- **No `websiteIndexDocument`.** Setting `websiteIndexDocument` on the bucket together with `blockPublicAccess: BLOCK_ALL` causes 403 errors on every GET. `defaultRootObject: "index.html"` on the CloudFront distribution handles the index page; the bucket never needs static-hosting mode.
- **ACM certificate must be in `us-east-1`.** CloudFront is a global service and only reads certificates from the `us-east-1` region regardless of where the rest of the stack is deployed. If the backend stack is in another region, deploy the certificate in a separate `CertificateStack` targeting `env: { region: "us-east-1" }`.
- **`config.json` bridges backend and frontend.** The frontend application fetches `config.json` at startup to obtain Cognito user pool ID, client ID, hosted UI domain, and API URL. `BucketDeployment` writes this file from backend outputs — no build-time environment variables needed.

---

## Section 2: Template — FrontendStack

```typescript
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export interface FrontendStackProps extends cdk.StackProps {
  stage: string;
  // Backend outputs wired into config.json
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoDomain: string;
  apiUrl: string;
  // Optional custom domain — omit for the bare CloudFront domain
  hostedZoneId?: string;
  domainName?: string;
  /** ARN of an ACM certificate already issued in us-east-1 */
  certificateArn?: string;
}

export class FrontendStack extends cdk.Stack {
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const isProd = props.stage === "prod";

    // ── S3 bucket ──────────────────────────────────────────────────────────
    // No websiteIndexDocument — that would conflict with blockPublicAccess.
    // CloudFront's defaultRootObject handles the index page.
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      bucketName: `frontend-${props.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ── ACM certificate (must exist in us-east-1) ──────────────────────────
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, "Cert", props.certificateArn)
      : undefined;

    // ── CloudFront distribution ────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
      defaultRootObject: "index.html",
      defaultBehavior: {
        // OAC — current CDK v2 API. Do NOT use originAccessIdentity (legacy OAI).
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        compress: true,
      },
      // SPA routing: let React/Vue/Angular router handle all paths.
      // 403 arises when OAC returns AccessDenied for a missing key; 404 for
      // truly absent objects. Both map to /index.html so the client router
      // can render a not-found page or redirect.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // ── Route53 alias record (only when a custom domain is provided) ────────
    if (props.hostedZoneId && props.domainName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: props.hostedZoneId,
        // Derive the apex zone name from the full domain (e.g. app.example.com → example.com)
        zoneName: props.domainName.split(".").slice(-2).join("."),
      });
      new route53.ARecord(this, "AliasRecord", {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution)
        ),
      });
    }

    // ── BucketDeployment: config.json from backend outputs ─────────────────
    // Deploy config.json first, then the app bundle.
    // Separate deployments let CDK invalidate /config.json and /* independently.
    new s3deploy.BucketDeployment(this, "DeployConfig", {
      sources: [
        s3deploy.Source.jsonData("config.json", {
          cognitoUserPoolId: props.cognitoUserPoolId,
          cognitoClientId: props.cognitoClientId,
          cognitoDomain: props.cognitoDomain,
          apiUrl: props.apiUrl,
          stage: props.stage,
        }),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/config.json"],
    });

    // ── BucketDeployment: built frontend assets ────────────────────────────
    // Build the frontend (npm run build) before running cdk deploy.
    // The asset path is relative to the CDK app entry point (cdk/bin/*.ts).
    new s3deploy.BucketDeployment(this, "DeployApp", {
      sources: [s3deploy.Source.asset("../frontend/dist")],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    this.distributionDomainName = distribution.distributionDomainName;

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain — register in cdk.json context",
    });
  }
}
```

---

## Section 3: CloudFront domain registration pattern

The CloudFront distribution domain name (e.g., `d1234abcxyz.cloudfront.net`) is only known after the first deploy. The backend stack needs that domain in two places: the CORS allowlist on every Lambda and the Cognito callback / logout URL list. Hardcoding it is impossible before deploy; passing it as a CDK parameter requires a circular dependency. The solution is a two-deploy bootstrap stored in `cdk.json` context.

**Step 1 — First deploy (no custom domain yet)**

```bash
cdk deploy FrontendStack-dev-alice
```

The stack outputs the CloudFront domain name:

```
Outputs:
FrontendStack-dev-alice.DistributionDomainName = d1234abcxyz.cloudfront.net
```

**Step 2 — Record the domain in `cdk.json`**

```json
{
  "context": {
    "cloudfrontDomains": {
      "dev-alice": "d1234abcxyz.cloudfront.net",
      "dev-bob":   "d5678mnopqr.cloudfront.net",
      "prod":      "d0987zyxwvu.cloudfront.net"
    }
  }
}
```

The key is the stage suffix. The backend stack reads `app.node.tryGetContext("cloudfrontDomains")?.[suffix]` and injects the value into Lambda environment variables (`ALLOWED_ORIGINS`) and into the Cognito app client's `callbackUrls` / `logoutUrls`.

**Step 3 — Re-deploy both stacks**

```bash
cdk deploy --all
```

The backend stack now includes the correct CloudFront origin in CORS and Cognito. The frontend stack is unchanged.

**Step 4 — Commit `cdk.json`**

Commit the `cdk.json` change so the domain persists across deploys and CI pipelines pick it up automatically.

**Why this matters:** Every deployment slot (dev-alice, dev-bob, staging, prod) gets its own CloudFront distribution with a unique generated domain. Without this pattern, a new developer deploying to `dev-bob` would need to manually update backend CORS and Cognito after every `cdk destroy` + redeploy. With the context map, the same CDK code handles all slots by reading the registered domain for each suffix. The stage/suffix naming system is covered in `06-deploy-workflow.md`.

---

## Section 4: Post-deploy step

`BucketDeployment` handles S3 sync and CloudFront invalidation as part of `cdk deploy`. The manual flow below is only needed for hot-fixes or CI pipelines that deploy frontend assets without re-running CDK (for example, when only the React bundle changed and no CDK resource changed).

```bash
# Build the frontend
cd frontend && npm run build

# Sync dist/ to the site bucket (--delete removes stale files)
aws s3 sync dist/ s3://<site-bucket-name> \
  --delete \
  --profile <project>

# Invalidate the CloudFront cache so edge nodes serve the new assets
aws cloudfront create-invalidation \
  --distribution-id <distribution-id> \
  --paths "/*" \
  --profile <project>
```

The `<site-bucket-name>` and `<distribution-id>` are available in the CloudFormation stack outputs and in the AWS Console under CloudFront distributions.

---

## Section 5: Gotchas catalog

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | `AccessDenied` on every GET request, including `/index.html` | Bucket has `websiteIndexDocument` set while `blockPublicAccess: BLOCK_ALL` is active | Remove `websiteIndexDocument` from the bucket. Set `defaultRootObject: "index.html"` on the CloudFront distribution. The bucket never needs static-website hosting mode when using OAC. |
| 2 | ACM certificate validation fails or CloudFront rejects the certificate | Certificate was created in a region other than `us-east-1` | CloudFront reads certificates exclusively from `us-east-1`. Create a separate `CertificateStack` with `env: { region: "us-east-1" }`, deploy it first, then reference its ARN via `certificateArn` prop. |
| 3 | `aws cloudfront create-invalidation` succeeded but the site still shows old assets | Service worker cached old files in the browser | Version the service worker filename on every build (e.g., `sw.abc123.js`) so browsers pick up the new worker. Or add a cache-busting query param to service worker fetch requests. `BucketDeployment` invalidation clears CDN edge caches but cannot reach browser-side service-worker caches. |
| 4 | Deep link (e.g., `/orders/123`) returns 403 or 404 | `errorResponses` not configured — CloudFront returns the S3 error, not `/index.html` | Add `errorResponses` for both `403` and `404` → `responsePagePath: "/index.html"`, `responseHttpStatus: 200` so the SPA router handles the path client-side. |
| 5 | First deploy succeeds but Cognito redirect or CORS fails immediately | CloudFront domain not yet registered in `cdk.json` context; backend CORS allowlist is empty or stale | Follow Section 3: record the CloudFront domain in `cdk.json.context.cloudfrontDomains`, then re-deploy both stacks. |
| 6 | `cdk deploy` fails with "Cannot find asset `../frontend/dist`" | `frontend/dist` directory does not exist because the frontend was not built before deploy | Run `npm run build` (or the equivalent) inside the `frontend/` directory before `cdk deploy`. Verify the relative path matches the CDK app entry point location. |
| 7 | Site is unreachable for ~20 minutes after the first deploy | CloudFront edge cache warm-up after distribution creation | Expected. Subsequent deploys propagate within ~5 minutes. `nslookup <distribution-domain>` confirms DNS has resolved; 503/504 during warm-up is transient. |

---

## Section 6: Deployment notes + verification

### Deploy order

Deploy the backend stack first. The frontend stack consumes backend outputs (Cognito user pool ID, client ID, domain, API URL) as props, so those values must exist before `FrontendStack` synthesizes.

```bash
# Deploy backend (produces Cognito and API outputs)
cdk deploy BackendStack-<stage>

# Deploy frontend (consumes backend outputs)
cdk deploy FrontendStack-<stage>

# Or deploy both in dependency order
cdk deploy --all
```

### Verification

After deploy, run the following smoke tests.

```bash
# 1. Confirm the distribution returns 200 with HTTPS redirect headers
curl -I https://<distribution-domain>
# Expect: HTTP/2 200
# Expect headers: cache-control, x-cache (from cloudfront)

# 2. Confirm config.json is reachable and contains expected fields
curl https://<distribution-domain>/config.json
# Expect JSON:
# {
#   "cognitoUserPoolId": "us-east-1_...",
#   "cognitoClientId": "...",
#   "cognitoDomain": "https://auth.example.com",
#   "apiUrl": "https://api.example.com",
#   "stage": "dev-alice"
# }

# 3. Confirm SPA deep-link routing (should return index.html, not 403/404)
curl -o /dev/null -w "%{http_code}" https://<distribution-domain>/some/deep/path
# Expect: 200
```

Open the site URL in a browser and confirm:

1. The application loads without console errors.
2. The app fetches `config.json` at startup (visible in Network DevTools).
3. Clicking "Login" redirects to the Cognito hosted UI at the expected domain.
4. After login, Cognito redirects back to the CloudFront URL (confirms callback URL registration).

---

## Section 7: Further reading

- [aws-cloudfront construct — CDK v2 API reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront-readme.html)
- [aws-s3 construct — CDK v2 API reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3-readme.html)
- [aws-s3-deployment construct — CDK v2 API reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html)
- [Origin Access Control (OAC) announcement — AWS blog](https://aws.amazon.com/blogs/networking-and-content-delivery/amazon-cloudfront-introduces-origin-access-control-oac/)
- Sibling references: `00-architecture.md` (two-stack split), `02-auth-stack.md` (Cognito hosted UI), `06-deploy-workflow.md` (stage/suffix system).
