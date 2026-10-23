import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { diaryCopyTimestamp } from './diary.js';

test('copy date timestamps retain the requested Czech day across daylight saving changes', () => {
  for (const [date, expected] of [
    ['24.10.2026', '2026-10-23T22:00:00.000Z'],
    ['25.10.2026', '2026-10-24T22:00:00.000Z'],
    ['26.10.2026', '2026-10-25T23:00:00.000Z'],
    ['29.03.2026', '2026-03-28T23:00:00.000Z'],
    ['30.03.2026', '2026-03-29T22:00:00.000Z'],
    ['29.02.2024', '2024-02-28T23:00:00.000Z'],
  ]) assert.equal(diaryCopyTimestamp(date!), expected);
  assert.throws(() => diaryCopyTimestamp('31.02.2026'), /Invalid date/);
});
