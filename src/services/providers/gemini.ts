import type { ProviderAdapter, ProviderCallConfig, ProviderResponse } from './types';
import { AuthProviderError, RateLimitError, ProviderError } from './types';
import type { ProviderMessage, StreamChunk } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';

// Gemini uses a different API format
function toGeminiContents(messages: ProviderMessage[]) {
  const contents: Array<{ role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }> = [];
  const systemInstruction: { parts: Array<{ text: string }> } = { parts: [] };

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction.parts.push({ text: msg.content || '' });
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> = [];

    if (msg.tool_call_id) {
      parts.push({
        functionResponse: {
          name: msg.name || 'unknown',
          response: { result: msg.content || '' },
        },
      });
    } else if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.name || tc.function?.name,
            args: JSON.parse(tc.arguments || tc.function?.arguments || '{}'),
          },
        });
      }
    } else {
      parts.push({ text: msg.content || '' });
    }
    contents.push({ role, parts });
  }
  return { contents, systemInstruction };
}

function toGeminiTools(tools: ToolDefinition[]) {
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.id,
      description: t.description,
      parameters: t.inputSchema,
    })),
  }];
}

export const GEMINI_DEPRECATION_MAP: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
  'gemini-1.5-pro-latest': 'gemini-2.0-flash',
  'gemini-1.5-flash-latest': 'gemini-2.0-flash',
  'gemini-pro': 'gemini-2.0-flash',
};

export function resolveGeminiModel(modelId: string): string {
  return GEMINI_DEPRECATION_MAP[modelId] || modelId;
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  async call(
    config: ProviderCallConfig,
    messages: ProviderMessage[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: StreamChunk) => void,
    abortSignal?: AbortSignal
  ): Promise<ProviderResponse> {
    const model = resolveGeminiModel(config.model);
    const base = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${base}/models/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;

    const body: Record<string, unknown> = {
      ...toGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: config.maxTokens || 4096,
        temperature: config.temperature ?? 0.7,
      },
    };
    if (tools && tools.length > 0) {
      body.tools = toGeminiTools(tools);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ProviderError(`Gemini Netzwerkfehler: ${(err as Error).message}`, 'gemini', undefined, true);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthProviderError('gemini');
    }
    if (response.status === 429) {
      throw new RateLimitError('gemini');
    }
    if (response.status === 404) {
      throw new ProviderError(`Modell "${model}" nicht gefunden (evtl. deprecated)`, 'gemini', 404, false);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(`Gemini HTTP ${response.status}: ${text}`, 'gemini', response.status, response.status >= 500);
    }

    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('Kein Response-Body', 'gemini');
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    const toolCalls: ProviderResponse['toolCalls'] = [];
    let usage: ProviderResponse['usage'];

    while (true) {
      if (abortSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        // SSE-Spezifikation: ein optionales Leerzeichen nach "data:" entfernen –
        // Server senden teils "data:{json}" ohne Leerzeichen.
        let dataLine = line.replace(/\r$/, '').trim();
        if (!dataLine.startsWith('data:')) continue;
        dataLine = dataLine.slice(5);
        if (dataLine.startsWith(' ')) dataLine = dataLine.slice(1);
        const data = dataLine.trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const parts = json.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              fullContent += part.text;
              onChunk?.({ type: 'text', content: part.text });
            }
            if (part.functionCall) {
              toolCalls.push({
                id: `gemini_${Date.now()}_${toolCalls.length}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
              });
            }
          }
          if (json.usageMetadata) {
            usage = {
              promptTokens: json.usageMetadata.promptTokenCount || 0,
              completionTokens: json.usageMetadata.candidatesTokenCount || 0,
              totalTokens: json.usageMetadata.totalTokenCount || 0,
            };
          }
        } catch { /* skip */ }
      }
    }

    onChunk?.({ type: 'done' });
    return { content: fullContent, toolCalls, usage, finishReason: 'stop' };
  },
  async testConnection(apiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      return res.ok;
    } catch { return false; }
  },
};
