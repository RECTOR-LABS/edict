-- Ensure sessions.client_id matches client_members.client_id for client_member sessions.
-- CHECK constraints can't cross tables; this trigger does.

CREATE OR REPLACE FUNCTION enforce_session_client_id() RETURNS trigger AS $$
BEGIN
  IF NEW.subject_type = 'client_member' THEN
    IF NOT EXISTS (
      SELECT 1 FROM client_members
      WHERE id = NEW.subject_id AND client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'sessions.client_id must match client_members.client_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_enforce_client_id
  BEFORE INSERT OR UPDATE OF subject_type, subject_id, client_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_session_client_id();
