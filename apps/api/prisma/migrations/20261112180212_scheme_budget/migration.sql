-- DropForeignKey
ALTER TABLE "budget_allocations" DROP CONSTRAINT "budget_allocations_tenant_id_scheme_id_fkey";

-- AlterTable
ALTER TABLE "budget_allocations" ALTER COLUMN "scheme_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "budget_requests" ADD COLUMN     "review_comment" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reviewed_by" UUID;

-- AlterTable
ALTER TABLE "schemes" ADD COLUMN     "approved_at" TIMESTAMPTZ(6),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "department" VARCHAR(150),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "objectives" TEXT,
ADD COLUMN     "status_reason" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "submitted_by" UUID;

-- CreateTable
CREATE TABLE "budget_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "budget_version_id" UUID,
    "allocation_id" UUID,
    "previous_amount" DECIMAL(18,2) NOT NULL,
    "requested_amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "route" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_revisions_tenant_id_status_idx" ON "budget_revisions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "budget_revisions_tenant_id_id_key" ON "budget_revisions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_user_id_key_key" ON "idempotency_keys"("tenant_id", "user_id", "key");

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_tenant_id_budget_version_id_fkey" FOREIGN KEY ("tenant_id", "budget_version_id") REFERENCES "budget_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_tenant_id_allocation_id_fkey" FOREIGN KEY ("tenant_id", "allocation_id") REFERENCES "budget_allocations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_tenant_id_requested_by_fkey" FOREIGN KEY ("tenant_id", "requested_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_tenant_id_decided_by_fkey" FOREIGN KEY ("tenant_id", "decided_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- F06 hand-written section.
-- ---------------------------------------------------------------------------

-- Maker-checker: nobody approves or reviews their own submission.
ALTER TABLE schemes ADD CONSTRAINT schemes_no_self_approval
  CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by);
ALTER TABLE budget_allocations ADD CONSTRAINT budget_allocations_no_self_approval
  CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);
ALTER TABLE budget_versions ADD CONSTRAINT budget_versions_no_self_approval
  CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);
ALTER TABLE budget_requests ADD CONSTRAINT budget_requests_no_self_review
  CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by);

ALTER TABLE budget_revisions
  ADD CONSTRAINT budget_revisions_target_type CHECK (target_type IN ('BUDGET_VERSION', 'ALLOCATION')),
  ADD CONSTRAINT budget_revisions_one_target CHECK (
    (target_type = 'BUDGET_VERSION' AND budget_version_id IS NOT NULL AND allocation_id IS NULL) OR
    (target_type = 'ALLOCATION' AND allocation_id IS NOT NULL AND budget_version_id IS NULL)),
  ADD CONSTRAINT budget_revisions_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD CONSTRAINT budget_revisions_amounts_non_negative CHECK (previous_amount >= 0 AND requested_amount >= 0),
  ADD CONSTRAINT budget_revisions_no_self_decision CHECK (decided_by IS NULL OR decided_by <> requested_by),
  ADD CONSTRAINT budget_revisions_reason_required CHECK (length(btrim(reason)) > 0);

-- At most one pending revision per target, so concurrent revisions cannot both apply.
CREATE UNIQUE INDEX budget_revisions_one_pending_version ON budget_revisions (tenant_id, budget_version_id)
  WHERE status = 'PENDING' AND budget_version_id IS NOT NULL;
CREATE UNIQUE INDEX budget_revisions_one_pending_allocation ON budget_revisions (tenant_id, allocation_id)
  WHERE status = 'PENDING' AND allocation_id IS NOT NULL;

-- One approved ceiling (planning envelope) per jurisdiction per financial year.
CREATE UNIQUE INDEX budget_versions_one_approved_envelope
  ON budget_versions (tenant_id, financial_year_id, jurisdiction_id)
  WHERE status = 'APPROVED' AND scheme_id IS NULL;

-- Allocations targeting a scheme must be leaves (no children may hang off a scheme allocation).
CREATE FUNCTION budget_allocations_scheme_is_leaf() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_allocation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM budget_allocations p
     WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.parent_allocation_id
       AND p.scheme_id IS NOT NULL AND NEW.scheme_id IS DISTINCT FROM p.scheme_id
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_PARENT_IS_SCHEME_LEAF' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budget_allocations_scheme_is_leaf BEFORE INSERT OR UPDATE OF parent_allocation_id, scheme_id
  ON budget_allocations FOR EACH ROW EXECUTE FUNCTION budget_allocations_scheme_is_leaf();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_revisions', 'idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO dcp_app USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON budget_revisions, idempotency_keys TO dcp_app;
