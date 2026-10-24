#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

try {
  const { values } = parseArgs({
    options: {
      transport: { type: 'string', default: 'stdio' },
      env: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) {
    console.log(`kaloricke-tabulky-mcp ${version}

Usage: kaloricke-tabulky-mcp [options]

  --transport stdio|http  MCP transport (default: stdio)
  --env PATH             Load credentials/configuration from a local file
  -h, --help              Show this help
  -v, --version           Show the package version

Stdio requires KT_EMAIL and KT_PASSWORD. HTTP also requires PUBLIC_URL
(HTTPS) and MCP_AUTH_PASSWORD (at least 12 characters).
Existing environment variables take precedence over the file.
`);
  } else if (values.version) {
    console.log(version);
  } else {
    const transport = values.transport.toLowerCase();
    if (transport !== 'stdio' && transport !== 'http') {
      throw new Error('Expected --transport stdio or http');
    }
    if (values.env !== undefined) {
      const entries = parseEnv(readFileSync(values.env, 'utf8'));
      for (const [key, value] of Object.entries(entries)) process.env[key] ??= value;
    }
    if (transport === 'http') await import('./index.js');
    else await import('./stdio.js');
  }
} catch (error) {
  // Do not echo user-provided arguments or environment values into diagnostics.
  const code = (error as NodeJS.ErrnoException).code;
  const message = code === 'ENOENT' || code === 'EACCES'
    ? `Cannot read --env (${code}); check the path and file permissions`
    : code?.startsWith('ERR_PARSE_ARGS')
      ? 'Invalid command arguments; run with --help for usage'
      : error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`[mcp] ${message}`);
  process.exitCode = 1;
}
