import { db } from './schema';
import type { ChatSession, ChatMessage } from '../../types/chat';
import { v4 as uuid } from 'uuid';

export async function createSession(title = 'Neue Unterhaltung'): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: uuid(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
    tokenUsage: 0,
  };
  await db.chatSessions.add(session);
  return session;
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  return db.chatSessions.get(id);
}

export async function listSessions(): Promise<ChatSession[]> {
  return db.chatSessions.orderBy('updatedAt').reverse().toArray();
}

export async function updateSession(id: string, changes: Partial<ChatSession>): Promise<void> {
  await db.chatSessions.update(id, { ...changes, updatedAt: Date.now() });
}

export async function deleteSession(id: string): Promise<void> {
  await db.chatSessions.delete(id);
}

export async function addMessage(sessionId: string, message: ChatMessage): Promise<void> {
  const session = await db.chatSessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  session.messages.push(message);
  session.updatedAt = Date.now();
  if (message.tokenCount) {
    session.tokenUsage += message.tokenCount;
  }
  await db.chatSessions.put(session);
}

export async function updateLastMessage(sessionId: string, content: string): Promise<void> {
  const session = await db.chatSessions.get(sessionId);
  if (!session || session.messages.length === 0) return;
  const lastMsg = session.messages[session.messages.length - 1];
  if (lastMsg.role === 'assistant') {
    lastMsg.content = content;
    session.updatedAt = Date.now();
    await db.chatSessions.put(session);
  }
}
