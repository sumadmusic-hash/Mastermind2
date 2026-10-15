import { z } from 'zod';

export const ProviderId = z.enum(['groq', 'openrouter', 'gemini', 'lmstudio', 'ollama']);
export type ProviderId = z.infer<typeof ProviderId>;

export const ProviderConfigSchema = z.object({
  id: ProviderId,
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  enabled: z.boolean(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ModelSlotSchema = z.object({
  slot: z.number(),
  label: z.string(),
  providerId: ProviderId,
  modelId: z.string(),
  isPrimary: z.boolean(),
});
export type ModelSlot = z.infer<typeof ModelSlotSchema>;

export const ProviderMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});
export type ProviderMessage = z.infer<typeof ProviderMessageSchema>;

export const StreamChunkSchema = z.object({
  // 'reset' signalisiert dem Consumer, dass die Streaming-Anzeige verworfen
  // werden muss (z.B. vor dem ersten Text-Delta eines Fallback-Versuchs).
  type: z.enum(['text', 'tool_call', 'done', 'error', 'reset']),
  content: z.string().optional(),
  toolCall: z.any().optional(),
  error: z.string().optional(),
});
export type StreamChunk = z.infer<typeof StreamChunkSchema>;

export interface AppSettings {
  id: string;
  providers: Record<string, ProviderConfig>;
  modelSlots: ModelSlot[];
  proxyBaseUrl: string;
  tpmLimit: number;
  enabledTools: Record<string, boolean>;
  darkMode: boolean;
  language: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'main',
  providers: {
    groq: { id: 'groq', apiKey: '', enabled: true },
    openrouter: { id: 'openrouter', apiKey: '', enabled: false },
    gemini: { id: 'gemini', apiKey: '', enabled: false },
    lmstudio: { id: 'lmstudio', apiKey: '', baseUrl: 'http://localhost:1234/v1', enabled: false },
    ollama: { id: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434/v1', enabled: false },
  },
  modelSlots: [
    { slot: 0, label: 'Primär', providerId: 'groq', modelId: 'llama-3.3-70b-versatile', isPrimary: true },
    { slot: 1, label: 'Fallback 1', providerId: 'groq', modelId: 'llama-3.1-8b-instant', isPrimary: false },
    { slot: 2, label: 'Fallback 2', providerId: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct', isPrimary: false },
    { slot: 3, label: 'Fallback 3', providerId: 'gemini', modelId: 'gemini-2.0-flash', isPrimary: false },
    { slot: 4, label: 'Fallback 4', providerId: 'gemini', modelId: 'gemini-2.5-flash', isPrimary: false },
    { slot: 5, label: 'Fallback 5', providerId: 'lmstudio', modelId: 'local-model', isPrimary: false },
    { slot: 6, label: 'Fallback 6', providerId: 'openrouter', modelId: 'google/gemini-2.0-flash-001', isPrimary: false },
  ],
  proxyBaseUrl: '',
  tpmLimit: 60000,
  enabledTools: {},
  darkMode: true,
  language: 'de',
};
