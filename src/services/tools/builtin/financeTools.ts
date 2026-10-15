import { toolRegistry } from '../registry';
import { fetchJson } from '../../shared/fetch';
import { def, ok, err } from '../toolHelpers';
import {
  fetchYahooChart,
  toNumberOrNull,
  lastValue,
  formatDate,
} from './yahooFinance';

toolRegistry.register(
  def('stock_price', 'Aktienkurs', 'Aktuellen Aktienkurs inkl. Tagesverlauf abrufen', 'finance',
    { ticker: { type: 'string', description: 'Ticker-Symbol (z.B. AAPL, NVDA, SAP.DE – für XETRA/Deutsche Börse mit Endung .DE)' } },
    ['network']),
  async (args) => {
    const raw = String(args.ticker ?? '').trim();
    if (!raw) return err('Kein Ticker angegeben');
    const ticker = raw.toUpperCase();
    try {
      const data = await fetchYahooChart(ticker);
      const chart = data.chart;
      if (chart?.error) {
        return err(`Yahoo Finance: ${chart.error.description || chart.error.code || 'Unbekannter Fehler'} (Ticker "${ticker}" prüfen, z.B. NVDA oder SAP.DE)`);
      }
      const result = chart?.result?.[0];
      const meta = result?.meta;
      if (!result || !meta) {
        return err(`Keine Kursdaten für "${ticker}" gefunden. Bitte gültiges Yahoo-Ticker-Symbol verwenden (US: NVDA, DE: SAP.DE).`);
      }

      const closes = result.indicators?.quote?.[0]?.close;
      const price = toNumberOrNull(meta.regularMarketPrice) ?? lastValue(closes);
      if (price === null) {
        return err(`Kurswert für "${ticker}" nicht verfügbar (Markt geschlossen oder ungültiger Ticker).`);
      }
      const prevClose = toNumberOrNull(meta.chartPreviousClose) ?? toNumberOrNull(meta.previousClose);
      const changePct = prevClose && prevClose !== 0
        ? ((price - prevClose) / prevClose * 100).toFixed(2) + '%'
        : undefined;

      // Kompakter Tagesverlauf (Datum + Schluss), damit die KI den Trend sieht
      const history = (result.timestamp || []).map((ts, i) => ({
        date: formatDate(ts),
        close: toNumberOrNull(closes?.[i]) ?? undefined,
      })).filter((h) => h.close !== undefined && h.close !== null);

      return ok({
        ticker: meta.symbol || ticker,
        price,
        currency: meta.currency,
        exchange: meta.fullExchangeName || meta.exchangeName,
        previousClose: prevClose ?? undefined,
        change: changePct,
        history,
        source: 'Yahoo Finance Chart API',
      });
    } catch (e) {
      const msg = (e as Error).message;
      // Nie eine rohe SyntaxError durchreichen – der Agent soll erkennen,
      // dass es ein Server-/Rate-Limit-Problem ist, kein Ticker-Problem.
      if (/HTML statt JSON|zu viele Anfragen|Too Many Requests|HTTP 429/i.test(msg)) {
        return err(`Aktienkurs-Anfrage abgelehnt (Raten-Begrenzung des Dienstes): ${msg}. Nicht erneut versuchen; stattdessen web_search/ai_search für den aktuellen Kurs nutzen.`);
      }
      return err(`Aktien-Fehler: ${msg}`);
    }
  }
);

toolRegistry.register(
  def('currency_convert', 'Währungsumrechnung', 'Währungen umrechnen', 'finance',
    { amount: { type: 'number', description: 'Betrag' }, from: { type: 'string', description: 'Von (z.B. EUR)' }, to: { type: 'string', description: 'Nach (z.B. USD)' } },
    ['network']),
  async (args) => {
    const { amount, from, to } = args as { amount: number; from: string; to: string };
    try {
      const data = await fetchJson<{ rates?: Record<string, number> }>(
        `https://open.er-api.com/v6/latest/${from.toUpperCase()}`,
        { label: 'Währungs-API', retries: 2 }
      );
      const rate = data.rates?.[to.toUpperCase()];
      if (!rate) return err(`Kein Kurs für ${from}/${to}`);
      return ok({ amount, from: from.toUpperCase(), to: to.toUpperCase(), rate, converted: (amount * rate).toFixed(2) });
    } catch (e) { return err(`Währungsfehler: ${(e as Error).message}`); }
  }
);

toolRegistry.register(
  def('stock_analysis', 'Aktien-Analyse', 'Detaillierte Aktien-Analyse', 'finance',
    { ticker: { type: 'string', description: 'Ticker-Symbol' } },
    ['network']),
  async (args) => {
    // stock_price erwartet `ticker`; Argument-Namen der aufrufenden KI können
    // variieren – hier normalisieren, damit die Analyse nicht wegen fehlendem
    // Pflichtfeld fehlschlägt.
    const ticker = String((args as Record<string, unknown>).ticker ?? '').trim();
    if (!ticker) return err('Kein Ticker angegeben');
    const result = await toolRegistry.execute('stock_price', { ticker }, { origin: 'user', sessionId: '' });
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
    const { getPositions } = await import('../../db/portfolio');
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
    const { upsertPosition } = await import('../../db/portfolio');
    await upsertPosition({ ticker, quantity, avgPrice: avg_price, updatedAt: Date.now() });
    return ok({ updated: true, ticker, quantity, avgPrice: avg_price });
  }
);
