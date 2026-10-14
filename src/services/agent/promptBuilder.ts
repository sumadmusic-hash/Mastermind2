import type { ProviderMessage } from '../../types/provider';

const SYSTEM_PROMPT = `Du bist ein KI-Forschungsassistent. Antworte präzise und hilfreich.

Regeln:
- Antworte auf Deutsch, es sei denn der Nutzer schreibt in einer anderen Sprache.
- Maximal 300 Wörter pro Antwort.
- Nutze Tools wenn nötig (Web-Suche, Datenanalyse, etc.).
- Maximal 3 Tool-Calls pro Turn.
- Zitiere Quellen mit URLs wenn vorhanden.
- Bei Unsicherheit: sage es ehrlich.`;

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildProviderMessages(
  systemPrompt: string,
  history: Array<{ role: string; content: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
): ProviderMessage[] {
  const messages: ProviderMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of history) {
    if (msg.role === 'tool' && msg.toolResults) {
      // Tool results become tool messages
      for (const tr of msg.toolResults as Array<{ callId: string; toolId: string; content: string }>) {
        messages.push({
          role: 'tool',
          content: tr.content || JSON.stringify(tr),
          tool_call_id: tr.callId,
          name: tr.toolId,
        });
      }
    } else {
      const pm: ProviderMessage = {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      };
      if (msg.role === 'assistant' && msg.toolCalls) {
        pm.tool_calls = msg.toolCalls as Array<{ id: string; name: string; arguments: string }>;
      }
      messages.push(pm);
    }
  }

  return messages;
}
