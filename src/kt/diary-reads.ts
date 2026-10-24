import { assertCzechDate, KtError, parseCzechNumber } from './client.js';
import { record, records, type ApiRecord } from './api.js';

export interface DiaryTotals {
  energy: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fibre: number | null;
  sugar: number | null;
}
export interface DiaryEntry extends DiaryTotals {
  entryId: string;
  foodId: string | null;
  title: string;
  amount: string;
  energyUnit: string;
  kind: string;
}
export interface DiaryDay {
  date: string;
  energyUnit: string;
  meals: { meal: string; title: string; energy: number | null; entries: DiaryEntry[]; notes: string[] }[];
  activities: { entryId: string; title: string; energy: number | null }[];
  notes: string[];
  totals: DiaryTotals;
}
export interface LoggedDay { date: string; status: string | null }

const pragueDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Prague', day: '2-digit', month: '2-digit', year: 'numeric',
});

/** Calendar timestamps represent Czech midnight, which can be yesterday in UTC. */
export function czechDateFromEpoch(value: unknown): string | null {
  const ms = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime())) return null;
  const parts = pragueDate.formatToParts(new Date(ms));
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part('day')}.${part('month')}.${part('year')}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function notes(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new KtError('diary notes: expected an array');
  return value.map(item => typeof item === 'string' ? item : text(record(item, 'diary note')['note'])
    ?? text(record(item, 'diary note')['title'])).filter((item): item is string => item !== null);
}

function sum(entries: DiaryEntry[], field: keyof DiaryTotals): number | null {
  const values = entries.map(entry => entry[field]).filter((value): value is number => value !== null);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/** The site's day-level *Total fields can be zero despite populated entries. */
export function parseDiaryDay(value: unknown, date: string): DiaryDay {
  assertCzechDate(date);
  const raw = record(value, 'diary day');
  const energyUnit = text(raw['energyUnit']) ?? 'kcal';
  const meals = records(raw['times'], 'diary meal slots').map(slot => {
    const entries = records(slot['foodstuff'], 'diary foods').map((item): DiaryEntry => {
      const entryId = text(item['id']);
      if (!entryId) throw new KtError('diary food: expected an entry ID');
      const unit = text(item['energyUnit']) ?? energyUnit;
      const energy = parseCzechNumber(item['energy']);
      if (energy !== null && unit !== energyUnit) throw new KtError('diary totals: cannot sum mixed energy units');
      return {
        entryId, foodId: text(item['guidType']), title: String(item['title'] ?? ''),
        amount: String(item['unit'] ?? ''), energy, energyUnit: unit,
        protein: parseCzechNumber(item['protein']), carbs: parseCzechNumber(item['carbohydrate']),
        fat: parseCzechNumber(item['fat']), fibre: parseCzechNumber(item['fiber']),
        sugar: parseCzechNumber(item['sugar']), kind: text(item['type']) ?? 'foodstuff',
      };
    });
    return { meal: String(slot['id'] ?? ''), title: String(slot['title'] ?? ''),
      energy: sum(entries, 'energy'), entries, notes: notes(slot['notes']) };
  });
  const entries = meals.flatMap(meal => meal.entries);
  const activities = records(raw['activities'], 'diary activities').map(item => {
    const entryId = text(item['id']);
    if (!entryId) throw new KtError('diary activity: expected an entry ID');
    return { entryId, title: String(item['title'] ?? ''), energy: parseCzechNumber(item['energy']) };
  });
  return { date, energyUnit, meals, activities, notes: notes(raw['notes']), totals: {
    energy: sum(entries, 'energy'), protein: sum(entries, 'protein'), carbs: sum(entries, 'carbs'),
    fat: sum(entries, 'fat'), fibre: sum(entries, 'fibre'), sugar: sum(entries, 'sugar'),
  } };
}

export function parseLoggedDays(value: unknown): LoggedDay[] {
  return records(value, 'logged days').flatMap((item: ApiRecord) => {
    if (item['date'] === null || item['date'] === undefined) return [];
    const date = czechDateFromEpoch(item['date']);
    if (!date) throw new KtError('logged day: expected an epoch timestamp');
    return [{ date, status: text(item['colorClass'])?.replace(/^(cc|calendar)-/, '') ?? null }];
  });
}
