-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "scope_type" AS ENUM ('TENANT', 'JURISDICTION', 'AGENCY', 'SCHEME');

-- CreateEnum
CREATE TYPE "permission_effect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "financial_year_status" AS ENUM ('PLANNED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "scheme_status" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "milestone_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "budget_version_status" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "allocation_status" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "commitment_status" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "expenditure_status" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "progress_status" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'RETURNED', 'RESUBMITTED');

-- CreateEnum
CREATE TYPE "scan_status" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "corrective_action_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "import_batch_status" AS ENUM ('RECEIVED', 'VALIDATING', 'VALIDATED', 'FAILED', 'COMMITTED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "jurisdiction_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "parent_id" UUID,
    "ancestry" UUID[] DEFAULT ARRAY[]::UUID[],
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "geometry" geometry(MultiPolygon, 4326),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "agency_type" VARCHAR(50) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_jurisdictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "jurisdiction_id" UUID NOT NULL,
    "relationship_type" VARCHAR(50) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "agency_jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "credential_ref" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(200) NOT NULL,
    "algorithm" VARCHAR(20) NOT NULL DEFAULT 'bcrypt',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_system_template" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "effect" "permission_effect" NOT NULL DEFAULT 'ALLOW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_scopes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_role_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "financial_year_status" NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "submission_due_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "reporting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schemes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "jurisdiction_id" UUID NOT NULL,
    "status" "scheme_status" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE,
    "target_end_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "geometry" geography(Point, 4326) NOT NULL,
    "location_accuracy" VARCHAR(50) NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scheme_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "target_date" DATE NOT NULL,
    "target_quantity" DECIMAL(18,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "status" "milestone_status" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scheme_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "scheme_id" UUID,
    "jurisdiction_id" UUID,
    "version_number" INTEGER NOT NULL,
    "status" "budget_version_status" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "revision_reason" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "approval_reference" VARCHAR(200),
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budget_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "requesting_agency_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "justification" TEXT NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
    "submitted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budget_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "budget_version_id" UUID NOT NULL,
    "parent_allocation_id" UUID,
    "recipient_jurisdiction_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "allocation_status" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budget_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "release_date" DATE NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "source_system" VARCHAR(50) NOT NULL,
    "verification_status" "verification_status" NOT NULL DEFAULT 'PENDING',
    "supersedes_id" UUID,
    "correction_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fund_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "reference" VARCHAR(200) NOT NULL,
    "status" "commitment_status" NOT NULL DEFAULT 'OPEN',
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenditure_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "progress_submission_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "expenditure_date" DATE NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "status" "expenditure_status" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(50) NOT NULL,
    "submitted_by" UUID,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "supersedes_id" UUID,
    "correction_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expenditure_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "submission_version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "status" "progress_status" NOT NULL DEFAULT 'DRAFT',
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "progress_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "quantity_completed" DECIMAL(18,3) NOT NULL,
    "reported_percent" DECIMAL(5,2),
    "measurement_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "progress_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "submission_id" UUID,
    "storage_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "scan_status" "scan_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "definition_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "current_state" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "step" VARCHAR(50) NOT NULL,
    "actor_id" UUID NOT NULL,
    "decision" VARCHAR(30) NOT NULL,
    "reason" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "rule_code" VARCHAR(50) NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "threshold_json" JSONB NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "owner_role_code" VARCHAR(50) NOT NULL,
    "notification_channel" VARCHAR(30) NOT NULL,
    "dedup_key_template" VARCHAR(200) NOT NULL,
    "is_illustrative" BOOLEAN NOT NULL DEFAULT true,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scheme_id" UUID,
    "rule_id" UUID,
    "rule_code" VARCHAR(50) NOT NULL,
    "dedup_key" VARCHAR(300) NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "context_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "action_text" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "status" "corrective_action_status" NOT NULL DEFAULT 'OPEN',
    "closure_evidence_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(100),
    "before_json" JSONB,
    "after_json" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "filename" VARCHAR(300) NOT NULL,
    "status" "import_batch_status" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error_summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_record_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_system" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "internal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "external_record_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_types_tenant_id_id_key" ON "jurisdiction_types"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_types_tenant_id_code_key" ON "jurisdiction_types"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "jurisdictions_tenant_id_parent_id_idx" ON "jurisdictions"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "jurisdictions_ancestry_idx" ON "jurisdictions" USING GIN ("ancestry");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_tenant_id_id_key" ON "jurisdictions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_tenant_id_code_key" ON "jurisdictions"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_tenant_id_id_key" ON "agencies"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_tenant_id_code_key" ON "agencies"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "agency_jurisdictions_tenant_id_jurisdiction_id_idx" ON "agency_jurisdictions"("tenant_id", "jurisdiction_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_jurisdictions_tenant_id_agency_id_jurisdiction_id_re_key" ON "agency_jurisdictions"("tenant_id", "agency_id", "jurisdiction_id", "relationship_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_key" ON "user_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_tenant_id_user_id_key" ON "user_credentials"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "roles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_tenant_id_user_id_idx" ON "user_role_scopes"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "user_role_scopes_tenant_id_scope_type_scope_id_idx" ON "user_role_scopes"("tenant_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_tenant_id_id_key" ON "financial_years"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_tenant_id_code_key" ON "financial_years"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_periods_tenant_id_id_key" ON "reporting_periods"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_periods_tenant_id_code_key" ON "reporting_periods"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "schemes_tenant_id_jurisdiction_id_idx" ON "schemes"("tenant_id", "jurisdiction_id");

-- CreateIndex
CREATE INDEX "schemes_tenant_id_agency_id_idx" ON "schemes"("tenant_id", "agency_id");

-- CreateIndex
CREATE INDEX "schemes_tenant_id_financial_year_id_status_idx" ON "schemes"("tenant_id", "financial_year_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "schemes_tenant_id_id_key" ON "schemes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "schemes_tenant_id_scheme_code_key" ON "schemes"("tenant_id", "scheme_code");

-- CreateIndex
CREATE INDEX "scheme_locations_tenant_id_scheme_id_idx" ON "scheme_locations"("tenant_id", "scheme_id");

-- CreateIndex
CREATE INDEX "scheme_locations_geometry_idx" ON "scheme_locations" USING GIST ("geometry");

-- CreateIndex
CREATE INDEX "scheme_milestones_tenant_id_scheme_id_idx" ON "scheme_milestones"("tenant_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_milestones_tenant_id_id_key" ON "scheme_milestones"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_versions_tenant_id_id_key" ON "budget_versions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_versions_tenant_id_scheme_id_version_number_key" ON "budget_versions"("tenant_id", "scheme_id", "version_number");

-- CreateIndex
CREATE INDEX "budget_requests_tenant_id_scheme_id_idx" ON "budget_requests"("tenant_id", "scheme_id");

-- CreateIndex
CREATE INDEX "budget_requests_tenant_id_status_idx" ON "budget_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "budget_allocations_tenant_id_budget_version_id_idx" ON "budget_allocations"("tenant_id", "budget_version_id");

-- CreateIndex
CREATE INDEX "budget_allocations_tenant_id_parent_allocation_id_idx" ON "budget_allocations"("tenant_id", "parent_allocation_id");

-- CreateIndex
CREATE INDEX "budget_allocations_tenant_id_scheme_id_idx" ON "budget_allocations"("tenant_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_allocations_tenant_id_id_key" ON "budget_allocations"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "fund_releases_tenant_id_scheme_id_idx" ON "fund_releases"("tenant_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_releases_tenant_id_id_key" ON "fund_releases"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "commitments_tenant_id_scheme_id_idx" ON "commitments"("tenant_id", "scheme_id");

-- CreateIndex
CREATE INDEX "expenditure_records_tenant_id_scheme_id_status_idx" ON "expenditure_records"("tenant_id", "scheme_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expenditure_records_tenant_id_id_key" ON "expenditure_records"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "progress_submissions_tenant_id_status_idx" ON "progress_submissions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "progress_submissions_tenant_id_id_key" ON "progress_submissions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "progress_submissions_tenant_id_scheme_id_period_id_submissi_key" ON "progress_submissions"("tenant_id", "scheme_id", "period_id", "submission_version");

-- CreateIndex
CREATE UNIQUE INDEX "progress_measurements_submission_id_milestone_id_key" ON "progress_measurements"("submission_id", "milestone_id");

-- CreateIndex
CREATE INDEX "evidence_files_tenant_id_scheme_id_idx" ON "evidence_files"("tenant_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_files_tenant_id_id_key" ON "evidence_files"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_files_tenant_id_storage_key_key" ON "evidence_files"("tenant_id", "storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_tenant_id_id_key" ON "workflow_definitions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_tenant_id_code_version_key" ON "workflow_definitions"("tenant_id", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_tenant_id_id_key" ON "workflow_instances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_tenant_id_entity_type_entity_id_key" ON "workflow_instances"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_decisions_tenant_id_workflow_instance_id_idx" ON "approval_decisions"("tenant_id", "workflow_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_tenant_id_id_key" ON "alert_rules"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_tenant_id_rule_code_scope_type_scope_id_effecti_key" ON "alert_rules"("tenant_id", "rule_code", "scope_type", "scope_id", "effective_from");

-- CreateIndex
CREATE INDEX "alerts_tenant_id_status_idx" ON "alerts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "alerts_tenant_id_scheme_id_idx" ON "alerts"("tenant_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_tenant_id_id_key" ON "alerts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_tenant_id_dedup_key_key" ON "alerts"("tenant_id", "dedup_key");

-- CreateIndex
CREATE INDEX "corrective_actions_tenant_id_alert_id_idx" ON "corrective_actions"("tenant_id", "alert_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_entity_type_entity_id_idx" ON "audit_events"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_status_idx" ON "import_batches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_record_mappings_tenant_id_source_system_entity_typ_key" ON "external_record_mappings"("tenant_id", "source_system", "entity_type", "external_id");

-- AddForeignKey
ALTER TABLE "jurisdiction_types" ADD CONSTRAINT "jurisdiction_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "jurisdiction_types"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "jurisdictions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_jurisdictions" ADD CONSTRAINT "agency_jurisdictions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_jurisdictions" ADD CONSTRAINT "agency_jurisdictions_tenant_id_agency_id_fkey" FOREIGN KEY ("tenant_id", "agency_id") REFERENCES "agencies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_jurisdictions" ADD CONSTRAINT "agency_jurisdictions_tenant_id_jurisdiction_id_fkey" FOREIGN KEY ("tenant_id", "jurisdiction_id") REFERENCES "jurisdictions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scopes" ADD CONSTRAINT "user_role_scopes_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_periods" ADD CONSTRAINT "reporting_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_periods" ADD CONSTRAINT "reporting_periods_tenant_id_financial_year_id_fkey" FOREIGN KEY ("tenant_id", "financial_year_id") REFERENCES "financial_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_tenant_id_financial_year_id_fkey" FOREIGN KEY ("tenant_id", "financial_year_id") REFERENCES "financial_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_tenant_id_agency_id_fkey" FOREIGN KEY ("tenant_id", "agency_id") REFERENCES "agencies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_tenant_id_jurisdiction_id_fkey" FOREIGN KEY ("tenant_id", "jurisdiction_id") REFERENCES "jurisdictions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_locations" ADD CONSTRAINT "scheme_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_locations" ADD CONSTRAINT "scheme_locations_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_milestones" ADD CONSTRAINT "scheme_milestones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_milestones" ADD CONSTRAINT "scheme_milestones_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_financial_year_id_fkey" FOREIGN KEY ("tenant_id", "financial_year_id") REFERENCES "financial_years"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_jurisdiction_id_fkey" FOREIGN KEY ("tenant_id", "jurisdiction_id") REFERENCES "jurisdictions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_approved_by_fkey" FOREIGN KEY ("tenant_id", "approved_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_requests" ADD CONSTRAINT "budget_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_requests" ADD CONSTRAINT "budget_requests_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_requests" ADD CONSTRAINT "budget_requests_tenant_id_requesting_agency_id_fkey" FOREIGN KEY ("tenant_id", "requesting_agency_id") REFERENCES "agencies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_requests" ADD CONSTRAINT "budget_requests_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "reporting_periods"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_requests" ADD CONSTRAINT "budget_requests_tenant_id_submitted_by_fkey" FOREIGN KEY ("tenant_id", "submitted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_budget_version_id_fkey" FOREIGN KEY ("tenant_id", "budget_version_id") REFERENCES "budget_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_parent_allocation_id_fkey" FOREIGN KEY ("tenant_id", "parent_allocation_id") REFERENCES "budget_allocations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_recipient_jurisdiction_id_fkey" FOREIGN KEY ("tenant_id", "recipient_jurisdiction_id") REFERENCES "jurisdictions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_approved_by_fkey" FOREIGN KEY ("tenant_id", "approved_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fund_releases" ADD CONSTRAINT "fund_releases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_releases" ADD CONSTRAINT "fund_releases_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_releases" ADD CONSTRAINT "fund_releases_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "fund_releases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "reporting_periods"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_progress_submission_id_fkey" FOREIGN KEY ("tenant_id", "progress_submission_id") REFERENCES "progress_submissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_submitted_by_fkey" FOREIGN KEY ("tenant_id", "submitted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_verified_by_fkey" FOREIGN KEY ("tenant_id", "verified_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "expenditure_records" ADD CONSTRAINT "expenditure_records_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "expenditure_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "progress_submissions" ADD CONSTRAINT "progress_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_submissions" ADD CONSTRAINT "progress_submissions_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_submissions" ADD CONSTRAINT "progress_submissions_tenant_id_period_id_fkey" FOREIGN KEY ("tenant_id", "period_id") REFERENCES "reporting_periods"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_submissions" ADD CONSTRAINT "progress_submissions_tenant_id_submitted_by_fkey" FOREIGN KEY ("tenant_id", "submitted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "progress_submissions" ADD CONSTRAINT "progress_submissions_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "progress_submissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "progress_measurements" ADD CONSTRAINT "progress_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_measurements" ADD CONSTRAINT "progress_measurements_tenant_id_submission_id_fkey" FOREIGN KEY ("tenant_id", "submission_id") REFERENCES "progress_submissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_measurements" ADD CONSTRAINT "progress_measurements_tenant_id_milestone_id_fkey" FOREIGN KEY ("tenant_id", "milestone_id") REFERENCES "scheme_milestones"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_tenant_id_submission_id_fkey" FOREIGN KEY ("tenant_id", "submission_id") REFERENCES "progress_submissions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_tenant_id_uploaded_by_fkey" FOREIGN KEY ("tenant_id", "uploaded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_definition_id_fkey" FOREIGN KEY ("tenant_id", "definition_id") REFERENCES "workflow_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_tenant_id_workflow_instance_id_fkey" FOREIGN KEY ("tenant_id", "workflow_instance_id") REFERENCES "workflow_instances"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_tenant_id_actor_id_fkey" FOREIGN KEY ("tenant_id", "actor_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_rule_id_fkey" FOREIGN KEY ("tenant_id", "rule_id") REFERENCES "alert_rules"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_assignee_id_fkey" FOREIGN KEY ("tenant_id", "assignee_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_id_alert_id_fkey" FOREIGN KEY ("tenant_id", "alert_id") REFERENCES "alerts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_id_owner_id_fkey" FOREIGN KEY ("tenant_id", "owner_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_id_closure_evidence_id_fkey" FOREIGN KEY ("tenant_id", "closure_evidence_id") REFERENCES "evidence_files"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_record_mappings" ADD CONSTRAINT "external_record_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
