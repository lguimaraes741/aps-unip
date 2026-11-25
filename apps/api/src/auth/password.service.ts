import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Hash de senhas com Argon2id (recomendação OWASP). */
@Injectable()
export class PasswordService {
  // Hash fixo usado quando o e-mail não existe: o tempo de resposta do login
  // fica equivalente e não revela se a conta existe (evita enumeração de usuários).
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= this.hash('senha-ficticia-para-tempo-constante');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
