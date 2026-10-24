import { parseCzechNumber } from './client.js';
import { record, records } from './api.js';
import { assertDateRange } from './statistics.js';

export interface NutrientAverage {
  title: string;
  perDay: number | null;
  target: number | null;
  percentOfTarget: number | null;
}
export interface Contributor {
  title: string;
  foodId: string | null;
  perDay: number | null;
  unit: string | null;
  timesLogged: number | null;
}
export interface ContributorGroup { nutrient: string; items: Contributor[] }
export interface PeriodAnalysis {
  from: string;
  to: string;
  days: number;
  someDaysWithoutRecords: boolean | null;
  energy: NutrientAverage;
  energyUnit: string;
  nutrients: NutrientAverage[];
  salt: NutrientAverage | null;
  drink: NutrientAverage | null;
  topFoods: ContributorGroup[];
  topCategories: ContributorGroup[];
}

function nutrient(value: unknown, fallback: string): NutrientAverage {
  const item = record(value, 'analysis nutrient');
  return { title: typeof item['title'] === 'string' && item['title'] ? item['title'] : fallback,
    perDay: parseCzechNumber(item['value']), target: parseCzechNumber(item['target']),
    percentOfTarget: parseCzechNumber(item['percent']) };
}

/** Rankings use rendered values, e.g. "1 043,5 kcal", rather than numeric fields. */
function contributors(value: unknown): ContributorGroup[] {
  if (value === undefined || value === null) return [];
  return records(value, 'analysis ranking groups').map(group => ({
    nutrient: String(group['title'] ?? ''),
    items: records(group['items'], 'analysis contributors').map(item => {
      const rendered = typeof item['valueString'] === 'string' ? item['valueString'].trim() : '';
      const match = /^([+-]?[\d\s.,]+?)\s*([a-zA-Z%µμ]+)?$/.exec(rendered);
      const count = parseCzechNumber(typeof item['count'] === 'string' ? item['count'].replace(/[x×]$/i, '') : item['count']);
      return { title: String(item['title'] ?? ''), foodId: typeof item['id'] === 'string' ? item['id'] : null,
        perDay: match ? parseCzechNumber(match[1]) : null, unit: match?.[2] ?? null,
        timesLogged: count !== null && Number.isInteger(count) && count >= 0 ? count : null };
    }),
  }));
}

/** UTC arithmetic avoids DST-length days; setUTCFullYear also supports years below 100. */
function utcDay(date: string): number {
  const [day, month, year] = date.split('.').map(Number) as [number, number, number];
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  return result.getTime();
}

export function parsePeriodAnalysis(value: unknown, from: string, to: string): PeriodAnalysis {
  assertDateRange(from, to);
  const raw = record(value, 'period analysis');
  const energy = record(raw['energy'], 'analysis energy');
  return { from, to, days: (utcDay(to) - utcDay(from)) / 86_400_000 + 1,
    someDaysWithoutRecords: typeof raw['recordsMissing'] === 'boolean' ? raw['recordsMissing'] : null,
    energy: nutrient(energy, 'Energie'), energyUnit: typeof energy['energyUnit'] === 'string' ? energy['energyUnit'] : 'kcal',
    nutrients: records(raw['list'], 'analysis nutrients').map(item => nutrient(item, '')),
    salt: raw['salt'] == null ? null : nutrient(raw['salt'], 'Sůl'),
    drink: raw['drink'] == null ? null : nutrient(raw['drink'], 'Pitný režim'),
    topFoods: contributors(raw['totalValueInfluence']), topCategories: contributors(raw['totalValueInfluenceCategory']),
  };
}
