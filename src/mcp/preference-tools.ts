import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KtClient } from '../kt/client.js';
import { dryRun, guard, json, mutation, readOnly } from './shared.js';

const kind = z.enum(['foodstuff', 'activity']);
export function registerPreferenceTools(server: McpServer, kt: KtClient): void {
  server.registerTool('get_favorites', {
    description: 'Read favorite foods or activities for this account.', inputSchema: { kind }, annotations: readOnly,
  }, guard('get_favorites', async ({ kind }) => json({ kind, results: await kt.preferences.catalog(kind) })));
  server.registerTool('get_common_items', {
    description: 'Read the website’s commonly used foods or activities for this account.', inputSchema: { kind }, annotations: readOnly,
  }, guard('get_common_items', async ({ kind }) => json({ kind, results: await kt.preferences.catalog(kind, true) })));
  server.registerTool('set_favorite', {
    description: 'Set a database food or activity as favorite, or remove it from favorites. Uses the item ID from search, not a diary entry ID. Checks current membership; supports dry_run.',
    inputSchema: { kind, item_id: z.string().regex(/^[a-zA-Z0-9_-]+$/), enabled: z.boolean(), dry_run: dryRun }, annotations: mutation,
  }, guard('set_favorite', async ({ kind, item_id, enabled, dry_run }) => json(await kt.preferences.favorite(kind, item_id, enabled, dry_run))));
  server.registerTool('get_profile', {
    description: 'Read nutrition-related profile settings and goals. Excludes email, passwords, payment identifiers and external-account links. This tool does not edit settings.',
    inputSchema: {}, annotations: readOnly,
  }, guard('get_profile', async () => json({ profile: await kt.preferences.profile() })));
}
