import { describe, expect, it } from "vitest";
import { AccountError, type User } from "../accounts";
import { createRoleGuard, type Database } from "./guard";

// The owner, a member the owner made staff (app_role_members), a member with no role given, and two members whose
// stored role is one no owner can give: `owner`, and a role this code does not list.
const ACCOUNTS: Record<string, User> = {
  owner: { id: "o", email: null, role: "owner" },
  staff: { id: "s", email: "sam@example.test", role: "member" },
  member: { id: "m", email: "ada@example.test", role: "member" },
  posing: { id: "p", email: "pat@example.test", role: "member" },
  stale: { id: "x", email: "lee@example.test", role: "member" },
};
const GIVEN: Record<string, string> = { s: "staff", o: "staff", p: "owner", x: "ghost" };
const db = {
  query: async (_sql: string, values: string[]) => {
    const role = GIVEN[values[0] ?? ""];
    return { rows: role ? [{ role }] : [] };
  },
} as unknown as Database;
// The starter's requireUser, as the guard sees it: the account behind the session, or a 401.
async function requireUser(request: Request) {
  const account = ACCOUNTS[request.headers.get("x-test-account") ?? ""];
  if (!account) throw new AccountError(401, "Sign in to continue.");
  return account;
}
const as = (who?: string) =>
  new Request("http://app.test/", { headers: who ? { "x-test-account": who } : {} });
const status = (work: Promise<unknown>) =>
  work.then(
    () => 200,
    (error: unknown) => (error instanceof AccountError ? error.status : 500),
  );

describe("the role guard", () => {
  const { requireRole } = createRoleGuard(db, requireUser);

  it("denies by default: a guard that names no role lets no one in, the owner included", async () => {
    for (const who of Object.keys(ACCOUNTS))
      expect(await status(requireRole(as(who), []))).toBe(403);
  });

  it("asks who is signed in first: no session is a 401, whatever the roles", async () => {
    expect(await status(requireRole(as(), ["owner", "staff", "member"]))).toBe(401);
  });

  it("lets in only the roles it names, with the role the account has here", async () => {
    expect(await status(requireRole(as("member"), ["staff"]))).toBe(403);
    expect(await status(requireRole(as("staff"), ["owner"]))).toBe(403);
    expect(await requireRole(as("staff"), ["staff"])).toMatchObject({ id: "s", role: "staff" });
    expect(await requireRole(as("member"), ["member"])).toMatchObject({ id: "m", role: "member" });
  });

  it("counts only a role the owner may give: a stored owner, or a role no longer listed, is ignored", async () => {
    expect(await status(requireRole(as("posing"), ["owner"]))).toBe(403);
    expect(await requireRole(as("posing"), ["member"])).toMatchObject({ id: "p", role: "member" });
    expect(await status(requireRole(as("stale"), ["ghost"]))).toBe(403);
    expect(await requireRole(as("stale"), ["member"])).toMatchObject({ id: "x", role: "member" });
  });

  it("keeps the owner the owner, whatever a table says", async () => {
    expect(await requireRole(as("owner"), ["owner"])).toMatchObject({ id: "o", role: "owner" });
    expect(await status(requireRole(as("owner"), ["staff"]))).toBe(403);
  });
});
