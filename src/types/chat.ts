import { z } from 'zod';

export const MessageRole = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRole>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: MessageRole,
  content: z.string(),
  toolCalls: z.array(z.any()).optional(),
  toolResults: z.array(z.any()).optional(),
  timestamp: z.number(),
  tokenCount: z.number().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TurnState = z.enum(['idle', 'streaming', 'tool_executing', 'done', 'error', 'interrupted']);
export type TurnState = z.infer<typeof TurnState>;

export const ChatSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(ChatMessageSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
  tokenUsage: z.number(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const InterruptedTurnSchema = z.object({
  sessionId: z.string(),
  completedSteps: z.array(z.any()),
  pendingToolCalls: z.array(z.any()),
  toolResults: z.array(z.any()),
  lastAssistantContent: z.string(),
  timestamp: z.number(),
});
export type InterruptedTurn = z.infer<typeof InterruptedTurnSchema>;
