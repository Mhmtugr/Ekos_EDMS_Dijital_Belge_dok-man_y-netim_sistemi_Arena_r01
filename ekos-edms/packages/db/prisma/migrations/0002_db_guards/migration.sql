-- 0002_db_guards — Prisma şemasının ifade edemediği kısıtlar ve veritabanı korumaları.
-- Bu dosya el yazımıdır; 0001 (Prisma üretimi) ile birlikte uygulanır. Sırayı değiştirmeyin.

-- Yardımcı: boş olmayan metin (CHECK kısıtlarında kullanılır; önce tanımlanmalı).
CREATE OR REPLACE FUNCTION ekos_nonempty(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT value IS NOT NULL AND length(btrim(value)) > 0 $$;

-- ============================================================
-- 1) Denetim izi: INSERT-yalnız (ADR-0007)
-- ============================================================
CREATE OR REPLACE FUNCTION ekos_forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent salt eklemelidir; % işlemi reddedildi', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ekos_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION ekos_forbid_audit_mutation();

CREATE TRIGGER ekos_audit_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION ekos_forbid_audit_mutation();

-- Uygulama rolüne yalnız INSERT/SELECT verilir (rol adı ortama özgüdür: docs/ops, Faz 1 CLI).
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM PUBLIC;

-- ============================================================
-- 2) İmzalı / salt-okunur sürüm değiştirilemez (A6)
-- ============================================================
CREATE OR REPLACE FUNCTION ekos_protect_readonly_version() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isReadOnly" THEN
      RAISE EXCEPTION 'Salt-okunur sürüm silinemez' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."isReadOnly" AND (
       NEW."sha256"        IS DISTINCT FROM OLD."sha256"
    OR NEW."fileObjectId"  IS DISTINCT FROM OLD."fileObjectId"
    OR NEW."isSigned"      IS DISTINCT FROM OLD."isSigned"
    OR NEW."isReadOnly"    IS DISTINCT FROM OLD."isReadOnly"
    OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
    OR NEW."documentId"    IS DISTINCT FROM OLD."documentId"
  ) THEN
    RAISE EXCEPTION 'Salt-okunur sürüm değiştirilemez; düzeltme yeni sürüm veya zeyilname ile yapılır'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ekos_version_readonly_guard
  BEFORE UPDATE OR DELETE ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION ekos_protect_readonly_version();

-- ============================================================
-- 3) Kapsam ve tutarlılık kısıtları
-- ============================================================
-- Üyelik: bir kullanıcı VEYA bir gruba bağlanır, ikisi birden veya hiçbiri değil.
ALTER TABLE "Membership"
  ADD CONSTRAINT ekos_membership_one_subject
  CHECK (("userId" IS NULL) <> ("groupId" IS NULL));

-- Belge yaşam döngüsü: profile göre yalnızca ilgili durum dolu olur.
ALTER TABLE "Document"
  ADD CONSTRAINT ekos_document_profile_status
  CHECK (
    ("lifecycleProfile" = 'GENERAL'  AND "generalStatus" IS NOT NULL AND "contractStatus" IS NULL)
    OR
    ("lifecycleProfile" = 'CONTRACT' AND "contractStatus" IS NOT NULL AND "generalStatus" IS NULL)
  );

-- Sözleşme tutarı ve para birimi birlikte bulunur; ISO 4217 biçimi.
ALTER TABLE "ContractRecord"
  ADD CONSTRAINT ekos_contract_amount_currency
  CHECK (("amount" IS NULL) = ("currency" IS NULL));
ALTER TABLE "ContractRecord"
  ADD CONSTRAINT ekos_contract_currency_format
  CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "Guarantee"
  ADD CONSTRAINT ekos_guarantee_amount_nonneg CHECK ("amount" >= 0);
ALTER TABLE "Guarantee"
  ADD CONSTRAINT ekos_guarantee_currency_format CHECK ("currency" ~ '^[A-Z]{3}$');

-- Red ve geri gönderme gerekçesiz olamaz.
ALTER TABLE "ApprovalDecision"
  ADD CONSTRAINT ekos_decision_reason_required
  CHECK ("decision" = 'APPROVE' OR (ekos_nonempty("reason")));

-- Break-glass: onaylayan talep edenden farklı olmalı (iki kişi ilkesi).
ALTER TABLE "BreakGlassGrant"
  ADD CONSTRAINT ekos_breakglass_two_person
  CHECK ("approverId" IS NULL OR "approverId" <> "requesterId");

-- Süre sınırı: onaylı break-glass için bitiş başlangıçtan sonra.
ALTER TABLE "BreakGlassGrant"
  ADD CONSTRAINT ekos_breakglass_window
  CHECK ("startsAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" > "startsAt");

-- Sözleşme zeyilnamesi kendi üst kaydını hedefleyemez (Prisma @@check yerine).
ALTER TABLE "ContractAmendment"
  ADD CONSTRAINT ekos_amendment_not_self
  CHECK ("parentContractId" <> "amendmentContractId");

-- Belge ilişkisi kendine olamaz.
ALTER TABLE "DocumentRelation"
  ADD CONSTRAINT ekos_relation_not_self
  CHECK ("fromDocumentId" <> "toDocumentId");

-- Sayısal aralıklar.
ALTER TABLE "ExtractionResult"
  ADD CONSTRAINT ekos_extraction_confidence_range CHECK ("confidence" >= 0 AND "confidence" <= 1);
ALTER TABLE "OCRJob"
  ADD CONSTRAINT ekos_ocr_confidence_range CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- ============================================================
-- 4) Yardımcı fonksiyonlar ve Türkçe arama altyapısı (ADR-0008)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Arama vektörü: searchText (uygulama tarafında normalizeTr ile üretilir) üzerinden üretilen kolon.
ALTER TABLE "Document"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("searchText", ''))) STORED;

CREATE INDEX ekos_document_search_vector_idx ON "Document" USING GIN ("searchVector");
CREATE INDEX ekos_document_search_trgm_idx ON "Document" USING GIN ("searchText" gin_trgm_ops);
