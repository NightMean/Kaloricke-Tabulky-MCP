import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KtClient } from '../kt/client.js';
import { registerTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

/** Both transports expose identical tools and agent instructions. */
export function createMcpServer(kt: KtClient): McpServer {
  const server = new McpServer(
    { name: 'kaloricketabulky', version },
    {
      instructions:
        'Logs food into the user\'s kaloricketabulky.cz / kaloricketabulky.sk diary. The food database supports Czech and Slovak searches. ' +
        'When the user gives a count rather than a weight ("3 eggs", "3 vajcia"), call get_food_portions and log a natural portion unit instead of estimating grams. ' +
        'Drinks, including water, are logged through search_food and log_food and count toward the drinking target. ' +
        'Use record_weight only when the user explicitly asks to record their weight; mentioning it alone does not authorize a write.',
    },
  );
  registerTools(server, kt);
  return server;
}
