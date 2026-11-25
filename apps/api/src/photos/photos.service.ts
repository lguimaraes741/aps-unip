import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { OccurrenceStatus } from '@prisma/client';
import { RealtimeEvent } from '@alertacidade/shared-types';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AuthUser, isPrivileged } from '../common/auth/auth-user';
import { OutboxService } from '../events/outbox.service';
import { photoUrl } from '../occurrences/occurrence-view';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageType } from './image-signature';
import { StorageService } from './storage.service';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_OCCURRENCE = 5;
const MAX_DIMENSION = 1920;

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
  ) {}

  async upload(user: AuthUser, occurrenceId: string, file: Express.Multer.File | undefined) {
    if (!file || file.size === 0) throw new UnprocessableEntityException('Envie a imagem no campo "photo"');
    if (!detectImageType(file.buffer)) {
      throw new UnsupportedMediaTypeException('Formato não suportado. Envie JPEG, PNG ou WebP.');
    }

    // Recodifica a imagem: aplica a orientação, limita o tamanho e DESCARTA todos os
    // metadados (EXIF com coordenadas GPS, modelo do aparelho etc.) — proteção LGPD.
    let processed: { data: Buffer; info: { width: number; height: number } };
    try {
      processed = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new UnprocessableEntityException('Não foi possível processar a imagem (arquivo corrompido?)');
    }

    const storageKey = `occurrences/${occurrenceId}/${randomUUID()}.jpg`;
    await this.storage.save(storageKey, processed.data);

    try {
      const photo = await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ created_by_id: string; status: OccurrenceStatus }[]>`
          SELECT created_by_id, status::text AS status FROM occurrences
          WHERE id = ${occurrenceId}::uuid AND deleted_at IS NULL
          FOR UPDATE`;
        if (!locked) throw new NotFoundException('Ocorrência não encontrada');
        if (locked.created_by_id !== user.id) throw new ForbiddenException('Somente o autor pode enviar fotos');
        if (locked.status === 'REJECTED' || locked.status === 'RESOLVED') {
          throw new UnprocessableEntityException('Esta ocorrência não aceita novas fotos');
        }
        const count = await tx.occurrencePhoto.count({ where: { occurrenceId } });
        if (count >= MAX_PHOTOS_PER_OCCURRENCE) {
          throw new UnprocessableEntityException(`Limite de ${MAX_PHOTOS_PER_OCCURRENCE} fotos por ocorrência`);
        }
        const created = await tx.occurrencePhoto.create({
          data: {
            occurrenceId,
            uploadedById: user.id,
            storageKey,
            mimeType: 'image/jpeg',
            sizeBytes: processed.data.length,
            width: processed.info.width,
            height: processed.info.height,
            position: count,
          },
        });
        const occurrence = await tx.occurrence.findUniqueOrThrow({ where: { id: occurrenceId } });
        await this.outbox.recordOccurrenceEvent(tx, RealtimeEvent.OCCURRENCE_UPDATED, occurrence);
        return created;
      });
      return { id: photo.id, url: photoUrl(photo.id), width: photo.width, height: photo.height, position: photo.position };
    } catch (error) {
      // Compensação: o arquivo não pode ficar órfão se a transação falhar.
      await this.storage.remove(storageKey).catch((e) => this.logger.warn(`Falha ao remover arquivo órfão: ${e}`));
      throw error;
    }
  }

  async open(photoId: string) {
    const photo = await this.prisma.occurrencePhoto.findFirst({
      where: { id: photoId, occurrence: { deletedAt: null } },
    });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    return { stream: this.storage.read(photo.storageKey), mimeType: photo.mimeType, size: photo.sizeBytes };
  }

  async remove(user: AuthUser, photoId: string): Promise<void> {
    const photo = await this.prisma.occurrencePhoto.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    if (photo.uploadedById !== user.id && !isPrivileged(user)) {
      throw new ForbiddenException('Somente o autor ou a moderação podem remover a foto');
    }
    await this.prisma.occurrencePhoto.delete({ where: { id: photoId } });
    await this.storage.remove(photo.storageKey);
  }
}
