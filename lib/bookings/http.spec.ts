import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { email, HttpError, line, phone, price, readBody } from "./http";

const refused = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error instanceof HttpError ? error.status : "other";
  }
  return null;
};

describe("what visitors and the owner type", () => {
  it("takes phone numbers as people write them, and refuses words", () => {
    expect(phone(" +44 (0)20 7946-0000 ")).toBe("+44 (0)20 7946-0000");
    expect(phone("020.7946.0000")).toBe("020.7946.0000");
    expect(refused(() => phone("call me"))).toBe(400);
    expect(refused(() => phone("12345"))).toBe(400);
  });

  it("keeps a name to one line, so it can never become an email header", () => {
    expect(line("  Ada Lovelace ", "your name", { min: 1 })).toBe("Ada Lovelace");
    expect(refused(() => line("Ada\r\nBcc: someone@example.com", "your name", { min: 1 }))).toBe(
      400,
    );
    expect(refused(() => line("", "your name", { min: 1 }))).toBe(400);
  });

  it("reads prices in cents, with empty as no price shown", () => {
    expect(price("60")).toBe(6000);
    expect(price("24.5")).toBe(2450);
    expect(price("")).toBeNull();
    expect(refused(() => price("-3"))).toBe(400);
    expect(refused(() => price("12.345"))).toBe(400);
  });

  it("lower-cases an email and refuses what isn't one", () => {
    expect(email(" Ada@Example.COM ")).toBe("ada@example.com");
    expect(refused(() => email("ada@"))).toBe(400);
  });

  // The runtime may set APP_ORIGIN (the gate's run of these tests does); this test names its own origin.
  const origin = process.env.APP_ORIGIN;
  beforeEach(() => {
    delete process.env.APP_ORIGIN;
  });
  afterEach(() => {
    if (origin !== undefined) process.env.APP_ORIGIN = origin;
  });

  it("reads only a same-origin JSON body", async () => {
    const post = (headers: Record<string, string>, body: string) =>
      readBody(new Request("http://app.test/api/booking/book", { method: "POST", headers, body }));
    await expect(
      post({ origin: "http://app.test", "content-type": "application/json" }, '{"a":1}'),
    ).resolves.toEqual({ a: 1 });
    await expect(
      post({ origin: "http://evil.test", "content-type": "application/json" }, "{}"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      post({ origin: "http://app.test", "content-type": "text/plain" }, "{}"),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      post({ origin: "http://app.test", "content-type": "application/json" }, "[1]"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      post(
        { origin: "http://app.test", "content-type": "application/json" },
        `{"a":"${"x".repeat(20_000)}"}`,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
