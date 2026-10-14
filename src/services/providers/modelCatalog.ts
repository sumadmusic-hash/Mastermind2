import type { ProviderId } from '../../types/provider';

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  provider: ProviderId;
  deprecated?: string; // successor model ID
}

export const MODEL_CATALOG: Record<ProviderId, ModelInfo[]> = {
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 128000, provider: 'groq' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', contextWindow: 128000, provider: 'groq' },
    { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision', contextWindow: 128000, provider: 'groq' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextWindow: 32768, provider: 'groq' },
  ],
  openrouter: [
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 128000, provider: 'openrouter' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', contextWindow: 1000000, provider: 'openrouter' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000, provider: 'openrouter' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000, provider: 'gemini' },
    { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', contextWindow: 1000000, provider: 'gemini' },
    { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', contextWindow: 1000000, provider: 'gemini' },
  ],
  lmstudio: [
    { id: 'local-model', name: 'Lokales Modell', contextWindow: 8192, provider: 'lmstudio' },
  ],
};

// Maps deprecated model IDs to their successors
export const DEPRECATION_MAP: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
  'gemini-1.5-pro-latest': 'gemini-2.0-flash',
  'gemini-1.5-flash-latest': 'gemini-2.0-flash',
  'gemini-pro': 'gemini-2.0-flash',
  'llama-3.0-70b': 'llama-3.3-70b-versatile',
  'llama-2-70b': 'llama-3.3-70b-versatile',
};

export function resolveModelId(modelId: string): string {
  return DEPRECATION_MAP[modelId] || modelId;
}

export function getModelsForProvider(providerId: ProviderId): ModelInfo[] {
  return MODEL_CATALOG[providerId] || [];
}

export function getAllModels(): ModelInfo[] {
  return Object.values(MODEL_CATALOG).flat();
}
