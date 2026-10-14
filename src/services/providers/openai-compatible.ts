import type { ProviderAdapter, ProviderCallConfig, ProviderResponse, ProviderToolCall } from './types';
import { AuthProviderError, RateLimitError, EmptyResponseError, ProviderError } from './types';
import type { ProviderMessage, StreamChunk } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';

function resolveUrl(config: ProviderCallConfig, path: string): string {
  const base = config.baseUrl || '';
  return `${base}${path}`;
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

function parseSSELine(line: string): { data: string } | null {
  if (line.startsWith('data: ')) {
    return { data: line.slice(6) };
  }
  return null;
}

export async function streamOpenAICompatible(
  providerId: string,
  config: ProviderCallConfig,
  messages: ProviderMessage[],
  tools: ToolDefinition[] | undefined,
  onChunk: ((chunk: StreamChunk) => void) | undefined,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  const url = resolveUrl(config, '/chat/completions');
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
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
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
            const idx = tc.index || 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
            }
            if (tc.function?.arguments) {
              toolCalls[idx].arguments += tc.function.arguments;
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

  onChunk?.({ type: 'done' });
  return {
    content: fullContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
