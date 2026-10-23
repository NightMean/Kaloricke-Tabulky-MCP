import { KtError } from './client.js';

export type ApiRecord = Record<string, unknown>;
export type ApiRequest = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

export function record(value: unknown, context: string): ApiRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KtError(`${context}: expected an object`);
  }
  return value as ApiRecord;
}

export function records(value: unknown, context: string): ApiRecord[] {
  if (!Array.isArray(value)) throw new KtError(`${context}: expected an array`);
  return value.map(item => record(item, context));
}

export function apiId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new KtError('Expected an ID returned by the API');
  return encodeURIComponent(value);
}

export function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new KtError(`${name}: expected a finite positive number`);
  return value;
}
