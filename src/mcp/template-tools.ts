import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KtClient } from '../kt/client.js';
import { dryRun, guard, json, mutation, readOnly, requiredDate } from './shared.js';

const templateId = z.string().regex(/^[a-zA-Z0-9_-]+$/).describe('An owned template ID from list_templates.');
export function registerTemplateTools(server: McpServer, kt: KtClient): void {
  server.registerTool('list_templates', { description: 'List this account’s saved diary templates.', inputSchema: {}, annotations: readOnly },
    guard('list_templates', async () => json({ templates: await kt.templates.list() })));
  server.registerTool('get_template', { description: 'Read an owned diary template including meal slots, foods, activities and notes.', inputSchema: { template_id: templateId }, annotations: readOnly },
    guard('get_template', async ({ template_id }) => json({ template: await kt.templates.get(template_id) })));
  server.registerTool('create_template_from_diary', {
    description: 'Save ALL foods from one diary date as a new template. Optionally include that day’s activities and notes. Does not change the source diary. Supports dry_run; inspect list_templates before retrying an uncertain creation.',
    inputSchema: { date: requiredDate, title: z.string().min(1).max(250), include_activities: z.boolean().default(false), include_notes: z.boolean().default(false), dry_run: dryRun }, annotations: mutation,
  }, guard('create_template_from_diary', async ({ date, title, include_activities, include_notes, dry_run }) => json(await kt.templates.create(date, title, include_activities, include_notes, dry_run))));
  server.registerTool('apply_template', {
    description: 'Add an owned template at its saved quantities to one date in this account. Preserves existing diary entries; does not overwrite the day. Supports dry_run. Read the destination diary before retrying an uncertain application.',
    inputSchema: { template_id: templateId, date: requiredDate, dry_run: dryRun }, annotations: mutation,
  }, guard('apply_template', async ({ template_id, date, dry_run }) => json(await kt.templates.apply(template_id, date, dry_run))));
  server.registerTool('delete_template', { description: 'Delete an owned saved template without removing past diary entries; supports dry_run.', inputSchema: { template_id: templateId, dry_run: dryRun }, annotations: mutation },
    guard('delete_template', async ({ template_id, dry_run }) => json(await kt.templates.delete(template_id, dry_run))));
}
