export function truncateString(str: string, maxLen = 200): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

export function truncateArray<T>(arr: T[], maxItems = 8): T[] {
  if (arr.length <= maxItems) return arr;
  return arr.slice(0, maxItems);
}

export function compactToolData(data: unknown): unknown {
  if (typeof data === 'string') return truncateString(data);
  if (Array.isArray(data)) return truncateArray(data).map(item => compactToolData(item));
  if (data && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = compactToolData(value);
    }
    return result;
  }
  return data;
}
