-- 0012_faz4_closeout — Faz 4 açık kalemleri: ayrılış iptali, mali yıl sonu takvimi.
-- El yazımıdır; 0011'den sonra uygulanır. Sırayı değiştirmeyin.

-- 1) Ayrılış dosyası iptali (çalışan kurumda kalır)
ALTER TABLE "OffboardingCase"
  ADD COLUMN "cancelledById" UUID,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(6),
  ADD COLUMN "cancelReason" VARCHAR(2000),
  ADD CONSTRAINT "ekos_off_cancel_complete" CHECK (
    "status" <> 'CANCELLED'
    OR ("cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0 AND "completedAt" IS NULL)
  );

-- 2) Mali yıl sonu takvimi
CREATE TABLE "FiscalYearEnd" (
  "id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "endDate" DATE NOT NULL,
  "setById" UUID NOT NULL,
  "setAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rowVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "FiscalYearEnd_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiscalYearEnd_year_key" UNIQUE ("year"),
  CONSTRAINT "ekos_fy_year_range" CHECK ("year" BETWEEN 1900 AND 2200),
  CONSTRAINT "ekos_fy_end_in_year" CHECK (EXTRACT(YEAR FROM "endDate") = "year")
);
