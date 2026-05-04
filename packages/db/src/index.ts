// Re-export the Prisma client so services depend on a single import path.
import { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient | undefined;
export function getDb(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return _prisma;
}
export type { PrismaClient } from '@prisma/client';
