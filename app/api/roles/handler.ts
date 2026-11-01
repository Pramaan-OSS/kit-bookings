import { database } from "../../../lib/roles/database";
import { ASSIGNABLE_ROLES } from "../../../lib/roles/guard";
import { handle, readBody, reply } from "../../../lib/roles/http";
import { assignRole, listAccounts } from "../../../lib/roles/members";
import { requireRole } from "../../../lib/roles/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner's alone: the guard runs before anything else is read, and refuses every other account.
export function GET(request: Request) {
  return handle(async () => {
    await requireRole(request, ["owner"]);
    const search = new URL(request.url).searchParams.get("search") ?? "";
    return reply({ ...(await listAccounts(database(), search)), roles: ASSIGNABLE_ROLES });
  });
}

export function POST(request: Request) {
  return handle(async () => {
    await requireRole(request, ["owner"]);
    const input = await readBody(request);
    return reply({ account: await assignRole(database(), input.id, input.role) });
  });
}
