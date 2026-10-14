import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../../types/tool';
import { toolRegistry } from './registry';
import { evaluateExpression } from '../shared/safeMath';

// Helper to create a tool definition
function def(
  id: string, name: string, description: string, category: ToolDefinition['category'],
  inputSchema: Record<string, unknown>, permissions: string[] = []
): ToolDefinition {
  return {
    id, name, description, category,
    inputSchema: { type: 'object', properties: inputSchema, required: Object.keys(inputSchema) },
    version: '1.0.0', enabled: true,
    permissions: permissions as ToolDefinition['permissions'],
    maxDuration: 30000, maxDataSize: 50000, builtin: true,
  };
}

// Helper to create a success result
function ok(data: unknown, sources?: ToolResult['sources']): ToolResult {
  return { callId: '', toolId: '', success: true, data, sources, duration: 0, cached: false };
}

function err(error: string): ToolResult {
  return { callId: '', toolId: '', success: false, error, duration: 0, cached: false };
}

// Leeres Ergebnis = expliziter Fehlschlag (verhindert stumme Erfolgs-Meldungen
// und Wiederholungsschleifen des Agenten bei ergebnislosen Anfragen)
function emptyErr(message: string): ToolResult {
  return err(`${message} – keine Treffer. Bitte nicht dieselbe Anfrage wiederholen, sondern dem Nutzer mitteilen, dass keine Ergebnisse vorliegen.`);
}

// Kompakte DDG-Antwort extrahieren: Abstract + AbstractText statt ganzer RelatedTopics-Bäume
interface DdgTopic { Text?: string; FirstURL?: string; Topics?: DdgTopic[] }
function flattenDdgTopics(topics: DdgTopic[] | undefined, depth = 0): DdgTopic[] {
  if (!topics || depth > 2) return [];
  const out: DdgTopic[] = [];
  for (const t of topics) {
    if (t.FirstURL) out.push(t);
    else out.push(...flattenDdgTopics(t.Topics, depth + 1));
  }
  return out;
}

// --- SEARCH TOOLS ---
toolRegistry.register(
  def('ddg_web_search', 'DuckDuckGo Suche', 'Web-Suche über DuckDuckGo. Liefert nur thematische Kurzantworten (Instant Answers), KEINE lokalen/tagesaktuellen Infos (z.B. Kinoprogramme). Bei leeren Treffern nicht erneut suchen.', 'search',
    { query: { type: 'string', description: 'Suchbegriff' }, max_results: { type: 'number', description: 'Max Ergebnisse (1-10)' } },
    ['network']),
  async (args) => {
    const query = args.query as string;
    const maxResults = Math.min(Math.max((args.max_results as number) || 5, 1), 10);
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
      if (!res.ok) return err(`Suchfehler: HTTP ${res.status}`);
      const data = await res.json();
      // Sofort-Kompaktantwort bevorzugen: 1 Request, minimale Tokens
      if (data.AbstractText || data.Answer) {
        const compact = [{
          title: (data.Heading as string) || query,
          url: (data.AbstractURL as string) || '',
          snippet: (data.AbstractText as string) || String(data.Answer || ''),
        }];
        return ok(compact, compact);
      }
      const results = flattenDdgTopics(data.RelatedTopics)
        .slice(0, maxResults).map((t) => ({
          title: (t.Text || '').split(' - ')[0] || '',
          url: t.FirstURL || '',
          snippet: (t.Text || '').slice(0, 200),
        })).filter((r) => r.url);
      if (results.length === 0) return emptyErr(`Keine Suchtreffer für "${query}"`);
      return ok(results, results);
    } catch (e) { return err(`Suchfehler: ${(e as Error).message}`); }
  }
);

// Optimierte Suche: Wikipedia-Summary-API – schlankste kostenlose Quelle.
// 1 Request, CORS-fähig, liefert bereits aufbereitete Extrakte (~100–250 Tokens)
// statt ganzer HTML-Seiten. Ideal um Tokens zu sparen.
toolRegistry.register(
  def('web_search', 'Optimierte Websuche', 'Token-sparende Recherche: liefert kompakte, aufbereitete Kurz-Zusammenfassungen (Snippet + URL) pro Treffer. Bevorzugt vor ddg_web_search/url_fetch.', 'search',
    { query: { type: 'string', description: 'Suchbegriff' }, max_results: { type: 'number', description: 'Max Ergebnisse (1-5)' }, lang: { type: 'string', description: 'Sprache (de, en; Standard de)' } },
    ['network']),
  async (args) => {
    const query = args.query as string;
    const lang = ((args.lang as string) || 'de').slice(0, 2);
    const maxResults = Math.min(Math.max((args.max_results as number) || 3, 1), 5);
    try {
      // Wikimedia drosselt requests ohne echten User-Agent (403) – Header setzen
      const headers = { 'User-Agent': 'AIResearchAssistant/1.0 (browser-based research tool)' };
      // Schritt 1: Titelvorschläge (Opensearch, sehr leichtgewichtig)
      const sRes = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&format=json`, { headers, signal: AbortSignal.timeout(10000) });
      if (!sRes.ok) return err(`Suchfehler: HTTP ${sRes.status}`);
      const suggestions = await sRes.json() as [string, string[], string[], string[]];
      const titles = suggestions[1] || [];
      if (titles.length === 0) return emptyErr(`Keine Treffer für "${query}"`);
      // Schritt 2: Kompakte Summaries parallel holen
      const summaries = await Promise.all(titles.slice(0, maxResults).map(async (title) => {
        try {
          const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!r.ok) return null;
          const d = await r.json();
          return {
            title: d.title as string,
            snippet: ((d.extract as string) || '').slice(0, 300),
            url: d.content_urls?.desktop?.page as string || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
          };
        } catch { return null; }
      }));
      const results = summaries.filter((s): s is NonNullable<typeof s> => s !== null && !!s.snippet);
      if (results.length === 0) return emptyErr(`Keine verwertbaren Zusammenfassungen für "${query}"`);
      return ok(results, results);
    } catch (e) { return err(`Suchfehler: ${(e as Error).message}`); }
  }
);

// Jina Search Grounding: kostenlose, KI-aufbereitete Suchantwort (Antwort + Quellen
// in einem Request). Ohne API-Key mit Rate-Limit; optionaler Key per args.api_key.
toolRegistry.register(
  def('ai_search', 'KI-Suche (Jina)', 'Token-sparende Recherche: liefert eine bereits von einer KI aufbereitete Kurzantwort mit Quellenangaben. Erspart deiner KI das Lesen ganzer Seiten. Optional api_key für höheres Rate-Limit.', 'search',
    { query: { type: 'string', description: 'Suchfrage' }, api_key: { type: 'string', description: 'Optional: Jina-API-Key (erhöht Rate-Limit)' } },
    ['network']),
  async (args) => {
    const query = args.query as string;
    const apiKey = (args.api_key as string) || '';
    try {
      const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
        headers: {
          'Accept': 'text/plain',
          'x-return-format': 'markdown',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return err(`KI-Suche fehlgeschlagen: HTTP ${res.status}${res.status === 429 ? ' (Rate-Limit ohne Key – bitte später erneut versuchen oder url_fetch nutzen)' : ''}`);
      const text = await res.text();
      if (text.trim().length < 40) return emptyErr('KI-Suche lieferte keine verwertbare Antwort');
      return ok({ answer: text.slice(0, 4000) });
    } catch (e) { return err(`KI-Suche-Fehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('url_fetch', 'URL Abruf', 'Inhalt einer Webseite abrufen', 'search',
    { url: { type: 'string', description: 'URL der Webseite' } },
    ['network']),
  async (args) => {
    const url = args.url as string;
    // SSRF protection
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return err('Nur HTTP/HTTPS erlaubt');
      const hostname = parsed.hostname.toLowerCase();
      if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)) return err('Interne URLs blockiert');
      if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return err('Interne Hostnamen blockiert');
    } catch { return err('Ungültige URL'); }

    // Token-sparende Vorstufe: Jina Reader liefert bereits aufbereitetes Markdown
    // (Header x-respond-with) statt HTML-Rohtext; bei Fehler/CORS -> direkter Fallback.
    try {
      const jr = await fetch(`https://r.jina.ai/${url}`, {
        headers: { 'Accept': 'text/plain', 'x-respond-with': 'markdown' },
        signal: AbortSignal.timeout(20000),
      });
      if (jr.ok) {
        const md = await jr.text();
        if (md.trim().length > 80) {
          return ok({ url, source: 'jina-reader', contentLength: md.length, preview: md.slice(0, 3000) });
        }
      }
    } catch { /* CORS/Timeout -> Fallback unten */ }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'AIResearchAssistant/1.0' }, signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      const truncated = text.slice(0, 10000);
      return ok({ url, status: res.status, contentLength: text.length, preview: truncated.slice(0, 2000) });
    } catch (e) { return err(`Fetch-Fehler: ${(e as Error).message}`); }
  }
);

// --- NEWS TOOLS ---
toolRegistry.register(
  def('news_search', 'Nachrichten-Suche', 'Aktuelle Nachrichten suchen', 'news',
    { query: { type: 'string', description: 'Suchbegriff' }, lang: { type: 'string', description: 'Sprache (de, en)' } },
    ['network']),
  async (args) => {
    const query = args.query as string;
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query + ' news')}&format=json&no_html=1`);
      const data = await res.json();
      const results = (data.RelatedTopics || []).slice(0, 5).map((t: Record<string, unknown>) => ({
        title: (t.Text as string || '').split(' - ')[0],
        url: (t.FirstURL as string) || '',
        snippet: (t.Text as string) || '',
      })).filter((r: { url: string }) => r.url);
      if (results.length === 0) return emptyErr(`Keine Nachrichtentreffer für "${query}"`);
      return ok(results);
    } catch (e) { return err(`Nachrichten-Fehler: ${(e as Error).message}`); }
  }
);

// --- FINANCE TOOLS ---
toolRegistry.register(
  def('stock_price', 'Aktienkurs', 'Aktuellen Aktienkurs abrufen', 'finance',
    { ticker: { type: 'string', description: 'Ticker-Symbol (z.B. AAPL, SAP.DE)' } },
    ['network']),
  async (args) => {
    const ticker = args.ticker as string;
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`);
      if (!res.ok) return err(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data.chart?.result?.[0];
      if (!result) return err('Keine Daten gefunden');
      const meta = result.meta;
      return ok({
        ticker: meta.symbol,
        price: meta.regularMarketPrice,
        currency: meta.currency,
        exchange: meta.exchangeName,
        previousClose: meta.chartPreviousClose,
        change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2) + '%',
      });
    } catch (e) { return err(`Aktien-Fehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('currency_convert', 'Währungsumrechnung', 'Währungen umrechnen', 'finance',
    { amount: { type: 'number', description: 'Betrag' }, from: { type: 'string', description: 'Von (z.B. EUR)' }, to: { type: 'string', description: 'Nach (z.B. USD)' } },
    ['network']),
  async (args) => {
    const { amount, from, to } = args as { amount: number; from: string; to: string };
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`);
      const data = await res.json();
      const rate = data.rates?.[to.toUpperCase()];
      if (!rate) return err(`Kein Kurs für ${from}/${to}`);
      return ok({ amount, from: from.toUpperCase(), to: to.toUpperCase(), rate, converted: (amount * rate).toFixed(2) });
    } catch (e) { return err(`Währungsfehler: ${(e as Error).message}`); }
  }
);

// --- KNOWLEDGE TOOLS ---
toolRegistry.register(
  def('company_lookup', 'Unternehmens-Info', 'Informationen zu einem Unternehmen (Wikipedia)', 'knowledge',
    { company: { type: 'string', description: 'Unternehmensname' } },
    ['network']),
  async (args) => {
    const company = args.company as string;
    try {
      const res = await fetch(`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(company)}`);
      if (!res.ok) {
        const res2 = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(company)}`);
        if (!res2.ok) return err('Unternehmen nicht gefunden');
        const data2 = await res2.json();
        return ok({ name: data2.title, description: data2.extract, url: data2.content_urls?.desktop?.page });
      }
      const data = await res.json();
      return ok({ name: data.title, description: data.extract, url: data.content_urls?.desktop?.page });
    } catch (e) { return err(`Lookup-Fehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('weather_lookup', 'Wetter', 'Aktuelles Wetter für einen Ort', 'knowledge',
    { location: { type: 'string', description: 'Ortsname' } },
    ['network']),
  async (args) => {
    const location = args.location as string;
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
      const data = await res.json();
      const current = data.current_condition?.[0];
      if (!current) return err('Keine Wetterdaten');
      return ok({
        location,
        temp_c: current.temp_C,
        feels_like: current.FeelsLikeC,
        humidity: current.humidity,
        description: current.weatherDesc?.[0]?.value,
        wind_kmph: current.windspeedKmph,
      });
    } catch (e) { return err(`Wetterfehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('translate_text', 'Übersetzung', 'Text übersetzen', 'knowledge',
    { text: { type: 'string', description: 'Zu übersetzender Text' }, target_lang: { type: 'string', description: 'Zielsprache (z.B. en, de, fr)' } },
    ['network']),
  async (args) => {
    const { text, target_lang } = args as { text: string; target_lang: string };
    try {
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${target_lang}`);
      const data = await res.json();
      return ok({ original: text, translated: data.responseData?.translatedText, targetLang: target_lang });
    } catch (e) { return err(`Übersetzungsfehler: ${(e as Error).message}`); }
  }
);

// --- DATA TOOLS ---
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
      const lines = content.split('\n').filter(l => l.trim());
      const headers = lines[0]?.split(',').map(h => h.trim()) || [];
      const rows = lines.slice(1).map(l => {
        const vals = l.split(',');
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ''; });
        return row;
      });
      return ok({ headers, rows, rowCount: rows.length, format });
    }
    return ok({ content: content.slice(0, 5000), format, length: content.length });
  }
);

// --- MEMORY TOOLS ---
toolRegistry.register(
  def('memory_save', 'Erinnerung speichern', 'Information persistent speichern', 'memory',
    { category: { type: 'string', description: 'Kategorie' }, key: { type: 'string', description: 'Schlüssel' }, value: { type: 'string', description: 'Wert' } },
    ['write', 'storage']),
  async (args) => {
    const { category, key, value } = args as { category: string; key: string; value: string };
    const { saveMemory } = await import('../db/memories');
    await saveMemory(category, key, value);
    return ok({ saved: true, category, key });
  }
);

toolRegistry.register(
  def('memory_recall', 'Erinnerung abrufen', 'Gespeicherte Informationen abrufen', 'memory',
    { category: { type: 'string', description: 'Kategorie (optional)' } },
    ['storage']),
  async (args) => {
    const category = args.category as string | undefined;
    const { recallMemory } = await import('../db/memories');
    const memories = await recallMemory(category);
    return ok({ memories, count: memories.length });
  }
);

toolRegistry.register(
  def('memory_forget', 'Erinnerung löschen', 'Gespeicherte Information löschen', 'memory',
    { category: { type: 'string', description: 'Kategorie' }, key: { type: 'string', description: 'Schlüssel' } },
    ['write', 'storage']),
  async (args) => {
    const { category, key } = args as { category: string; key: string };
    const { forgetMemory } = await import('../db/memories');
    await forgetMemory(category, key);
    return ok({ deleted: true, category, key });
  }
);

// --- AUTOMATION TOOLS ---
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
    const { createJob, computeNextRun } = await import('../db/scheduler');
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
    const { listJobs } = await import('../db/scheduler');
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
    const { deleteJob } = await import('../db/scheduler');
    await deleteJob(jobId);
    return ok({ removed: true, jobId });
  }
);

// --- ADDITIONAL NEWS ---
toolRegistry.register(
  def('web_search', 'Web-Suche', 'Allgemeine Web-Suche', 'search',
    { query: { type: 'string', description: 'Suchbegriff' } },
    ['network']),
  async (args) => {
    return toolRegistry.execute('ddg_web_search', args, { origin: 'user', sessionId: '' });
  }
);

toolRegistry.register(
  def('webz_news', 'Webz News', 'Nachrichten über Webz API', 'news',
    { query: { type: 'string', description: 'Suchbegriff' } },
    ['network']),
  async (args) => {
    return toolRegistry.execute('news_search', args, { origin: 'user', sessionId: '' });
  }
);

toolRegistry.register(
  def('webz_top_news', 'Webz Top-News', 'Top-Nachrichten über Webz', 'news',
    { query: { type: 'string', description: 'Suchbegriff' } },
    ['network']),
  async (args) => {
    return toolRegistry.execute('news_search', args, { origin: 'user', sessionId: '' });
  }
);

toolRegistry.register(
  def('gnews_search', 'GNews Suche', 'Nachrichten über GNews', 'news',
    { query: { type: 'string', description: 'Suchbegriff' } },
    ['network']),
  async (args) => {
    return toolRegistry.execute('news_search', args, { origin: 'user', sessionId: '' });
  }
);

toolRegistry.register(
  def('gnews_top_headlines', 'GNews Top-Headlines', 'Top-Schlagzeilen über GNews', 'news',
    { query: { type: 'string', description: 'Suchbegriff' } },
    ['network']),
  async (args) => {
    return toolRegistry.execute('news_search', args, { origin: 'user', sessionId: '' });
  }
);

toolRegistry.register(
  def('stock_analysis', 'Aktien-Analyse', 'Detaillierte Aktien-Analyse', 'finance',
    { ticker: { type: 'string', description: 'Ticker-Symbol' } },
    ['network']),
  async (args) => {
    const result = await toolRegistry.execute('stock_price', args, { origin: 'user', sessionId: '' });
    if (!result.success) return result;
    return ok({ ...result.data as object, analysis: 'Automatische Analyse basierend auf aktuellen Kursdaten' });
  }
);

toolRegistry.register(
  def('macro_series', 'Makro-Daten', 'Makroökonomische Datenreihen', 'finance',
    { series_id: { type: 'string', description: 'Datenreihen-ID (z.B. GDP, CPIAUCSL)' } },
    ['network']),
  async (args) => {
    const seriesId = args.series_id as string;
    return ok({ seriesId, note: 'FRED-API-Key erforderlich für volle Funktionalität', data: [] });
  }
);

toolRegistry.register(
  def('economic_calendar', 'Wirtschaftskalender', 'Kommende Wirtschaftsereignisse', 'finance',
    { days: { type: 'number', description: 'Anzahl Tage im Voraus' } },
    ['network']),
  async (args) => {
    const days = (args.days as number) || 7;
    return ok({ days, events: [], note: 'Kalenderdaten erfordern API-Key' });
  }
);

toolRegistry.register(
  def('portfolio_overview', 'Portfolio-Übersicht', 'Übersicht der Portfolio-Positionen', 'finance', {}, ['storage']),
  async () => {
    const { getPositions } = await import('../db/portfolio');
    const positions = await getPositions();
    return ok({ positions, count: positions.length });
  }
);

toolRegistry.register(
  def('portfolio_update', 'Portfolio aktualisieren', 'Portfolio-Position hinzufügen/aktualisieren', 'finance',
    { ticker: { type: 'string', description: 'Ticker' }, quantity: { type: 'number', description: 'Anzahl' }, avg_price: { type: 'number', description: 'Durchschnittspreis' } },
    ['write', 'storage']),
  async (args) => {
    const { ticker, quantity, avg_price } = args as { ticker: string; quantity: number; avg_price: number };
    const { upsertPosition } = await import('../db/portfolio');
    await upsertPosition({ ticker, quantity, avgPrice: avg_price, updatedAt: Date.now() });
    return ok({ updated: true, ticker, quantity, avgPrice: avg_price });
  }
);
