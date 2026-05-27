-- Drop BYPASSRLS from edict_admin_role.
--
-- The role was originally created in 0002_rls.sql with BYPASSRLS, intended to be the runtime
-- admin identity. It has never actually been used at runtime — DATABASE_ADMIN_URL points to the
-- Postgres SUPERUSER directly (edict_admin on local docker, neondb_owner on Neon), both of which
-- bypass RLS via table ownership. Assigning BYPASSRLS requires SUPERUSER, which Neon does not
-- grant. Dropping the attribute keeps the role consistent across local and Neon, and removes a
-- misleading capability from a role that doesn't need it.

ALTER ROLE edict_admin_role NOBYPASSRLS;
