CREATE TABLE IF NOT EXISTS google_accounts (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS calendars (
  id SERIAL PRIMARY KEY,
  google_account_id INT REFERENCES google_accounts(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('work', 'personal')),
  sync_token TEXT,
  UNIQUE (google_account_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS watch_channels (
  id SERIAL PRIMARY KEY,
  calendar_id INT REFERENCES calendars(id) ON DELETE CASCADE,
  channel_id TEXT UNIQUE NOT NULL,
  resource_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS watch_channels_expires_at ON watch_channels (expires_at);

CREATE TABLE IF NOT EXISTS event_classifications (
  event_id TEXT PRIMARY KEY,
  calendar_id INT REFERENCES calendars(id) ON DELETE CASCADE,
  event_updated_at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('set', 'ask', 'skip')),
  status_text TEXT,
  emoji TEXT,
  suggestions JSONB,
  reason TEXT,
  classified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('set', 'ask', 'clear')),
  trigger_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  fired BOOLEAN DEFAULT FALSE,
  UNIQUE (event_id, job_type)
);
CREATE INDEX IF NOT EXISTS scheduled_jobs_pending ON scheduled_jobs (trigger_at) WHERE fired = FALSE;

CREATE TABLE IF NOT EXISTS pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  slack_message_ts TEXT,
  slack_channel_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS current_status (
  id INT PRIMARY KEY DEFAULT 1,
  event_id TEXT,
  status_text TEXT,
  emoji TEXT,
  set_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  CONSTRAINT current_status_singleton CHECK (id = 1)
);
INSERT INTO current_status (id) VALUES (1) ON CONFLICT DO NOTHING;
