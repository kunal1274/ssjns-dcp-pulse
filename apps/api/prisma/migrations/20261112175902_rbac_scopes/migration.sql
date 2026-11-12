-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "description" VARCHAR(500);

-- AlterTable
ALTER TABLE "user_role_scopes" ADD COLUMN     "include_descendants" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revocation_reason" TEXT,
ADD COLUMN     "revoked_by" UUID;

-- ---------------------------------------------------------------------------
-- F05 hand-written section.
-- ---------------------------------------------------------------------------

-- Existing jurisdiction assignments were created when scope meant "this node and below".
UPDATE user_role_scopes SET include_descendants = true WHERE scope_type = 'JURISDICTION';

ALTER TABLE user_role_scopes
  ADD CONSTRAINT user_role_scopes_no_self_grant CHECK (created_by IS NULL OR created_by <> user_id),
  ADD CONSTRAINT user_role_scopes_tenant_scope_id CHECK (scope_type <> 'TENANT' OR scope_id = tenant_id),
  ADD CONSTRAINT user_role_scopes_valid_window CHECK (valid_to IS NULL OR valid_to >= valid_from),
  ADD CONSTRAINT user_role_scopes_descendants_only_jurisdiction
    CHECK (include_descendants = false OR scope_type = 'JURISDICTION');

-- scope_id is polymorphic; this trigger gives it referential integrity within the tenant.
CREATE FUNCTION user_role_scopes_check_target() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE found boolean;
BEGIN
  found := CASE NEW.scope_type
    WHEN 'TENANT' THEN NEW.scope_id = NEW.tenant_id
    WHEN 'JURISDICTION' THEN EXISTS (SELECT 1 FROM jurisdictions WHERE tenant_id = NEW.tenant_id AND id = NEW.scope_id)
    WHEN 'AGENCY' THEN EXISTS (SELECT 1 FROM agencies WHERE tenant_id = NEW.tenant_id AND id = NEW.scope_id)
    WHEN 'SCHEME' THEN EXISTS (SELECT 1 FROM schemes WHERE tenant_id = NEW.tenant_id AND id = NEW.scope_id)
  END;
  IF NOT found THEN
    RAISE EXCEPTION 'role scope target % % does not exist in tenant', NEW.scope_type, NEW.scope_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_role_scopes_check_target BEFORE INSERT OR UPDATE OF scope_type, scope_id, tenant_id
  ON user_role_scopes FOR EACH ROW EXECUTE FUNCTION user_role_scopes_check_target();
