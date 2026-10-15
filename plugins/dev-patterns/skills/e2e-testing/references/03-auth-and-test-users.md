# Auth and Test Users

**Builds:** A suite whose tests log in through Cognito without touching the identity provider's UI, start the browser with the session already in place, and own their QA users, whose credentials live in Secrets Manager and are created by an idempotent script. Each rule has a check that fails when the rule is broken.

**When to use:** Logging test users in through Cognito without the UI, injecting the session into the browser, creating QA users and storing their secrets, or fixing a test that fails with a `NEW_PASSWORD_REQUIRED` challenge, a redirect to the Google login, or two scripts that end up logged in as the same user.

**Prerequisites:** [01, section 1](./01-config-lanes-and-target.md) for the setup project and the `storageState` wiring.

> Verified on 2026-10-14 against `@playwright/test` 1.64, AWS Cognito user pools API (`AdminInitiateAuth`, `InitiateAuth`, `AdminCreateUser`, `AdminSetUserPassword`), and Node 22; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Logging in without the UI
2. Injecting the session
3. Test identities

---

## Section 1: Logging in without the UI

In production the operator pool of `acme` is federated with Google. Google blocks automated logins, so no test can sign in through the Google screen. The smoke lane needs a real token that the backend verifies, so the tests get one from Cognito directly.

### 1.1 The two password flows

Cognito has two plain username-and-password flows. Both return real ID, access, and refresh tokens signed by the pool.

| Flow | API operation | Credentials needed | Typical caller |
|---|---|---|---|
| `ADMIN_USER_PASSWORD_AUTH` | `AdminInitiateAuth` | IAM (the CI role signs the request) | Node setup code that already has AWS access |
| `USER_PASSWORD_AUTH` | `InitiateAuth` | none (unsigned call) | raw `fetch` from a spec with no AWS SDK |

The app client lists the flows it allows in `ExplicitAuthFlows` (`ALLOW_ADMIN_USER_PASSWORD_AUTH`, `ALLOW_USER_PASSWORD_AUTH`). A client that does not list the flow rejects the call, so the flow is opt-in per client.

Create these flows on an app client that exists only outside production. A password flow on the client the real app uses lets anyone with a leaked password skip the federated login.

```ts
// infra/lib/operator-auth.ts (inside the Backend stack)
// Production client: federated login only, no password flows.
operatorPool.addClient('ConsoleClient', { authFlows: { userSrp: true } });

if (props.stage !== 'prod') {
  // Test-only client. It does not exist in production.
  operatorPool.addClient('E2eClient', {
    authFlows: { adminUserPassword: true, userPassword: true },
    generateSecret: false,
  });
}
```

### 1.2 Getting a token in a setup file

Use the ID token when the backend reads claims such as the email or a custom attribute. The access token does not carry the email, and a decision signed by "who approved it" needs it *(observed)*.

```ts
// e2e/lib/cognito.ts
import { CognitoIdentityProviderClient, AdminInitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

export interface Session { idToken: string; accessToken: string; refreshToken: string; expiresIn: number }

export async function signInWithAdminFlow(o: {
  region: string; userPoolId: string; clientId: string; username: string; password: string;
}): Promise<Session> {
  const out = await new CognitoIdentityProviderClient({ region: o.region }).send(new AdminInitiateAuthCommand({
    UserPoolId: o.userPoolId,
    ClientId: o.clientId,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: o.username, PASSWORD: o.password },
  }));
  const r = out.AuthenticationResult;
  if (!r?.IdToken || !r.AccessToken || !r.RefreshToken || !r.ExpiresIn) {
    // A challenge (for example NEW_PASSWORD_REQUIRED) arrives here, not as an exception.
    throw new Error(`Sign-in returned no tokens, challenge: ${out.ChallengeName ?? 'none'}`);
  }
  return { idToken: r.IdToken, accessToken: r.AccessToken, refreshToken: r.RefreshToken, expiresIn: r.ExpiresIn };
}
```

Code without the SDK posts JSON with `Content-Type: application/x-amz-json-1.1` and `X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth` to `https://cognito-idp.<region>.amazonaws.com/`, with `AuthFlow: 'USER_PASSWORD_AUTH'`, the `ClientId`, and the same `AuthParameters`. It reads `AuthenticationResult.IdToken` from the response and throws on a non-OK status.

### 1.3 The check that keeps production closed

A synth test fails when any production app client lists a password flow. It exists because the opt-in is one `if` in CDK, and a refactor can drop the `if` without any e2e test noticing. The test, with its vacuity check that the stack has clients, is in [10, section 1.8](./10-guard-tests.md).

### 1.4 Rejected alternatives

- Automating the Google login fails because Google blocks automated logins and changes the flow without notice, so the test is flaky.
- A fake token in a test build fails because the backend verifies the JWT against Cognito, so the test would look at error and empty screens, not the real ones.
- A test-only backdoor route that skips auth fails because a route open for scripts is open for everyone: a production hole with a test label.
- A password flow on every client in every stage fails because it adds an attack surface to production for the sake of tests.

---

## Section 2: Injecting the session

The suite writes the token where the app reads it, before the app boots, so the browser starts logged in.

### 2.1 `storageState` written by a setup project

When the app keeps its session in `localStorage`, a setup project signs in once, builds the `localStorage` entries the app reads, and saves them as a `storageState` file. Every browser project that lists the setup project in `dependencies` starts logged in. Wire the project dependency as shown in [01, section 1](./01-config-lanes-and-target.md).

```ts
// e2e/auth.setup.ts
export const AUTH_STATE_PATH = '.auth/state.json';
export const SESSION_PATH = '.auth/session.json';

setup('sign in the free QA user', async ({ baseURL }) => {
  setup.setTimeout(120_000);
  // baseURL is the resolved target (see 01, section 2), so a local run that read the URL from the outputs file works too.
  const session = await signInWithAdminFlow({
    region: process.env.AWS_REGION!,
    userPoolId: process.env.USER_POOL_ID!,
    clientId: process.env.USER_POOL_CLIENT_ID!,
    ...(await readTestUserSecret(process.env.QA_FREE_SECRET_ID!)),
  });

  mkdirSync('.auth', { recursive: true });
  // The key and value shape are what the app's session loader reads from window.localStorage.
  const tokens = { ...session, expiresAt: Date.now() + session.expiresIn * 1000 };
  const localStorage = [{ name: 'acme-auth-tokens', value: JSON.stringify(tokens) }];
  writeFileSync(AUTH_STATE_PATH, JSON.stringify({ cookies: [], origins: [{ origin: new URL(baseURL!).origin, localStorage }] }));
  // API-level specs reuse the same token instead of signing in again. userId is the `sub` claim of the ID token.
  const userId = JSON.parse(Buffer.from(session.idToken.split('.')[1], 'base64url').toString()).sub as string;
  writeFileSync(SESSION_PATH, JSON.stringify({ apiUrl: process.env.API_URL, idToken: session.idToken, userId }));
});
```

`session.json` holds `{ apiUrl, idToken, userId }`. Add `.auth/` to `e2e/.gitignore`, because the files hold live tokens. The project in `playwright.smoke.config.ts` sets `storageState: AUTH_STATE_PATH`.

A spec that tests the logged-out screens overrides the project setting with an empty state:

`test.use({ storageState: { cookies: [], origins: [] } });`

The setup run mints the token once and the suite does not refresh it. A serial suite with a 120 s setup timeout stays well inside the default ID-token lifetime of Cognito *(observed)*. A suite that outlives the token needs a refresh step in the helper.

### 2.2 `addInitScript` for sessions in `sessionStorage`

The operator console of `acme` keeps its token in `sessionStorage`, which `storageState` does not save. The spec writes the token with `page.addInitScript`, which runs before any page script on every navigation of that page. Call it before `page.goto`. An `addInitScript` registered after the navigation is too late, because the console has already read an empty store and redirected to the Google login, which blocks automation *(observed)*.

```ts
// e2e/lib/console-session.ts
import type { Page } from '@playwright/test';

export const CONSOLE_TOKEN_KEY = 'acme.console.token';

export async function openConsole(page: Page, idToken: string, path = '/console/') {
  await page.addInitScript(
    ({ key, value }) => window.sessionStorage.setItem(key, value),
    { key: CONSOLE_TOKEN_KEY, value: idToken },
  );
  await page.goto(path);
}
```

The guard test is a source scan (same shape as the source scans in [10, section 1.6](./10-guard-tests.md)): every spec that opens the console must call `openConsole` or `addInitScript` before its first `goto` of `/console/`, with the message "the console redirects to Google without the token". A spec that calls `openConsole` has no direct `goto('/console')`, so the scan only flags specs that bypass the helper. Keep the helper as the single door to the console.

---

## Section 3: Test identities

### 3.1 Credentials live in Secrets Manager

Store each QA user as a secret `acme/<stack>/e2e/<role>` with `{"username","password"}`, where `<stack>` is the `ENV_SUFFIX` of the stack (for example `acme/dev-alex/e2e/free`) and `<role>` is `free`, `premium`, or `operator`. The CI role reads it through the secret's resource policy, scoped to the OIDC role ARN. A GitHub secret is the wrong place, because a rotated password would have to be changed in two systems and a cloud agent without the secret could not run the provisioning script. The reader maps a missing secret to an actionable error:

```ts
// e2e/lib/secrets.ts
export async function readTestUserSecret(secretId: string): Promise<{ username: string; password: string }> {
  try {
    const out = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
    return JSON.parse(out.SecretString ?? '{}');
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      throw new Error(`Secret ${secretId} does not exist. Run scripts/e2e/provision-qa-user.mjs for this stack.`);
    }
    throw e;
  }
}
```

### 3.2 Idempotent provisioning

One script creates the user and fixes its password, and running it again changes nothing visible except a rotated password. Two calls matter:

- `AdminCreateUser` with `MessageAction: 'SUPPRESS'` creates the user without sending an invitation.
- `AdminSetUserPassword` with `Permanent: true` sets a password the user can sign in with immediately. Without `Permanent: true`, the user stays in `FORCE_CHANGE_PASSWORD`, and the sign-in returns a `NEW_PASSWORD_REQUIRED` challenge instead of tokens. With it, the status becomes `CONFIRMED`.

```ts
// scripts/e2e/provision-qa-user.mjs (args: userPoolId, username, secretId)
const password = `${randomBytes(18).toString('base64url')}Aa1!`; // suffix satisfies the pool's character-class policy
try {
  await cognito.send(new AdminCreateUserCommand({ UserPoolId: userPoolId, Username: username, MessageAction: 'SUPPRESS' }));
} catch (e) {
  if (!(e instanceof UsernameExistsException)) throw e;
}
await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: userPoolId, Username: username, Password: password, Permanent: true }));

const SecretString = JSON.stringify({ username, password });
try {
  await secrets.send(new CreateSecretCommand({ Name: secretId, SecretString }));
} catch (e) {
  if (!(e instanceof ResourceExistsException)) throw e;
  await secrets.send(new PutSecretValueCommand({ SecretId: secretId, SecretString }));
}
```

Run it by hand once per stage with admin credentials, and again to rotate. The provisioning script is the only thing that creates QA users, because the CI role should not hold `AdminCreateUser` on the pool.

### 3.3 One QA user per UI variant

A user who is free in one test and premium in another makes one of the two tests fail with a mystery. Keep one QA user per variant, each with its own secret, its own `storageState` file (`.auth/state.json`, `.auth/premium-state.json`), and its own session file. Each user has its own Cognito `sub`, so each has its own partition in the data table.

The second setup file, `e2e/premium.setup.ts`, runs in the `setup-premium` project, which declares `dependencies: ['setup']`, so it runs after `setup` and the free session file exists when it runs. It signs in with `QA_PREMIUM_SECRET_ID`, writes `.auth/premium-state.json` and `.auth/premium-session.json` the same way `auth.setup.ts` writes its files (including `userId` from the ID token), and asserts that the two secrets point to different users:

```ts
// e2e/premium.setup.ts (imports: setup, expect, readFileSync)
setup('the premium QA user is not the free QA user', async () => {
  const userId = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { userId: string }).userId;
  expect(
    userId('.auth/premium-session.json'),
    'QA_PREMIUM_SECRET_ID points at the same Cognito user as QA_FREE_SECRET_ID; the run would flip the free user to premium',
  ).not.toBe(userId('.auth/session.json'));
});
```

### 3.4 The shared operator identity

The operator console needs one identity for the whole suite. Each script requests its own token for that identity at the start. A new token does not invalidate the older ones, so scripts that run in parallel do not log each other out *(observed)*.

When AWS credentials are missing, call `skipLocallyFailInCi` ([11, section 1.1](./11-skipped-scripts-and-photos.md)) instead of returning `null`: locally the script skips, and in CI it fails, so the run cannot go green without having tested anything.

### 3.5 Customers made through the real sign-up

When sign-up is the thing under test, or when a spec needs a customer who owns data, create the customer through the real UI, with no shortcut. The helper walks the sign-up screens, waits for the confirmation copy, and reads the persisted session from the page.

The username of a customer is the phone number, so it must be unique per script and per run. Derive it from `crypto.randomInt`, not from `Date.now()`. Two scripts that started in the same millisecond derived the same number from `Date.now()`, and the second script logged in as the first script's user *(observed)*.

```ts
// e2e/lib/synthetic-user.ts
import { randomInt } from 'node:crypto';

export function syntheticPhone(): string {
  // +1 555 range: never a real customer, and valid for the pool's phone format.
  return `+1555${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}
```

The lane does not delete these customers. The pool grows with every run, so stage pools are disposable and a periodic sweep script can delete users whose username starts with the synthetic prefix.

Three real sign-ups on cold Lambdas took 35-45 s *(observed)*, which is why [02, section 2](./02-config-runtime.md) sets a 120 s test timeout for those specs.

---

## Verification

Commands:

```bash
# Password flows absent in prod, console token seeded first
npx vitest run infra/test/e2e-harness-stack.test.ts shared/test/smoke-spec-conventions.test.ts

# The provisioning script is idempotent: run it twice, expect the second run to exit 0
node scripts/e2e/provision-qa-user.mjs "$USER_POOL_ID" qa-free "acme/dev-alex/e2e/free"
node scripts/e2e/provision-qa-user.mjs "$USER_POOL_ID" qa-free "acme/dev-alex/e2e/free"

# Sign-in works with the stored secret (token fields present)
npx playwright test --config e2e/playwright.smoke.config.ts --project setup
```

Test checklist, one per mechanical rule:

- [ ] Synth test: no production app client lists a `*PASSWORD_AUTH` flow, with a vacuity check that the stack has clients (section 1.3).
- [ ] Setup assertion: the sign-in result holds ID, access, and refresh tokens, and a `NEW_PASSWORD_REQUIRED` challenge fails with its name (section 1.2).
- [ ] Source-scan guard: every spec that opens `/console/` seeds the token before `goto` (section 2.2).
- [ ] Setup assertion: the free and premium secrets point to different Cognito users (section 3.3).
- [ ] Unit test of the synthetic-phone generator: two thousand calls give no repeats and match the pool's phone format (section 3.5).

## Further reading

- [`aws-cdk-patterns/references/06-deploy-workflow.md`](../../aws-cdk-patterns/references/06-deploy-workflow.md): stages and `stackSuffix`.
- Cognito authentication flows: https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html
- `AdminSetUserPassword`: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminSetUserPassword.html
- Playwright authentication: https://playwright.dev/docs/auth
