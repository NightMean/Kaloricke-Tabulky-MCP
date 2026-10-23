import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KtClient } from '../kt/client.js';
import { guard, json, readOnly, requiredDate } from './shared.js';

export function registerExportTools(server: McpServer, kt: KtClient): void {
  server.registerTool('export_diary', {
    description: 'Download an authenticated diary XLS/PDF or analysis PDF export for a date range. Returns document bytes as an embedded MCP resource, maximum 5 MiB. Does not publish a link or write a local file. Availability depends on the account.',
    inputSchema: { format: z.enum(['xls', 'pdf', 'analysis']), from: requiredDate, to: requiredDate }, annotations: readOnly,
  }, guard('export_diary', async ({ format, from, to }) => {
    const file = await kt.exports.get(format, from, to);
    return { content: [...json({ filename: file.filename, mime_type: file.mimeType, size_bytes: file.bytes.length, from, to }).content,
      { type: 'resource' as const, resource: { uri: `kt-export://documents/${file.filename}`, mimeType: file.mimeType, blob: file.bytes.toString('base64') } }] };
  }));
}
