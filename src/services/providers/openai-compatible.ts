import type { ProviderAdapter, ProviderCallConfig, ProviderResponse, ProviderToolCall } from './types';
import { AuthProviderError, RateLimitError, EmptyResponseError, ProviderError } from './types';
import type { ProviderMessage, StreamChunk } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';

function resolveUrl(config: ProviderCallConfig, path: string, proxyBaseUrl?: string): string {
  const base = config.baseUrl || '';
  const targetUrl = `${base}${path}`;
  if (proxyBaseUrl) {
    // CORS-Proxy: erwartet die Ziel-URL als Query-Parameter, z.B. https://proxy.example/?url=
    const sep = proxyBaseUrl.includes('?') ? '&' : '?';
    return `${proxyBaseUrl}${sep}url=${encodeURIComponent(targetUrl)}`;
  }
  return targetUrl;
}

function mapToolDefsToOpenAI(tools: ToolDefinition[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.id,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export function parseSSELine(rawLine: string): { data: string } | null {
  // SSE-Spezifikation: Das eine optionale Leerzeichen nach "data:" wird entfernt,
  // "data:{json}" und "data:  {json}" sind equally gültig. Viele Server senden
  // ohne Leerzeichen – daher Präfix flexibel abschneiden.
  const line = rawLine.replace(/\r$/, '').trim();
  if (!line.startsWith('data:')) return null;
  let data = line.slice(5);
  if (data.startsWith(' ')) data = data.slice(1);
  return { data };
}

export async function streamOpenAICompatible(
  providerId: string,
  config: ProviderCallConfig,
  messages: ProviderMessage[],
  tools: ToolDefinition[] | undefined,
  onChunk: ((chunk: StreamChunk) => void) | undefined,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  const url = resolveUrl(config, '/chat/completions', config.proxyBaseUrl);
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    max_tokens: config.maxTokens || 4096,
    temperature: config.temperature ?? 0.7,
  };
  if (tools && tools.length > 0) {
    body.tools = mapToolDefsToOpenAI(tools);
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = (config.apiKey || '').trim();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ProviderError(`Netzwerkfehler: ${(err as Error).message}`, providerId, undefined, true);
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthProviderError(providerId);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    throw new RateLimitError(providerId, retryAfter ? parseInt(retryAfter) * 1000 : undefined);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(`HTTP ${response.status}: ${text}`, providerId, response.status, response.status >= 500);
  }

  return parseSSEStream(providerId, response, onChunk, abortSignal);
}

async function parseSSEStream(
  providerId: string,
  response: Response,
  onChunk: ((chunk: StreamChunk) => void) | undefined,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new EmptyResponseError(providerId);

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  const toolCalls: ProviderToolCall[] = [];
  let usage: ProviderResponse['usage'];

  while (true) {
    if (abortSignal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const parsed = parseSSELine(line.trim());
      if (!parsed) continue;
      if (parsed.data === '[DONE]') continue;

      try {
        const json = JSON.parse(parsed.data);
        if (json.usage) {
          usage = {
            promptTokens: json.usage.prompt_tokens || 0,
            completionTokens: json.usage.completion_tokens || 0,
            totalTokens: json.usage.total_tokens || 0,
          };
        }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          onChunk?.({ type: 'text', content: delta.content });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            // Provider senden tool_calls mit index 0..n. Wenn ein Provider
            // (oder ein kaputter Stream) Lücken lässt, würde ein löchriges (sparse) Array
            // entstehen – `toolCalls.length` wäre dann größer als die Anzahl
            // realer Einträge und `.map()` würde über undefined-Locher iterieren
            // (Absturz bei tc.id). Deshalb: fehlende Indizes überspringen und
            // das Array am Ende verdichten.
            if (tc == null) continue;
            const idx = Number.isInteger(tc.index) ? tc.index : toolCalls.length;
            if (idx < 0) continue;
            if (idx >= toolCalls.length) {
              // Lücke im Stream -> neuen Call anhängen statt das Array löchrig zu machen
              toolCalls.push({ id: tc.id || '', name: tc.function?.name || '', arguments: '' });
            } else if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
            }
            const slot = toolCalls[idx];
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) {
              slot.arguments += tc.function.arguments;
            }
          }
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  if (!fullContent && toolCalls.length === 0) {
    throw new EmptyResponseError(providerId);
  }

  // Verdichten: falls der Stream Lücken hinterlassen hat (theoretisch durch
  // obige Logik verhindert, hier als Sicherheitsnetz), niemals sparse Arrays
  // an den Orchestrator weitergeben – sonst bricht .map() über undefined-Lochern.
  const denseToolCalls = toolCalls.filter(Boolean);

  onChunk?.({ type: 'done' });
  return {
    content: fullContent,
    toolCalls: denseToolCalls.length > 0 ? denseToolCalls : undefined,
    usage,
    finishReason: 'stop',
  };
}

export function createOpenAICompatibleAdapter(providerId: string): ProviderAdapter {
  return {
    id: providerId,
    async call(config, messages, tools, onChunk, abortSignal) {
      return streamOpenAICompatible(providerId, config, messages, tools, onChunk, abortSignal);
    },
    async testConnection(apiKey, baseUrl) {
      try {
        const res = await fetch(`${baseUrl || ''}/models`, {
          headers: { Authorization: `Bearer ${(apiKey || '').trim()}` },
        });
        if (!res.ok) {
          console.warn(`Verbindungstest ${providerId}: HTTP ${res.status}`, await res.text().catch(() => ''));
        }
        return res.ok;
      } catch (err) {
        console.warn(`Verbindungstest ${providerId}: Netzwerk-/CORS-Fehler`, err);
        return false;
      }
    },
  };
}
