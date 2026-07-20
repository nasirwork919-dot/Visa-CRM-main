-- WhatsApp AI agent conversation history
CREATE TABLE IF NOT EXISTS wa_conversations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT        UNIQUE NOT NULL,
  messages    JSONB       NOT NULL DEFAULT '[]',
  stage       TEXT        NOT NULL DEFAULT 'qualifying', -- qualifying | qualified | stopped
  lead_id     UUID        REFERENCES leads(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON wa_conversations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS wa_conversations_phone_idx ON wa_conversations(phone);
CREATE INDEX IF NOT EXISTS wa_conversations_lead_id_idx ON wa_conversations(lead_id);
