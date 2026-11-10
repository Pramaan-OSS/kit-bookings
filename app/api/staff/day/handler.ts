import { handle, reply } from "../../../../lib/bookings/http";
import { createStaffApi } from "../../../../lib/bookings/staff";
import { requireRole } from "../../../../lib/roles/runtime";
import { database } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const staff = createStaffApi({ db: database, requireRole });

// A linked staff member's own day only: lib/bookings/staff.ts checks the role and the link on every call.
export function GET(request: Request) {
  return handle(async () => reply(await staff.day(request)));
}
