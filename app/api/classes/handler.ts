import { addClass, classList, classPlace, classTimes } from "../../../lib/bookings/classes";
import { HttpError, handle, line, readBody, reply, uuid } from "../../../lib/bookings/http";
import { getBusiness } from "../../../lib/bookings/store";
import { requireRole } from "../../../lib/roles/runtime";
import { accountRuntime, database } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handle(async () => {
    const user = await accountRuntime()
      .requireUser(request)
      .catch(() => null);
    return reply({
      sessions: await classList(database(), user?.id ?? null),
      timeZone: (await getBusiness(database())).timeZone,
    });
  });
}
export function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    if (body.action === "add") {
      await requireRole(request, ["owner"]);
      return reply(
        await addClass(database(), {
          name: line(body.name, "class name", { min: 1, max: 80 }),
          ...classTimes(body.startsLocal, body.endsLocal, (await getBusiness(database())).timeZone),
          capacity: Number(body.capacity),
        }),
      );
    }
    const user = await accountRuntime().requireUser(request);
    if (user.role === "owner")
      throw new HttpError(403, "Sign in with your customer account to book a place.");
    return reply(
      await classPlace(
        database(),
        uuid(body.sessionId, "class"),
        user.id,
        body.action === "cancel",
      ),
    );
  });
}
