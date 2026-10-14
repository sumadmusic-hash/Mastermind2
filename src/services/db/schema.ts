import Dexie, { type Table } from 'dexie';
import type { ChatSession, ChatMessage } from '../../types/chat';
import type { AppSettings } from '../../types/provider';
import type { WorkflowDefinition } from '../../types/workflow';

export interface LogEntry {
  id?: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  context?: string;
}

export interface TokenUsageEntry {
  id?: number;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface MemoryEntry {
  id?: number;
  category: string;
  key: string;
  value: string;
  updatedAt: number;
}

export interface Position {
  id?: number;
  ticker: string;
  quantity: number;
  avgPrice: number;
  updatedAt: number;
}

export interface TimeseriesCache {
  id?: number;
  source: string;
  seriesId: string;
  data: string;
  expiresAt: number;
}

export interface ScheduledJob {
  id?: number;
  name: string;
  cronSpec: string;
  toolId: string;
  args: string;
  enabled: boolean;
  nextRun: number;
  lastRun?: number;
  createdAt: number;
}

export interface ScheduledRun {
  id?: number;
  jobId: number;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'success' | 'error';
  result?: string;
}

export interface InterruptedTurnEntry {
  id?: number;
  sessionId: string;
  data: string;
  timestamp: number;
}

export interface CalendarEvent {
  id?: number;
  title: string;
  /** ISO-Datum (YYYY-MM-DD) des Termins */
  date: string;
  /** Startzeit als HH:MM (24h, lokale Zeit des Nutzers) */
  time: string;
  /** Dauer in Minuten */
  durationMin: number;
  description?: string;
  location?: string;
  participants?: string;
  createdAt: number;
}

export class AppDatabase extends Dexie {
  chatSessions!: Table<ChatSession, string>;
  settings!: Table<AppSettings, string>;
  workflows!: Table<WorkflowDefinition, string>;
  logs!: Table<LogEntry, number>;
  tokenUsage!: Table<TokenUsageEntry, number>;
  memories!: Table<MemoryEntry, number>;
  positions!: Table<Position, number>;
  timeseriesCache!: Table<TimeseriesCache, number>;
  scheduledJobs!: Table<ScheduledJob, number>;
  scheduledRuns!: Table<ScheduledRun, number>;
  interruptedTurns!: Table<InterruptedTurnEntry, number>;
  calendarEvents!: Table<CalendarEvent, number>;

  constructor() {
    super('AIResearchAssistant');
    this.version(1).stores({
      chatSessions: 'id, updatedAt',
      settings: 'id',
      workflows: 'id, status, updatedAt',
      logs: '++id, level, timestamp',
      tokenUsage: '++id, provider, timestamp',
      memories: '++id, [category+key], category, updatedAt',
      positions: '++id, ticker, updatedAt',
      timeseriesCache: '++id, [source+seriesId], expiresAt',
      scheduledJobs: '++id, enabled, nextRun',
      scheduledRuns: '++id, jobId, startedAt',
      interruptedTurns: '++id, sessionId, timestamp',
    });
    // Version 2: lokaler Kalender (Termine) für calendar_*-Tools
    this.version(2).stores({
      calendarEvents: '++id, date, title, createdAt',
    });
  }
}

export const db = new AppDatabase();
