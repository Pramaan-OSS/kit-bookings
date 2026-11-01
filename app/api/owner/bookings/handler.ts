import { handle, reply } from "../../../../lib/bookings/http";
import { bookings, changeBooking } from "../../../../lib/bookings/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner only: lib/bookings/owner.ts checks the role on every call.
export function GET(request: Request) {
  return handle(async () => reply(await bookings(request)));
}

export function POST(request: Request) {
  return handle(async () => reply(await changeBooking(request)));
}
