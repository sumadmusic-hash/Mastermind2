import type { ProviderAdapter } from './types';
import { createOpenAICompatibleAdapter } from './openai-compatible';
import { geminiAdapter } from './gemini';
import type { ProviderId } from '../../types/provider';

const adapters: Record<string, ProviderAdapter> = {
  groq: createOpenAICompatibleAdapter('groq'),
  openrouter: createOpenAICompatibleAdapter('openrouter'),
  gemini: geminiAdapter,
  lmstudio: createOpenAICompatibleAdapter('lmstudio'),
  ollama: createOpenAICompatibleAdapter('ollama'),
};

// Lokale Server (LM Studio, Ollama) kennen keinen echten API-Key. Für sie wird
// ein fiktiver Key gesendet, damit Endpunkte, die eine Authorization-Zeile
// verlangen, nicht mit 401/403 antworten.
export const LOCAL_PLACEHOLDER_KEY = 'local';

export function isLocalProvider(providerId: string): boolean {
  return providerId === 'lmstudio' || providerId === 'ollama';
}

export function getAdapter(providerId: ProviderId | string): ProviderAdapter {
  const adapter = adapters[providerId];
  if (!adapter) throw new Error(`Unbekannter Provider: ${providerId}`);
  return adapter;
}

export function resolveEndpoint(providerId: ProviderId | string, customBaseUrl?: string): string {
  switch (providerId) {
    case 'groq': return customBaseUrl || 'https://api.groq.com/openai/v1';
    case 'openrouter': return customBaseUrl || 'https://openrouter.ai/api/v1';
    case 'gemini': return customBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    case 'lmstudio': return normalizeLocalBaseUrl(customBaseUrl, 'http://localhost:1234/v1');
    // Ollama liefert unter /v1 ein OpenAI-kompatibles Interface (inkl. /chat/completions).
    case 'ollama': return normalizeLocalBaseUrl(customBaseUrl, 'http://localhost:11434/v1');
    default: return customBaseUrl || '';
  }
}

// Benutzer getippte Base-URLs bereinigen: Leerzeichen und einen evtl.
// gesetzten Proxy entfernen (lokale Server sind immer direkt erreichbar) und
// einen fehlenden "/v1"-Pfad ergänzen – sonst entsteht z.B.
// "http://localhost:11434/chat/completions" (404).
function normalizeLocalBaseUrl(customBaseUrl: string | undefined, fallback: string): string {
  const raw = (customBaseUrl || '').trim();
  if (!raw) return fallback;
  const withoutProxy = raw.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(\.\w+)*:\d{2,5}\/?$/i, '');
  const base = withoutProxy.trim().replace(/\/+$/, '');
  if (!base) return fallback;
  return /\/v\d+(?:\.\d+)?$/.test(base) ? base : `${base}/v1`;
}

export function getAllProviderIds(): ProviderId[] {
  return ['groq', 'openrouter', 'gemini', 'lmstudio', 'ollama'];
}
