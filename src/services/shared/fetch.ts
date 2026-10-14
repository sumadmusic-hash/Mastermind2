/**
 * Safe fetch with timeout and error handling
 */
export async function safeFetch(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * HTTP-Statuscodes, bei denen sich ein erneuter Versuch lohnen kann:
 * Raten-Drosselung (429), Blockaden (403), Timeouts (408) sowie
 * Server-/Gateway-Fehler (5xx).
 */
const RETRYABLE_STATUS = new Set([403, 408, 429, 500, 502, 503, 504]);

/**
 * Wartezeit vor dem nächsten Versuch: exponentiell mit etwas Jitter.
 * Bei Retryable-Responses wird der `Retry-After`-Header (Sekunden oder
 * HTTP-Datum) bevorzugt, damit die Drosselung des Servers respektiert wird.
 */
function retryDelayMs(response: Response | null, attempt: number): number {
  const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
  const header = response?.headers.get('retry-after');
  if (!header) return backoff;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 10000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), 10000);
  return backoff;
}

/**
 * Antworttext holen (für Fehlermeldungen) – begrenzt, damit keine riesigen
 * HTML-Fehlerseiten in Logs/Agent-Kontext landen. `response.clone()` erlaubt
 * das mehrfache Lesen des Bodys.
 */
async function snippetOf(response: Response, limit = 160): Promise<string> {
  try {
    const text = (await response.clone().text()).replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return '';
  }
}

/**
 * JSON-Antwort robust lesen.
 *
 * Manche APIs (z. B. die Yahoo-Chart-API) liefern bei Raten-Drosselung oder
 * Blockierung eine HTML-Fehlerseite zurück – teils sogar mit Status 200 und
 * `content-type: text/html`. Ein direktes `res.json()` wirft dann die
 * kryptische SyntaxError `Unexpected token '<', "<!doctype "… is not valid JSON`.
 * Diese Funktion prüft deshalb zuerst den Content-Typ bzw. den Textanfang und
 * wirft eine aussagekräftige, deutschsprachige Fehlermeldung.
 */
export async function parseJsonResponse(
  response: Response,
  sourceLabel = 'API'
): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  const looksLikeHtmlBody = /<(!doctype|html|\?xml)/i.test(await snippetOf(response, 40));

  if (!/json|text\/plain|\*\/\*/i.test(contentType) || looksLikeHtmlBody) {
    const body = await snippetOf(response);
    throw new Error(
      `${sourceLabel}: Server lieferte ${looksLikeHtmlBody ? 'HTML' : 'kein JSON'} statt JSON ` +
      `(HTTP ${response.status}, Content-Type: ${contentType || 'unbekannt'})` +
      (body ? `: "${body}"` : '') +
      '. Meist eine Raten-Begrenzung oder Wartungsseite des Dienstes.'
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const body = await snippetOf(response);
    throw new Error(`${sourceLabel}: Ungültige JSON-Antwort (HTTP ${response.status}): ${body || 'leere Antwort'}`);
  }
  if (payload === null || payload === undefined) {
    throw new Error(`${sourceLabel}: Leere/ungültige JSON-Antwort (HTTP ${response.status})`);
  }
  return payload;
}

/**
 * JSON-Ressource abrufen: transient Fehler (429/403/5xx, Netzwerkfehler/Timeout,
 * HTML-statt-JSON) werden automatisch mit Backoff wiederholt.
 *
 * Gibt am Ende eine gültige JSON-Dekodierung zurück oder wirft einen Fehler
 * mit verständlicher Meldung (nie eine rohe SyntaxError).
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit & { timeout?: number; retries?: number; label?: string } = {}
): Promise<T> {
  const { retries = 2, timeout, label = 'API', ...fetchOptions } = options;
  let lastError = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response | null = null;
    try {
      response = await safeFetch(url, { ...fetchOptions, timeout });

      if (response.ok) {
        try {
          return (await parseJsonResponse(response, label)) as T;
        } catch (e) {
          lastError = (e as Error).message;
          // HTML-statt-JSON ist meist ein Drosselungs-Symptom -> erneut versuchen
        }
      } else {
        const body = await snippetOf(response);
        lastError = `${label}: HTTP ${response.status}${body ? ` – ${body}` : ''}`;
        if (!RETRYABLE_STATUS.has(response.status)) break;
      }
    } catch (err) {
      // Netzwerkfehler / Timeout (AbortError) sind stets retrywürdig
      lastError = (err as Error)?.message || String(err);
    }

    if (attempt < retries) {
      await new Promise(r => setTimeout(r, retryDelayMs(response, attempt)));
    }
  }

  throw new Error(lastError || `Abruf fehlgeschlagen nach ${retries + 1} Versuchen: ${url}`);
}
