-- The bookings kit's schema. 0001 and 0002 are the starter's, byte for byte; the kit numbers its own from 0100.
-- Migrations are additive: add a new numbered file, never edit one that has run.

-- The business: one row. Times are shown and worked out in its time zone (an IANA name, "Europe/London").
CREATE TABLE business (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name text NOT NULL DEFAULT '',
  tagline text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  time_zone text NOT NULL DEFAULT 'UTC',
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  min_notice_minutes integer NOT NULL DEFAULT 120 CHECK (min_notice_minutes BETWEEN 0 AND 43200),
  max_days_ahead integer NOT NULL DEFAULT 60 CHECK (max_days_ahead BETWEEN 1 AND 365),
  slot_step_minutes integer NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (5, 10, 15, 20, 30, 60)),
  reminder_hours_before integer NOT NULL DEFAULT 24 CHECK (reminder_hours_before BETWEEN 1 AND 168),
  notify_owner boolean NOT NULL DEFAULT true,
  reminders_last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- What people book. The price is shown only; nothing is charged.
CREATE TABLE services (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
  price_cents integer CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 100000000),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes BETWEEN 0 AND 240),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes BETWEEN 0 AND 240),
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who people book with. There is always at least one; a solo business has just the one.
CREATE TABLE staff (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  title text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'evergreen',
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_services (
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE INDEX staff_services_service ON staff_services(service_id);

-- Weekly hours: local clock times in the business's zone. 0 is Sunday. A day may have several stretches.
CREATE TABLE weekly_hours (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (end_minute > start_minute)
);
CREATE INDEX weekly_hours_staff ON weekly_hours(staff_id, weekday);

-- Days off: one person's (staff_id set), or the whole business closed (staff_id null). Local dates.
CREATE TABLE days_off (
  id uuid PRIMARY KEY,
  staff_id uuid REFERENCES staff(id) ON DELETE CASCADE,
  day date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX days_off_once
  ON days_off (COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), day);
CREATE INDEX days_off_day ON days_off(day);

-- A booking. Times are UTC instants; the service's name, price and buffers are copied in when it is booked, so a
-- later edit to the service changes no booking. A reschedule marks this row 'rescheduled' and makes a new one
-- whose rescheduled_from names it.
CREATE TABLE bookings (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id),
  staff_id uuid NOT NULL REFERENCES staff(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  buffer_before_minutes integer NOT NULL DEFAULT 0,
  buffer_after_minutes integer NOT NULL DEFAULT 0,
  service_name text NOT NULL,
  price_cents integer,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  customer_time_zone text NOT NULL DEFAULT 'UTC',
  notes text NOT NULL DEFAULT '',
  customer_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'rescheduled')),
  cancelled_by text CHECK (cancelled_by IN ('customer', 'owner')),
  cancelled_at timestamptz,
  rescheduled_from uuid REFERENCES bookings(id),
  manage_nonce text NOT NULL CHECK (manage_nonce ~ '^[0-9a-f]{32}$'),
  confirmation_status text NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending', 'sent', 'not-sent', 'unknown')),
  confirmation_note text NOT NULL DEFAULT '',
  reminder_claimed_at timestamptz,
  reminder_status text NOT NULL DEFAULT 'pending'
    CHECK (reminder_status IN ('pending', 'sent', 'not-sent', 'unknown', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
-- The backstop under the booking transaction's lock (lib/bookings/reserve.ts): one confirmed booking per person
-- per start time, whatever the code does.
CREATE UNIQUE INDEX bookings_one_per_start ON bookings (staff_id, starts_at) WHERE status = 'confirmed';
CREATE INDEX bookings_staff_time ON bookings (staff_id, starts_at, ends_at) WHERE status = 'confirmed';
CREATE INDEX bookings_starts ON bookings (starts_at);
CREATE INDEX bookings_customer ON bookings (customer_id, starts_at);
CREATE INDEX bookings_replacement ON bookings (rescheduled_from);
CREATE INDEX bookings_reminders ON bookings (starts_at)
  WHERE status = 'confirmed' AND reminder_status = 'pending';

-- Public booking requests, counted per client and per email in a window, so a script cannot fill the diary.
CREATE TABLE booking_throttle (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  started_at timestamptz NOT NULL
);
CREATE INDEX booking_throttle_started ON booking_throttle(started_at);

-- Scheduled job runs already handled, by the platform's runId, so a repeated call does nothing twice.
CREATE TABLE job_runs (
  run_id text PRIMARY KEY,
  schedule text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now()
);
