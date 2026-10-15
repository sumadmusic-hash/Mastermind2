import { toolRegistry } from '../registry';
import { evaluateExpression } from '../../shared/safeMath';
import { parseCSV } from '../../shared/csv';
import { def, ok, err } from '../toolHelpers';

toolRegistry.register(
  def('calculator', 'Rechner', 'Mathematische Berechnungen (Ausdruck mit + - * / % ^, Klammern, Funktionen wie sqrt(16), deutsche Komma-Zahlen erlaubt)', 'data',
    { expression: { type: 'string', description: 'Mathematischer Ausdruck (z.B. 2+2, sqrt(16), 1.234,5*2)' } }),
  async (args) => {
    const expr = args.expression as string;
    try {
      // Sicherer Recursive-Descent-Parser: kein eval / new Function,
      // Codeausführung ist strukturell unmöglich.
      const result = evaluateExpression(expr);
      return ok({ expression: expr, result });
    } catch (e) { return err(`Berechnungsfehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('text_summarize', 'Zusammenfassung', 'Text zusammenfassen', 'data',
    { text: { type: 'string', description: 'Zu zusammenfassender Text' }, max_length: { type: 'number', description: 'Max. Länge (Zeichen)' } }),
  async (args) => {
    const text = args.text as string;
    const maxLen = (args.max_length as number) || 200;
    // Simple extractive summary: first sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    let summary = '';
    for (const s of sentences) {
      if ((summary + s).length > maxLen) break;
      summary += s.trim() + '. ';
    }
    return ok({ summary: summary.trim() || text.slice(0, maxLen), originalLength: text.length, summaryLength: summary.length });
  }
);

toolRegistry.register(
  def('chart_spec', 'Chart-Spezifikation', 'Chart-Daten für Visualisierung erstellen', 'data',
    { type: { type: 'string', description: 'Chart-Typ (line, bar, pie, area)' }, title: { type: 'string', description: 'Chart-Titel' }, data: { type: 'object', description: 'Chart-Daten' } }),
  async (args) => {
    const { type, title, data } = args as { type: string; title: string; data: unknown };
    return ok({ chartType: type, title, data, generated: new Date().toISOString() });
  }
);

toolRegistry.register(
  def('data_filter', 'Daten-Filter', 'Daten filtern und transformieren', 'data',
    { data: { type: 'array', description: 'Zu filternde Daten' }, filter: { type: 'string', description: 'Filter-Bedingung' } }),
  async (args) => {
    const data = args.data as unknown[];
    return ok({ filtered: data, count: data.length });
  }
);

toolRegistry.register(
  def('generate_report', 'Bericht erstellen', 'Strukturierten Bericht erstellen', 'data',
    { title: { type: 'string', description: 'Berichtstitel' }, sections: { type: 'array', description: 'Bericht-Abschnitte' } }),
  async (args) => {
    const { title, sections } = args as { title: string; sections: string[] };
    return ok({ title, sections, wordCount: sections.join(' ').split(' ').length, generated: new Date().toISOString() });
  }
);

toolRegistry.register(
  def('export_file', 'Export', 'Daten als Datei exportieren', 'data',
    { filename: { type: 'string', description: 'Dateiname' }, data: { type: 'string', description: 'CSV/JSON-Daten' }, format: { type: 'string', description: 'Format (csv, json)' } }),
  async (args) => {
    const { filename, data, format } = args as { filename: string; data: string; format: string };
    const blob = new Blob([data], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    return ok({ filename, format, downloadUrl: url, size: blob.size });
  }
);

toolRegistry.register(
  def('import_file', 'Import', 'Datei importieren und parsen', 'data',
    { content: { type: 'string', description: 'Datei-Inhalt' }, format: { type: 'string', description: 'Format (csv, json, text)' } }),
  async (args) => {
    const { content, format } = args as { content: string; format: string };
    if (format === 'json') {
      try { return ok({ data: JSON.parse(content), format }); }
      catch { return err('Ungültiges JSON'); }
    }
    if (format === 'csv') {
      // RFC-4180-konformer Parser (geteilte Logik in shared/csv): behandelt
      // umschlossene Felder, Kommas/Neue Zeilen in Quotes sowie CRLF korrekt –
      // ein simples split(',') konnte das nicht.
      const rows = parseCSV(content);
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      return ok({ headers, rows, rowCount: rows.length, format });
    }
    return ok({ content: content.slice(0, 5000), format, length: content.length });
  }
);
