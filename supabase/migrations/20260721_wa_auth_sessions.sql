CREATE TABLE IF NOT EXISTS wa_auth_sessions (
  id TEXT PRIMARY KEY DEFAULT 'default',
  creds JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wa_auth_sessions ENABLE ROW LEVEL SECURITY;

-- Only accessible via service role key (bot backend), never from browser
CREATE POLICY "service_role_only" ON wa_auth_sessions
  USING (false);
