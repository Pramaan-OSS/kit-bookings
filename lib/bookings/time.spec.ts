// The zone formatter cache stays bounded whatever strangers send. IANA names are case-insensitive, so one zone has
// thousands of spellings that all validate; the cache is keyed by the runtime's own name, and checking a spelling
// caches nothing at all.
import { describe, expect, it } from "vitest";
import { canonicalZone, formatterCount, timeZones, zonedParts } from "./time";

/** `count` distinct spellings of a zone, each letter's case flipped by the bits of its index. */
function spellings(zone: string, count: number) {
  const letters = [...zone]
    .map((char, at) => ({ char, at }))
    .filter(({ char }) => /[a-z]/iu.test(char));
  const out = new Set<string>();
  for (let n = 0; out.size < count && n < 2 ** letters.length; n++) {
    const chars = [...zone];
    letters.forEach(({ char, at }, bit) => {
      chars[at] = (n >> bit) & 1 ? char.toUpperCase() : char.toLowerCase();
    });
    out.add(chars.join(""));
  }
  return [...out];
}

describe("the zone formatter cache", () => {
  const variants = spellings("Europe/London", 1_000);
  const instant = Date.parse("2026-07-01T08:00:00Z");

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

  it("keeps one entry for every spelling of a zone it formats", () => {
    const before = formatterCount();
    for (const zone of variants) expect(zonedParts(instant, zone).minutes).toBe(9 * 60);
    expect(formatterCount() - before).toBeLessThanOrEqual(1);
  });

  it("never holds more than its cap, however many real zones are used", () => {
    for (const zone of timeZones()) zonedParts(instant, zone);
    for (const zone of timeZones()) zonedParts(instant, zone.toUpperCase());
    expect(formatterCount()).toBeLessThanOrEqual(700);
  });
});
