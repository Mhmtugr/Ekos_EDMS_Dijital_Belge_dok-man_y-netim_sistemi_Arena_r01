import { createHash } from "node:crypto";
// Faz 4 ortak yardımcılar: takvim tarihi, global yetki kapısı, reddedilen denemenin denetim kaydı.
import { authorize, type ActorContext } from "@ekos/core";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { DomainError } from "../documents/shared.js";

export type Tx = Prisma.TransactionClient;

/** Kurum saat dilimine (Europe/Istanbul) göre takvim günü YYYY-MM-DD. */
export function istanbulDate(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
}

/** @db.Date alanları (UTC gece yarısı) için takvim günü. */
export function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Belge gerektirmeyen (sistem düzeyi) izin kapısı. Reddedilirse FORBIDDEN. */
export function requireGlobal(actor: ActorContext, permission: string, now: Date): void {
  const r = authorize({ actor, permission, now });
  if (!r.allowed) throw new DomainError("FORBIDDEN", "Bu işlem için yetkiniz yok");
}

/**
 * Reddedilen denemeyi AYRI bir işlemde denetime yazar. Asıl işlem hata verip geri alınsa bile kayıt kalır
 * ("her deneme audit'e düşer").
 */
export async function recordDenied(
  prisma: PrismaClient,
  input: {
    readonly actorId: string | null;
    readonly actorType?: "USER" | "WORKER" | "SYSTEM";
    readonly eventType: string;
    readonly targetType: string;
    readonly targetId: string | null;
    readonly reason: string;
    readonly correlationId: string;
  },
): Promise<void> {
  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      outcome: "DENIED",
      reason: input.reason,
      correlationId: input.correlationId,
    }),
  );
}


/**
 * Kanonik JSON özeti: anahtarlar özyinelemeli sıralanır (PostgreSQL jsonb anahtar sırasını değiştirdiği için
 * ham JSON.stringify ile doğrulama güvenilmez). BigInt → string, Date → ISO.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k]);
    return out;
  }
  return value;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
