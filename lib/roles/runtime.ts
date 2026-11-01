import { headers } from "next/headers";
import { AccountError } from "../accounts";
import { accountRuntime } from "../runtime";
import { database } from "./database";
import { createRoleGuard, type Member } from "./guard";

let guard: ReturnType<typeof createRoleGuard> | undefined;
function roleGuard() {
  guard ??= createRoleGuard(database(), (request) => accountRuntime().requireUser(request));
  return guard;
}

/**
 * Every API route's guard, first thing: the account behind the request when its role is one of `roles`, else a
 * 401 (no session) or a 403. Deny by default: name every role that may call the route, `owner` included.
 */
export function requireRole(request: Request, roles: readonly string[]) {
  return roleGuard().requireRole(request, roles);
}

/**
 * Every page's guard, on the server: the signed-in account when its role is one of `roles`, else null, and the page
 * shows how to get in instead. Closed on any failure: a page never shows what it guards because storage was down.
 */
export async function pageRole(roles: readonly string[]): Promise<Member | null> {
  const cookie = (await headers()).get("cookie") ?? "";
  try {
    return await requireRole(new Request("http://app.internal/", { headers: { cookie } }), roles);
  } catch (error) {
    if (!(error instanceof AccountError)) console.error("page guard failed", error);
    return null;
  }
}
