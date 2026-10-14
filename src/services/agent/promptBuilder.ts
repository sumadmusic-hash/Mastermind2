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
    } else if (msg.role === 'assistant' && (!msg.content || !msg.content.trim()) && (!msg.toolCalls || msg.toolCalls.length === 0)) {
      // Leere assistant-Nachrichten ohne tool_calls überspringen – Provider lehnen sie ab
      // und nachfolgende tool_messages hätten keinen referenzierten assistant-Call (HTTP 400).
      continue;
    } else if (msg.role === 'tool') {
      // tool-Nachricht ohne toolResults – Inhalt verlieren, nicht als leere tool_message senden
      if (msg.content) {
        messages.push({ role: 'assistant', content: msg.content });
      }
      continue;
    } else {
      const pm: ProviderMessage = {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      };
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // OpenAI-kompatibles Format: { id, type: 'function', function: { name, arguments } }
        pm.tool_calls = (msg.toolCalls as Array<{ id?: string; name?: string; arguments?: unknown; function?: { name: string; arguments: string } }>)
          .map((tc, i) => {
            const name = tc.function?.name ?? tc.name ?? '';
            const rawArgs = tc.function?.arguments ?? tc.arguments ?? '{}';
            return {
              id: tc.id || `call_${i}`,
              type: 'function' as const,
              function: {
                name,
                arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {}),
              },
            };
          });
        // assistant-Nachrichten ohne Text dürfen content nicht als '' haben, aber null ist ok
        if (!pm.content) pm.content = null;
      } else if (msg.role === 'assistant' && !msg.content) {
        // reine Leer-Nachrichten überspringen (sonst 400 bei manchen Providern)
        continue;
      }
      messages.push(pm);
    }
  }

  return messages;
}
