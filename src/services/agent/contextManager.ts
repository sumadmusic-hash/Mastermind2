export function estimateTokens(text: string): number {
  // Rough estimation: ~4 chars per token for English, ~2 for CJK
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(otherChars / 4 + cjkChars / 2);
}

export function truncateHistory(
  messages: Array<{ role: string; content: string; toolResults?: unknown[] }>,
  budgetTokens: number
): Array<{ role: string; content: string; toolResults?: unknown[] }> {
  let totalTokens = 0;
  const result: Array<{ role: string; content: string; toolResults?: unknown[] }> = [];

  // Go from newest to oldest, keep system messages
  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  for (const msg of systemMsgs) {
    const tokens = estimateTokens(msg.content);
    totalTokens += tokens;
    result.push(msg);
  }

  // Add non-system messages from newest to oldest
  const reversed = [...nonSystemMsgs].reverse();
  const kept: Array<{ role: string; content: string; toolResults?: unknown[] }> = [];

  for (const msg of reversed) {
    const tokens = estimateTokens(msg.content);
    if (totalTokens + tokens > budgetTokens) break;
    totalTokens += tokens;
    kept.unshift(msg);
  }

  return [...result, ...kept];
}

export function removeStaleToolResults(
  messages: Array<{ role: string; content: string; toolResults?: unknown[] }>
): Array<{ role: string; content: string; toolResults?: unknown[] }> {
  // Keep tool results only for the last 2 turns
  let turnCount = 0;
  return messages.map(msg => {
    if (msg.role === 'user') turnCount++;
    if (msg.toolResults && turnCount < messages.filter(m => m.role === 'user').length - 2) {
      return { ...msg, toolResults: undefined };
    }
    return msg;
  });
}
