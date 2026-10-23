import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KtClient } from '../kt/client.js';
import { dryRun, entryId, guard, json, mealIds, mutation, readOnly, requiredDate } from './shared.js';

export function registerDiaryTools(server: McpServer, kt: KtClient): void {
  server.registerTool('get_diary', {
    description: 'Read the complete diary for a date: meal slots, individual food/recipe entry IDs, quantities, activities and notes. Use these IDs for corrections; summary tools do not return them.',
    inputSchema: { date: requiredDate }, annotations: readOnly,
  }, guard('get_diary', async ({ date }) => { const diary = await kt.diary.get(date); return json({ date, diary: diary.raw }); }));
  server.registerTool('get_diary_food_units', {
    description: 'Read the current quantity and offered units for an existing diary food entry before editing it.',
    inputSchema: { date: requiredDate, entry_id: entryId }, annotations: readOnly,
  }, guard('get_diary_food_units', async ({ date, entry_id }) => json(await kt.diary.foodUnits(date, entry_id))));
  server.registerTool('edit_diary_food', {
    description: 'Replace an existing food entry quantity with an absolute amount in an offered unit. Omitted unit_id keeps its current unit. Read get_diary_food_units first. Saved recipe quantities use a separate recipe editor.',
    inputSchema: { date: requiredDate, entry_id: entryId, amount: z.number().positive(), unit_id: z.string().optional(), dry_run: dryRun }, annotations: mutation,
  }, guard('edit_diary_food', async ({ date, entry_id, amount, unit_id, dry_run }) => json(await kt.diary.editFood({ date, id: entry_id, amount, unitId: unit_id, dryRun: dry_run }))));
  server.registerTool('delete_diary_entry', {
    description: 'Permanently remove one logged food/recipe or activity entry from a specified date. This does not delete a saved recipe. Read get_diary to choose the exact entry ID.',
    inputSchema: { date: requiredDate, entry_id: entryId, kind: z.enum(['food', 'activity']), dry_run: dryRun }, annotations: mutation,
  }, guard('delete_diary_entry', async ({ date, entry_id, kind, dry_run }) => json(await kt.diary.delete({ date, id: entry_id, kind, dryRun: dry_run }))));
  server.registerTool('move_diary_food', {
    description: 'Move a logged food/recipe to another meal slot OR another date. Supply exactly one destination: meal or target_date. Existing quantity is preserved.',
    inputSchema: { date: requiredDate, entry_id: entryId, meal: z.enum(mealIds).optional(), target_date: requiredDate.optional(), dry_run: dryRun }, annotations: mutation,
  }, guard('move_diary_food', async ({ date, entry_id, meal, target_date, dry_run }) => json(await kt.diary.move({ date, id: entry_id, meal, targetDate: target_date, dryRun: dry_run }))));
  server.registerTool('copy_diary_entries', {
    description: 'Copy explicitly selected food/recipe and activity entry IDs to a different date, preserving their meal slots. Adds entries; it does not replace the destination. After an uncertain failure, inspect the destination before retrying.',
    inputSchema: { date: requiredDate, target_date: requiredDate, entry_ids: z.array(entryId).min(1).max(100), dry_run: dryRun }, annotations: mutation,
  }, guard('copy_diary_entries', async ({ date, target_date, entry_ids, dry_run }) => json(await kt.diary.copy({ date, targetDate: target_date, ids: entry_ids, dryRun: dry_run }))));
}
