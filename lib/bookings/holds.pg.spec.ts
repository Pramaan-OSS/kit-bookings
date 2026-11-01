import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl, warmPool } from "../test-database";
import { addClass, classList, classPlace } from "./classes";
import { holdHash, holdSlot } from "./holds";
import { type ReserveInput, reserve } from "./reserve";
import { getService, transactor } from "./store";

const url = testDatabaseUrl();
const schema = `holds_${randomUUID().replaceAll("-", "")}`;
describe.skipIf(!url)("holds and class places on Postgres", () => {
  let pool: Pool;
  let input: ReserveInput;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      for (const f of readdirSync("src/db/migrations")
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await tx.query(readFileSync(`src/db/migrations/${f}`, "utf8"));
      await tx.query("COMMIT");
    } finally {
      tx.release();
    }
    await warmPool(pool, 6);
    const service = await getService(pool, "2b7e9c10-4f3a-4d8e-a6b2-1c5d7e9f0a12");
    if (!service) throw Error("Missing service");
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3);
    while ([0, 6].includes(start.getUTCDay())) start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(10, 0, 0, 0);
    input = {
      service,
      staffIds: ["6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01"],
      startsAt: +start,
      rules: { timeZone: "UTC", stepMinutes: 15, minNoticeMinutes: 0, maxDaysAhead: 60 },
      now: Date.now(),
      replaces: null,
      booking: {
        id: randomUUID(),
        customerName: "Test visitor",
        customerEmail: "visitor@example.test",
        customerPhone: "+44 20 7946 0000",
        customerTimeZone: "UTC",
        notes: "",
        customerId: null,
        manageNonce: randomUUID().replaceAll("-", ""),
      },
    };
  });
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });
  it("allows exactly one concurrent hold, blocks confirmation by others, then consumes it once", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => holdSlot(pool, input)),
    );
    const won = attempts.filter((x) => x.status === "fulfilled");
    expect(won).toHaveLength(1);
    const held = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof holdSlot>>>).value;
    await expect(reserve(transactor(pool), input)).rejects.toThrow("taken");
    await reserve(transactor(pool, holdHash(held.holdToken)), input);
    expect((await pool.query("SELECT count(*)::int AS n FROM booking_holds")).rows[0].n).toBe(0);
    await expect(
      reserve(transactor(pool, holdHash(held.holdToken)), {
        ...input,
        booking: { ...input.booking, id: randomUUID() },
      }),
    ).rejects.toThrow();
  });
  it("confirms a still-free time after its hold expires", async () => {
    const next = {
      ...input,
      startsAt: input.startsAt + 2 * 3600_000,
      booking: { ...input.booking, id: randomUUID() },
    };
    const held = await holdSlot(pool, next);
    await pool.query("UPDATE booking_holds SET expires_at=now()-interval '1 second'");
    await expect(reserve(transactor(pool, holdHash(held.holdToken)), next)).resolves.toMatchObject({
      bookingId: next.booking.id,
    });
  });
  it("refuses a stale hold only when another booking really took its time", async () => {
    const next = {
      ...input,
      startsAt: input.startsAt + 4 * 3600_000,
      booking: { ...input.booking, id: randomUUID() },
    };
    const held = await holdSlot(pool, next);
    await pool.query("UPDATE booking_holds SET expires_at=now()-interval '1 second'");
    await reserve(transactor(pool), next);
    await expect(
      reserve(transactor(pool, holdHash(held.holdToken)), {
        ...next,
        booking: { ...next.booking, id: randomUUID() },
      }),
    ).rejects.toThrow("taken");
  });
  it("replaces a live hold atomically and lets the same visitor return to the first choice", async () => {
    const first = {
      ...input,
      startsAt: input.startsAt + 86400_000,
      booking: { ...input.booking, id: randomUUID() },
    };
    const second = { ...first, startsAt: first.startsAt + 2 * 3600_000 };
    // The starting diary closes on weekends; use the same weekday in the following week.
    first.startsAt = input.startsAt + 7 * 86400_000;
    second.startsAt = first.startsAt + 2 * 3600_000;
    const a = await holdSlot(pool, first);
    const b = await holdSlot(pool, second, a.holdToken);
    expect(
      (await pool.query("SELECT 1 FROM booking_holds WHERE token_hash=$1", [holdHash(a.holdToken)]))
        .rowCount,
    ).toBe(0);
    const c = await holdSlot(pool, first, b.holdToken);
    expect(c.holdToken).not.toBe(a.holdToken);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM booking_holds WHERE expires_at>now()"))
        .rows[0].n,
    ).toBe(1);
  });
  it("never exceeds class capacity, scopes cancellations to the member and frees a place", async () => {
    await addClass(pool, {
      name: "Studio class",
      startsAt: Date.now() + 86400_000,
      endsAt: Date.now() + 90000_000,
      capacity: 2,
    });
    const session = (await classList(pool, null))[0];
    const users = Array.from({ length: 8 }, () => randomUUID());
    for (const id of users)
      await pool.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,'unused')", [
        id,
        `${id}@example.test`,
      ]);
    const results = await Promise.allSettled(users.map((id) => classPlace(pool, session.id, id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const joined = await pool.query("SELECT user_id FROM class_places WHERE session_id=$1", [
      session.id,
    ]);
    const outsider = users.find((id) => !joined.rows.some((r) => r.user_id === id))!;
    await classPlace(pool, session.id, outsider, true);
    expect((await classList(pool, null))[0].taken).toBe(2);
    await classPlace(pool, session.id, joined.rows[0].user_id, true);
    await classPlace(pool, session.id, outsider);
    expect((await classList(pool, null))[0].taken).toBe(2);
  });
});
