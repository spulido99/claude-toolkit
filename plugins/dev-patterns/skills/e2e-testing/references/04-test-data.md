# Test Data

**Builds:** A suite that seeds what it reads through the real API, owns one shared fixture per spec file on a deployed stack, cleans up what it creates and checks that the cleanup worked, and survives crashed runs and concurrent runs without leaving the shared table in a bad shape.

**When to use:** Writing seed and reset code for a shared stack, assigning shared fixtures to spec files, closing the cases or rows a spec creates, or fixing a test that fails with "403 instead of 409", an invisible seeded row, a throttled seed, or a queue that no longer shows the test's own row.

**Prerequisites:** [03, section 2](./03-auth-and-test-users.md) for the session file (`.auth/session.json`) that the seed code reads its token from.

> Verified on 2026-10-14 against `@playwright/test` 1.64 and Node 22; the projects behind the *(observed)* facts ran 1.60 to 1.62. Facts marked *(observed)* were measured in production projects, not taken from vendor documentation.

## Contents

1. Seeding
2. Shared fixtures on a real stack
3. Cleanup that verifies

---

## Section 1: Seeding

### 1.1 Seed through the real public API with the real token

A spec that creates its data through the API exercises the create endpoints and their validation as a side effect. A direct write to DynamoDB bypasses them, and the data it writes can be in a shape the app never produces. The seed code calls the same endpoints the app calls, with the token from `.auth/session.json`.

### 1.2 Wipe, then seed, at the start of every run

The setup project first deletes the QA user's data, then creates the known set. A run that crashed halfway leaves the table in any shape. The next run starts by wiping, so the table repairs itself and no teardown has to run after a crash.

```ts
// e2e/lib/fixture.ts (api is the typed client over the real public API)
const isoDate = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
const runId = Date.now().toString(36); // per-run suffix: the backend soft-deletes, see 1.3. Unique only because the stack's concurrency group runs one suite at a time

export async function seedFixture(api: ApiClient) {
  const rows = await api.get<{ items: { id: string; date: string }[] }>(`orders?from=2000-01-01&to=${isoDate(2)}`);
  for (const row of rows.items) await api.delete(`orders/${encodeURIComponent(row.date)}/${row.id}`); // path must match the sort key exactly
  for (let i = 0; i < 5; i++) { // sequential on purpose: see 1.4
    await api.post('orders', { clientId: `seed-order-${i}-${runId}`, date: isoDate(-i), total: 1000 * (i + 1) });
  }
}
```

Dates are relative to today (`isoDate(-i)`), in UTC, so the screenshots are stable. A literal date fails later: see [05, section 3](./05-multi-user-waits-and-time.md).

### 1.3 A per-run suffix on client ids when the backend soft-deletes

Soft delete keeps a tombstone row with `deletedAt`. A create that is idempotent through `attribute_not_exists` then finds the tombstone, does nothing, and returns success. If the seed re-creates an order under the client id of a previous run, the order stays invisible forever and the test fails with no error on the write *(observed)*. A suffix such as `Date.now().toString(36)` makes every run's ids new. `Date.now()` is safe here, unlike in the phone numbers of [03, section 3.5](./03-auth-and-test-users.md), only because the concurrency group of the stack ([06, section 4](./06-ci-workflows.md)) serializes runs, so two runs never start in the same millisecond against one stack.

### 1.4 Sequential seeding when concurrency is low

A new AWS account gives Lambda a concurrency quota of 10. A seed that fires 30 requests at once is throttled, and the run fails with 429 or 502 that look like a product bug *(observed)*. Seed in a loop, and raise the setup timeout to 120 s.

### 1.5 Restore third-party state in setup, every run

A run that dies in the middle can leave a third-party record in any shape: the QA user is still premium, the subscription was cancelled, the renewal date is stale. Setup restores the state without checking it first.

- For the premium user, always re-send the signed "subscription created" webhook. It overwrites whatever the record had. Then poll up to 30 s until the API reports premium.
- For the free user, call a `normalizeToFree()` helper that cancels any real sandbox subscription at the provider, sends a signed synthetic "subscription expired" event with fresh timestamps (a new body hash is a new idempotency key), and polls until the API reports free.
- Probe specs call the normalizer in `beforeAll` and `afterAll`. If the provider's webhook lands after `afterAll`, the next run's setup finishes the job.

Signed webhooks are covered in [08, section 2](./08-third-parties-payments-and-messaging.md).

---

## Section 2: Shared fixtures on a real stack

When the stack holds fixed resources that specs share, each spec file owns exactly one resource, and the file resets it.

### 2.1 One seed resource per spec file

The dedicated `dev-e2e` stack seeds five pickup lockers `L1` to `L5`. Every spec file declares `const LOCKER_ID = 'L2'` at the top, and no two files that can run at the same time share a locker. The smoke lane and the e2e specs use disjoint lockers, so a smoke never collides with a spec that holds a locker *(observed)*. Name the owner of each locker in a comment next to the seed constant, so a new spec can pick a free one.

Files that own different lockers can run in parallel, as the workers of [02, section 1](./02-config-runtime.md) do. Two files that share one locker need `workers: 1`.

### 2.2 `resetLocker()` and the fence

`resetLocker()` deletes the active reservation and every row that shares the key. The first version deleted one row (`Limit 1`) of the shared index key and left the others. The next test then got 403 instead of 409, because an old open order was still attached to the locker *(observed)*. Query with a loop until the page is empty.

When the reset script shells out to `aws lambda invoke`, write the response to a temporary file and pass the payload with `--cli-binary-format raw-in-base64-out`. Writing the response to `/dev/stdout` under a pipe collides with the CLI's own output and fails with exit 255 and empty stderr in CI only, while a terminal hides the problem.

After the delete, a fence polls until every data model reports the locker free. The projections lag the write, so the delete returning is not proof that the app sees a free locker.

```ts
// e2e/lib/locker.ts (imports: execFileSync, resolve, eventually, lockerIsFree)
// The script path is built from this file's location, so a run from the repository root or from e2e/ finds the same script.
export async function resetLocker(lockerId: string, { fenceMs = 8_000 } = {}) {
  execFileSync('node', [resolve(__dirname, '..', '..', 'scripts', 'e2e', 'reset-test-locker.mjs'), '--locker', lockerId, '--yes'], {
    stdio: 'inherit',
    env: process.env,
  });
  await eventually(
    `locker ${lockerId} reports free in every model`,
    async () => ((await lockerIsFree(lockerId)) ? true : null),
    { timeoutMs: fenceMs, everyMs: 500 },
  );
}
```

The reset script is idempotent: on a clean locker it prints "Deleted 0 reservation(s)" and exits 0. It reads the table name from the stack outputs (`OrdersTableName`) and unit-tests its decision logic.

### 2.3 Global state restored in `finally`

A reset clears a locker's rows. It does not clear global data such as the catalog. A spec that sells out a catalog item restores the stock in `finally` or `afterAll`:

```ts
await setStock('sku-espresso', 0);
try {
  await page.goto('/catalog');
  await expect(page.getByTestId('sku-espresso')).toContainText('Sold out');
} finally {
  await setStock('sku-espresso', 25); // global state: resetLocker does not touch it
}
```

### 2.4 Close contexts before resetting

A browser tab that is still open resubscribes to the freshly cleaned locker and writes a new session into it. In `afterEach`, close every context first, then call `resetLocker()` (hook in [05, section 1.2](./05-multi-user-waits-and-time.md)).

### 2.5 Two runs against one stack reset each other

The reset of a run wipes the fixtures of another run that is mid-test. The only protection is a concurrency group per stack, defined in [06, section 4](./06-ci-workflows.md). Say in the docs for agents that the suite resets `L5` on every run, and that nobody should use that locker for a demo while a run is going.

---

## Section 3: Cleanup that verifies

A suite that seeds into a shared queue, and does not clean up, grows the queue until the first page no longer contains the test's own row. One suite left about 8 open cases per green run, and the queue reached 109 open cases *(observed)*.

### 3.1 Track what was seeded, close it, verify it is closed

A registry records every case a test creates. `afterEach` runs after failures too. It closes every tracked case through the real API with the operator token, then reads the queue again and fails if any case it seeded is still open.

```ts
// e2e/lib/cleanup.ts (import type APIRequestContext)
const seeded = new Set<string>();
export const trackSeededCase = (caseId: string) => seeded.add(caseId);

export async function closeSeededCases(request: APIRequestContext, apiUrl: string, headers: Record<string, string>) {
  const ids = [...seeded];
  seeded.clear();
  for (const id of ids) {
    // The same command the console sends, with the outcome that opens no follow-up work.
    const res = await request.post(`${apiUrl}/cases/${id}/close`, { headers, data: { outcome: 'dismissed' } });
    if (!res.ok() && res.status() !== 404) throw new Error(`closing case ${id} failed with HTTP ${res.status()}`);
  }
  const open = await listOpenCaseIds(request, apiUrl, headers);
  const left = ids.filter((id) => open.has(id));
  if (left.length > 0) throw new Error(`cleanup left ${left.length} seeded case(s) open: ${left.join(', ')}`);
}
```

Seeding helpers call `trackSeededCase` themselves, so a spec author cannot forget it. A spec registers the cleanup once:

```ts
test.afterEach(async ({ request }) => closeSeededCases(request, API_URL, operatorHeaders));
```

### 3.2 The guard test

Any spec that calls a seeding helper must import `closeSeededCases` and call it inside `test.afterEach`.

The source scan is in [10, section 1.6](./10-guard-tests.md); add each new seeding helper to its regex in the same change.

### 3.3 Page through a shared queue until your own row appears

A shared queue is ordered by due date, so a fresh case is last. Once more than one page of cases is open, the test's own case is on page 2 or 3. Helpers page through "Load more" the way an analyst does (cap at 60 pages) and look for the test's own row. A pagination spec asserts only about its own cases, because other scripts open and close cases while it runs. A source scan fails any spec that reads only the first page of the queue.

### 3.4 The one-off sweep for legacy leftovers

When a queue already has leftovers, a sweep script closes them. It refuses to run unless `SWEEP_ENVIRONMENT` starts with `dev`:

```ts
// e2e/close-open-cases.ts
const env = process.env.SWEEP_ENVIRONMENT ?? '';
if (!env.startsWith('dev')) {
  throw new Error(`Refusing to sweep: SWEEP_ENVIRONMENT must start with "dev", got "${env}"`);
}
```

### 3.5 Scans that exceed the buffer

A verification that scans a table can blow the output buffer of `execFileSync`. An unfiltered scan of a 9,000-item table returned 1.6 MB, which is above the default 1 MiB `maxBuffer`. Node killed the AWS CLI and gave an empty stderr, and the failure was misread as a permissions problem for 40 minutes *(observed)*. Three rules follow:

- Filter on the server (`--filter-expression 'contains(PK, :thread)'`) and project only the key (`--projection-expression PK`).
- Set `maxBuffer` explicitly when output can be large.
- Surface `error.message` in the thrown error, since a killed child process has no stderr.

```ts
const out = execFileSync('aws', [
  'dynamodb', 'scan', '--table-name', table,
  '--filter-expression', 'contains(PK, :t)',
  '--expression-attribute-values', JSON.stringify({ ':t': { S: thread } }),
  '--projection-expression', 'PK', '--select', 'SPECIFIC_ATTRIBUTES', '--output', 'json',
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); // wrap in try/catch and rethrow with e.message
```

---

## Verification

Commands:

```bash
# Cleanup present in every spec that seeds
npx vitest run shared/test/smoke-spec-conventions.test.ts
```

Test checklist, one per mechanical rule:

- [ ] Reset script unit test: a clean locker prints "Deleted 0" and exits 0; a locker with several rows under one index key loses all of them (section 2.2).
- [ ] Fence in `resetLocker()` fails after `fenceMs` with the locker id in the message (section 2.2).
- [ ] Cleanup check in `afterEach`: fails when a seeded case is still open (section 3.1).
- [ ] Source-scan guard: every spec that calls a seeding helper calls `closeSeededCases` from `test.afterEach` (section 3.2).
- [ ] Source-scan guard: no spec reads only the first page of a shared queue (section 3.3).
- [ ] Sweep script refuses to run when `SWEEP_ENVIRONMENT` does not start with `dev` (section 3.4).

## Further reading

- [`dynamodb-design/references/06-testing-local-dev.md`](../../dynamodb-design/references/06-testing-local-dev.md): DynamoDB Local for integration tests.
