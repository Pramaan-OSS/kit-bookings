-- The roles the owner gives accounts (lib/roles/members.ts), beyond the starter's own: the owner, from Pramaan's
-- owner pass, and members, who sign up. One row per account; an account with none keeps its app_users.role.
-- Never the owner's role: the owner comes only from the owner pass.
CREATE TABLE app_role_members (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role ~ '^[a-z][a-z0-9_]{0,31}$' AND role NOT IN ('owner', 'member')),
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_role_members_role ON app_role_members (role);
