import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type KtClient, todayCzech } from '../kt/client.js';
import { dryRun, guard, json, mutation, readOnly, requiredDate } from './shared.js';

const trackerId = z.string().regex(/^[a-zA-Z0-9_-]+$/).describe('Non-weight tracker ID from list_measurement_trackers.');
export function registerMeasurementTools(server: McpServer, kt: KtClient): void {
  server.registerTool('get_measurement_types', { description: 'Read the supported body measurement types. type_id=0 creates a custom metric with an explicit title and unit.', inputSchema: {}, annotations: readOnly },
    guard('get_measurement_types', async () => json({ types: await kt.measurements.types() })));
  server.registerTool('list_measurement_trackers', { description: 'List non-weight measurement trackers and their units. Omit date for today. Read their histories using get_statistics metric=optional.', inputSchema: { date: requiredDate.optional() }, annotations: readOnly },
    guard('list_measurement_trackers', async ({ date }) => json({ trackers: await kt.measurements.list(date ?? todayCzech()) })));
  server.registerTool('create_measurement_tracker', {
    description: 'Create a body/custom measurement tracker without an initial reading. Use a supported type_id, or 0 with title and unit for a custom metric. Weight is managed separately. Supports dry_run; inspect tracker list before retrying an uncertain creation.',
    inputSchema: { type_id: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('0'), title: z.string().min(1).max(100).optional(), unit: z.string().min(1).max(30).optional(), dry_run: dryRun }, annotations: mutation,
  }, guard('create_measurement_tracker', async ({ type_id, title, unit, dry_run }) => json(await kt.measurements.create(type_id, title, unit, dry_run))));
  server.registerTool('record_measurement', {
    description: 'Record a finite value in an existing non-weight tracker’s own unit, on an explicit date. Custom trackers may use zero or negative values. Supports dry_run; inspect get_statistics metric=optional before retrying an uncertain write.',
    inputSchema: { tracker_id: trackerId, date: requiredDate, value: z.number(), dry_run: dryRun }, annotations: mutation,
  }, guard('record_measurement', async ({ tracker_id, date, value, dry_run }) => json(await kt.measurements.addValue(tracker_id, date, value, dry_run))));
  server.registerTool('delete_measurement_tracker', {
    description: 'Permanently delete a non-weight measurement tracker AND ALL its history. Supports dry_run. date is only used to discover the tracker, not to limit deletion to that day.',
    inputSchema: { tracker_id: trackerId, date: requiredDate.optional(), dry_run: dryRun }, annotations: mutation,
  }, guard('delete_measurement_tracker', async ({ tracker_id, date, dry_run }) => json(await kt.measurements.delete(tracker_id, date ?? todayCzech(), dry_run))));
}
