-- Faz 6: entegrasyon olayı idempotensi, dış kayıt referansları, RAG metin parçaları, OIDC giriş durumu.
-- Elle yazıldı: "searchVector" üretilmiş (GENERATED) kolon Prisma şemasında yoktur; migrate diff bunu düşürmeye çalışabilir.

CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "externalEventId" VARCHAR(200) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "errorCode" VARCHAR(80),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");

CREATE TABLE "ExternalRecordRef" (
    "id" UUID NOT NULL,
    "sourceSystem" VARCHAR(80) NOT NULL,
    "externalId" VARCHAR(300) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" UUID NOT NULL,
    "requestedById" UUID,
    "lastSyncedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalRecordRef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExternalRecordRef_sourceSystem_externalId_key" ON "ExternalRecordRef"("sourceSystem", "externalId");
CREATE INDEX "ExternalRecordRef_entityType_entityId_idx" ON "ExternalRecordRef"("entityType", "entityId");

CREATE TABLE "DocumentTextChunk" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "fileObjectId" UUID NOT NULL,
    "page" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "normText" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchVector" TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce("normText", ''))) STORED,
    CONSTRAINT "DocumentTextChunk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentTextChunk_documentId_fileObjectId_page_ordinal_key" ON "DocumentTextChunk"("documentId", "fileObjectId", "page", "ordinal");
CREATE INDEX "ekos_chunk_search_vector_idx" ON "DocumentTextChunk" USING GIN ("searchVector");
CREATE INDEX "DocumentTextChunk_fileObjectId_idx" ON "DocumentTextChunk"("fileObjectId");
ALTER TABLE "DocumentTextChunk" ADD CONSTRAINT "DocumentTextChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DocumentTextChunk" ADD CONSTRAINT "DocumentTextChunk_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "DocumentFileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "OidcLoginRequest" (
    "state" VARCHAR(120) NOT NULL,
    "nonce" VARCHAR(120) NOT NULL,
    "codeVerifier" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "OidcLoginRequest_pkey" PRIMARY KEY ("state")
);
