/**
 * Ein einzelnes CSV-Feld lesen: unterstützt RFC-4180-konforme Anführungszeichen
 * ("..." mit "" als escaped Quote, Kommas/Neue Zeilen innerhalb von Quotes)
 * sowie einfache unquotierte Felder.
 */
function parseField(s: string, start: number): { value: string; next: number } {
  if (s[start] === '"') {
    let value = '';
    let i = start + 1;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') {
        if (s[i + 1] === '"') { value += '"'; i += 2; continue; } // escaped quote ("")
        i++; // schließendes Quote
        break;
      }
      value += ch;
      i++;
    }
    // Nach dem schließenden Quote bis zum Trennzeichen/Zeilenende vorrücken.
    return { value, next: i };
  }
  let i = start;
  let value = '';
  while (i < s.length && s[i] !== ',' && s[i] !== '\n' && s[i] !== '\r') {
    value += s[i++];
  }
  return { value: value.trim(), next: i };
}

/**
 * Parse CSV string to array of objects.
 * RFC-4180-konform: umschlossene Felder mit "..." (doppelte Quotes als
 * Escape), Kommas und Neue Zeilen innerhalb von Quotes, CRLF/LF gemischt,
 * UTF-8-BOM wird entfernt.
 */
export function parseCSV(csv: string): Record<string, string>[] {
  // UTF-8-BOM entfernen
  if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1);

  const rows: string[][] = [];
  let current: string[] = [];
  let atFieldStart = true; // true am Zeilenanfang und direkt nach jedem Komma
  let i = 0;
  while (i < csv.length) {
    const ch = csv[i];
    if (ch === '\n' || ch === '\r') {
      // RFC 4180: ein Zeilenende BEI Feldstart beendet die Zeile, OHNE eine
      // weitere Spalte anzuhängen. Das verhindert die Geister-Spalte '' bei
      // CRLF-Dateien, wo das '\r' sonst als separates leeres Feld zählte.
      if (!atFieldStart) current.push(''); // echtes leeres Schlussfeld ('a,')
      rows.push(current);
      current = [];
      atFieldStart = true;
      i++;
      if (ch === '\r' && csv[i] === '\n') i++; // \r\n als EIN Zeilenende
      continue;
    }
    if (ch === ',') {
      // Trennzeichen: das FELD DAVOR wurde bereits von parseField gelesen und
      // gepusht – der Komma-Zweig pusht nichts Eigenes. atFieldStart bleibt/
      // wird auf false gesetzt, damit ein ECHTES leeres Schlussfeld ("a,")
      // beim folgenden Zeilenende als '' gezählt wird. Ein '\r'\n bei
      // Feldstart (direkt nach Separador) würde andernfalls Geister-Spalten
      // erzeugen – verhindert das die !atFieldStart-Bedingung nicht? Doch:
      // nach '\n'/'\r' bei atFieldStart==true wird nichts gepusht, und nach
      // einem Komma ist das Folgezeichen entweder ein Feldstart (wird von
      // parseField gelesen) oder das Zeilenende selbst – Letzteres zählt nur
      // dann als leeres Feld, wenn direkt zuvor ein Komma stand... Genau das
      // ist RFC-4180-Konvention: "a," hat ein leeres zweites Feld, "a" nicht.
      atFieldStart = false;
      i++;
      continue;
    }
    // Hier beginnt garantiert ein Feld (kein Separador/Zeilenende).
    // parseField liest quotiert oder bis zum nächsten Separador/Zeilenende;
    // bei "a,,b" sieht es direkt das nächste Komma und liefert ''.
    const field = parseField(csv, i);
    current.push(field.value);
    atFieldStart = false;
    if (field.next === i) i++; // Sicherheitsinkrement gegen Endlosschleifen
    else i = field.next;
  }
  // Letzte Zeile abschließen (falls Datei ohne Newline endet)
  if (current.length > 0 || !atFieldStart) rows.push(current);

  // Leere Zeilen filtern (wie früher: lines.filter(l => l.trim()))
  const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(cells => {
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    return row;
  });
}

/**
 * Convert array of objects to CSV string (RFC-4180-konformes Quoting:
 * Komma, Anführungszeichen und Neue Zeilen erzwingen Quotes, " -> "").
 */
export function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const esc = (val: string): string => {
    if (/[",\n\r]/.test(val)) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const rows = data.map(row => headers.map(h => esc(String(row[h] ?? ''))).join(','));
  return [headers.join(','), ...rows].join('\n');
}
