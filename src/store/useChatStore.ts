import { create } from 'zustand';
import type { ChatSession, TurnState } from '../types/chat';
import type { ToolResult } from '../types/tool';
import { v4 as uuid } from 'uuid';

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  turnState: TurnState;
  streamingText: string;
  toolCalls: Array<{ toolId: string; args: Record<string, unknown>; result?: ToolResult }>;
  error: string | null;

  setSessions: (sessions: ChatSession[]) => void;
  setActiveSession: (id: string | null) => void;
  setTurnState: (state: TurnState) => void;
  appendStreamText: (text: string) => void;
  setStreamText: (text: string) => void;
  clearStreamText: () => void;
  addToolCall: (toolId: string, args: Record<string, unknown>) => void;
  setToolResult: (toolId: string, result: ToolResult) => void;
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
  clearStreamText: () => set({ streamingText: '' }),
  addToolCall: (toolId, args) => set({ toolCalls: [...get().toolCalls, { toolId, args }] }),
  setToolResult: (toolId, result) => set({
    toolCalls: get().toolCalls.map(tc => tc.toolId === toolId ? { ...tc, result } : tc),
  }),
  clearToolCalls: () => set({ toolCalls: [] }),
  setError: (error) => set({ error }),
}));
