// Rol şablonları — SİSTEM KATALOĞU (A5/1). Bu dosya docs/PERMISSIONS.md §5 matrisinden üretilmiştir;
// katalog.test.ts her hücreyi dokümanla birebir karşılaştırır. Matris değişirse ikisi birlikte güncellenir.
//
// Semboller: ✔ → izin (kapsamsız), K → izin (kapsam zorunlu), Y/— → şablonda YOK (Y: kurum politikasıyla
// ayrıca verilir; varsayılan red).
import type { PermissionCode } from "./codes.js";

export interface RoleTemplate {
  readonly code: string;
  readonly matrixColumn: string;
  readonly name: string;
  /** İzinler (✔ ve K hücreleri). */
  readonly permissions: readonly PermissionCode[];
  /** K hücreleri: bu izinler için üyelikte en az bir kapsam alanı zorunludur. */
  readonly scopedPermissions: readonly PermissionCode[];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: "PLATFORM_ADMIN",
    matrixColumn: "PY",
    name: "Platform Yöneticisi",
    permissions: ["user.manage", "role.manage", "config.manage", "integration.manage", "system.health"],
    scopedPermissions: [],
  },
  {
    code: "RECORDS_MANAGER",
    matrixColumn: "KA",
    name: "Kayıt/Arşiv Yöneticisi",
    permissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.archive", "document.retention_review", "document.manage_permissions", "document.export", "breakglass.request"],
    scopedPermissions: [],
  },
  {
    code: "DEPARTMENT_RECORDS_OWNER",
    matrixColumn: "DS",
    name: "Departman Belge Sorumlusu",
    permissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.start_workflow", "document.archive", "document.manage_permissions", "contract.create", "contract.manage_obligations"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.start_workflow", "document.archive", "document.manage_permissions", "contract.create", "contract.manage_obligations"],
  },
  {
    code: "CONTRACT_MANAGER",
    matrixColumn: "SY",
    name: "Sözleşme Yöneticisi",
    permissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.start_workflow", "document.archive", "contract.create", "contract.manage_obligations", "contract.record_signature", "counterparty.manage"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.start_workflow", "document.archive"],
  },
  {
    code: "LEGAL_REVIEWER",
    matrixColumn: "HI",
    name: "Hukuk İnceleyicisi",
    permissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.legal_hold", "contract.legal_review", "breakglass.request"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.preview", "document.download"],
  },
  {
    code: "DEPARTMENT_USER",
    matrixColumn: "DK",
    name: "Departman Kullanıcısı",
    permissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.start_workflow"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.preview", "document.download", "document.upload", "document.edit_metadata", "document.new_version", "document.start_workflow"],
  },
  {
    code: "APPROVER",
    matrixColumn: "ON",
    name: "Onaycı",
    permissions: ["document.list", "document.view_metadata", "document.preview", "document.approve"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.preview", "document.approve"],
  },
  {
    code: "INTERNAL_AUDITOR",
    matrixColumn: "ID",
    name: "İç Denetçi",
    permissions: ["document.list", "document.view_metadata", "document.export", "audit.view", "audit.export"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.export", "audit.view", "audit.export"],
  },
  {
    code: "READ_ONLY",
    matrixColumn: "SR",
    name: "Salt Okunur Kullanıcı",
    permissions: ["document.list", "document.view_metadata", "document.preview"],
    scopedPermissions: ["document.list", "document.view_metadata", "document.preview"],
  },
  {
    code: "SECURITY_AUDITOR",
    matrixColumn: "GD",
    name: "Güvenlik Denetçisi",
    permissions: ["audit.view", "audit.export", "system.health", "breakglass.approve"],
    scopedPermissions: [],
  },
];

export function findRoleTemplate(code: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.code === code);
}
