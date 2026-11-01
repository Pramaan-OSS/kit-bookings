import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySchedule } from "./jobs";
import { newManageNonce, readManageToken, signManageToken } from "./token";

const SECRET = "a-session-secret-of-at-least-32-characters";
const OTHER = "another-apps-session-secret-of-32-characters";

describe("the cancel and reschedule link", () => {
  const bookingId = randomUUID();
  const nonce = newManageNonce();
  const token = signManageToken(bookingId, nonce, SECRET);

  it("opens the booking it was made for, and says which nonce it carries", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u);
    expect(readManageToken(token, SECRET)).toEqual({ bookingId, nonce });
  });

  it("is refused under another app's secret", () => {
    expect(readManageToken(token, OTHER)).toBeNull();
  });

  it("is refused when any character of it changes", () => {
    for (let index = 0; index < token.length; index++) {
      if (token[index] === ".") continue;
      const swapped = token[index] === "A" ? "B" : "A";
      const altered = `${token.slice(0, index)}${swapped}${token.slice(index + 1)}`;
      expect(readManageToken(altered, SECRET), `character ${index}`).toBeNull();
    }
  });

  it("cannot be re-pointed at another booking without the secret", () => {
    const [, signature] = token.split(".");
    const other = Buffer.concat([
      Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
      Buffer.from(nonce, "hex"),
    ]).toString("base64url");
    expect(readManageToken(`${other}.${signature}`, SECRET)).toBeNull();
    // Signing it needs the domain-separated HMAC under the app's secret; a bare HMAC of the payload is refused.
    const bare = createHmac("sha256", SECRET).update(other).digest("base64url");
    expect(readManageToken(`${other}.${bare}`, SECRET)).toBeNull();
  });

  it("refuses anything that is not a token", () => {
    for (const value of [
      "",
      "abc",
      `${token}.`,
      `${token}x`,
      token.replace(".", ""),
      null,
      undefined,
      42,
      {},
    ]) {
      expect(readManageToken(value, SECRET)).toBeNull();
    }
  });

  it("differs for every nonce, so a booking's old links stop working when its nonce changes", () => {
    const fresh = signManageToken(bookingId, newManageNonce(), SECRET);
    expect(fresh).not.toBe(token);
    // The token still reads, but names the old nonce, which the booking row no longer holds.
    expect(readManageToken(token, SECRET)?.nonce).not.toBe(readManageToken(fresh, SECRET)?.nonce);
  });

  it("is never signed with a short secret or a malformed id", () => {
    expect(() => signManageToken(bookingId, nonce, "short")).toThrow();
    expect(() => signManageToken("not-a-uuid", nonce, SECRET)).toThrow();
    expect(() => signManageToken(bookingId, "xyz", SECRET)).toThrow();
    expect(readManageToken(token, "short")).toBeNull();
  });
});

describe("the reminder job's signature check", () => {
  const key = "schedule-key-from-the-platform";
  const body = JSON.stringify({ schedule: "booking-reminders", runId: "run-1" });
  const now = Date.parse("2026-11-02T09:00:00Z");
  const timestamp = String(Math.floor(now / 1000));
  const sign = (k: string, t: string, b: string) =>
    `v1=${createHmac("sha256", k).update(`${t}.${b}`).digest("hex")}`;

  it("accepts the platform's signed, fresh call", () => {
    expect(verifySchedule(key, timestamp, sign(key, timestamp, body), body, now)).toBe(true);
  });

  it("refuses a wrong key, a changed body, a stale call, or schedules being off", () => {
    expect(verifySchedule(key, timestamp, sign("other", timestamp, body), body, now)).toBe(false);
    expect(verifySchedule(key, timestamp, sign(key, timestamp, body), `${body} `, now)).toBe(false);
    const old = String(Math.floor(now / 1000) - 301);
    expect(verifySchedule(key, old, sign(key, old, body), body, now)).toBe(false);
    expect(verifySchedule(null, timestamp, sign(key, timestamp, body), body, now)).toBe(false);
    expect(verifySchedule(key, "soon", sign(key, "soon", body), body, now)).toBe(false);
  });
});
