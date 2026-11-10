// A staff member's own day. The owner links a person in the diary to the account they sign in with (staff.user_id,
// on the Staff page) and marks that account as Staff (Roles). Both are checked on every request, so taking the role
// away, unlinking the person or releasing the account each ends access at once. Staff see the time, the service and
// the customer's name of their own confirmed bookings: never another person's, never a customer's email or phone.
import type { Member } from "../roles/guard";
import { HttpError } from "./http";
import { bookingsOfStaff, type Db, getBusiness, staffOfUser } from "./store";
import { addDays, isLocalDate, localDateOf, toInstant } from "./time";

const DAY = 86_400_000;

type Guard = (request: Request, roles: readonly string[]) => Promise<Member>;

export function createStaffApi({ db, requireRole }: { db: () => Db; requireRole: Guard }) {
  /** The person the signed-in account works as, or a 401/403. */
  async function person(request: Request) {
    const member = await requireRole(request, ["staff"]);
    const found = await staffOfUser(db(), member.id);
    if (!found)
      throw new HttpError(
        403,
        "Ask the owner to link your account to your name on the Staff page.",
      );
    return found;
  }

  /** GET /api/staff/day?day=YYYY-MM-DD: that day in the business's time zone, today when none is given. */
  async function day(request: Request) {
    const who = await person(request);
    const { timeZone } = await getBusiness(db());
    const date = new URL(request.url).searchParams.get("day") ?? localDateOf(Date.now(), timeZone);
    if (!isLocalDate(date)) throw new HttpError(400, "Choose a day.");
    const from = toInstant(date, 0, timeZone, "later") ?? Date.parse(`${date}T00:00:00Z`);
    const to = toInstant(addDays(date, 1), 0, timeZone, "later") ?? from + DAY;
    return {
      name: who.name,
      day: date,
      previous: addDays(date, -1),
      next: addDays(date, 1),
      timeZone,
      bookings: await bookingsOfStaff(db(), who.id, from, to),
    };
  }

  return { person, day };
}
