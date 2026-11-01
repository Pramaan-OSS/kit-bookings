import { handle, reply } from "../../../../lib/bookings/http";
import { changeSettings, settings } from "../../../../lib/bookings/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner only: lib/bookings/owner.ts checks the role on every call.
export function GET(request: Request) {
  return handle(async () => reply(await settings(request)));
}

export function POST(request: Request) {
  return handle(async () => reply(await changeSettings(request)));
}
