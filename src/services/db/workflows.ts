import { db } from './schema';
import type { WorkflowDefinition } from '../../types/workflow';
import { v4 as uuid } from 'uuid';

export async function createWorkflow(name: string): Promise<WorkflowDefinition> {
  const now = Date.now();
  const wf: WorkflowDefinition = {
    id: uuid(),
    name,
    description: '',
    nodes: [],
    edges: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    createdBy: 'user',
  };
  await db.workflows.add(wf);
  return wf;
}

export async function getWorkflow(id: string): Promise<WorkflowDefinition | undefined> {
  return db.workflows.get(id);
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  return db.workflows.orderBy('updatedAt').reverse().toArray();
}

export async function saveWorkflow(wf: WorkflowDefinition): Promise<void> {
  await db.workflows.put({ ...wf, updatedAt: Date.now() });
}

export async function deleteWorkflow(id: string): Promise<void> {
  await db.workflows.delete(id);
}
