import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_EXPORT_BYTES, readExportBytes } from './exports.js';

test('export downloads enforce declared and streamed byte limits', async () => {
  await assert.rejects(readExportBytes(new Response('small', { headers: { 'content-length': String(MAX_EXPORT_BYTES + 1) } })), /shorter date range/);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_EXPORT_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readExportBytes(new Response(stream)), /shorter date range/);
  assert.equal(cancelled, true);
  assert.equal((await readExportBytes(new Response('file'))).toString(), 'file');
});
