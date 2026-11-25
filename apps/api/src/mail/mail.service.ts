import { Injectable, Logger } from '@nestjs/common';

export interface SentMail {
  to: string;
  subject: string;
  text: string;
  sentAt: Date;
}

/**
 * Envio de e-mails.
 * Nesta versão acadêmica NÃO há provedor SMTP configurado: as mensagens ficam numa
 * caixa em memória (consultada pelos testes) e, fora de produção, o conteúdo é
 * registrado no log do servidor para permitir a demonstração da recuperação de senha.
 * Para produção, substituir por um provedor real (SMTP/serviço transacional).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly outbox: SentMail[] = [];

  async send(to: string, subject: string, text: string): Promise<void> {
    this.outbox.push({ to, subject, text, sentAt: new Date() });
    if (this.outbox.length > 100) this.outbox.shift();
    if (process.env.APP_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      this.logger.log(`[e-mail de desenvolvimento] para=${to} assunto="${subject}"\n${text}`);
    }
  }

  /** Último e-mail enviado ao destinatário (uso em testes e demonstração). */
  lastTo(to: string): SentMail | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}
