// Kullanım: DATABASE_URL=... npx tsx scripts/seed.ts
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { seedCatalog } from "../src/seed/catalog-seed.js";

const prisma = new PrismaClient();
const retentionFile = fileURLToPath(new URL("../seed-data/retention-profiles.json", import.meta.url));
try {
  process.stdout.write(`${JSON.stringify(await seedCatalog(prisma, retentionFile))}\n`);
} finally {
  await prisma.$disconnect();
}
