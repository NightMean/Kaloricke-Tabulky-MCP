import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KtClient } from '../kt/client.js';
import { dryRun, entryId, guard, json, mutation, readOnly, requiredDate } from './shared.js';

export function registerRecipeTools(server: McpServer, kt: KtClient): void {
  server.registerTool('get_recipe', {
    description: 'Read a saved recipe’s ingredients, quantities, instructions, servings, preparation time and image metadata. meal_id comes from list_my_meals.',
    inputSchema: { meal_id: z.string().min(1) }, annotations: readOnly,
  }, guard('get_recipe', async ({ meal_id }) => json({ recipe: await kt.recipes.get(meal_id) })));
  server.registerTool('edit_recipe', {
    description: 'Edit a saved recipe while preserving unspecified fields and visibility. ingredients replaces the whole ingredient list. Omitted unit_id selects each food’s own base unit (g/ml). Instructions replace the step list; [] clears it. This does not change past diary entries.',
    inputSchema: { meal_id: z.string().min(1), title: z.string().min(1).max(250).optional(),
      instructions: z.array(z.string().max(10000)).max(100).optional(), servings: z.number().positive().max(1000).optional(),
      preparation_minutes: z.number().int().positive().max(10080).optional(),
      ingredients: z.array(z.object({ food_id: z.string().min(1), amount: z.number().positive(), unit_id: z.string().optional() })).min(1).max(100).optional(), dry_run: dryRun }, annotations: mutation,
  }, guard('edit_recipe', async ({ meal_id, title, instructions, servings, preparation_minutes, ingredients, dry_run }) => json(await kt.recipes.update(meal_id,
    { title, instructions, servings, preparationMinutes: preparation_minutes, ingredients: ingredients?.map(i => ({ foodId: i.food_id, amount: i.amount, unitId: i.unit_id })) }, dry_run))));
  server.registerTool('edit_diary_recipe', {
    description: 'Scale an existing logged recipe by factor relative to its CURRENT diary quantity. For example factor=0.5 halves what is already logged. This differs from log_meal.portions, which multiplies the whole saved recipe. Preserves the existing display unit; does not edit the saved recipe.',
    inputSchema: { date: requiredDate, entry_id: entryId, factor: z.number().positive().max(50), dry_run: dryRun }, annotations: mutation,
  }, guard('edit_diary_recipe', async ({ date, entry_id, factor, dry_run }) => json(await kt.recipes.editLogged(date, entry_id, factor, dry_run))));
  server.registerTool('upload_recipe_image', {
    description: 'Attach a PNG/JPEG image to a saved recipe. image_base64 must contain only base64 bytes (no data URL), maximum 5 MiB decoded. Supports validation-only dry_run. After an uncertain upload failure, inspect image metadata before retrying.',
    inputSchema: { meal_id: z.string().min(1), image_base64: z.string().min(1).max(7000000), content_type: z.enum(['image/png', 'image/jpeg']), dry_run: dryRun }, annotations: mutation,
  }, guard('upload_recipe_image', async ({ meal_id, image_base64, content_type, dry_run }) => json(await kt.recipes.uploadImage(meal_id, image_base64, content_type, dry_run))));
}
