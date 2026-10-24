import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadKtConfig } from './config.js';
import { KtClient } from './kt/client.js';
import { createMcpServer } from './mcp/server.js';

try {
  const config = loadKtConfig();
  const lifetime = new AbortController();
  const kt = new KtClient({ email: config.ktEmail, password: config.ktPassword, domain: config.ktDomain }, lifetime.signal);
  const server = createMcpServer(kt);
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 7 * 1024 * 1024 });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void (async () => {
      lifetime.abort();
      await server.close();
      process.stdin.destroy();
    })().catch(() => {
      console.error('[mcp] stdio shutdown failed');
      process.exitCode = 1;
    });
  };
  // EOF is the portable MCP shutdown signal, including on Windows.
  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.server.onclose = shutdown;
  server.server.onerror = () => { console.error('[mcp] stdio protocol error'); };
  await server.connect(transport);
} catch (error) {
  process.stdin.destroy();
  console.error(`[mcp] stdio startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}
