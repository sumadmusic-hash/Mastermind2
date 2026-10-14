import { db } from './schema';
import type { ScheduledJob, ScheduledRun } from './schema';

export async function createJob(job: Omit<ScheduledJob, 'id'>): Promise<number> {
  return db.scheduledJobs.add(job as ScheduledJob);
}

export async function listJobs(): Promise<ScheduledJob[]> {
  return db.scheduledJobs.toArray();
}

export async function getJob(id: number): Promise<ScheduledJob | undefined> {
  return db.scheduledJobs.get(id);
}

export async function updateJob(id: number, changes: Partial<ScheduledJob>): Promise<void> {
  await db.scheduledJobs.update(id, changes);
}

export async function deleteJob(id: number): Promise<void> {
  await db.scheduledJobs.delete(id);
  await db.scheduledRuns.where('jobId').equals(id).delete();
}

export async function addRun(run: Omit<ScheduledRun, 'id'>): Promise<number> {
  return db.scheduledRuns.add(run as ScheduledRun);
}

export async function updateRun(id: number, changes: Partial<ScheduledRun>): Promise<void> {
  await db.scheduledRuns.update(id, changes);
}

export async function getDueJobs(): Promise<ScheduledJob[]> {
  const now = Date.now();
  return db.scheduledJobs.where('enabled').equals(1).filter(j => j.nextRun <= now).toArray();
}
