-- Faz 2: kayıtlı arama görünümleri (yalnızca sahibi görür).
CREATE TABLE "SavedView" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "criteria" JSONB NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedView_ownerId_name_key" ON "SavedView"("ownerId", "name");

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
