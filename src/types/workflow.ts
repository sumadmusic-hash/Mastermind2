import { z } from 'zod';

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  toolId: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.any()),
  label: z.string(),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowStatus = z.enum(['draft', 'valid', 'running', 'completed', 'error']);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  status: WorkflowStatus,
  createdAt: z.number(),
  updatedAt: z.number(),
  createdBy: z.string(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
