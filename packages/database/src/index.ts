import { PrismaClient } from '@prisma/client';
export { Prisma, PrismaClient } from '@prisma/client';
export * from '@prisma/client';
export const db = new PrismaClient();
