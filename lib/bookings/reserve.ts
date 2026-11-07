// No double booking. A booking is made in one transaction per person tried:
//   1. lock that person's row (SELECT … FOR UPDATE), so every other booking for them waits here;
//   2. read their hours, days off and confirmed bookings as they are now, inside the lock;
//   3. check the asked-for start is still a free slot with the same function the page listed slots with;
//   4. insert, and commit, which lets the next one in.
// Two visitors who pick the same or overlapping times for one person are serialised by step 1, so the second sees
// the first's booking in step 2 and is refused. The unique index bookings_one_per_start is the backstop: a
// duplicate that got past the code is still refused by the database, and reads as "taken" here.
// The store is an interface so the protocol is tested without a database (lib/bookings/reserve.spec.ts); the
// Postgres one is lib/bookings/store.ts.
import { availableSlots, type Busy, type SlotRules, type WeeklyHours } from "./slots";
import { daysBetween, localDateOf } from "./time";

const MINUTE = 60_000;

export type ServiceTerms = {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number | null;
};

export type NewBooking = {
  id: string;
  serviceId: string;
  staffId: string;
  startsAt: number;
  endsAt: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  serviceName: string;
  priceCents: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerTimeZone: string;
  notes: string;
  customerId: string | null;
  manageNonce: string;
  rescheduledFrom: string | null;
};

/** What one booking transaction can do; every call runs inside it. */
export interface ReserveTx {
  /** Locks the person until the transaction ends. False when they are gone, inactive or don't offer it. */
  lockStaff(staffId: string, serviceId: string): Promise<boolean>;
  /** Their weekly hours, their and the business's days off, and what is busy in [from, to). */
  schedule(
    staffId: string,
    from: number,
    to: number,
    excludeBookingId: string | null,
  ): Promise<{ hours: WeeklyHours[]; daysOff: string[]; busy: Busy[] }>;
  /** Inserts; false when the database refused it as a duplicate start (the unique index). */
  insert(booking: NewBooking): Promise<boolean>;
  /** Locks the booking being moved; false unless it is still confirmed and not yet started. */
  lockReplaced(bookingId: string, now: number): Promise<boolean>;
  /** Marks the moved booking 'rescheduled' (before the insert, so its start is free for the new row). */
  markRescheduled(bookingId: string): Promise<void>;
}

/** Runs `work` in a transaction: commits what it returns, rolls back on a throw. */
export type Transact = <T>(work: (tx: ReserveTx) => Promise<T>) => Promise<T>;

export const SLOT_TAKEN = "Sorry, that time was just taken. Please pick another.";
export const SLOT_PASSED = "That time has already passed. Please pick another.";
export const SLOT_TOO_SOON = "That time is too soon to book. Please pick a later one.";
export const SLOT_TOO_FAR = "That day is too far ahead to book yet. Please pick an earlier one.";
export const SLOT_CLOSED = "We're closed that day. Please pick another.";
export const SLOT_OFF_HOURS = "That isn't a time we offer. Please pick one from the list.";

/** A start that cannot be booked: taken, unless `message` gives the rule it breaks (whyNotOffered). */
export class SlotTakenError extends Error {
  constructor(message = SLOT_TAKEN) {
    super(message);
  }
}
export class BookingGoneError extends Error {
  constructor() {
    super("This booking can no longer be changed.");
  }
}

export type ReserveInput = {
  service: ServiceTerms;
  /** The people to try, in order: one chosen person, or everyone who offers it for "anyone available". */
  staffIds: readonly string[];
  startsAt: number;
  rules: Omit<SlotRules, "durationMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes">;
  now: number;
  /** For a reschedule: the booking being moved, which stops counting as busy and is marked moved. */
  replaces: string | null;
  booking: Omit<
    NewBooking,
    | "staffId"
    | "serviceId"
    | "startsAt"
    | "endsAt"
    | "bufferBeforeMinutes"
    | "bufferAfterMinutes"
    | "serviceName"
    | "priceCents"
    | "rescheduledFrom"
  >;
};

/**
 * Why `startsAt` is not on offer: the first rule it breaks, in its own words, and "just taken" only for a start the
 * rules allow that another booking now holds. Called only after the slot check has refused the start.
 */
function whyNotOffered(
  rules: SlotRules,
  day: Awaited<ReturnType<ReserveTx["schedule"]>>,
  startsAt: number,
  now: number,
) {
  if (startsAt < now) return SLOT_PASSED;
  if (startsAt < now + rules.minNoticeMinutes * MINUTE) return SLOT_TOO_SOON;
  const date = localDateOf(startsAt, rules.timeZone);
  if (daysBetween(localDateOf(now, rules.timeZone), date) > rules.maxDaysAhead) return SLOT_TOO_FAR;
  if (day.daysOff.includes(date)) return SLOT_CLOSED;
  const unbooked = availableSlots({
    rules,
    ...day,
    busy: [],
    from: startsAt,
    to: startsAt + 1,
    now,
  });
  return unbooked[0] === startsAt ? SLOT_TAKEN : SLOT_OFF_HOURS;
}

/** Books the slot with the first person free at that time, or throws SlotTakenError saying why not. */
export async function reserve(transact: Transact, input: ReserveInput) {
  const { service, startsAt, now } = input;
  const rules: SlotRules = {
    ...input.rules,
    durationMinutes: service.durationMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
  };
  const endsAt = startsAt + service.durationMinutes * MINUTE;
  const refusals = new Set<string>();
  for (const staffId of input.staffIds) {
    const booked = await transact(async (tx) => {
      if (input.replaces && !(await tx.lockReplaced(input.replaces, now)))
        throw new BookingGoneError();
      if (!(await tx.lockStaff(staffId, service.id))) return false;
      const reach = (rules.bufferBeforeMinutes + rules.bufferAfterMinutes + 24 * 60) * MINUTE;
      const day = await tx.schedule(staffId, startsAt - reach, endsAt + reach, input.replaces);
      const free = availableSlots({
        rules,
        hours: day.hours,
        daysOff: day.daysOff,
        busy: day.busy,
        from: startsAt,
        to: startsAt + 1,
        now,
      });
      if (free[0] !== startsAt) {
        refusals.add(whyNotOffered(rules, day, startsAt, now));
        return false;
      }
      if (input.replaces) await tx.markRescheduled(input.replaces);
      const inserted = await tx.insert({
        ...input.booking,
        serviceId: service.id,
        staffId,
        startsAt,
        endsAt,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        serviceName: service.name,
        priceCents: service.priceCents,
        rescheduledFrom: input.replaces,
      });
      // A refused insert must not leave the old booking marked moved: throwing rolls the transaction back.
      if (!inserted) throw new SlotTakenError();
      return true;
    }).catch((error: unknown) => {
      if (!(error instanceof SlotTakenError)) throw error;
      refusals.add(SLOT_TAKEN);
      return false;
    });
    if (booked) return { bookingId: input.booking.id, staffId, startsAt, endsAt };
  }
  // For "anyone available", one person booked outweighs another's day off: the time is one the business offers.
  throw new SlotTakenError(refusals.has(SLOT_TAKEN) ? SLOT_TAKEN : [...refusals][0]);
}
