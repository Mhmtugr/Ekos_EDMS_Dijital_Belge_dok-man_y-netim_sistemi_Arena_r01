// TOTP kurtarma (yalnızca sunucu yöneticisi, CLI). Kullanıcının TOTP'sini kapatır; denetim kaydı yazılır.
// Kullanım: DATABASE_URL=... EKOS_EMAIL=... npx tsx scripts/reset-totp.ts
import { PrismaClient } from "@prisma/client";
import { resetTotpForEmail } from "../src/auth/totp-reset.js";

const email = process.env.EKOS_EMAIL ?? "";
if (!email.trim()) throw new Error("EKOS_EMAIL zorunlu");
const prisma = new PrismaClient();
try {
  const r = await resetTotpForEmail(prisma, email);
  process.stdout.write(`TOTP sıfırlandı (önceden etkin: ${r.wasEnabled ? "evet" : "hayır"}).\n`);
} finally {
  await prisma.$disconnect();
}
