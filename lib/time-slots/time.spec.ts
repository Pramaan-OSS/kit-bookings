// Time zones: the formatter cache stays bounded whatever strangers send, a day with a clock change is right, and a
// slot is worked out in the business's zone but shown in the viewer's. No database needed.
import { describe, expect, it, vi } from "vitest";
import { availableSlots, groupByDay, type SlotRules, type WeeklyHours } from "./slots";
import {
  addDays,
  canonicalZone,
  dayClock,
  formatTime,
  formatterCount,
  formatWhen,
  timeZones,
  toInstant,
  zonedParts,
} from "./time";

const at = (text: string) => Date.parse(text);
const iso = (instants: number[]) => instants.map((instant) => new Date(instant).toISOString());
/** Intl may put a narrow no-break space before AM or PM: read it as a plain space. */
const plain = (text: string) => text.replace(/\s/gu, " ");

/** `count` distinct spellings of a zone, each letter's case flipped by the bits of its index. */
function spellings(zone: string, count: number) {
  const letters = [...zone]
    .map((char, place) => ({ char, place }))
    .filter(({ char }) => /[a-z]/iu.test(char));
  const out = new Set<string>();
  for (let n = 0; out.size < count && n < 2 ** letters.length; n++) {
    const chars = [...zone];
    letters.forEach(({ char, place }, bit) => {
      chars[place] = (n >> bit) & 1 ? char.toUpperCase() : char.toLowerCase();
    });
    out.add(chars.join(""));
  }
  return [...out];
}

describe("the zone formatter cache", () => {
  const variants = spellings("Europe/London", 1_000);
  const instant = at("2026-07-01T08:00:00Z");

  it("has 1,000 different spellings of one zone to work with", () => {
    expect(variants).toHaveLength(1_000);
    expect(new Set(variants.map((zone) => zone.toLowerCase())).size).toBe(1);
  });

  it("names every spelling by the runtime's own name, and checking them caches nothing", () => {
    const before = formatterCount();
    for (const zone of variants) expect(canonicalZone(zone)).toBe("Europe/London");
    expect(formatterCount()).toBe(before);
    expect(canonicalZone("Not/AZone")).toBeNull();
    expect(canonicalZone("x".repeat(65))).toBeNull();
    expect(canonicalZone(42)).toBeNull();
  });

  it("keeps at most one entry for the 1,000 spellings of a zone it formats", () => {
    const before = formatterCount();
    for (const zone of variants) expect(zonedParts(instant, zone).minutes).toBe(9 * 60);
    expect(formatterCount() - before).toBeLessThanOrEqual(1);
  });

  it("never holds more than its cap, however many zones are used in however many spellings", () => {
    for (const zone of timeZones()) zonedParts(instant, zone);
    for (const zone of timeZones()) zonedParts(instant, zone.toUpperCase());
    expect(formatterCount()).toBeLessThanOrEqual(700);
  });
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
const everyDay = (startMinute: number, endMinute: number): WeeklyHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute, endMinute }));
/** The slots on one local date in a zone. */
function onDate(date: string, zone: string, hours: WeeklyHours[], extra: Partial<SlotRules> = {}) {
  return availableSlots({
    rules: rules({ timeZone: zone, ...extra }),
    hours,
    daysOff: [],
    busy: [],
    from: toInstant(date, 0, zone, "later") as number,
    to: toInstant(date, 1440, zone, "later") as number,
    now: at(`${date}T00:00:00Z`) - 2 * 86_400_000,
  });
}

describe("a day with a clock change", () => {
  const london = "Europe/London";

  it("keeps 9:00 at 9:00 on the clock across the spring change (London, 29 March 2026)", () => {
    const hours = everyDay(9 * 60, 10 * 60);
    expect(iso(onDate("2026-03-28", london, hours))).toEqual(["2026-03-28T09:00:00.000Z"]);
    // The clocks went forward in the night: 9:00 is now 08:00 UTC.
    expect(iso(onDate("2026-03-29", london, hours))).toEqual(["2026-03-29T08:00:00.000Z"]);
  });

  it("keeps 9:00 at 9:00 on the clock across the autumn change (London, 25 October 2026)", () => {
    const hours = everyDay(9 * 60, 10 * 60);
    expect(iso(onDate("2026-10-24", london, hours))).toEqual(["2026-10-24T08:00:00.000Z"]);
    expect(iso(onDate("2026-10-25", london, hours))).toEqual(["2026-10-25T09:00:00.000Z"]);
  });

  it("never offers a time the clocks skip, and the day's slots are one real hour apart or more", () => {
    // 01:00 to 02:00 does not exist in London on 29 March 2026.
    const slots = onDate("2026-03-29", london, everyDay(0, 4 * 60));
    expect(iso(slots)).toEqual([
      "2026-03-29T00:00:00.000Z", // 00:00 GMT
      "2026-03-29T01:00:00.000Z", // 02:00 BST
      "2026-03-29T02:00:00.000Z", // 03:00 BST
    ]);
    expect(zonedParts(slots[1] as number, london).minutes).toBe(2 * 60);
  });

  it("offers a repeated hour once when the clocks go back", () => {
    // 01:00 to 02:00 happens twice in London on 25 October 2026: the earlier is offered, not both.
    const slots = onDate("2026-10-25", london, everyDay(0, 3 * 60));
    expect(iso(slots)).toEqual([
      "2026-10-24T23:00:00.000Z", // 00:00 BST
      "2026-10-25T00:00:00.000Z", // 01:00 BST (the first time)
      "2026-10-25T02:00:00.000Z", // 02:00 GMT
    ]);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("is right in a zone that changes by half an hour (Lord Howe, 4 October 2026)", () => {
    const slots = onDate("2026-10-05", "Australia/Lord_Howe", everyDay(9 * 60, 10 * 60));
    expect(iso(slots)).toEqual(["2026-10-04T22:00:00.000Z"]);
  });
});

describe("a business's time and a viewer's", () => {
  it("works out hours in the business's zone, whichever zone looks", () => {
    // 9:00 to 11:00 in London in July is 08:00 and 09:00 UTC, the same list for every viewer.
    const slots = onDate("2026-07-01", "Europe/London", everyDay(9 * 60, 11 * 60));
    expect(iso(slots)).toEqual(["2026-07-01T08:00:00.000Z", "2026-07-01T09:00:00.000Z"]);
  });

  it("shows one slot as the business's clock and as each viewer's clock", () => {
    const [slot] = onDate("2026-07-01", "Europe/London", everyDay(9 * 60, 10 * 60));
    expect(slot).toBe(at("2026-07-01T08:00:00Z"));
    expect(plain(formatTime(slot as number, "Europe/London", "en-US"))).toBe("9:00 AM");
    expect(plain(formatTime(slot as number, "Asia/Kolkata", "en-US"))).toBe("1:30 PM");
    expect(plain(formatTime(slot as number, "America/Los_Angeles", "en-US"))).toBe("1:00 AM");
    expect(plain(formatWhen(slot as number, "Asia/Tokyo", "en-US"))).toBe(
      "Wednesday, July 1, 5:00 PM",
    );
  });

  it("puts a slot on the viewer's own day when the zones fall on different dates", () => {
    // Kolkata opens 9:00 on Thursday 2 July: Wednesday 1 July, 8:30 PM in Los Angeles.
    const slots = onDate("2026-07-02", "Asia/Kolkata", everyDay(9 * 60, 10 * 60));
    expect(iso(slots)).toEqual(["2026-07-02T03:30:00.000Z"]);
    expect([...groupByDay(slots, "Asia/Kolkata").keys()]).toEqual(["2026-07-02"]);
    expect([...groupByDay(slots, "America/Los_Angeles").keys()]).toEqual(["2026-07-01"]);
    expect(plain(formatTime(slots[0] as number, "America/Los_Angeles", "en-US"))).toBe("8:30 PM");
  });

  it("reads closed days as dates in the business's zone", () => {
    // Sydney's Tuesday 3 November starts at 13:00 UTC on the Monday.
    const found = availableSlots({
      rules: rules({ timeZone: "Australia/Sydney" }),
      hours: everyDay(9 * 60, 10 * 60),
      daysOff: ["2026-11-03"],
      busy: [],
      from: at("2026-11-01T00:00:00Z"),
      to: at("2026-11-05T00:00:00Z"),
      now: at("2026-11-01T00:00:00Z"),
    });
    expect([...groupByDay(found, "Australia/Sydney").keys()]).toEqual([
      "2026-11-02",
      "2026-11-04",
      "2026-11-05",
    ]);
  });
});

describe("slots, buffers, notice and the window", () => {
  const day = "2026-11-03";
  it("keeps an existing booking's buffer and the new slot's own buffers free", () => {
    const booked = { start: at("2026-11-03T10:00:00Z"), end: at("2026-11-03T11:15:00Z") };
    const found = availableSlots({
      rules: rules({ stepMinutes: 15, bufferBeforeMinutes: 10, bufferAfterMinutes: 20 }),
      hours: everyDay(9 * 60, 13 * 60),
      daysOff: [],
      busy: [booked],
      from: at(`${day}T00:00:00Z`),
      to: at("2026-11-04T00:00:00Z"),
      now: at("2026-11-01T00:00:00Z"),
    });
    expect(iso(found).map((text) => text.slice(11, 16))).toEqual(["11:30", "11:45", "12:00"]);
  });

  it("holds the minimum notice and the booking window", () => {
    const base = {
      hours: everyDay(9 * 60, 13 * 60),
      daysOff: [] as string[],
      busy: [],
      from: at("2026-11-02T00:00:00Z"),
      to: at("2026-11-12T00:00:00Z"),
    };
    const noticed = availableSlots({
      ...base,
      rules: rules({ minNoticeMinutes: 120 }),
      now: at("2026-11-02T09:30:00Z"),
    });
    expect(iso(noticed)[0]).toBe("2026-11-02T12:00:00.000Z");
    const windowed = availableSlots({
      ...base,
      rules: rules({ maxDaysAhead: 2 }),
      now: at("2026-11-02T00:00:00Z"),
    });
    expect([...groupByDay(windowed, "UTC").keys()]).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
  });
});

describe("the cost of listing slots", () => {
  it("works the zone out once per date: dayClock answers as toInstant does, on every day of a year", () => {
    for (const zone of [
      "Europe/London",
      "America/New_York",
      "Australia/Lord_Howe",
      "Asia/Kathmandu",
      "Pacific/Apia",
      "UTC",
    ]) {
      let date = "2026-01-01";
      for (let day = 0; day < 365; day++, date = addDays(date, 1)) {
        const clock = dayClock(date, zone);
        for (const minutes of [0, 90, 150, 210, 600, 1440])
          for (const missing of ["reject", "later"] as const)
            expect(clock(minutes, missing), `${zone} ${date} ${minutes} ${missing}`).toBe(
              toInstant(date, minutes, zone, missing),
            );
      }
    }
  }, 30_000);

  it("looks the zone up a few times a date, not once per candidate, with 5-minute slots open all day", () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      const found = availableSlots({
        rules: rules({ timeZone: "Europe/London", durationMinutes: 5, stepMinutes: 5 }),
        hours: everyDay(0, 1440),
        daysOff: [],
        busy: [],
        from: at("2026-07-01T00:00:00Z"),
        to: at("2026-07-15T00:00:00Z"),
        now: at("2026-06-30T00:00:00Z"),
      });
      // 14 days of 288 starts: about 4,000 candidates, found with well under 300 lookups (it was thousands).
      expect(found.length).toBeGreaterThan(3_900);
      expect(spy.mock.calls.length).toBeLessThan(300);
    } finally {
      spy.mockRestore();
    }
  });

  it("finds the same free slots as checking every candidate against every booking", () => {
    // Bookings of several lengths, some touching or overlapping, with buffers, over three days.
    let seed = 7;
    const random = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    const base = at("2026-11-03T00:00:00Z");
    const busy = Array.from({ length: 120 }, () => {
      const start = base + random(3 * 24 * 12) * 5 * 60_000;
      return { start, end: start + (1 + random(18)) * 5 * 60_000 };
    });
    const query = {
      rules: rules({
        durationMinutes: 20,
        stepMinutes: 20,
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 10,
      }),
      hours: everyDay(8 * 60, 20 * 60),
      daysOff: [] as string[],
      busy,
      from: base,
      to: base + 3 * 24 * 3_600_000,
      now: base - 3_600_000,
    };
    const free = availableSlots(query);
    const open = availableSlots({ ...query, busy: [] });
    const brute = open.filter(
      (start) =>
        !busy.some((other) => other.start < start + 30 * 60_000 && start - 5 * 60_000 < other.end),
    );
    expect(free).toEqual(brute);
    expect(free.length).toBeGreaterThan(0);
    expect(free.length).toBeLessThan(open.length);
  });
});
