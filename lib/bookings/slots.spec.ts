import { describe, expect, it } from "vitest";
import {
  availableSlots,
  busyOf,
  groupByDay,
  type SlotRules,
  slotsAcrossStaff,
  type WeeklyHours,
} from "./slots";
import { addDays, isLocalDate, localDateOf, toInstant, weekdayOf, zonedParts } from "./time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (iso: string) => Date.parse(iso);
const iso = (instants: number[]) => instants.map((instant) => new Date(instant).toISOString());
/** Local clock times ("09:00") of slots in a zone. */
const clocks = (instants: number[], zone: string) =>
  instants.map((instant) => {
    const { minutes } = zonedParts(instant, zone);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });

const rules = (overrides: Partial<SlotRules> = {}): SlotRules => ({
  timeZone: "UTC",
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  stepMinutes: 60,
  minNoticeMinutes: 0,
  maxDaysAhead: 60,
  ...overrides,
});
const weekdays = (start: number, end: number): WeeklyHours[] =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: start, endMinute: end }));
/** One local day's window in a zone, as the booking page asks for it. */
const dayWindow = (date: string, zone: string) => ({
  from: toInstant(date, 0, zone, "later") as number,
  to: toInstant(addDays(date, 1), 0, zone, "later") as number,
});

describe("time zones", () => {
  it("turns local clock times into instants, a date at a time", () => {
    expect(new Date(toInstant("2026-07-01", 9 * 60, "Europe/London") as number).toISOString()).toBe(
      "2026-07-01T08:00:00.000Z",
    );
    expect(new Date(toInstant("2026-01-15", 9 * 60, "Europe/London") as number).toISOString()).toBe(
      "2026-01-15T09:00:00.000Z",
    );
    // Half-hour and 45-minute zones.
    expect(new Date(toInstant("2026-05-04", 9 * 60, "Asia/Kolkata") as number).toISOString()).toBe(
      "2026-05-04T03:30:00.000Z",
    );
    expect(
      new Date(toInstant("2026-05-04", 9 * 60, "Asia/Kathmandu") as number).toISOString(),
    ).toBe("2026-05-04T03:15:00.000Z");
    // Midnight that ends a day is the next day's first instant.
    expect(toInstant("2026-05-04", 1440, "UTC")).toBe(at("2026-05-05T00:00:00Z"));
  });

  it("knows a time the clocks skip, and moves it on when asked", () => {
    // New York springs forward at 02:00 on 8 March 2026: 02:30 never happens.
    expect(toInstant("2026-03-08", 150, "America/New_York", "reject")).toBeNull();
    expect(
      new Date(toInstant("2026-03-08", 150, "America/New_York", "later") as number).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("takes the earlier of a time that happens twice", () => {
    // New York falls back at 02:00 on 1 November 2026: 01:30 happens in EDT, then again in EST.
    expect(new Date(toInstant("2026-11-01", 90, "America/New_York") as number).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("reads dates, weekdays and the local parts of an instant", () => {
    expect(weekdayOf("2026-10-26")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(localDateOf(at("2026-10-26T23:30:00Z"), "Asia/Tokyo")).toBe("2026-10-27");
    expect(zonedParts(at("2026-10-26T23:30:00Z"), "America/Los_Angeles")).toMatchObject({
      date: "2026-10-26",
      minutes: 16 * 60 + 30,
      weekday: 1,
    });
  });
});

describe("slot generation", () => {
  const now = at("2026-11-01T00:00:00Z"); // a Sunday

  it("offers each step of the working day that the whole appointment fits in", () => {
    const slots = availableSlots({
      rules: rules({ durationMinutes: 45, stepMinutes: 30 }),
      hours: weekdays(9 * 60, 12 * 60),
      daysOff: [],
      busy: [],
      ...dayWindow("2026-11-02", "UTC"),
      now,
    });
    // 11:30 would end at 12:15, after closing.
    expect(clocks(slots, "UTC")).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("supports a day with a break, and nothing on a closed day", () => {
    const hours: WeeklyHours[] = [
      { weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 },
      { weekday: 2, startMinute: 13 * 60, endMinute: 14 * 60 },
    ];
    const tuesday = availableSlots({
      rules: rules(),
      hours,
      daysOff: [],
      busy: [],
      ...dayWindow("2026-11-03", "UTC"),
      now,
    });
    expect(clocks(tuesday, "UTC")).toEqual(["09:00", "10:00", "13:00"]);
    const wednesday = availableSlots({
      rules: rules(),
      hours,
      daysOff: [],
      busy: [],
      ...dayWindow("2026-11-04", "UTC"),
      now,
    });
    expect(wednesday).toEqual([]);
  });

  it("works hours out in the business's zone, whatever zone the window is asked in", () => {
    const zone = "Europe/London";
    const slots = availableSlots({
      rules: rules({ timeZone: zone }),
      hours: weekdays(9 * 60, 11 * 60),
      daysOff: [],
      busy: [],
      ...dayWindow("2026-07-06", zone),
      now: at("2026-07-01T00:00:00Z"),
    });
    expect(iso(slots)).toEqual(["2026-07-06T08:00:00.000Z", "2026-07-06T09:00:00.000Z"]);
  });

  it("finds a business's slots on the visitor's day when the zones fall on different dates", () => {
    // Tokyo opens 09:00–10:00 on Tuesday 3 November; in Los Angeles that is Monday 2 November, 16:00.
    const slots = availableSlots({
      rules: rules({ timeZone: "Asia/Tokyo" }),
      hours: [{ weekday: 2, startMinute: 9 * 60, endMinute: 10 * 60 }],
      daysOff: [],
      busy: [],
      ...dayWindow("2026-11-02", "America/Los_Angeles"),
      now,
    });
    expect(iso(slots)).toEqual(["2026-11-03T00:00:00.000Z"]);
    expect(clocks(slots, "America/Los_Angeles")).toEqual(["16:00"]);
    expect([...groupByDay(slots, "America/Los_Angeles").keys()]).toEqual(["2026-11-02"]);
    expect([...groupByDay(slots, "Asia/Tokyo").keys()]).toEqual(["2026-11-03"]);
  });

  describe("daylight saving", () => {
    const zone = "America/New_York";
    const week = (from: string, to: string) => ({
      from: toInstant(from, 0, zone, "later") as number,
      to: toInstant(to, 0, zone, "later") as number,
    });

    it("keeps a 9:00 start at 9:00 local across the spring change", () => {
      const slots = availableSlots({
        rules: rules({ timeZone: zone }),
        hours: weekdays(9 * 60, 10 * 60),
        daysOff: [],
        busy: [],
        ...week("2026-03-06", "2026-03-10"),
        now: at("2026-03-01T00:00:00Z"),
      });
      // Friday in EST (UTC-5), Monday in EDT (UTC-4): the same clock time, an hour apart in UTC.
      expect(iso(slots)).toEqual(["2026-03-06T14:00:00.000Z", "2026-03-09T13:00:00.000Z"]);
      expect(clocks(slots, zone)).toEqual(["09:00", "09:00"]);
    });

    it("keeps a 9:00 start at 9:00 local across the autumn change", () => {
      const slots = availableSlots({
        rules: rules({ timeZone: zone }),
        hours: weekdays(9 * 60, 10 * 60),
        daysOff: [],
        busy: [],
        ...week("2026-10-30", "2026-11-03"),
        now: at("2026-10-20T00:00:00Z"),
      });
      expect(iso(slots)).toEqual(["2026-10-30T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
    });

    it("never offers a start the clocks skip, and counts real time to the close", () => {
      // Open 01:00–04:00 on the spring-forward night: 02:00–03:00 does not exist, so the night is two hours long.
      const slots = availableSlots({
        rules: rules({ timeZone: zone, stepMinutes: 30 }),
        hours: [{ weekday: 0, startMinute: 60, endMinute: 4 * 60 }],
        daysOff: [],
        busy: [],
        ...week("2026-03-08", "2026-03-09"),
        now: at("2026-03-01T00:00:00Z"),
      });
      // 01:30 is real, and its hour ends at 03:30 by the clock; 03:30 itself would end after 04:00.
      expect(clocks(slots, zone)).toEqual(["01:00", "01:30", "03:00"]);
      for (const slot of slots) expect(slot + HOUR).toBeLessThanOrEqual(at("2026-03-08T08:00:00Z"));
    });

    it("offers a repeated hour once when the clocks go back", () => {
      const slots = availableSlots({
        rules: rules({ timeZone: zone }),
        hours: [{ weekday: 0, startMinute: 0, endMinute: 3 * 60 }],
        daysOff: [],
        busy: [],
        ...week("2026-11-01", "2026-11-02"),
        now: at("2026-10-20T00:00:00Z"),
      });
      expect(iso(slots)).toEqual([
        "2026-11-01T04:00:00.000Z",
        "2026-11-01T05:00:00.000Z",
        "2026-11-01T07:00:00.000Z",
      ]);
      expect(new Set(slots).size).toBe(slots.length);
    });

    it("handles Lord Howe Island's half-hour clock change", () => {
      const slots = availableSlots({
        rules: rules({ timeZone: "Australia/Lord_Howe" }),
        hours: [{ weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
        daysOff: [],
        busy: [],
        ...dayWindow("2026-10-05", "Australia/Lord_Howe"),
        now: at("2026-09-01T00:00:00Z"),
      });
      // Daylight time (UTC+11) began on 4 October 2026.
      expect(iso(slots)).toEqual(["2026-10-04T22:00:00.000Z"]);
    });
  });

  describe("buffers", () => {
    const tuesday = dayWindow("2026-11-03", "UTC");
    const booked = busyOf({
      startsAt: at("2026-11-03T10:00:00Z"),
      endsAt: at("2026-11-03T11:00:00Z"),
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 15,
    });

    it("keeps an existing booking's buffer free", () => {
      const slots = availableSlots({
        rules: rules({ stepMinutes: 15 }),
        hours: weekdays(9 * 60, 13 * 60),
        daysOff: [],
        busy: [booked],
        ...tuesday,
        now,
      });
      // 09:00 ends at 10:00 exactly; the next start after 11:00's 15 minutes of tidying is 11:15.
      expect(clocks(slots, "UTC")).toEqual(["09:00", "11:15", "11:30", "11:45", "12:00"]);
    });

    it("keeps the new booking's own buffers clear of what is booked", () => {
      const slots = availableSlots({
        rules: rules({ stepMinutes: 15, bufferBeforeMinutes: 10, bufferAfterMinutes: 20 }),
        hours: weekdays(9 * 60, 13 * 60),
        daysOff: [],
        busy: [booked],
        ...tuesday,
        now,
      });
      // 09:00 + 60 + 20 after runs into 10:00; the earliest whose 10 minutes before clears 11:15 is 11:30.
      expect(clocks(slots, "UTC")).toEqual(["11:30", "11:45", "12:00"]);
    });

    it("lets buffers run outside working hours, but never the appointment", () => {
      const slots = availableSlots({
        rules: rules({ bufferBeforeMinutes: 30, bufferAfterMinutes: 30 }),
        hours: weekdays(9 * 60, 11 * 60),
        daysOff: [],
        busy: [],
        ...tuesday,
        now,
      });
      expect(clocks(slots, "UTC")).toEqual(["09:00", "10:00"]);
    });
  });

  describe("days off, notice and the booking window", () => {
    it("offers nothing on a day off", () => {
      const slots = availableSlots({
        rules: rules(),
        hours: weekdays(9 * 60, 12 * 60),
        daysOff: new Set(["2026-11-03"]),
        busy: [],
        from: at("2026-11-02T00:00:00Z"),
        to: at("2026-11-05T00:00:00Z"),
        now,
      });
      expect([...groupByDay(slots, "UTC").keys()]).toEqual(["2026-11-02", "2026-11-04"]);
    });

    it("reads a day off as a date in the business's zone", () => {
      // Sydney's Tuesday 3 November off; that Tuesday starts at 13:00 UTC on Monday.
      const zone = "Australia/Sydney";
      const slots = availableSlots({
        rules: rules({ timeZone: zone }),
        hours: weekdays(9 * 60, 10 * 60),
        daysOff: ["2026-11-03"],
        busy: [],
        from: at("2026-11-01T00:00:00Z"),
        to: at("2026-11-05T00:00:00Z"),
        now,
      });
      expect([...groupByDay(slots, zone).keys()]).toEqual([
        "2026-11-02",
        "2026-11-04",
        "2026-11-05",
      ]);
    });

    it("holds the minimum notice", () => {
      const slots = availableSlots({
        rules: rules({ minNoticeMinutes: 120 }),
        hours: weekdays(9 * 60, 13 * 60),
        daysOff: [],
        busy: [],
        ...dayWindow("2026-11-02", "UTC"),
        now: at("2026-11-02T09:30:00Z"),
      });
      expect(clocks(slots, "UTC")).toEqual(["12:00"]);
    });

    it("offers nothing in the past or past the booking window", () => {
      const base = { hours: weekdays(9 * 60, 10 * 60), daysOff: [], busy: [] };
      const past = availableSlots({
        ...base,
        rules: rules(),
        ...dayWindow("2026-10-26", "UTC"),
        now,
      });
      expect(past).toEqual([]);
      const late = availableSlots({
        ...base,
        rules: rules({ maxDaysAhead: 7 }),
        from: now,
        to: now + 30 * DAY,
        now,
      });
      // From Sunday 1 November, seven days ahead is Sunday 8 November: the weekdays 2–6 November only.
      expect([...groupByDay(late, "UTC").keys()]).toEqual([
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
      ]);
    });

    it("answers only inside the window asked for", () => {
      const slots = availableSlots({
        rules: rules(),
        hours: weekdays(9 * 60, 17 * 60),
        daysOff: [],
        busy: [],
        from: at("2026-11-02T10:00:00Z"),
        to: at("2026-11-02T12:00:00Z"),
        now,
      });
      expect(clocks(slots, "UTC")).toEqual(["10:00", "11:00"]);
    });
  });

  it("merges people's slots for anyone available, earliest first", () => {
    expect(
      slotsAcrossStaff([
        { staffId: "a", slots: [3, 1] },
        { staffId: "b", slots: [1, 2] },
      ]),
    ).toEqual([
      { start: 1, staffIds: ["a", "b"] },
      { start: 2, staffIds: ["b"] },
      { start: 3, staffIds: ["a"] },
    ]);
  });
});
