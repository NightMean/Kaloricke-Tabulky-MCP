import { assertCzechDate, KtError } from './client.js';
import type { StatisticsApi } from './statistics.js';
import { apiId, record, records, type ApiRecord, type ApiRequest } from './api.js';

export class MeasurementsApi {
  constructor(private readonly request: ApiRequest, private readonly statistics: StatisticsApi) {}

  private async form(): Promise<ApiRecord> {
    const form = record(await this.request('/user/track/form?format=json'), 'measurement tracker form');
    records(form['typeOptions'], 'measurement types');
    return form;
  }

  async types(): Promise<ApiRecord[]> { return records((await this.form())['typeOptions'], 'measurement types'); }

  async list(date: string): Promise<ApiRecord[]> {
    const series = records(await this.statistics.range('optional', date, date), 'measurement trackers');
    return series.map(item => ({ id: item['guid'], title: item['type'], unit: item['unit'] }));
  }

  private async owned(id: string, date: string): Promise<void> {
    apiId(id);
    if (!(await this.list(date)).some(item => item['id'] === id)) throw new KtError('Measurement tracker not found. Weight is managed separately.');
  }

  async create(typeId: string, title: string | undefined, unit: string | undefined, dryRun: boolean): Promise<ApiRecord> {
    const form = await this.form();
    if (typeId === '0') {
      if (!title?.trim() || !unit?.trim()) throw new KtError('Custom trackers require title and unit');
    } else {
      if (!records(form['typeOptions'], 'measurement types').some(type => type['guid'] === typeId)) throw new KtError('Unsupported measurement type');
      if (title !== undefined || unit !== undefined) throw new KtError('Title/unit overrides are only supported for custom type_id=0');
    }
    const body = { ...form, typeGuid: typeId, title: title ?? null, unit: unit ?? null, value: null };
    const result = dryRun ? null : await this.request('/user/track/add?format=json', { method: 'POST', body });
    return { preview: dryRun, created: !dryRun, type_id: typeId, title, unit, tracker_id: typeof result === 'string' ? result : null,
      note: 'Creates a tracker without an initial measurement. Read list_measurement_trackers before retrying an uncertain creation.' };
  }

  async addValue(id: string, date: string, value: number, dryRun: boolean): Promise<ApiRecord> {
    assertCzechDate(date);
    if (!Number.isFinite(value)) throw new KtError('Expected a finite measurement value');
    await this.owned(id, date);
    const body = { trackGuid: id, value, valueHint: null, unit: null, date };
    if (!dryRun) await this.request('/user/track/value/add?format=json', { method: 'POST', body });
    return { preview: dryRun, recorded: !dryRun, tracker_id: id, date, value,
      note: 'Value uses the tracker’s unit. Inspect the history before retrying an uncertain write.' };
  }

  async delete(id: string, date: string, dryRun: boolean): Promise<ApiRecord> {
    await this.owned(id, date);
    if (!dryRun) await this.request(`/user/track/delete/${apiId(id)}/?format=json`);
    return { preview: dryRun, deleted: !dryRun, tracker_id: id, note: 'Deleting a tracker removes all of its measurement history.' };
  }
}
