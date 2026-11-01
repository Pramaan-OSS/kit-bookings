-- Holds share the staff row lock with confirmations. Expiry is checked inside that lock.
CREATE TABLE booking_holds (
  token_hash text PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  buffer_before_minutes integer NOT NULL,
  buffer_after_minutes integer NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX booking_holds_staff ON booking_holds(staff_id, expires_at);
-- Populated by the platform operator only, never by a public request or sign-up.
CREATE TABLE platform_owner_members (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  member_id text NOT NULL UNIQUE
);
