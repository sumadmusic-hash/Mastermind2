import { toolRegistry } from '../registry';
import { def, ok, err, emptyErr } from '../toolHelpers';

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
// Deckt auch Nachrichten ab (ersetzt das frühere news_search-Tool): aktuelle
// Nachrichten einfach als Suchfrage anfragen, z.B. "Aktuelle Nachrichten zu X".
toolRegistry.register(
  def('ai_search', 'KI-Suche (Jina)', 'Token-sparende Recherche: liefert eine bereits von einer KI aufbereitete Kurzantwort mit Quellenangaben. Erspart deiner KI das Lesen ganzer Seiten. Auch für aktuelle Nachrichten nutzen (z.B. Frage "Aktuelle Nachrichten zu …"). Optional api_key für höheres Rate-Limit.', 'search',
    { query: { type: 'string', description: 'Suchfrage (auch für Nachrichten, z.B. "Aktuelle Nachrichten zu Berlin")' }, api_key: { type: 'string', description: 'Optional: Jina-API-Key (erhöht Rate-Limit)' } },
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

// --- NEWS ---
// Das frühere news_search-Tool (GDELT) wurde entfernt: Nachrichten werden
// jetzt über die KI-Suche (Jina, ai_search) abgefragt.
export {};
