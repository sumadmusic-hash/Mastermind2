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

// Grobe Token-Schätzung (~4 Zeichen pro Token) für die TPM-Vorreservierung.
function estimateTokens(messages: ProviderMessage[]): number {
  const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  return Math.max(1, Math.ceil(chars / 4));
}

export async function callWithFailover(
  slots: ModelSlot[],
  messages: ProviderMessage[],
  tools: ToolDefinition[] | undefined,
  apiKeys: Record<string, string>,
  proxyBaseUrl: string,
  onChunk?: (chunk: StreamChunk) => void,
  abortSignal?: AbortSignal,
  providerBaseUrls?: Record<string, string>,
  tpmLimit?: number
): Promise<FailoverResult> {
  let lastError: Error | null = null;
  // Kumulierter Token-Verbrauch über alle Versuche dieses Failover-Durchlaufs.
  let consumedTokens = 0;
  const limit = tpmLimit && tpmLimit > 0 ? tpmLimit : 0; // 0 = kein Limit

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const apiKey = apiKeys[slot.providerId];
    if (!apiKey && slot.providerId !== 'lmstudio') continue;

    // TPM-Limit auswerten: Wenn das Minutenbudget erschöpft ist, nicht weitere
    // Provider anfragen (würde nur 429 produzieren), sondern klar abbrechen.
    if (limit > 0) {
      const estimated = estimateTokens(messages);
      if (consumedTokens + estimated > limit) {
        throw new Error(`TPM-Limit erreicht (${consumedTokens}+${estimated} > ${limit} Tokens/Minute). Versuch später erneut.`);
      }
    }

    const modelId = resolveModelId(slot.modelId);
    const baseUrl = resolveEndpoint(slot.providerId, providerBaseUrls?.[slot.providerId]);
    const adapter = getAdapter(slot.providerId);

    const config: ProviderCallConfig = {
      apiKey: (apiKey || '').trim(),
      baseUrl,
      model: modelId,
      proxyBaseUrl: proxyBaseUrl || undefined,
    };

    // Wrapper um den Caller-onChunk: meldet dem Orchestrator einen Reset der
    // Streaming-Anzeige, bevor dieser Versuch Text liefert. So wird textueller
    // Rest eines fehlgeschlagenen Versuchs nie mit der Antwort des Fallbacks
    // doppelt sichtbar ("Doppelte KI-Antwort bei Provider-Failover").
    let resetDone = false;
    const attemptOnChunk = onChunk ? ((chunk: StreamChunk) => {
      if (!resetDone && chunk.type === 'text' && chunk.content) {
        resetDone = true;
        onChunk({ type: 'reset' });
      }
      onChunk(chunk);
    }) : undefined;

    try {
      const response = await adapter.call(config, messages, tools, attemptOnChunk, abortSignal);

      // Token-Verbrauch für TPM-Buchung erfassen
      if (response.usage) {
        consumedTokens += response.usage.totalTokens || (response.usage.promptTokens + response.usage.completionTokens);
      }

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
