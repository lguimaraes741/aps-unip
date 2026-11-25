import { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { auth, createOccurrence, createTestApp, jpegWithGps, registerUser, TestUser } from './helpers';

describe('Upload de fotos (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let author: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    author = await registerUser(app, 'foto-autor');
    other = await registerUser(app, 'foto-outro');
  });
  afterAll(() => app.close());

  const upload = (u: TestUser, occurrenceId: string, data: Buffer, filename = 'foto.jpg') =>
    request(http).post(`/api/v1/occurrences/${occurrenceId}/photos`).set(auth(u)).attach('photo', data, filename);

  it('aceita JPEG, remove metadados EXIF/GPS e serve o arquivo', async () => {
    const original = await jpegWithGps();
    expect((await sharp(original).metadata()).exif).toBeDefined(); // pré-condição: original tem EXIF

    const o = await createOccurrence(app, author);
    const res = await upload(author, o.id, original).expect(201);
    expect(res.body).toMatchObject({ width: 64, height: 48, position: 0 });

    const file = await request(http).get(res.body.url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect((file.body as Buffer).includes(Buffer.from('CelularDeTeste'))).toBe(false);

    const detail = await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(other)).expect(200);
    expect(detail.body.photos).toHaveLength(1);
    const list = await request(http).get('/api/v1/occurrences/mine').set(auth(author)).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === o.id).coverPhotoUrl).toBe(res.body.url);
  });

  it('reduz imagens grandes para no máximo 1920 px', async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#888' } }).png().toBuffer();
    const o = await createOccurrence(app, author);
    const res = await upload(author, o.id, big, 'grande.png').expect(201);
    expect(res.body).toMatchObject({ width: 1920, height: 960 });
  });

  it('rejeita arquivo disfarçado de imagem (assinatura binária)', async () => {
    const o = await createOccurrence(app, author);
    await upload(author, o.id, Buffer.from('<?php system($_GET["c"]); ?>'), 'foto.jpg').expect(415);
  });

  it('rejeita arquivo acima de 10 MB', async () => {
    const o = await createOccurrence(app, author);
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    await upload(author, o.id, huge).expect(413);
  });

  it('somente o autor envia fotos e o limite é de 5 por ocorrência', async () => {
    const o = await createOccurrence(app, author);
    const img = await jpegWithGps();
    await upload(other, o.id, img).expect(403);
    for (let i = 0; i < 5; i++) await upload(author, o.id, img).expect(201);
    await upload(author, o.id, img).expect(422);
  });

  it('envios simultâneos respeitam o limite de 5 fotos', async () => {
    const o = await createOccurrence(app, author);
    const img = await jpegWithGps();
    const results = await Promise.all(Array.from({ length: 8 }, () => upload(author, o.id, img)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 422)).toHaveLength(3);
  });

  it('autor remove a foto; outro cidadão não', async () => {
    const o = await createOccurrence(app, author);
    const photo = await upload(author, o.id, await jpegWithGps()).expect(201);
    await request(http).delete(`/api/v1/photos/${photo.body.id}`).set(auth(other)).expect(403);
    await request(http).delete(`/api/v1/photos/${photo.body.id}`).set(auth(author)).expect(204);
    await request(http).get(photo.body.url).expect(404);
  });
});
