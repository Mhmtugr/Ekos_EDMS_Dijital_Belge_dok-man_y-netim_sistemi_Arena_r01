// Şema statik testleri: Prisma dosyalarını metin olarak okur (motor gerektirmez).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONFIDENTIALITY_LEVELS,
  CONTRACT_LIFECYCLE_STATUSES,
  GENERAL_LIFECYCLE_STATUSES,
  INGEST_STATUSES,
} from "@ekos/core";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "..", "prisma", "schema");
const schema = readdirSync(schemaDir)
  .filter((f) => f.endsWith(".prisma"))
  .sort()
  .map((f) => readFileSync(join(schemaDir, f), "utf8"))
  .join("\n");

function enumValues(name: string): string[] {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (!m || m[1] === undefined) throw new Error(`enum bulunamadı: ${name}`);
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));
}

function modelNames(): string[] {
  return [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1] ?? "");
}

const REQUIRED_MODELS = [
  "User",
  "Group",
  "Role",
  "Permission",
  "Membership",
  "IdentityProviderMapping",
  "Delegation",
  "Department",
  "LegalEntity",
  "Site",
  "Project",
  "Counterparty",
  "CounterpartyContact",
  "Document",
  "DocumentVersion",
  "DocumentFileObject",
  "DocumentType",
  "MetadataDefinition",
  "MetadataValue",
  "DocumentRelation",
  "PhysicalArchiveLocation",
  "DocumentAcl",
  "ContractRecord",
  "ContractParty",
  "Obligation",
  "ContractDeadline",
  "Guarantee",
  "RenewalRule",
  "ContractAmendment",
  "WorkflowDefinition",
  "WorkflowDefinitionVersion",
  "WorkflowInstance",
  "WorkflowStep",
  "ApprovalTask",
  "ApprovalDecision",
  "RetentionProfile",
  "RetentionRuleVersion",
  "LegalHold",
  "DispositionReview",
  "DispositionDecision",
  "DisposalManifest",
  "Notification",
  "NotificationPreference",
  "NotificationDeliveryAttempt",
  "ScheduledEvent",
  "AuditEvent",
  "SecurityEvent",
  "ImportBatch",
  "ImportRowResult",
  "OCRJob",
  "ExtractionResult",
  "IntegrationConnection",
  "SyncRun",
  "BackgroundJob",
  "JobFailure",
  "BreakGlassGrant",
  "SystemSetting",
];

describe("şema: varlık kapsamı", () => {
  it("Faz 0 listesindeki her varlık tanımlı", () => {
    const models = new Set(modelNames());
    const missing = REQUIRED_MODELS.filter((m) => !models.has(m));
    expect(missing).toEqual([]);
  });
});

describe("şema: kurallar", () => {
  it("hiçbir ilişki CASCADE veya SET NULL kullanmaz (onDelete: Restrict)", () => {
    expect(schema).not.toMatch(/onDelete:\s*Cascade/);
    expect(schema).not.toMatch(/onDelete:\s*SetNull/);
  });

  it("her model UUIDv7 kimlik kullanır", () => {
    const blocks = schema.split(/^model /m).slice(1);
    // Bileşik birincil anahtarlı birleşim tabloları istisnadır (adlarıyla listelenir).
    const COMPOSITE_KEY_JOIN_TABLES = ["GroupMember", "RolePermission"];
    // OidcLoginRequest: birincil anahtar, yüksek entropili ve kısa ömürlü OIDC "state" değeridir (tek kullanımlık arama anahtarı).
    const OPAQUE_KEY_TABLES = ["OidcLoginRequest"];
    for (const block of blocks) {
      const name = block.split(" ")[0] ?? "";
      if (OPAQUE_KEY_TABLES.includes(name)) {
        expect(block, `${name} state birincil anahtarı kullanmalı`).toMatch(/state\s+String\s+@id/);
        continue;
      }
      if (COMPOSITE_KEY_JOIN_TABLES.includes(name)) {
        expect(block, `${name} bileşik @@id kullanmalı`).toMatch(/@@id\(\[/);
        continue;
      }
      expect(block, `${name} UUIDv7 id içermeli`).toMatch(
        /id\s+String\s+@id\s+@default\(uuid\(7\)\)\s+@db\.Uuid/,
      );
    }
  });

  it("para alanları Decimal(19,4) (float yok)", () => {
    expect(schema).not.toMatch(/\bFloat\b/);
    expect(schema).not.toMatch(/\bDouble\b/);
    expect(schema).toMatch(/amount\s+Decimal\?\s+@db\.Decimal\(19, 4\)/);
  });

  it("sözleşme tarih-yalnızca alanları @db.Date", () => {
    expect(schema).toMatch(/endDate\s+DateTime\?\s+@db\.Date/);
    expect(schema).toMatch(/effectiveDate\s+DateTime\?\s+@db\.Date/);
  });

  it("ana kayıtlarda rowVersion bulunur", () => {
    for (const name of ["Document", "ContractRecord", "User", "Membership", "Obligation"]) {
      const block = schema.split(new RegExp(`^model ${name} \\{`, "m"))[1]?.split(/^\}/m)[0] ?? "";
      expect(block, `${name}.rowVersion`).toMatch(/rowVersion\s+Int\s+@default\(1\)/);
    }
  });

  it("yetki kodları DB'de benzersiz (Permission.code @unique)", () => {
    expect(schema).toMatch(/code\s+String\s+@unique\s+@db\.VarChar\(80\)\s*\n\s*description/);
  });

  it("izin kodlarını PERMISSION_CODES'a bağlayan açıklama korunur", () => {
    expect(schema).toContain("packages/core/src/permissions/codes.ts");
  });

  it("AuditEvent kimliği ve zincir alanları var", () => {
    const block = schema.split(/^model AuditEvent \{/m)[1]?.split(/^\}/m)[0] ?? "";
    expect(block).toMatch(/sequence\s+BigInt\s+@unique/);
    expect(block).toMatch(/prevHash\s+String\s+@db\.Char\(64\)/);
    expect(block).toMatch(/hash\s+String\s+@unique\s+@db\.Char\(64\)/);
    // Yalnızca alan tanımlarına bak (yorumlar hariç): içerik/secret alanı olmamalı.
    const fields = block
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("@@"))
      .join("\n");
    expect(fields).not.toMatch(/\b(passwordHash|token|content|ocrText|secret)\b/i);
  });
});

describe("şema: enum'lar A6 ve core ile birebir", () => {
  it("IngestStatus = INGEST_STATUSES", () => {
    expect(enumValues("IngestStatus")).toEqual([...INGEST_STATUSES]);
  });
  it("GeneralLifecycleStatus = GENERAL_LIFECYCLE_STATUSES", () => {
    expect(enumValues("GeneralLifecycleStatus")).toEqual([...GENERAL_LIFECYCLE_STATUSES]);
  });
  it("ContractLifecycleStatus = CONTRACT_LIFECYCLE_STATUSES", () => {
    expect(enumValues("ContractLifecycleStatus")).toEqual([...CONTRACT_LIFECYCLE_STATUSES]);
  });
  it("ConfidentialityLevel = CONFIDENTIALITY_LEVELS (sıralı)", () => {
    expect(enumValues("ConfidentialityLevel")).toEqual([...CONFIDENTIALITY_LEVELS]);
  });
  it("IntegrationStatus durumları (A4/Faz 6)", () => {
    expect(enumValues("IntegrationStatus")).toEqual([
      "NOT_CONFIGURED",
      "CONFIGURED_UNVERIFIED",
      "CONNECTED",
      "FAILED",
    ]);
  });
});
