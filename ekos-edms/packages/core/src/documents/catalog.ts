// Belge türü kataloğu (Faz 2, madde 1). Başlangıç şablonları; admin yeni tür ekleyebilir,
// ancak kritik kuralları gevşeten yapılandırma validateDocumentTypeChange ile reddedilir.
import type { ConfidentialityLevel } from "../states/index.js";
import { CONFIDENTIALITY_LEVELS } from "../states/index.js";

export interface DocumentTypeDefinition {
  readonly code: string;
  readonly name: string;
  /** Tür için asgari gizlilik. Yönetici bunun altına indiremez. */
  readonly minConfidentiality: ConfidentialityLevel;
  readonly requiredMetadata: readonly string[];
  readonly ocrRequired: boolean;
  /** Saklama profili referansı (Faz 4'te çözümlenir). null = yapılandırma eksik ve tür kaydedilemez. */
  readonly retentionProfileRef: string | null;
  /** Rol şablonu/izin şablonu referansı. */
  readonly permissionTemplateRef: string;
}

const COMMON_REQUIRED = ["title", "documentDate"] as const;

export const BASE_DOCUMENT_TYPES: readonly DocumentTypeDefinition[] = [
  { code: "SUPPLIER_CONTRACT", name: "Tedarikçi sözleşmesi", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-CONTRACT-10Y", permissionTemplateRef: "PT-CONTRACT" },
  { code: "CONSULTANCY_CONTRACT", name: "Danışmanlık sözleşmesi", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-CONTRACT-10Y", permissionTemplateRef: "PT-CONTRACT" },
  { code: "NDA", name: "Gizlilik sözleşmesi", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-CONTRACT-10Y", permissionTemplateRef: "PT-CONTRACT" },
  { code: "FRAMEWORK_AGREEMENT", name: "Çerçeve anlaşma", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-CONTRACT-10Y", permissionTemplateRef: "PT-CONTRACT" },
  { code: "AMENDMENT", name: "Zeyilname", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "parentDocumentId"], ocrRequired: true, retentionProfileRef: "RP-CONTRACT-10Y", permissionTemplateRef: "PT-CONTRACT" },
  { code: "BANK_GUARANTEE", name: "Teminat mektubu", minConfidentiality: "RESTRICTED", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId", "amount", "currency"], ocrRequired: true, retentionProfileRef: "RP-FINANCE-10Y", permissionTemplateRef: "PT-FINANCE" },
  { code: "INSURANCE_POLICY", name: "Sigorta poliçesi", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-CONTRACT-10Y", permissionTemplateRef: "PT-CONTRACT" },
  { code: "PURCHASE_ORDER", name: "Satın alma siparişi", minConfidentiality: "INTERNAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId", "amount", "currency"], ocrRequired: false, retentionProfileRef: "RP-FINANCE-10Y", permissionTemplateRef: "PT-FINANCE" },
  { code: "QUOTATION", name: "Teklif", minConfidentiality: "INTERNAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-FINANCE-10Y", permissionTemplateRef: "PT-FINANCE" },
  { code: "INVOICE", name: "Fatura / mali kayıt", minConfidentiality: "INTERNAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId", "amount", "currency"], ocrRequired: true, retentionProfileRef: "RP-FINANCE-10Y", permissionTemplateRef: "PT-FINANCE" },
  { code: "QUALITY_DOCUMENT", name: "Kalite belgesi / raporu", minConfidentiality: "INTERNAL", requiredMetadata: [...COMMON_REQUIRED], ocrRequired: false, retentionProfileRef: "RP-QUALITY-5Y", permissionTemplateRef: "PT-QUALITY" },
  { code: "TECHNICAL_DOCUMENT", name: "Üretim / teknik doküman", minConfidentiality: "INTERNAL", requiredMetadata: [...COMMON_REQUIRED], ocrRequired: false, retentionProfileRef: "RP-TECH-LIFETIME", permissionTemplateRef: "PT-TECH" },
  { code: "IMPORT_EXPORT", name: "İthalat / ihracat belgesi", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED, "counterpartyId"], ocrRequired: true, retentionProfileRef: "RP-TRADE-10Y", permissionTemplateRef: "PT-TRADE" },
  { code: "INTERNAL_AUDIT_EVIDENCE", name: "İç denetim kanıtı", minConfidentiality: "RESTRICTED", requiredMetadata: [...COMMON_REQUIRED], ocrRequired: false, retentionProfileRef: "RP-AUDIT-10Y", permissionTemplateRef: "PT-AUDIT" },
  { code: "HR_DOCUMENT", name: "İnsan kaynakları belgesi", minConfidentiality: "HIGHLY_RESTRICTED", requiredMetadata: [...COMMON_REQUIRED], ocrRequired: false, retentionProfileRef: "RP-HR-PERSONAL", permissionTemplateRef: "PT-HR" },
  { code: "CORPORATE_RECORD", name: "Kurumsal hukuki kayıt (imza sirküleri, YK kararı, vekaletname)", minConfidentiality: "CONFIDENTIAL", requiredMetadata: [...COMMON_REQUIRED], ocrRequired: true, retentionProfileRef: "RP-CORP-RECORD", permissionTemplateRef: "PT-CONTRACT" },
];

export type CatalogViolation =
  | "CODE_INVALID"
  | "NAME_EMPTY"
  | "CONFIDENTIALITY_BELOW_TEMPLATE_MINIMUM"
  | "RETENTION_PROFILE_MISSING"
  | "REQUIRED_METADATA_INCOMPLETE"
  | "OCR_DISABLED_FOR_REQUIRED_TYPE";

const CODE_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

function rank(level: ConfidentialityLevel): number {
  return CONFIDENTIALITY_LEVELS.indexOf(level);
}

/**
 * Yapılandırma değişikliğini doğrular. `base` şablon ise minimum gizlilik ve OCR kuralları
 * o şablondan devralınır (aynı kodlu tür için). Boş dizi dönerse kabul edilir.
 */
export function validateDocumentTypeChange(
  candidate: DocumentTypeDefinition,
  base?: DocumentTypeDefinition,
): CatalogViolation[] {
  const v: CatalogViolation[] = [];
  if (!CODE_RE.test(candidate.code)) v.push("CODE_INVALID");
  if (candidate.name.trim().length === 0) v.push("NAME_EMPTY");
  if (!candidate.retentionProfileRef) v.push("RETENTION_PROFILE_MISSING");
  const missing = COMMON_REQUIRED.filter((f) => !candidate.requiredMetadata.includes(f));
  if (missing.length > 0) v.push("REQUIRED_METADATA_INCOMPLETE");

  if (base && rank(candidate.minConfidentiality) < rank(base.minConfidentiality)) {
    v.push("CONFIDENTIALITY_BELOW_TEMPLATE_MINIMUM");
  }
  if (base?.ocrRequired && !candidate.ocrRequired) v.push("OCR_DISABLED_FOR_REQUIRED_TYPE");
  return v;
}

export function findBaseType(code: string): DocumentTypeDefinition | undefined {
  return BASE_DOCUMENT_TYPES.find((t) => t.code === code);
}
