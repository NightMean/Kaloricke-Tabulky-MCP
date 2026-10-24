import { assertCzechDate, KtError } from './client.js';
import { record, records, type ApiRecord, type ApiRequest } from './api.js';
import { parsePeriodAnalysis, type PeriodAnalysis } from './period-analysis.js';

export const STATISTIC_METRICS = ['energy', 'nutrients', 'drink', 'weight', 'optional'] as const;
export type StatisticMetric = typeof STATISTIC_METRICS[number];

export function assertDateRange(from: string, to: string): void {
  assertCzechDate(from);
  assertCzechDate(to);
  const key = (date: string) => date.split('.').reverse().join('');
  if (key(from) > key(to)) throw new KtError('from must be on or before to');
}

export class StatisticsApi {
  constructor(private readonly request: ApiRequest) {}

  async analysis(from: string, to: string): Promise<PeriodAnalysis> {
    assertDateRange(from, to);
    return parsePeriodAnalysis(await this.request(`/statistic/analysis/graph/${from}/${to}/get?format=json`), from, to);
  }

  async range(metric: StatisticMetric, from: string, to: string): Promise<ApiRecord | ApiRecord[]> {
    assertDateRange(from, to);
    if (!STATISTIC_METRICS.includes(metric)) throw new KtError('Unsupported statistics metric');
    const result = await this.request(`/statistic/${metric}/${from}/${to}/get?format=json`);
    return metric === 'optional' ? records(result, 'custom measurement histories') : record(result, 'statistics');
  }

  async tips(from: string, to: string): Promise<ApiRecord[]> {
    assertDateRange(from, to);
    return records(await this.request(`/statistic/analysis/tips/${from}/${to}/get?format=json&top=true`), 'tracking tips');
  }

  async streak(date: string): Promise<number> {
    assertCzechDate(date);
    const iso = date.split('.').reverse().join('-');
    const result = await this.request(`/user/streak?format=json&date=${iso}`);
    if (typeof result !== 'number' || !Number.isInteger(result) || result < 0) throw new KtError('streak: expected a nonnegative integer');
    return result;
  }
}
