// Tek yetki karar noktası (A4 §Yetkilendirme, ADR-0009). Varsayılan: REDDET.
// Saf fonksiyon: I/O yapmaz; girdi olarak yüklenmiş üyelik, ACL ve kırılma-cam kayıtlarını alır.
import { CONFIDENTIALITY_LEVELS, type ConfidentialityLevel } from "../states/index.js";
import { isPermissionCode } from "../permissions/codes.js";

export type ActorStatus = "ACTIVE" | "DISABLED" | "OFFBOARDING";

/** Kapsam alanları. Boş dizi / null / undefined = kısıt yok. Dolu = kesişim zorunlu. */
export interface MembershipScope {
  readonly departmentIds?: readonly string[];
  readonly documentTypeIds?: readonly string[];
  readonly counterpartyIds?: readonly string[];
  readonly projectIds?: readonly string[];
  readonly maxConfidentiality?: ConfidentialityLevel | null;
  readonly documentId?: string | null;
}

export interface MembershipGrant {
  readonly membershipId: string;
  readonly roleCode: string;
  /** Rolün izin kodları (rol şablonu veya kurum kopyası). */
  readonly permissions: readonly string[];
  readonly scope: MembershipScope;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly revokedAt?: Date | null;
}

export interface AclEntry {
  readonly effect: "ALLOW" | "DENY";
  readonly permissionCode: string;
  readonly subject:
    | { readonly type: "USER"; readonly id: string }
    | { readonly type: "GROUP"; readonly id: string }
    | { readonly type: "ROLE"; readonly id: string };
}

export interface BreakGlassView {
  readonly grantId: string;
  readonly resourceId: string;
  readonly permissions: readonly string[];
  readonly requestedById: string;
  readonly approvedById: string | null;
  readonly startsAt: Date | null;
  readonly expiresAt: Date | null;
  /** Yalnızca APPROVED kayıtlar yüklenir; yine de kontrol edilir. */
  readonly status: "REQUESTED" | "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED";
}

export interface ActorContext {
  readonly userId: string;
  readonly status: ActorStatus;
  readonly groupIds: readonly string[];
  readonly memberships: readonly MembershipGrant[];
  readonly breakGlass: readonly BreakGlassView[];
}

export interface ResourceRef {
  readonly id: string;
  readonly kind: "DOCUMENT" | "CONTRACT" | "COUNTERPARTY" | "SYSTEM";
  readonly departmentId?: string | null;
  readonly documentTypeId?: string | null;
  readonly counterpartyId?: string | null;
  readonly projectId?: string | null;
  readonly confidentiality?: ConfidentialityLevel | null;
}

export interface AuthorizeInput {
  readonly actor: ActorContext;
  readonly permission: string;
  /** Sistem düzeyi işlemlerde (ör. user.manage) undefined. */
  readonly resource?: ResourceRef;
  readonly acl?: readonly AclEntry[];
  readonly now: Date;
}

export type AllowReason =
  | "MEMBERSHIP"
  | "ACL_ALLOW"
  | "BREAK_GLASS";

export type DenyReason =
  | "INVALID_PERMISSION"
  | "ACTOR_INACTIVE"
  | "ACL_DENY"
  | "NO_GRANT"
  | "SCOPE_MISMATCH"
  | "CONFIDENTIALITY_EXCEEDED"
  | "BREAK_GLASS_INVALID";

export type AuthorizeResult =
  | { readonly allowed: true; readonly reason: AllowReason }
  | { readonly allowed: false; readonly reason: DenyReason };

export function confidentialityRank(level: ConfidentialityLevel): number {
  return CONFIDENTIALITY_LEVELS.indexOf(level);
}

function isMembershipActive(m: MembershipGrant, now: Date): boolean {
  if (m.revokedAt) return false;
  if (m.validFrom && m.validFrom.getTime() > now.getTime()) return false;
  if (m.validUntil && m.validUntil.getTime() <= now.getTime()) return false;
  return true;
}

function hasScopeRestriction(scope: MembershipScope): boolean {
  return (
    (scope.departmentIds?.length ?? 0) > 0 ||
    (scope.documentTypeIds?.length ?? 0) > 0 ||
    (scope.counterpartyIds?.length ?? 0) > 0 ||
    (scope.projectIds?.length ?? 0) > 0 ||
    !!scope.maxConfidentiality ||
    !!scope.documentId
  );
}

/** Kapsam bir kaynakla kesişiyor mu? Sistem düzeyinde (kaynak yok) kısıtlı kapsam eşleşmez. */
export function scopeMatches(scope: MembershipScope, resource: ResourceRef | undefined): boolean {
  if (!hasScopeRestriction(scope)) return true;
  if (!resource) return false;

  const inList = (list: readonly string[] | undefined, value: string | null | undefined): boolean => {
    if (!list || list.length === 0) return true;
    return value != null && list.includes(value);
  };

  if (!inList(scope.departmentIds, resource.departmentId)) return false;
  if (!inList(scope.documentTypeIds, resource.documentTypeId)) return false;
  if (!inList(scope.counterpartyIds, resource.counterpartyId)) return false;
  if (!inList(scope.projectIds, resource.projectId)) return false;
  if (scope.documentId && scope.documentId !== resource.id) return false;
  if (scope.maxConfidentiality) {
    if (!resource.confidentiality) return false;
    if (confidentialityRank(resource.confidentiality) > confidentialityRank(scope.maxConfidentiality)) {
      return false;
    }
  }
  return true;
}

function aclSubjectMatches(entry: AclEntry, actor: ActorContext): boolean {
  switch (entry.subject.type) {
    case "USER":
      return entry.subject.id === actor.userId;
    case "GROUP":
      return actor.groupIds.includes(entry.subject.id);
    case "ROLE":
      return actor.memberships.some((m) => m.roleCode === entry.subject.id);
  }
}

/**
 * Karar sırası:
 *  1. Geçersiz izin kodu → red.
 *  2. Hesap aktif değil → red.
 *  3. Kaynağa ait açık DENY (ACL) → red. DENY her zaman önceliklidir.
 *  4. Kapsamlı üyelik (kapsam + gizlilik tavanı + geçerlilik) → izin.
 *  5. Açık ACL ALLOW → izin.
 *  6. Süreli, onaylı, talep edenden farklı onaycılı kırılma-cam kaydı → izin.
 *  7. Aksi halde red (varsayılan).
 */
export function authorize(input: AuthorizeInput): AuthorizeResult {
  const { actor, permission, resource, acl = [], now } = input;

  if (!isPermissionCode(permission)) return { allowed: false, reason: "INVALID_PERMISSION" };
  if (actor.status !== "ACTIVE") return { allowed: false, reason: "ACTOR_INACTIVE" };

  if (resource) {
    const denied = acl.some(
      (e) => e.effect === "DENY" && e.permissionCode === permission && aclSubjectMatches(e, actor),
    );
    if (denied) return { allowed: false, reason: "ACL_DENY" };
  }

  const activeWithPermission = actor.memberships.filter(
    (m) => isMembershipActive(m, now) && m.permissions.includes(permission),
  );
  if (activeWithPermission.some((m) => scopeMatches(m.scope, resource))) {
    return { allowed: true, reason: "MEMBERSHIP" };
  }

  if (resource) {
    const allowed = acl.some(
      (e) => e.effect === "ALLOW" && e.permissionCode === permission && aclSubjectMatches(e, actor),
    );
    if (allowed) return { allowed: true, reason: "ACL_ALLOW" };
  }

  if (resource) {
    const bg = actor.breakGlass.find(
      (g) =>
        g.resourceId === resource.id &&
        g.status === "APPROVED" &&
        g.permissions.includes(permission) &&
        g.approvedById !== null &&
        g.approvedById !== g.requestedById &&
        g.approvedById !== actor.userId &&
        g.requestedById === actor.userId &&
        (!g.startsAt || g.startsAt.getTime() <= now.getTime()) &&
        !!g.expiresAt &&
        g.expiresAt.getTime() > now.getTime(),
    );
    if (bg) return { allowed: true, reason: "BREAK_GLASS" };
  }

  if (activeWithPermission.length > 0) {
    // Üyelik var ama kapsam/gizlilik eşleşmiyor.
    const conf = resource?.confidentiality;
    const confExceeded = activeWithPermission.every(
      (m) => !!m.scope.maxConfidentiality && !!conf &&
        confidentialityRank(conf) > confidentialityRank(m.scope.maxConfidentiality),
    );
    return { allowed: false, reason: confExceeded ? "CONFIDENTIALITY_EXCEEDED" : "SCOPE_MISMATCH" };
  }
  return { allowed: false, reason: "NO_GRANT" };
}

/**
 * 404/403 kuralı (A4): kaynağı hiç görmeye yetkisi yoksa 404 (varlık sızdırılmaz),
 * görebiliyor ama eylem izni yoksa 403. Görünürlük için `viewPermission` kullanılır.
 * Yalnızca `authorize` reddettiğinde çağrılmalıdır.
 */
export function deniedHttpStatus(input: AuthorizeInput, viewPermission: string): 403 | 404 {
  const view = authorize({ ...input, permission: viewPermission });
  return view.allowed ? 403 : 404;
}

/** Üyelik kapsam kuralı: rol K (kapsam zorunlu) izin içeriyorsa kapsam alanı en az biri dolu olmalı. */
export function membershipScopeIsValid(
  scopedPermissions: readonly string[],
  scope: MembershipScope,
): boolean {
  if (scopedPermissions.length === 0) return true;
  return hasScopeRestriction(scope);
}
