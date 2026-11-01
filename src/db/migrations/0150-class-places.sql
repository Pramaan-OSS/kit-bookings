CREATE TABLE class_sessions (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 100),
  CHECK(ends_at>starts_at)
);
CREATE TABLE class_places (
  session_id uuid NOT NULL REFERENCES class_sessions(id),
  user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,user_id)
);
