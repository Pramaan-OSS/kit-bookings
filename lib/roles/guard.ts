import type { Pool } from "pg";
import { AccountError, type User } from "../accounts";

export type Database = Pick<Pool, "query">;
/** The signed-in account, with the role it has here: `owner`, a role the owner gave it, or its own (`member`). */
export type Member = User;

/**
 * The roles the owner gives accounts, by id, with the name the owner sees. pramaan.app.json declares each one too
 * (`"source": "added-by-owner"`): add a role in both places. `owner` and `member` are the starter's own, never here.
 */
export const ASSIGNABLE_ROLES: Readonly<Record<string, string>> = { staff: "Staff" };

const DENIED = "You don't have access to this.";

/**
 * The server-side guards every page and API route uses. They deny by default: a request passes only when its
 * account's role is one the caller names, so a guard that names no role lets no one through, the owner included.
 * `requireUser` is the starter's (lib/accounts.ts): no session is a 401 before any role is read.
 */
export function createRoleGuard(db: Database, requireUser: (request: Request) => Promise<User>) {
  async function roleOf(user: User) {
    // The owner is the owner pass's alone, whatever any table says.
    if (user.role === "owner") return "owner";
    const given = await db.query<{ role: string }>(
      "SELECT role FROM app_role_members WHERE user_id=$1",
      [user.id],
    );
    // Only a role the owner may give counts: a stored `owner`, or a role this code does not list, is ignored.
    const role = given.rows[0]?.role;
    return role !== undefined && Object.hasOwn(ASSIGNABLE_ROLES, role) ? role : user.role;
  }
  async function requireRole(request: Request, roles: readonly string[]): Promise<Member> {
    const user = await requireUser(request);
    const role = await roleOf(user);
    if (!roles.includes(role)) throw new AccountError(403, DENIED);
    return { ...user, role };
  }
  return { roleOf, requireRole };
}
