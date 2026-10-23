import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
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
