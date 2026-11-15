-- F11: alert lifecycle history, rule configuration, corrective-action verification workflow.
-- Generated Prisma DDL followed by hand-written RLS, grants, checks and permission catalogue rows.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "corrective_action_status" ADD VALUE 'ASSIGNED';
ALTER TYPE "corrective_action_status" ADD VALUE 'PENDING_VERIFICATION';
ALTER TYPE "corrective_action_status" ADD VALUE 'CLOSED';
ALTER TYPE "corrective_action_status" ADD VALUE 'REOPENED';

-- AlterTable
ALTER TABLE "alert_rules" ADD COLUMN     "description" TEXT,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "evaluation_frequency" VARCHAR(30) NOT NULL DEFAULT 'DAILY',
ADD COLUMN     "last_evaluated_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "acknowledged_at" TIMESTAMPTZ(6),
ADD COLUMN     "acknowledged_by" UUID,
ADD COLUMN     "escalation_level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_evaluated_at" TIMESTAMPTZ(6),
ADD COLUMN     "resolution_reason" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMPTZ(6),
ADD COLUMN     "resolved_by" UUID,
ADD COLUMN     "review_indicator" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "corrective_actions" ADD COLUMN     "closure_reason" TEXT,
ADD COLUMN     "evidence_note" TEXT,
ADD COLUMN     "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "scheme_id" UUID,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by" UUID;

-- CreateTable
CREATE TABLE "alert_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30),
    "actor_id" UUID,
    "note" TEXT,
    "detail_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_action_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "corrective_action_id" UUID NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30),
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrective_action_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_events_tenant_id_alert_id_created_at_idx" ON "alert_events"("tenant_id", "alert_id", "created_at");

-- CreateIndex
CREATE INDEX "corrective_action_events_tenant_id_corrective_action_id_cre_idx" ON "corrective_action_events"("tenant_id", "corrective_action_id", "created_at");

-- CreateIndex
CREATE INDEX "corrective_actions_tenant_id_owner_id_status_idx" ON "corrective_actions"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "corrective_actions_tenant_id_id_key" ON "corrective_actions"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_tenant_id_scheme_id_fkey" FOREIGN KEY ("tenant_id", "scheme_id") REFERENCES "schemes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_tenant_id_alert_id_fkey" FOREIGN KEY ("tenant_id", "alert_id") REFERENCES "alerts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_action_events" ADD CONSTRAINT "corrective_action_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_action_events" ADD CONSTRAINT "corrective_action_events_tenant_id_corrective_action_id_fkey" FOREIGN KEY ("tenant_id", "corrective_action_id") REFERENCES "corrective_actions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written ---------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['alert_events', 'corrective_action_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO dcp_app USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;
-- Lifecycle history is append-only for the application role.
GRANT SELECT, INSERT ON alert_events, corrective_action_events TO dcp_app;
REVOKE UPDATE, DELETE ON alert_events, corrective_action_events FROM dcp_app;

ALTER TABLE corrective_actions
  ADD CONSTRAINT corrective_actions_priority_check CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT corrective_actions_independent_verifier CHECK (
    verified_by IS NULL OR verified_by <> owner_id
  );
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_frequency_check CHECK (evaluation_frequency IN ('HOURLY', 'DAILY', 'WEEKLY', 'ON_EVENT'));

-- New permission: alert-rule administration (spec §10 requires authorised staff only).
INSERT INTO permissions (code, resource, action, description)
VALUES ('alert.rule.manage', 'alert', 'rule.manage', 'Configure alert rules and thresholds')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE p.code = 'alert.rule.manage' AND r.code IN ('STATE_PLANNER', 'SYSTEM_ADMIN')
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);

-- The scheduled evaluator runs without a signed-in user, so it needs the list of tenants to visit.
-- SECURITY DEFINER exposes only active tenant ids; every evaluation then runs under that tenant's RLS context.
CREATE FUNCTION app_active_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants WHERE status = 'ACTIVE'
$$;
REVOKE ALL ON FUNCTION app_active_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_active_tenant_ids() TO dcp_app;
