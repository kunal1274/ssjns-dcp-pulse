-- CreateEnum
CREATE TYPE "token_purpose" AS ENUM ('PASSWORD_RESET', 'INVITE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "user_status" ADD VALUE 'INVITED';
ALTER TYPE "user_status" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "user_credentials" ADD COLUMN     "failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ(6),
ADD COLUMN     "password_changed_at" TIMESTAMPTZ(6),
ALTER COLUMN "algorithm" SET DEFAULT 'argon2id';

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(50),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "purpose" "token_purpose" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authentication_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "event_type" VARCHAR(50) NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "request_id" VARCHAR(100),
    "details_json" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_tenant_id_user_id_idx" ON "user_sessions"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_tenant_id_id_key" ON "user_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_tenant_id_user_id_idx" ON "password_reset_tokens"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "authentication_events_tenant_id_occurred_at_idx" ON "authentication_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "authentication_events_tenant_id_user_id_idx" ON "authentication_events"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- F04 hand-written section: grants, RLS, append-only auth events and narrow
-- SECURITY DEFINER lookups used before a tenant context exists.
-- ---------------------------------------------------------------------------

ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_expiry_order
  CHECK (idle_expires_at <= absolute_expires_at);
ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_used_after_created
  CHECK (used_at IS NULL OR used_at >= created_at);
ALTER TABLE authentication_events ADD CONSTRAINT authentication_events_outcome_check
  CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED'));

GRANT SELECT, INSERT, UPDATE ON user_sessions, password_reset_tokens TO dcp_app;
GRANT SELECT, INSERT ON authentication_events TO dcp_app;

CREATE FUNCTION authentication_events_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'authentication_events is append-only' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER authentication_events_no_update BEFORE UPDATE OR DELETE ON authentication_events
  FOR EACH ROW EXECUTE FUNCTION authentication_events_append_only();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_sessions', 'password_reset_tokens', 'authentication_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO dcp_app USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- Resolve a tenant by code for login (returns nothing for unknown codes).
CREATE FUNCTION auth_resolve_tenant(p_code text)
  RETURNS TABLE (tenant_id uuid, tenant_status tenant_status)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT id, status FROM tenants WHERE code = p_code $$;

-- Resolve a live session by token hash. Expiry and revocation are checked here
-- so a revoked or expired session never yields a tenant context.
CREATE FUNCTION auth_resolve_session(p_token_hash text)
  RETURNS TABLE (session_id uuid, tenant_id uuid, user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT s.id, s.tenant_id, s.user_id FROM user_sessions s
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > now()
      AND s.absolute_expires_at > now()
  $$;

-- Resolve an unused, unexpired reset/invite token by hash.
CREATE FUNCTION auth_resolve_reset_token(p_token_hash text)
  RETURNS TABLE (token_id uuid, tenant_id uuid, user_id uuid, purpose token_purpose)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.tenant_id, t.user_id, t.purpose FROM password_reset_tokens t
    WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  $$;

REVOKE ALL ON FUNCTION auth_resolve_tenant(text), auth_resolve_session(text), auth_resolve_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_tenant(text), auth_resolve_session(text), auth_resolve_reset_token(text) TO dcp_app;
