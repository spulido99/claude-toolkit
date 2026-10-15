// infra/test/github-oidc-stack.test.ts
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GithubOidcStack } from '../lib/github-oidc-stack';

type Statement = { Action: string | string[]; Effect: string; Sid?: string };

function actionsOf(template: Template, roleNamePart: string): string[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const out: string[] = [];
  for (const policy of Object.values(policies)) {
    const roles = JSON.stringify((policy as any).Properties.Roles);
    if (!roles.includes(roleNamePart)) continue;
    const statements: Statement[] = (policy as any).Properties.PolicyDocument.Statement;
    for (const s of statements) {
      if (s.Effect === 'Allow') out.push(...[s.Action].flat());
    }
  }
  return out;
}

describe('e2e reports bucket access', () => {
  const template = Template.fromStack(new GithubOidcStack(new App(), 'Test'));

  it('staging can PutObject and cannot read verdicts', () => {
    const actions = actionsOf(template, 'StagingRole');
    expect(actions).toContain('s3:PutObject');
    expect(actions).not.toContain('s3:GetObject');
  });

  it('production can read and list verdicts and cannot write them, so a prod deploy cannot forge its own evidence', () => {
    const actions = actionsOf(template, 'ProdRole');
    expect(actions).toContain('s3:GetObject');
    expect(actions).toContain('s3:ListBucket');
    expect(actions).not.toContain('s3:PutObject');
  });
});
