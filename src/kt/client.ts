/**
 * Client for the private JSON API behind www.kaloricketabulky.cz.
 *
 * The site is a Spring MVC app where any route accepts `?format=json` and
 * replies with a `{code, data, message}` envelope (`code: 0` means success).
 * Auth is a JSESSIONID cookie obtained by posting an md5 of the password.
 *
 * None of this is documented or guaranteed by Dine4Fit. Every call that
 * deviates from the shape we expect throws rather than guessing, so a
 * frontend change surfaces as a loud error instead of a wrong calorie count.
 */

import { createHash } from 'node:crypto';
import { DiaryApi } from './diary.js';
import { StatisticsApi } from './statistics.js';
import { ActivitiesApi } from './activities.js';
import { RecipesApi, scaleRecipeForm } from './recipes.js';
import { PreferencesApi } from './preferences.js';
import { TemplatesApi } from './templates.js';
import { MeasurementsApi } from './measurements.js';
import { ExportsApi, readExportBytes } from './exports.js';

export const DEFAULT_BASE_URL = 'https://www.kaloricketabulky.cz';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** unitGuid for plain grams — accepted by every solid food. */
export const GRAM_UNIT = '0000000000000001';

/**
 * Pseudo-unit meaning "one portion of this recipe", offered only by the
 * meal-add form (alongside `0000000000000003` for percent).
 */
export const PORTION_UNIT = '0000000000000004';

/** Diary time slots, keyed by the `diaryTimeGuid` the site expects. */
export const MEALS = {
  '1': 'Snídaně / Raňajky',
  '2': 'Dopolední svačina / Desiata',
  '3': 'Oběd / Obed',
  '4': 'Odpolední svačina / Olovrant',
  '5': 'Večeře / Večera',
  '6': 'Druhá večeře / Druhá večera',
} as const;

export type MealId = keyof typeof MEALS;

export const MEAL_NAMES_CZ: Record<MealId, string> = {
  '1': 'Snídaně',
  '2': 'Dopolední svačina',
  '3': 'Oběd',
  '4': 'Odpolední svačina',
  '5': 'Večeře',
  '6': 'Druhá večeře',
};

export const MEAL_NAMES_SK: Record<MealId, string> = {
  '1': 'Raňajky',
  '2': 'Desiata',
  '3': 'Obed',
  '4': 'Olovrant',
  '5': 'Večera',
  '6': 'Druhá večera',
};

export function getMealName(mealId: MealId, domainOrBaseUrl?: string): string {
  const isSk = typeof domainOrBaseUrl === 'string' && domainOrBaseUrl.toLowerCase().includes('.sk');
  return (isSk ? MEAL_NAMES_SK : MEAL_NAMES_CZ)[mealId] ?? MEAL_NAMES_CZ[mealId];
}

export function normalizeKtBaseUrl(input?: string): string {
  if (!input || input.trim() === '') {
    return DEFAULT_BASE_URL;
  }
  let trimmed = input.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed);
    url.search = '';
    url.hash = '';
    return url.origin;
  }
  trimmed = trimmed.replace(/^www\./i, '').replace(/\/+$/, '');
  return `https://www.${trimmed}`;
}

export interface FoodHit {
  id: string;
  title: string;
  /** Energy per 100 g / 100 ml, as the site reports it in search results. */
  energyPer100: number | null;
  energyUnit: string;
  baseUnit: string;
  brand: string | null;
}

export interface UnitOption {
  id: string;
  title: string;
  /** Grams (or ml) that one of this unit corresponds to. */
  grams: number;
}

export interface FoodDetail {
  id: string;
  title: string;
  units: UnitOption[];
  /** The site's own default portion for this food. */
  defaultUnitId: string;
  defaultAmount: number;
}

export interface Nutrition {
  title: string;
  energy: number | null;
  energyUnit: string;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  sugar: number | null;
  fibre: number | null;
  saturatedFat: number | null;
  salt: number | null;
}

export interface MealSummary {
  id: string;
  title: string;
  /** Energy for the whole recipe, not per portion. */
  energy: number | null;
  energyUnit: string;
  portions: number;
}

export interface WeightRecord {
  date: string;
  weight: number;
}

export class KtError extends Error {}

/**
 * A food's base unit — the one whose multiplier is 1 (the site sends `null`
 * for it). Grams for solids, millilitres for liquids, and a liquid's unit list
 * does not contain the gram unit at all, so this must be read per food rather
 * than assumed.
 */
export function baseUnitOf(units: UnitOption[]): string {
  return units.find(u => u.grams === 0 || u.grams === 1)?.id ?? GRAM_UNIT;
}

/**
 * Czech number formatting: decimal comma, thin/regular space as the thousands
 * separator ("1 043", "20,43"). Returns null for absent or unparseable values
 * rather than a misleading 0.
 */
export function parseCzechNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalised = value.replace(/[\s  ]/g, '').replace(',', '.');
  if (normalised === '') return null;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

export interface SummaryMetric {
  current: number | null;
  target: number | null;
  unit: string | null;
}

export interface DaySummaryOverview {
  energy: (SummaryMetric & { remaining: number | null }) | null;
  macros: Record<'protein' | 'carbs' | 'fat' | 'fiber', SummaryMetric>;
  water: SummaryMetric | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function summaryData(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  return 'data' in raw ? (isRecord(raw['data']) ? raw['data'] : null) : raw;
}

function waterMetric(current: unknown, target: unknown, sourceUnit: unknown): SummaryMetric | null {
  const unit = typeof sourceUnit === 'string' ? sourceUnit : null;
  const scale = unit === 'l' ? 1000 : 1;
  const amount = (value: unknown) => {
    const parsed = parseCzechNumber(value);
    const scaled = parsed === null ? null : parsed * scale;
    return scaled !== null && Number.isFinite(scaled) ? scaled : null;
  };
  const currentAmount = amount(current);
  const targetAmount = amount(target);
  return currentAmount === null && targetAmount === null ? null : {
    current: currentAmount, target: targetAmount, unit: unit === 'l' ? 'ml' : unit,
  };
}

/** Energy comes from statistics; diary rows provide macro goals and more precise water values. */
export function extractDaySummaryOverview(raw: unknown, diaryRaw?: unknown): DaySummaryOverview | null {
  const data = summaryData(raw);
  if (!data) return null;
  const diary = summaryData(diaryRaw);
  const groups = diary?.['itemsDynamic'];
  const nutrients = Array.isArray(groups) ? groups.flatMap(group => Array.isArray(group) ? group.filter(isRecord) : []) : [];
  const macro = (code: string): SummaryMetric => {
    const item = nutrients.find(row => row['code'] === code);
    return {
      current: parseCzechNumber(item?.['actualValue']) ?? parseCzechNumber(item?.['actual']),
      target: parseCzechNumber(item?.['goal']),
      unit: typeof item?.['unit'] === 'string' ? item['unit'] : null,
    };
  };

  const energy = parseCzechNumber(data['todayEnergy']);
  const energyTarget = parseCzechNumber(data['todayEnergyTarget']);
  const statisticsWater = waterMetric(data['todayDrink'], data['todayDrinkTarget'], data['drinkUnit']);
  const items = diary?.['items'];
  // This row has no code on the site; its volume unit distinguishes it from energy and weight.
  const drinkItem = Array.isArray(items)
    ? items.find((item: unknown) => isRecord(item) && (item['unit'] === 'l' || item['unit'] === 'ml'))
    : undefined;
  // The site's water actualValue may be 0 even when actual contains a nonzero amount.
  const diaryWater = isRecord(drinkItem) ? waterMetric(drinkItem['actual'], drinkItem['goal'], drinkItem['unit']) : null;
  const compatibleFallback = statisticsWater && statisticsWater.unit === diaryWater?.unit ? statisticsWater : null;
  const water = diaryWater ? {
    ...diaryWater,
    current: diaryWater.current ?? compatibleFallback?.current ?? null,
    target: diaryWater.target ?? compatibleFallback?.target ?? null,
  } : statisticsWater;

  return {
    energy:
      energy !== null || energyTarget !== null
        ? {
            current: energy,
            target: energyTarget,
            remaining:
              energy !== null && energyTarget !== null ? Math.round((energyTarget - energy) * 10) / 10 : null,
            unit: typeof data['energyUnit'] === 'string' ? data['energyUnit'] : null,
          }
        : null,
    macros: {
      protein: macro('protein'),
      carbs: macro('carbohydrate'),
      fat: macro('fat'),
      fiber: macro('fiber'),
    },
    water,
  };
}

/** The site formats dates as dd.MM.yyyy everywhere. */
export function formatCzechDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

export function todayCzech(): string {
  // The diary runs on Czech wall-clock time; the server usually doesn't
  // (containers default to UTC, which would flip the date around midnight).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

/**
 * Dates come from the model, and one of them ends up in a URL path, so accept
 * only real calendar dates in the site's own dd.MM.yyyy shape.
 */
export function assertCzechDate(date: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  const day = Number(match?.[1]);
  const month = Number(match?.[2]);
  const year = Number(match?.[3]);
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (!match || year < 1 || calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error(`Invalid date "${date}" — expected a real date in dd.MM.yyyy, e.g. ${todayCzech()}`);
  }
  return date;
}

export interface KtCredentials {
  email: string;
  password: string;
  domain?: string;
  baseUrl?: string;
}

export class KtClient {
  readonly diary = new DiaryApi((path, init) => this.authed(path, init));
  readonly statistics = new StatisticsApi((path, init) => this.authed(path, init));
  readonly activities = new ActivitiesApi((path, init) => this.authed(path, init), this.diary);
  readonly recipes = new RecipesApi((path, init) => this.authed(path, init), this.diary);
  readonly preferences = new PreferencesApi((path, init) => this.authed(path, init));
  readonly templates = new TemplatesApi((path, init) => this.authed(path, init));
  readonly measurements = new MeasurementsApi((path, init) => this.authed(path, init), this.statistics);
  readonly exports = new ExportsApi(async path => {
    const response = await this.authedRequest(path, {}, true);
    if (response.status < 200 || response.status >= 300 || !response.bytes) throw new KtError(`Export request failed: HTTP ${response.status}`);
    return response.bytes;
  });
  private cookie: string | null = null;
  private loginInFlight: Promise<void> | null = null;
  readonly baseUrl: string;

  constructor(private readonly credentials: KtCredentials) {
    this.baseUrl = normalizeKtBaseUrl(credentials.baseUrl ?? credentials.domain);
  }

  private async request(
    path: string,
    init: { method?: string; body?: unknown } = {},
    binary = false,
  ): Promise<{ status: number; redirectedToLogin: boolean; text: string; bytes?: Buffer }> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: 'application/json',
    };
    if (this.cookie) headers['Cookie'] = this.cookie;
    const multipart = init.body instanceof FormData;
    if (init.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';

    const response = await fetch(this.baseUrl + path, {
      method: init.method ?? 'GET',
      headers,
      body: multipart ? init.body as FormData : init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
      redirect: 'manual',
    });

    // Capture a rotated session cookie whenever the site issues one.
    const setCookie = response.headers.getSetCookie?.() ?? [];
    const jsession = setCookie.find(c => c.startsWith('JSESSIONID='));
    if (jsession) this.cookie = jsession.split(';')[0] ?? null;

    // Spring Security answers unauthenticated /user/** with a 302 to /login.
    const location = response.headers.get('location') ?? '';
    const redirectedToLogin = response.status >= 300 && response.status < 400 && location.includes('/login');

    if (!response.ok && !redirectedToLogin) {
      await response.body?.cancel();
      throw new KtError(`${path}: HTTP ${response.status}`);
    }

    return binary
      ? { status: response.status, redirectedToLogin, text: '', bytes: await readExportBytes(response) }
      : { status: response.status, redirectedToLogin, text: await response.text() };
  }

  private parseEnvelope(text: string, context: string): unknown {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new KtError(`${context}: expected JSON, got ${text.slice(0, 120)}`);
    }
    // Two envelope shapes exist: most routes send {code, message, data}, but
    // some list endpoints send {requestId, count, data} with no code at all.
    // Unwrap `data` whenever it is present, and only enforce `code` when it is.
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const envelope = body as { code?: number; message?: string; data?: unknown };
      if (typeof envelope.code === 'number' && envelope.code !== 0) {
        throw new KtError(`${context}: ${envelope.message ?? `code ${envelope.code}`}`);
      }
      if ('data' in envelope && envelope.data !== null) return envelope.data;
    }
    return body;
  }

  /** Logs in, reusing an in-flight attempt so concurrent tool calls don't stampede. */
  private async login(): Promise<void> {
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = (async () => {
      this.cookie = null;
      const passwordHash = createHash('md5').update(this.credentials.password).digest('hex');
      const { text } = await this.request('/login/create?format=json', {
        method: 'POST',
        body: { email: this.credentials.email, password: passwordHash },
      });
      this.parseEnvelope(text, 'login');
      if (!this.cookie) throw new KtError('login succeeded but no session cookie was issued');
    })().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  /** Runs an authenticated call, logging in on first use and once on session expiry. */
  private async authedRequest(
    path: string,
    init: { method?: string; body?: unknown } = {},
    binary = false,
  ) {
    if (!this.cookie) await this.login();
    let result = await this.request(path, init, binary);
    if (result.redirectedToLogin) {
      await this.login();
      result = await this.request(path, init, binary);
      if (result.redirectedToLogin) throw new KtError(`${path}: still unauthenticated after re-login`);
    }
    return result;
  }

  private async authed(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    return this.parseEnvelope((await this.authedRequest(path, init)).text, path);
  }

  /**
   * Full-text or EAN search. Works anonymously, so no login is forced here.
   * A 13-digit barcode resolves to the matching product.
   */
  async search(query: string, limit = 10): Promise<FoodHit[]> {
    const { text } = await this.request(
      `/autocomplete/foodstuff-activity-meal?format=json&query=${encodeURIComponent(query)}`,
    );
    const data = this.parseEnvelope(text, 'search');
    if (!Array.isArray(data)) throw new KtError('search: expected an array of results');

    return data
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && (row as Record<string, unknown>)['clazz'] === 'foodstuff')
      .slice(0, limit)
      .map(row => ({
        id: String(row['id']),
        title: String(row['title']),
        energyPer100: parseCzechNumber(row['value']),
        energyUnit: typeof row['energyUnit'] === 'string' ? row['energyUnit'] : 'kcal',
        baseUnit: typeof row['unit'] === 'string' ? row['unit'] : 'g',
        brand: typeof row['brandName'] === 'string' ? row['brandName'] : null,
      }));
  }

  /**
   * The site's own add-entry form for a food. This is the source of truth for
   * which portion units exist ("kus (55 g)"), so "3 eggs" maps onto the site's
   * model instead of us guessing gram weights.
   */
  async getFoodDetail(foodId: string): Promise<FoodDetail> {
    const { text } = await this.request(
      `/foodstuff/detail/form/${encodeURIComponent(foodId)}?format=json&default=true`,
    );
    const form = this.parseEnvelope(text, 'food detail') as Record<string, unknown>;
    if (typeof form['guid'] !== 'string') throw new KtError(`food detail: unknown food id ${foodId}`);

    const rawUnits = Array.isArray(form['unitOptions']) ? form['unitOptions'] : [];
    const units: UnitOption[] = rawUnits
      .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
      .map(u => ({
        id: String(u['id']),
        title: String(u['title']),
        grams: parseCzechNumber(u['multiplier']) ?? 0,
      }));
    // The site echoes back whatever guid is requested, even for foods that do
    // not exist, so the guid check above no longer catches bad ids. A real
    // food always offers at least its base unit; an empty list means the id
    // is unknown.
    if (units.length === 0) throw new KtError(`food detail: unknown food id ${foodId}`);

    return {
      id: form['guid'],
      title: String(form['title'] ?? ''),
      units,
      defaultUnitId: typeof form['unitGuid'] === 'string' ? form['unitGuid'] : GRAM_UNIT,
      defaultAmount: parseCzechNumber(form['multiplier']) ?? 100,
    };
  }

  /** Nutrition for a given quantity, scaled server-side by the site itself. */
  async getNutrition(foodId: string, amount: number, unitId: string): Promise<Nutrition> {
    const { text } = await this.request(
      `/foodstuff/detail/${encodeURIComponent(foodId)}/${amount}/${encodeURIComponent(unitId)}?format=json`,
    );
    const data = this.parseEnvelope(text, 'nutrition') as Record<string, unknown>;
    const food = data['foodstuff'];
    if (!food || typeof food !== 'object') throw new KtError('nutrition: response had no foodstuff block');
    const f = food as Record<string, unknown>;

    return {
      title: String(f['title'] ?? ''),
      energy: parseCzechNumber(f['energy']),
      energyUnit: typeof data['energyUnit'] === 'string' ? data['energyUnit'] : 'kcal',
      protein: parseCzechNumber(f['protein']),
      carbs: parseCzechNumber(f['carbohydrate']),
      fat: parseCzechNumber(f['fat']),
      sugar: parseCzechNumber(f['sugar']),
      fibre: parseCzechNumber(f['fiber']),
      saturatedFat: parseCzechNumber(f['saturatedFattyAcid']),
      salt: parseCzechNumber(f['salt']),
    };
  }

  /**
   * Creates a diary entry. We fetch the site's own form first and override only
   * the four fields that describe this portion, so any field we don't know
   * about keeps whatever value the site considers correct.
   *
   * The trailing `&=` is the site's (empty) CSRF token pair — its own frontend
   * appends it the same way.
   */
  async logFood(args: {
    foodId: string;
    amount: number;
    unitId?: string;
    meal: MealId;
    date?: string;
  }): Promise<void> {
    const date = args.date === undefined ? todayCzech() : assertCzechDate(args.date);
    // Fetch the form with a session established, exactly as the site's own
    // frontend does: it carries user-specific fields (favourite, preferred
    // unit) that we must post back unchanged.
    const form = (await this.authed(
      `/foodstuff/detail/form/${encodeURIComponent(args.foodId)}?format=json&default=true`,
    )) as Record<string, unknown>;
    if (typeof form['guid'] !== 'string') throw new KtError(`log food: unknown food id ${args.foodId}`);

    // The site's own frontend posts the fetched form back whole, option
    // arrays included — deviate from that and the server may reject the write
    // ("Potravinu se nepodařilo zapsat do deníku").
    const payload: Record<string, unknown> = { ...form };
    payload['multiplier'] = args.amount;
    payload['unitGuid'] = args.unitId ?? form['unitGuid'] ?? GRAM_UNIT;
    payload['diaryTimeGuid'] = args.meal;
    payload['date'] = date;

    await this.authed('/user/foodstuff/add?format=json&=', { method: 'POST', body: payload });
  }

  /** Raw daily summary. Shape is not fully documented, so it is passed through. */
  async getDaySummary(date?: string): Promise<unknown> {
    return this.authed(`/statistic/summary/${date === undefined ? todayCzech() : assertCzechDate(date)}/get?format=json`);
  }

  /** Macro progress rows and goals are not part of the statistics summary. */
  async getDiarySummary(date?: string): Promise<unknown> {
    return this.authed(`/user/diary/summary/${date === undefined ? todayCzech() : assertCzechDate(date)}/get?format=json`);
  }

  /**
   * Records body weight in kg for a given date (defaults to today).
   * Endpoint: /user/weight/add?format=json&=
   */
  async recordWeight(weight: number, date?: string): Promise<{ recorded: boolean; weight: number; date: string }> {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 500) {
      throw new KtError(`Invalid weight: ${weight}. Expected positive number in kg.`);
    }
    const formattedDate = date === undefined ? todayCzech() : assertCzechDate(date);
    await this.authed('/user/weight/add?format=json&=', {
      method: 'POST',
      body: { weight, date: formattedDate },
    });
    return { recorded: true, weight, date: formattedDate };
  }

  /**
   * Retrieves recent recorded body weights from the monthly summary.
   */
  async getWeightHistory(date?: string): Promise<WeightRecord[]> {
    const summary = (await this.getDaySummary(date)) as Record<string, unknown> | null;
    const monthWeight =
      summary && typeof summary === 'object' && Array.isArray((summary as any)['monthWeight'])
        ? ((summary as any)['monthWeight'] as unknown[])
        : [];
    return monthWeight
      .filter((item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item: Record<string, unknown>) => ({
        date: String(item['description'] ?? ''),
        weight: parseCzechNumber(item['value']) ?? (typeof item['value'] === 'number' ? item['value'] : 0),
      }))
      .filter((r: WeightRecord) => Boolean(r.date && r.weight > 0));
  }

  // ---------------------------------------------------------------------
  // Meals (the site's word for a saved recipe)
  // ---------------------------------------------------------------------

  /** The user's saved recipes. */
  async listMeals(options: { page?: number; limit?: number; query?: string } = {}): Promise<MealSummary[]> {
    const { page = 0, limit = 100, query = '' } = options;
    if (!Number.isInteger(page) || page < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new KtError('Invalid recipe pagination');
    const data = await this.authed(`/user/settings/meal/list?format=json&limit=${limit}&page=${page}&query=${encodeURIComponent(query)}`);
    if (!Array.isArray(data)) throw new KtError('meal list: expected an array');
    return data
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map(m => ({
        id: String(m['guid']),
        title: String(m['title'] ?? ''),
        energy: parseCzechNumber(m['energy']),
        energyUnit: typeof m['energyUnit'] === 'string' ? m['energyUnit'] : 'kcal',
        portions: parseCzechNumber(m['portions']) ?? 1,
      }));
  }

  /**
   * Builds one ingredient entry for a recipe payload.
   *
   * The site expects each ingredient to carry its own full unit list, so we
   * fetch the food's form and copy it. `count` is a multiple of the chosen
   * unit, not a weight: 2 × "porce (250 ml)" is 500 ml. Defaulting to the
   * food's base unit (multiplier 1) makes `amount` mean grams for solids and
   * millilitres for liquids, which is what a recipe author expects.
   */
  private async buildMealItem(
    index: number,
    ingredient: { foodId: string; amount: number; unitId?: string },
  ): Promise<Record<string, unknown>> {
    const detail = await this.getFoodDetail(ingredient.foodId);
    const unitId = ingredient.unitId ?? baseUnitOf(detail.units);
    if (!detail.units.some(u => u.id === unitId)) {
      throw new KtError(
        `${detail.title}: unit ${unitId} is not valid for this food. Available: ` +
          detail.units.map(u => `${u.title} (${u.id})`).join(', '),
      );
    }
    return {
      selected: true,
      guid: String(index),
      foodstuffGuid: detail.id,
      title: detail.title,
      count: ingredient.amount,
      countOriginal: ingredient.amount,
      // Display-only; the site recomputes the recipe's energy server-side.
      energy: 0,
      energyUnit: 'kcal',
      selectedUnitGuid: unitId,
      selectedUnitGuidOriginal: unitId,
      units: detail.units.map(u => ({ id: u.id, title: u.title, multiplier: u.grams })),
      weight: null,
      time: null,
      favorite: null,
      isLiquid: null,
    };
  }

  /** Creates a saved recipe. Returns the new meal's id. */
  async createMeal(args: {
    title: string;
    ingredients: Array<{ foodId: string; amount: number; unitId?: string }>;
  }): Promise<string> {
    if (args.ingredients.length === 0) throw new KtError('a recipe needs at least one ingredient');

    const foodstuff = [];
    for (const [i, ingredient] of args.ingredients.entries()) {
      foodstuff.push(await this.buildMealItem(i, ingredient));
    }

    const created = await this.authed('/user/meal/create?format=json&=', {
      method: 'POST',
      body: {
        guid: null,
        title: args.title,
        diaryTimeGuid: null,
        diaryTimeOptions: null,
        date: null,
        timeUser: null,
        time: null,
        foodstuff,
      },
    });
    if (typeof created !== 'string') throw new KtError('meal create: no id returned');
    return created;
  }

  /**
   * Logs a saved recipe into the diary with optional portion scaling.
   *
   * The server persists the recipe by logging its constituent food items.
   * To support partial (e.g. 0.5) or multiple (e.g. 2) portions accurately,
   * we scale each ingredient's count proportionally from its original amount.
   */
  async logMeal(args: { mealId: string; meal: MealId; date?: string; portions?: number }): Promise<void> {
    const date = args.date === undefined ? todayCzech() : assertCzechDate(args.date);
    const portions = args.portions ?? 1;
    if (typeof portions !== 'number' || !Number.isFinite(portions) || portions <= 0) {
      throw new KtError(`Invalid portions: ${portions}. Expected positive number.`);
    }

    const form = await this.authed(`/user/meal/add/form/${encodeURIComponent(args.mealId)}?format=json`);
    const payload = { ...scaleRecipeForm(form, portions), diaryTimeGuid: args.meal, date };
    await this.authed('/user/meal/add?format=json&=', { method: 'POST', body: payload });
  }

  /** Permanently deletes a saved recipe. */
  async deleteMeal(mealId: string): Promise<void> {
    await this.authed(`/user/settings/meal/delete/${encodeURIComponent(mealId)}?format=json`);
  }
}
