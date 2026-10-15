-- TOTP (ikinci doğrulama faktörü): şifreli sır, etkinleşme zamanı ve tekrar kullanım koruması.
ALTER TABLE "User"
  ADD COLUMN "totpSecretCipher" VARCHAR(512),
  ADD COLUMN "totpEnabledAt" TIMESTAMPTZ(6),
  ADD COLUMN "totpLastStep" BIGINT;

ALTER TABLE "User"
  ADD CONSTRAINT "ekos_user_totp_enabled_has_secret"
  CHECK ("totpEnabledAt" IS NULL OR "totpSecretCipher" IS NOT NULL);
