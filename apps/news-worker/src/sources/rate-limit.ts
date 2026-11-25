/**
 * Intervalo mínimo entre requisições ao MESMO host, dentro do processo.
 * Entre processos, a coleta de cada fonte é serializada pela fila (jobId por fonte, Etapa 4),
 * e o backoff por fonte fica no banco (news_sources.next_attempt_at).
 */
export class HostRateLimiter {
  private readonly next = new Map<string, number>();

  constructor(private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  /** Espera a vez do host e reserva o próximo horário. Retorna quanto esperou (ms). */
  async wait(url: string, minIntervalMs: number, now: () => number = Date.now): Promise<number> {
    const host = new URL(url).host;
    const t = now();
    const at = Math.max(t, this.next.get(host) ?? 0);
    this.next.set(host, at + minIntervalMs);
    const delay = at - t;
    if (delay > 0) await this.sleep(delay);
    return delay;
  }

  /** A fonte pediu para esperar (Retry-After): ninguém fala com esse host antes disso. */
  defer(url: string, untilMs: number): void {
    const host = new URL(url).host;
    this.next.set(host, Math.max(this.next.get(host) ?? 0, untilMs));
  }
}
