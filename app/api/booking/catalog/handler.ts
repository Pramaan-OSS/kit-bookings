import { handle, reply } from "../../../../lib/bookings/http";
import { catalog } from "../../../../lib/bookings/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The booking page's catalogue: the business, its services and who offers them. Public. */
export function GET() {
  return handle(async () => reply(await catalog()));
}
