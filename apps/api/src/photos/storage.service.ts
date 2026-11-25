import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Armazenamento de arquivos em disco local (desenvolvimento/demonstração).
 * A interface (save/read/remove por chave) permite trocar por armazenamento de objetos
 * (S3, MinIO) sem alterar os serviços de domínio.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.getOrThrow<string>('STORAGE_DIR'));
  }

  async save(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  read(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Impede path traversal: a chave sempre resolve dentro da raiz. */
  private pathFor(key: string): string {
    if (!/^[a-z0-9/_-]+\.[a-z]+$/i.test(key)) throw new Error('Chave de armazenamento inválida');
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Chave de armazenamento inválida');
    return path;
  }
}
