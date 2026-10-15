// İzin kodları — sistem kataloğu (ARCHITECTURE.md §5, PERMISSIONS.md).
// Bu liste değişirse docs/PERMISSIONS.md ve packages/core/src/permissions/codes.test.ts birlikte güncellenmelidir.

export const PERMISSION_CODES = [
  "document.list",
  "document.view_metadata",
  "document.preview",
  "document.download",
  "document.upload",
  "document.edit_metadata",
  "document.new_version",
  "document.start_workflow",
  "document.approve",
  "document.archive",
  "document.retention_review",
  "document.disposal_approve",
  "document.manage_permissions",
  "document.export",
  "document.legal_hold",
  "contract.create",
  "contract.manage_obligations",
  "contract.legal_review",
  "contract.record_signature",
  "counterparty.manage",
  "user.manage",
  "role.manage",
  "config.manage",
  "integration.manage",
  "audit.view",
  "audit.export",
  "system.health",
  "breakglass.request",
  "breakglass.approve",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value);
}
