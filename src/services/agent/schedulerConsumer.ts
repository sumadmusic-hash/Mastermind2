/**
 * Scheduler-Consumer: führt geplante Jobs aus, sobald ihr nextRun fällig ist.
 *
 * Bisher fehlte der Abnehmer komplett – getDueJobs() und markJobRun() waren
 * vorhanden, aber nichts hat sie aufgerufen, d.h. Jobs wurden nie ausgeführt.
 *
 * Verhalten:
 * - periodischer Tick (Default 30s) plus sofortiger Tick beim Start
 * - pro Tick alle fälligen Jobs (enabled && nextRun <= now)
 * - Ausführung mit origin 'scheduled' => Write-Guard greift (guard.ts):
 *   Schreib-Tools (memory_save, schedule_create, ...) werden verweigert
 * - erst NACH Abschluss des Laufs wird via markJobRun() neu geplant – das
 *   verhindert Endlosschleifen bei langsamen Tools (der Bug war bereits in
 *   scheduler.ts behoben; dieser Consumer setzt die Konvention um)
 * - jeder Lauf wird als ScheduledRun protokolliert, Fehler zusätzlich als Log
 */
import { getDueJobs, markJobRun, addRun, updateRun } from '../db/scheduler';
import { dispatchToolCall } from './toolDispatcher';
import { addLog } from '../db/logs';
import type { ToolExecutionContext } from '../../types/tool';

const DEFAULT_TICK_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false; // Überlappungsschutz: ein Tick darf den nächsten nicht stören

async function runTick(): Promise<void> {
  if (running) return; // vorheriger Tick noch aktiv
  running = true;
  try {
    const dueJobs = await getDueJobs();
    for (const job of dueJobs) {
      // nextRun VOR der Ausführung planen, damit ein fehlerhafter/langer Lauf
      // den Job nicht dauerhaft "fällig" hält. markJobRun() ist idempotent
      // bezüglich alter nextRun-Werte (Basis = max(alter nextRun, now-60s)).
      const startedAt = Date.now();
      const runId = await addRun({ jobId: job.id!, startedAt, status: 'running' });
      let status: 'success' | 'error' = 'success';
      let resultSummary: string | undefined;
      try {
        let args: unknown = {};
        try {
          args = job.args ? JSON.parse(job.args) : {};
        } catch {
          throw new Error(`Ungültiges JSON in Job-Argumenten: ${job.args}`);
        }
        const ctx: ToolExecutionContext = {
          origin: 'scheduled',
          sessionId: `scheduled-${job.id}`,
        };
        const result = await dispatchToolCall(job.toolId, args, ctx);
        if (!result.success) throw new Error(result.error || 'Tool-Fehler');
        resultSummary = JSON.stringify(result.data).slice(0, 2000);
      } catch (err) {
        status = 'error';
        resultSummary = (err as Error).message;
        await addLog('error', `Scheduler-Job "${job.name}" (#${job.id}) fehlgeschlagen: ${resultSummary}`, 'scheduler');
      }
      await updateRun(runId, { completedAt: Date.now(), status, result: resultSummary });
      await markJobRun(job.id!);
    }
  } finally {
    running = false;
  }
}

/**
 * Startet den Scheduler-Consumer (idempotent). Wird von main.tsx aufgerufen.
 * Gibt eine Stop-Funktion zurück (praktisch für Tests / HMR).
 */
export function startSchedulerConsumer(tickMs: number = DEFAULT_TICK_MS): () => void {
  if (timer) return stopSchedulerConsumer;
  timer = setInterval(() => { void runTick(); }, tickMs);
  void runTick(); // direkt beim Start fällige Jobs abarbeiten
  return stopSchedulerConsumer;
}

export function stopSchedulerConsumer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Für Tests: einzelner manueller Tick
export const __runTickForTests = runTick;
