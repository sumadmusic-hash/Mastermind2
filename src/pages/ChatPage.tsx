import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, RotateCcw, Loader2 } from 'lucide-react';
import { useChatStore } from '../store/useChatStore';
import { useAppStore } from '../store/useAppStore';
import { listSessions, createSession, getSession } from '../services/db/chats';
import { sendMessage } from '../services/agent/orchestrator';
import { v4 as uuid } from 'uuid';
import type { ChatMessage } from '../types/chat';

export function ChatPage() {
  const { settings, loaded } = useAppStore();
  const {
    sessions, setSessions, activeSessionId, setActiveSession,
    turnState, setTurnState, streamingText, appendStreamText, clearStreamText,
    toolCalls, addToolCall, setToolResult, clearToolCalls, error, setError
  } = useChatStore();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (loaded) {
      listSessions().then(setSessions);
    }
  }, [loaded, setSessions]);

  useEffect(() => {
    if (activeSessionId) {
      getSession(activeSessionId).then((s) => {
        if (s) setMessages(s.messages);
      });
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const handleNewChat = useCallback(async () => {
    const session = await createSession();
    setSessions([...sessions, session]);
    setActiveSession(session.id);
    clearStreamText();
    clearToolCalls();
    setError(null);
  }, [sessions, setSessions, setActiveSession, clearStreamText, clearToolCalls, setError]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || turnState !== 'idle') return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      const session = await createSession(input.slice(0, 50));
      setSessions([...sessions, session]);
      sessionId = session.id;
      setActiveSession(sessionId);
    }

    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    clearStreamText();
    clearToolCalls();
    setError(null);
    setTurnState('streaming');

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      await sendMessage(sessionId, input.trim(), {
        onStream: (text: string) => appendStreamText(text),
        onToolCall: (toolId: string, args: Record<string, unknown>) => addToolCall(toolId, args),
        onToolResult: (result) => setToolResult(result.toolId, result),
        onStateChange: (state) => setTurnState(state),
        onError: (err: Error) => setError(err.message),
      }, abortController.signal);

      const updated = await getSession(sessionId);
      if (updated) setMessages(updated.messages);
    } catch (err) {
      setError((err as Error).message);
      setTurnState('error');
    }

    const allSessions = await listSessions();
    setSessions(allSessions);
  }, [input, turnState, activeSessionId, sessions, setSessions, setActiveSession,
      clearStreamText, clearToolCalls, setError, setTurnState, appendStreamText, addToolCall, setToolResult]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setTurnState('interrupted');
  }, [setTurnState]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasApiKey = Object.values(settings.providers).some((p) => p.apiKey && p.enabled);

  return (
    <div className="flex h-full">
      {/* Session list */}
      <div className="w-56 border-r border-gray-700 bg-gray-800/30 overflow-y-auto hidden md:block">
        <div className="p-2">
          <button
            onClick={handleNewChat}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
          >
            + Neue Unterhaltung
          </button>
        </div>
        <div className="space-y-0.5 px-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className={`w-full text-left px-3 py-2 rounded text-xs truncate transition-colors ${
                s.id === activeSessionId ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700/50'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {!hasApiKey && (
          <div className="mx-4 mt-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-sm text-yellow-300">
            ⚠️ Kein API-Key konfiguriert. Gehe zu <strong>Einstellungen</strong> um einen Provider-Key einzutragen.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !streamingText && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="text-4xl mb-4">🤖</div>
              <p className="text-lg font-medium">AI Research Assistant</p>
              <p className="text-sm mt-1">Stelle eine Frage oder starte eine Recherche</p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {streamingText && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0">AI</div>
              <div className="bg-gray-800 rounded-xl px-4 py-3 max-w-2xl">
                <p className="text-sm whitespace-pre-wrap">{streamingText}</p>
                {turnState === 'streaming' && <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />}
              </div>
            </div>
          )}

          {toolCalls.length > 0 && (
            <div className="ml-11 space-y-2">
              {toolCalls.map((tc, i) => (
                <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 text-blue-400">
                    <Loader2 size={12} className={tc.result ? '' : 'animate-spin'} />
                    <span className="font-mono">{tc.toolId}</span>
                    {tc.result?.cached && <span className="text-yellow-400">(cached)</span>}
                  </div>
                  {tc.result && (
                    <div className={`mt-1 ${tc.result.success ? 'text-green-400' : 'text-red-400'}`}>
                      {tc.result.success ? '✓ Erfolgreich' : `✗ ${tc.result.error}`}
                      {tc.result.duration > 0 && <span className="text-gray-500 ml-2">{tc.result.duration}ms</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mx-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-300">
              ❌ {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-700 p-4">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nachricht eingeben... (Enter zum Senden)"
              className="flex-1 bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-blue-500 placeholder-gray-500"
              rows={2}
              disabled={turnState === 'streaming' || turnState === 'tool_executing'}
            />
            {turnState === 'streaming' || turnState === 'tool_executing' ? (
              <button onClick={handleAbort} className="px-4 bg-red-600 hover:bg-red-700 rounded-xl transition-colors">
                <Square size={18} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
              >
                <Send size={18} />
              </button>
            )}
          </div>
          {turnState === 'interrupted' && (
            <div className="text-center mt-2">
              <button onClick={handleSend} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto">
                <RotateCcw size={12} /> Fortsetzen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        isUser ? 'bg-gray-600' : 'bg-blue-600'
      }`}>
        {isUser ? '👤' : 'AI'}
      </div>
      <div className={`rounded-xl px-4 py-3 max-w-2xl ${
        isUser ? 'bg-blue-600/20 border border-blue-600/30' : 'bg-gray-800'
      }`}>
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        {message.toolCalls && (
          <div className="mt-2 space-y-1">
            {(message.toolCalls as Array<{ name: string }>).map((tc, i) => (
              <span key={i} className="inline-block bg-gray-700 rounded px-2 py-0.5 text-xs text-gray-300 mr-1">
                🔧 {tc.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
