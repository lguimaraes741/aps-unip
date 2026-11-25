/**
 * Seed de DEMONSTRAÇÃO do AlertaCidade.
 *
 * - Recusa executar com APP_ENV=production.
 * - Idempotente: usuários são atualizados por e-mail; ocorrências de demonstração
 *   (is_demo = true) são removidas e recriadas a cada execução.
 * - Todas as ocorrências criadas aqui têm is_demo = true e são exibidas com o selo
 *   "Demonstração" nas interfaces — nunca como relatos reais.
 *
 * Uso: npm run db:seed   (na raiz do monorepositório)
 */
import { OccurrenceStatus, PrismaClient, Severity, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_USERS: { name: string; email: string; role: UserRole }[] = [
  { name: 'Administrador da Plataforma', email: 'admin@alertacidade.demo', role: 'ADMIN' },
  { name: 'Moderadora Demo', email: 'moderacao@alertacidade.demo', role: 'MODERATOR' },
  { name: 'Cidadã Demo A', email: 'cidada.a@alertacidade.demo', role: 'CITIZEN' },
  { name: 'Cidadão Demo B', email: 'cidadao.b@alertacidade.demo', role: 'CITIZEN' },
];

// Pontos reais de São Paulo historicamente sujeitos a alagamento, usados apenas como
// cenário de demonstração. Horários relativos ao momento da execução (sempre coerentes).
const DEMO_OCCURRENCES: {
  title: string;
  description: string;
  address: string;
  neighborhood: string;
  latitude: number;
  longitude: number;
  severity: Severity;
  status: OccurrenceStatus;
  hoursAgo: number;
}[] = [
  {
    title: 'Alagamento na Av. do Estado',
    description: 'Água cobrindo duas faixas próximas ao viaduto. Veículos baixos evitando o trecho.',
    address: 'Av. do Estado, próximo ao Viaduto Pedro de Toledo',
    neighborhood: 'Cambuci',
    latitude: -23.5662,
    longitude: -46.6205,
    severity: 'HIGH',
    status: 'VALIDATED',
    hoursAgo: 2,
  },
  {
    title: 'Ponto de alagamento na Pç. da Bandeira',
    description: 'Acúmulo de água na pista sentido centro após chuva forte. Trânsito lento.',
    address: 'Praça da Bandeira, Centro',
    neighborhood: 'Centro',
    latitude: -23.5492,
    longitude: -46.6386,
    severity: 'MODERATE',
    status: 'PENDING',
    hoursAgo: 1,
  },
  {
    title: 'Rua intransitável no Jardim Pantanal',
    description: 'Água acima do meio-fio entrando em residências. Moradores retirando pertences.',
    address: 'Rua Erva Imperial, Jardim Pantanal',
    neighborhood: 'Jardim Helena',
    latitude: -23.4969,
    longitude: -46.4335,
    severity: 'CRITICAL',
    status: 'UNDER_REVIEW',
    hoursAgo: 3,
  },
  {
    title: 'Poça extensa na Av. Pompeia',
    description: 'Lâmina de água próxima à faixa de pedestres, sem bloqueio da via.',
    address: 'Av. Pompeia, altura do nº 1200',
    neighborhood: 'Pompeia',
    latitude: -23.5317,
    longitude: -46.6834,
    severity: 'LOW',
    status: 'RESOLVED',
    hoursAgo: 20,
  },
  {
    title: 'Alagamento sob o viaduto na Marginal Tietê',
    description: 'Faixa da direita interditada pelo acúmulo de água sob o viaduto.',
    address: 'Marginal Tietê, próximo à Ponte das Bandeiras',
    neighborhood: 'Santana',
    latitude: -23.5187,
    longitude: -46.6293,
    severity: 'HIGH',
    status: 'PENDING',
    hoursAgo: 0.5,
  },
];

async function main(): Promise<void> {
  if (process.env.APP_ENV === 'production') {
    throw new Error('Seed de demonstração bloqueado em APP_ENV=production.');
  }
  const password = process.env.DEMO_USER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Defina DEMO_USER_PASSWORD (mínimo 8 caracteres) no .env.');
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const users: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash, status: 'ACTIVE', deletedAt: null },
      create: { ...u, passwordHash },
    });
    users[u.role === 'CITIZEN' ? u.email : u.role] = user.id;
    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, radiusMeters: 5000, minSeverity: 'MODERATE' },
    });
  }

  const reporters = [users['cidada.a@alertacidade.demo'], users['cidadao.b@alertacidade.demo']];
  const moderatorId = users.MODERATOR;

  await prisma.$transaction(async (tx) => {
    const old = await tx.occurrence.findMany({ where: { isDemo: true }, select: { id: true } });
    await tx.domainEvent.deleteMany({ where: { aggregateId: { in: old.map((o) => o.id) } } });
    await tx.occurrence.deleteMany({ where: { isDemo: true } });

    for (const [index, o] of DEMO_OCCURRENCES.entries()) {
      const { hoursAgo, ...data } = o;
      const occurredAt = new Date(Date.now() - hoursAgo * 3_600_000);
      const createdById = reporters[index % reporters.length];
      const moderated = o.status !== 'PENDING';
      const occurrence = await tx.occurrence.create({
        data: {
          ...data,
          occurredAt,
          createdAt: occurredAt,
          isDemo: true,
          createdById,
          moderatedById: moderated ? moderatorId : null,
          validatedAt: o.status === 'VALIDATED' || o.status === 'RESOLVED' ? occurredAt : null,
          resolvedAt: o.status === 'RESOLVED' ? new Date() : null,
        },
      });

      const history: { fromStatus: OccurrenceStatus | null; toStatus: OccurrenceStatus; actorId: string }[] = [
        { fromStatus: null, toStatus: 'PENDING', actorId: createdById },
      ];
      if (o.status === 'UNDER_REVIEW') history.push({ fromStatus: 'PENDING', toStatus: 'UNDER_REVIEW', actorId: moderatorId });
      if (o.status === 'VALIDATED' || o.status === 'RESOLVED')
        history.push({ fromStatus: 'PENDING', toStatus: 'VALIDATED', actorId: moderatorId });
      if (o.status === 'RESOLVED') history.push({ fromStatus: 'VALIDATED', toStatus: 'RESOLVED', actorId: moderatorId });
      await tx.occurrenceStatusHistory.createMany({
        data: history.map((h) => ({ ...h, occurrenceId: occurrence.id })),
      });

      // O outro cidadão confirma a ocorrência — contador mantido na mesma transação.
      const confirmer = reporters[(index + 1) % reporters.length];
      await tx.confirmation.create({ data: { occurrenceId: occurrence.id, userId: confirmer, type: 'CONFIRM' } });
      await tx.occurrence.update({ where: { id: occurrence.id }, data: { confirmCount: { increment: 1 } } });
    }
  });

  const total = await prisma.occurrence.count({ where: { isDemo: true } });
  console.log(`[seed] ${DEMO_USERS.length} usuários de demonstração e ${total} ocorrências (is_demo=true).`);
  console.log('[seed] Logins: ' + DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(', '));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
