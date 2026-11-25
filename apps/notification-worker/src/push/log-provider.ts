import { PushMessage, PushProvider, PushResult } from './push-provider';

/**
 * Provedor de desenvolvimento: registra no log o que SERIA enviado. Não entrega nada ao
 * aparelho; por isso as notificações ficam com push_status = SKIPPED (nunca SENT).
 * O token aparece truncado no log.
 */
export class LogPushProvider implements PushProvider {
  readonly name = 'log';
  readonly delivers = false;

  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  async send(message: PushMessage): Promise<PushResult> {
    this.log(`[push de desenvolvimento] token=${message.token.slice(0, 8)}… título="${message.title}" corpo="${message.body}"`);
    return { ok: true };
  }
}
