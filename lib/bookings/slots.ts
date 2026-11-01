// Free slots, as a pure function: the booking page lists them, and the booking itself checks again with the
// same function inside its transaction (lib/bookings/reserve.ts), so a list the page loaded is never trusted.
import { type LocalDate, localDateOf } from "./time";

export { availableSlots } from "../time-slots/slots";

const MINUTE = 60_000;

/** One working stretch on a weekday, in local minutes of the day (0 is Sunday; end may be 1,440). */
export type WeeklyHours = { weekday: number; startMinute: number; endMinute: number };
/** A stretch of time already taken, in UTC milliseconds, its buffers included. */
export type Busy = { start: number; end: number };

export type SlotRules = {
  timeZone: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** How far apart start times are offered, from the start of each working stretch. */
  stepMinutes: number;
  /** The soonest a slot may start, counted from now. */
  minNoticeMinutes: number;
  /** The last local date a slot may be on, counted in days from today in the business's zone. */
  maxDaysAhead: number;
};

export type SlotQuery = {
  rules: SlotRules;
  hours: readonly WeeklyHours[];
  /** Local dates with no bookings, in the business's zone. */
  daysOff: ReadonlySet<LocalDate> | readonly LocalDate[];
  busy: readonly Busy[];
  /** The UTC window asked about: slots starting at or after `from` and before `to`. */
  from: number;
  to: number;
  now: number;
};

/** A booking's busy stretch: its own time widened by the buffers it was booked with. */
export function busyOf(booking: {
  startsAt: number;
  endsAt: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}): Busy {
  return {
    start: booking.startsAt - booking.bufferBeforeMinutes * MINUTE,
    end: booking.endsAt + booking.bufferAfterMinutes * MINUTE,
  };
}

/**
 * The start instants (UTC ms, ascending) a service can be booked at. A slot is offered when:
 *   - it starts on a working stretch's step, on a local date that is not a day off, and its whole length (not
 *     its buffers) fits before that stretch ends;
 *   - it starts no sooner than the notice and on a date no later than the window allows;
 *   - the slot widened by its buffers overlaps nothing already busy (whose buffers are already in `busy`).
 * A local start time the clocks skip is never offered; an end time they skip counts from after the jump.
 */
/**
 * Slots for "anyone available": each start with the staff free then, in the order given (the first is the one
 * a booking tries first).
 */
export function slotsAcrossStaff(
  perStaff: ReadonlyArray<{ staffId: string; slots: readonly number[] }>,
): Array<{ start: number; staffIds: string[] }> {
  const byStart = new Map<number, string[]>();
  for (const { staffId, slots } of perStaff) {
    for (const start of slots) {
      const list = byStart.get(start) ?? [];
      list.push(staffId);
      byStart.set(start, list);
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, staffIds]) => ({ start, staffIds }));
}

/** Groups instants by their local date in a zone (the visitor's), in order. */
export function groupByDay(instants: readonly number[], timeZone: string) {
  const days = new Map<LocalDate, number[]>();
  for (const instant of instants) {
    const day = localDateOf(instant, timeZone);
    const list = days.get(day) ?? [];
    list.push(instant);
    days.set(day, list);
  }
  return days;
}
