import { handle, reply } from "../../../../lib/bookings/http";
import { book } from "../../../../lib/bookings/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Books a slot (lib/bookings/reserve.ts holds the lock). Public; throttled per client and per email. */
export function POST(request: Request) {
  return handle(async () => reply(await book(request), 201));
}
