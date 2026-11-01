// Free slots, as a pure function: the booking page lists them, and the booking itself checks again with the
// same function inside its transaction (lib/time-slots/store.ts reserve), so a list the page loaded is never trusted.
import { addDays, dayClock, daysBetween, type LocalDate, localDateOf, weekdayOf } from "./time";

const MINUTE = 60_000;

/** One working stretch on a weekday, in local minutes of the day (0 is Sunday; end may be 1,440). */
export type WeeklyHours = { weekday: number; startMinute: number; endMinute: number };
/** A stretch of time already taken, in UTC milliseconds, its buffers included. */
export type Busy = { start: number; end: number };

export type SlotRules = {
  /** The business's zone: hours and days off are local to it. */
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
  /** Local dates that are closed, in the business's zone. */
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

/** Busy stretches as disjoint ones in order, so an overlap is found by a search, not a scan of them all. */
function mergeBusy(busy: readonly Busy[]): Busy[] {
  const merged: Busy[] = [];
  for (const item of [...busy].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ start: item.start, end: item.end });
  }
  return merged;
}

/** Whether [start, end) touches any of the disjoint, ordered busy stretches. */
function overlaps(taken: readonly Busy[], start: number, end: number) {
  let low = 0;
  let high = taken.length;
  // The first stretch that ends after `start`.
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((taken[middle] as Busy).end > start) high = middle;
    else low = middle + 1;
  }
  const next = taken[low];
  return next !== undefined && next.start < end;
}

/**
 * The start instants (UTC ms, ascending) a service can be booked at. A slot is offered when:
 *   - it starts on a working stretch's step, on a local date that is not a day off, and its whole length (not
 *     its buffers) fits before that stretch ends;
 *   - it starts no sooner than the notice and on a date no later than the window allows;
 *   - the slot widened by its buffers overlaps nothing already busy (whose buffers are already in `busy`).
 * A local start time the clocks skip is never offered; an end time they skip counts from after the jump.
 */
export function availableSlots(query: SlotQuery): number[] {
  const { rules, hours, busy, from, to, now } = query;
  const daysOff = query.daysOff instanceof Set ? query.daysOff : new Set(query.daysOff);
  if (!(to > from) || rules.durationMinutes <= 0 || rules.stepMinutes <= 0) return [];
  const duration = rules.durationMinutes * MINUTE;
  const before = rules.bufferBeforeMinutes * MINUTE;
  const after = rules.bufferAfterMinutes * MINUTE;
  const earliest = Math.max(from, now + rules.minNoticeMinutes * MINUTE);
  const today = localDateOf(now, rules.timeZone);
  const lastDate = addDays(today, rules.maxDaysAhead);
  // The local dates that can hold a slot inside [from, to): a day either side covers any zone's offset.
  let date = localDateOf(earliest, rules.timeZone);
  date = addDays(date, -1);
  const end = addDays(localDateOf(to, rules.timeZone), 1);
  const taken = mergeBusy(busy);
  const found = new Set<number>();
  for (; daysBetween(date, end) >= 0; date = addDays(date, 1)) {
    if (daysBetween(date, today) > 0 || daysBetween(date, lastDate) < 0) continue;
    if (daysOff.has(date)) continue;
    const weekday = weekdayOf(date);
    // One zone lookup set per date, not per candidate: a day of 5-minute slots has hundreds.
    const instantOf = dayClock(date, rules.timeZone);
    for (const stretch of hours) {
      if (stretch.weekday !== weekday || stretch.endMinute <= stretch.startMinute) continue;
      const close = instantOf(stretch.endMinute, "later");
      if (close === null) continue;
      for (
        let minute = stretch.startMinute;
        minute + rules.durationMinutes <= stretch.endMinute;
        minute += rules.stepMinutes
      ) {
        const start = instantOf(minute, "reject");
        if (start === null || start < earliest || start >= to) continue;
        if (start + duration > close) continue;
        const blockStart = start - before;
        const blockEnd = start + duration + after;
        if (overlaps(taken, blockStart, blockEnd)) continue;
        found.add(start);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
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
