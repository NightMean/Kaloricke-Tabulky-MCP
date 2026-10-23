import { assertCzechDate, KtError } from './client.js';
import { apiId, record, records, type ApiRecord, type ApiRequest } from './api.js';

export class TemplatesApi {
  constructor(private readonly request: ApiRequest) {}

  async list(): Promise<ApiRecord[]> {
    return records(await this.request('/user/templates/list?format=json'), 'templates');
  }

  async get(id: string): Promise<ApiRecord> {
    apiId(id);
    if (!(await this.list()).some(template => template['id'] === id)) throw new KtError('Template not found in this account');
    const form = record(await this.request(`/user/templates/form/${apiId(id)}?format=json`), 'template');
    if (form['id'] !== id) throw new KtError('Template ID mismatch');
    records(form['times'], 'template meal slots');
    return form;
  }

  async create(date: string, title: string, activities: boolean, notes: boolean, dryRun: boolean): Promise<ApiRecord> {
    assertCzechDate(date);
    if (!title.trim() || title.length > 250) throw new KtError('Template title must contain 1–250 characters');
    const body = { title, includeActivities: activities, includeNotes: notes };
    const result = dryRun ? null : await this.request(`/user/templates/diary/${date}/create?format=json`, { method: 'POST', body });
    return { preview: dryRun, created: !dryRun, source_date: date, ...body,
      template_id: typeof result === 'string' ? result : null,
      note: 'Copies all foods from the source day. Use list_templates to find the new template ID; inspect the list before retrying an uncertain creation.' };
  }

  async apply(id: string, date: string, dryRun: boolean): Promise<ApiRecord> {
    assertCzechDate(date);
    const form = await this.get(id);
    const body = { ...form, datesToAdd: [date], userGuidToShare: null, userGuidFromShare: null, coeficientMultiplier: 1 };
    if (!dryRun) await this.request('/user/templates/diary/write?format=json', { method: 'POST', body });
    return { preview: dryRun, applied: !dryRun, template_id: id, date,
      note: 'Adds template entries without replacing the diary. Read get_diary after an uncertain failure before retrying.' };
  }

  async delete(id: string, dryRun: boolean): Promise<ApiRecord> {
    const form = await this.get(id);
    if (!dryRun) await this.request('/user/templates/delete?format=json', { method: 'POST', body: form });
    return { preview: dryRun, deleted: !dryRun, template_id: id };
  }
}
