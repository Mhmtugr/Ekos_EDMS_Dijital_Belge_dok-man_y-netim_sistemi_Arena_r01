-- Faz 3 (R-LC-04): imza kanıtı tablosu. ACTIVE geçişi bu kayıt olmadan servis katmanında reddedilir.
CREATE TABLE "ContractSignatureEvidence" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "documentVersionId" UUID NOT NULL,
    "signedAt" TIMESTAMPTZ(6) NOT NULL,
    "signatureMethod" VARCHAR(80) NOT NULL,
    "signerSummary" VARCHAR(1000) NOT NULL,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractSignatureEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ekos_signature_method_nonempty" CHECK (length(btrim("signatureMethod")) > 0),
    CONSTRAINT "ekos_signature_signer_nonempty" CHECK (length(btrim("signerSummary")) > 0)
);

CREATE UNIQUE INDEX "ContractSignatureEvidence_documentVersionId_key" ON "ContractSignatureEvidence"("documentVersionId");
CREATE INDEX "ContractSignatureEvidence_contractId_idx" ON "ContractSignatureEvidence"("contractId");

ALTER TABLE "ContractSignatureEvidence" ADD CONSTRAINT "ContractSignatureEvidence_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ContractSignatureEvidence" ADD CONSTRAINT "ContractSignatureEvidence_documentVersionId_fkey"
    FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
