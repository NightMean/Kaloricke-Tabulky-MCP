import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { apiOperation } from '../kt/api.js';
import { assertCzechDate, MEALS, type MealId } from '../kt/client.js';

export const mealIds = Object.keys(MEALS) as [MealId, ...MealId[]];
export const requiredDate = z.string().superRefine((date, context) => {
  try { assertCzechDate(date); }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid date' }); }
}).describe('Calendar date in dd.MM.yyyy format.');
export const entryId = z.string().regex(/^[a-zA-Z0-9_-]+$/).describe('Diary entry ID returned by get_diary, not a food or recipe ID.');
export const dryRun = z.boolean().default(false).describe('Preview without changing the account. False writes immediately.');
export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const mutation = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/** Log operation outcomes, never food diaries, profile fields, or request bodies. */
export function guard<Args, Result extends CallToolResult>(name: string, fn: (args: Args) => Promise<Result>) {
  return async (args: Args, extra?: { signal: AbortSignal }) => {
    try {
      const result = await (extra ? apiOperation.run(extra.signal, () => {
        extra.signal.throwIfAborted();
        return fn(args);
      }) : fn(args));
      console.log(`[tool] ${name} -> ok`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tool] ${name} -> failed`);
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
    }
  };
}
