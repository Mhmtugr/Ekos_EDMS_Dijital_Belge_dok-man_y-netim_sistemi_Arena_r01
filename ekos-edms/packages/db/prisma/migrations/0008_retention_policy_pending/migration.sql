-- Saklama politikası "bekliyor" durumu: başlangıç olayı ve imha yöntemi kurum tarafından girilene kadar boş olabilir.
-- Hukuk onaylı (verifiedByLegal=true) profil ise bu alanları ZORUNLU taşır; otomatik imha yalnızca onaylı profille mümkündür.
ALTER TABLE "RetentionProfile" ALTER COLUMN "startEvent" DROP NOT NULL;
ALTER TABLE "RetentionProfile" ALTER COLUMN "disposalMethod" DROP NOT NULL;

ALTER TABLE "RetentionProfile"
  ADD CONSTRAINT "ekos_retention_verified_complete"
  CHECK ("verifiedByLegal" = false OR ("startEvent" IS NOT NULL AND "disposalMethod" IS NOT NULL));
