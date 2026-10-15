// e2e/lib/backend-from-bundle.ts
import type { APIRequestContext } from '@playwright/test';

export interface DeployedBackend {
  runtimeArn: string;
  apiUrls: string[];
}

export async function discoverBackend(appUrl: string, request: APIRequestContext): Promise<DeployedBackend> {
  const html = await (await request.get(appUrl)).text();
  const scriptPath = html.match(/src="([^"]*\/static\/js\/[^"]+\.js)"/)?.[1];
  if (!scriptPath) throw new Error(`No JS bundle found in the HTML served at ${appUrl}`);

  const bundle = await (await request.get(new URL(scriptPath, appUrl).toString())).text();
  const runtimeArn = bundle.match(/arn:aws:bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\/[A-Za-z0-9_-]+/)?.[0];
  const apiUrls = [...new Set(bundle.match(/https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com/g) ?? [])];
  if (!runtimeArn) throw new Error('The bundle does not contain a runtime ARN: the build did not bake the backend outputs.');
  if (apiUrls.length === 0) throw new Error('The bundle does not contain an execute-api URL: the build did not bake the backend outputs.');
  return { runtimeArn, apiUrls };
}

/** Maps each API to its service by asking /health, so specs never guess which URL is which. */
export async function apiOf(service: string, apiUrls: string[], request: APIRequestContext): Promise<string> {
  for (const url of apiUrls) {
    const health = await request.get(`${url}/health`);
    if (health.ok() && (await health.json()).service === service) return url;
  }
  throw new Error(`No API answered /health with service=${service}`);
}
