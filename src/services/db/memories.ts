import { db } from './schema';
import type { MemoryEntry } from './schema';

export async function saveMemory(category: string, key: string, value: string): Promise<void> {
  const existing = await db.memories.where({ category, key }).first();
  if (existing) {
    await db.memories.update(existing.id!, { value, updatedAt: Date.now() });
  } else {
    await db.memories.add({ category, key, value, updatedAt: Date.now() });
  }
}

export async function recallMemory(category?: string): Promise<MemoryEntry[]> {
  if (category) {
    return db.memories.where('category').equals(category).toArray();
  }
  return db.memories.toArray();
}

export async function forgetMemory(category: string, key: string): Promise<void> {
  await db.memories.where({ category, key }).delete();
}

export async function getAllMemories(): Promise<MemoryEntry[]> {
  return db.memories.orderBy('updatedAt').reverse().toArray();
}
