import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

test('packed production package runs without source or development dependencies', { timeout: 180000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kt-package-'));
  let client;
  let child;
  let closed;
  t.after(async () => {
    await client?.close();
    if (child) { child.kill(); await closed; }
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const npm = (args, cwd) => exec(process.execPath, [process.env.npm_execpath, ...args], {
    cwd, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  // Exercise the real prepack lifecycle and install the artifact as a consumer.
  await npm(['pack', '--pack-destination', directory], root);
  const archive = (await readdir(directory)).find(name => name.endsWith('.tgz'));
  assert.ok(archive);
  await npm(['install', '--prefix', directory, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, archive)], directory);
  const installed = join(directory, 'node_modules', manifest.name);
  const packaged = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(packaged.version, manifest.version);
  assert.equal(packaged.bin[manifest.name], 'dist/cli.js');
  const files = await readdir(installed, { recursive: true });
  assert.ok(files.includes('LICENSE'));
  assert.ok(files.includes('.env.example'));
  assert.ok(files.includes('README.en.md'));
  assert.ok(files.includes('HOSTING.md'));
  assert.ok(files.some(file => /dist[/\\]mcp[/\\]server.js$/.test(file)));
  assert.equal(files.some(file => /(^|[/\\])(src|test|node_modules|data|\.scratch|AGENTS\.md|\.env)$|\.test\.js$|\.map$/.test(file)), false);
  assert.equal((await readdir(join(directory, 'node_modules'))).includes('typescript'), false);
  const entry = join(installed, 'dist', 'cli.js');
  assert.equal((await npm(['exec', '--offline', '--prefix', directory, '--', manifest.name, '--version'], directory)).stdout.trim(), manifest.version);
  const run = args => exec(process.execPath, [entry, ...args], { cwd: directory, timeout: 5000, windowsHide: true });
  assert.equal((await run(['--version'])).stdout.trim(), manifest.version);
  assert.match((await run(['-h'])).stdout, /--transport stdio\|http/);
  await assert.rejects(run(['--transport', 'invalid']), error => error.code === 1 && /Expected --transport/.test(error.stderr) && error.stdout === '');
  await assert.rejects(run(['--unknown=private-value']), error => error.code === 1 && !error.stderr.includes('private-value'));
  await assert.rejects(run(['--env', 'missing.env']), error => error.code === 1 && /Cannot read --env/.test(error.stderr));

  const envFile = join(directory, 'account with spaces.env');
  await writeFile(envFile, 'KT_EMAIL=fixture@example.invalid\nKT_PASSWORD=fixture-password\nPUBLIC_URL=http://ignored.invalid\nPORT=invalid\nMCP_AUTH_PASSWORD=short\n');
  for (const settings of [
    { args: [entry], env: { KT_EMAIL: 'fixture@example.invalid', KT_PASSWORD: 'fixture-password' } },
    { args: [entry, '--env', envFile, '--transport', 'STDIO'] },
  ]) {
    const transport = new StdioClientTransport({ command: process.execPath, ...settings, stderr: 'pipe' });
    let diagnostics = '';
    transport.stderr.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-8192); });
    client = new Client({ name: 'package-acceptance', version: '0.0.0' });
    await client.connect(transport);
    assert.equal(client.getServerVersion().version, manifest.version);
    assert.equal((await client.listTools()).tools.length, 48);
    await client.ping();
    await client.close();
    assert.equal(diagnostics, '', 'stdio must start without diagnostics or a banner');
  }

  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  const env = { ...process.env, KT_EMAIL: 'fixture@example.invalid', KT_PASSWORD: 'fixture-password',
    PUBLIC_URL: 'https://package.example.invalid', MCP_AUTH_PASSWORD: 'fixture-consent-password',
    PORT: String(port), STATE_DIR: join(directory, 'state') };
  child = spawn(process.execPath, [entry, '--transport', 'HTTP', '--env', envFile], {
    cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, windowsHide: true,
  });
  closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-8192); });
  await Promise.race([
    once(child.stdout, 'data'),
    closed.then(() => { throw new Error(`Packaged HTTP process exited: ${stderr}`); }),
  ]);
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', endpoint: 'https://package.example.invalid/mcp' });
  const denied = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  assert.equal(denied.status, 401);
});
