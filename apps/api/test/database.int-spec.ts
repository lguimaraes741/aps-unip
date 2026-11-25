/**
 * Testes de integração do modelo de dados contra PostgreSQL/PostGIS real.
 * Cobrem: geolocalização, consulta por raio, confirmações concorrentes,
 * idempotência de criação e o cursor de sincronização (outbox).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

// Praça da Sé (marco zero de São Paulo) como ponto de referência.
const SE = { latitude: -23.55052, longitude: -46.63331 };

let citizenId: string;
let otherCitizens: string[] = [];

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: { name: `Teste ${label}`, email: `${label}-${randomUUID()}@test.local`, passwordHash: 'hash-de-teste' },
  });
  return user.id;
}

function occurrenceData(overrides: Partial<Prisma.OccurrenceUncheckedCreateInput> = {}): Prisma.OccurrenceUncheckedCreateInput {
  return {
    title: 'Alagamento de teste',
    description: 'Descrição de teste com tamanho suficiente.',
    address: 'Endereço de teste',
    latitude: SE.latitude,
    longitude: SE.longitude,
    severity: 'HIGH',
    occurredAt: new Date(),
    createdById: citizenId,
    ...overrides,
  };
}

beforeAll(async () => {
  citizenId = await createUser('autor');
  otherCitizens = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser(`confirmador${i}`)));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Geolocalização (PostGIS)', () => {
  it('preenche a coluna geography a partir de latitude/longitude via trigger', async () => {
    const o = await prisma.occurrence.create({ data: occurrenceData() });
    const [row] = await prisma.$queryRaw<{ lat: number; lng: number; srid: number }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, ST_SRID(location::geometry) AS srid
      FROM occurrences WHERE id = ${o.id}::uuid`;
    expect(row.lat).toBeCloseTo(SE.latitude, 6);
    expect(row.lng).toBeCloseTo(SE.longitude, 6);
    expect(row.srid).toBe(4326);
  });

  it('atualiza a geografia quando as coordenadas mudam', async () => {
    const o = await prisma.occurrence.create({ data: occurrenceData() });
    await prisma.occurrence.update({ where: { id: o.id }, data: { latitude: -23.5, longitude: -46.6 } });
    const [row] = await prisma.$queryRaw<{ lat: number }[]>`
      SELECT ST_Y(location::geometry) AS lat FROM occurrences WHERE id = ${o.id}::uuid`;
    expect(row.lat).toBeCloseTo(-23.5, 6);
  });

  it('rejeita coordenadas fora do intervalo válido (CHECK constraint)', async () => {
    await expect(prisma.occurrence.create({ data: occurrenceData({ latitude: 123 }) })).rejects.toThrow(
      /occurrences_latitude_range/,
    );
  });

  it('lista ocorrências dentro de um raio, ordenadas por distância', async () => {
    const tag = randomUUID().slice(0, 8);
    // ~0 m, ~1,1 km ao norte, ~5,5 km ao norte
    const near = await prisma.occurrence.create({ data: occurrenceData({ title: `Perto ${tag}` }) });
    const mid = await prisma.occurrence.create({
      data: occurrenceData({ title: `Médio ${tag}`, latitude: SE.latitude + 0.01 }),
    });
    await prisma.occurrence.create({ data: occurrenceData({ title: `Longe ${tag}`, latitude: SE.latitude + 0.05 }) });

    const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, ST_Distance(location, ST_SetSRID(ST_MakePoint(${SE.longitude}, ${SE.latitude}), 4326)::geography) AS distance
      FROM occurrences
      WHERE title LIKE ${'%' + tag}
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${SE.longitude}, ${SE.latitude}), 4326)::geography, ${2000})
      ORDER BY distance ASC`;

    expect(rows.map((r) => r.id)).toEqual([near.id, mid.id]);
    expect(rows[1].distance).toBeGreaterThan(1000);
    expect(rows[1].distance).toBeLessThan(1200);
  });

  it('usa o índice GIST na consulta por raio', async () => {
    // Com poucas linhas o planejador prefere seq scan; desligá-lo (só nesta transação)
    // prova que o índice existe e é utilizável pela consulta por raio.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT id FROM occurrences
        WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${SE.longitude}, ${SE.latitude}), 4326)::geography, 2000)`;
    });
    expect(plan.map((p) => p['QUERY PLAN']).join('\n')).toMatch(/occurrences_location_idx/);
  });
});

describe('Confirmações concorrentes', () => {
  it('mantém uma única manifestação por usuário mesmo com requisições simultâneas', async () => {
    const o = await prisma.occurrence.create({ data: occurrenceData() });
    const voter = otherCitizens[0];

    // 20 requisições paralelas do mesmo usuário alternando confirmar/contestar.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        prisma.$executeRaw`
          INSERT INTO confirmations (id, occurrence_id, user_id, type, updated_at)
          VALUES (gen_random_uuid(), ${o.id}::uuid, ${voter}::uuid,
                  ${i % 2 === 0 ? 'CONFIRM' : 'CONTEST'}::confirmation_type, now())
          ON CONFLICT (occurrence_id, user_id) DO UPDATE SET type = EXCLUDED.type, updated_at = now()`,
      ),
    );

    expect(await prisma.confirmation.count({ where: { occurrenceId: o.id } })).toBe(1);
  });

  it('a constraint UNIQUE bloqueia inserção duplicada direta', async () => {
    const o = await prisma.occurrence.create({ data: occurrenceData() });
    const data = { occurrenceId: o.id, userId: otherCitizens[1], type: 'CONFIRM' as const };
    await prisma.confirmation.create({ data });
    await expect(prisma.confirmation.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('contadores permanecem corretos com confirmações paralelas de usuários distintos', async () => {
    const o = await prisma.occurrence.create({ data: occurrenceData() });
    await Promise.all(
      otherCitizens.map((userId) =>
        prisma.$transaction([
          prisma.confirmation.create({ data: { occurrenceId: o.id, userId, type: 'CONFIRM' } }),
          prisma.occurrence.update({ where: { id: o.id }, data: { confirmCount: { increment: 1 } } }),
        ]),
      ),
    );
    const updated = await prisma.occurrence.findUniqueOrThrow({ where: { id: o.id } });
    expect(updated.confirmCount).toBe(otherCitizens.length);
    expect(await prisma.confirmation.count({ where: { occurrenceId: o.id } })).toBe(otherCitizens.length);
  });
});

describe('Idempotência e sincronização', () => {
  it('o mesmo clientRequestId do mesmo usuário não cria duas ocorrências', async () => {
    const clientRequestId = randomUUID();
    await prisma.occurrence.create({ data: occurrenceData({ clientRequestId }) });
    await expect(prisma.occurrence.create({ data: occurrenceData({ clientRequestId }) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('a notificação de um mesmo evento não é duplicada para o mesmo usuário', async () => {
    const sourceEventId = randomUUID();
    const data = { userId: citizenId, sourceEventId, type: 'OCCURRENCE_NEARBY' as const, title: 't', body: 'b' };
    await prisma.notification.create({ data });
    await expect(prisma.notification.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('a sequência do outbox é monotônica (cursor de sincronização)', async () => {
    const aggregateId = randomUUID();
    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push(
        await prisma.domainEvent.create({
          data: { type: 'occurrence.created', aggregateType: 'occurrence', aggregateId, payload: { i } },
        }),
      );
    }
    expect(created[0].sequence < created[1].sequence).toBe(true);
    expect(created[1].sequence < created[2].sequence).toBe(true);

    const since = await prisma.domainEvent.findMany({
      where: { aggregateId, sequence: { gt: created[0].sequence } },
      orderBy: { sequence: 'asc' },
    });
    expect(since.map((e) => e.id)).toEqual([created[1].id, created[2].id]);
  });

  it('status RESOLVED exige resolved_at preenchido', async () => {
    await expect(
      prisma.occurrence.create({ data: occurrenceData({ status: 'RESOLVED', resolvedAt: null }) }),
    ).rejects.toThrow(/occurrences_resolved_consistency/);
  });

  it('e-mail é único sem diferenciar maiúsculas/minúsculas (citext)', async () => {
    const email = `Caso-${randomUUID()}@Test.Local`;
    await prisma.user.create({ data: { name: 'Caso A', email, passwordHash: 'x' } });
    await expect(
      prisma.user.create({ data: { name: 'Caso B', email: email.toLowerCase(), passwordHash: 'x' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
