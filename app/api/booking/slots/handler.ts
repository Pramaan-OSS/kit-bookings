import { handle, reply } from "../../../../lib/bookings/http";
import { findSlots } from "../../../../lib/bookings/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free start times for a service and a person (or anyone), as UTC instants. Public. */
export function GET(request: Request) {
  return handle(async () => reply(await findSlots(new URL(request.url))));
}
