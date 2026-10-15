-- 0003_documents_ingest_guards — Faz 2 (belge yükleme, tarama, OCR, içe aktarım) veritabanı korumaları.
-- El yazımıdır; 0001 ve 0002'den sonra uygulanır. Sırayı değiştirmeyin.

-- ============================================================
-- 1) Dosya nesnesi (DocumentFileObject): içerik kimliği değişmez, tarama kararı geri alınamaz,
--    karantinadan çıkış yalnızca temiz taramadan sonra mümkündür.
-- ============================================================
ALTER TABLE "DocumentFileObject"
  ADD CONSTRAINT ekos_file_sha256_format CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ekos_file_size_positive CHECK ("byteSize" > 0),
  ADD CONSTRAINT ekos_file_prefix_allowed CHECK ("storagePrefix" IN ('quarantine', 'objects')),
  ADD CONSTRAINT ekos_file_key_under_prefix CHECK (starts_with("storageKey", "storagePrefix" || '/'));

CREATE OR REPLACE FUNCTION ekos_guard_file_object() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dosya nesnesi silinemez (saklama ve denetim izi)' USING ERRCODE = 'insufficient_privilege';
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

CREATE TRIGGER ekos_file_object_guard
  BEFORE UPDATE OR DELETE ON "DocumentFileObject"
  FOR EACH ROW EXECUTE FUNCTION ekos_guard_file_object();

-- ============================================================
-- 2) Taranmamış belge READY olamaz (Faz 2, madde 2 ve 4)
-- ============================================================
CREATE OR REPLACE FUNCTION ekos_guard_document_ready() RETURNS trigger AS $$
DECLARE
  v_scan "ScanStatus";
BEGIN
  IF NEW."ingestStatus" = 'READY' THEN
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

CREATE TRIGGER ekos_document_ready_guard
  BEFORE INSERT OR UPDATE OF "ingestStatus", "currentVersionId" ON "Document"
  FOR EACH ROW EXECUTE FUNCTION ekos_guard_document_ready();

-- ============================================================
-- 3) OCR işi: uydurma metin yok (Faz 2, madde 4)
-- ============================================================
ALTER TABLE "OCRJob"
  ADD CONSTRAINT ekos_ocr_attempts_nonneg CHECK ("attempts" >= 0),
  -- Başarılı iş: sonuç anahtarı ve güven zorunlu.
  ADD CONSTRAINT ekos_ocr_done_has_result CHECK (
    "status" <> 'DONE' OR ("resultStorageKey" IS NOT NULL AND "confidence" IS NOT NULL)
  ),
  -- Başarısız iş: sonuç ve güven boş kalır; metin uydurulmaz.
  ADD CONSTRAINT ekos_ocr_failed_no_result CHECK (
    "status" NOT IN ('FAILED_RETRYABLE', 'FAILED_FINAL') OR ("resultStorageKey" IS NULL AND "confidence" IS NULL)
  );

CREATE INDEX ekos_ocr_queue_idx ON "OCRJob" ("status", "createdAt");

-- ============================================================
-- 4) Toplu içe aktarım: sayaçlar tutarlı, tamamlanan iş hiçbir satırı atlamaz
-- ============================================================
ALTER TABLE "ImportBatch"
  ADD CONSTRAINT ekos_import_counts_nonneg CHECK ("totalRows" >= 0 AND "okRows" >= 0 AND "errorRows" >= 0),
  ADD CONSTRAINT ekos_import_counts_within_total CHECK ("okRows" + "errorRows" <= "totalRows"),
  ADD CONSTRAINT ekos_import_last_row_bounds CHECK ("lastRowNumber" >= 0 AND "lastRowNumber" <= "totalRows"),
  ADD CONSTRAINT ekos_import_completed_all_rows CHECK (
    "status" NOT IN ('COMPLETED', 'COMPLETED_WITH_ERRORS') OR ("okRows" + "errorRows" = "totalRows")
  ),
  ADD CONSTRAINT ekos_import_completed_errors_consistent CHECK (
    "status" <> 'COMPLETED' OR "errorRows" = 0
  ),
  ADD CONSTRAINT ekos_import_kind_nonempty CHECK (ekos_nonempty("kind"));

ALTER TABLE "ImportRowResult"
  ADD CONSTRAINT ekos_import_row_number_positive CHECK ("rowNumber" >= 1),
  ADD CONSTRAINT ekos_import_row_error_has_code CHECK (
    ("status" = 'ERROR' AND "errorCode" IS NOT NULL AND ekos_nonempty("errorCode"))
    OR ("status" <> 'ERROR' AND "errorCode" IS NULL)
  );

-- Satır sonuçları ekleme-yalnız: bir kez yazılan sonuç değiştirilemez, silinemez.
CREATE OR REPLACE FUNCTION ekos_forbid_import_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'İçe aktarım satır sonucu değiştirilemez/silinemez (%)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ekos_import_row_append_only
  BEFORE UPDATE OR DELETE ON "ImportRowResult"
  FOR EACH ROW EXECUTE FUNCTION ekos_forbid_import_row_mutation();
