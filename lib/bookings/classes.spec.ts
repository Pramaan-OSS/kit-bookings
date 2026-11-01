import { describe, expect, it } from "vitest";
import { classTimes } from "./classes";
import { formatTime } from "./time";

describe("class times in the business zone", () => {
  it("interprets a London summer class independently of the device zone", () => {
    const times = classTimes("2099-07-10T18:00", "2099-07-10T19:00", "Europe/London");
    expect(new Date(times.startsAt).toISOString()).toBe("2099-07-10T17:00:00.000Z");
    expect(formatTime(times.startsAt, "Europe/London", "en-GB")).toBe("18:00");
  });
  it("handles a DST-day gap with the existing later-time rule", () => {
    const times = classTimes("2027-03-28T01:30", "2027-03-28T03:30", "Europe/London");
    expect(new Date(times.startsAt).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(new Date(times.endsAt).toISOString()).toBe("2027-03-28T02:30:00.000Z");
  });
  it("refuses invalid calendar dates and clock values", () => {
    for (const bad of [
      "2099-02-30T18:00",
      "2099-03-20T25:00",
      "2099-03-20T18:99",
      "2099-03-20T18:00Z",
    ])
      expect(() => classTimes(bad, "2099-03-20T19:00", "UTC")).toThrow(
        "Choose a class date and time",
      );
  });
});
