-- F12: MIS export history, integration sources, import validation errors.
-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "already_imported_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "committed_at" TIMESTAMPTZ(6),
ADD COLUMN     "committed_by" UUID,
ADD COLUMN     "committed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duplicate_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "error_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "file_sha256" CHAR(64),
ADD COLUMN     "reconciliation_json" JSONB,
ADD COLUMN     "row_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rows_json" JSONB,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "valid_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "integration_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "adapter" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "integration_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "field" VARCHAR(100),
    "code" VARCHAR(50) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "raw_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "report_code" VARCHAR(60) NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "params_json" JSONB NOT NULL DEFAULT '{}',
    "row_count" INTEGER NOT NULL,
    "scope_summary" VARCHAR(500) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "generated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_sources_tenant_id_id_key" ON "integration_sources"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sources_tenant_id_code_key" ON "integration_sources"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "import_errors_tenant_id_batch_id_row_number_idx" ON "import_errors"("tenant_id", "batch_id", "row_number");

-- CreateIndex
CREATE INDEX "report_executions_tenant_id_created_at_idx" ON "report_executions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batches_tenant_id_source_id_file_sha256_idx" ON "import_batches"("tenant_id", "source_id", "file_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_tenant_id_id_key" ON "import_batches"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "integration_sources" ADD CONSTRAINT "integration_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_source_id_fkey" FOREIGN KEY ("tenant_id", "source_id") REFERENCES "integration_sources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "import_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity checks
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_format_check" CHECK ("format" IN ('CSV', 'XLSX'));
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_counts_check" CHECK ("row_count" >= 0 AND "duration_ms" >= 0);
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_counts_check" CHECK (
  "row_count" >= 0 AND "valid_count" >= 0 AND "error_count" >= 0 AND "duplicate_count" >= 0
  AND "already_imported_count" >= 0 AND "committed_count" >= 0 AND "committed_count" <= "valid_count");
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_committed_check" CHECK (
  ("status" = 'COMMITTED') = ("committed_at" IS NOT NULL));
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_row_check" CHECK ("row_number" >= 0);

-- Tenant isolation (same policy as every other tenant table)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_sources', 'import_errors', 'report_executions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO dcp_app USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON integration_sources TO dcp_app;
REVOKE DELETE ON integration_sources FROM dcp_app;
-- Export history and import errors are append-only evidence.
GRANT SELECT, INSERT ON import_errors, report_executions TO dcp_app;
REVOKE UPDATE, DELETE ON import_errors, report_executions FROM dcp_app;
