import { toolRegistry } from '../registry';
import { def, ok, err } from '../toolHelpers';

// --- CALENDAR TOOLS (Termine) ---
// Datumsformat: YYYY-MM-DD; relative Angaben ("morgen", "nächste Woche")
// muss die KI anhand des heutigen Datums aus dem System-Prompt auflösen.

type CalendarConflict = { time: string; title: string };

/** Einheitliches Format der Konflikt-Warnung (create/update nutzen dasselbe Layout) */
function conflictWarning(conflicts: CalendarConflict[]): string | undefined {
  if (conflicts.length === 0) return undefined;
  return `Konflikt: ${conflicts.map((c) => `${c.time} "${c.title}"`).join(', ')} überschneiden sich mit diesem Termin.`;
}

toolRegistry.register(
  def('calendar_create', 'Termin erstellen', 'Kalendereintrag/Termin anlegen mit Titel, Datum (YYYY-MM-DD), Uhrzeit (HH:MM), Dauer und optional Teilnehmern/Ort. Relative Datumsangaben vorher in ein konkretes Datum umrechnen. Wiederkehrende Serien via recurrence (RRULE-Subset, z.B. "FREQ=WEEKLY;BYDAY=MO" für jeden Montag).', 'calendar',
    {
      title: { type: 'string', description: 'Titel des Termins' },
      date: { type: 'string', description: 'Datum im Format YYYY-MM-DD (Serienstart bei recurrence)' },
      time: { type: 'string', description: 'Startzeit im Format HH:MM (24h)' },
      duration_min: { type: 'number', description: 'Dauer in Minuten (Standard 60)' },
      description: { type: 'string', description: 'Notiz/Hinweis (optional)' },
      location: { type: 'string', description: 'Ort (optional)' },
      participants: { type: 'string', description: 'Teilnehmer, kommagetrennt (optional)' },
      recurrence: { type: 'string', description: 'Wiederholung (optional), RRULE-Subset: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY; INTERVAL=n; BYDAY=MO,TU,...; BYMONTHDAY=1..31; COUNT=n; UNTIL=YYYY-MM-DD. Beispiel "jeden Montag": FREQ=WEEKLY;BYDAY=MO' },
    },
    ['write', 'storage']),
  async (args) => {
    const a = args as Record<string, unknown>;
    const title = String(a.title ?? '').trim();
    if (!title) return err('Kein Titel angegeben');
    try {
      const { addEvent, findConflicts } = await import('../../db/calendar');
      const date = String(a.date ?? '');
      const time = String(a.time ?? '');
      const durationMin = Number(a.duration_min) || 60;
      const recurrence = a.recurrence ? String(a.recurrence) : undefined;
      const conflicts = await findConflicts(date, time, durationMin);
      const id = await addEvent({
        title, date, time, durationMin,
        description: a.description ? String(a.description) : undefined,
        location: a.location ? String(a.location) : undefined,
        participants: a.participants ? String(a.participants) : undefined,
        recurrence,
      });
      return ok({
        created: true, id, title, date, time, durationMin,
        recurrence: recurrence || undefined,
        warning: conflictWarning(conflicts),
      });
    } catch (e) { return err(`Termin konnte nicht erstellt werden: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('calendar_list', 'Termine anzeigen', 'Termine aus dem lokalen Kalender auflisten, optional gefiltert nach Datumsbereich (from/to als YYYY-MM-DD).', 'calendar',
    { from: { type: 'string', description: 'Ab-Datum YYYY-MM-DD (optional)' }, to: { type: 'string', description: 'Bis-Datum YYYY-MM-DD (optional)' } },
    ['storage']),
  async (args) => {
    try {
      const { listEvents } = await import('../../db/calendar');
      const from = args.from ? String(args.from) : undefined;
      const to = args.to ? String(args.to) : undefined;
      const events = await listEvents(from, to);
      return ok({ events, count: events.length });
    } catch (e) { return err(`Termine konnten nicht geladen werden: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('calendar_remove', 'Termin löschen', 'Einen Termin per ID aus dem lokalen Kalender entfernen. Bei wiederkehrenden Serien: scope="single" (Standard) löscht nur diesen Termin als dauerhafte Ausnahme der Serie, scope="series" löscht die komplette Serie inkl. aller Zukunftstermine.', 'calendar',
    {
      event_id: { type: 'number', description: 'ID des Termins (aus calendar_list)' },
      scope: { type: 'string', description: '"single" (nur diesen Termin, Standard) oder "series" (ganze Wiederkehr-Serie löschen)' },
    },
    ['write', 'storage']),
  async (args) => {
    const id = Number(args.event_id);
    if (!Number.isFinite(id)) return err('Keine gültige Termin-ID angegeben');
    try {
      const { removeEvent, deleteSeries, getEvent } = await import('../../db/calendar');
      const scope = String(args.scope ?? 'single');
      if (scope === 'series') {
        const ev = await getEvent(id);
        if (!ev) return err(`Kein Termin mit ID ${id} gefunden`);
        if (!ev.seriesId) return err(`Termin #${id} ist keine wiederkehrende Serie – zum Löschen scope weglassen`);
        const count = await deleteSeries(id);
        return ok({ removed: true, id, scope: 'series', removedCount: count });
      }
      const removed = await removeEvent(id);
      if (!removed) return err(`Kein Termin mit ID ${id} gefunden`);
      return ok({ removed: true, id, scope: 'single' });
    } catch (e) { return err(`Termin konnte nicht gelöscht werden: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('calendar_update', 'Termin bearbeiten', 'Bestehenden Termin per ID bearbeiten (Titel, Datum, Uhrzeit, Dauer, Ort, Teilnehmer, Notiz) – ohne ihn löschen und neu anlegen zu müssen. Nur angegebene Felder werden geändert. Bei wiederkehrenden Serien steuert scope, ob nur dieser Termin ("single", Standard), dieser + alle späteren ("future") oder die ganze Serie ("series") geändert werden.', 'calendar',
    {
      event_id: { type: 'number', description: 'ID des Termins (aus calendar_list)' },
      title: { type: 'string', description: 'Neuer Titel (optional)' },
      date: { type: 'string', description: 'Neues Datum YYYY-MM-DD (optional)' },
      time: { type: 'string', description: 'Neue Startzeit HH:MM, 24h (optional)' },
      duration_min: { type: 'number', description: 'Neue Dauer in Minuten (optional)' },
      description: { type: 'string', description: 'Neue Notiz (optional)' },
      location: { type: 'string', description: 'Neuer Ort (optional)' },
      participants: { type: 'string', description: 'Neue Teilnehmer, kommagetrennt (optional)' },
      scope: { type: 'string', description: '"single" (Standard), "future" (dieser + spätere Serientermine) oder "series" (ganze Serie)' },
    },
    ['write', 'storage']),
  async (args) => {
    const a = args as Record<string, unknown>;
    const id = Number(a.event_id);
    if (!Number.isFinite(id)) return err('Keine gültige Termin-ID angegeben');
    const scopeRaw = String(a.scope ?? 'single');
    if (!['single', 'future', 'series'].includes(scopeRaw)) {
      return err(`Ungültiger scope "${scopeRaw}" (erwartet single, future oder series)`);
    }
    const changes: Record<string, unknown> = {};
    for (const key of ['title', 'date', 'time', 'description', 'location', 'participants'] as const) {
      if (a[key] !== undefined && a[key] !== null) changes[key] = String(a[key]);
    }
    if (a.duration_min !== undefined && a.duration_min !== null) changes.durationMin = Number(a.duration_min);
    if (Object.keys(changes).length === 0) return err('Kein Feld zum Ändern angegeben (z. B. time, date, title, location)');
    try {
      const { updateEvent, findConflicts, getEvent } = await import('../../db/calendar');
      const existing = await getEvent(id);
      if (!existing) return err(`Kein Termin mit ID ${id} gefunden`);
      const updatedCount = await updateEvent(id, changes, scopeRaw as 'single' | 'future' | 'series');
      // Konfliktprüfung am (ggf. neuen) Zieltermin, aktueller Termin ausgeschlossen
      const target = await getEvent(id);
      let warning: string | undefined;
      if (target) {
        const conflicts = await findConflicts(target.date, target.time, target.durationMin, id);
        warning = conflictWarning(conflicts);
      }
      return ok({ updated: true, id, updatedCount, scope: scopeRaw, changes, warning });
    } catch (e) { return err(`Termin konnte nicht bearbeitet werden: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('calendar_next_free', 'Freien Terminslot finden', 'Findet den nächsten freien Terminslot ab einem Startdatum: prüft bestehende Termine (inkl. wiederkehrender Serien) und schlägt die erste lückenfreie Zeit vor, die innerhalb der Arbeitszeiten (Standard 09:00-17:00, Mo-Fr) liegt.', 'calendar',
    {
      date: { type: 'string', description: 'Zu prüfendes Datum YYYY-MM-DD (Standard: heute)' },
      duration_min: { type: 'number', description: 'Gewünschte Dauer in Minuten (Standard 60)' },
      work_start: { type: 'string', description: 'Arbeitsbeginn HH:MM (Standard 09:00)' },
      work_end: { type: 'string', description: 'Arbeitssende HH:MM (Standard 17:00)' },
    },
    ['storage']),
  async (args) => {
    const a = args as Record<string, unknown>;
    try {
      const { listEvents } = await import('../../db/calendar');
      const date = a.date ? String(a.date) : new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(`Ungültiges Datum: "${date}" (erwartet YYYY-MM-DD)`);
      const durationMin = Math.max(5, Math.min(Number(a.duration_min) || 60, 24 * 60));
      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
      const ws = /^\d{2}:\d{2}$/.test(String(a.work_start ?? '')) ? toMin(String(a.work_start)) : 9 * 60;
      const we = /^\d{2}:\d{2}$/.test(String(a.work_end ?? '')) ? toMin(String(a.work_end)) : 17 * 60;
      if (we - ws < durationMin) return err(`Dauer ${durationMin} min passt nicht ins Zeitfenster ${ws}–${we} Minuten`);
      const dayEvents = (await listEvents(date, date)).sort((x, y) => x.time.localeCompare(y.time));
      const busy = dayEvents.map((e) => ({ start: toMin(e.time), end: toMin(e.time) + Math.max(1, e.durationMin) }));
      let cursor = ws;
      for (const b of busy) {
        if (b.end <= cursor) continue;
        if (b.start >= cursor + durationMin) break; // Lücke vor diesem Termin genug
        cursor = Math.max(cursor, b.end);
      }
      if (cursor + durationMin > we) {
        return ok({ date, free: false, reason: 'Kein zusammenhängendes Fenster im angegebenen Zeitrahmen', busySlots: dayEvents.map((e) => `${e.time}-${e.durationMin}min ${e.title}`) });
      }
      const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      return ok({ date, free: true, suggested_time: fmt(cursor), duration_min: durationMin, conflicting_events: dayEvents.map((e) => `${e.time} ${e.title}`) });
    } catch (e) { return err(`Freie Slots konnten nicht ermittelt werden: ${(e as Error).message}`); }
  }
);
