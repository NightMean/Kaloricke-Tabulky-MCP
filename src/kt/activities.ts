import { assertCzechDate, KtError } from './client.js';
import type { DiaryApi } from './diary.js';
import { apiId, positive, record, records, type ApiRecord, type ApiRequest } from './api.js';

export class ActivitiesApi {
  constructor(private readonly request: ApiRequest, private readonly diary: DiaryApi) {}

  async search(query: string, page: number): Promise<ApiRecord[]> {
    if (!query.trim() || !Number.isInteger(page) || page < 0) throw new KtError('Expected a search query and nonnegative page');
    return records(await this.request(`/autocomplete/activity?format=json&query=${encodeURIComponent(query)}&page=${page}`), 'activities');
  }

  async form(id: string): Promise<ApiRecord> {
    const form = record(await this.request(`/user/activity/add/form/${apiId(id)}?format=json`), 'activity form');
    if (form['guid'] !== id || typeof form['title'] !== 'string' || !form['title']) throw new KtError('Activity not found');
    return form;
  }

  private duration(minutes: number, unit: unknown): number {
    positive(minutes, 'duration_minutes');
    if (minutes > 1440) throw new KtError('duration_minutes cannot exceed 1440');
    if (unit === 'hrs') return minutes / 60;
    if (unit === 'min') return minutes;
    throw new KtError('Unsupported activity duration unit');
  }

  async log(args: { id: string; date: string; minutes: number; time?: string; dryRun: boolean }): Promise<ApiRecord> {
    assertCzechDate(args.date);
    if (args.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.time)) throw new KtError('time must be HH:mm');
    const form = await this.form(args.id);
    const payload = { ...form, date: args.date, time: this.duration(args.minutes, form['timeUnit']),
      timeUser: args.time !== undefined, timeOfInsert: args.time ?? null, days: null };
    if (!args.dryRun) await this.request('/user/activity/add?format=json', { method: 'POST', body: payload });
    return { preview: args.dryRun, logged: !args.dryRun, activity_id: args.id, title: form['title'], date: args.date, duration_minutes: args.minutes, time: args.time };
  }

  async edit(args: { id: string; date: string; minutes: number; dryRun: boolean }): Promise<ApiRecord> {
    await this.diary.entry(args.date, args.id, 'activity');
    const form = record(await this.request(`/user/diary/activity/unit/form/${apiId(args.id)}?format=json`), 'activity edit form');
    if (form['diaryGuid'] !== args.id) throw new KtError('Activity edit form: entry ID mismatch');
    const payload = { ...form, multiplier: this.duration(args.minutes, form['unit']) };
    if (!args.dryRun) await this.request('/user/diary/activity/unit/edit?format=json', { method: 'POST', body: payload });
    return { preview: args.dryRun, updated: !args.dryRun, entry_id: args.id, date: args.date, duration_minutes: args.minutes };
  }
}
