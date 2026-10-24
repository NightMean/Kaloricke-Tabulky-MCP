/**
 * The tool surface Claude sees.
 *
 * Designed around one flow: "I ate 3 eggs" → search → pick a portion unit →
 * log. Descriptions are prescriptive about *when* to call each tool, because
 * that is what drives correct tool selection.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDiaryTools } from './diary-tools.js';
import { registerStatisticsTools } from './statistics-tools.js';
import { registerActivityTools } from './activity-tools.js';
import { registerRecipeTools } from './recipe-tools.js';
import { registerPreferenceTools } from './preference-tools.js';
import { registerTemplateTools } from './template-tools.js';
import { registerMeasurementTools } from './measurement-tools.js';
import { registerExportTools } from './export-tools.js';
import { guard, json } from './shared.js';
import {
  GRAM_UNIT,
  baseUnitOf,
  KtClient,
  MEALS,
  type MealId,
  KtError,
  assertCzechDate,
  extractDaySummaryOverview,
  getMealName,
  todayCzech,
} from '../kt/client.js';

const MEAL_IDS = Object.keys(MEALS) as [MealId, ...MealId[]];

const mealDescription = `Which meal slot to file the entry under: ${Object.entries(MEALS)
  .map(([id, name]) => `${id} = ${name}`)
  .join(', ')}.`;

const dateDescription =
  'Date in dd.MM.yyyy format (Czech/Slovak style). Omit for today. Use this to log something the user ate on a previous day.';

const amountDescription = 'Number of units. Without unit_id, this means grams for solids or millilitres for drinks.';
const unitDescription = 'Unit ID from get_food_portions. Omit for the food’s base unit: grams for solids, millilitres for drinks.';

const dateSchema = z.string().superRefine((date, context) => {
  try {
    assertCzechDate(date);
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid date' });
  }
}).optional().describe(dateDescription);

export function registerTools(server: McpServer, kt: KtClient): void {
  registerDiaryTools(server, kt);
  registerStatisticsTools(server, kt);
  registerActivityTools(server, kt);
  registerRecipeTools(server, kt);
  registerPreferenceTools(server, kt);
  registerTemplateTools(server, kt);
  registerMeasurementTools(server, kt);
  registerExportTools(server, kt);
  server.registerTool(
    'search_food',
    {
      title: 'Search foods',
      description:
        'Find foods in the kaloricketabulky.cz / kaloricketabulky.sk database by name or barcode. Call this first whenever the user mentions eating something, to get the food id the other tools need. ' +
        'The database supports Czech and Slovak, so search terms in Czech or Slovak ("vejce" / "vajcia") work best. ' +
        'A 13-digit EAN barcode also works and resolves to the exact product. Drinks use this same database: voda, káva, džus or pivo.',
      inputSchema: {
        query: z.string().min(1).describe('Food name (Czech or Slovak works best) or a 13-digit EAN barcode.'),
        limit: z.number().int().min(1).max(25).optional().describe('Maximum results to return. Defaults to 10.'),
      },
    },
    guard('search_food', async ({ query, limit }) => {
      const hits = await kt.search(query, limit ?? 10);
      if (hits.length === 0) {
        return json({ results: [], hint: 'No matches. Try a different or more general Czech or Slovak term.' });
      }
      return json({ results: hits });
    }),
  );

  server.registerTool(
    'get_food_portions',
    {
      title: 'Get portion units for a food',
      description:
        'List the portion units a food supports (for example "kus (55 g)", "velký kus (60 g)") along with its default portion. ' +
        'Call this after search_food when the user gave a count rather than a weight ("3 eggs", "2 slices"), so you can log natural portions instead of guessing grams.',
      inputSchema: {
        food_id: z.string().min(1).describe('The food id returned by search_food.'),
      },
    },
    guard('get_food_portions', async ({ food_id }) => {
      const detail = await kt.getFoodDetail(food_id);
      return json({
        id: detail.id,
        title: detail.title,
        default: { amount: detail.defaultAmount, unit_id: detail.defaultUnitId },
        units: detail.units,
        base_unit_id: baseUnitOf(detail.units),
        ...(detail.units.some(unit => unit.id === GRAM_UNIT) ? { grams_unit_id: GRAM_UNIT } : {}),
        note: 'Omit unit_id to use base_unit_id: amounts are grams for solids or millilitres for drinks.',
      });
    }),
  );

  server.registerTool(
    'get_food_nutrition',
    {
      title: 'Get nutrition for a quantity',
      description:
        'Calculate calories and macros for a specific quantity of a food, without logging anything. ' +
        'Use this when the user asks what something contains, or to confirm a portion before logging it. The site does the scaling, so the numbers match its own diary exactly.',
      inputSchema: {
        food_id: z.string().min(1).describe('The food id returned by search_food.'),
        amount: z.number().positive().describe(amountDescription),
        unit_id: z.string().optional().describe(unitDescription),
      },
    },
    guard('get_food_nutrition', async ({ food_id, amount, unit_id }) => {
      const unit = unit_id ?? baseUnitOf((await kt.getFoodDetail(food_id)).units);
      return json(await kt.getNutrition(food_id, amount, unit));
    }),
  );

  server.registerTool(
    'log_food',
    {
      title: 'Log food to the diary',
      description:
        'Write an eating record into the user\'s kaloricketabulky.cz / kaloricketabulky.sk diary. This modifies their real diary. ' +
        'Drinks are logged here too and count toward the drinking target: half a litre of water is amount=500 with no unit_id. ' +
        'Set dry_run: true to preview calculated calories/macros without writing to the diary. ' +
        'Returns the nutrition that was logged (or previewed).',
      inputSchema: {
        food_id: z.string().min(1).describe('The food id returned by search_food.'),
        amount: z.number().positive().describe(amountDescription),
        unit_id: z.string().optional().describe(unitDescription),
        meal: z.enum(MEAL_IDS).describe(mealDescription),
        date: dateSchema,
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, previews calculated values without writing to the diary.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard('log_food', async ({ food_id, amount, unit_id, meal, date, dry_run }) => {
      const formattedDate = date ?? todayCzech();
      const unit = unit_id ?? baseUnitOf((await kt.getFoodDetail(food_id)).units);
      // A preview needs nutrition; a write can still succeed without this metadata.
      const nutritionRead = kt.getNutrition(food_id, amount, unit);
      const nutrition = await (dry_run ? nutritionRead : nutritionRead.catch(() => null));
      if (dry_run) {
        return json({
          preview: true,
          dry_run: true,
          meal: getMealName(meal, kt.baseUrl),
          date: formattedDate,
          amount,
          unit_id: unit,
          nutrition,
          note: 'Preview only — nothing was written to the diary. Call with dry_run: false (or omit dry_run) to commit.',
        });
      }
      await kt.logFood({ foodId: food_id, amount, unitId: unit, meal, date: formattedDate });
      return json({
        logged: true,
        dry_run: false,
        meal: getMealName(meal, kt.baseUrl),
        date: formattedDate,
        amount,
        unit_id: unit,
        nutrition,
      });
    }),
  );

  server.registerTool(
    'create_meal',
    {
      title: 'Create a saved recipe',
      description:
        'Save a recipe (the site calls it a "meal") built from existing foods, so it can be logged later in one step instead of ingredient by ingredient. ' +
        'Use this when the user describes something they cook regularly — a smoothie, a bread, a standard breakfast. ' +
        'Look each ingredient up with search_food first to get its id. ' +
        'IMPORTANT: `amount` counts units, not grams. Omit `unit_id` and `amount` means grams for solids and millilitres for liquids, which is what recipes are normally written in. ' +
        'If you do pass a unit_id from get_food_portions, then 2 with "porce (250 ml)" means 500 ml, not 2 ml.',
      inputSchema: {
        title: z.string().min(1).describe('Name for the recipe, e.g. "Ranní smoothie".'),
        ingredients: z
          .array(
            z.object({
              food_id: z.string().min(1).describe('Food id from search_food.'),
              amount: z.number().positive().describe('Number of units. With no unit_id this is grams or millilitres.'),
              unit_id: z
                .string()
                .optional()
                .describe('Optional unit id from get_food_portions. Omit for grams/millilitres.'),
            }),
          )
          .min(1)
          .describe('The ingredients, each with a quantity.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard('create_meal', async ({ title, ingredients }) => {
      const id = await kt.createMeal({
        title,
        ingredients: ingredients.map(i => ({ foodId: i.food_id, amount: i.amount, unitId: i.unit_id })),
      });
      // The recipe exists now; the read-back is best-effort decoration only.
      const created = (await kt.listMeals().catch(() => [])).find(m => m.id === id);
      return json({
        created: true,
        meal_id: id,
        title,
        total_energy: created && created.energy !== null ? `${created.energy} ${created.energyUnit}` : null,
        note: 'Energy is for the whole recipe. Log it with log_meal.',
      });
    }),
  );

  server.registerTool(
    'list_my_meals',
    {
      title: 'List saved recipes',
      description:
        "List the user's own saved recipes with their ids and total energy. Call this before log_meal to find the right recipe id, or when the user asks what recipes they have saved.",
      inputSchema: { page: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(100), query: z.string().max(200).default('') },
    },
    guard('list_my_meals', async ({ page, limit, query }) => {
      const meals = await kt.listMeals({ page, limit, query });
      return json({ meals, page, limit, may_have_more: meals.length === limit });
    }),
  );

  server.registerTool(
    'log_meal',
    {
      title: 'Log a saved recipe to the diary',
      description:
        "Log one of the user's saved recipes into their diary. Find the recipe id with list_my_meals first. " +
        'Supports full or partial portions (e.g. 1 for full, 0.5 for half, or 2 for double). ' +
        'Set dry_run: true to preview the recipe details without writing to the diary.',
      inputSchema: {
        meal_id: z.string().min(1).describe('Recipe id from list_my_meals.'),
        meal: z.enum(MEAL_IDS).describe(mealDescription),
        portions: z
          .number()
          .positive()
          .max(50)
          .optional()
          .default(1)
          .describe('Portion multiplier, e.g. 1 for full recipe, 0.5 for half portion, or 2 for double. Defaults to 1.'),
        date: dateSchema,
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, previews recipe details without writing to the diary.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard('log_meal', async ({ meal_id, meal, portions, date, dry_run }) => {
      const formattedDate = date ?? todayCzech();
      const portionCount = portions ?? 1;
      // Listing is required to preview a recipe, but not to log one by its id.
      const recipeRead = kt.listMeals();
      const recipes = await (dry_run ? recipeRead : recipeRead.catch(() => []));
      const logged = recipes.find(m => m.id === meal_id);
      const scaledEnergy =
        logged && logged.energy !== null
          ? `${Math.round(logged.energy * portionCount * 10) / 10} ${logged.energyUnit}`
          : null;

      if (dry_run) {
        if (!logged) throw new KtError(`Unknown saved recipe id ${meal_id}. Call list_my_meals to select an existing recipe.`);
        return json({
          preview: true,
          dry_run: true,
          recipe: logged?.title ?? meal_id,
          portions: portionCount,
          energy: scaledEnergy,
          meal: getMealName(meal, kt.baseUrl),
          date: formattedDate,
          note: 'Preview only — recipe was not written to diary. Call with dry_run: false to commit.',
        });
      }
      await kt.logMeal({ mealId: meal_id, meal, date: formattedDate, portions: portionCount });
      return json({
        logged: true,
        dry_run: false,
        recipe: logged?.title ?? meal_id,
        portions: portionCount,
        energy: scaledEnergy,
        meal: getMealName(meal, kt.baseUrl),
        date: formattedDate,
      });
    }),
  );

  server.registerTool(
    'delete_meal',
    {
      title: 'Delete a saved recipe',
      description:
        'Permanently delete one of the user\'s saved recipes. This cannot be undone, so confirm which recipe they mean before calling it. ' +
        'It removes the recipe only — diary entries already logged from it are untouched.',
      inputSchema: {
        meal_id: z.string().min(1).describe('Recipe id from list_my_meals.'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    guard('delete_meal', async ({ meal_id }) => {
      const before = (await kt.listMeals()).find(m => m.id === meal_id);
      if (!before) return json({ deleted: false, reason: 'No saved recipe with that id.' });
      await kt.deleteMeal(meal_id);
      return json({ deleted: true, title: before.title });
    }),
  );

  server.registerTool(
    'get_day_summary',
    {
      title: 'Get a day summary',
      description:
        'Read back totals and nutritional overview from the diary for one day — use this when the user asks how many calories they have left or how a day went. Use get_day_entries for what they actually ate. ' +
        'Returns structured overview (calories current/target/remaining, macros, water) alongside raw summary details.',
      inputSchema: {
        date: dateSchema,
      },
    },
    guard('get_day_summary', async ({ date }) => {
      const formattedDate = date ?? todayCzech();
      const raw = await kt.getDaySummary(formattedDate);
      const diary = await kt.getDiarySummary(formattedDate);
      const overview = extractDaySummaryOverview(raw, diary);
      return json({
        date: formattedDate,
        overview,
        summary: raw,
        raw,
      });
    }),
  );

  server.registerTool(
    'record_weight',
    {
      title: 'Record body weight',
      description:
        'Log user body weight in kilograms to Kalorické Tabulky. Writes to their weight tracking log for the specified date (defaults to today). ' +
        'Only call this when the user explicitly asks to record or log their weight; merely mentioning a weight is not permission to write it. ' +
        'Set dry_run: true to preview without writing.',
      inputSchema: {
        weight_kg: z.number().positive().max(500).describe('Body weight in kilograms, e.g. 78.5 or 82.'),
        date: dateSchema,
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, previews the weight entry without writing to Kalorické Tabulky.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard('record_weight', async ({ weight_kg, date, dry_run }) => {
      const formattedDate = date ?? todayCzech();
      if (dry_run) {
        return json({
          preview: true,
          dry_run: true,
          weight_kg,
          date: formattedDate,
          note: 'Preview only — no weight was recorded. Call with dry_run: false to commit.',
        });
      }
      const result = await kt.recordWeight(weight_kg, formattedDate);
      return json({
        recorded: true,
        dry_run: false,
        weight_kg: result.weight,
        date: result.date,
      });
    }),
  );

  server.registerTool(
    'get_weight_history',
    {
      title: 'Get weight history',
      description:
        'Retrieve recent body weight entries and history from Kalorické Tabulky monthly tracking statistics.',
      inputSchema: {
        date: dateSchema,
      },
    },
    guard('get_weight_history', async ({ date }) => {
      const formattedDate = date ?? todayCzech();
      const history = await kt.getWeightHistory(formattedDate);
      return json({
        date: formattedDate,
        entries: history,
      });
    }),
  );
}
