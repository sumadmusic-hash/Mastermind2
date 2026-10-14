import type { ProviderAdapter, ProviderResponse, ProviderCallConfig } from '../providers/types';
import type { ProviderMessage, ModelSlot, StreamChunk } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';
import { getAdapter, resolveEndpoint } from '../providers/registry';
import { detectRefusal } from '../providers/refusal';
import { resolveModelId } from '../providers/modelCatalog';
import { ContentRefusalError, isAuthError, isRateLimitError, ProviderError } from '../providers/types';
import { recordTokenUsage } from '../db/logs';

export interface FailoverResult {
  response: ProviderResponse;
  providerId: string;
  modelId: string;
  attempts: number;
}

export async function callWithFailover(
  slots: ModelSlot[],
  messages: ProviderMessage[],
  tools: ToolDefinition[] | undefined,
  apiKeys: Record<string, string>,
  proxyBaseUrl: string,
  onChunk?: (chunk: StreamChunk) => void,
  abortSignal?: AbortSignal
): Promise<FailoverResult> {
  let lastError: Error | null = null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const apiKey = apiKeys[slot.providerId];
    if (!apiKey && slot.providerId !== 'lmstudio') continue;

    const modelId = resolveModelId(slot.modelId);
    const baseUrl = resolveEndpoint(slot.providerId);
    const adapter = getAdapter(slot.providerId);

    const config: ProviderCallConfig = {
      apiKey,
      baseUrl,
      model: modelId,
      proxyBaseUrl: proxyBaseUrl || undefined,
    };

    try {
      const response = await adapter.call(config, messages, tools, onChunk, abortSignal);

      // Check for content refusal
      if (response.content) {
        const refusal = detectRefusal(response.content);
        if (refusal.isRefusal && i < slots.length - 1) {
          console.warn(`Refusal bei ${slot.providerId}/${modelId}, versuche Fallback...`);
          continue;
        }
        if (refusal.isRefusal) {
          throw new ContentRefusalError(slot.providerId, refusal.reason);
        }
      }

      // Record token usage
      if (response.usage) {
        await recordTokenUsage({
          provider: slot.providerId,
          model: modelId,
          ...response.usage,
          timestamp: Date.now(),
        });
      }

      return { response, providerId: slot.providerId, modelId, attempts: i + 1 };
    } catch (err) {
      lastError = err as Error;
      // Don't retry auth errors
      if (isAuthError(err)) throw err;
      // Retry rate limits and server errors with next slot
      if (isRateLimitError(err) || (err instanceof ProviderError && err.retryable)) {
        console.warn(`Fehler bei ${slot.providerId}/${modelId}: ${(err as Error).message}, versuche Fallback...`);
        continue;
      }
      // For 404 (deprecated model), try next slot
      if (err instanceof ProviderError && err.statusCode === 404) {
        console.warn(`Modell ${modelId} nicht gefunden, versuche Fallback...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Kein Provider verfügbar');
}
