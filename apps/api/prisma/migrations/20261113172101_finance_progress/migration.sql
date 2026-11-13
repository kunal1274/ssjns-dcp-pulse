-- AlterTable
ALTER TABLE "expenditure_records" ADD COLUMN     "decision_reason" TEXT;

-- AlterTable
ALTER TABLE "fund_releases" ADD COLUMN     "decision_reason" TEXT,
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by" UUID;

-- AlterTable
ALTER TABLE "progress_submissions" ADD COLUMN     "decision_reason" TEXT,
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by" UUID;

-- AddForeignKey
ALTER TABLE "fund_releases" ADD CONSTRAINT "fund_releases_tenant_id_verified_by_fkey" FOREIGN KEY ("tenant_id", "verified_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "progress_submissions" ADD CONSTRAINT "progress_submissions_tenant_id_verified_by_fkey" FOREIGN KEY ("tenant_id", "verified_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Hand-written: maker-checker defence in depth for releases and progress.
-- ---------------------------------------------------------------------------
ALTER TABLE fund_releases        ADD CONSTRAINT fund_releases_maker_checker
  CHECK (verified_by IS NULL OR verified_by IS DISTINCT FROM created_by);
ALTER TABLE progress_submissions ADD CONSTRAINT progress_submissions_maker_checker
  CHECK (verified_by IS NULL OR verified_by IS DISTINCT FROM submitted_by);
-- Records decided from F07/F08 onwards must name their verifier (seeded history predates the column).
ALTER TABLE fund_releases        ADD CONSTRAINT fund_releases_verified_has_verifier
  CHECK (verification_status <> 'VERIFIED' OR verified_by IS NOT NULL) NOT VALID;
ALTER TABLE progress_submissions ADD CONSTRAINT progress_submissions_verified_has_verifier
  CHECK (status <> 'VERIFIED' OR verified_by IS NOT NULL) NOT VALID;
-- A returned or rejected decision must carry a reason.
ALTER TABLE expenditure_records  ADD CONSTRAINT expenditure_records_decision_has_reason
  CHECK (status NOT IN ('RETURNED', 'REJECTED') OR length(btrim(coalesce(decision_reason, ''))) > 0) NOT VALID;
ALTER TABLE progress_submissions ADD CONSTRAINT progress_submissions_return_has_reason
  CHECK (status <> 'RETURNED' OR length(btrim(coalesce(decision_reason, ''))) > 0) NOT VALID;
-- At most one live correction per verified record.
CREATE UNIQUE INDEX expenditure_records_one_correction
  ON expenditure_records (tenant_id, supersedes_id) WHERE supersedes_id IS NOT NULL AND status <> 'REJECTED';
CREATE UNIQUE INDEX fund_releases_one_correction
  ON fund_releases (tenant_id, supersedes_id) WHERE supersedes_id IS NOT NULL AND verification_status <> 'REJECTED';
