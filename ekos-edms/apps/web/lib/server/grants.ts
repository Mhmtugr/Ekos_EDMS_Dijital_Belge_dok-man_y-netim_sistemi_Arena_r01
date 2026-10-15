// Referans verisi (karşı taraf listesi, yükleme ekranı) için "bu izne aktif bir üyeliğim var mı?" denetimi.
// Kapsam kısıtı (birim/tür/karşı taraf) BELGE verisine uygulanır; düz referans listelerine değil. Belge
// düzeyi kararlar her zaman authorize() ile kaynak bilgisiyle verilir.
import type { ActorContext } from "@ekos/core";

export function hasActiveGrant(actor: ActorContext, permissions: readonly string[], now: Date = new Date()): boolean {
  if (actor.status !== "ACTIVE") return false;
  return actor.memberships.some(
    (m) =>
      !m.revokedAt &&
      (!m.validFrom || m.validFrom.getTime() <= now.getTime()) &&
      (!m.validUntil || m.validUntil.getTime() > now.getTime()) &&
      permissions.some((p) => m.permissions.includes(p)),
  );
}

/** Kurum geneli (hiçbir kapsam kısıtı olmayan) aktif üyelik var mı? Toplu işlemler için kullanılır. */
export function hasUnrestrictedGrant(actor: ActorContext, permission: string, now: Date = new Date()): boolean {
  if (actor.status !== "ACTIVE") return false;
  return actor.memberships.some((m) => {
    if (m.revokedAt) return false;
    if (m.validFrom && m.validFrom.getTime() > now.getTime()) return false;
    if (m.validUntil && m.validUntil.getTime() <= now.getTime()) return false;
    if (!m.permissions.includes(permission)) return false;
    const s = m.scope;
    return (
      (s.departmentIds ?? []).length === 0 &&
      (s.documentTypeIds ?? []).length === 0 &&
      (s.counterpartyIds ?? []).length === 0 &&
      (s.projectIds ?? []).length === 0 &&
      !s.documentId &&
      !s.maxConfidentiality
    );
  });
}
