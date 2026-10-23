import { assertCzechDate, type MealId, KtError } from './client.js';
import { apiId, positive, record, records, type ApiRecord, type ApiRequest } from './api.js';

export type EntryKind = 'food' | 'activity';
export interface Diary {
  date: string;
  raw: ApiRecord;
  times: ApiRecord[];
  activities: ApiRecord[];
}

/** Diary IDs are distinct from database food IDs and saved recipe IDs. */
export class DiaryApi {
  constructor(private readonly request: ApiRequest) {}

  async get(date: string): Promise<Diary> {
    assertCzechDate(date);
    const raw = record(await this.request(`/user/diary/${date}/get?format=json`), 'diary');
    const times = records(raw['times'], 'diary meal slots');
    for (const time of times) records(time['foodstuff'], 'diary foods');
    return { date, raw, times, activities: records(raw['activities'], 'diary activities') };
  }

  async entry(date: string, id: string, kind: EntryKind): Promise<ApiRecord> {
    apiId(id);
    const diary = await this.get(date);
    const entries = kind === 'food' ? diary.times.flatMap(time => records(time['foodstuff'], 'diary foods')) : diary.activities;
    const entry = entries.find(item => item['id'] === id);
    if (!entry) throw new KtError(`No ${kind} entry ${id} on ${date}. Read get_diary first.`);
    return entry;
  }

  async foodUnits(date: string, id: string): Promise<ApiRecord> {
    await this.entry(date, id, 'food');
    const form = record(await this.request(`/user/diary/foodstuff/unit/form/${apiId(id)}?format=json`), 'food edit form');
    if (form['diaryGuid'] !== null && form['diaryGuid'] !== id) throw new KtError('food edit form: entry ID mismatch');
    records(form['unitOptions'], 'food edit units');
    return { ...form, diaryGuid: id };
  }

  async editFood(args: { date: string; id: string; amount: number; unitId?: string; dryRun: boolean }): Promise<ApiRecord> {
    positive(args.amount, 'amount');
    const form = await this.foodUnits(args.date, args.id);
    const unit = args.unitId ?? form['unitGuid'];
    if (!records(form['unitOptions'], 'food edit units').some(option => option['id'] === unit)) {
      throw new KtError('Unit not offered for this entry. Read get_diary_food_units first.');
    }
    const payload = { ...form, unitGuid: unit, multiplier: args.amount };
    if (!args.dryRun) await this.request('/user/diary/foodstuff/unit/edit?format=json', { method: 'POST', body: payload });
    return { preview: args.dryRun, updated: !args.dryRun, entry_id: args.id, date: args.date, amount: args.amount, unit_id: unit };
  }

  async delete(args: { date: string; id: string; kind: EntryKind; dryRun: boolean }): Promise<ApiRecord> {
    await this.entry(args.date, args.id, args.kind);
    const route = args.kind === 'food' ? 'foodstuff' : 'activity';
    if (!args.dryRun) await this.request(`/user/diary/${route}/delete/${apiId(args.id)}?format=json`);
    return { preview: args.dryRun, deleted: !args.dryRun, entry_id: args.id, kind: args.kind, date: args.date };
  }

  async move(args: { date: string; id: string; meal?: MealId; targetDate?: string; dryRun: boolean }): Promise<ApiRecord> {
    if ((args.meal === undefined) === (args.targetDate === undefined)) throw new KtError('Supply exactly one of meal or target_date');
    if (args.targetDate) assertCzechDate(args.targetDate);
    await this.entry(args.date, args.id, 'food');
    const destination = args.meal ? `${args.meal}/0` : `0/${args.targetDate}`;
    if (!args.dryRun) await this.request(`/user/diary/${apiId(args.id)}/${destination}/dragndrop?format=json`);
    return { preview: args.dryRun, moved: !args.dryRun, entry_id: args.id, source_date: args.date, target_date: args.targetDate, meal: args.meal };
  }

  async copy(args: { date: string; targetDate: string; ids: string[]; dryRun: boolean }): Promise<ApiRecord> {
    assertCzechDate(args.targetDate);
    if (args.date === args.targetDate) throw new KtError('Copy requires a different target date');
    if (!args.ids.length || new Set(args.ids).size !== args.ids.length) throw new KtError('Supply distinct diary entry IDs');
    args.ids.forEach(apiId);
    const diary = await this.get(args.date);
    const all = [...diary.times.flatMap(time => records(time['foodstuff'], 'diary foods')), ...diary.activities];
    for (const id of args.ids) if (!all.some(item => item['id'] === id)) throw new KtError(`No diary entry ${id} on ${args.date}`);
    const select = (entry: ApiRecord) => ({ ...entry, selected: args.ids.includes(String(entry['id'])) });
    const payload = { ...diary.raw, date: args.targetDate,
      times: diary.times.map(time => ({ ...time, foodstuff: records(time['foodstuff'], 'diary foods').map(select) })),
      activities: diary.activities.map(select) };
    if (!args.dryRun) await this.request('/user/diary/copy?format=json', { method: 'POST', body: payload });
    return { preview: args.dryRun, copied: !args.dryRun, source_date: args.date, target_date: args.targetDate, entry_ids: args.ids,
      note: 'Copy adds new entries. After an uncertain network failure, inspect the destination diary before retrying.' };
  }

  async addNote(date: string, meal: MealId, text: string, dryRun: boolean): Promise<ApiRecord> {
    assertCzechDate(date);
    if (!text.trim() || text.length > 10000) throw new KtError('Note must contain 1–10000 characters');
    if (!dryRun) await this.request('/user/diary/note/add?format=json', { method: 'POST', body: { date, time: meal, note: text } });
    return { preview: dryRun, added: !dryRun, date, meal, note: text };
  }

  async deleteNote(date: string, id: string, dryRun: boolean): Promise<ApiRecord> {
    apiId(id);
    const diary = await this.get(date);
    const notes = [diary.raw['notes'], ...diary.times.map(time => time['notes'])]
      .flatMap(value => value == null ? [] : records(value, 'diary notes'));
    if (!notes.some(note => note['id'] === id)) throw new KtError(`No note ${id} on ${date}`);
    if (!dryRun) await this.request(`/user/diary/note/delete/${apiId(id)}?format=json`);
    return { preview: dryRun, deleted: !dryRun, date, note_id: id };
  }
}
