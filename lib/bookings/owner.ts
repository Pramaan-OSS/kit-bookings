// The owner area's server side. Every function starts with requireRole(request, ["owner"]): the role is the
// server's (app_users.role), and the owner account exists only through Pramaan's owner pass.
import { siteName } from "../../app/site";
import { modulesPresent } from "../../src/lib/pramaan-modules";
import { accountRuntime, database, sessionSecret } from "../runtime";
import { formatDuration, isStaffColor } from "./format";
import { HttpError, instant, line, price, readBody, text, uuid, whole } from "./http";
import { businessName, composeEmail, deliverWithin } from "./notify";
import { managePath } from "./public";
import type { WeeklyHours } from "./slots";
import {
  addDayOff,
  bookingsBetween,
  cancelBooking,
  getBusiness,
  latestBookings,
  listDaysOff,
  listHours,
  listServices,
  listStaff,
  ownerEmail,
  removeDayOff,
  removeService,
  removeStaff,
  replaceHours,
  saveBusiness,
  saveService,
  saveStaff,
  teamSize,
} from "./store";
import { addDays, canonicalZone, isLocalDate, localDateOf, toInstant, weekdayOf } from "./time";
import { signManageToken } from "./token";

const DAY = 86_400_000;

export async function requireOwner(request: Request) {
  return accountRuntime().requireRole(request, ["owner"]);
}

/** GET /api/owner/overview — today, what's next, and what is left to set up. */
export async function overview(request: Request) {
  await requireOwner(request);
  const db = database();
  const business = await getBusiness(db);
  const today = localDateOf(Date.now(), business.timeZone);
  const start = toInstant(today, 0, business.timeZone, "later") ?? Date.now();
  const end = toInstant(addDays(today, 1), 0, business.timeZone, "later") ?? start + DAY;
  const [todays, week, latest, services, staff, email, hours] = await Promise.all([
    bookingsBetween(db, start, end),
    bookingsBetween(db, Date.now(), Date.now() + 7 * DAY),
    latestBookings(db, 5),
    listServices(db, { activeOnly: true }),
    listStaff(db, { activeOnly: true }),
    ownerEmail(db),
    listHours(db),
  ]);
  return {
    business: { ...business, name: businessName(business, siteName) },
    today: todays.filter((booking) => booking.status === "confirmed"),
    nextSevenDays: week.filter((booking) => booking.status === "confirmed").length,
    latest,
    setup: {
      ownerEmail: email,
      named: business.name.trim() !== "",
      timeZoneChosen: business.timeZone !== "UTC",
      services: services.length,
      staffRenamed: !(staff.length === 1 && staff[0]?.name === "Our team"),
      hours: hours.length > 0,
    },
    modules: modulesPresent(),
  };
}

// ---- Services ------------------------------------------------------------------------------------------------------

export async function services(request: Request) {
  await requireOwner(request);
  const db = database();
  const [list, business] = await Promise.all([listServices(db), getBusiness(db)]);
  return { services: list, currency: business.currency };
}

export async function changeServices(request: Request) {
  await requireOwner(request);
  const body = await readBody(request);
  const db = database();
  if (body.action === "remove") {
    const result = await removeService(db, uuid(body.id, "service"));
    if (!result) throw new HttpError(404, "That service is already gone.");
    return { result };
  }
  if (body.action !== "save") throw new HttpError(400, "Choose save or remove.");
  const input = (body.service ?? {}) as Record<string, unknown>;
  const id = await saveService(db, {
    id: input.id ? uuid(input.id, "service") : null,
    name: line(input.name, "a name", { min: 1, max: 80 }),
    description: text(input.description, "the description", { max: 400 }),
    durationMinutes: whole(input.durationMinutes, "Length in minutes", 5, 720),
    priceCents: price(input.price),
    bufferBeforeMinutes: whole(input.bufferBeforeMinutes ?? 0, "Time before", 0, 240),
    bufferAfterMinutes: whole(input.bufferAfterMinutes ?? 0, "Time after", 0, 240),
    active: input.active !== false,
  });
  if (!id) throw new HttpError(404, "That service is already gone.");
  return { id };
}

// ---- Staff ---------------------------------------------------------------------------------------------------------

export async function staff(request: Request) {
  await requireOwner(request);
  const db = database();
  const [people, list] = await Promise.all([listStaff(db), listServices(db)]);
  return {
    staff: people,
    services: list.map((service) => ({
      id: service.id,
      name: service.name,
      length: formatDuration(service.durationMinutes),
      active: service.active,
    })),
  };
}

export async function changeStaff(request: Request) {
  await requireOwner(request);
  const body = await readBody(request);
  const pool = database();
  if (body.action === "remove") {
    const result = await removeStaff(pool, uuid(body.id, "person"));
    if (!result) throw new HttpError(404, "That person is already gone.");
    return { result };
  }
  if (body.action !== "save") throw new HttpError(400, "Choose save or remove.");
  const input = (body.person ?? {}) as Record<string, unknown>;
  const serviceIds = Array.isArray(input.serviceIds)
    ? input.serviceIds.map((id) => uuid(id, "service"))
    : [];
  const id = await saveStaff(pool, {
    id: input.id ? uuid(input.id, "person") : null,
    name: line(input.name, "a name", { min: 1, max: 80 }),
    title: line(input.title, "the title", { max: 80 }),
    color: isStaffColor(input.color) ? input.color : "evergreen",
    active: input.active !== false,
    serviceIds,
  });
  if (!id) throw new HttpError(404, "That person is already gone.");
  return { id };
}

// ---- Hours and days off ----------------------------------------------------------------------------------------------

export async function hours(request: Request) {
  await requireOwner(request);
  const db = database();
  const business = await getBusiness(db);
  const [people, week, daysOff] = await Promise.all([
    listStaff(db, { activeOnly: true }),
    listHours(db),
    listDaysOff(db, localDateOf(Date.now(), business.timeZone)),
  ]);
  return {
    timeZone: business.timeZone,
    staff: people.map(({ id, name, color }) => ({ id, name, color })),
    hours: week,
    daysOff,
  };
}

function stretchesOf(value: unknown): WeeklyHours[] {
  if (!Array.isArray(value) || value.length > 7 * 4)
    throw new HttpError(400, "Give at most four stretches a day.");
  const stretches = value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const stretch = {
      weekday: whole(item.weekday, "The day", 0, 6),
      startMinute: whole(item.startMinute, "The start", 0, 1439),
      endMinute: whole(item.endMinute, "The end", 1, 1440),
    };
    if (stretch.endMinute <= stretch.startMinute)
      throw new HttpError(400, "Each day's hours must end after they start.");
    return stretch;
  });
  for (const a of stretches)
    for (const b of stretches)
      if (
        a !== b &&
        a.weekday === b.weekday &&
        a.startMinute < b.endMinute &&
        b.startMinute < a.endMinute
      )
        throw new HttpError(400, "Two stretches on the same day overlap. Join them into one.");
  return stretches;
}

export async function changeHours(request: Request) {
  await requireOwner(request);
  const body = await readBody(request);
  const db = database();
  if (body.action === "hours") {
    if (!(await replaceHours(db, uuid(body.staffId, "person"), stretchesOf(body.hours))))
      throw new HttpError(404, "That person is already gone.");
    return { saved: true };
  }
  if (body.action === "add-day-off") {
    if (!isLocalDate(body.day)) throw new HttpError(400, "Choose a date.");
    const id = await addDayOff(db, {
      staffId: body.staffId ? uuid(body.staffId, "person") : null,
      day: body.day,
      note: line(body.note, "the note", { max: 120 }),
    });
    if (!id) throw new HttpError(409, "That day is already off.");
    return { id };
  }
  if (body.action === "remove-day-off") {
    if (!(await removeDayOff(db, uuid(body.id, "day off"))))
      throw new HttpError(404, "That day off is already gone.");
    return { removed: true };
  }
  throw new HttpError(400, "Choose what to change.");
}

// ---- Settings -------------------------------------------------------------------------------------------------------

export async function settings(request: Request) {
  const owner = await requireOwner(request);
  const business = await getBusiness(database());
  return { business, siteName, owner: { email: owner.email }, modules: modulesPresent() };
}

const STEPS = [5, 10, 15, 20, 30, 60];

export async function changeSettings(request: Request) {
  await requireOwner(request);
  const body = await readBody(request);
  const input = (body.business ?? {}) as Record<string, unknown>;
  const timeZone = canonicalZone(input.timeZone);
  if (!timeZone) throw new HttpError(400, "Choose a time zone from the list.");
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/u.test(currency))
    throw new HttpError(400, "Enter a three-letter currency code, like USD.");
  const step = whole(input.slotStepMinutes, "Start times every", 5, 60);
  if (!STEPS.includes(step))
    throw new HttpError(400, `Start times can be every ${STEPS.join(", ")} minutes.`);
  await saveBusiness(database(), {
    name: line(input.name, "the business name", { max: 80 }),
    tagline: line(input.tagline, "the welcome line", { max: 160 }),
    address: line(input.address, "the address", { max: 200 }),
    timeZone,
    currency,
    minNoticeMinutes: whole(input.minNoticeMinutes, "Notice", 0, 43_200),
    maxDaysAhead: whole(input.maxDaysAhead, "Days ahead", 1, 365),
    slotStepMinutes: step,
    reminderHoursBefore: whole(input.reminderHoursBefore, "Reminder hours", 1, 168),
    notifyOwner: input.notifyOwner !== false,
  });
  return { saved: true };
}

// ---- Bookings --------------------------------------------------------------------------------------------------------

/**
 * GET /api/owner/bookings?week=<Monday as YYYY-MM-DD, or "current"> — every booking starting in that week, counted
 * in the business's time zone. (?from=&to= instants also work, for at most 62 days.)
 */
export async function bookings(request: Request) {
  await requireOwner(request);
  const url = new URL(request.url);
  const db = database();
  const business = await getBusiness(db);
  const zone = business.timeZone;
  const week = url.searchParams.get("week");
  let monday: string | null = null;
  let from: number;
  let to: number;
  if (week) {
    const today = localDateOf(Date.now(), zone);
    monday = week === "current" ? addDays(today, -((weekdayOf(today) + 6) % 7)) : week;
    if (!isLocalDate(monday)) throw new HttpError(400, "Choose a week.");
    from = toInstant(monday, 0, zone, "later") ?? Date.now();
    to = toInstant(addDays(monday, 7), 0, zone, "later") ?? from + 7 * DAY;
  } else {
    from = instant(url.searchParams.get("from"), "start date");
    to = instant(url.searchParams.get("to"), "end date");
    if (!(to > from) || to - from > 62 * DAY)
      throw new HttpError(400, "Ask for at most two months at once.");
  }
  const secret = sessionSecret();
  const [list, people] = await Promise.all([bookingsBetween(db, from, to, 1000), listStaff(db)]);
  return {
    monday,
    timeZone: zone,
    currency: business.currency,
    staff: people.map(({ id, name, color, active }) => ({ id, name, color, active })),
    // A future booking carries its manage link, so the owner can move it on the customer's behalf.
    bookings: list.map(({ manageNonce, ...booking }) => ({
      ...booking,
      manageUrl:
        booking.status === "confirmed" && Date.parse(booking.startsAt) > Date.now()
          ? managePath(signManageToken(booking.id, manageNonce, secret))
          : null,
    })),
  };
}

export async function changeBooking(request: Request) {
  await requireOwner(request);
  const body = await readBody(request);
  if (body.action !== "cancel") throw new HttpError(400, "Choose cancel.");
  const db = database();
  const cancelled = await cancelBooking(db, uuid(body.id, "booking"), "owner", Date.now());
  if (!cancelled)
    throw new HttpError(409, "That booking has already started, or is already cancelled.");
  const business = await getBusiness(db);
  const message = composeEmail({
    kind: "cancelled",
    booking: cancelled,
    business,
    name: businessName(business, siteName),
    manageUrl: null,
    showStaff: (await teamSize(db)) > 1,
  });
  // The cancel has committed: the answer waits for the email only a few seconds, not for a door that hangs.
  const outcome = await deliverWithin(message);
  return { cancelled: true, email: outcome };
}
