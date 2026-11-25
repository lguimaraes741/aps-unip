import { readFileSync } from 'node:fs';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { PushMessage, PushProvider, PushResult } from './push-provider';

/**
 * O identificador do aparelho nunca mais vai funcionar: remover do banco.
 * `installation-id-not-registered` é o código da era do FID (firebase-admin 14, envio por `fid`);
 * os dois de token são mantidos para identificadores antigos. Confirmado em envio real (fase-4.md).
 */
const DEAD_DEVICE_CODES = new Set([
  'messaging/installation-id-not-registered',
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
/**
 * Erro na mensagem ou na configuração: repetir não resolve, mas o aparelho continua válido.
 * (Tratar isto como aparelho morto apagaria os identificadores de todos por um bug ou por
 * uma chave de outro projeto.)
 */
const PERMANENT_KEEP_DEVICE_CODES = new Set(['messaging/invalid-argument', 'messaging/invalid-payload', 'messaging/mismatched-credential']);

/** Classifica o erro do FCM (função pura, testada em fcm-provider.spec.ts). */
export function classifyFcmError(code: string, reason: string): Exclude<PushResult, { ok: true }> {
  if (DEAD_DEVICE_CODES.has(code)) return { ok: false, permanent: true, removeToken: true, reason };
  if (PERMANENT_KEEP_DEVICE_CODES.has(code)) return { ok: false, permanent: true, removeToken: false, reason };
  return { ok: false, permanent: false, reason };
}

/** Firebase Cloud Messaging (HTTP v1) via firebase-admin. */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  readonly delivers = true;
  private readonly messaging: Messaging;

  constructor(credentialsFile: string, appName = 'alertacidade-worker') {
    const serviceAccount = JSON.parse(readFileSync(credentialsFile, 'utf8'));
    const app: App = initializeApp({ credential: cert(serviceAccount) }, appName);
    this.messaging = getMessaging(app);
  }

  async send(message: PushMessage): Promise<PushResult> {
    try {
      await this.messaging.send({
        // firebase-admin 14: envio por Firebase Installation ID (o alvo `token` está obsoleto).
        // O app (firebase_messaging 17) registra o FID em PUT /devices.
        fid: message.token,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: {
          priority: 'high',
          // Canal criado pelo app (MainActivity). Sem clickAction: o firebase_messaging abre o
          // app pela intent padrão; um clickAction sem intent-filter correspondente faria o toque não abrir nada.
          notification: { channelId: 'alertas' },
        },
      });
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'desconhecido';
      const reason = `${code}: ${(error as Error).message}`.slice(0, 500);
      return classifyFcmError(code, reason);
    }
  }
}
