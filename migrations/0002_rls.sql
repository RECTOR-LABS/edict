-- Two application roles:
--   edict_app    — default, RLS enforced
--   edict_admin  — used by admin-session handlers, BYPASSRLS

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edict_app') THEN
    CREATE ROLE edict_app LOGIN PASSWORD 'dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edict_admin_role') THEN
    CREATE ROLE edict_admin_role LOGIN PASSWORD 'dev' BYPASSRLS;
  END IF;
END $$;

-- Grants: full for admin, CRUD for app
GRANT CONNECT ON DATABASE edict TO edict_app, edict_admin_role;
GRANT USAGE ON SCHEMA public TO edict_app, edict_admin_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edict_app, edict_admin_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edict_app, edict_admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edict_app, edict_admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO edict_app, edict_admin_role;

-- Enable RLS on client-scoped tables
ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Policy pattern: compare client_id to the per-request GUC 'edict.client_id'.
-- nullif(..., '') handles the unset case safely.

CREATE POLICY client_members_tenant_isolation ON client_members
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);

CREATE POLICY doc_shares_tenant_isolation ON doc_shares
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (client_id = nullif(current_setting('edict.client_id', true), '')::uuid);

-- App role must write audit entries (even during 'magic_link_failed' with no client_id)
CREATE POLICY audit_log_system_insert ON audit_log
  FOR INSERT
  WITH CHECK (actor_type = 'system' OR client_id = nullif(current_setting('edict.client_id', true), '')::uuid);
