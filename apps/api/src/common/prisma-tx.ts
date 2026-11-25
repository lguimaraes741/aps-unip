import { Prisma, PrismaClient } from '@prisma/client';

/** Cliente transacional ou o PrismaService — permite que serviços participem da transação do chamador. */
export type Db = Prisma.TransactionClient | PrismaClient;
