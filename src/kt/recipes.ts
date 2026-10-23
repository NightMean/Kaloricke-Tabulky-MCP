import { KtError, parseCzechNumber } from './client.js';
import type { DiaryApi } from './diary.js';
import { apiId, positive, record, records, type ApiRecord, type ApiRequest } from './api.js';

/** Ingredient counts drive nutrition; the selected unit/multiplier drives the diary label. */
export function scaleRecipeForm(raw: unknown, factor: number): ApiRecord {
  positive(factor, 'portions');
  const form = record(raw, 'meal add form');
  const ingredients = records(form['foodstuff'], 'meal add form');
  if (!ingredients.length) throw new KtError('meal add form: expected a recipe with ingredients');
  const percentUnit = records(form['units'], 'meal add form').find(unit => unit['multiplier'] === -1 && typeof unit['id'] === 'string');
  if (!percentUnit) throw new KtError('meal add form: no percentage unit available for recipe scaling');
  if (!Number.isFinite(factor * 100)) throw new KtError('Invalid portions: percentage exceeds the supported numeric range');
  const payload = { ...form, selectedUnitGuid: percentUnit['id'], selectedUnitMultiplier: factor * 100,
    foodstuff: ingredients.map((original, index) => {
      const item = { ...original };
      if (typeof item['selectedUnitGuidOriginal'] === 'string') item['selectedUnitGuid'] = item['selectedUnitGuidOriginal'];
      if (item['selected'] === false) return { ...item, count: 0 };
      const count = parseCzechNumber(item['countOriginal'] ?? item['count']);
      if (count === null || count < 0 || !Number.isFinite(count * factor)) {
        throw new KtError(`meal add form: ingredient ${index + 1} must have a finite, nonnegative original count`);
      }
      return { ...item, count: count * factor };
    }) };
  delete (payload as ApiRecord)['count'];
  return payload;
}

export interface RecipeChanges {
  title?: string;
  instructions?: string[];
  servings?: number;
  preparationMinutes?: number;
  ingredients?: Array<{ foodId: string; amount: number; unitId?: string }>;
}

export class RecipesApi {
  constructor(private readonly request: ApiRequest, private readonly diary: DiaryApi) {}

  private async form(id: string): Promise<ApiRecord> {
    const form = record(await this.request(`/user/settings/meal/edit/form/${apiId(id)}/?format=json`), 'recipe form');
    if (form['guid'] !== id || typeof form['title'] !== 'string') throw new KtError('Recipe form: recipe ID mismatch');
    records(form['items'], 'recipe ingredients');
    return form;
  }

  async get(id: string): Promise<ApiRecord> {
    const form = await this.form(id);
    return Object.fromEntries(['guid', 'title', 'description', 'portions', 'preparationTime', 'visibility', 'items', 'files', 'units', 'lang'].map(key => [key, form[key]]));
  }

  async update(id: string, changes: RecipeChanges, dryRun: boolean): Promise<ApiRecord> {
    if (!Object.values(changes).some(value => value !== undefined)) throw new KtError('Supply at least one recipe change');
    const form = await this.form(id);
    const payload = { ...form };
    if (changes.title !== undefined) {
      if (!changes.title.trim()) throw new KtError('Recipe title cannot be empty');
      payload['title'] = changes.title;
    }
    if (changes.instructions !== undefined) payload['description'] = changes.instructions.map(description => ({ description }));
    if (changes.servings !== undefined) payload['portions'] = String(positive(changes.servings, 'servings'));
    if (changes.preparationMinutes !== undefined) payload['preparationTime'] = positive(changes.preparationMinutes, 'preparation_minutes');
    if (changes.ingredients !== undefined) {
      if (!changes.ingredients.length) throw new KtError('A recipe needs ingredients');
      const items: ApiRecord[] = [];
      for (const ingredient of changes.ingredients) {
        positive(ingredient.amount, 'ingredient amount');
        const item = record(await this.request(`/recipe/form/item/${apiId(ingredient.foodId)}?format=json`), 'recipe ingredient');
        if (item['guid'] !== ingredient.foodId) throw new KtError('Recipe ingredient ID mismatch');
        const units = records(item['units'], 'recipe ingredient units');
        const unit = ingredient.unitId ?? units.find(unit => unit['multiplier'] === 1 || unit['multiplier'] === null)?.['id'];
        if (typeof unit !== 'string' || !units.some(option => option['id'] === unit)) throw new KtError('Recipe ingredient unit is unavailable');
        items.push({ ...item, selectedUnitGuid: unit, unitCount: ingredient.amount });
      }
      payload['items'] = items;
    }
    // Visibility and unrelated fields are preserved; metadata editing must not publish a private recipe.
    if (!dryRun) await this.request(`/user/settings/meal/detail/edit/${apiId(id)}?format=json`, { method: 'POST', body: payload });
    return { preview: dryRun, updated: !dryRun, meal_id: id, changes };
  }

  async editLogged(date: string, id: string, factor: number, dryRun: boolean): Promise<ApiRecord> {
    await this.diary.entry(date, id, 'food');
    const form = record(await this.request(`/user/diary/meal/edit/form/${apiId(id)}?format=json`), 'logged recipe form');
    if (form['guidDiary'] !== id) throw new KtError('Logged recipe form: entry ID mismatch');
    const multiplier = parseCzechNumber(form['selectedUnitMultiplier']);
    if (multiplier === null || multiplier <= 0 || !Number.isFinite(multiplier * factor) ||
      !records(form['units'], 'logged recipe units').some(unit => unit['id'] === form['selectedUnitGuid'])) {
      throw new KtError('Logged recipe form: unsupported current display quantity');
    }
    const payload = { ...scaleRecipeForm(form, factor), date, selectedUnitGuid: form['selectedUnitGuid'], selectedUnitMultiplier: multiplier * factor };
    if (!dryRun) await this.request('/user/meal/edit?format=json', { method: 'POST', body: payload });
    return { preview: dryRun, updated: !dryRun, date, entry_id: id, factor, note: 'Factor multiplies the current logged quantity, not the whole saved recipe.' };
  }

  async uploadImage(id: string, base64: string, type: 'image/png' | 'image/jpeg', dryRun: boolean): Promise<ApiRecord> {
    if (base64.length > 7_000_000 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new KtError('Expected base64 image data, maximum 5 MiB');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) throw new KtError('Image data is not canonical base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new KtError('Image size must be between 1 byte and 5 MiB');
    const valid = type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) throw new KtError('Image bytes do not match the declared PNG/JPEG content type');
    await this.form(id);
    if (!dryRun) {
      const body = new FormData();
      body.append('file', new Blob([new Uint8Array(bytes)], { type }), `recipe.${type === 'image/png' ? 'png' : 'jpg'}`);
      await this.request(`/user/settings/meal/detail/${apiId(id)}/image/create?format=json`, { method: 'POST', body });
    }
    return { preview: dryRun, uploaded: !dryRun, meal_id: id, size_bytes: bytes.length, content_type: type };
  }
}
