import type { ChatMessage, TurnState } from '../../types/chat';
import type { ProviderMessage, ModelSlot, StreamChunk } from '../../types/provider';
import type { ToolDefinition, ToolResult } from '../../types/tool';
import { buildSystemPrompt, buildProviderMessages } from './promptBuilder';
import { truncateHistory } from './contextManager';
import { dispatchToolCall, clearDedupCache } from './toolDispatcher';
import { callWithFailover } from './fallback';
import { selectRelevantTools } from '../tools/relevance';
import { toolRegistry } from '../tools/registry';
import { addMessage, getSession } from '../db/chats';
import { getSettings } from '../db/settings';
import { v4 as uuid } from 'uuid';

const MAX_AGENT_ITERATIONS = 5;
const CONTEXT_BUDGET_TOKENS = 24000;

export interface AgentCallbacks {
  onStream?: (text: string) => void;
  onToolCall?: (toolId: string, args: Record<string, unknown>) => void;
  onToolResult?: (result: ToolResult) => void;
  onStateChange?: (state: TurnState) => void;
  onError?: (error: Error) => void;
}

export async function sendMessage(
  sessionId: string,
  userContent: string,
  callbacks: AgentCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  callbacks.onStateChange?.('streaming');
  clearDedupCache();

  // Add user message
  const userMsg: ChatMessage = {
    id: uuid(),
    role: 'user',
    content: userContent,
    timestamp: Date.now(),
  };
  await addMessage(sessionId, userMsg);

  // Get settings
  const settings = await getSettings();
  const slots = settings.modelSlots.filter(s => settings.providers[s.providerId]?.enabled || s.providerId === 'lmstudio');
  if (slots.length === 0) {
    throw new Error('Kein Modell-Slot aktiv. Bitte in den Einstellungen mindestens einen Provider aktivieren und einen API-Key hinterlegen.');
  }
  const apiKeys: Record<string, string> = {};
  for (const [pid, cfg] of Object.entries(settings.providers)) {
    apiKeys[pid] = cfg.apiKey;
  }
  const providerBaseUrls: Record<string, string> = {};
  for (const [pid, cfg] of Object.entries(settings.providers)) {
    if (cfg.baseUrl) providerBaseUrls[pid] = cfg.baseUrl;
  }

  // Build context
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session nicht gefunden');

  const history = truncateHistory(
    session.messages.map(m => ({ role: m.role, content: m.content, toolCalls: m.toolCalls, toolResults: m.toolResults })),
    CONTEXT_BUDGET_TOKENS
  );

  const systemPrompt = buildSystemPrompt();
  const allTools = toolRegistry.getEnabled();
  const relevantTools = selectRelevantTools(userContent, allTools);

  let iteration = 0;
  let currentMessages = buildProviderMessages(systemPrompt, history);

  while (iteration < MAX_AGENT_ITERATIONS) {
    iteration++;
    if (abortSignal?.aborted) {
      callbacks.onStateChange?.('interrupted');
      return;
    }

    let streamedText = '';
    const onChunk = (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content) {
        streamedText += chunk.content;
        callbacks.onStream?.(chunk.content);
      }
    };

    let response;
    try {
      const result = await callWithFailover(
        slots, currentMessages, relevantTools, apiKeys, settings.proxyBaseUrl, onChunk, abortSignal, providerBaseUrls
      );
      response = result.response;
    } catch (err) {
      callbacks.onError?.(err as Error);
      callbacks.onStateChange?.('error');
      return;
    }

    // If there are tool calls, execute them
    if (response.toolCalls && response.toolCalls.length > 0) {
      callbacks.onStateChange?.('tool_executing');

      // Add assistant message with tool calls
      const assistantMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
        timestamp: Date.now(),
      };
      await addMessage(sessionId, assistantMsg);

      // Execute each tool call
      const toolResults: ToolResult[] = [];
      for (const tc of response.toolCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = { raw: tc.arguments };
        }
        callbacks.onToolCall?.(tc.name, args);

        const result = await dispatchToolCall(tc.name, args, {
          abortSignal,
          origin: 'user',
          sessionId,
        });
        result.callId = tc.id;
        toolResults.push(result);
        callbacks.onToolResult?.(result);
      }

      // Add tool results to messages
      const toolMsg: ChatMessage = {
        id: uuid(),
        role: 'tool',
        content: '',
        toolResults: toolResults.map(r => ({
          callId: r.callId,
          toolId: r.toolId,
          content: r.success ? JSON.stringify(r.data) : `Error: ${r.error}`,
        })),
        timestamp: Date.now(),
      };
      await addMessage(sessionId, toolMsg);

      // Rebuild messages for next iteration
      const updatedSession = await getSession(sessionId);
      if (updatedSession) {
        const updatedHistory = truncateHistory(
          updatedSession.messages.map(m => ({ role: m.role, content: m.content, toolCalls: m.toolCalls, toolResults: m.toolResults })),
          CONTEXT_BUDGET_TOKENS
        );
        currentMessages = buildProviderMessages(systemPrompt, updatedHistory);
      }

      callbacks.onStateChange?.('streaming');
      continue;
    }

    // No tool calls - final response
    if (response.content) {
      const assistantMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        tokenCount: response.usage?.completionTokens,
      };
      await addMessage(sessionId, assistantMsg);
    }

    callbacks.onStateChange?.('done');
    return;
  }

  // Max iterations reached
  callbacks.onStateChange?.('done');
}
