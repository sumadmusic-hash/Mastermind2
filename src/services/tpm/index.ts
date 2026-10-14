/**
 * Token-per-Minute Budget Manager
 * Reservierungssystem für parallele Requests.
 *
 * KUMULATIV: Das Budget wird über ein rollierendes 60-Sekunden-Fenster
 * berechnet, nicht über einen harten Reset jede Minute. Vorher wurde `used`
 * simply alle 60s auf 0 gesetzt – damit waren kurz hintereinander zwei volle
 * Minuten-Budgets verbrauchbar (Burst von bis zu 2x limit innerhalb ~1 Min),
 * was echten TPM-Limits (z.B. Groq) widerspricht und zu 429-Fehlern führt.
 *
 * Modell:
 * - Jeder Verbrauch (Reservierung + tatsächliche Completion-Tokens) landet als
 *   Eintrag mit Zeitstempel im Fenster.
 * - getUsed() = Summe aller Einträge in den letzten 60 Sekunden.
 * - Ausstehende Reservierungen werden beim Release auf den tatsächlichen
 *   Verbrauch umgebucht (Differenz korrigiert).
 */

interface Reservation {
  id: string;
  tokens: number;
  timestamp: number;
  entry: UsageEntry; // der bei doReserve gebuchte Fenstereintrag
}

interface UsageEntry {
  tokens: number;
  timestamp: number; // Eintrag verfällt, wenn er älter als WINDOW_MS ist
}

const WINDOW_MS = 60_000;

class TPMManager {
  private limit: number;
  private entries: UsageEntry[] = []; // chronologisch aufsteigend
  private reservations: Map<string, Reservation> = new Map();
  private queue: Array<{ resolve: () => void; tokens: number }> = [];

  constructor(limit = 60000) {
    this.limit = limit;
    // Queue regelmäßig prüfen, sobald alte Einträge aus dem Fenster fallen
    setInterval(() => this.processQueue(), 5000);
  }

  setLimit(limit: number): void {
    this.limit = limit;
    this.processQueue();
  }

  /** Entfernt Einträge, die außerhalb des rollierenden Fensters liegen. */
  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    let i = 0;
    while (i < this.entries.length && this.entries[i].timestamp <= cutoff) i++;
    if (i > 0) this.entries.splice(0, i);
  }

  /** Kumulativ verbrauchte Tokens innerhalb der letzten 60 Sekunden. */
  getUsed(): number {
    this.prune(Date.now());
    return this.entries.reduce((s, e) => s + e.tokens, 0);
  }

  getAvailable(): number {
    return Math.max(0, this.limit - this.getUsed());
  }

  getLimit(): number {
    return this.limit;
  }

  async reserve(tokens: number): Promise<string> {
    if (tokens <= this.getAvailable()) {
      return this.doReserve(tokens);
    }

    // Queue the request
    return new Promise<string>((resolve) => {
      const reservationPromise = new Promise<void>((res) => {
        this.queue.push({ resolve: res, tokens });
      });
      reservationPromise.then(() => {
        resolve(this.doReserve(tokens));
      });
    });
  }

  private doReserve(tokens: number): string {
    const id = `res_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const entry: UsageEntry = { tokens, timestamp: Date.now() };
    this.entries.push(entry);
    this.reservations.set(id, { id, tokens, timestamp: Date.now(), entry });
    return id;
  }

  release(reservationId: string): void {
    this.releaseWithActual(reservationId);
  }

  /**
   * Gibt eine Reservierung frei. Optional kann der tatsächliche Verbrauch
   * angegeben werden; die Differenz zur Reservierung wird kumulativ korrekt
   * gebucht (die Reservierung war nur eine Schätzung).
   */
  releaseWithActual(reservationId: string, actualTokens?: number): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    this.reservations.delete(reservationId);
    if (actualTokens !== undefined && actualTokens !== reservation.tokens) {
      reservation.entry.tokens = Math.max(0, actualTokens);
      reservation.entry.timestamp = Date.now(); // zählt ab jetzt volle 60s
    }
    this.processQueue();
  }

  record(tokens: number): void {
    this.entries.push({ tokens, timestamp: Date.now() });
    this.processQueue();
  }

  private processQueue(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next.tokens <= this.getAvailable()) {
        this.queue.shift();
        next.resolve();
      } else {
        break;
      }
    }
  }

  /** Nur für Tests: Zustand komplett zurücksetzen. */
  __resetForTests(): void {
    this.entries = [];
    this.reservations.clear();
    this.queue = [];
  }
}

export const tpmManager = new TPMManager();
