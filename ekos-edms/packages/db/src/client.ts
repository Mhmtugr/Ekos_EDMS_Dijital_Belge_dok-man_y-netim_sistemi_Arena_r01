// Prisma istemci fabrikası. Bağlantı dizesi çağıran tarafından verilir (DATABASE_URL); sabit değer yoktur.
import { PrismaClient } from "@prisma/client";

export function createPrisma(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

export { PrismaClient, Prisma } from "@prisma/client";
export type { PrismaClient as PrismaClientType } from "@prisma/client";
