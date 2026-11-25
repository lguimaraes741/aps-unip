/** Mensagem de push já montada para um aparelho. */
export interface PushMessage {
  /** Identificador de envio do aparelho (Firebase Installation ID), guardado em device_tokens.token. */
  token: string;
  title: string;
  body: string;
  /** Dados para o app abrir a tela certa ao tocar (deep link para /occurrences/:id). */
  data: Record<string, string>;
}

export type PushResult =
  | { ok: true }
  /** Não adianta tentar de novo. removeToken: o token foi desinstalado/invalidado e deve sair do banco. */
  | { ok: false; permanent: true; removeToken: boolean; reason: string }
  /** Falha temporária (rede, cota, servidor): o BullMQ tenta de novo com backoff. */
  | { ok: false; permanent: false; reason: string };

export interface PushProvider {
  readonly name: 'fcm' | 'log' | string;
  /** true quando o envio realmente sai do servidor (FCM). O provedor de log não entrega nada. */
  readonly delivers: boolean;
  send(message: PushMessage): Promise<PushResult>;
}
