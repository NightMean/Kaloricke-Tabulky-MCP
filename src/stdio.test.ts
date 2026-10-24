import { strict as assert } from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entrypoint = fileURLToPath(new URL('./stdio.js', import.meta.url));
const credentials = { KT_EMAIL: 'test@example.invalid', KT_PASSWORD: 'test-fixture' };

test('stdio subprocess discovers tools, authenticates upstream, recovers and cancels requests', { timeout: 15000 }, async t => {
  let status = 200;
  let hold = false;
  let requestStarted!: () => void;
  let requestCancelled!: () => void;
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  const cancelled = new Promise<void>(resolve => { requestCancelled = resolve; });
  const paths: string[] = [];
  const upstream = createServer((req, res) => {
    paths.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login/create?format=json') {
      res.setHeader('Set-Cookie', 'JSESSIONID=stdio-fixture; Path=/');
      res.end(JSON.stringify({ code: 0, data: {} }));
    } else if (req.url === '/user/settings/profile/form?format=json') {
      assert.equal(req.headers.cookie, 'JSESSIONID=stdio-fixture');
      if (hold) {
        res.once('close', requestCancelled);
        requestStarted();
        return;
      }
      res.statusCode = status;
      res.end(JSON.stringify({ code: 0, data: { height: 180, lang: 'sk' } }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  // Only KT configuration is passed, independently of the developer's .env.
  const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint],
    env: { ...credentials, KT_BASE_URL: `http://127.0.0.1:${address.port}` }, stderr: 'pipe' });
  let diagnostics = '';
  transport.stderr!.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-8192); });
  const client = new Client({ name: 'stdio-acceptance', version: '0.0.0' });
  t.after(() => client.close());
  const protocolErrors: Error[] = [];
  client.onerror = error => { protocolErrors.push(error); };
  await client.connect(transport);
  assert.match(client.getInstructions()!, /natural portion unit/);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 45);
  assert.equal(new Set(tools.map(tool => tool.name)).size, 45);
  const result = await client.callTool({ name: 'get_profile', arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), { profile: { height: 180, lang: 'sk' } });
  assert.deepEqual(paths, ['/login/create?format=json', '/user/settings/profile/form?format=json']);
  status = 503;
  const failure = await client.callTool({ name: 'get_profile', arguments: {} });
  assert.equal(failure.isError, true);
  assert.match(JSON.stringify(failure.content), /HTTP 503/);
  status = 200;
  assert.notEqual((await client.callTool({ name: 'get_profile', arguments: {} })).isError, true);

  hold = true;
  const controller = new AbortController();
  const pending = client.callTool({ name: 'get_profile', arguments: {} }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending, /cancelled by test/);
  await started;
  controller.abort(new Error('cancelled by test'));
  await rejected;
  await cancelled;
  await client.ping();
  assert.deepEqual(protocolErrors, [], 'stdout must contain only MCP messages');
  assert.match(diagnostics, /\[tool\] get_profile -> ok/);
  assert.match(diagnostics, /\[tool\] get_profile -> failed/);
  assert.ok(!diagnostics.includes(credentials.KT_PASSWORD));
});

async function runToEof(env: Record<string, string>, beforeEof?: (child: ChildProcessWithoutNullStreams) => Promise<void>) {
  const child = spawn(process.execPath, [entrypoint], { env, stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout = (stdout + String(data)).slice(-8192); });
  child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-8192); });
  const closed = once(child, 'close');
  await beforeEof?.(child);
  child.stdin.end();
  const [code, signal] = await closed;
  return { code, signal, stdout, stderr };
}

test('stdio exits cleanly on stdin EOF without HTTP configuration or OAuth state', { timeout: 8000 }, async t => {
  const stateDir = await mkdtemp(join(tmpdir(), 'kt-stdio-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const result = await runToEof({ ...credentials, PUBLIC_URL: 'invalid', MCP_AUTH_PASSWORD: 'short', PORT: 'invalid', STATE_DIR: stateDir });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(await readdir(stateDir), []);
});

test('stdio EOF cancels a pending shared login and exits without forced termination', { timeout: 8000 }, async t => {
  let loginStarted!: () => void;
  let loginCancelled!: () => void;
  const started = new Promise<void>(resolve => { loginStarted = resolve; });
  const cancelled = new Promise<void>(resolve => { loginCancelled = resolve; });
  const upstream = createServer((req, res) => {
    req.resume();
    res.once('close', loginCancelled);
    loginStarted();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  const result = await runToEof({ ...credentials, KT_BASE_URL: `http://127.0.0.1:${address.port}` }, async child => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'eof-test', version: '0.0.0' },
    } }) + '\n');
    await once(child.stdout, 'data');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_profile', arguments: {} } }) + '\n');
    await started;
  });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  await cancelled;
  for (const line of result.stdout.trim().split('\n')) assert.equal(JSON.parse(line).jsonrpc, '2.0');
});

test('stdio fails clearly on missing KT credentials without writing to stdout', { timeout: 15000 }, async () => {
  for (const key of ['KT_EMAIL', 'KT_PASSWORD'] as const) {
    const env: Record<string, string> = { ...credentials };
    delete env[key];
    const result = await runToEof(env);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(`Missing required environment variable ${key}`));
    assert.ok(!result.stderr.includes(credentials.KT_PASSWORD));
  }
});
