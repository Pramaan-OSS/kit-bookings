import { AccountError } from "../accounts";
import { ASSIGNABLE_ROLES, type Database } from "./guard";

export type Account = { id: string; email: string | null; role: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The most accounts one answer lists; `total` says how many match, and a search finds the rest. */
export const LIST_LIMIT = 200;

/**
 * The accounts but the owner's whose email contains `search` (all, when it is empty), each with the role it has here:
 * one the owner gave it, else its own. Everyone with a role comes first, so the owner can always see and take back a
 * role; `total` is how many match.
 */
export async function listAccounts(db: Database, search = "") {
  const words = search.trim().slice(0, 200);
  const result = await db.query<Account & { total: string }>(
    `SELECT u.id,u.email,COALESCE(m.role,u.role) AS role,count(*) OVER () AS total FROM app_users u
    LEFT JOIN app_role_members m ON m.user_id=u.id
    WHERE u.role<>'owner' AND ($1='' OR u.email ILIKE $1)
    ORDER BY m.role IS NULL,u.email,u.id LIMIT ${LIST_LIMIT}`,
    [words === "" ? "" : `%${words.replace(/[\\%_]/gu, "\\$&")}%`],
  );
  return {
    accounts: result.rows.map(({ id, email, role }) => ({ id, email, role })),
    total: Number(result.rows[0]?.total ?? 0),
  };
}

/**
 * Gives an account one of ASSIGNABLE_ROLES, or `member` to take its role away. Never the owner's account.
 *
 * Invites: email is not switched on for apps yet, so the owner gives roles to accounts that already exist. When it
 * is, an invite sends a sign-up link with the role in it, and the sign-up that follows calls assignRole with that
 * role; nothing here changes.
 */
export async function assignRole(db: Database, id: unknown, role: unknown): Promise<Account> {
  if (typeof id !== "string" || !UUID.test(id)) throw new AccountError(400, "Choose an account.");
  if (role !== "member" && !(typeof role === "string" && Object.hasOwn(ASSIGNABLE_ROLES, role)))
    throw new AccountError(400, "Choose one of the roles listed.");
  const found = await db.query<{ email: string | null }>(
    "SELECT email FROM app_users WHERE id=$1 AND role<>'owner'",
    [id],
  );
  const account = found.rows[0];
  if (!account) throw new AccountError(404, "That account is not here.");
  if (role === "member") await db.query("DELETE FROM app_role_members WHERE user_id=$1", [id]);
  else
    await db.query(
      `INSERT INTO app_role_members(user_id,role) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role,assigned_at=now()`,
      [id, role],
    );
  return { id, email: account.email, role };
}
