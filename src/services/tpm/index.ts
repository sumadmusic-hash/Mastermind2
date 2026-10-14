/**
 * Token-per-Minute Budget Manager
 * Reservierungssystem für parallele Requests
 */

interface Reservation {
  id: string;
  tokens: number;
  timestamp: number;
}

class TPMManager {
  private limit: number;
  private used: number = 0;
  private reservations: Map<string, Reservation> = new Map();
  private queue: Array<{ resolve: () => void; tokens: number }> = [];

  constructor(limit = 60000) {
    this.limit = limit;
    // Reset every minute
    setInterval(() => this.reset(), 60000);
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  getAvailable(): number {
    return Math.max(0, this.limit - this.used);
  }

  getUsed(): number {
    return this.used;
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
    this.used += tokens;
    this.reservations.set(id, { id, tokens, timestamp: Date.now() });
    return id;
  }

  release(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (reservation) {
      this.used -= reservation.tokens;
      this.reservations.delete(reservationId);
      this.processQueue();
    }
  }

  record(tokens: number): void {
    this.used += tokens;
    this.processQueue();
  }

  private reset(): void {
    this.used = 0;
    this.reservations.clear();
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
}

export const tpmManager = new TPMManager();
