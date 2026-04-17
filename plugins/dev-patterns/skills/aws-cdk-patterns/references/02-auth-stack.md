# Auth Stack — Cognito with Google Federated Identity

**Builds:** A `CognitoConstruct` that provisions a Cognito User Pool configured exclusively for Google federated identity, a Google OAuth identity provider backed by a Secrets Manager secret, an OAuth2 authorization-code User Pool client, and a Cognito-hosted UI domain. No password sign-in, no self-registration.
**When to use:** When the app authenticates users exclusively through Google sign-in and issues Cognito JWTs to the frontend and API. Applies to both SPAs (authorization code with PKCE in the browser) and server-rendered flows (authorization code exchanged server-side).
**Prerequisites:** `00-architecture.md` (two-stack layout, `SharedInfra` injection pattern) and `05-shared-utilities.md` (secrets loading, environment validation).

## Contents

1. **Architecture** — Federated-only User Pool, Google IdP, OAuth authorization code client, hosted domain.
2. **Template — `CognitoConstruct`** — Full TypeScript with imports, props, and wiring.
3. **Gotchas catalog** — Eight known failure modes with root causes and fixes.
4. **Deployment notes** — Secret creation, Google Cloud Console setup, context-driven callback URLs.
5. **Verification** — Hosted UI smoke test, token exchange, claim inspection.
6. **Further reading** — CDK and Google docs plus sibling references.

## Section 1: Architecture

Cognito is used as a token broker in front of Google. Users never hold a Cognito password; authentication always redirects through Google's OAuth flow, and Cognito returns its own ID and access tokens after a successful federation.

### Components

- **`UserPool`** — Federated-only. `selfSignUpEnabled: false` to prevent open registration, and no password policy exposed to end users because there is no password flow. Email is the sign-in alias so the user record can be looked up by the verified Google email claim.
- **`UserPoolIdentityProviderGoogle`** — Links the pool to a Google OAuth 2.0 client. The `clientId` and `clientSecret` values live in AWS Secrets Manager, referenced through `cdk.SecretValue.secretsManager()` so they resolve at deploy time via CloudFormation dynamic references rather than being baked into the synthesized template.
- **`UserPoolClient`** — The application-facing client. OAuth2 authorization-code grant is enabled; implicit grant and password flows are disabled. `supportedIdentityProviders` lists only Google, so the hosted UI skips the username/password form and redirects straight to Google. Callback and logout URLs are injected as props so each environment (dev, staging, prod) gets its own allowlist.
- **`UserPoolDomain`** — A Cognito-hosted UI domain (`https://<prefix>.auth.<region>.amazoncognito.com`) that serves the federation entry point and the OAuth endpoints. A custom domain (with an ACM certificate and a DNS record) is an alternative for production when a branded login URL is required.

### Flow

1. Frontend redirects the browser to `https://<domain-prefix>.auth.<region>.amazoncognito.com/oauth2/authorize?client_id=...&response_type=code&scope=openid+email+profile&redirect_uri=<callback>`.
2. Cognito, seeing a Google-only client, redirects to Google.
3. User authenticates at Google and is redirected back to Cognito at `/oauth2/idpresponse` with a Google authorization code.
4. Cognito exchanges that code with Google, creates or updates the user record in the pool (mapping Google email, given name, family name via `attributeMapping`), and issues a Cognito authorization code.
5. Cognito redirects the browser to the frontend's `redirect_uri` with `?code=<cognito-code>`.
6. The frontend (or its backend) exchanges that code at `/oauth2/token` for Cognito ID, access, and refresh tokens.

Callback URLs are per-environment and must be registered in `callbackUrls` at CDK synth time. The CDK context pattern (`cdk.json` keyed by stage) provides those URLs; see `03-static-site.md` for the canonical shape. Hard-coding callback URLs in the construct makes the pool unusable in any other environment.

## Section 2: Template — `CognitoConstruct`

```typescript
// infra/constructs/cognito.construct.ts
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface CognitoConstructProps {
  /** Stage name: "dev" | "staging" | "prod". Used for naming and removal policy. */
  stage: string;
  /** OAuth2 callback URLs allowed for this environment. */
  callbackUrls: string[];
  /** OAuth2 logout URLs allowed for this environment. */
  logoutUrls: string[];
  /**
   * Name of the Secrets Manager secret that holds Google OAuth credentials.
   * Secret JSON shape: { "clientId": "...", "clientSecret": "..." }.
   */
  googleSecretName: string;
}

export class CognitoConstruct extends Construct {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly domain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id);

    const isProd = props.stage === "prod";

    // User Pool — federated sign-in only, no password flows.
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `app-${props.stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: isProd
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Google IdP — clientId and clientSecret pulled from Secrets Manager
    // via CloudFormation dynamic references; resolved at deploy, not at synth.
    const googleClientId = cdk.SecretValue.secretsManager(
      props.googleSecretName,
      { jsonField: "clientId" },
    );
    const googleClientSecret = cdk.SecretValue.secretsManager(
      props.googleSecretName,
      { jsonField: "clientSecret" },
    );

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleIdP",
      {
        userPool: this.userPool,
        // `unsafeUnwrap` is required because `clientId` expects a string, not
        // a token. The value is still a CloudFormation dynamic reference; the
        // literal secret never appears in the synthesized template.
        clientId: googleClientId.unsafeUnwrap(),
        clientSecretValue: googleClientSecret,
        scopes: ["email", "profile", "openid"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      },
    );

    // User Pool Client — OAuth2 authorization code grant, Google only.
    this.userPoolClient = new cognito.UserPoolClient(this, "Client", {
      userPool: this.userPool,
      userPoolClientName: `app-${props.stage}-client`,
      generateSecret: false,
      authFlows: {
        userSrp: false,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      oAuth: {
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Critical: without this explicit dependency, CloudFormation may create
    // the client before the Google IdP, and the first deploy fails with
    // "Identity provider does not exist".
    this.userPoolClient.node.addDependency(googleProvider);

    // Hosted UI domain. Use a custom domain (cognito.UserPoolDomain with
    // `customDomain: { domainName, certificate }`) when branded login URLs
    // are required; that path needs an ACM cert in us-east-1 plus a DNS
    // record pointing at the alias target returned by Cognito.
    this.domain = new cognito.UserPoolDomain(this, "Domain", {
      userPool: this.userPool,
      cognitoDomain: { domainPrefix: `app-${props.stage}` },
    });

    // Outputs — exported for the API stack (authorizer) and the frontend
    // config.json generator. See 00-architecture.md for the chicken-and-egg
    // pattern that threads these values to the SPA.
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `${props.stage}-UserPoolId`,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${props.stage}-UserPoolClientId`,
    });
    new cdk.CfnOutput(this, "UserPoolDomainName", {
      value: this.domain.domainName,
      exportName: `${props.stage}-UserPoolDomainName`,
    });
  }
}
```

Consume the construct from the main backend stack, passing stage-specific context:

```typescript
const googleSecretName =
  this.node.tryGetContext("googleSecretName") ?? "google-oauth";
const callbackUrls = this.node.tryGetContext(`callbackUrls.${stage}`) as string[];
const logoutUrls = this.node.tryGetContext(`logoutUrls.${stage}`) as string[];

const auth = new CognitoConstruct(this, "Auth", {
  stage,
  callbackUrls,
  logoutUrls,
  googleSecretName,
});
```

## Section 3: Gotchas catalog

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | First `cdk deploy` fails with `Identity provider does not exist` when creating the client | CloudFormation creates the `UserPoolClient` before `UserPoolIdentityProviderGoogle` because no implicit reference links them | Add `client.node.addDependency(googleProvider)` so the client's creation waits for the IdP |
| 2 | Deleting the stack leaves orphaned User Pools that block re-deploy with the same pool name | CDK defaults `removalPolicy` to `RETAIN` for stateful resources | Set `removalPolicy: isProd ? RETAIN : DESTROY` explicitly on the pool; keep `RETAIN` only in prod |
| 3 | Manual fixes in the AWS Console disappear on the next `cdk deploy` | Only CDK changes are idempotent; Console edits are drift and get overwritten | Never edit Cognito resources via the Console. All changes go through CDK plus `cdk deploy` |
| 4 | Frontend lands on `/oauth2/idpresponse` and sees `invalid_request` or a CORS error at callback | The frontend origin is not in `callbackUrls` or `logoutUrls` | Register every environment's frontend origin (`http://localhost:5173` for dev, the CloudFront distribution for the rest) via CDK context; see `03-static-site.md` for the `cdk.json` pattern |
| 5 | `Set-Cookie` succeeds but a subsequent clear leaves the session cookie intact | Browsers silently refuse to clear a cookie unless `Path`, `Domain`, `Secure`, and `SameSite` match exactly | Share one cookie config between set and clear; see `05-shared-utilities.md` gotcha #2 |
| 6 | Google `clientId` ends up as an empty string in the synthesized CloudFormation template | The value was read via `process.env.GOOGLE_CLIENT_ID` at synth time on a machine without the env var set | Use `cdk.SecretValue.secretsManager(name, { jsonField })` so the value resolves at deploy via a CloudFormation dynamic reference; never call `process.env` for secrets |
| 7 | JWT validation succeeds in prod but fails locally with `Invalid issuer` or `Invalid audience` | The frontend hardcoded the pool id, client id, or domain for one environment | Frontend must fetch `config.json` generated by the frontend stack (see `00-architecture.md` chicken-and-egg section); never hardcode Cognito identifiers |
| 8 | Attacker probes the login endpoint and learns which emails are registered | `preventUserExistenceErrors` defaults to `LEGACY`, which returns distinguishable responses for known vs. unknown users | Always set `preventUserExistenceErrors: true` on the client; Cognito then returns a uniform error |

## Section 4: Deployment notes

### Create the Google OAuth secret (one-time, per environment)

The Google `clientId` and `clientSecret` come from Google Cloud Console, not from CDK. Create one secret per environment:

```bash
aws secretsmanager create-secret \
  --name google-oauth-dev \
  --secret-string '{"clientId":"XXXX.apps.googleusercontent.com","clientSecret":"YYYY"}' \
  --profile <aws-profile>
```

Repeat for `google-oauth-staging` and `google-oauth-prod` with distinct Google OAuth clients. Reference the name from CDK context, not the value; the secret content never enters the repo or the CloudFormation template.

### Google Cloud Console setup

1. Google Cloud Console → **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID** → **Web application**.
2. **Authorized JavaScript origins:** `https://<domain-prefix>.auth.<region>.amazoncognito.com` (one entry per environment).
3. **Authorized redirect URIs:** `https://<domain-prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse` — this is the Cognito endpoint Google calls, not the frontend URL.
4. Copy the generated `clientId` and `clientSecret` into the Secrets Manager secret created above.

The Cognito-hosted domain prefix is derived from the stage (`app-${stage}`), so its value is known before the first deploy. If using a custom domain whose name is not known until after deploy, run `cdk deploy` once, then update the Google Cloud Console entries, then re-deploy or test.

### CloudFront and callback URL registration

Callback URLs are environment-specific and come from CDK context. The canonical layout lives in `cdk.json`:

```json
{
  "context": {
    "callbackUrls.dev": ["http://localhost:5173/auth/callback"],
    "callbackUrls.prod": ["https://app.example.com/auth/callback"],
    "logoutUrls.dev": ["http://localhost:5173/"],
    "logoutUrls.prod": ["https://app.example.com/"]
  }
}
```

See `03-static-site.md` for the full context-driven pattern that keeps the CloudFront distribution domain, callback URLs, and frontend config in sync.

## Section 5: Verification

After `cdk deploy`, walk the hosted UI flow end to end. Nothing else proves the wiring is correct.

### 1. Hit the hosted UI

Open this URL in a private window:

```
https://<domain-prefix>.auth.<region>.amazoncognito.com/login?client_id=<user-pool-client-id>&response_type=code&scope=openid+email+profile&redirect_uri=<callback-url>
```

Expected: immediate redirect to Google's consent screen. If the hosted UI renders with a username/password form, `supportedIdentityProviders` was not set to Google-only or the Google IdP creation failed; inspect the pool in CloudFormation, not the Console.

### 2. Complete the Google redirect

Sign in with a Google account. Expected: Google redirects to `/oauth2/idpresponse`, Cognito redirects back to the configured `redirect_uri` with `?code=<authorization-code>` in the query string. If the browser lands on an AWS error page, `callbackUrls` does not include the redirect URI used in step 1.

### 3. Exchange the code for tokens

```bash
curl -X POST "https://<domain-prefix>.auth.us-east-1.amazoncognito.com/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&client_id=<client-id>&code=<code>&redirect_uri=<callback>"
```

Expected response: JSON with `id_token`, `access_token`, `refresh_token`, `expires_in`, `token_type`. If the response is `invalid_grant`, the code already expired (they are single-use and short-lived) — rerun step 1.

### 4. Inspect the ID token

Paste `id_token` at `jwt.io`. Confirm:

- `iss` equals `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`.
- `aud` equals the User Pool client id.
- `identities[0].providerName` equals `Google`.
- `email`, `given_name`, `family_name` are populated from the `attributeMapping`.
- `token_use` is `id`.

If any claim is missing or wrong, the `attributeMapping` is the first suspect; Google returns the value under a different field than expected only if `scopes` excludes `profile`.

## Section 6: Further reading

- [aws-cognito construct library (CDK v2)](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito-readme.html)
- [Google Identity — OAuth 2.0 for server-side web apps](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Cognito User Pools — federated sign-in with Google](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-social-idp.html)
- Sibling references: `00-architecture.md`, `03-static-site.md`, `05-shared-utilities.md`.
