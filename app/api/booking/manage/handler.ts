import { handle, reply } from "../../../../lib/bookings/http";
import { changeBooking, openBooking } from "../../../../lib/bookings/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The booking a signed manage link opens. */
export function GET(request: Request) {
  return handle(async () => reply(await openBooking(new URL(request.url))));
}

/** Cancel or move that booking, or save it to the signed-in customer's account. */
export function POST(request: Request) {
  return handle(async () => reply(await changeBooking(request)));
}
