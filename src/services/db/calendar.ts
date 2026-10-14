import { db } from './schema';
import type { CalendarEvent } from './schema';

/** Termin anlegen. Validiert Datum (YYYY-MM-DD) und Zeit (HH:MM). */
export async function addEvent(event: Omit<CalendarEvent, 'id' | 'createdAt'>): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) throw new Error(`Ungültiges Datum: "${event.date}" (erwartet YYYY-MM-DD)`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) throw new Error(`Ungültige Zeit: "${event.time}" (erwartet HH:MM, 24h)`);
  const durationMin = Math.max(1, Math.min(Number(event.durationMin) || 60, 24 * 60));
  const id = await db.calendarEvents.add({ ...event, durationMin, createdAt: Date.now() });
  return id as number;
}

/** Alle Termine, optional in einem Datumsfenster [from..to] (inklusive), aufsteigend sortiert. */
export async function listEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
  let coll = db.calendarEvents.orderBy('date');
  const all = await coll.toArray();
  return all
    .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** Einzelnen Termin nach ID holen. */
export async function getEvent(id: number): Promise<CalendarEvent | undefined> {
  return db.calendarEvents.get(id);
}

/** Termin löschen; gibt zurück, ob er existierte. */
export async function removeEvent(id: number): Promise<boolean> {
  const existing = await db.calendarEvents.get(id);
  if (!existing) return false;
  await db.calendarEvents.delete(id);
  return true;
}

/**
 * Konfliktprüfung: überlappt ein neuer Termin (date/time/durationMin) mit
 * bestehenden Terminen am selben Tag? Ausgeschlossene IDs werden ignoriert
 * (z. B. beim Bearbeiten desselben Termins).
 */
export async function findConflicts(
  date: string,
  time: string,
  durationMin: number,
  excludeId?: number
): Promise<CalendarEvent[]> {
  const dayEvents = await db.calendarEvents.where('date').equals(date).toArray();
  const start = toMinutes(time);
  const end = start + Math.max(1, durationMin);
  return dayEvents.filter((e) => {
    if (excludeId !== undefined && e.id === excludeId) return false;
    const s = toMinutes(e.time);
    return s < end && start < s + Math.max(1, e.durationMin);
  });
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
