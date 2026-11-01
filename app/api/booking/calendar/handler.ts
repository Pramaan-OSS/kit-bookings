import { handle, reply } from "../../../../lib/bookings/http";
import { calendarFile } from "../../../../lib/bookings/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The booking a manage link opens, as an .ics file for the visitor's own calendar. */
export function GET(request: Request) {
  return handle(async () => {
    const file = await calendarFile(request);
    if (!file) return reply({ error: "This link doesn't open a booking." }, 404);
    return new Response(file, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="booking.ics"',
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  });
}
