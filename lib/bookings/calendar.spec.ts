import { describe, expect, it } from "vitest";
import { foldCalendarLine } from "./calendar";

describe("calendar text folding", () => {
  it("folds long manage links at 75 octets and unfolds without a change", () => {
    const line = `DESCRIPTION:Change or cancel: https://example.test/manage?token=${"abcdef".repeat(30)}`;
    const folded = foldCalendarLine(line);
    expect(folded).toContain("\r\n ");
    expect(folded.replaceAll("\r\n ", "")).toBe(line);
    expect(folded.split("\r\n").every((part) => Buffer.byteLength(part) <= 75)).toBe(true);
  });
  it("never splits a multi-byte character, and counts the continuation space", () => {
    const line = `SUMMARY:${"Été 🌿 中文".repeat(25)}`;
    const folded = foldCalendarLine(line);
    expect(folded.replaceAll("\r\n ", "")).toBe(line);
    for (const part of folded.split("\r\n")) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
      expect(Buffer.from(part).toString()).toBe(part);
    }
  });
});
