import { db } from './schema';
import type { Position, TimeseriesCache } from './schema';

export async function getPositions(): Promise<Position[]> {
  return db.positions.toArray();
}

export async function upsertPosition(pos: Omit<Position, 'id'>): Promise<void> {
  const existing = await db.positions.where('ticker').equals(pos.ticker).first();
  if (existing) {
    await db.positions.update(existing.id!, { ...pos, updatedAt: Date.now() });
  } else {
    await db.positions.add({ ...pos, updatedAt: Date.now() });
  }
}

export async function deletePosition(ticker: string): Promise<void> {
  await db.positions.where('ticker').equals(ticker).delete();
}

export async function getCachedTimeseries(source: string, seriesId: string): Promise<TimeseriesCache | undefined> {
  const entry = await db.timeseriesCache.where({ source, seriesId }).first();
  if (entry && entry.expiresAt > Date.now()) return entry;
  return undefined;
}

export async function setCachedTimeseries(source: string, seriesId: string, data: string, ttlMs: number): Promise<void> {
  await db.timeseriesCache.where({ source, seriesId }).delete();
  await db.timeseriesCache.add({
    source,
    seriesId,
    data,
    expiresAt: Date.now() + ttlMs,
  });
}
