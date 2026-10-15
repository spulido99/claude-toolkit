// e2e/lib/target.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolved from this file (e2e/lib/), so a run from the repository root or from e2e/ finds the same file.
const DEFAULT_OUTPUTS_FILE = resolve(__dirname, '..', '..', 'infra', 'cdk-outputs-frontend.json');

type Outputs = Record<string, Record<string, string>>;

export function resolveSmokeUrl(opts: {
  env: Record<string, string | undefined>;
  outputsFile?: string;
}): string {
  // "" counts as unset: `vars.SMOKE_URL || ''` in Actions yields "",
  // and `??` does not fall back on "".
  const fromEnv = opts.env.SMOKE_URL?.trim();
  if (fromEnv) return fromEnv;

  const outputsFile = opts.outputsFile ?? DEFAULT_OUTPUTS_FILE;
  if (existsSync(outputsFile)) {
    const outputs = JSON.parse(readFileSync(outputsFile, 'utf8')) as Outputs;
    const frontend = Object.entries(outputs).find(([stack]) =>
      stack.startsWith('Acme-Frontend-'),
    );
    const url = frontend?.[1].AppUrl;
    if (url) return url;
  }

  throw new Error(
    [
      'No smoke target. Set SMOKE_URL, or deploy with',
      '`cdk deploy --outputs-file cdk-outputs-frontend.json` from infra/ so AppUrl can be read from infra/cdk-outputs-frontend.json.',
      'There is no default on purpose: a default can point at the wrong environment.',
    ].join(' '),
  );
}
