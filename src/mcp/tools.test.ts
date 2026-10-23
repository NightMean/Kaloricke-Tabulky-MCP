import { strict as assert } from 'node:assert';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GRAM_UNIT, KtClient } from '../kt/client.js';
import { registerTools } from './tools.js';

const statistics = {
  todayEnergy: '1 850,5', todayEnergyTarget: '2 200', energyUnit: 'kcal',
  todayDrink: '0,1', todayDrinkTarget: '2,8', drinkUnit: 'l',
  monthWeight: [{ description: '23.10.2026', value: 80 }],
};
const diary = {
  items: [{ code: null, unit: 'l', actual: '0,09', actualValue: 0, goal: '2,84' }],
  itemsDynamic: [[
    { code: 'protein', actual: '120,4', actualValue: 120.4, goal: '140', unit: 'g' },
    { code: 'carbohydrate', actual: '210', actualValue: 210, goal: '250', unit: 'g' },
  ], [
    { code: 'fat', actual: '65,2', actualValue: 65.2, goal: '70', unit: 'g' },
    { code: 'fiber', actual: '28,5', actualValue: 28.5, goal: '30', unit: 'g' },
  ]],
};

const recipeForm = {
  guid: 'test-recipe', selectedUnitGuid: GRAM_UNIT, selectedUnitMultiplier: 100, count: null,
  units: [{ id: '0000000000000003', title: '%', multiplier: -1 }, { id: GRAM_UNIT, title: '1 g', multiplier: 1 }],
  foodstuff: [{ selected: true, count: 100, countOriginal: 100, selectedUnitGuid: GRAM_UNIT, selectedUnitGuidOriginal: GRAM_UNIT }],
};

async function connectTools(t: TestContext, reply: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://www.kaloricketabulky.sk');
    assert.equal(url.searchParams.get('format'), url.pathname.startsWith('/user/export/') ? null : 'json');
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
  assert.deepEqual(payload.overview.water, { current: 90, target: 2840, unit: 'ml' });
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
      return Response.json({ code: 0, data: recipeForm });
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
      assert.equal(body.count, undefined);
      assert.equal(body.selectedUnitGuid, '0000000000000003');
      assert.equal(body.selectedUnitMultiplier, 100);
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
    if (url.pathname === '/user/meal/add/form/test-recipe') return Response.json({ code: 0, data: recipeForm });
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
  assert.ok(tools.tools.some(tool => tool.name === 'get_diary'));
});

const detailedDiary = {
  times: [{ id: '1', title: 'Raňajky', foodstuff: [
    { id: 'entry-one', title: 'Food', selected: true }, { id: 'entry-two', title: 'Other', selected: true },
  ] }],
  activities: [{ id: 'activity-one', selected: true }], notes: [],
};

test('recipe editing preserves unrelated metadata and uses native ingredient forms', async t => {
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/settings/meal/edit/form/recipe-one/') return Response.json({ code: 0,
      data: { guid: 'recipe-one', title: 'Original', visibility: 'private', lang: 'sk', items: [{ guid: 'old' }], tags: ['keep'] } });
    if (url.pathname === '/recipe/form/item/liquid-one') return Response.json({ code: 0,
      data: { guid: 'liquid-one', units: [{ id: 'ml', multiplier: 1 }, { id: 'glass', multiplier: 200 }] } });
    assert.equal(url.pathname, '/user/settings/meal/detail/edit/recipe-one');
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({ code: 0 });
  });
  const args = { meal_id: 'recipe-one', title: 'Changed', instructions: ['Mix'], servings: 2,
    ingredients: [{ food_id: 'liquid-one', amount: 150 }] };
  assert.ok(!(await client.callTool({ name: 'edit_recipe', arguments: { ...args, dry_run: true } })).isError);
  assert.equal(writes.length, 0);
  assert.ok(!(await client.callTool({ name: 'edit_recipe', arguments: args })).isError);
  assert.equal(writes[0].visibility, 'private');
  assert.equal(writes[0].lang, 'sk');
  assert.deepEqual(writes[0].tags, ['keep']);
  assert.deepEqual(writes[0].description, [{ description: 'Mix' }]);
  assert.equal(writes[0].portions, '2');
  assert.equal(writes[0].items[0].selectedUnitGuid, 'ml');
  assert.equal(writes[0].items[0].unitCount, 150);
  assert.equal((await client.callTool({ name: 'edit_recipe', arguments: { meal_id: 'recipe-one' } })).isError, true);
});

test('logged recipe edits scale the existing count and display label together', async t => {
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0, data: detailedDiary });
    if (url.pathname === '/user/diary/meal/edit/form/entry-one') return Response.json({ code: 0,
      data: { ...recipeForm, guidDiary: 'entry-one', selectedUnitGuid: '0000000000000003', selectedUnitMultiplier: 50,
        foodstuff: [{ selected: true, count: 50, countOriginal: 50, selectedUnitGuidOriginal: GRAM_UNIT }] } });
    assert.equal(url.pathname, '/user/meal/edit');
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({ code: 0 });
  });
  assert.ok(!(await client.callTool({ name: 'edit_diary_recipe', arguments: { entry_id: 'entry-one', date: '24.10.2026', factor: 0.5 } })).isError);
  assert.equal(writes[0].foodstuff[0].count, 25);
  assert.equal(writes[0].selectedUnitMultiplier, 25);
  assert.equal(writes[0].guidDiary, 'entry-one');
});

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

test('recipe images validate bytes and upload as multipart without a JSON content type', async t => {
  let uploads = 0;
  const { client, requests } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/settings/meal/edit/form/recipe-one/') return Response.json({ code: 0,
      data: { guid: 'recipe-one', title: 'Recipe', items: [] } });
    assert.equal(url.pathname, '/user/settings/meal/detail/recipe-one/image/create');
    assert.ok(init?.body instanceof FormData);
    assert.equal(new Headers(init.headers).has('Content-Type'), false);
    assert.ok(init.body.get('file') instanceof Blob);
    uploads++;
    return Response.json({ code: 0 });
  });
  const args = { meal_id: 'recipe-one', content_type: 'image/png', image_base64: tinyPng };
  assert.equal((await client.callTool({ name: 'upload_recipe_image', arguments: { ...args, image_base64: 'not an image' } })).isError, true);
  assert.deepEqual(requests, []);
  assert.ok(!(await client.callTool({ name: 'upload_recipe_image', arguments: { ...args, dry_run: true } })).isError);
  assert.equal(uploads, 0);
  assert.ok(!(await client.callTool({ name: 'upload_recipe_image', arguments: args })).isError);
  assert.equal(uploads, 1);
});

test('activity logging converts minutes to native hours and previews perform no writes', async t => {
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/activity/add/form/activity-one') return Response.json({ code: 0,
      data: { guid: 'activity-one', title: 'Chôdza', time: 1, timeUnit: 'hrs', days: ['unexpected'], timeUser: true } });
    assert.equal(url.pathname, '/user/activity/add');
    assert.equal(init?.method, 'POST');
    writes.push(JSON.parse(String(init.body)));
    return Response.json({ code: 0 });
  });
  const args = { activity_id: 'activity-one', date: '24.10.2026', duration_minutes: 30, time: '09:30' };
  assert.ok(!(await client.callTool({ name: 'log_activity', arguments: { ...args, dry_run: true } })).isError);
  assert.equal(writes.length, 0);
  assert.ok(!(await client.callTool({ name: 'log_activity', arguments: args })).isError);
  assert.equal(writes[0].time, 0.5);
  assert.equal(writes[0].timeOfInsert, '09:30');
  assert.equal(writes[0].timeUser, true);
  assert.equal(writes[0].date, '24.10.2026');
  assert.equal(writes[0].days, null);
});

test('activity corrections use entry IDs and validate the original duration unit', async t => {
  let unit = 'hrs';
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0, data: detailedDiary });
    if (url.pathname === '/user/diary/activity/unit/form/activity-one') return Response.json({ code: 0,
      data: { diaryGuid: 'activity-one', multiplier: 1, unit } });
    assert.equal(url.pathname, '/user/diary/activity/unit/edit');
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({ code: 0 });
  });
  const args = { entry_id: 'activity-one', date: '24.10.2026', duration_minutes: 15 };
  assert.ok(!(await client.callTool({ name: 'edit_diary_activity', arguments: args })).isError);
  assert.equal(writes[0].multiplier, 0.25);
  unit = 'unknown';
  assert.equal((await client.callTool({ name: 'edit_diary_activity', arguments: args })).isError, true);
  assert.equal(writes.length, 1);
});

test('range statistics preserve raw series and validate all range and metric inputs before requests', async t => {
  const raw = { unit: 'kg', values: [null, '80,1'], from: 1, to: 2 };
  const { client, requests } = await connectTools(t, url => {
    assert.equal(url.pathname, '/statistic/weight/20.10.2026/23.10.2026/get');
    return Response.json({ code: 0, data: raw });
  });
  const args = { metric: 'weight', from: '20.10.2026', to: '23.10.2026' };
  for (const patch of [{ from: '24.10.2026' }, { to: '31.02.2026' }, { metric: '../../bad' }]) {
    assert.equal((await client.callTool({ name: 'get_statistics', arguments: { ...args, ...patch } })).isError, true);
  }
  assert.deepEqual(requests, []);
  const result = await client.callTool({ name: 'get_statistics', arguments: args });
  assert.ok(!result.isError);
  assert.ok(Array.isArray(result.content) && result.content[0]?.type === 'text');
  assert.deepEqual(JSON.parse(result.content[0].text).statistics, raw);
});

test('tracking streak converts calendar dates and custom statistics preserve list responses', async t => {
  const { client } = await connectTools(t, url => {
    if (url.pathname === '/user/streak') {
      assert.equal(url.searchParams.get('date'), '2026-10-23');
      return Response.json({ code: 0, data: 10 });
    }
    assert.equal(url.pathname, '/statistic/optional/20.10.2026/23.10.2026/get');
    return Response.json({ code: 0, data: [] });
  });
  assert.ok(!(await client.callTool({ name: 'get_tracking_streak', arguments: { date: '23.10.2026' } })).isError);
  assert.ok(!(await client.callTool({ name: 'get_statistics', arguments: { metric: 'optional', from: '20.10.2026', to: '23.10.2026' } })).isError);
});

test('diary food correction validates the date, entry ownership and offered units', async t => {
  let posted: unknown;
  const { client, requests } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0, data: detailedDiary });
    if (url.pathname === '/user/diary/foodstuff/unit/form/entry-one') {
      return Response.json({ code: 0, data: { diaryGuid: 'entry-one', multiplier: 30, unitGuid: GRAM_UNIT,
        unitOptions: [{ id: GRAM_UNIT, multiplier: 1 }] } });
    }
    assert.equal(url.pathname, '/user/diary/foodstuff/unit/edit');
    assert.equal(init?.method, 'POST');
    posted = JSON.parse(String(init.body));
    return Response.json({ code: 0 });
  });
  const args = { date: '24.10.2026', entry_id: 'entry-one', amount: 50, unit_id: GRAM_UNIT };
  assert.ok(!(await client.callTool({ name: 'edit_diary_food', arguments: { ...args, dry_run: true } })).isError);
  assert.equal(posted, undefined);
  for (const patch of [{ entry_id: 'missing' }, { unit_id: 'missing' }, { date: '31.02.2026' }]) {
    assert.equal((await client.callTool({ name: 'edit_diary_food', arguments: { ...args, ...patch } })).isError, true);
  }
  assert.equal(posted, undefined);
  assert.ok(!(await client.callTool({ name: 'edit_diary_food', arguments: args })).isError);
  assert.deepEqual(posted, { diaryGuid: 'entry-one', multiplier: 50, unitGuid: GRAM_UNIT,
    unitOptions: [{ id: GRAM_UNIT, multiplier: 1 }] });
  assert.equal(requests.filter(path => path === '/user/diary/foodstuff/unit/edit').length, 1);
});

test('diary deletion and moves preview without invoking mutating GET endpoints', async t => {
  const { client, requests } = await connectTools(t, url => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0, data: detailedDiary });
    return Response.json({ code: 0 });
  });
  const args = { date: '24.10.2026', entry_id: 'entry-one' };
  for (const name of ['delete_diary_entry', 'move_diary_food']) {
    const changesBefore = requests.filter(path => /delete|dragndrop/.test(path)).length;
    const extra = name === 'delete_diary_entry' ? { kind: 'food' } : { meal: '3' };
    assert.ok(!(await client.callTool({ name, arguments: { ...args, ...extra, dry_run: true } })).isError);
    assert.equal(requests.filter(path => /delete|dragndrop/.test(path)).length, changesBefore);
    assert.equal((await client.callTool({ name, arguments: { ...args, ...extra, entry_id: 'missing' } })).isError, true);
    assert.ok(!(await client.callTool({ name, arguments: { ...args, ...extra } })).isError);
  }
  assert.ok(requests.includes('/user/diary/foodstuff/delete/entry-one'));
  assert.ok(requests.includes('/user/diary/entry-one/3/0/dragndrop'));
});

test('copying diary entries selects only requested IDs and rejects same-day copies', async t => {
  const observed: { body?: any } = {};
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0, data: {
      ...detailedDiary, notes: [{ id: 'global-note', text: 'Do not copy' }],
      times: detailedDiary.times.map(time => ({ ...time, notes: [{ id: 'meal-note', text: 'Do not copy' }], templateNotes: [{ text: 'Do not copy' }] })),
    } });
    assert.equal(url.pathname, '/user/diary/copy');
    observed.body = JSON.parse(String(init?.body));
    return Response.json({ code: 0 });
  });
  const args = { date: '24.10.2026', target_date: '25.10.2026', entry_ids: ['entry-one'] };
  assert.equal((await client.callTool({ name: 'copy_diary_entries', arguments: { ...args, target_date: args.date } })).isError, true);
  assert.ok(!(await client.callTool({ name: 'copy_diary_entries', arguments: { ...args, dry_run: true } })).isError);
  assert.equal(observed.body, undefined);
  assert.ok(!(await client.callTool({ name: 'copy_diary_entries', arguments: args })).isError);
  const payload = JSON.parse(JSON.stringify(observed.body));
  assert.equal(payload.date, '2026-10-24T22:00:00.000Z');
  assert.deepEqual(payload.times[0].foodstuff.map((item: any) => item.selected), [true, false]);
  assert.equal(payload.activities[0].selected, false);
  assert.deepEqual(payload.notes, []);
  assert.deepEqual(payload.times[0].notes, []);
  assert.deepEqual(payload.times[0].templateNotes, []);
});

test('half-recipe preview and write agree on the multiplier and submit a supported display unit', async t => {
  let writes = 0;
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/settings/meal/list') {
      return Response.json({ code: 0, data: [{ guid: 'test-recipe', title: 'Recipe', energy: '250', energyUnit: 'kcal' }] });
    }
    if (url.pathname === '/user/meal/add/form/test-recipe') return Response.json({ code: 0, data: recipeForm });
    assert.equal(url.pathname, '/user/meal/add');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.selectedUnitGuid, '0000000000000003');
    assert.equal(body.selectedUnitMultiplier, 50);
    assert.equal(body.foodstuff[0].count, 50);
    assert.equal(body.count, undefined);
    writes++;
    return Response.json({ code: 0, data: {} });
  });
  for (const dry_run of [true, false]) {
    const result = await client.callTool({ name: 'log_meal', arguments: {
      meal_id: 'test-recipe', meal: '6', date: '24.10.2026', portions: 0.5, dry_run,
    } });
    assert.ok(!result.isError);
    assert.ok(Array.isArray(result.content));
    const text = result.content[0];
    assert.ok(text && text.type === 'text');
    const payload = JSON.parse(text.text);
    assert.equal(payload.portions, 0.5);
    assert.equal(payload.energy, '125 kcal');
    assert.equal(writes, dry_run ? 0 : 1);
  }
});

test('unsupported recipe forms fail clearly before any write', async t => {
  let currentForm: unknown;
  const { client, requests } = await connectTools(t, url => {
    if (url.pathname === '/user/settings/meal/list') return Response.json({ code: 0, data: [] });
    assert.equal(url.pathname, '/user/meal/add/form/test-recipe');
    return Response.json({ code: 0, data: currentForm });
  });
  const invalidForms = [
    { ...recipeForm, units: [] },
    { ...recipeForm, foodstuff: [] },
    { ...recipeForm, foodstuff: [null] },
    { ...recipeForm, foodstuff: [{ countOriginal: 'invalid', count: 100 }] },
    { ...recipeForm, foodstuff: [{ countOriginal: -1 }] },
  ];
  for (const form of invalidForms) {
    currentForm = form;
    const result = await client.callTool({ name: 'log_meal', arguments: {
      meal_id: 'test-recipe', meal: '6', date: '24.10.2026', portions: 0.5,
    } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /meal add form:/);
  }
  assert.ok(!requests.includes('/user/meal/add'));
});

test('profile reads exclude credential, payment and contact fields by allowlist', async t => {
  const { client } = await connectTools(t, url => {
    assert.equal(url.pathname, '/user/settings/profile/form');
    return Response.json({ code: 0, data: { energyUnit: 'kcal', weight: 80, ownTargetEnergy: 0,
      email: 'private@example.invalid', password1: 'sensitive-fixture', gopayToken: 'payment-fixture', unknownFutureSecret: 'private' } });
  });
  const result = await client.callTool({ name: 'get_profile', arguments: {} });
  assert.ok(Array.isArray(result.content) && result.content[0]?.type === 'text');
  assert.deepEqual(JSON.parse(result.content[0].text).profile, { energyUnit: 'kcal', weight: 80, ownTargetEnergy: 0 });
});

test('favorite previews do not write and setting existing membership is a no-op', async t => {
  const changes: string[] = [];
  const { client } = await connectTools(t, url => {
    if (url.pathname === '/user/settings/favorite/activity') return Response.json({ code: 0, data: [{ id: 'existing' }] });
    changes.push(url.pathname); return Response.json({ code: 0 });
  });
  for (const args of [{ item_id: 'new', enabled: true, dry_run: true }, { item_id: 'existing', enabled: true }]) {
    assert.ok(!(await client.callTool({ name: 'set_favorite', arguments: { kind: 'activity', ...args } })).isError);
  }
  assert.deepEqual(changes, []);
  assert.ok(!(await client.callTool({ name: 'set_favorite', arguments: { kind: 'activity', item_id: 'new', enabled: true } })).isError);
  assert.deepEqual(changes, ['/user/settings/favorite/activity/add/new']);
});

test('note previews and missing note IDs cannot invoke writes or deletion', async t => {
  const changes: string[] = [];
  const { client } = await connectTools(t, url => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0,
      data: { ...detailedDiary, notes: [{ id: 'note-one', text: 'Existing' }] } });
    changes.push(url.pathname); return Response.json({ code: 0 });
  });
  assert.ok(!(await client.callTool({ name: 'add_diary_note', arguments: { date: '24.10.2026', meal: '1', text: 'Test', dry_run: true } })).isError);
  assert.ok(!(await client.callTool({ name: 'delete_diary_note', arguments: { date: '24.10.2026', note_id: 'note-one', dry_run: true } })).isError);
  assert.equal((await client.callTool({ name: 'delete_diary_note', arguments: { date: '24.10.2026', note_id: 'missing' } })).isError, true);
  assert.deepEqual(changes, []);
  assert.ok(!(await client.callTool({ name: 'delete_diary_note', arguments: { date: '24.10.2026', note_id: 'note-one' } })).isError);
  assert.deepEqual(changes, ['/user/diary/note/delete/note-one']);
});

test('template application checks ownership and targets only the authenticated account and requested date', async t => {
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/templates/list') return Response.json({ code: 0, data: [{ id: 'template-one' }] });
    if (url.pathname === '/user/templates/form/template-one') return Response.json({ code: 0,
      data: { id: 'template-one', times: [], datesToAdd: ['old'], userGuidToShare: 'other-account', userGuidFromShare: 'other' } });
    assert.equal(url.pathname, '/user/templates/diary/write');
    writes.push(JSON.parse(String(init?.body))); return Response.json({ code: 0 });
  });
  const args = { template_id: 'template-one', date: '24.10.2026' };
  assert.equal((await client.callTool({ name: 'apply_template', arguments: { ...args, template_id: 'unknown' } })).isError, true);
  assert.ok(!(await client.callTool({ name: 'apply_template', arguments: { ...args, dry_run: true } })).isError);
  assert.equal(writes.length, 0);
  assert.ok(!(await client.callTool({ name: 'apply_template', arguments: args })).isError);
  assert.deepEqual(writes[0].datesToAdd, ['24.10.2026']);
  assert.equal(writes[0].userGuidToShare, null);
  assert.equal(writes[0].userGuidFromShare, null);
  assert.equal(writes[0].coeficientMultiplier, 1);
});

test('measurement writes require a non-weight tracker and retain zero values', async t => {
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/statistic/optional/24.10.2026/24.10.2026/get') return Response.json({ code: 0,
      data: [{ guid: 'tracker-one', type: 'Example', unit: 'points' }] });
    assert.equal(url.pathname, '/user/track/value/add');
    writes.push(JSON.parse(String(init?.body))); return Response.json({ code: 0 });
  });
  const args = { tracker_id: 'tracker-one', date: '24.10.2026', value: 0 };
  assert.ok(!(await client.callTool({ name: 'record_measurement', arguments: { ...args, dry_run: true } })).isError);
  assert.equal((await client.callTool({ name: 'record_measurement', arguments: { ...args, tracker_id: 'weight' } })).isError, true);
  assert.equal(writes.length, 0);
  assert.ok(!(await client.callTool({ name: 'record_measurement', arguments: args })).isError);
  assert.deepEqual(writes[0], { trackGuid: 'tracker-one', value: 0, valueHint: null, unit: null, date: args.date });
});

test('custom tracker creation requires explicit title and unit and does not record an initial value', async t => {
  const writes: any[] = [];
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/track/form') return Response.json({ code: 0,
      data: { typeGuid: null, typeOptions: [{ guid: 'waist', title: 'Waist' }], value: 12 } });
    assert.equal(url.pathname, '/user/track/add');
    writes.push(JSON.parse(String(init?.body))); return Response.json({ code: 0, data: 'tracker-one' });
  });
  assert.equal((await client.callTool({ name: 'create_measurement_tracker', arguments: { title: 'Custom' } })).isError, true);
  assert.equal(writes.length, 0);
  assert.ok(!(await client.callTool({ name: 'create_measurement_tracker', arguments: { title: 'Custom', unit: 'points' } })).isError);
  assert.equal(writes[0].typeGuid, '0');
  assert.equal(writes[0].value, null);
});

test('exports renew an expired session and return intact document bytes as an MCP resource', async t => {
  let attempts = 0;
  const { client, requests } = await connectTools(t, url => {
    assert.equal(url.pathname, '/user/export/pdf/23.10.2026/23.10.2026/get');
    if (++attempts === 1) return new Response(null, { status: 302, headers: { location: '/login' } });
    return new Response('%PDF-1.4\nexample', { headers: { 'content-type': 'application/force-download' } });
  });
  const result = await client.callTool({ name: 'export_diary', arguments: { format: 'pdf', from: '23.10.2026', to: '23.10.2026' } });
  assert.ok(!result.isError && Array.isArray(result.content));
  const resource = result.content.find(item => item.type === 'resource');
  assert.ok(resource?.type === 'resource' && 'blob' in resource.resource);
  assert.equal(resource.resource.mimeType, 'application/pdf');
  assert.equal(Buffer.from(resource.resource.blob, 'base64').toString(), '%PDF-1.4\nexample');
  assert.equal(requests.filter(path => path === '/login/create').length, 2);
});

test('exports fail clearly on exhausted authentication and HTML responses', async t => {
  let mode = 'login';
  const { client } = await connectTools(t, () => mode === 'login'
    ? new Response(null, { status: 302, headers: { location: '/login' } })
    : new Response('<html>Access required</html>'));
  const args = { format: 'pdf', from: '23.10.2026', to: '23.10.2026' };
  let result = await client.callTool({ name: 'export_diary', arguments: args });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /still unauthenticated/);
  mode = 'html';
  result = await client.callTool({ name: 'export_diary', arguments: args });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /expected document/);
});

test('upstream HTTP failures cannot masquerade as successful diary reads or writes', async t => {
  let writes = 0;
  const { client } = await connectTools(t, (url, init) => {
    if (url.pathname === '/user/diary/24.10.2026/get') return Response.json({ code: 0, data: detailedDiary }, { status: 503 });
    if (url.pathname === '/user/activity/add/form/activity-one') return Response.json({ code: 0,
      data: { guid: 'activity-one', title: 'Walking', timeUnit: 'hrs' } });
    assert.equal(url.pathname, '/user/activity/add');
    assert.equal(init?.method, 'POST'); writes++;
    return Response.json({ code: 0 }, { status: 503 });
  });
  for (const [name, args] of [
    ['get_diary', { date: '24.10.2026' }],
    ['log_activity', { activity_id: 'activity-one', date: '24.10.2026', duration_minutes: 10 }],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /HTTP 503/);
  }
  assert.equal(writes, 1, 'An uncertain write must not be replayed');
});

test('MCP cancellation reaches an in-flight API read and prevents a following write', async t => {
  const cancellation = new AbortController();
  let start!: () => void, cancelled!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const observed = new Promise<void>(resolve => { cancelled = resolve; });
  const { client, requests } = await connectTools(t, async (url, init) => {
    assert.equal(url.pathname, '/user/activity/add/form/activity-one');
    const signal = init?.signal;
    assert.ok(signal);
    start();
    await new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => { cancelled(); reject(signal.reason); }, { once: true });
    });
    throw new Error('Unreachable');
  });
  const pending = client.callTool({ name: 'log_activity', arguments: {
    activity_id: 'activity-one', date: '24.10.2026', duration_minutes: 10,
  } }, undefined, { signal: cancellation.signal }).catch(error => error);
  await started;
  cancellation.abort();
  assert.ok(await pending instanceof Error);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([observed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Cancellation did not reach the API request')), 1000); })]);
  } finally { clearTimeout(deadline); }
  assert.ok(!requests.includes('/user/activity/add'));
});
