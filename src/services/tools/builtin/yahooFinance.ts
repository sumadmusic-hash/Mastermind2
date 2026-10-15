import { fetchJson } from '../../shared/fetch';

/**
 * Gemeinsamer Zugriff auf die Yahoo-Chart-API.
 *
 * Yahoo liefert je nach Edge/Region unterschiedliche Fehlerbilder:
 * 429 "Too Many Requests" ohne Browser-User-Agent, teils HTML-Fehlerseiten
 * (auch mit Status 200) und vereinzelt JSON mit Error-Feld im Body.
 * Deshalb: mehrere Hosts der Chart-API durchprobieren + Retry mit Backoff.
 */
const YAHOO_CHART_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface YahooChartMeta {
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
}
export interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
      timestamp?: (number | null)[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }>; adjclose?: Array<{ adjclose?: (number | null)[] }> };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

export function toNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Letzten nicht-leeren Wert einer Zeitreihe holen */
export function lastValue(series: (number | null)[] | undefined): number | null {
  if (!series || series.length === 0) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    const n = toNumberOrNull(series[i]);
    if (n !== null) return n;
  }
  return null;
}

export function formatDate(ts: number | null | undefined): string | undefined {
  if (!ts) return undefined;
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

export async function fetchYahooChart(ticker: string): Promise<YahooChartResponse> {
  let lastError = '';
  for (const host of YAHOO_CHART_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;
    try {
      // fetchJson: wiederholt bei 429/403/5xx/Netzwerkfehler und wandelt
      // HTML-statt-JSON in eine verständliche Meldung um (kein rohes
      // "Unexpected token '<' …is not valid JSON")
      return await fetchJson<YahooChartResponse>(url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
        label: 'Yahoo Finance',
        retries: 2,
        timeout: 12000,
      });
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(lastError || 'Yahoo Finance nicht erreichbar');
}
