import { db } from './schema';
import type { ScheduledJob, ScheduledRun } from './schema';

/**
 * Berechnet den nächsten Laufzeitpunkt aus einem einfachen 5-Felder-Cron-Ausdruck
 * ("minute hour dayOfMonth month dayOfWeek", Felder: '*' oder numerisch).
 * Unbekannte/komplizierte Syntax (Listen, Bereiche, Schritt-Werte wie "&#42;/5") wird
 * bewusst nicht unterstützt – dann dient `fallbackMs` als Intervall, damit der Job
 * trotzdem planbar bleibt und nextRun nie in der Vergangenheit stehen bleibt.
 */
export function computeNextRun(cronSpec: string, from: number = Date.now(), fallbackMs = 3600000): number {
  const parts = (cronSpec || '').trim().split(/\s+/);
  if (parts.length === 5 && parts.every(p => p === '*' || /^\d+$/.test(p))) {
    const [minS, hourS, domS, monS, dowS] = parts;
    const minute = minS === '*' ? null : parseInt(minS, 10);
    const hour = hourS === '*' ? null : parseInt(hourS, 10);
    const dom = domS === '*' ? null : parseInt(domS, 10);
    const month = monS === '*' ? null : parseInt(monS, 10); // 1-basiert wie im Cron
    const dow = dowS === '*' ? null : parseInt(dowS, 10);   // 0 = Sonntag

    if ((minute === null || minute < 60) && (hour === null || hour < 24) &&
        (dom === null || dom <= 31) && (month === null || (month >= 1 && month <= 12)) &&
        (dow === null || dow <= 6)) {
      const d = new Date(from);
      d.setSeconds(0, 0);
      d.setMinutes(d.getMinutes() + 1); // strikt in die Zukunft starten
      for (let i = 0; i < 60 * 24 * 366; i++) { // Suche max. 1 Jahr voraus
        if (minute !== null && d.getMinutes() !== minute) { d.setMinutes(d.getMinutes() + 1); continue; }
        if (hour !== null && d.getHours() !== hour) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
        if (month !== null && d.getMonth() + 1 !== month) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
        if (dom !== null && d.getDate() !== dom) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
        if (dow !== null && d.getDay() !== dow) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
        return d.getTime();
      }
    }
  }
  return from + fallbackMs;
}

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
  // `enabled` wird als echtes boolean gespeichert (schedule_create nutzt
  // enabled: true, Dexie/IndexedDB kann keine booleschen Werte indizieren –
  // der Index 'enabled' liefert daher nie Treffer für equals(1)). Deshalb
  // bewusst ein full scan mit Filter, damit Jobs nicht stumm entfallen.
  const jobs = await db.scheduledJobs.toArray();
  return jobs.filter(j => j.enabled && j.nextRun <= now);
}

/**
 * Markiert einen Job als ausgeführt und plant den nächsten Lauf.
 * OHNE diese Aktualisierung bliebe `nextRun` in der Vergangenheit und der Job
 * würde bei jedem Tick erneut als "fällig" gemeldet (Endlosschleife /
 * Mehrfachausführung). Der nächste Termin wird aus dem cronSpec berechnet;
 * Basis ist der alte nextRun (bei überlaufenen Jobs ggf. auf "jetzt" gezogen),
 * damit keine Läufe ausgelassen werden, aber nie rückwärts geplant wird.
 */
export async function markJobRun(jobId: number): Promise<void> {
  const job = await db.scheduledJobs.get(jobId);
  if (!job) return;
  const now = Date.now();
  // Basis ist der alte nextRun, damit bei kurz hintereinander fälligen
  // Minuten-Cron-Jobs kein Lauf übersprungen wird – aber nie weiter als
  // eine Minute rückwirkend (sonst plant ein alter Job endlos "nach").
  const base = Math.max(job.nextRun || 0, now - 60000);
  let next = computeNextRun(job.cronSpec, base);
  // Sicherheitsnetz: falls das alte nextRun weit in der Vergangenheit lag,
  // so lange vorwärts planen, bis der Termin in der Zukunft liegt.
  let guard = 0;
  while (next <= now && guard < 10000) {
    next = computeNextRun(job.cronSpec, next);
    guard++;
  }
  if (next <= now) next = computeNextRun(job.cronSpec, now); // Fallback: Intervall ab jetzt
  await db.scheduledJobs.update(jobId, { nextRun: next, lastRun: now });
}
