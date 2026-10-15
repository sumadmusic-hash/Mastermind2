import { toolRegistry } from '../registry';
import { def, ok, err } from '../toolHelpers';

toolRegistry.register(
  def('schedule_create', 'Aufgabe planen', 'Geplante Aufgabe erstellen', 'automation',
    { name: { type: 'string', description: 'Name' }, cron_spec: { type: 'string', description: 'Cron-Ausdruck' }, tool_id: { type: 'string', description: 'Tool-ID' }, args: { type: 'string', description: 'Tool-Argumente (JSON)' } },
    ['write']),
  async (args) => {
    const { name, cron_spec, tool_id, args: toolArgs } = args as { name: string; cron_spec: string; tool_id: string; args: string };
    // Validierung: nur einfacher 5-Felder-Cron mit '*' oder Zahlen wird unterstützt
    const parts = (cron_spec || '').trim().split(/\s+/);
    if (parts.length !== 5 || !parts.every(p => p === '*' || /^\d+$/.test(p))) {
      return err(`Ungültiger Cron-Ausdruck: "${cron_spec}". Unterstützt: 5 Felder (Minute Stunde Tag Monat Wochentag), je '*' oder Zahl.`);
    }
    const { createJob, computeNextRun } = await import('../../db/scheduler');
    // nextRun aus dem cronSpec berechnen statt hartkodiert +1h – sonst läuft
    // der Job unabhängig vom Plan immer stündlich bzw. (bei getDueJobs ohne
    // Update) potenziell in einer Endlosschleife.
    const id = await createJob({ name, cronSpec: cron_spec, toolId: tool_id, args: toolArgs, enabled: true, nextRun: computeNextRun(cron_spec), createdAt: Date.now() });
    return ok({ created: true, id, name, nextRun: computeNextRun(cron_spec) });
  }
);

toolRegistry.register(
  def('schedule_list', 'Aufgaben auflisten', 'Geplante Aufgaben anzeigen', 'automation', {}, ['storage']),
  async () => {
    const { listJobs } = await import('../../db/scheduler');
    const jobs = await listJobs();
    return ok({ jobs, count: jobs.length });
  }
);

toolRegistry.register(
  def('schedule_remove', 'Aufgabe entfernen', 'Geplante Aufgabe löschen', 'automation',
    { job_id: { type: 'number', description: 'Job-ID' } },
    ['write']),
  async (args) => {
    const jobId = args.job_id as number;
    const { deleteJob } = await import('../../db/scheduler');
    await deleteJob(jobId);
    return ok({ removed: true, jobId });
  }
);
