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
  let atFieldStart = true; // true am Zeilenanfang / direkt nach Trennzeichen
  let i = 0;
  while (i < csv.length) {
    const ch = csv[i];
    if (ch === '\n' || ch === '\r') {
      // RFC 4180: ein Zeilenende BEI Feldstart ist eine leere Zeile – keine
      // Spalte anhängen. Das verhindert Geister-Spalten bei CRLF-Dateien, wo
      // das '\r' vor dem '\n' bereits als leere letzte Spalte gepusht wurde.
      if (!atFieldStart) current.push('');
      rows.push(current);
      current = [];
      atFieldStart = true;
      i++++;
      if (ch === '\r' && csv[i] === '\n') i++; // \r\n als EIN Zeilenende
      continue;
    }
    if (ch === ',') {
      current.push('');
      atFieldStart = false;
      i++;
      continue;
    }
    const field = parseField(csv, i);
    current.push(field.value);
    atFieldStart = false;
    i = field.next;
    // Falls parseField nicht vorangekommen ist (Sonderfall leerer Rest),
    // ein Zeichen springen – verhindert eine Endlosschleife.
    if (i === field.next && i < csv.length && csv[i] !== ',' && csv[i] !== '\n' && csv[i] !== '\r') {
      i++;
    }
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
