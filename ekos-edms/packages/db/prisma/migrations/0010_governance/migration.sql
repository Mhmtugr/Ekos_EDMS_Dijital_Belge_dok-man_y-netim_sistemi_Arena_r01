-- 0010_governance — Faz 4: saklama, hukuki bekletme, imha, personel ayrılışı/devri, kırılma-cam.
-- El yazımıdır; 0001..0009'dan sonra uygulanır. Sırayı değiştirmeyin.

-- ============================================================
-- 1) Alan eklemeleri
-- ============================================================
ALTER TABLE "RetentionProfile"
  ADD COLUMN "requiresLegalReview" BOOLEAN NOT NULL DEFAULT false,
  -- İmha onaycıları (kurum tarafından tanımlanır). İmha için en az iki farklı onaycı gerekir (uygulama kuralı).
  ADD COLUMN "disposalApproverIds" UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE "DispositionReview"
  ADD COLUMN "extendedUntil" DATE,
  ADD COLUMN "physicalEvidenceRef" VARCHAR(300),
  ADD CONSTRAINT "ekos_disp_extended_has_date" CHECK ("status" <> 'EXTENDED' OR "extendedUntil" IS NOT NULL),
  ADD CONSTRAINT "ekos_disp_physical_ref_nonempty" CHECK ("physicalEvidenceRef" IS NULL OR length(btrim("physicalEvidenceRef")) > 0);

ALTER TABLE "BreakGlassGrant"
  ADD COLUMN "permissionCode" VARCHAR(80),
  ADD CONSTRAINT "ekos_bg_approved_complete" CHECK (
    "status" <> 'APPROVED'
    OR ("permissionCode" IS NOT NULL AND "approverId" IS NOT NULL AND "startsAt" IS NOT NULL AND "expiresAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "ekos_bg_window" CHECK ("expiresAt" IS NULL OR "startsAt" IS NULL OR "expiresAt" > "startsAt"),
  ADD CONSTRAINT "ekos_bg_no_self_approval" CHECK ("approverId" IS NULL OR "approverId" <> "requesterId");

-- ============================================================
-- 2) Tetikleyici olay (MANUAL_EVENT başlangıcı) — belge başına, geçmiş korunur
-- ============================================================
CREATE TABLE "RetentionTriggerEvent" (
  "id"           UUID PRIMARY KEY,
  "documentId"   UUID NOT NULL,
  "eventDate"    DATE NOT NULL,
  "note"         VARCHAR(1000) NOT NULL,
  "recordedById" UUID NOT NULL,
  "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ekos_trigger_note_nonempty" CHECK (length(btrim("note")) > 0),
  CONSTRAINT "RetentionTriggerEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "RetentionTriggerEvent_documentId_idx" ON "RetentionTriggerEvent"("documentId");

-- ============================================================
-- 3) Personel ayrılışı ve sorumluluk devri
-- ============================================================
CREATE TYPE "OffboardingCaseStatus" AS ENUM ('OPEN', 'COMPLETED');
CREATE TYPE "OffboardingItemKind" AS ENUM ('DOCUMENT_OWNER', 'CONTRACT_ROLE', 'APPROVAL_TASK', 'OBLIGATION_RESPONSIBLE');
CREATE TYPE "OffboardingItemStatus" AS ENUM ('OPEN', 'TRANSFERRED', 'WAIVED');

CREATE TABLE "OffboardingCase" (
  "id"                 UUID PRIMARY KEY,
  "userId"             UUID NOT NULL,
  "status"             "OffboardingCaseStatus" NOT NULL DEFAULT 'OPEN',
  "reason"             VARCHAR(2000) NOT NULL,
  -- Yapılandırılabilir: true ise devredilmemiş sorumluluk varken hesap kapatılamaz.
  "blockOnUnresolved"  BOOLEAN NOT NULL,
  "openedById"         UUID NOT NULL,
  "openedAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedById"      UUID,
  "completedAt"        TIMESTAMPTZ(6),
  "rowVersion"         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ekos_offb_reason_nonempty" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "ekos_offb_completed_complete" CHECK (
    "status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL)
  ),
  CONSTRAINT "OffboardingCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- Aynı kullanıcı için aynı anda yalnız bir açık ayrılış dosyası.
CREATE UNIQUE INDEX "OffboardingCase_one_open_per_user" ON "OffboardingCase"("userId") WHERE "status" = 'OPEN';

CREATE TABLE "OffboardingItem" (
  "id"              UUID PRIMARY KEY,
  "caseId"          UUID NOT NULL,
  "kind"            "OffboardingItemKind" NOT NULL,
  "targetId"        UUID NOT NULL,
  -- Devredilen alanın adı (ör. ownerId, businessOwnerId, assigneeId). Yalnız sunucu tarafından atanan sabitler.
  "field"           VARCHAR(60) NOT NULL,
  "status"          "OffboardingItemStatus" NOT NULL DEFAULT 'OPEN',
  "toUserId"        UUID,
  "decidedById"     UUID,
  "decidedAt"       TIMESTAMPTZ(6),
  "note"            VARCHAR(1000),
  "rowVersion"      INTEGER NOT NULL DEFAULT 1,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ekos_offb_item_transferred" CHECK ("status" <> 'TRANSFERRED' OR "toUserId" IS NOT NULL),
  CONSTRAINT "ekos_offb_item_waived_note" CHECK ("status" <> 'WAIVED' OR (length(btrim(coalesce("note", ''))) > 0)),
  CONSTRAINT "ekos_offb_item_decided" CHECK ("status" = 'OPEN' OR ("decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)),
  CONSTRAINT "OffboardingItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "OffboardingCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "OffboardingItem_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ekos_offb_item_unique" UNIQUE ("caseId", "kind", "targetId", "field")
);
CREATE INDEX "OffboardingItem_caseId_status_idx" ON "OffboardingItem"("caseId", "status");

-- ============================================================
-- 4) İmha koruması (veritabanı katmanı)
--    Belge verisi (dosya nesnesi, sürüm, OCR işi, çıkarım) yalnızca:
--      (a) oturum yerel ayarı ekos.disposal_document_id bu belgeye eşitse,
--      (b) belgenin hiçbir açık hukuki bekletmesi yoksa,
--      (c) belgenin APPROVED imha kararı varsa
--    silinebilir. Uygulama bu ayarı yalnızca imha yürütücüsünde, aynı işlemde set eder.
-- ============================================================
CREATE OR REPLACE FUNCTION ekos_assert_disposal_scope(p_doc uuid) RETURNS void AS $$
DECLARE
  v_ctx text;
BEGIN
  v_ctx := current_setting('ekos.disposal_document_id', true);
  IF v_ctx IS NULL OR v_ctx = '' OR p_doc IS NULL OR p_doc::text <> v_ctx THEN
    RAISE EXCEPTION 'Belge verisi yalnızca onaylı imha yürütmesi kapsamında silinebilir'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM "LegalHold" WHERE "documentId" = p_doc AND "releasedAt" IS NULL) THEN
    RAISE EXCEPTION 'Yasal bekletme aktifken imha veya silme yapılamaz'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "DispositionReview" WHERE "documentId" = p_doc AND "status" = 'APPROVED') THEN
    RAISE EXCEPTION 'Belge için onaylanmış imha kararı yok'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Dosya nesnesi: silme yalnızca imha kapsamında (sürüm üzerinden belge bulunur).
CREATE OR REPLACE FUNCTION ekos_guard_file_object() RETURNS trigger AS $$
DECLARE
  v_doc uuid;
  v_list text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT v."documentId" INTO v_doc FROM "DocumentVersion" v WHERE v."fileObjectId" = OLD."id";
    IF FOUND THEN
      PERFORM ekos_assert_disposal_scope(v_doc);
      RETURN OLD;
    END IF;
    -- Sürümü önceden silinmiş nesne: yalnızca yürütücünün bu işlemde açıkça listelediği kimlikler silinebilir.
    v_list := coalesce(current_setting('ekos.disposal_file_object_ids', true), '');
    IF v_list = '' OR position(OLD."id"::text IN v_list) = 0 THEN
      RAISE EXCEPTION 'Sürümsüz dosya nesnesi imha kapsamı dışında; silinemez' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM ekos_assert_disposal_scope(NULLIF(current_setting('ekos.disposal_document_id', true), '')::uuid);
    RETURN OLD;
  END IF;

  -- Tek izinli taşıma: quarantine/... → objects/... yalnızca tarama CLEAN olduğunda (aynı son ek ile).
  IF NEW."storageKey" IS DISTINCT FROM OLD."storageKey" OR NEW."storagePrefix" IS DISTINCT FROM OLD."storagePrefix" THEN
    IF NOT (
          OLD."storagePrefix" = 'quarantine' AND NEW."storagePrefix" = 'objects'
      AND OLD."scanStatus" <> 'CLEAN' AND NEW."scanStatus" = 'CLEAN'
      AND NEW."storageKey" = 'objects/' || substr(OLD."storageKey", length('quarantine/') + 1)
    ) THEN
      RAISE EXCEPTION 'Dosya anahtarı yalnızca temiz taramadan sonra karantinadan çıkarılabilir'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW."sha256" IS DISTINCT FROM OLD."sha256"
     OR NEW."byteSize" IS DISTINCT FROM OLD."byteSize"
     OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
     OR NEW."originalFileName" IS DISTINCT FROM OLD."originalFileName" THEN
    RAISE EXCEPTION 'Dosya içeriği kimliği (hash, anahtar, boyut, tür) değiştirilemez'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Tarama kararı: CLEAN ve INFECTED kesindir; UNAVAILABLE yeniden taranabilir, PENDING her duruma geçebilir.
  IF OLD."scanStatus" IN ('CLEAN', 'INFECTED') AND NEW."scanStatus" IS DISTINCT FROM OLD."scanStatus" THEN
    RAISE EXCEPTION 'Kesin tarama kararı (%) değiştirilemez', OLD."scanStatus"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Salt-okunur sürüm: silme yalnızca imha kapsamında. Değişmezlik kuralları aynen korunur (0004).
CREATE OR REPLACE FUNCTION ekos_protect_readonly_version() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isReadOnly" THEN
      PERFORM ekos_assert_disposal_scope(OLD."documentId");
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
    OR NEW."changeReason"  IS DISTINCT FROM OLD."changeReason"
    OR NEW."createdBy"     IS DISTINCT FROM OLD."createdBy"
    OR NEW."createdAt"     IS DISTINCT FROM OLD."createdAt"
    OR (OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt")
  ) THEN
    RAISE EXCEPTION 'Salt-okunur sürüm değiştirilemez; düzeltme yeni sürüm veya zeyilname ile yapılır'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Belge READY kontrolü: imha edilmiş (DISPOSED) belge, sürümü silindiği için READY kuralından muaftır.
CREATE OR REPLACE FUNCTION ekos_guard_document_ready() RETURNS trigger AS $$
DECLARE
  v_scan "ScanStatus";
BEGIN
  IF NEW."ingestStatus" = 'READY' AND NEW."generalStatus" IS DISTINCT FROM 'DISPOSED' THEN
    IF NEW."currentVersionId" IS NULL THEN
      RAISE EXCEPTION 'READY belgenin geçerli bir sürümü olmalı' USING ERRCODE = 'check_violation';
    END IF;

    SELECT f."scanStatus" INTO v_scan
    FROM "DocumentVersion" v
    JOIN "DocumentFileObject" f ON f."id" = v."fileObjectId"
    WHERE v."id" = NEW."currentVersionId";

    IF v_scan IS DISTINCT FROM 'CLEAN' THEN
      RAISE EXCEPTION 'Taranmamış veya bulaşmış dosyalı belge READY olamaz (tarama: %)', COALESCE(v_scan::text, 'YOK')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Açık hukuki bekletme varken belge IMHA EDİLMİŞ olamaz (durum ve bekletme birlikte tutarlı).
CREATE OR REPLACE FUNCTION ekos_guard_disposed_not_held() RETURNS trigger AS $$
BEGIN
  IF NEW."generalStatus" = 'DISPOSED' AND EXISTS (
    SELECT 1 FROM "LegalHold" h WHERE h."documentId" = NEW."id" AND h."releasedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Yasal bekletme altındaki belge IMHA EDİLMİŞ olarak işaretlenemez'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ekos_document_disposed_not_held
  BEFORE UPDATE OF "generalStatus" ON "Document"
  FOR EACH ROW EXECUTE FUNCTION ekos_guard_disposed_not_held();
