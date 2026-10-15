-- Faz 2 düzeltmesi: salt-okunur sürümde gerekçe ve oluşturan da korunur (denetim izi).
-- supersededAt yalnızca sürüm kilitlenirken (isReadOnly false→true aynı UPDATE) bir kez yazılabilir.
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
