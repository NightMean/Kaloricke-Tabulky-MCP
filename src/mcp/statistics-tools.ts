import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KtClient } from '../kt/client.js';
import { STATISTIC_METRICS } from '../kt/statistics.js';
import { guard, json, readOnly, requiredDate } from './shared.js';

export function registerStatisticsTools(server: McpServer, kt: KtClient): void {
  server.registerTool('get_statistics', {
    description: 'Read date-range energy, nutrient, water (drink), weight or custom measurement (optional) statistics. Returns the site series, units, targets and table data unchanged; absent values are not zero. Unlike get_weight_history this supports an explicit range.',
    inputSchema: { metric: z.enum(STATISTIC_METRICS), from: requiredDate, to: requiredDate }, annotations: readOnly,
  }, guard('get_statistics', async ({ metric, from, to }) => json({ metric, from, to, statistics: await kt.statistics.range(metric, from, to) })));
  server.registerTool('get_tracking_tips', {
    description: 'Read the website’s tracking/nutrition tips for a date range in its configured language. Availability may depend on the account.',
    inputSchema: { from: requiredDate, to: requiredDate }, annotations: readOnly,
  }, guard('get_tracking_tips', async ({ from, to }) => json({ from, to, tips: await kt.statistics.tips(from, to) })));
  server.registerTool('get_tracking_streak', {
    description: 'Read tracking streak information for a date. Input uses dd.MM.yyyy; the API’s ISO query date is handled internally.',
    inputSchema: { date: requiredDate }, annotations: readOnly,
  }, guard('get_tracking_streak', async ({ date }) => json({ date, streak: await kt.statistics.streak(date) })));
}
