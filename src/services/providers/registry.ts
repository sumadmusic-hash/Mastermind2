import type { ProviderAdapter } from './types';
import { createOpenAICompatibleAdapter } from './openai-compatible';
import { geminiAdapter } from './gemini';
import type { ProviderId } from '../../types/provider';

const adapters: Record<string, ProviderAdapter> = {
  groq: createOpenAICompatibleAdapter('groq'),
  openrouter: createOpenAICompatibleAdapter('openrouter'),
  gemini: geminiAdapter,
  lmstudio: createOpenAICompatibleAdapter('lmstudio'),
};

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
    case 'lmstudio': return customBaseUrl || 'http://localhost:1234/v1';
    default: return customBaseUrl || '';
  }
}

export function getAllProviderIds(): ProviderId[] {
  return ['groq', 'openrouter', 'gemini', 'lmstudio'];
}
