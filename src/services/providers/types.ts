import type { ProviderMessage, StreamChunk } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';

export interface ProviderAdapter {
  readonly id: string;
  call(
    config: ProviderCallConfig,
    messages: ProviderMessage[],
    tools?: ToolDefinition[],
    onChunk?: (chunk: StreamChunk) => void,
    abortSignal?: AbortSignal
  ): Promise<ProviderResponse>;
  testConnection(apiKey: string, baseUrl?: string): Promise<boolean>;
}

export interface ProviderCallConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  proxyBaseUrl?: string;
}

export interface ProviderResponse {
  content: string;
  toolCalls?: ProviderToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class AuthProviderError extends ProviderError {
  constructor(provider: string) {
    super(`Authentifizierung fehlgeschlagen bei ${provider}`, provider, 401, false);
    this.name = 'AuthProviderError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(provider: string, public readonly retryAfterMs?: number) {
    super(`Rate-Limit erreicht bei ${provider}`, provider, 429, true);
    this.name = 'RateLimitError';
  }
}

export class ContentRefusalError extends ProviderError {
  constructor(provider: string, public readonly reason: string) {
    super(`Inhalt abgelehnt von ${provider}: ${reason}`, provider, undefined, false);
    this.name = 'ContentRefusalError';
  }
}

export class EmptyResponseError extends ProviderError {
  constructor(provider: string) {
    super(`Leere Antwort von ${provider}`, provider, undefined, true);
    this.name = 'EmptyResponseError';
  }
}

export function isAuthError(err: unknown): boolean {
  return err instanceof AuthProviderError ||
    (err instanceof Error && err.message.toLowerCase().includes('auth'));
}

export function isRateLimitError(err: unknown): boolean {
  return err instanceof RateLimitError;
}

export function isRefusalError(err: unknown): boolean {
  return err instanceof ContentRefusalError;
}
