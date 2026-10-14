import { create } from 'zustand';
import type { ChatSession, TurnState } from '../types/chat';
import type { ToolResult } from '../types/tool';

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  turnState: TurnState;
  streamingText: string;
  toolCalls: Array<{ toolId: string; callId: string; args: Record<string, unknown>; result?: ToolResult }>;
  error: string | null;

  setSessions: (sessions: ChatSession[]) => void;
  setActiveSession: (id: string | null) => void;
  setTurnState: (state: TurnState) => void;
  appendStreamText: (text: string) => void;
  setStreamText: (text: string) => void;
  clearStreamText: () => void;
  addToolCall: (toolId: string, args: Record<string, unknown>, callId?: string) => void;
  setToolResult: (result: ToolResult) => void;
  clearToolCalls: () => void;
  setError: (error: string | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  turnState: 'idle',
  streamingText: '',
  toolCalls: [],
  error: null,

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id, streamingText: '', toolCalls: [], error: null, turnState: 'idle' }),
  setTurnState: (state) => set({ turnState: state }),
  appendStreamText: (text) => set({ streamingText: get().streamingText + text }),
  // Ersetzt den Streaming-Text komplett. Wird vom Orchestrator bei Provider-
  // Failovers genutzt, damit nie Text mehrerer Versuche sichtbar wird.
  setStreamText: (text) => set({ streamingText: text }),
  clearStreamText: () => set({ streamingText: '' }),
  // callId wird mitgeführt, damit Ergebnisse auch bei mehrfach verwendeten
  // Tool-IDs (z.B. zwei Aufruf desselben Tools in einem Turn) eindeutig dem
  // richtigen Call zugeordnet werden können.
  addToolCall: (toolId, args, callId) => set({
    toolCalls: [...get().toolCalls, { toolId, args, callId: callId ?? `${toolId}_${Date.now()}_${get().toolCalls.length}` }],
  }),
  setToolResult: (result) => set({
    toolCalls: get().toolCalls.map(tc =>
      (result.callId && tc.callId === result.callId) || (!result.callId && tc.toolId === result.toolId)
        ? { ...tc, result }
        : tc
    ),
  }),
  clearToolCalls: () => set({ toolCalls: [] }),
  setError: (error) => set({ error }),
}));
