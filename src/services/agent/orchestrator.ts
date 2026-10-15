import type { ChatMessage, TurnState } from '../../types/chat';
import type { ProviderMessage, ModelSlot, StreamChunk } from '../../types/provider';
import type { ToolDefinition, ToolResult } from '../../types/tool';
import { buildSystemPrompt, buildProviderMessages } from './promptBuilder';
import { truncateHistory } from './contextManager';
import { dispatchToolCall, clearDedupCache } from './toolDispatcher';
import { callWithFailover } from './fallback';
import { isLocalProvider } from '../providers/registry';
import { selectRelevantTools } from '../tools/relevance';
import { toolRegistry } from '../tools/registry';
import { addMessage, getSession } from '../db/chats';
import { getSettings, applyEnabledTools } from '../db/settings';
import { v4 as uuid } from 'uuid';

const MAX_AGENT_ITERATIONS = 5;
const CONTEXT_BUDGET_TOKENS = 24000;

export interface AgentCallbacks {
  onStream?: (text: string) => void;
  // Setzt die Streaming-Anzeige zurück. Wird vor dem ersten Text-Delta eines
  // jeden Provider-Versuchs ausgelöst, damit bei einem Failover nie Text
  // mehrerer Versuche (bzw. doppelt) sichtbar wird.
  onStreamReset?: () => void;
  // Wird einmalig mit dem finalen Antworttext aufgerufen, BEVOR dieser
  // persistiert und `onStateChange('done')` ausgelöst wird. So kann der UI-
  // Layer die fertige Antwort übernehmen, ohne dass Stream-Platzhalter und
  // persistierte Nachricht gleichzeitig sichtbar sind ("Antwort doppelt").
  onFinish?: (finalText: string) => void;
  // callId gehört zum zugehörigen Tool-Call und erlaubt eine eindeutige
  // Zuordnung des Ergebnisses, auch wenn dasselbe Tool mehrfach pro Turn
  // aufgerufen wird.
  onToolCall?: (toolId: string, args: Record<string, unknown>, callId: string) => void;
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

  // Add user message (avoid duplicates if the caller already persisted it)
  const existingSession = await getSession(sessionId);
  const lastMsg = existingSession?.messages[existingSession.messages.length - 1];
  const alreadyAdded = !!lastMsg && lastMsg.role === 'user' && lastMsg.content === userContent;
  if (!alreadyAdded) {
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };
    await addMessage(sessionId, userMsg);
  }

  // Get settings
  const settings = await getSettings();
  const slots = settings.modelSlots.filter(
    s => settings.providers[s.providerId]?.enabled || isLocalProvider(s.providerId)
  );
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
  // enabledTools auswerten: Registry-seitig aktive Tools UND per Settings
  // nicht deaktiverte Tools. Fehlt ein Eintrag in settings.enabledTools,
  // gilt das Tool als aktiv (Default true).
  const allTools = applyEnabledTools(toolRegistry.getEnabled(), settings.enabledTools);
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
    // Streaming-Modus wird erst gesetzt, wenn `callWithFailover` erfolgreich
    // abgeschlossen wurde. Vorher sendet onChunk den kumulierten Text per
    // "Reset" – so bleibt bei einem Failover (Timeout/Abbruch mitten im
    // Stream) nie Text eines fehlgeschlagenen Versuchs stehen, der sonst
    // vor der Antwort des Fallback-Modells doppelt sichtbar wäre.
    let attemptSucceeded = false;
    const onChunk = (chunk: StreamChunk) => {
      if (chunk.type === 'reset') {
        // Neuer Provider-Versuch liefert Text: Anzeige auf leeren Stand setzen.
        streamedText = '';
        callbacks.onStreamReset?.();
        return;
      }
      if (chunk.type === 'text' && chunk.content) {
        streamedText += chunk.content;
        if (attemptSucceeded) {
          callbacks.onStream?.(chunk.content);
        } else {
          callbacks.onStreamReset?.();
          callbacks.onStream?.(streamedText);
        }
      }
    };

    let response;
    try {
      const result = await callWithFailover(
        slots, currentMessages, relevantTools, apiKeys, settings.proxyBaseUrl, onChunk, abortSignal, providerBaseUrls, settings.tpmLimit
      );
      attemptSucceeded = true;
      response = result.response;
    } catch (err) {
      callbacks.onError?.(err as Error);
      callbacks.onStateChange?.('error');
      return;
    }

    // If there are tool calls, execute them
    if (response.toolCalls && response.toolCalls.length > 0) {
      callbacks.onStateChange?.('tool_executing');

      // Execute each tool call FIRST, so assistant message + tool results can be
      // persisted atomically in the correct order. If this turn is interrupted
      // afterwards, the history never contains an assistant message with
      // tool_calls whose tool responses are missing (which causes HTTP 400 on
      // the next request: "for 'role:assistant' ... 'tool_calls.0.type' is missing" /
      // dangling tool_call_id references).
      const normalizedToolCalls = response.toolCalls.map((tc, i) => ({
        id: tc.id || `call_${uuid()}`,
        name: tc.name,
        arguments: tc.arguments,
      }));

      const toolResults: ToolResult[] = [];
      for (const tc of normalizedToolCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = { raw: tc.arguments };
        }
        callbacks.onToolCall?.(tc.name, args, tc.id);

        const result = await dispatchToolCall(tc.name, args, {
          abortSignal,
          origin: 'user',
          sessionId,
        });
        result.callId = tc.id;
        toolResults.push(result);
        callbacks.onToolResult?.(result);
      }

      // Add assistant message with tool calls (OpenAI-kompatibel mit type: 'function')
      const assistantMsg: ChatMessage = {
        id: uuid(),
        role: 'assistant',
        content: response.content || '',
        toolCalls: normalizedToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          name: tc.name,
          arguments: tc.arguments,
        })),
        timestamp: Date.now(),
      };
      await addMessage(sessionId, assistantMsg);

      // Add tool results to messages (callId from the request, not the result –
      // dedup-cached results may carry an empty callId and would break tool_call_id refs)
      const toolMsg: ChatMessage = {
        id: uuid(),
        role: 'tool',
        content: '',
        toolResults: normalizedToolCalls.map((tc, i) => ({
          callId: tc.id,
          toolId: tc.name,
          content: (() => {
            const r = toolResults[i];
            return r && r.success ? JSON.stringify(r.data) : `Error: ${r?.error ?? 'Tool-Ergebnis fehlt'}`;
          })(),
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
      callbacks.onFinish?.(response.content);

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
