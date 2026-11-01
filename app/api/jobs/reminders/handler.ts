import { handle, reply } from "../../../../lib/bookings/http";
import { runReminders } from "../../../../lib/bookings/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by the platform's scheduled jobs (pramaan.schedules.json); refuses anything it did not sign. */
export function POST(request: Request) {
  return handle(async () => {
    const { status, value } = await runReminders(request);
    return reply(value, status);
  });
}
