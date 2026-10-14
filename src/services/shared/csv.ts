/**
 * Parse CSV string to array of objects
 */
export function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });
}

/**
 * Convert array of objects to CSV string
 */
export function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = String(row[h] ?? '');
      return val.includes(',') ? `"${val}"` : val;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
