import { z } from 'zod';

export const ToolCategory = z.enum([
  'search', 'news', 'finance', 'data', 'knowledge', 'memory', 'automation', 'calendar'
]);
export type ToolCategory = z.infer<typeof ToolCategory>;

export const Permission = z.enum(['read', 'write', 'network', 'storage']);
export type Permission = z.infer<typeof Permission>;

export const ToolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: ToolCategory,
  inputSchema: z.any(),
  outputSchema: z.any().optional(),
  version: z.string(),
  enabled: z.boolean(),
  permissions: z.array(Permission),
  maxDuration: z.number(),
  maxDataSize: z.number(),
  builtin: z.boolean(),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  arguments: z.record(z.any()),
  timestamp: z.number(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  date: z.string().optional(),
  source: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ToolResultSchema = z.object({
  callId: z.string(),
  toolId: z.string(),
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  sources: z.array(SourceSchema).optional(),
  duration: z.number(),
  cached: z.boolean(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export type ToolExecuteFn = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
) => Promise<ToolResult>;

export interface ToolExecutionContext {
  abortSignal?: AbortSignal;
  origin: 'user' | 'scheduled';
  sessionId: string;
}

export const LEGACY_ID_MAP: Record<string, string> = {
  weather: 'weather_lookup',
  search: 'ddg_web_search',
  news: 'ai_search',
  stock: 'stock_price',
  calc: 'calculator',
  translate: 'translate_text',
  summarize: 'text_summarize',
  report: 'generate_report',
  chart: 'chart_spec',
  company: 'company_lookup',
  // Nachrichten-IDs: das frühere news_search-Tool wurde entfernt – alte
  // Agent-Historie/Tool-Aufrufe laufen jetzt über die KI-Suche (Jina).
  news_search: 'ai_search',
  webz_news: 'ai_search',
  webz_top_news: 'ai_search',
  gnews_search: 'ai_search',
  gnews_top_headlines: 'ai_search',
};
