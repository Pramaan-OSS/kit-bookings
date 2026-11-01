CREATE TABLE preparation_notes (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  completed boolean NOT NULL DEFAULT false
);
