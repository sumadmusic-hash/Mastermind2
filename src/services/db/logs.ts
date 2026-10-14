import { db } from './schema';
import type { LogEntry, TokenUsageEntry } from './schema';

export async function addLog(level: LogEntry['level'], message: string, context?: string): Promise<void> {
  await db.logs.add({ level, message, timestamp: Date.now(), context });
  // Keep only last 1000 logs
  const count = await db.logs.count();
  if (count > 1000) {
    const oldest = await db.logs.orderBy('timestamp').limit(count - 1000).toArray();
    await db.logs.bulkDelete(oldest.map(l => l.id!));
  }
}

export async function getLogs(limit = 100): Promise<LogEntry[]> {
  return db.logs.orderBy('timestamp').reverse().limit(limit).toArray();
}

export async function recordTokenUsage(entry: Omit<TokenUsageEntry, 'id'>): Promise<void> {
  await db.tokenUsage.add(entry);
}

export async function getTokenUsageStats(days = 7): Promise<{ provider: string; total: number }[]> {
  const since = Date.now() - days * 86400000;
  const entries = await db.tokenUsage.where('timestamp').above(since).toArray();
  const byProvider: Record<string, number> = {};
  for (const e of entries) {
    byProvider[e.provider] = (byProvider[e.provider] || 0) + e.totalTokens;
  }
  return Object.entries(byProvider).map(([provider, total]) => ({ provider, total }));
}
