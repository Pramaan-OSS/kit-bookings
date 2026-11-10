-- A person in the diary can be linked to the account they sign in with, so they see their own day (lib/bookings/staff.ts).
-- Optional: a person with no link signs in as nobody. Unique: one account is one person.
-- ON DELETE SET NULL, not CASCADE: releasing an account (deleting its app_users row) must not take the diary with it.
-- The person, their hours and the bookings made with them stay; only the sign-in goes, and an account made later with
-- the same email has a new id, so it never inherits the link.
ALTER TABLE staff ADD COLUMN user_id uuid UNIQUE REFERENCES app_users(id) ON DELETE SET NULL;
