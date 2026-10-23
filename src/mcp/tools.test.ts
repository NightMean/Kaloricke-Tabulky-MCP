import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GRAM_UNIT, KtClient, PORTION_UNIT } from '../kt/client.js';
import { registerTools } from './tools.js';

const statistics = {
  todayEnergy: '1 850,5', todayEnergyTarget: '2 200', energyUnit: 'kcal',
  todayDrink: '2,1', todayDrinkTarget: '2,5', drinkUnit: 'l',
  monthWeight: [{ description: '23.10.2026', value: 80 }],
};
const diary = {
  itemsDynamic: [[
    { code: 'protein', actual: '120,4', actualValue: 120.4, goal: '140', unit: 'g' },
    { code: 'carbohydrate', actual: '210', actualValue: 210, goal: '250', unit: 'g' },
  ], [
    { code: 'fat', actual: '65,2', actualValue: 65.2, goal: '70', unit: 'g' },
    { code: 'fiber', actual: '28,5', actualValue: 28.5, goal: '30', unit: 'g' },
  ]],
};

async function connectTools(t: TestContext, reply: (url: URL, init?: RequestInit) => Response) {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://www.kaloricketabulky.sk');
    assert.equal(url.searchParams.get('format'), 'json');
    requests.push(url.pathname);
    if (url.pathname === '/login/create') {
      return Response.json({ code: 0, data: {} }, { headers: { 'set-cookie': 'JSESSIONID=test-session; Path=/' } });
    }
    if (!url.pathname.startsWith('/foodstuff/detail/') || url.pathname.startsWith('/foodstuff/detail/form/')) {
      assert.equal(new Headers(init?.headers).get('Cookie'), 'JSESSIONID=test-session');
    }
    return reply(url, init);
  });
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  registerTools(server, new KtClient({ email: 'test@example.invalid', password: 'test', domain: 'kaloricketabulky.sk' }));
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, requests };
}

test('day summary reads both endpoints and preserves the original summary field', async t => {
  const { client, requests } = await connectTools(t, url => {
    if (url.pathname === '/statistic/summary/23.10.2026/get') return Response.json({ code: 0, data: statistics });
    if (url.pathname === '/user/diary/summary/23.10.2026/get') return Response.json({ code: 0, data: diary });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const result = await client.callTool({ name: 'get_day_summary', arguments: { date: '23.10.2026' } });
  assert.ok(Array.isArray(result.content));
  const text = result.content[0];
  assert.equal(text?.type, 'text');
  assert.ok(text && text.type === 'text');
  const payload = JSON.parse(text.text);
  assert.deepEqual(payload.summary, statistics);
  assert.deepEqual(payload.raw, statistics);
  assert.deepEqual(payload.overview.energy, { current: 1850.5, target: 2200, remaining: 349.5, unit: 'kcal' });
  assert.deepEqual(payload.overview.macros, {
    protein: { current: 120.4, target: 140, unit: 'g' },
    carbs: { current: 210, target: 250, unit: 'g' },
    fat: { current: 65.2, target: 70, unit: 'g' },
    fiber: { current: 28.5, target: 30, unit: 'g' },
  });
  assert.deepEqual(payload.overview.water, { current: 2100, target: 2500, unit: 'ml' });
  assert.deepEqual(requests, ['/login/create', '/statistic/summary/23.10.2026/get', '/user/diary/summary/23.10.2026/get']);
});

test('day summary reports diary API failure instead of presenting missing macros as a complete result', async t => {
  const { client } = await connectTools(t, url => {
    if (url.pathname === '/statistic/summary/23.10.2026/get') return Response.json({ code: 0, data: statistics });
    return Response.json({ code: 1, message: 'Diary summary unavailable' });
  });
  const result = await client.callTool({ name: 'get_day_summary', arguments: { date: '23.10.2026' } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Diary summary unavailable/);
});

test('weight history still reads only the statistics endpoint', async t => {
  const { client, requests } = await connectTools(t, url => {
    assert.equal(url.pathname, '/statistic/summary/23.10.2026/get');
    return Response.json({ code: 0, data: statistics });
  });
  const result = await client.callTool({ name: 'get_weight_history', arguments: { date: '23.10.2026' } });
  assert.ok(Array.isArray(result.content));
  const text = result.content[0];
  assert.ok(text && text.type === 'text');
  assert.deepEqual(JSON.parse(text.text).entries, [{ date: '23.10.2026', weight: 80 }]);
  assert.deepEqual(requests, ['/login/create', '/statistic/summary/23.10.2026/get']);
});

const writeTools = [
  { name: 'log_food', args: { food_id: 'test-food', amount: 100, meal: '1' } },
  { name: 'log_meal', args: { meal_id: 'test-recipe', meal: '1' } },
  { name: 'record_weight', args: { weight_kg: 80 } },
];

test('previews and writes reject malformed and impossible dates before any API request', async t => {
  const { client, requests } = await connectTools(t, url => { throw new Error(`Unexpected request ${url.pathname}`); });
  for (const tool of writeTools) {
    for (const dry_run of [true, false]) {
      for (const date of ['not-a-date', '31.02.2026']) {
        const result = await client.callTool({ name: tool.name, arguments: { ...tool.args, date, dry_run } });
        assert.equal(result.isError, true, `${tool.name}: ${date}, dry_run=${dry_run}`);
        assert.match(JSON.stringify(result.content), /Invalid date/);
      }
    }
  }
  assert.deepEqual(requests, []);
});

test('food preview reports nutrition lookup failure', async t => {
  const { client } = await connectTools(t, () => Response.json({ code: 1, message: 'Food unavailable' }));
  const result = await client.callTool({ name: 'log_food', arguments: {
    food_id: 'missing', amount: 100, meal: '1', date: '23.10.2026', dry_run: true,
  } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Food unavailable/);
});

test('recipe preview rejects unknown recipe IDs', async t => {
  const { client } = await connectTools(t, () => Response.json({ code: 0, data: [] }));
  const result = await client.callTool({ name: 'log_meal', arguments: {
    meal_id: 'missing', meal: '1', date: '23.10.2026', dry_run: true,
  } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /recipe/i);
});

test('valid previews never write and both explicit and default commits write exactly once', async t => {
  const writes: string[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname.startsWith('/foodstuff/detail/test-food/')) {
      return Response.json({ code: 0, data: { foodstuff: { title: 'Food', energy: '100' }, energyUnit: 'kcal' } });
    }
    if (url.pathname === '/user/settings/meal/list') {
      return Response.json({ code: 0, data: [{ guid: 'test-recipe', title: 'Recipe', energy: '250', energyUnit: 'kcal' }] });
    }
    if (url.pathname === '/foodstuff/detail/form/test-food') {
      return Response.json({ code: 0, data: { guid: 'test-food', unitGuid: GRAM_UNIT } });
    }
    if (url.pathname === '/user/meal/add/form/test-recipe') {
      return Response.json({ code: 0, data: { guid: 'test-recipe' } });
    }
    assert.equal(init?.method, 'POST');
    assert.equal(typeof init.body, 'string');
    const body = JSON.parse(String(init.body));
    assert.equal(body.date, '23.10.2026');
    if (url.pathname === '/user/foodstuff/add') {
      assert.equal(body.multiplier, 100);
      assert.equal(body.unitGuid, GRAM_UNIT);
      assert.equal(body.diaryTimeGuid, '1');
    } else if (url.pathname === '/user/meal/add') {
      assert.equal(body.count, 1);
      assert.equal(body.selectedUnitGuid, PORTION_UNIT);
      assert.equal(body.diaryTimeGuid, '1');
    } else {
      assert.equal(url.pathname, '/user/weight/add');
      assert.equal(body.weight, 80);
    }
    writes.push(url.pathname);
    return Response.json({ code: 0, data: {} });
  });
  for (const tool of writeTools) {
    for (const dry_run of [true, undefined, false]) {
      const previousWrites = writes.length;
      const result = await client.callTool({ name: tool.name, arguments: {
        ...tool.args, date: '23.10.2026', ...(dry_run === undefined ? {} : { dry_run }),
      } });
      assert.ok(!result.isError, JSON.stringify(result.content));
      assert.ok(Array.isArray(result.content));
      const text = result.content[0];
      assert.ok(text && text.type === 'text');
      const payload = JSON.parse(text.text);
      assert.equal(payload.dry_run, dry_run ?? false);
      assert.equal(payload.date, '23.10.2026');
      assert.equal(writes.length - previousWrites, dry_run ? 0 : 1);
      if (dry_run) assert.equal(payload.preview, true);
      else assert.equal(tool.name === 'record_weight' ? payload.recorded : payload.logged, true);
    }
  }
});

test('recipe preview reports recipe-list API failure', async t => {
  const { client } = await connectTools(t, () => Response.json({ code: 1, message: 'Recipe list unavailable' }));
  const result = await client.callTool({ name: 'log_meal', arguments: {
    meal_id: 'test-recipe', meal: '1', date: '23.10.2026', dry_run: true,
  } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Recipe list unavailable/);
});

test('optional metadata lookup failures do not prevent or duplicate successful writes', async t => {
  const writes: Record<string, unknown>[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname.startsWith('/foodstuff/detail/test-food/') || url.pathname === '/user/settings/meal/list') {
      throw new Error('Metadata unavailable');
    }
    if (url.pathname.includes('/form/')) return Response.json({ code: 0, data: { guid: 'test-item' } });
    assert.ok(['/user/foodstuff/add', '/user/meal/add'].includes(url.pathname));
    assert.equal(init?.method, 'POST');
    writes.push(JSON.parse(String(init.body)));
    return Response.json({ code: 0, data: {} });
  });
  for (const tool of writeTools.slice(0, 2)) {
    const result = await client.callTool({ name: tool.name, arguments: tool.args });
    assert.ok(!result.isError);
    assert.ok(Array.isArray(result.content));
    const text = result.content[0];
    assert.ok(text && text.type === 'text');
    const payload = JSON.parse(text.text);
    assert.equal(payload.logged, true);
    assert.equal(payload.date, writes.at(-1)?.['date']);
  }
  assert.equal(writes.length, 2);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 11);
});
