-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."IngestStatus" AS ENUM ('QUARANTINED', 'PROCESSING', 'METADATA_PENDING', 'READY', 'REJECTED', 'FAILED_RETRYABLE');

-- CreateEnum
CREATE TYPE "public"."GeneralLifecycleStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'DISPOSAL_REVIEW', 'DISPOSED');

-- CreateEnum
CREATE TYPE "public"."ContractLifecycleStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'READY_FOR_SIGNATURE', 'PENDING_SIGNATURE', 'ACTIVE', 'AMENDMENT_PENDING', 'RENEWAL_REVIEW', 'EXPIRED', 'TERMINATED', 'CANCELLED', 'ARCHIVED', 'DISPOSAL_REVIEW', 'DISPOSED', 'INVALID');

-- CreateEnum
CREATE TYPE "public"."LifecycleProfile" AS ENUM ('GENERAL', 'CONTRACT');

-- CreateEnum
CREATE TYPE "public"."ConfidentialityLevel" AS ENUM ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED', 'HIGHLY_RESTRICTED');

-- CreateEnum
CREATE TYPE "public"."IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED_UNVERIFIED', 'CONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."SettingStatus" AS ENUM ('COMPLETED', 'UNVERIFIED', 'REQUIRED', 'OPTIONAL', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."FieldSource" AS ENUM ('MANUAL', 'AI_SUGGESTED_VERIFIED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "public"."ContractOrigin" AS ENUM ('MANUAL', 'IMPORTED_HISTORICAL');

-- CreateEnum
CREATE TYPE "public"."NeedsVerification" AS ENUM ('VERIFIED', 'NEEDS_MANUAL_VERIFICATION');

-- CreateEnum
CREATE TYPE "public"."AiValidationStatus" AS ENUM ('SUGGESTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "public"."CounterpartyStatus" AS ENUM ('ACTIVE', 'PASSIVE');

-- CreateEnum
CREATE TYPE "public"."MetadataType" AS ENUM ('TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'BOOLEAN', 'ENUM', 'REFERENCE');

-- CreateEnum
CREATE TYPE "public"."ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "public"."AclEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "public"."RelationType" AS ENUM ('PARENT_CHILD', 'ATTACHMENT', 'REVISION', 'ORDER_INVOICE', 'CONTRACT_DOCUMENT', 'AMENDMENT');

-- CreateEnum
CREATE TYPE "public"."ContractDirection" AS ENUM ('PURCHASE', 'SALE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."NoticeUnit" AS ENUM ('CALENDAR_DAYS', 'CALENDAR_MONTHS');

-- CreateEnum
CREATE TYPE "public"."RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."ContractPartyRole" AS ENUM ('COUNTERPARTY', 'GUARANTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ObligationStatus" AS ENUM ('OPEN', 'FULFILLED', 'OVERDUE', 'NEEDS_MANUAL_VERIFICATION');

-- CreateEnum
CREATE TYPE "public"."DeadlineType" AS ENUM ('CONTRACT_END', 'NOTICE_DEADLINE', 'RENEWAL', 'GUARANTEE_EXPIRY', 'INSURANCE_EXPIRY', 'OBLIGATION_DUE', 'PRICE_UPDATE', 'APPROVAL_TASK');

-- CreateEnum
CREATE TYPE "public"."GuaranteeType" AS ENUM ('LETTER_OF_GUARANTEE', 'PERFORMANCE_GUARANTEE', 'INSURANCE_POLICY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RenewalBasis" AS ENUM ('AUTO_RENEW', 'MANUAL_RENEW', 'NO_RENEW');

-- CreateEnum
CREATE TYPE "public"."WorkflowVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."WorkflowInstanceStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'REJECTED', 'RETURNED', 'CANCELLED', 'BLOCKED_MISSING_CONFIG');

-- CreateEnum
CREATE TYPE "public"."StepMode" AS ENUM ('SEQUENTIAL', 'PARALLEL');

-- CreateEnum
CREATE TYPE "public"."QuorumRule" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "public"."ApprovalTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'DELEGATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ApprovalDecisionType" AS ENUM ('APPROVE', 'REJECT', 'RETURN');

-- CreateEnum
CREATE TYPE "public"."RetentionStartEvent" AS ENUM ('DOCUMENT_CREATED', 'CONTRACT_END', 'FISCAL_YEAR_END', 'MANUAL_EVENT');

-- CreateEnum
CREATE TYPE "public"."RetentionUnit" AS ENUM ('CALENDAR_DAYS', 'CALENDAR_MONTHS', 'CALENDAR_YEARS');

-- CreateEnum
CREATE TYPE "public"."DisposalMethod" AS ENUM ('DIGITAL_DELETE', 'PHYSICAL_DESTRUCTION_RECORD');

-- CreateEnum
CREATE TYPE "public"."DispositionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'EXTENDED', 'REJECTED', 'BLOCKED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "public"."DispositionDecisionType" AS ENUM ('APPROVE', 'EXTEND', 'REJECT');

-- CreateEnum
CREATE TYPE "public"."DispositionRole" AS ENUM ('REVIEWER', 'SECOND_APPROVER');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'TEAMS');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "public"."ScheduledEventStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'FIRED');

-- CreateEnum
CREATE TYPE "public"."ImportBatchStatus" AS ENUM ('VALIDATING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ImportRowStatus" AS ENUM ('OK', 'ERROR', 'SKIPPED_DUPLICATE', 'CONFLICT');

-- CreateEnum
CREATE TYPE "public"."OcrJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "public"."BackgroundJobStatus" AS ENUM ('QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "public"."BreakGlassStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."AuditActorType" AS ENUM ('USER', 'SYSTEM', 'WORKER', 'BREAK_GLASS');

-- CreateEnum
CREATE TYPE "public"."AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."SecurityEventType" AS ENUM ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'SESSION_REVOKED', 'USER_DISABLED', 'PERMISSION_CHANGED', 'UPLOAD_REJECTED', 'EXPORT_VOLUME_ALERT');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "passwordHash" VARCHAR(255),
    "totpSecretRef" VARCHAR(200),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "departmentId" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Group" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupMember" (
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

-- CreateTable
CREATE TABLE "public"."Role" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "isSystemTemplate" BOOLEAN NOT NULL DEFAULT false,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "groupId" UUID,
    "roleId" UUID NOT NULL,
    "departmentIds" UUID[],
    "documentTypeIds" UUID[],
    "counterpartyIds" UUID[],
    "projectIds" UUID[],
    "maxConfidentiality" "public"."ConfidentialityLevel",
    "documentId" UUID,
    "validFrom" TIMESTAMPTZ(6),
    "validUntil" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "revokedBy" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IdentityProviderMapping" (
    "id" UUID NOT NULL,
    "providerKey" VARCHAR(80) NOT NULL,
    "externalGroupId" VARCHAR(200) NOT NULL,
    "roleId" UUID NOT NULL,
    "groupId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "IdentityProviderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Delegation" (
    "id" UUID NOT NULL,
    "delegatorId" UUID NOT NULL,
    "delegateId" UUID NOT NULL,
    "scope" JSONB NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LegalEntity" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "taxNumber" VARCHAR(40),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Department" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legalEntityId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Site" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Project" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "siteId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Counterparty" (
    "id" UUID NOT NULL,
    "officialName" VARCHAR(300) NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "supplierCode" VARCHAR(60),
    "taxId" VARCHAR(40),
    "status" "public"."CounterpartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CounterpartyContact" (
    "id" UUID NOT NULL,
    "counterpartyId" UUID NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "roleTitle" VARCHAR(200),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "CounterpartyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentType" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "defaultConfidentiality" "public"."ConfidentialityLevel" NOT NULL,
    "requiredMetadataKeys" VARCHAR(80)[],
    "ocrRequired" BOOLEAN NOT NULL DEFAULT false,
    "retentionProfileId" UUID,
    "permissionTemplate" JSONB,
    "notificationRules" JSONB,
    "isSystemCatalog" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MetadataDefinition" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "dataType" "public"."MetadataType" NOT NULL,
    "enumValues" VARCHAR(200)[],
    "isSearchable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "MetadataDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MetadataValue" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(19,4),
    "valueDate" DATE,
    "valueBoolean" BOOLEAN,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "MetadataValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Document" (
    "id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "title" VARCHAR(400) NOT NULL,
    "typeId" UUID NOT NULL,
    "departmentId" UUID,
    "ownerId" UUID NOT NULL,
    "confidentiality" "public"."ConfidentialityLevel" NOT NULL,
    "ingestStatus" "public"."IngestStatus" NOT NULL DEFAULT 'QUARANTINED',
    "lifecycleProfile" "public"."LifecycleProfile" NOT NULL DEFAULT 'GENERAL',
    "generalStatus" "public"."GeneralLifecycleStatus",
    "contractStatus" "public"."ContractLifecycleStatus",
    "currentVersionId" UUID,
    "legalHoldActive" BOOLEAN NOT NULL DEFAULT false,
    "retentionProfileId" UUID,
    "searchText" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentVersion" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileObjectId" UUID,
    "sha256" CHAR(64) NOT NULL,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "isSigned" BOOLEAN NOT NULL DEFAULT false,
    "changeReason" VARCHAR(1000),
    "supersededAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentFileObject" (
    "id" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "storagePrefix" VARCHAR(20) NOT NULL,
    "originalFileName" VARCHAR(260) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scanStatus" "public"."ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "DocumentFileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentAcl" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "subjectUserId" UUID,
    "subjectGroupId" UUID,
    "subjectRoleId" UUID,
    "effect" "public"."AclEffect" NOT NULL,
    "permissionCode" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "DocumentAcl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentRelation" (
    "id" UUID NOT NULL,
    "fromDocumentId" UUID NOT NULL,
    "toDocumentId" UUID NOT NULL,
    "relationType" "public"."RelationType" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "DocumentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PhysicalArchiveLocation" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "box" VARCHAR(80),
    "file" VARCHAR(80),
    "shelf" VARCHAR(80),
    "custodianId" UUID,
    "originalVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMPTZ(6),
    "verifiedBy" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "PhysicalArchiveLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractRecord" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "institutionalNo" VARCHAR(80),
    "title" VARCHAR(400) NOT NULL,
    "contractType" VARCHAR(80) NOT NULL,
    "direction" "public"."ContractDirection" NOT NULL,
    "counterpartyId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "departmentId" UUID,
    "businessOwnerId" UUID,
    "requesterId" UUID,
    "contractManagerId" UUID,
    "legalReviewerId" UUID,
    "amount" DECIMAL(19,4),
    "currency" CHAR(3),
    "paymentTerms" VARCHAR(1000),
    "effectiveDate" DATE,
    "startDate" DATE,
    "endDate" DATE,
    "autoRenewal" BOOLEAN,
    "noticePeriodValue" INTEGER,
    "noticePeriodUnit" "public"."NoticeUnit",
    "lastNoticeDate" DATE,
    "terminationClauseRef" VARCHAR(200),
    "deliveryCriteria" VARCHAR(2000),
    "riskLevel" "public"."RiskLevel",
    "relatedProjectId" UUID,
    "fieldSource" "public"."FieldSource" NOT NULL DEFAULT 'MANUAL',
    "origin" "public"."ContractOrigin" NOT NULL DEFAULT 'MANUAL',
    "lastVerifiedAt" TIMESTAMPTZ(6),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "ContractRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractParty" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "counterpartyId" UUID NOT NULL,
    "role" "public"."ContractPartyRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "ContractParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Obligation" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "sourcePage" INTEGER,
    "clauseRef" VARCHAR(200),
    "description" VARCHAR(2000) NOT NULL,
    "responsibleUserId" UUID,
    "dueDate" DATE,
    "recurrence" VARCHAR(200),
    "evidenceDocumentId" UUID,
    "status" "public"."ObligationStatus" NOT NULL DEFAULT 'OPEN',
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractDeadline" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "deadlineType" "public"."DeadlineType" NOT NULL,
    "deadlineDate" DATE,
    "verification" "public"."NeedsVerification" NOT NULL DEFAULT 'NEEDS_MANUAL_VERIFICATION',
    "renewalRuleId" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "ContractDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Guarantee" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "guaranteeType" "public"."GuaranteeType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "issuer" VARCHAR(300) NOT NULL,
    "referenceNo" VARCHAR(120) NOT NULL,
    "expiresAt" DATE,
    "returnedAt" DATE,
    "documentId" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "Guarantee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RenewalRule" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "basis" "public"."RenewalBasis" NOT NULL,
    "noticeValue" INTEGER,
    "noticeUnit" "public"."NoticeUnit",
    "sourceClauseRef" VARCHAR(200),
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(6),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "RenewalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractAmendment" (
    "id" UUID NOT NULL,
    "parentContractId" UUID NOT NULL,
    "amendmentContractId" UUID NOT NULL,
    "amendmentNo" VARCHAR(40) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "effectiveDate" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "ContractAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkflowDefinition" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkflowDefinitionVersion" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "public"."WorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ(6),
    "publishedBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "WorkflowDefinitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkflowInstance" (
    "id" UUID NOT NULL,
    "definitionVersionId" UUID NOT NULL,
    "subjectType" VARCHAR(40) NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" "public"."WorkflowInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedById" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),
    "endReason" VARCHAR(2000),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkflowStep" (
    "id" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "mode" "public"."StepMode" NOT NULL DEFAULT 'SEQUENTIAL',
    "quorum" "public"."QuorumRule" NOT NULL DEFAULT 'ALL',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApprovalTask" (
    "id" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "status" "public"."ApprovalTaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMPTZ(6),
    "delegatedFromId" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApprovalDecision" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "decision" "public"."ApprovalDecisionType" NOT NULL,
    "reason" VARCHAR(2000),
    "actorId" UUID NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RetentionProfile" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "responsibleId" UUID,
    "basisNote" VARCHAR(2000),
    "startEvent" "public"."RetentionStartEvent" NOT NULL,
    "durationValue" INTEGER,
    "durationUnit" "public"."RetentionUnit",
    "effectiveFrom" DATE NOT NULL,
    "reviewDueAt" DATE,
    "disposalMethod" "public"."DisposalMethod" NOT NULL,
    "verifiedByLegal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "RetentionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RetentionRuleVersion" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "validFrom" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "RetentionRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LegalHold" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "scopeNote" VARCHAR(1000),
    "placedById" UUID NOT NULL,
    "placedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" UUID,
    "releasedAt" TIMESTAMPTZ(6),
    "releaseReason" VARCHAR(2000),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DispositionReview" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "status" "public"."DispositionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "blockedReason" VARCHAR(500),
    "retentionDueAt" DATE,
    "retentionProfileId" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "DispositionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DispositionDecision" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "role" "public"."DispositionRole" NOT NULL,
    "decision" "public"."DispositionDecisionType" NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispositionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DisposalManifest" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestSha256" CHAR(64) NOT NULL,
    "policyVersionId" UUID,
    "executedAt" TIMESTAMPTZ(6) NOT NULL,
    "physicalEvidenceRef" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisposalManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "subjectType" VARCHAR(40),
    "subjectId" UUID,
    "dedupeKey" VARCHAR(300),
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationDeliveryAttempt" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "status" "public"."DeliveryStatus" NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "errorCode" VARCHAR(80),
    "errorMessage" VARCHAR(500),
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScheduledEvent" (
    "id" UUID NOT NULL,
    "subjectType" VARCHAR(40) NOT NULL,
    "subjectId" UUID NOT NULL,
    "deadlineType" VARCHAR(40) NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "deadlineDate" DATE NOT NULL,
    "status" "public"."ScheduledEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ScheduledEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportBatch" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" "public"."ImportBatchStatus" NOT NULL DEFAULT 'VALIDATING',
    "fileObjectId" UUID NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "okRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "lastRowNumber" INTEGER NOT NULL DEFAULT 0,
    "startedById" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportRowResult" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "public"."ImportRowStatus" NOT NULL,
    "errorCode" VARCHAR(80),
    "errorMessage" VARCHAR(500),
    "rawRowHash" CHAR(64) NOT NULL,
    "createdEntityId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OCRJob" (
    "id" UUID NOT NULL,
    "fileObjectId" UUID NOT NULL,
    "status" "public"."OcrJobStatus" NOT NULL DEFAULT 'QUEUED',
    "languages" VARCHAR(40) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "confidence" DECIMAL(5,4),
    "resultStorageKey" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OCRJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExtractionResult" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "fieldKey" VARCHAR(80) NOT NULL,
    "value" VARCHAR(2000),
    "sourcePage" INTEGER,
    "textStart" INTEGER,
    "textEnd" INTEGER,
    "confidence" DECIMAL(5,4) NOT NULL,
    "validation" "public"."AiValidationStatus" NOT NULL DEFAULT 'SUGGESTED',
    "providerKey" VARCHAR(80) NOT NULL,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IntegrationConnection" (
    "id" UUID NOT NULL,
    "integrationKey" VARCHAR(80) NOT NULL,
    "status" "public"."IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "secretRef" VARCHAR(200),
    "lastSyncAt" TIMESTAMPTZ(6),
    "lastError" VARCHAR(500),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SyncRun" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "status" VARCHAR(40) NOT NULL,
    "externalWatermark" VARCHAR(200),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BackgroundJob" (
    "id" UUID NOT NULL,
    "queue" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "payloadRef" JSONB NOT NULL,
    "status" "public"."BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "idempotencyKey" VARCHAR(200),
    "runAfter" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobFailure" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "errorCode" VARCHAR(80) NOT NULL,
    "errorMessage" VARCHAR(500) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BreakGlassGrant" (
    "id" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "approverId" UUID,
    "subjectType" VARCHAR(40) NOT NULL,
    "subjectId" UUID NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "status" "public"."BreakGlassStatus" NOT NULL DEFAULT 'REQUESTED',
    "startsAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakGlassGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SystemSetting" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "valueJson" JSONB,
    "secretRef" VARCHAR(200),
    "status" "public"."SettingStatus" NOT NULL DEFAULT 'REQUIRED',
    "secondApproverId" UUID,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NumberSequence" (
    "id" UUID NOT NULL,
    "typeCode" VARCHAR(20) NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "actorType" "public"."AuditActorType" NOT NULL,
    "actorId" UUID,
    "eventType" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" UUID,
    "targetVersion" INTEGER,
    "outcome" "public"."AuditOutcome" NOT NULL,
    "reason" VARCHAR(1000),
    "correlationId" VARCHAR(64) NOT NULL,
    "requestId" VARCHAR(64),
    "sourceIp" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "beforeSummary" JSONB,
    "afterSummary" JSONB,
    "prevHash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SecurityEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "public"."SecurityEventType" NOT NULL,
    "userId" UUID,
    "sourceIp" VARCHAR(64),
    "correlationId" VARCHAR(64) NOT NULL,
    "details" JSONB,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "public"."Group"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "public"."Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "public"."Permission"("code");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "public"."Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_groupId_idx" ON "public"."Membership"("groupId");

-- CreateIndex
CREATE INDEX "Membership_roleId_idx" ON "public"."Membership"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityProviderMapping_providerKey_externalGroupId_roleId_key" ON "public"."IdentityProviderMapping"("providerKey", "externalGroupId", "roleId");

-- CreateIndex
CREATE INDEX "Delegation_delegateId_endsAt_idx" ON "public"."Delegation"("delegateId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "public"."Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "public"."Site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "public"."Project"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_supplierCode_key" ON "public"."Counterparty"("supplierCode");

-- CreateIndex
CREATE INDEX "Counterparty_officialName_idx" ON "public"."Counterparty"("officialName");

-- CreateIndex
CREATE INDEX "CounterpartyContact_counterpartyId_idx" ON "public"."CounterpartyContact"("counterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_code_key" ON "public"."DocumentType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataDefinition_key_key" ON "public"."MetadataDefinition"("key");

-- CreateIndex
CREATE INDEX "MetadataValue_definitionId_valueDate_idx" ON "public"."MetadataValue"("definitionId", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataValue_documentId_definitionId_key" ON "public"."MetadataValue"("documentId", "definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_number_key" ON "public"."Document"("number");

-- CreateIndex
CREATE INDEX "Document_typeId_idx" ON "public"."Document"("typeId");

-- CreateIndex
CREATE INDEX "Document_departmentId_idx" ON "public"."Document"("departmentId");

-- CreateIndex
CREATE INDEX "Document_ownerId_idx" ON "public"."Document"("ownerId");

-- CreateIndex
CREATE INDEX "Document_ingestStatus_idx" ON "public"."Document"("ingestStatus");

-- CreateIndex
CREATE INDEX "Document_confidentiality_idx" ON "public"."Document"("confidentiality");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_fileObjectId_key" ON "public"."DocumentVersion"("fileObjectId");

-- CreateIndex
CREATE INDEX "DocumentVersion_sha256_idx" ON "public"."DocumentVersion"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "public"."DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFileObject_storageKey_key" ON "public"."DocumentFileObject"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentFileObject_sha256_idx" ON "public"."DocumentFileObject"("sha256");

-- CreateIndex
CREATE INDEX "DocumentAcl_documentId_idx" ON "public"."DocumentAcl"("documentId");

-- CreateIndex
CREATE INDEX "DocumentAcl_subjectUserId_idx" ON "public"."DocumentAcl"("subjectUserId");

-- CreateIndex
CREATE INDEX "DocumentAcl_subjectGroupId_idx" ON "public"."DocumentAcl"("subjectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRelation_fromDocumentId_toDocumentId_relationType_key" ON "public"."DocumentRelation"("fromDocumentId", "toDocumentId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalArchiveLocation_documentId_key" ON "public"."PhysicalArchiveLocation"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractRecord_documentId_key" ON "public"."ContractRecord"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractRecord_institutionalNo_key" ON "public"."ContractRecord"("institutionalNo");

-- CreateIndex
CREATE INDEX "ContractRecord_counterpartyId_idx" ON "public"."ContractRecord"("counterpartyId");

-- CreateIndex
CREATE INDEX "ContractRecord_endDate_idx" ON "public"."ContractRecord"("endDate");

-- CreateIndex
CREATE INDEX "ContractRecord_legalEntityId_idx" ON "public"."ContractRecord"("legalEntityId");

-- CreateIndex
CREATE INDEX "ContractRecord_departmentId_idx" ON "public"."ContractRecord"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractParty_contractId_counterpartyId_role_key" ON "public"."ContractParty"("contractId", "counterpartyId", "role");

-- CreateIndex
CREATE INDEX "Obligation_contractId_idx" ON "public"."Obligation"("contractId");

-- CreateIndex
CREATE INDEX "Obligation_dueDate_idx" ON "public"."Obligation"("dueDate");

-- CreateIndex
CREATE INDEX "ContractDeadline_contractId_deadlineType_idx" ON "public"."ContractDeadline"("contractId", "deadlineType");

-- CreateIndex
CREATE INDEX "ContractDeadline_deadlineDate_idx" ON "public"."ContractDeadline"("deadlineDate");

-- CreateIndex
CREATE INDEX "Guarantee_expiresAt_idx" ON "public"."Guarantee"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractAmendment_amendmentContractId_key" ON "public"."ContractAmendment"("amendmentContractId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractAmendment_parentContractId_amendmentNo_key" ON "public"."ContractAmendment"("parentContractId", "amendmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_code_key" ON "public"."WorkflowDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinitionVersion_definitionId_version_key" ON "public"."WorkflowDefinitionVersion"("definitionId", "version");

-- CreateIndex
CREATE INDEX "WorkflowInstance_subjectType_subjectId_idx" ON "public"."WorkflowInstance"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "WorkflowInstance_status_idx" ON "public"."WorkflowInstance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_instanceId_orderIndex_key" ON "public"."WorkflowStep"("instanceId", "orderIndex");

-- CreateIndex
CREATE INDEX "ApprovalTask_assigneeId_status_idx" ON "public"."ApprovalTask"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_taskId_key" ON "public"."ApprovalDecision"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionProfile_code_key" ON "public"."RetentionProfile"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionRuleVersion_profileId_version_key" ON "public"."RetentionRuleVersion"("profileId", "version");

-- CreateIndex
CREATE INDEX "LegalHold_documentId_releasedAt_idx" ON "public"."LegalHold"("documentId", "releasedAt");

-- CreateIndex
CREATE INDEX "DispositionReview_status_idx" ON "public"."DispositionReview"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionDecision_reviewId_actorId_key" ON "public"."DispositionDecision"("reviewId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "DispositionDecision_reviewId_role_key" ON "public"."DispositionDecision"("reviewId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "DisposalManifest_reviewId_key" ON "public"."DisposalManifest"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "public"."Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "public"."Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_channel_key" ON "public"."NotificationPreference"("userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_notificationId_channel_attemptN_key" ON "public"."NotificationDeliveryAttempt"("notificationId", "channel", "attemptNo");

-- CreateIndex
CREATE INDEX "ScheduledEvent_status_deadlineDate_idx" ON "public"."ScheduledEvent"("status", "deadlineDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledEvent_subjectType_subjectId_deadlineType_offsetDay_key" ON "public"."ScheduledEvent"("subjectType", "subjectId", "deadlineType", "offsetDays", "deadlineDate");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRowResult_batchId_rowNumber_key" ON "public"."ImportRowResult"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "OCRJob_status_idx" ON "public"."OCRJob"("status");

-- CreateIndex
CREATE INDEX "ExtractionResult_documentId_fieldKey_idx" ON "public"."ExtractionResult"("documentId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_integrationKey_key" ON "public"."IntegrationConnection"("integrationKey");

-- CreateIndex
CREATE INDEX "SyncRun_connectionId_startedAt_idx" ON "public"."SyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "public"."BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_queue_status_runAfter_idx" ON "public"."BackgroundJob"("queue", "status", "runAfter");

-- CreateIndex
CREATE INDEX "BreakGlassGrant_subjectType_subjectId_status_idx" ON "public"."BreakGlassGrant"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "public"."SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_typeCode_year_key" ON "public"."NumberSequence"("typeCode", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "public"."AuditEvent"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_hash_key" ON "public"."AuditEvent"("hash");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "public"."AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "public"."AuditEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "public"."AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_occurredAt_idx" ON "public"."AuditEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_occurredAt_idx" ON "public"."SecurityEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_occurredAt_idx" ON "public"."SecurityEvent"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."IdentityProviderMapping" ADD CONSTRAINT "IdentityProviderMapping_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."IdentityProviderMapping" ADD CONSTRAINT "IdentityProviderMapping_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Delegation" ADD CONSTRAINT "Delegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Delegation" ADD CONSTRAINT "Delegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."CounterpartyContact" ADD CONSTRAINT "CounterpartyContact_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "public"."Counterparty"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DocumentType" ADD CONSTRAINT "DocumentType_retentionProfileId_fkey" FOREIGN KEY ("retentionProfileId") REFERENCES "public"."RetentionProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."MetadataValue" ADD CONSTRAINT "MetadataValue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."MetadataValue" ADD CONSTRAINT "MetadataValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "public"."MetadataDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "public"."DocumentType"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Document" ADD CONSTRAINT "Document_retentionProfileId_fkey" FOREIGN KEY ("retentionProfileId") REFERENCES "public"."RetentionProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DocumentVersion" ADD CONSTRAINT "DocumentVersion_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "public"."DocumentFileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DocumentAcl" ADD CONSTRAINT "DocumentAcl_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DocumentRelation" ADD CONSTRAINT "DocumentRelation_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DocumentRelation" ADD CONSTRAINT "DocumentRelation_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."PhysicalArchiveLocation" ADD CONSTRAINT "PhysicalArchiveLocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractRecord" ADD CONSTRAINT "ContractRecord_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractRecord" ADD CONSTRAINT "ContractRecord_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "public"."Counterparty"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractRecord" ADD CONSTRAINT "ContractRecord_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractRecord" ADD CONSTRAINT "ContractRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractParty" ADD CONSTRAINT "ContractParty_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractParty" ADD CONSTRAINT "ContractParty_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "public"."Counterparty"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Obligation" ADD CONSTRAINT "Obligation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractDeadline" ADD CONSTRAINT "ContractDeadline_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractDeadline" ADD CONSTRAINT "ContractDeadline_renewalRuleId_fkey" FOREIGN KEY ("renewalRuleId") REFERENCES "public"."RenewalRule"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Guarantee" ADD CONSTRAINT "Guarantee_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."RenewalRule" ADD CONSTRAINT "RenewalRule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractAmendment" ADD CONSTRAINT "ContractAmendment_parentContractId_fkey" FOREIGN KEY ("parentContractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ContractAmendment" ADD CONSTRAINT "ContractAmendment_amendmentContractId_fkey" FOREIGN KEY ("amendmentContractId") REFERENCES "public"."ContractRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."WorkflowDefinitionVersion" ADD CONSTRAINT "WorkflowDefinitionVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "public"."WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_definitionVersionId_fkey" FOREIGN KEY ("definitionVersionId") REFERENCES "public"."WorkflowDefinitionVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."WorkflowStep" ADD CONSTRAINT "WorkflowStep_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "public"."WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ApprovalTask" ADD CONSTRAINT "ApprovalTask_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "public"."WorkflowStep"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ApprovalTask" ADD CONSTRAINT "ApprovalTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."ApprovalTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."RetentionRuleVersion" ADD CONSTRAINT "RetentionRuleVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "public"."RetentionProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."LegalHold" ADD CONSTRAINT "LegalHold_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DispositionReview" ADD CONSTRAINT "DispositionReview_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DispositionDecision" ADD CONSTRAINT "DispositionDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "public"."DispositionReview"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."DisposalManifest" ADD CONSTRAINT "DisposalManifest_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "public"."DispositionReview"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "public"."Notification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ImportBatch" ADD CONSTRAINT "ImportBatch_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "public"."DocumentFileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ImportRowResult" ADD CONSTRAINT "ImportRowResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."ImportBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."OCRJob" ADD CONSTRAINT "OCRJob_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "public"."DocumentFileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."ExtractionResult" ADD CONSTRAINT "ExtractionResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."Document"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."SyncRun" ADD CONSTRAINT "SyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."JobFailure" ADD CONSTRAINT "JobFailure_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."BackgroundJob"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."BreakGlassGrant" ADD CONSTRAINT "BreakGlassGrant_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

