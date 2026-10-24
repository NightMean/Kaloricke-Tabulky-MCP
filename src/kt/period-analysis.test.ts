import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePeriodAnalysis } from './period-analysis.js';

const analysis = {
  recordsMissing: true,
  energy: { title: 'Energy', value: '1 458,1', target: 2464, percent: 59, energyUnit: 'kcal' },
  list: [{ title: 'Protein', value: '47,17', target: 170, percent: 28 }],
  drink: { value: 0.05, target: 3.33, percent: 1 }, salt: { value: 0, target: 5 },
  totalValueInfluence: [{ title: 'Energy', items: [
    { id: 'pizza', title: 'Pizza', valueString: '1 043,5 kcal', count: '12x' },
    { id: null, title: 'Recipe', valueString: '1,1 g', count: '2×' },
    { title: 'Unknown', valueString: 'n/a', count: null },
  ] }],
  totalValueInfluenceCategory: [{ title: 'Energy', items: [{ title: 'Fast food', valueString: '154 kcal' }] }],
};

test('period analysis retains site averages, targets and the empty-day warning without rescaling', () => {
  const result = parsePeriodAnalysis(analysis, '18.09.2026', '19.09.2026');
  assert.equal(result.days, 2);
  assert.equal(result.someDaysWithoutRecords, true);
  assert.equal(result.energy.perDay, 1458.1);
  assert.equal(result.energy.target, 2464);
  assert.equal(result.energy.percentOfTarget, 59);
  assert.equal(result.nutrients[0]?.perDay, 47.17);
  assert.equal(result.drink?.title, 'Pitný režim');
  assert.equal(result.salt?.perDay, 0);
  assert.deepEqual(result.topFoods[0]?.items[0], { title: 'Pizza', foodId: 'pizza', perDay: 1043.5, unit: 'kcal', timesLogged: 12 });
  assert.equal(result.topFoods[0]?.items[1]?.timesLogged, 2);
  assert.equal(result.topFoods[0]?.items[2]?.perDay, null);
  assert.equal(result.topCategories[0]?.items[0]?.foodId, null);
});

test('optional rankings and the missing-day indicator retain absent versus false', () => {
  const result = parsePeriodAnalysis({ energy: { value: 0 }, list: [] }, '24.10.2026', '24.10.2026');
  assert.equal(result.days, 1);
  assert.equal(result.someDaysWithoutRecords, null);
  assert.deepEqual(result.topFoods, []);
  assert.deepEqual(result.topCategories, []);
  assert.equal(result.drink, null);
  assert.equal(parsePeriodAnalysis({ ...analysis, recordsMissing: false }, '24.10.2026', '24.10.2026').someDaysWithoutRecords, false);
});

test('inclusive day counts handle leap years, DST and years below 100; invalid ranges fail', () => {
  for (const [from, to, days] of [
    ['28.02.2024', '01.03.2024', 3], ['24.10.2026', '26.10.2026', 3], ['31.12.0099', '01.01.0100', 2],
  ] as const) assert.equal(parsePeriodAnalysis(analysis, from, to).days, days);
  assert.throws(() => parsePeriodAnalysis(analysis, '25.10.2026', '24.10.2026'), /on or before/);
  assert.throws(() => parsePeriodAnalysis(analysis, '31.02.2026', '01.03.2026'), /Invalid date/);
  assert.throws(() => parsePeriodAnalysis({ list: [] }, '24.10.2026', '24.10.2026'), /analysis energy/);
  assert.throws(() => parsePeriodAnalysis({ energy: {} }, '24.10.2026', '24.10.2026'), /analysis nutrients/);
});
