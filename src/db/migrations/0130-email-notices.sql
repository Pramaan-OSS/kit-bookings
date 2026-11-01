-- Which transactional emails the app has sent (lib/email-notices/notify.ts). One row per event: the event is claimed
-- here before anything is sent, so the same event never sends twice, even after the platform has forgotten its
-- Idempotency-Key. It holds no address and no message: only which template, how it went and when.
CREATE TABLE app_email_notices (
  event_key text PRIMARY KEY CHECK (event_key ~ '^en1-[0-9a-f]{64}$'),
  template text NOT NULL CHECK (template ~ '^[a-z][a-z0-9-]{0,62}$'),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'not-sent', 'unknown')),
  off boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_email_notices_recent ON app_email_notices (updated_at);
