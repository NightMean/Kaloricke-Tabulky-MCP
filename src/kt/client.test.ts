import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  extractDaySummaryOverview,
  assertCzechDate,
  formatCzechDate,
  getMealName,
  normalizeKtBaseUrl,
  parseCzechNumber,
} from './client.js';

test('parses Czech decimal commas', () => {
  assert.equal(parseCzechNumber('20,43'), 20.43);
  assert.equal(parseCzechNumber('0,56'), 0.56);
  assert.equal(parseCzechNumber('249'), 249);
});

test('strips the thousands separator, including the non-breaking space the site emits', () => {
  assert.equal(parseCzechNumber('1 043'), 1043);
  assert.equal(parseCzechNumber('1 043'), 1043);
  assert.equal(parseCzechNumber('1 021,35'), 1021.35);
});

test('passes numbers through and rejects non-finite ones', () => {
  assert.equal(parseCzechNumber(17), 17);
  assert.equal(parseCzechNumber(Number.NaN), null);
  assert.equal(parseCzechNumber(Number.POSITIVE_INFINITY), null);
});

test('returns null rather than a misleading zero for absent values', () => {
  assert.equal(parseCzechNumber(null), null);
  assert.equal(parseCzechNumber(undefined), null);
  assert.equal(parseCzechNumber(''), null);
  assert.equal(parseCzechNumber('   '), null);
  assert.equal(parseCzechNumber('n/a'), null);
});

test('formats dates the way the site expects', () => {
  assert.equal(formatCzechDate(new Date(2026, 7, 2)), '02.08.2026');
  assert.equal(formatCzechDate(new Date(2026, 11, 25)), '25.12.2026');
});

test('validates real calendar dates, including leap years', () => {
  for (const date of ['23.10.2026', '29.02.2024', '29.02.2000', '01.01.0099']) {
    assert.equal(assertCzechDate(date), date);
  }
  for (const date of ['not-a-date', '2026-10-23', '31.02.2026', '29.02.2026', '29.02.1900', '00.10.2026', '01.13.2026', '01.01.0000']) {
    assert.throws(() => assertCzechDate(date), /Invalid date/);
  }
});

test('normalizes domain names and base URLs to standard https format', () => {
  assert.equal(normalizeKtBaseUrl(), 'https://www.kaloricketabulky.cz');
  assert.equal(normalizeKtBaseUrl(''), 'https://www.kaloricketabulky.cz');
  assert.equal(normalizeKtBaseUrl('kaloricketabulky.cz'), 'https://www.kaloricketabulky.cz');
  assert.equal(normalizeKtBaseUrl('kaloricketabulky.sk'), 'https://www.kaloricketabulky.sk');
  assert.equal(normalizeKtBaseUrl('www.kaloricketabulky.sk'), 'https://www.kaloricketabulky.sk');
  assert.equal(normalizeKtBaseUrl('https://www.kaloricketabulky.sk/'), 'https://www.kaloricketabulky.sk');
  assert.equal(normalizeKtBaseUrl('https://kaloricketabulky.sk'), 'https://kaloricketabulky.sk');
});

test('resolves meal names appropriately for Czech and Slovak domains', () => {
  assert.equal(getMealName('1', 'https://www.kaloricketabulky.cz'), 'Snídaně');
  assert.equal(getMealName('1', 'https://www.kaloricketabulky.sk'), 'Raňajky');
  assert.equal(getMealName('2', 'kaloricketabulky.sk'), 'Desiata');
  assert.equal(getMealName('4', 'kaloricketabulky.sk'), 'Olovrant');
  assert.equal(getMealName('5', 'kaloricketabulky.sk'), 'Večera');
  assert.equal(getMealName('3', 'kaloricketabulky.cz'), 'Oběd');
});

test('validates body weight bounds and rejects invalid inputs', async () => {
  const { KtClient } = await import('./client.js');
  const client = new KtClient({ email: 'test@example.com', password: 'test' });
  await assert.rejects(async () => client.recordWeight(0), /Invalid weight/);
  await assert.rejects(async () => client.recordWeight(-5), /Invalid weight/);
  await assert.rejects(async () => client.recordWeight(600), /Invalid weight/);
  await assert.rejects(async () => client.recordWeight(Number.NaN), /Invalid weight/);
});

test('extracts energy and converts litres from the statistics summary payload', () => {
  const mockPayload = {
    code: 0,
    data: {
      todayEnergy: '1 850,5',
      todayEnergyTarget: '2 200',
      todayDrink: '2,1',
      todayDrinkTarget: '2,5',
      drinkUnit: 'l',
      energyUnit: 'kcal',
    },
  };

  const overview = extractDaySummaryOverview(mockPayload);
  assert.ok(overview);
  assert.deepEqual(overview.energy, {
    current: 1850.5,
    target: 2200,
    remaining: 349.5,
    unit: 'kcal',
  });
  assert.deepEqual(overview.macros, {
    protein: { current: null, target: null, unit: null },
    carbs: { current: null, target: null, unit: null },
    fat: { current: null, target: null, unit: null },
    fiber: { current: null, target: null, unit: null },
  });
  assert.deepEqual(overview.water, {
    current: 2100,
    target: 2500,
    unit: 'ml',
  });
});

test('summary preserves zero values, overspent budgets, units, and nested macro goals', () => {
  const overview = extractDaySummaryOverview({
    todayEnergy: '5 000', todayEnergyTarget: '4 000', energyUnit: 'kJ',
    todayDrink: 0, todayDrinkTarget: 2000, drinkUnit: 'ml',
  }, { data: { itemsDynamic: [[
    { code: 'protein', actualValue: 0, actual: '5', goal: '100', unit: 'g' },
    { code: 'carbohydrate', actualValue: null, actual: '20,5', goal: null, unit: 'g' },
  ], [null, { code: 'fat', actualValue: 'invalid', actual: '10', goal: 'bad', unit: 'g' }]] } });
  assert.ok(overview);
  assert.deepEqual(overview.energy, { current: 5000, target: 4000, remaining: -1000, unit: 'kJ' });
  assert.deepEqual(overview.water, { current: 0, target: 2000, unit: 'ml' });
  assert.deepEqual(overview.macros.protein, { current: 0, target: 100, unit: 'g' });
  assert.deepEqual(overview.macros.carbs, { current: 20.5, target: null, unit: 'g' });
  assert.deepEqual(overview.macros.fat, { current: 10, target: null, unit: 'g' });
  assert.deepEqual(overview.macros.fiber, { current: null, target: null, unit: null });
});

test('summary distinguishes missing measurements from zero and does not invent units', () => {
  for (const invalid of [null, undefined, [], 'invalid', { data: null }]) {
    assert.equal(extractDaySummaryOverview(invalid), null);
  }
  const overview = extractDaySummaryOverview({ todayEnergy: 'invalid', todayDrink: '1' }, { itemsDynamic: null });
  assert.ok(overview);
  assert.equal(overview.energy, null);
  assert.deepEqual(overview.water, { current: 1, target: null, unit: null });
  assert.deepEqual(overview.macros.protein, { current: null, target: null, unit: null });
});

test('water uses diary display precision because the numeric actualValue can be zero', () => {
  const statistics = { todayDrink: '0,1', todayDrinkTarget: '2,8', drinkUnit: 'l' };
  const diary = { items: [
    { unit: 'kcal', actual: '1000', goal: '1800' },
    { code: null, unit: 'l', actual: '0,09', actualValue: 0, goal: '2,84' },
    { unit: 'kg', actual: '70' },
  ] };
  assert.deepEqual(extractDaySummaryOverview(statistics, diary)?.water, { current: 90, target: 2840, unit: 'ml' });
  assert.deepEqual(extractDaySummaryOverview(statistics, { items: [{ unit: 'ml', actual: '0', goal: '2840' }] })?.water,
    { current: 0, target: 2840, unit: 'ml' });
});

test('water falls back to statistics only for unavailable values with compatible units', () => {
  const diary = { items: [{ unit: 'l', actual: 'unavailable', goal: '2,84' }] };
  assert.deepEqual(extractDaySummaryOverview({ todayDrink: '0,1', drinkUnit: 'l' }, diary)?.water,
    { current: 100, target: 2840, unit: 'ml' });
  assert.deepEqual(extractDaySummaryOverview({ todayDrink: '1', drinkUnit: 'unknown' }, diary)?.water,
    { current: null, target: 2840, unit: 'ml' });
  assert.deepEqual(extractDaySummaryOverview({ todayDrink: 0, todayDrinkTarget: 2500, drinkUnit: 'ml' }, { items: null })?.water,
    { current: 0, target: 2500, unit: 'ml' });
});

test('logMeal validates portion bounds and scales ingredients proportionally', async () => {
  const { KtClient } = await import('./client.js');
  const client = new KtClient({ email: 'test@example.com', password: 'test' });

  await assert.rejects(async () => client.logMeal({ mealId: '123', meal: '1', portions: 0 }), /Invalid portions/);
  await assert.rejects(async () => client.logMeal({ mealId: '123', meal: '1', portions: -2 }), /Invalid portions/);
  await assert.rejects(async () => client.logMeal({ mealId: '123', meal: '1', portions: Number.NaN }), /Invalid portions/);

  let postedPayload: Record<string, unknown> | null = null;
  (client as any).authed = async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path.includes('/form/')) {
      return {
        selectedUnitGuid: '0000000000000001',
        selectedUnitMultiplier: 100,
        units: [
          { id: '0000000000000003', title: '%', multiplier: -1 },
          { id: '0000000000000001', title: '1 g', multiplier: 1 },
        ],
        foodstuff: [
          { foodId: 'f1', count: '100', countOriginal: '100', selectedUnitGuid: 'changed', selectedUnitGuidOriginal: 'original' },
          { foodId: 'f2', count: '2,5', countOriginal: '2,5' },
          { foodId: 'f3', count: '10', countOriginal: '10', selected: false },
          { foodId: 'f4', countOriginal: '0,001' },
        ],
      };
    }
    if (path.includes('/user/meal/add')) {
      postedPayload = init?.body as Record<string, unknown>;
      return { code: 0 };
    }
    return {};
  };

  await client.logMeal({ mealId: 'recipe1', meal: '1', portions: 0.5 });
  assert.ok(postedPayload);
  const payloadRecord = postedPayload as Record<string, unknown>;
  assert.equal(payloadRecord['count'], undefined);
  assert.equal(payloadRecord['selectedUnitGuid'], '0000000000000003');
  assert.equal(payloadRecord['selectedUnitMultiplier'], 50);
  const items = payloadRecord['foodstuff'] as Array<{ foodId: string; count: number; selectedUnitGuid?: string }>;
  assert.equal(items[0]?.count, 50);
  assert.equal(items[0]?.selectedUnitGuid, 'original');
  assert.equal(items[1]?.count, 1.25);
  assert.equal(items[2]?.count, 0);
  assert.equal(items[3]?.count, 0.0005);
});


test('recipe scaling preserves ingredient ratios for small, full and multiple quantities', async () => {
  const { scaleRecipeForm } = await import('./recipes.js');
  const form = { units: [{ id: 'percent', multiplier: -1 }], foodstuff: [
    { countOriginal: '2,5', selectedUnitGuid: 'different', selectedUnitGuidOriginal: 'piece' },
    { countOriginal: 100.25, selectedUnitGuidOriginal: 'ml' },
  ] };
  for (const factor of [0.001, 0.5, 1, 2, 50]) {
    const scaled = scaleRecipeForm(form, factor);
    const items = scaled['foodstuff'] as Array<Record<string, unknown>>;
    assert.equal(items[0]?.['count'], 2.5 * factor);
    assert.equal(items[1]?.['count'], 100.25 * factor);
    assert.equal(items[0]?.['selectedUnitGuid'], 'piece');
    assert.equal(scaled['selectedUnitMultiplier'], factor * 100);
  }
  assert.equal(form.foodstuff[0]?.countOriginal, '2,5');
});
