import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'Senha@Teste1';
/** Praça da Sé, São Paulo. */
export const SE = { lat: -23.55052, lng: -46.63331 };

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
}

export async function registerUser(app: INestApplication, label = 'user'): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ name: `Teste ${label}`, email, password: PASSWORD, acceptTerms: true })
    .expect(201);
  return { id: res.body.user.id, email, token: res.body.accessToken, refreshToken: res.body.refreshToken };
}

/** Cria usuário com perfil privilegiado (o papel vai no JWT, por isso faz login de novo). */
export async function registerWithRole(app: INestApplication, role: UserRole): Promise<TestUser> {
  const user = await registerUser(app, role.toLowerCase());
  await app.get(PrismaService).user.update({ where: { id: user.id }, data: { role } });
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: PASSWORD })
    .expect(200);
  return { ...user, token: res.body.accessToken, refreshToken: res.body.refreshToken };
}

export function occurrencePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Alagamento de teste',
    description: 'Água cobrindo a pista, teste automatizado.',
    address: 'Rua de Teste, 100',
    neighborhood: 'Sé',
    latitude: SE.lat,
    longitude: SE.lng,
    severity: 'HIGH',
    occurredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...overrides,
  };
}

export async function createOccurrence(app: INestApplication, user: TestUser, overrides: Record<string, unknown> = {}) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/occurrences')
    .set('Authorization', `Bearer ${user.token}`)
    .send(occurrencePayload(overrides))
    .expect(201);
  return res.body as { id: string; code: number; status: string; [k: string]: unknown };
}

/** JPEG real com EXIF contendo coordenadas GPS (para provar que são removidas). */
export async function jpegWithGps(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 180 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'CelularDeTeste', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } })
    .toBuffer();
}

export const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });
