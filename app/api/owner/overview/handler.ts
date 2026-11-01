import { handle, reply } from "../../../../lib/bookings/http";
import { overview } from "../../../../lib/bookings/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner only: lib/bookings/owner.ts checks the role on every call.
export function GET(request: Request) {
  return handle(async () => reply(await overview(request)));
}
