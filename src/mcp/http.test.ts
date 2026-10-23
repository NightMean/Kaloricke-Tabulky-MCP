import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('HTTP accepts authenticated image-size payloads while bounding other requests', { timeout: 20000 }, async t => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const stateDir = await mkdtemp(join(tmpdir(), 'kt-http-'));
  const password = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url))], {
    env: { ...process.env, PORT: String(port), STATE_DIR: stateDir, PUBLIC_URL: 'https://mcp.example.invalid',
      MCP_AUTH_PASSWORD: password, KT_EMAIL: 'test@example.invalid', KT_PASSWORD: 'test-fixture', KT_DOMAIN: 'example.invalid' },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 18000, windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', data => { output = (output + String(data)).slice(-8192); });
  child.stderr.on('data', data => { output = (output + String(data)).slice(-8192); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(stateDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, signal: AbortSignal.timeout(5000) });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error('HTTP fixture exited before startup');
    try { if ((await request('/healthz')).ok) break; } catch { /* Wait for the local listener only. */ }
    if (attempt === 49) throw new Error(`HTTP fixture did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const large = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'upload_recipe_image',
    arguments: { meal_id: 'unused', image_base64: 'A'.repeat(1_200_000), content_type: 'image/png', dry_run: true } } });
  const unauthenticated = await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: large });
  await unauthenticated.arrayBuffer();
  assert.equal(unauthenticated.status, 401, 'Authenticate before parsing larger MCP bodies');

  const redirectUri = 'http://localhost/kt-test/callback';
  const registration = await request('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'HTTP limit test', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  assert.equal(registration.status, 201);
  const registered = await registration.json() as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const authorization = await request('/authorize', { method: 'POST', redirect: 'manual', body: new URLSearchParams({
    client_id: registered.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: 'caltrack:log', password, resource: 'https://mcp.example.invalid/mcp',
  }) });
  assert.equal(authorization.status, 302);
  const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
  const exchange = await request('/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code',
    code, code_verifier: verifier, client_id: registered.client_id, redirect_uri: redirectUri, resource: 'https://mcp.example.invalid/mcp' }) });
  assert.equal(exchange.status, 200);
  const token = await exchange.json() as { access_token: string };
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const client = new Client({ name: 'http-limit-test', version: '0.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers } }));
  const result = await client.callTool({ name: 'upload_recipe_image', arguments: {
    meal_id: 'unused', image_base64: 'A'.repeat(1_200_000), content_type: 'image/png', dry_run: true,
  } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Image bytes do not match/, 'The MCP tool must receive payloads larger than 1 MB');
  for (const [path, auth, body] of [
    ['/register', {}, large], ['/mcp', headers, JSON.stringify({ oversized: 'A'.repeat(7_400_000) })],
  ] as const) {
    const response = await request(path, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body });
    await response.arrayBuffer();
    assert.equal(response.status, 413, `${path} size limit`);
  }
});
