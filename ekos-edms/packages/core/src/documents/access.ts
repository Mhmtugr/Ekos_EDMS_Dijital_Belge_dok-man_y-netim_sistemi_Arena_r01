// Belge erişim kararları (Faz 2, madde 5/10). Tüm eylemler authorize() üzerinden geçer (deny-by-default).
// 404/403 kuralı (A4): kullanıcı belgeyi görmeye yetkili değilse varlık sızdırılmamak için 404 döner.
import { authorize, deniedHttpStatus, type AuthorizeInput, type AuthorizeResult } from "../authz/authorize.js";

export type DocumentAction = "view_metadata" | "preview" | "download" | "ocr_text" | "edit_metadata" | "new_version";

const PERMISSION_FOR: Record<DocumentAction, string> = {
  view_metadata: "document.view_metadata",
  // OCR metni belge içeriğidir: önizleme izni gerekir (PERMISSIONS.md).
  preview: "document.preview",
  ocr_text: "document.preview",
  download: "document.download",
  edit_metadata: "document.edit_metadata",
  new_version: "document.new_version",
};

export type DocumentAccessDecision =
  | { readonly allowed: true; readonly result: AuthorizeResult }
  | { readonly allowed: false; readonly status: 403 | 404 };

export function decideDocumentAccess(
  input: Omit<AuthorizeInput, "permission">,
  action: DocumentAction,
): DocumentAccessDecision {
  const permission = PERMISSION_FOR[action];
  const result = authorize({ ...input, permission });
  if (result.allowed) return { allowed: true, result };
  // Görünürlük yoksa 404; görünür ama eylem izni yoksa 403.
  const status = deniedHttpStatus({ ...input, permission }, "document.view_metadata");
  return { allowed: false, status };
}

export const DOCUMENT_ACTION_PERMISSIONS = PERMISSION_FOR;
