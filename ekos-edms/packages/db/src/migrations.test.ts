// Migration'ları GERÇEK PostgreSQL motorunda (PGlite = Postgres WASM) çalıştırır ve korumaları dener.
// Not: unaccent eklentisi PGlite'te yoktur; yalnızca o CREATE EXTENSION satırı test ortamında atlanır.
// Bu, production'da unaccent'in doğrulanmadığı anlamına gelir (TRACEABILITY R-SEARCH-01: DOĞRULANMADI).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, "..", "prisma", "migrations");
const sql0001 = readFileSync(join(migDir, "0001_init", "migration.sql"), "utf8");
const sql0002 = readFileSync(join(migDir, "0002_db_guards", "migration.sql"), "utf8").replace(
  /CREATE EXTENSION IF NOT EXISTS unaccent;/,
  "-- (unaccent: PGlite'te yok, test ortamında atlandı)",
);

let db: PGlite;

async function expectFail(q: string, pattern: RegExp): Promise<void> {
  await expect(db.query(q)).rejects.toThrow(pattern);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(sql0001);
  await db.exec(sql0002);
});

afterAll(async () => {
  await db.close();
});

describe("migration: uygulanabilirlik", () => {
  it("0001 ve 0002 hatasız uygulanır ve beklenen tablolar oluşur", async () => {
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    expect(r.rows[0]?.n).toBe(60);
  });

  it("tüm yabancı anahtarlar RESTRICT (CASCADE yok)", async () => {
    const r = await db.query<{ rule: string }>(
      `SELECT rc.delete_rule AS rule FROM information_schema.referential_constraints rc`,
    );
    expect(r.rows.length).toBeGreaterThan(50);
    expect(r.rows.every((x) => x.rule === "RESTRICT" || x.rule === "NO ACTION")).toBe(true);
  });

  it("arama vektörü üretilen kolon olarak mevcut", async () => {
    const r = await db.query<{ is_generated: string }>(
      `SELECT is_generated FROM information_schema.columns WHERE table_name='Document' AND column_name='searchVector'`,
    );
    expect(r.rows[0]?.is_generated).toBe("ALWAYS");
  });
});

describe("denetim izi: INSERT-yalnız (ADR-0007)", () => {
  it("AuditEvent'e eklemek başarılıdır", async () => {
    await db.query(`
      INSERT INTO "AuditEvent" (id, sequence, "occurredAt", "actorType", "eventType", "targetType",
        outcome, "correlationId", "prevHash", hash)
      VALUES (gen_random_uuid(), 1, now(), 'SYSTEM', 'TEST', 'Document', 'SUCCESS', 'c1',
        repeat('0',64), repeat('a',64))`);
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "AuditEvent"`);
    expect(r.rows[0]?.n).toBe(1);
  });

  it("UPDATE reddedilir", async () => {
    await expectFail(`UPDATE "AuditEvent" SET reason='x'`, /salt eklemelidir/);
  });

  it("DELETE reddedilir", async () => {
    await expectFail(`DELETE FROM "AuditEvent"`, /salt eklemelidir/);
  });

  it("TRUNCATE reddedilir", async () => {
    await expectFail(`TRUNCATE "AuditEvent"`, /salt eklemelidir/);
  });
});

describe("kapsam ve tutarlılık kısıtları", () => {
  it("Membership: kullanıcı ve grup birlikte reddedilir", async () => {
    await db.query(
      `INSERT INTO "Role" (id, code, name, "updatedAt") VALUES ('00000000-0000-7000-8000-000000000001','R1','Rol 1', now())`,
    );
    await db.query(
      `INSERT INTO "User" (id, email, "displayName", "updatedAt") VALUES ('00000000-0000-7000-8000-0000000000a1','a@x.test','A', now())`,
    );
    await db.query(
      `INSERT INTO "Group" (id, name, "updatedAt") VALUES ('00000000-0000-7000-8000-0000000000b1','G1', now())`,
    );
    await expectFail(
      `INSERT INTO "Membership" (id, "userId", "groupId", "roleId", "updatedAt") VALUES (gen_random_uuid(),'00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-0000000000b1','00000000-0000-7000-8000-000000000001', now())`,
      /ekos_membership_one_subject/,
    );
  });

  it("Membership: hiçbir özne yoksa reddedilir", async () => {
    await expectFail(
      `INSERT INTO "Membership" (id, "roleId", "updatedAt") VALUES (gen_random_uuid(),'00000000-0000-7000-8000-000000000001', now())`,
      /ekos_membership_one_subject/,
    );
  });

  it("Membership: yalnızca kullanıcı ile geçerlidir", async () => {
    await db.query(
      `INSERT INTO "Membership" (id, "userId", "roleId", "updatedAt") VALUES (gen_random_uuid(),'00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-000000000001', now())`,
    );
  });

  it("Belge profili: GENERAL iken contractStatus dolu olamaz", async () => {
    await db.query(
      `INSERT INTO "DocumentType" (id, code, name, "defaultConfidentiality", "requiredMetadataKeys", "updatedAt") VALUES ('00000000-0000-7000-8000-0000000000c1','T1','Tür 1','CONFIDENTIAL', '{}', now())`,
    );
    await expectFail(
      `INSERT INTO "Document" (id, number, title, "typeId", "ownerId", confidentiality, "lifecycleProfile", "generalStatus", "contractStatus", "searchText", "updatedAt")
       VALUES (gen_random_uuid(),'EKOS-T-2026-000001','Başlık','00000000-0000-7000-8000-0000000000c1','00000000-0000-7000-8000-0000000000a1','CONFIDENTIAL','GENERAL','DRAFT','DRAFT','baslik', now())`,
      /ekos_document_profile_status/,
    );
  });

  it("Belge profili: GENERAL + generalStatus geçerlidir", async () => {
    await db.query(
      `INSERT INTO "Document" (id, number, title, "typeId", "ownerId", confidentiality, "lifecycleProfile", "generalStatus", "searchText", "updatedAt")
       VALUES ('00000000-0000-7000-8000-0000000000d1','EKOS-T-2026-000002','Ana belge','00000000-0000-7000-8000-0000000000c1','00000000-0000-7000-8000-0000000000a1','CONFIDENTIAL','GENERAL','DRAFT','sozlesme ana belge', now())`,
    );
  });

  it("Arama vektörü Türkçe-normalize metinden üretilir (simple config)", async () => {
    const r = await db.query<{ ok: boolean }>(
      `SELECT "searchVector" @@ to_tsquery('simple','sozlesme') AS ok FROM "Document" WHERE number='EKOS-T-2026-000002'`,
    );
    expect(r.rows[0]?.ok).toBe(true);
  });

  it("Sözleşme tutarı var ama para birimi yoksa reddedilir", async () => {
    await db.query(
      `INSERT INTO "Counterparty" (id, "officialName", "countryCode", "updatedAt") VALUES ('00000000-0000-7000-8000-0000000000e1','Tedarikçi A','TR', now())`,
    );
    await db.query(
      `INSERT INTO "LegalEntity" (id, name, "countryCode", "updatedAt") VALUES ('00000000-0000-7000-8000-0000000000f1','EKOS Electric','TR', now())`,
    );
    await db.query(`INSERT INTO "Document" (id, number, title, "typeId", "ownerId", confidentiality, "lifecycleProfile", "contractStatus", "searchText", "updatedAt")
      VALUES ('00000000-0000-7000-8000-0000000000d2','EKOS-T-2026-000003','Sözleşme','00000000-0000-7000-8000-0000000000c1','00000000-0000-7000-8000-0000000000a1','CONFIDENTIAL','CONTRACT','DRAFT','sozlesme', now())`);
    await expectFail(
      `INSERT INTO "ContractRecord" (id, "documentId", title, "contractType", direction, "counterpartyId", "legalEntityId", amount, currency, "updatedAt")
       VALUES (gen_random_uuid(),'00000000-0000-7000-8000-0000000000d2','S','HIZMET','PURCHASE','00000000-0000-7000-8000-0000000000e1','00000000-0000-7000-8000-0000000000f1', 100, NULL, now())`,
      /ekos_contract_amount_currency/,
    );
  });

  it("Para birimi ISO 4217 biçiminde değilse reddedilir", async () => {
    await expectFail(
      `INSERT INTO "Guarantee" (id, "contractId", "guaranteeType", amount, currency, issuer, "referenceNo", "updatedAt")
       VALUES (gen_random_uuid(), gen_random_uuid(), 'OTHER', 10, 'try', 'Banka', 'R-1', now())`,
      /ekos_guarantee_currency_format/,
    );
  });

  it("Red kararında gerekçe zorunludur", async () => {
    await db.query(
      `INSERT INTO "WorkflowDefinition" (id, code, name, "updatedAt") VALUES ('00000000-0000-7000-8000-000000000101','WF1','Akış', now())`,
    );
    await db.query(
      `INSERT INTO "WorkflowDefinitionVersion" (id, "definitionId", version, definition) VALUES ('00000000-0000-7000-8000-000000000102','00000000-0000-7000-8000-000000000101',1,'{}')`,
    );
    await db.query(
      `INSERT INTO "WorkflowInstance" (id, "definitionVersionId", "subjectType", "subjectId", "startedById") VALUES ('00000000-0000-7000-8000-000000000103','00000000-0000-7000-8000-000000000102','CONTRACT','00000000-0000-7000-8000-0000000000d2','00000000-0000-7000-8000-0000000000a1')`,
    );
    await db.query(
      `INSERT INTO "WorkflowStep" (id, "instanceId", "orderIndex", status) VALUES ('00000000-0000-7000-8000-000000000104','00000000-0000-7000-8000-000000000103',1,'OPEN')`,
    );
    await db.query(
      `INSERT INTO "ApprovalTask" (id, "stepId", "assigneeId", "updatedAt") VALUES ('00000000-0000-7000-8000-000000000105','00000000-0000-7000-8000-000000000104','00000000-0000-7000-8000-0000000000a1', now())`,
    );
    await expectFail(
      `INSERT INTO "ApprovalDecision" (id, "taskId", decision, "actorId") VALUES (gen_random_uuid(),'00000000-0000-7000-8000-000000000105','REJECT','00000000-0000-7000-8000-0000000000a1')`,
      /ekos_decision_reason_required/,
    );
  });

  it("Break-glass: talep eden onaylayamaz (iki kişi ilkesi)", async () => {
    const u = "00000000-0000-7000-8000-0000000000a1";
    await expectFail(
      `INSERT INTO "BreakGlassGrant" (id, "requesterId", "approverId", "subjectType", "subjectId", reason)
       VALUES (gen_random_uuid(),'${u}','${u}','DOCUMENT','00000000-0000-7000-8000-0000000000d1','gerekçe')`,
      /ekos_breakglass_two_person/,
    );
  });
});

describe("imzalı / salt-okunur sürüm koruması (A6)", () => {
  const docId = "00000000-0000-7000-8000-0000000000d1";
  const verId = "00000000-0000-7000-8000-00000000f001";

  beforeAll(async () => {
    await db.query(
      `INSERT INTO "DocumentVersion" (id, "documentId", "versionNumber", sha256, "isReadOnly", "isSigned")
       VALUES ('${verId}','${docId}',1, repeat('b',64), true, true)`,
    );
  });

  it("salt-okunur sürümün hash'i değiştirilemez", async () => {
    await expectFail(
      `UPDATE "DocumentVersion" SET sha256 = repeat('c',64) WHERE id='${verId}'`,
      /Salt-okunur sürüm değiştirilemez/,
    );
  });

  it("imzalı bayrağı kapatılamaz", async () => {
    await expectFail(
      `UPDATE "DocumentVersion" SET "isSigned" = false WHERE id='${verId}'`,
      /Salt-okunur sürüm değiştirilemez/,
    );
  });

  it("salt-okunur sürüm silinemez", async () => {
    await expectFail(`DELETE FROM "DocumentVersion" WHERE id='${verId}'`, /silinemez/);
  });

  it("salt-okunur sürümde yalnızca yaşam bilgisi (supersededAt) güncellenebilir", async () => {
    await db.query(`UPDATE "DocumentVersion" SET "supersededAt" = now() WHERE id='${verId}'`);
  });

  it("silme/yabancı anahtar: kullanılan belge türü silinemez (RESTRICT)", async () => {
    await expectFail(
      `DELETE FROM "DocumentType" WHERE id='00000000-0000-7000-8000-0000000000c1'`,
      /violates foreign key constraint/,
    );
  });
});
