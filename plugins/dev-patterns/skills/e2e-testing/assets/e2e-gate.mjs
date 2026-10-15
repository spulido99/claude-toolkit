// scripts/e2e-gate.mjs
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SUITE_VERDICT = { label: 'staging e2e suite', file: 'status.json' };
export const AI_VERDICT = { label: 'assistant probe', file: 'ai-status.json' };

// exec(command, args) returns stdout as a string and throws when the command fails.
export function defaultExec(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Returns the raw text of the verdict, or { missing: true, error } when the read fails.
// A missing key (404) and a denied read (403) both end here; the error text tells them apart.
export function fetchVerdict(exec, bucket, sha, file) {
  try {
    return exec('aws', ['s3', 'cp', `s3://${bucket}/e2e-reports/${sha}/${file}`, '-']);
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    return { missing: true, error: detail };
  }
}

// Pure decision. Only an explicit "passed" for this exact sha passes.
export function evaluate(raw, sha, probe) {
  if (typeof raw !== 'string') {
    return {
      ok: false,
      probe,
      reason: `${sha} never ran the ${probe.label}, or its verdict could not be read. ` +
        'Only tag commits that deployed green to staging. ' +
        'The assistant probe runs a few minutes after the staging deploy: if the deploy just finished, wait for the probe run to finish and tag again. ' +
        `Read error: ${raw?.error ?? 'none'}`,
    };
  }
  let verdict;
  try {
    verdict = JSON.parse(raw);
  } catch {
    return { ok: false, probe, reason: `The verdict of the ${probe.label} for ${sha} is not valid JSON; corrupt evidence blocks the gate.` };
  }
  if (verdict?.sha !== sha) {
    return { ok: false, probe, reason: `The verdict of the ${probe.label} names commit ${verdict?.sha}, not ${sha}.`, runUrl: verdict?.runUrl };
  }
  if (verdict.status !== 'passed') {
    return { ok: false, probe, reason: `The ${probe.label} did not pass for ${sha} (status: ${verdict.status}).`, runUrl: verdict.runUrl };
  }
  return { ok: true, probe, reason: `The ${probe.label} passed for ${sha}.`, runUrl: verdict.runUrl };
}

export function summaryLines(results, bucket, sha) {
  const lines = [`### E2E gate for \`${sha}\``, ''];
  for (const r of results) {
    lines.push(`- ${r.ok ? 'PASSED' : 'BLOCKED'}: ${r.probe.label}. ${r.reason}${r.runUrl ? ` Run: ${r.runUrl}` : ''}`);
  }
  lines.push('', `Archive: \`s3://${bucket}/e2e-reports/${sha}/\``);
  lines.push(`Fetch the report: \`E2E_REPORTS_BUCKET=${bucket} node scripts/fetch-report.mjs ${sha}\``);
  return lines;
}

export function runGate({ exec, bucket, sha, probes = [SUITE_VERDICT, AI_VERDICT] }) {
  // Evaluate every probe before deciding, so one run reports every red verdict.
  const results = probes.map((probe) => evaluate(fetchVerdict(exec, bucket, sha, probe.file), sha, probe));
  return { ok: results.every((r) => r.ok), results };
}

function main() {
  const sha = process.argv[2];
  const bucket = process.env.E2E_REPORTS_BUCKET;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    console.error('Usage: E2E_REPORTS_BUCKET=<bucket> node scripts/e2e-gate.mjs <40-hex-sha>');
    process.exit(2);
  }
  if (!bucket) {
    console.error('E2E_REPORTS_BUCKET is empty. Set it from the repository variable.');
    process.exit(2);
  }
  const { ok, results } = runGate({ exec: defaultExec, bucket, sha });
  const lines = summaryLines(results, bucket, sha);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  for (const r of results.filter((x) => !x.ok)) console.log(`::error::${r.reason}`);
  process.exit(ok ? 0 : 1);
}

// ESM replacement for `require.main === module`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
