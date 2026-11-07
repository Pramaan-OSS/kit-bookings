// What visitors can do, with no account: read the catalogue, list free slots, book, and manage a booking with its
// signed link. Route handlers in app/api/booking/* call these.
import { createHmac, randomUUID } from "node:crypto";
import { siteName } from "../../app/site";
import { clientOf, type User } from "../accounts";
import { accountRuntime, database, sessionSecret } from "../runtime";
import { foldCalendarLine } from "./calendar";
import { holdHash, holdSlot } from "./holds";
import { email, HttpError, instant, line, phone, readBody, text, uuid } from "./http";
import {
  businessName,
  composeEmail,
  composeOwnerNotice,
  deliver,
  EMAIL_WAIT_MS,
  type EmailKind,
} from "./notify";
import { reserve } from "./reserve";
import { availableSlots, slotsAcrossStaff } from "./slots";
import {
  type Booking,
  type Business,
  cancelBooking,
  claimBooking,
  getBooking,
  getBusiness,
  getService,
  hit,
  listServices,
  listStaff,
  ownerEmail,
  recordConfirmation,
  schedules,
  teamSize,
  transactor,
} from "./store";
import { canonicalZone } from "./time";
import { newManageNonce, readManageToken, signManageToken } from "./token";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The most days one slot request may cover (the page asks for a week). */
const MAX_RANGE_DAYS = 8;

/**
 * The app's public address, for links in emails. The platform sets APP_ORIGIN for the draft, the checks and the
 * live site; a request's own forwarding headers are never trusted for a link that goes out by email.
 */
export function originOf(request: Request) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/u, "");
  return new URL(request.url).origin;
}

/** The page a manage token opens: a path for links inside the app, a full address for emails. */
export const managePath = (token: string) => `/manage?token=${token}`;
export const manageUrl = (origin: string, token: string) => `${origin}${managePath(token)}`;

export async function catalog() {
  const db = database();
  const [business, services, staff] = await Promise.all([
    getBusiness(db),
    listServices(db, { activeOnly: true }),
    listStaff(db, { activeOnly: true }),
  ]);
  const active = new Set(staff.map((person) => person.id));
  return {
    business: {
      name: businessName(business, siteName),
      tagline: business.tagline,
      address: business.address,
      timeZone: business.timeZone,
      currency: business.currency,
      maxDaysAhead: business.maxDaysAhead,
    },
    services: services
      .map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
        staffIds: service.staffIds.filter((id) => active.has(id)),
      }))
      .filter((service) => service.staffIds.length > 0),
    staff: staff.map(({ id, name, title, color }) => ({ id, name, title, color })),
  };
}

/** The service and the people to look at for it: one chosen person, or everyone who offers it. */
async function bookable(serviceId: string, staffChoice: string) {
  const db = database();
  const [business, service, staff] = await Promise.all([
    getBusiness(db),
    getService(db, serviceId),
    listStaff(db, { activeOnly: true }),
  ]);
  if (!service?.active) throw new HttpError(404, "That service is no longer offered.");
  const offering = staff.filter((person) => person.serviceIds.includes(service.id));
  const staffIds =
    staffChoice === "any"
      ? offering.map((person) => person.id)
      : offering.filter((person) => person.id === staffChoice).map((person) => person.id);
  if (staffIds.length === 0) throw new HttpError(404, "Nobody offers that service at the moment.");
  return { business, service, staffIds };
}

const rulesOf = (business: Business) => ({
  timeZone: business.timeZone,
  stepMinutes: business.slotStepMinutes,
  minNoticeMinutes: business.minNoticeMinutes,
  maxDaysAhead: business.maxDaysAhead,
});

/** The booking a manage token opens, or null: a forged, altered or revoked token opens nothing. */
async function bookingOfToken(token: unknown) {
  const read = readManageToken(token, sessionSecret());
  if (!read) return null;
  const booking = await getBooking(database(), read.bookingId);
  return booking && booking.manageNonce === read.nonce ? booking : null;
}

type Bookable = Awaited<ReturnType<typeof bookable>>;

/** Hours, days off and what is busy for the people looked at, around [from, to): three queries, whatever the span. */
function loadSchedules(input: Bookable, from: number, to: number, moving: Booking | null) {
  const { service, staffIds } = input;
  const reach = (service.bufferBeforeMinutes + service.bufferAfterMinutes) * MINUTE + DAY;
  return schedules(database(), staffIds, from - reach, to + reach, moving?.id ?? null);
}

function slotsIn(
  input: Bookable,
  found: Awaited<ReturnType<typeof schedules>>,
  from: number,
  to: number,
  now: number,
  moving: Booking | null,
) {
  const { business, service, staffIds } = input;
  const rules = {
    ...rulesOf(business),
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
  };
  const perStaff = staffIds.map((staffId) => {
    const day = found.get(staffId) ?? { hours: [], daysOff: [], busy: [] };
    const slots = availableSlots({ rules, ...day, from, to, now }).filter(
      // Moving a booking never offers the time it already has.
      (start) => !(moving && moving.staffId === staffId && Date.parse(moving.startsAt) === start),
    );
    return { staffId, slots };
  });
  return slotsAcrossStaff(perStaff);
}

/**
 * GET /api/booking/slots?service=&staff=<id|any>&from=&to=[&token=] — free starts in [from, to), at most eight days.
 * With first=1 instead of from and to: the soonest free start in the whole booking window, or null. Either way the
 * database is asked once (three queries); the window is then searched in memory, two weeks at a time.
 * A manage token (when moving a booking) lets its own time count as free, for its own service.
 */
export async function findSlots(url: URL) {
  const params = url.searchParams;
  const token = params.get("token");
  const moving = token ? await bookingOfToken(token) : null;
  if (token && moving?.status !== "confirmed")
    throw new HttpError(404, "This booking can no longer be changed.");
  const serviceId = moving ? moving.serviceId : uuid(params.get("service"), "service");
  const staffChoice = params.get("staff") === "any" ? "any" : uuid(params.get("staff"), "person");
  const input = await bookable(serviceId, staffChoice);
  const now = Date.now();
  if (params.get("first") === "1") {
    const last = now + (input.business.maxDaysAhead + 2) * DAY;
    const found = await loadSchedules(input, now, last, moving);
    for (let from = now; from < last; from += 14 * DAY) {
      const slots = slotsIn(input, found, from, Math.min(from + 14 * DAY, last), now, moving);
      if (slots[0])
        return {
          first: { start: new Date(slots[0].start).toISOString(), staffIds: slots[0].staffIds },
        };
    }
    return { first: null };
  }
  const from = instant(params.get("from"), "start date");
  const to = instant(params.get("to"), "end date");
  if (!(to > from) || to - from > MAX_RANGE_DAYS * DAY)
    throw new HttpError(400, "Ask for at most a week of times at once.");
  const found = slotsIn(input, await loadSchedules(input, from, to, moving), from, to, now, moving);
  return {
    timeZone: input.business.timeZone,
    slots: found.map(({ start, staffIds }) => ({ start: new Date(start).toISOString(), staffIds })),
  };
}

/** The signed-in account behind a request, if any (booking needs none). */
async function signedIn(request: Request): Promise<User | null> {
  if (!request.headers.get("cookie")) return null;
  return accountRuntime()
    .requireUser(request)
    .catch(() => null);
}

/** Throttle keys never hold an address or an email as written: an HMAC under the app's secret. */
const throttleKey = (value: string) =>
  createHmac("sha256", sessionSecret()).update(value).digest("hex");

/** How many times each kind of public request may run, in a window of seconds. */
export const LIMITS = Object.freeze({
  bookingsPerClientHour: 20,
  bookingsPerEmailDay: 8,
  changesPerCustomerHour: 3,
  changesPerClientHour: 10,
});

/**
 * Public booking requests: per client an hour, and per email from one client a day. The email is one a visitor typed,
 * not one they own, so its day count is kept for the client and the address together: no one can use up an address's
 * bookings from elsewhere and lock its real owner out.
 */
export async function throttle(request: Request, address: string, db = database()) {
  const client = clientOf(request);
  const perClient = await hit(db, throttleKey(`client ${client}`), 3600);
  const perEmail = await hit(db, throttleKey(`email ${client} ${address}`), 86_400);
  if (perClient > LIMITS.bookingsPerClientHour || perEmail > LIMITS.bookingsPerEmailDay)
    throw new HttpError(
      429,
      "That's a lot of bookings in a short time. Please wait a little, or get in touch with us directly.",
    );
}

/** Moves and cancels through a manage link: per customer and per client, an hour. */
async function changeThrottle(request: Request, booking: Booking) {
  const db = database();
  const perCustomer = await hit(db, throttleKey(`changes ${booking.customerEmail}`), 3600);
  const perClient = await hit(db, throttleKey(`changes client ${clientOf(request)}`), 3600);
  if (perCustomer > LIMITS.changesPerCustomerHour || perClient > LIMITS.changesPerClientHour)
    throw new HttpError(
      429,
      "This booking has changed several times in the last hour. Please wait a little, or get in touch with us directly.",
    );
}

/** Sends a booking's email in the background of the answer: waits a few seconds, records the outcome whenever. */
export async function sendAndRecord(
  kind: EmailKind,
  booking: Booking,
  origin: string,
  token: string | null,
) {
  const db = database();
  const business = await getBusiness(db);
  const name = businessName(business, siteName);
  const message = composeEmail({
    kind,
    booking,
    business,
    name,
    manageUrl: token ? manageUrl(origin, token) : null,
    showStaff: (await teamSize(db)) > 1,
  });
  const customer = deliver(message)
    .then(async (outcome) => {
      if (kind === "confirmation" || kind === "moved")
        await recordConfirmation(db, booking.id, outcome.status, outcome.note);
      return outcome;
    })
    .catch(() => {
      // It may land after the answer has gone, so this log is all that is left of it. Never the address.
      console.error("bookings: email outcome not recorded", { kind });
      return null;
    });
  const ownerTo = business.notifyOwner && kind !== "reminder" ? await ownerEmail(db) : null;
  if (ownerTo) {
    const notice = composeOwnerNotice({
      kind: kind === "confirmation" ? "new" : kind === "moved" ? "moved" : "cancelled",
      booking,
      business,
      to: ownerTo,
      ownerUrl: `${origin}/owner/bookings`,
    });
    void deliver(notice).catch(() => {});
  }
  const waited = await Promise.race([
    customer,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), EMAIL_WAIT_MS).unref?.();
    }),
  ]);
  return waited;
}

function bookingDetails(body: Record<string, unknown>) {
  return {
    customerName: line(body.name, "your name", { min: 1, max: 120 }),
    customerEmail: email(body.email),
    customerPhone: phone(body.phone),
    notes: text(body.notes, "your note", { max: 1000 }),
  };
}

/**
 * POST /api/booking/book — books a slot; answers the manage token. The cheap checks come first, then the throttle,
 * and only then anything that reads the database or the visitor's time zone.
 */
export async function book(request: Request, holding = false) {
  const body = await readBody(request);
  const serviceId = uuid(body.serviceId, "service");
  const staffChoice = body.staffId === "any" ? "any" : uuid(body.staffId, "person");
  const startsAt = instant(body.startsAt);
  const details = holding
    ? { customerName: "", customerEmail: "", customerPhone: "", notes: "" }
    : bookingDetails(body);
  if (holding) {
    if ((await hit(database(), throttleKey(`holds ${clientOf(request)}`), 3600)) > 20)
      throw new HttpError(429, "Please wait a little before holding another time.");
  } else await throttle(request, details.customerEmail);
  const input = await bookable(serviceId, staffChoice);
  // Stored as the runtime's own name for the zone, whatever spelling the browser sent.
  const customerTimeZone = canonicalZone(body.timeZone) ?? input.business.timeZone;
  const user = await signedIn(request);
  const id = randomUUID();
  const nonce = newManageNonce();
  const reserveInput = {
    service: input.service,
    staffIds: input.staffIds,
    startsAt,
    rules: rulesOf(input.business),
    now: Date.now(),
    replaces: null,
    booking: {
      id,
      ...details,
      customerTimeZone,
      // A signed-in customer's booking shows in their account; the owner booking for someone else is not theirs.
      customerId: user && user.role !== "owner" ? user.id : null,
      manageNonce: nonce,
    },
  };
  if (holding)
    return holdSlot(
      database(),
      reserveInput,
      typeof body.holdToken === "string" ? body.holdToken : undefined,
    );
  const held =
    typeof body.holdToken === "string" && /^[a-f0-9]{64}$/.test(body.holdToken)
      ? holdHash(body.holdToken)
      : null;
  await reserve(transactor(database(), held), reserveInput);
  const token = signManageToken(id, nonce, sessionSecret());
  const booking = await getBooking(database(), id);
  if (booking) await sendAndRecord("confirmation", booking, originOf(request), token);
  return { token };
}

/** What a manage link shows: the booking, never its nonce, plus whether it can still change. */
function shown(booking: Booking, business: Business, people: number) {
  const { manageNonce: _nonce, customerId, ...rest } = booking;
  return {
    ...rest,
    showStaff: people > 1,
    saved: customerId !== null,
    canChange: booking.status === "confirmed" && Date.parse(booking.startsAt) > Date.now(),
    business: {
      name: businessName(business, siteName),
      address: business.address,
      timeZone: business.timeZone,
      currency: business.currency,
      maxDaysAhead: business.maxDaysAhead,
    },
  };
}

/** GET /api/booking/manage?token= */
export async function openBooking(url: URL) {
  const booking = await bookingOfToken(url.searchParams.get("token"));
  if (!booking)
    throw new HttpError(
      404,
      "This link doesn't open a booking. Check it's the whole link from your confirmation.",
    );
  const business = await getBusiness(database());
  const replacement = booking.replacedBy ? await getBooking(database(), booking.replacedBy) : null;
  return {
    booking: shown(booking, business, await teamSize(database())),
    movedTo: replacement
      ? { startsAt: replacement.startsAt, staffName: replacement.staffName }
      : null,
  };
}

/** POST /api/booking/manage — { token, action: "cancel" | "move" | "save", startsAt?, staffId? } */
export async function changeBooking(request: Request) {
  const body = await readBody(request);
  const booking = await bookingOfToken(body.token);
  if (!booking) throw new HttpError(404, "This link doesn't open a booking.");
  const db = database();
  const origin = originOf(request);
  // Each move or cancel emails the customer and the owner, from the app's small hourly email allowance: a link's
  // holder gets a few changes an hour, counted by the booking's customer (a move makes a new booking, so its id
  // would start the count again) and by client.
  if (body.action === "cancel" || body.action === "move") await changeThrottle(request, booking);
  if (body.action === "cancel") {
    const cancelled = await cancelBooking(db, booking.id, "customer", Date.now());
    if (!cancelled) throw new HttpError(409, "This booking can no longer be cancelled.");
    await sendAndRecord("cancelled", cancelled, origin, null);
    return { cancelled: true };
  }
  if (body.action === "save") {
    const user = await signedIn(request);
    if (!user) throw new HttpError(401, "Sign in to save this booking to your account.");
    if (user.role === "owner")
      throw new HttpError(403, "Sign in with your customer account to save it.");
    if (!(await claimBooking(db, booking.id, user.id)))
      throw new HttpError(409, "This booking is already saved to another account.");
    return { saved: true };
  }
  if (body.action !== "move") throw new HttpError(400, "Choose cancel or move.");
  const startsAt = instant(body.startsAt);
  const staffChoice =
    body.staffId === undefined
      ? booking.staffId
      : body.staffId === "any"
        ? "any"
        : uuid(body.staffId, "person");
  if (staffChoice === booking.staffId && startsAt === Date.parse(booking.startsAt))
    throw new HttpError(400, "That's already your booking's time. Pick another.");
  const input = await bookable(booking.serviceId, staffChoice);
  const id = randomUUID();
  const nonce = newManageNonce();
  await reserve(transactor(db), {
    service: input.service,
    staffIds: input.staffIds,
    startsAt,
    rules: rulesOf(input.business),
    now: Date.now(),
    replaces: booking.id,
    booking: {
      id,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      customerTimeZone: canonicalZone(body.timeZone) ?? booking.customerTimeZone,
      notes: booking.notes,
      customerId: booking.customerId,
      manageNonce: nonce,
    },
  });
  const token = signManageToken(id, nonce, sessionSecret());
  const moved = await getBooking(db, id);
  if (moved) await sendAndRecord("moved", moved, origin, token);
  return { token };
}

const icsText = (value: string) =>
  value.replace(/[\\;,]/gu, (mark) => `\\${mark}`).replace(/\r\n|\r|\n/gu, "\\n");
const icsTime = (iso: string) => iso.replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");

/** GET /api/booking/calendar?token= — the booking as a calendar file. */
export async function calendarFile(request: Request) {
  const url = new URL(request.url);
  const booking = await bookingOfToken(url.searchParams.get("token"));
  if (booking?.status !== "confirmed") return null;
  const business = await getBusiness(database());
  const name = businessName(business, siteName);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pramaan//Bookings kit//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@bookings`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(booking.startsAt)}`,
    `DTEND:${icsTime(booking.endsAt)}`,
    `SUMMARY:${icsText(`${booking.serviceName} · ${name}`)}`,
    ...(business.address ? [`LOCATION:${icsText(business.address)}`] : []),
    `DESCRIPTION:${icsText(`With ${booking.staffName}. Change or cancel: ${manageUrl(originOf(request), url.searchParams.get("token") ?? "")}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return lines.map(foldCalendarLine).join("\r\n");
}
