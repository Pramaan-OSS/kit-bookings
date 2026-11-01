import { myBookings } from "../../../../lib/bookings/customer";
import { handle, reply } from "../../../../lib/bookings/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in customer's own bookings. */
export function GET(request: Request) {
  return handle(async () => reply(await myBookings(request)));
}
