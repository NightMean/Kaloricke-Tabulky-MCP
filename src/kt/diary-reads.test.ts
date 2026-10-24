import assert from 'node:assert/strict';
import { test } from 'node:test';
import { czechDateFromEpoch, parseDiaryDay, parseLoggedDays } from './diary-reads.js';

const day = {
  energyUnit: 'kcal', energyTotal: 0,
  times: [{ id: '1', title: 'Breakfast', energyTotal: 0, notes: [{ note: 'After training' }], foodstuff: [
    { id: 'row-one', guidType: 'food-one', title: 'Bread', unit: '3 x piece', energy: '144', protein: 4.2, sugar: null },
    { id: 'row-two', guidType: 'recipe-one', type: 'meal', title: 'Recipe', unit: '50 %', energy: '84,6', protein: 1.08, sugar: '17,1' },
  ] }, { id: '2', title: 'Snack', foodstuff: [] }],
  activities: [{ id: 'activity-row', title: 'Steps', energy: '1 113' }], notes: ['Daily note'],
};

test('diary totals sum actual rows, retaining recipe IDs, notes, missing numbers and activity separation', () => {
  const parsed = parseDiaryDay(day, '24.10.2026');
  assert.equal(parsed.totals.energy, 228.6);
  assert.equal(parsed.meals[0]?.energy, 228.6);
  assert.equal(parsed.totals.protein, 5.28);
  assert.equal(parsed.totals.sugar, 17.1);
  assert.equal(parsed.totals.fat, null);
  assert.equal(parsed.meals[0]?.entries[0]?.entryId, 'row-one');
  assert.equal(parsed.meals[0]?.entries[0]?.foodId, 'food-one');
  assert.equal(parsed.meals[0]?.entries[1]?.kind, 'meal');
  assert.equal(parsed.meals[0]?.entries[1]?.amount, '50 %');
  assert.deepEqual(parsed.meals[0]?.notes, ['After training']);
  assert.deepEqual(parsed.notes, ['Daily note']);
  assert.deepEqual(parsed.activities, [{ entryId: 'activity-row', title: 'Steps', energy: 1113 }]);
});

test('empty days and zero-calorie foods preserve the distinction between missing and zero', () => {
  assert.equal(parseDiaryDay({ times: [], activities: [] }, '24.10.2026').totals.energy, null);
  const parsed = parseDiaryDay({ times: [{ id: '1', foodstuff: [{ id: 'water', energy: 0 }] }], activities: [] }, '24.10.2026');
  assert.equal(parsed.totals.energy, 0);
  assert.equal(parsed.totals.protein, null);
});

test('malformed days and incompatible energy units fail instead of returning incorrect totals', () => {
  assert.throws(() => parseDiaryDay({}, '24.10.2026'), /diary meal slots/);
  assert.throws(() => parseDiaryDay({ ...day, times: [{ foodstuff: [{}] }] }, '24.10.2026'), /entry ID/);
  assert.throws(() => parseDiaryDay({ ...day, times: [{ foodstuff: [{ id: 'row', energy: 100, energyUnit: 'kJ' }] }] }, '24.10.2026'), /mixed energy units/);
});

test('calendar epochs use Czech dates across daylight saving changes and normalize rating prefixes', () => {
  for (const [iso, expected] of [['2026-10-23T22:00:00Z', '24.10.2026'], ['2026-10-25T23:00:00Z', '26.10.2026']]) {
    assert.equal(czechDateFromEpoch(Date.parse(iso!)), expected);
    assert.equal(czechDateFromEpoch(String(Date.parse(iso!))), expected);
  }
  for (const invalid of [null, '', 'invalid', Infinity, 1e20]) assert.equal(czechDateFromEpoch(invalid), null);
  assert.deepEqual(parseLoggedDays([
    { date: 1789768800000, colorClass: 'cc-good' }, { date: '1789855200000', colorClass: 'calendar-low' },
    { date: 1789941600000, colorClass: null }, { date: null },
  ]), [{ date: '19.09.2026', status: 'good' }, { date: '20.09.2026', status: 'low' }, { date: '21.09.2026', status: null }]);
  assert.throws(() => parseLoggedDays({}), /expected an array/);
  assert.throws(() => parseLoggedDays([{ date: 'invalid' }]), /epoch timestamp/);
});
