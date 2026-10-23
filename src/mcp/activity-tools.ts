import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KtClient } from '../kt/client.js';
import { dryRun, entryId, guard, json, mutation, readOnly, requiredDate } from './shared.js';

export function registerActivityTools(server: McpServer, kt: KtClient): void {
  server.registerTool('search_activity', {
    description: 'Find physical activities in Czech/Slovak. Returns activity database IDs, not diary entry IDs. Pages start at zero.',
    inputSchema: { query: z.string().min(1).max(200), page: z.number().int().min(0).default(0) }, annotations: readOnly,
  }, guard('search_activity', async ({ query, page }) => json({ results: await kt.activities.search(query, page), page })));
  server.registerTool('get_activity', {
    description: 'Read a database activity form and its native duration unit before logging. Energy may be absent until recorded; it is not an estimated calorie preview.',
    inputSchema: { activity_id: entryId }, annotations: readOnly,
  }, guard('get_activity', async ({ activity_id }) => json({ activity: await kt.activities.form(activity_id) })));
  server.registerTool('log_activity', {
    description: 'Log an existing database activity for a date, in minutes (up to 1440). Optional time is HH:mm. Dry run validates the form without recording; it does not calculate burned energy. Check the diary before retrying after an uncertain network failure.',
    inputSchema: { activity_id: entryId, date: requiredDate, duration_minutes: z.number().positive().max(1440),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), dry_run: dryRun }, annotations: mutation,
  }, guard('log_activity', async ({ activity_id, date, duration_minutes, time, dry_run }) => json(await kt.activities.log({ id: activity_id, date, minutes: duration_minutes, time, dryRun: dry_run }))));
  server.registerTool('edit_diary_activity', {
    description: 'Replace the duration of one logged activity with an absolute number of minutes. Uses a diary activity entry ID from get_diary; supports dry_run. Delete it with delete_diary_entry kind=activity.',
    inputSchema: { entry_id: entryId, date: requiredDate, duration_minutes: z.number().positive().max(1440), dry_run: dryRun }, annotations: mutation,
  }, guard('edit_diary_activity', async ({ entry_id, date, duration_minutes, dry_run }) => json(await kt.activities.edit({ id: entry_id, date, minutes: duration_minutes, dryRun: dry_run }))));
}
