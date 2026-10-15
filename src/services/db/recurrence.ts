/**
 * Wiederkehrende Termine: vereinfachter iCal-RRULE-Subset.
 *
 * Unterstützte Felder (durch ';' getrennt, Schlüssel in Großbuchstaben):
 *   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY   (Pflicht)
 *   INTERVAL=n                          (Standard 1)
 *   BYDAY=MO,TU,...                     (nur bei FREQ=WEEKLY, 1-7 Werte)
 *   BYMONTHDAY=1..31                    (nur bei FREQ=MONTHLY)
 *   COUNT=n                             (max. n Vorkommen inkl. DTSTART)
 *   UNTIL=YYYY-MM-DD                    (letztes zulässiges Datum)
 *
 * Materialisierungsmodell: Serien werden NICHT live zur Laufzeit expandiert,
 * sondern "materialisiert" – jeder Termin ist ein echter DB-Eintrag und damit
 * mit den bestehenden Tools (list/remove/Konfliktprüfung) kompatibel.
 * `seriesId` verbindet die Einträge; Ausnahmen liegen als YYYY-MM-DD-Liste im
 * Serienkopf (`exceptions`). Der Nachlauf des Fensters wird vom Kalender-Modul
 * (ensureFutureOccurrences) bei jedem Zugriff aufgefüllt.
 */

export interface ParsedRecurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay?: number[];      // 0=So … 6=Sa (nur WEEKLY)
  byMonthDay?: number;   // 1..31 (nur MONTHLY)
  count?: number;        // maximale Anzahl Vorkommen
  until?: string;        // YYYY-MM-DD, letztes zulässiges Datum
}

const DAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Parst und validiert eine RRULE; wirft bei ungültiger Angabe. */
export function parseRRule(input: string): ParsedRecurrence {
  const rule = (input || '').trim().toUpperCase().replace(/^RRULE:?/, '');
  if (!rule) throw new Error('Leere Wiederholungsregel');
  const fields: Record<string, string> = {};
  for (const part of rule.split(';')) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`Ungültiges Feld in Wiederholungsregel: "${part}" (erwartet SCHLUESSEL=WERT)`);
    fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  const freqRaw = fields.FREQ;
  if (!freqRaw || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freqRaw)) {
    throw new Error(`FREQ muss DAILY, WEEKLY, MONTHLY oder YEARLY sein (erhalten: "${freqRaw ?? 'fehlt'}")`);
  }
  const freq = freqRaw as ParsedRecurrence['freq'];
  const interval = fields.INTERVAL ? parseInt(fields.INTERVAL, 10) : 1;
  if (!Number.isFinite(interval) || interval < 1 || interval > 366) {
    throw new Error(`INTERVAL muss eine Zahl zwischen 1 und 366 sein (erhalten: "${fields.INTERVAL}")`);
  }
  const out: ParsedRecurrence = { freq, interval };

  if (fields.BYDAY) {
    if (freq !== 'WEEKLY') throw new Error('BYDAY wird nur bei FREQ=WEEKLY unterstützt');
    const days = fields.BYDAY.split(',').map((d) => DAY_MAP[d.trim()]);
    if (days.some((d) => d === undefined) || days.length === 0 || days.length > 7) {
      throw new Error(`BYDAY erwartet 1-7 Wochentags-Kürzel (MO,TU,WE,TH,FR,SA,SU), erhalten: "${fields.BYDAY}"`);
    }
    out.byDay = [...new Set(days as number[])].sort();
  }
  if (fields.BYMONTHDAY) {
    if (freq !== 'MONTHLY') throw new Error('BYMONTHDAY wird nur bei FREQ=MONTHLY unterstützt');
    const d = parseInt(fields.BYMONTHDAY, 10);
    if (!Number.isFinite(d) || d < 1 || d > 31) throw new Error(`BYMONTHDAY muss 1-31 sein (erhalten: "${fields.BYMONTHDAY}")`);
    out.byMonthDay = d;
  }
  if (fields.COUNT) {
    const c = parseInt(fields.COUNT, 10);
    if (!Number.isFinite(c) || c < 1 || c > 1000) throw new Error(`COUNT muss eine Zahl zwischen 1 und 1000 sein (erhalten: "${fields.COUNT}")`);
    out.count = c;
  }
  if (fields.UNTIL) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.UNTIL)) throw new Error(`UNTIL erwartet YYYY-MM-DD (erhalten: "${fields.UNTIL}")`);
    out.until = fields.UNTIL;
  }
  return out;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Monatstag clampen (z. B. BYMONTHDAY=31 -> 30 im Juni, 28/29 im Februar). */
function addMonthsClamped(d: Date, n: number, fixedDay?: number): Date {
  const r = new Date(d);
  const targetDay = fixedDay ?? d.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const daysInMonth = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(targetDay, daysInMonth));
  return r;
}

function addYearsClamped(d: Date, n: number): Date {
  return addMonthsClamped(d, n * 12);
}

/** Erzeugt bis zu `limit` aufeinanderfolgende Termine der Serie ab `start`. */
export function generateOccurrences(start: string, rule: ParsedRecurrence, limit: number): string[] {
  const out: string[] = [];
  const startDate = new Date(`${start}T00:00:00`);
  if (Number.isNaN(startDate.getTime())) return out;

  if (rule.freq === 'WEEKLY' && rule.byDay) {
    // Wochenanker: Sonntag der Startwoche; in jeder n-ten Woche jeden BYDAY-Termin
    const anchor = addDays(startDate, -startDate.getDay());
    let weekIndex = Math.max(0, Math.floor(diffDays(anchor, startDate) / (7 * rule.interval)));
    let guard = 0;
    while (out.length < limit && guard++ < 600) {
      const weekStart = addDays(anchor, weekIndex * 7 * rule.interval);
      for (const day of rule.byDay) {
        if (out.length >= limit) break;
        const d = addDays(weekStart, day);
        if (diffDays(startDate, d) < 0) continue;            // vor DTSTART ignorieren
        const iso = fmtDate(d);
        if (rule.until && iso > rule.until) return out;
        if (rule.count && out.length >= rule.count) return out;
        out.push(iso);
      }
      weekIndex++;
      if (weekIndex > 271) break; // ~5 Jahre Suchraum genügen (COUNT/UNTIL begrenzen ohnehin)
    }
    return out;
  }

  let current: Date | null = startDate;
  let guard = 0;
  while (current && out.length < limit && guard++ < 4000) {
    const iso = fmtDate(current);
    if (rule.until && iso > rule.until) break;
    if (rule.count && out.length >= rule.count) break;
    out.push(iso);
    if (rule.freq === 'DAILY') {
      current = addDays(current, rule.interval);
    } else if (rule.freq === 'MONTHLY') {
      current = addMonthsClamped(startDate, out.length * rule.interval, rule.byMonthDay);
    } else {
      current = addYearsClamped(startDate, out.length * rule.interval);
    }
    if (current && fmtDate(current) <= iso) current = null; // Sicherheitsnetz gegen Stillstand
  }
  return out;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
