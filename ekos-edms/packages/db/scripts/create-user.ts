// Kullanım: DATABASE_URL=... EKOS_EMAIL=... EKOS_DISPLAY_NAME=... EKOS_ROLE=RECORDS_MANAGER EKOS_PASSWORD=... npx tsx scripts/create-user.ts
import { hash, verify } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { createLocalUser } from "../src/seed/create-user.js";

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Eksik ortam değişkeni: ${k}`);
  return v;
};
const list = (k: string): string[] => (process.env[k] ?? "").split(",").map((x) => x.trim()).filter((x) => x.length > 0);
const prisma = new PrismaClient();
try {
  const res = await createLocalUser(
    prisma,
    { hash: (p) => hash(p), verify: (h, p) => verify(h, p) },
    {
      email: env("EKOS_EMAIL"),
      displayName: env("EKOS_DISPLAY_NAME"),
      roleCode: env("EKOS_ROLE"),
      password: env("EKOS_PASSWORD"),
      // Virgülle ayrılmış UUID listeleri. Hiçbiri yoksa ve kurum geneli onay yoksa kullanıcı oluşturulmaz.
      scope: {
        departmentIds: list("EKOS_DEPARTMENT_IDS"),
        documentTypeIds: list("EKOS_DOCUMENT_TYPE_IDS"),
        counterpartyIds: list("EKOS_COUNTERPARTY_IDS"),
        projectIds: list("EKOS_PROJECT_IDS"),
      },
      organizationWide: process.env.EKOS_ORGANIZATION_WIDE === "yes",
    },
  );
  process.stdout.write(`Kullanıcı oluşturuldu: ${res.userId}\n`);
} finally {
  await prisma.$disconnect();
}
