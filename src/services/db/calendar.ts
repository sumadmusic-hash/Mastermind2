import { db } from './schema';
import type { CalendarEvent } from './schema';
import { parseRRule, generateOccurrences } from './recurrence';

/** wie viele Termine einer Serie maximal vorgeplant werden (Materialisierung) */
const HORIZON_OCCURRENCES = 12;
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeSeriesId(title: string, date: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `ser-${date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${rand}`;
}

/**
 * Füllt eine offene Serie bis an ihr Ende oder an den Materialisierungshorizont
 * auf. Wird vor List-/Konfliktzugriffen aufgerufen, damit auch zukünftige
 * Serientermine als echte DB-Einträge existieren (und Konflikte prüfen lassen).
 */
async function ensureFutureOccurrences(head: CalendarEvent): Promise<void> {
  if (!head.seriesId || !head.recurrence || head.seriesClosed) return;
  let rule;
  try { rule = parseRRule(head.recurrence); } catch { return; } // kaputte Regel ignorieren
  const horizonDate = addDaysIso(todayIso(), 366);
  const existing = await db.calendarEvents.where('seriesId').equals(head.seriesId).toArray();
  const dates = new Set(existing.map((e) => e.date));
  // begrenzte Generierung: nie mehr als ein Jahr voraus / 50 neue pro Aufruf
  const all = generateOccurrences(head.date, rule, 400);
  let added = 0;
  for (const date of all) {
    if (date > horizonDate) break;
    if (added >= 50) break;
    if (dates.has(date)) continue;
    if ((head.exceptions ?? []).includes(date)) continue;
    await db.calendarEvents.add({
      ...head, id: undefined, date, createdAt: Date.now(),
      seriesClosed: false,
    });
    dates.add(date);
    added++;
  }
  // Serie schließen, wenn das Ende (COUNT/UNTIL) innerhalb des Horizonts
  // erreicht und alles materialisiert ist – verhindert unnötige Nachläufe.
  const last = all[all.length - 1];
  if (last && last <= horizonDate) {
    const expected = all.filter((d) => !(head.exceptions ?? []).includes(d) && d <= horizonDate).length;
    const created = await db.calendarEvents.where('seriesId').equals(head.seriesId).count();
    if (created >= expected) {
      await db.calendarEvents
        .where('seriesId').equals(head.seriesId)
        .modify({ seriesClosed: true });
    }
  }
}

/** Alle offenen Serienköpfe mit Terminen ab heute nachfüllen (best effort). */
async function ensureAllOpenSeries(): Promise<void> {
  const heads = await db.calendarEvents
    .filter((e) => !!e.seriesId && !!e.recurrence && !e.seriesClosed && e.date >= todayIso())
    .toArray();
  for (const h of heads) await ensureFutureOccurrences(h);
}

/** Termin anlegen. Validiert Datum (YYYY-MM-DD) und Zeit (HH:MM). */
export async function addEvent(event: Omit<CalendarEvent, 'id' | 'createdAt'>): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) throw new Error(`Ungültiges Datum: "${event.date}" (erwartet YYYY-MM-DD)`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) throw new Error(`Ungültige Zeit: "${event.time}" (erwartet HH:MM, 24h)`);
  const durationMin = Math.max(1, Math.min(Number(event.durationMin) || 60, 24 * 60));
  const base = { ...event, durationMin, createdAt: Date.now() };
  // Wiederkehrender Termin: Serie anlegen und erste Vorkommen materialisieren
  if (base.recurrence) {
    const rule = parseRRule(base.recurrence); // wirft bei ungültiger RRULE
    const seriesId = base.seriesId || makeSeriesId(base.title, base.date);
    const occurrences = generateOccurrences(base.date, rule, HORIZON_OCCURRENCES);
    if (occurrences.length === 0) throw new Error('Wiederholungsregel erzeugt keine Termine');
    let headId: number | undefined;
    for (const date of occurrences) {
      const isHead = date === base.date;
      const id = await db.calendarEvents.add({
        ...base,
        id: undefined,
        date,
        recurrence: base.recurrence,
        seriesId,
        exceptions: isHead ? base.exceptions : undefined,
        seriesClosed: false,
      });
      if (isHead) headId = id as number;
    }
    if (headId === undefined) {
      // DTSTART traf keinen Regeltermin (z. B. BYDAY-Wahl): Kopf = erster Termin
      headId = (await db.calendarEvents
        .where('seriesId').equals(seriesId).first())?.id;
    }
    return headId as number;
  }
  const id = await db.calendarEvents.add(base);
  return id as number;
}

/** Alle Termine, optional in einem Datumsfenster [from..to] (inklusive), aufsteigend sortiert. */
export async function listEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
  await ensureAllOpenSeries();
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
  return deleteOccurrence(id);
}

/**
 * Interner Löschpfad mit Serien-Bewusstsein:
 * - Einzeltermin ohne Serie: einfach löschen.
 * - offener Serientermin im aktuellen Fenster: Eintrag löschen UND als
 *   Ausnahme im Serienkopf vermerken – sonst würde der Materialisierer ihn
 *   beim nächsten Zugriff sofort wieder erzeugen.
 * - bereits abgelaufener Serientermin: nur löschen (liegt außerhalb des
 *   Generierungsfensters).
 * - letzter Eintrag einer Serie: Serie vollständig auflösen.
 */
async function deleteOccurrence(id: number): Promise<boolean> {
  const existing = await db.calendarEvents.get(id);
  if (!existing) return false;
  if (!existing.seriesId) {
    await db.calendarEvents.delete(id);
    return true;
  }
  const members = await db.calendarEvents.where('seriesId').equals(existing.seriesId).toArray();
  if (members.length <= 1) {
    await db.calendarEvents.delete(id);
    return true;
  }
  await db.calendarEvents.delete(id);
  const today = todayIso();
  // Ausnahme nur nötig, wenn das Datum noch innerhalb des Nachlauf-Fensters liegt
  if (existing.date >= today && !existing.seriesClosed) {
    const head = members.find((m) => m.id !== id && (m.exceptions?.length ?? 0) > 0)
      || members.filter((m) => m.id !== id).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (head) {
      const exceptions = [...new Set([...(head.exceptions ?? []), existing.date])];
      await db.calendarEvents.update(head.id!, { exceptions });
    }
  }
  return true;
}

/** Serie komplett auflösen: alle Termine der Serie löschen. Gibt Anzahl zurück. */
export async function deleteSeries(eventId: number): Promise<number> {
  const ev = await db.calendarEvents.get(eventId);
  if (!ev || !ev.seriesId) return 0;
  const ids = await db.calendarEvents.where('seriesId').equals(ev.seriesId).primaryKeys();
  await db.calendarEvents.bulkDelete(ids);
  return ids.length;
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
  await ensureAllOpenSeries();
  const dayEvents = await db.calendarEvents.where('date').equals(date).toArray();
  const start = toMinutes(time);
  const end = start + Math.max(1, durationMin);
  return dayEvents.filter((e) => {
    if (excludeId !== undefined && e.id === excludeId) return false;
    const s = toMinutes(e.time);
    return s < end && start < s + Math.max(1, e.durationMin);
  });
}

/**
 * Termin bearbeiten. Nur angegebene Felder werden geändert.
 * scope="single" (Standard): nur dieser Eintrag.
 * scope="future":  diesen und alle späteren Termine seiner Serie ändern.
 * scope="series":  alle Termine der Serie (auch vergangene) ändern.
 * Gibt die Anzahl geänderter Termine zurück (0 = nicht gefunden).
 */
export async function updateEvent(
  id: number,
  changes: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>,
  scope: 'single' | 'future' | 'series' = 'single'
): Promise<number> {
  const existing = await db.calendarEvents.get(id);
  if (!existing) return 0;
  const clean: Partial<CalendarEvent> = {};
  if (changes.title !== undefined) clean.title = String(changes.title).trim();
  if (changes.description !== undefined) clean.description = changes.description;
  if (changes.location !== undefined) clean.location = changes.location;
  if (changes.participants !== undefined) clean.participants = changes.participants;
  if (changes.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) throw new Error(`Ungültiges Datum: "${changes.date}" (erwartet YYYY-MM-DD)`);
    clean.date = changes.date;
  }
  if (changes.time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.time)) throw new Error(`Ungültige Zeit: "${changes.time}" (erwartet HH:MM, 24h)`);
    clean.time = changes.time;
  }
  if (changes.durationMin !== undefined) {
    clean.durationMin = Math.max(1, Math.min(Number(changes.durationMin) || 60, 24 * 60));
  }
  if (scope === 'single') {
    await db.calendarEvents.update(id, clean);
    return 1;
  }
  if (!existing.seriesId) {
    await db.calendarEvents.update(id, clean);
    return 1;
  }
  const members = await db.calendarEvents.where('seriesId').equals(existing.seriesId).toArray();
  const targets = members.filter((m) => scope === 'series' || m.date >= existing.date);
  for (const m of targets) {
    const c = { ...clean };
    // Datum/Verschiebung: pro Serientermin relativ zum Original anwenden statt
    // alle auf dasselbe Datum zu setzen – stattdessen Datum-Änderungen nur am
    // angesprochenen Termin, übrige bleiben in ihrem Raster.
    if (c.date !== undefined && m.id !== id) delete c.date;
    await db.calendarEvents.update(m.id!, c);
  }
  return targets.length;
}

/**
 * Einmalige Ausnahme von einer Serie: löscht den Termin an diesem Datum,
 * verhindert die Neumaterialisierung und verschiebt optional an ein neues Datum.
 */
export async function addException(
  seriesIdOrEventId: number,
  options?: { moveTo?: string }
): Promise<{ exceptionDate: string; movedTo?: string }> {
  const ev = await db.calendarEvents.get(seriesIdOrEventId);
  if (!ev) throw new Error(`Kein Termin mit ID ${seriesIdOrEventId} gefunden`);
  if (!ev.seriesId) throw new Error(`Termin #${ev.id} gehört zu keiner wiederkehrenden Serie`);
  const members = await db.calendarEvents.where('seriesId').equals(ev.seriesId).toArray();
  const head = members.find((m) => (m.exceptions?.length ?? 0) > 0) || members.sort((a, b) => a.date.localeCompare(b.date))[0];
  const exceptions = [...new Set([...(head.exceptions ?? []), ev.date])];
  await db.calendarEvents.update(head.id!, { exceptions });
  let movedTo: string | undefined;
  if (options?.moveTo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.moveTo)) throw new Error(`Ungültiges Datum: "${options.moveTo}" (erwartet YYYY-MM-DD)`);
    movedTo = options.moveTo;
    await db.calendarEvents.add({ ...ev, id: undefined, date: movedTo, seriesId: undefined, recurrence: undefined, exceptions: undefined, seriesClosed: undefined, createdAt: Date.now() });
  }
  await db.calendarEvents.delete(ev.id!);
  return { exceptionDate: ev.date, movedTo };
}


function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
