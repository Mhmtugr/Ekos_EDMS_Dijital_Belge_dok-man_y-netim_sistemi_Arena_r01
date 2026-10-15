// TOTP kurtarma (yalnızca sunucu yöneticisi). Mantık scripts/reset-totp.ts'ten ayrıldı ki test edilebilsin.
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";

export async function resetTotpForEmail(prisma: PrismaClient, rawEmail: string): Promise<{ wasEnabled: boolean }> {
  const email = rawEmail.trim().toLowerCase();
  if (email.length === 0) throw new Error("EKOS_EMAIL zorunlu");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, totpEnabledAt: true } });
  if (!user) throw new Error("Kullanıcı bulunamadı");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { totpSecretCipher: null, totpEnabledAt: null, totpLastStep: null, updatedBy: null },
    });
    await appendAudit(tx, {
      actorType: "SYSTEM",
      actorId: null,
      eventType: "TOTP_RESET_CLI",
      targetType: "User",
      targetId: user.id,
      outcome: "SUCCESS",
      reason: "CLI_RECOVERY",
      correlationId: `totp-reset-${user.id}`,
      afterSummary: { wasEnabled: user.totpEnabledAt !== null },
    });
  });
  return { wasEnabled: user.totpEnabledAt !== null };
}
