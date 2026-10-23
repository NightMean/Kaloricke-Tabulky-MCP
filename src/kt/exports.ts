import { KtError } from './client.js';
import { assertDateRange } from './statistics.js';

export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
export type ExportKind = 'xls' | 'pdf' | 'analysis';
export interface ExportFile { filename: string; mimeType: string; bytes: Buffer }

/** Bound both declared and chunked responses before retaining the complete file. */
export async function readExportBytes(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_EXPORT_BYTES) {
    await response.body?.cancel();
    throw new KtError('Export exceeds 5 MiB. Request a shorter date range.');
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_EXPORT_BYTES) {
      await reader.cancel();
      throw new KtError('Export exceeds 5 MiB. Request a shorter date range.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export class ExportsApi {
  constructor(private readonly download: (path: string) => Promise<Buffer>) {}

  async get(kind: ExportKind, from: string, to: string): Promise<ExportFile> {
    assertDateRange(from, to);
    if (!['xls', 'pdf', 'analysis'].includes(kind)) throw new KtError('Unsupported export format');
    const bytes = await this.download(`/user/export/${kind}/${from}/${to}/get`);
    const pdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    const ole = bytes.subarray(0, 8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
    const zip = bytes.subarray(0, 4).equals(Buffer.from([80,75,3,4]));
    if (kind === 'xls' ? !ole && !zip : !pdf) throw new KtError('Export did not return the expected document. Check account access or try a shorter range.');
    const extension = pdf ? 'pdf' : zip ? 'xlsx' : 'xls';
    const mimeType = pdf ? 'application/pdf' : zip ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel';
    return { filename: `kt-${kind}-${from}-${to}.${extension}`, mimeType, bytes };
  }
}
