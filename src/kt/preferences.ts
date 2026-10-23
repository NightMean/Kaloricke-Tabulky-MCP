import { apiId, record, records, type ApiRecord, type ApiRequest } from './api.js';

export type CatalogKind = 'foodstuff' | 'activity';
const PROFILE_FIELDS = ['sex', 'height', 'weight', 'year', 'country', 'targetWeight', 'drinkRegime', 'amr',
  'energyUnit', 'preferGram', 'considerActivity', 'time', 'ownTargetEnergy', 'ownBasal', 'ownNutrients',
  'ownDailyDose', 'computedTargetEnergy', 'computedBasal', 'lang', 'showAlcohol', 'showTips'] as const;

export class PreferencesApi {
  constructor(private readonly request: ApiRequest) {}

  async catalog(kind: CatalogKind, common = false): Promise<ApiRecord[]> {
    return records(await this.request(`/user/settings/${common ? 'common' : 'favorite'}/${kind}?format=json`), 'personal catalog');
  }

  async favorite(kind: CatalogKind, id: string, enabled: boolean, dryRun: boolean): Promise<ApiRecord> {
    apiId(id);
    const favorites = await this.catalog(kind);
    const present = favorites.some(item => item['id'] === id || item['guid'] === id);
    if (!dryRun && present !== enabled) await this.request(`/user/settings/favorite/${kind}/${enabled ? 'add' : 'remove'}/${apiId(id)}?format=json`);
    return { preview: dryRun, item_id: id, kind, enabled, changed: !dryRun && present !== enabled };
  }

  async profile(): Promise<ApiRecord> {
    const form = record(await this.request('/user/settings/profile/form?format=json'), 'profile');
    // The source form also carries payment/auth fields. Never expose them through MCP.
    return Object.fromEntries(PROFILE_FIELDS.filter(key => key in form).map(key => [key, form[key]]));
  }
}
