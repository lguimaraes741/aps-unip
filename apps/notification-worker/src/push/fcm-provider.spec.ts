import { classifyFcmError } from './fcm-provider';

describe('classificação dos erros do FCM', () => {
  it('aparelho não registrado (FID e tokens antigos) → remover o identificador', () => {
    for (const code of [
      'messaging/installation-id-not-registered', // resposta real do FCM a um FID inexistente
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ]) {
      expect(classifyFcmError(code, 'x')).toEqual({ ok: false, permanent: true, removeToken: true, reason: 'x' });
    }
  });

  it('erro na mensagem ou credencial de outro projeto → falha sem apagar o identificador', () => {
    for (const code of ['messaging/invalid-argument', 'messaging/invalid-payload', 'messaging/mismatched-credential']) {
      expect(classifyFcmError(code, 'x')).toMatchObject({ permanent: true, removeToken: false });
    }
  });

  it('demais erros (indisponível, cota, rede) → temporário, o BullMQ repete', () => {
    for (const code of ['messaging/unavailable', 'messaging/internal-error', 'messaging/quota-exceeded', 'desconhecido']) {
      expect(classifyFcmError(code, 'x')).toEqual({ ok: false, permanent: false, reason: 'x' });
    }
  });
});
