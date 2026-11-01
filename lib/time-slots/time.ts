// Time zones without a date library. Bookings are stored as UTC instants (milliseconds); working hours are
// local clock times in the business's IANA time zone, turned into instants one date at a time, so a 9:00 start
// stays 9:00 across a clock change. Shared by the server (slots) and the browser (the viewer's own view).
//
// THE TIME-ZONE RULES (BLOCK.md, "What never to change"): work in the business's zone, show in the viewer's; never
// add hours to move between zones; store a zone only as `canonicalZone()` names it; and never cache per spelling.

/** A calendar date, "2026-03-09". */
export type LocalDate = string;

const MINUTE = 60_000;
const DAY = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

const PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};
/**
 * One formatter per zone, keyed by the runtime's own name for it (`resolvedOptions().timeZone`), never by the
 * spelling asked for: IANA names are case-insensitive, so "europe/london" and "EUROPE/LONDON" are one entry, and
 * a stranger sending endless spellings grows nothing. The runtime knows about 600 zones; the cap holds whatever
 * it reports, dropping the oldest entry first.
 */
const MAX_FORMATTERS = 700;
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  // A spelling that isn't the canonical name makes a formatter that is used once and dropped.
  const made = new Intl.DateTimeFormat("en-US", { ...PARTS, timeZone });
  const name = made.resolvedOptions().timeZone;
  const known = formatters.get(name);
  if (known) return known;
  if (formatters.size >= MAX_FORMATTERS)
    formatters.delete(formatters.keys().next().value as string);
  formatters.set(name, made);
  return made;
}

/** How many zone formatters are held (for tests: it stays bounded whatever is asked). */
export const formatterCount = () => formatters.size;

/**
 * The runtime's own name for a zone ("europe/london" is "Europe/London"), or null when it isn't one. Caches
 * nothing, so it is safe on any input. Store this name, never the spelling a browser sent.
 */
export function canonicalZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The local wall clock at an instant: its date, minute of the day and weekday (0 is Sunday). */
export function zonedParts(instant: number, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const year = values.year ?? 1970;
  const month = values.month ?? 1;
  const day = values.day ?? 1;
  const hour = (values.hour ?? 0) % 24;
  const minute = values.minute ?? 0;
  const second = values.second ?? 0;
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    date,
    minutes: hour * 60 + minute,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    wall: Date.UTC(year, month - 1, day, hour, minute, second),
  };
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds (London in summer: 3,600,000). */
export function offsetAt(instant: number, timeZone: string) {
  const whole = Math.floor(instant / 1000) * 1000;
  return zonedParts(whole, timeZone).wall - whole;
}

export function isLocalDate(value: unknown): value is LocalDate {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  return new Date(time).toISOString().slice(0, 10) === value;
}

function dateParts(date: LocalDate) {
  const match = DATE.exec(date);
  if (!match) throw new Error(`Not a date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 is Sunday, as JavaScript counts. */
export function weekdayOf(date: LocalDate) {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysBetween(from: LocalDate, to: LocalDate) {
  const [a, b] = [dateParts(from), dateParts(to)];
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY);
}

export function localDateOf(instant: number, timeZone: string): LocalDate {
  return zonedParts(instant, timeZone).date;
}

/**
 * The instant a local clock time on a date names, in a zone. Minutes may be 1,440 (midnight that ends the day).
 * When the clocks jump forward the time does not exist: "reject" answers null, and "later" moves it on by the
 * jump, as a wall clock would read (02:30 on a spring-forward night is 03:30). When the clocks go back the time
 * happens twice, and the earlier one is answered.
 */
export function toInstant(
  date: LocalDate,
  minutes: number,
  timeZone: string,
  missing: "reject" | "later" = "reject",
): number | null {
  const [year, month, day] = dateParts(date);
  const wall = Date.UTC(year, month - 1, day) + minutes * MINUTE;
  // The zone's offsets around this wall time; a zone changes offset at most once in a day either side.
  const offsets = [
    ...new Set([
      offsetAt(wall - DAY, timeZone),
      offsetAt(wall, timeZone),
      offsetAt(wall + DAY, timeZone),
    ]),
  ];
  const matches = offsets
    .map((offset) => wall - offset)
    .filter((instant) => offsetAt(instant, timeZone) === wall - instant)
    .sort((a, b) => a - b);
  if (matches[0] !== undefined) return matches[0];
  if (missing === "reject") return null;
  // In the gap: the offset before the jump, applied to the wall time, lands just after it.
  return wall - offsetAt(wall - DAY, timeZone);
}

/**
 * `toInstant` for many times on one date, with the zone looked up once for the date. When the zone's offset is the
 * same across the days around it (all but a few days a year) every time is that offset away from the wall clock;
 * on a day near a clock change it falls back to `toInstant`, which finds the offset time by time. Answers are the same
 * as `toInstant`'s (time.spec.ts compares them across a year in several zones).
 */
export function dayClock(date: LocalDate, timeZone: string) {
  const [year, month, day] = dateParts(date);
  const midnight = Date.UTC(year, month - 1, day);
  const offsets = new Set(
    [-DAY, 0, DAY / 2, DAY, 1.5 * DAY, 2 * DAY].map((step) => offsetAt(midnight + step, timeZone)),
  );
  const only = offsets.size === 1 ? [...offsets][0] : undefined;
  return (minutes: number, missing: "reject" | "later" = "reject"): number | null =>
    only === undefined
      ? toInstant(date, minutes, timeZone, missing)
      : midnight + minutes * MINUTE - only;
}

/** Every IANA zone the runtime lists, for a picker; UTC first. */
export function timeZones(): string[] {
  const listed =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return ["UTC", ...listed.filter((zone) => zone !== "UTC")];
}

// ---- Display ----------------------------------------------------------------------------------------------

export function formatTime(instant: number, timeZone: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(instant),
  );
}

export function formatDay(instant: number, timeZone: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(instant));
}

export function formatWhen(instant: number, timeZone: string, locale?: string) {
  return `${formatDay(instant, timeZone, locale)}, ${formatTime(instant, timeZone, locale)}`;
}

/** "GMT+5:30" style label for a zone at an instant, for "times are shown in …" notes. */
export function zoneLabel(instant: number, timeZone: string, locale?: string) {
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(instant))
    .find((entry) => entry.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** "9:30" from a minute of the day, for the owner's hours editor (24-hour, as <input type=time> wants). */
export function clock(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A minute of the day from "09:30" (or "24:00"), or null. */
export function minutesOf(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && total <= 1440 ? total : null;
}
