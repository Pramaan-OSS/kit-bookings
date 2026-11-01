// The booking race, reminder claims, the throttle and the last-person rule on real Postgres, through the SQL in
// lib/bookings/store.ts. Runs when TEST_DATABASE_URL (or kit CI's KIT_CI_DATABASE_URL) names a database it may use:
// it works in a schema of its own and drops it after. Skipped otherwise, so `pnpm test` needs no database.
// Example: set TEST_DATABASE_URL to a local Postgres URL, then run pnpm test
// TEST_DATABASE_THROWAWAY=1 says the database is a throwaway one (an in-memory PGlite, which keeps no schema per
// connection): the test then works in its default schema and leaves it as it is.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl, warmPool } from "../test-database";
import { reserve, SlotTakenError } from "./reserve";
import {
  cancelBooking,
  claimDueReminders,
  getService,
  hit,
  LastStaffError,
  listStaff,
  REMINDER_CLAIM_MINUTES,
  recordReminder,
  saveStaff,
  schedules,
  transactor,
} from "./store";
import { newManageNonce } from "./token";

const url = testDatabaseUrl();
const HOUR = 3_600_000;
const MINUTE = 60_000;
const throwaway = process.env.TEST_DATABASE_THROWAWAY === "1";
const schema = `bookings_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const migrations = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));
const STAFF = "6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01";
const SERVICE = "2b7e9c10-4f3a-4d8e-a6b2-1c5d7e9f0a12"; // Standard appointment: 60 minutes, 15 after

describe.skipIf(!url)("bookings on Postgres", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.TEST_DATABASE_POOL ?? 10),
      ...(throwaway ? {} : { options: `-c search_path=${schema}` }),
    });
    if (!throwaway) {
      await pool.query(`CREATE SCHEMA ${schema}`);
      // Never touch the database's own tables: stop unless the connection really works in the test's schema.
      const { rows } = await pool.query("SELECT current_schema() AS name");
      if (rows[0]?.name !== schema)
        throw new Error(`TEST_DATABASE_URL ignored search_path (in ${rows[0]?.name})`);
    }
    // Every migration in number order, each in one transaction, as go-live applies them.
    const files = readdirSync(migrations)
      .filter((file) => /^\d+-.+\.sql$/u.test(file))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    for (const file of files) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(path.join(migrations, file), "utf8"));
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    }
    await warmPool(pool, Number(process.env.TEST_DATABASE_POOL ?? 10));
  });

  afterAll(async () => {
    if (!throwaway) await pool?.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await pool?.end();
  });

  it("starts with the starting diary: one person offering three services", async () => {
    const staff = await listStaff(pool, { activeOnly: true });
    expect(staff.map((person) => person.name)).toEqual(["Our team"]);
    expect(staff[0]?.serviceIds).toHaveLength(3);
  });

  it("lets exactly one of many concurrent bookings take a slot, and frees it on cancel", async () => {
    const service = await getService(pool, SERVICE);
    if (!service) throw new Error("the starting diary is missing");
    // The next Tuesday at least two days away, 10:00 UTC (the diary's zone), inside Monday–Friday 9–17.
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 2);
    while (day.getUTCDay() !== 2) day.setUTCDate(day.getUTCDate() + 1);
    day.setUTCHours(10, 0, 0, 0);
    const startsAt = day.getTime();
    const attempt = (offsetMinutes: number) =>
      reserve(transactor(pool), {
        service,
        staffIds: [STAFF],
        startsAt: startsAt + offsetMinutes * 60_000,
        rules: { timeZone: "UTC", stepMinutes: 15, minNoticeMinutes: 120, maxDaysAhead: 60 },
        now: Date.now(),
        replaces: null,
        booking: {
          id: randomUUID(),
          customerName: "Race",
          customerEmail: "race@example.com",
          customerPhone: "+44 20 7946 0000",
          customerTimeZone: "UTC",
          notes: "",
          customerId: null,
          manageNonce: newManageNonce(),
        },
      });
    // Overlapping starts within the booking's hour and its 15 minutes after, then the same start twenty times.
    // The overlapping ones go first so they take pool connections in the same round as the first exact starts:
    // only the staff row lock refuses them (the unique index stops exact starts alone).
    const offsets = [15, 30, 45, 60, -45, -30, ...Array.from({ length: 20 }, () => 0)];
    const results = await Promise.allSettled(offsets.map(attempt));
    const booked = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter(
      (result) => result.status === "rejected" && result.reason instanceof SlotTakenError,
    );
    expect(booked).toHaveLength(1);
    expect(refused).toHaveLength(offsets.length - 1);
    const { rows } = await pool.query(
      "SELECT id, starts_at FROM bookings WHERE status = 'confirmed'",
    );
    expect(rows).toHaveLength(1);
    const busy = (await schedules(pool, [STAFF], startsAt - 86_400_000, startsAt + 86_400_000)).get(
      STAFF,
    )?.busy;
    expect(busy).toHaveLength(1);
    // Cancelling frees the time for the next visitor.
    expect(await cancelBooking(pool, rows[0].id, "customer", Date.now())).toMatchObject({
      status: "cancelled",
    });
    await expect(attempt(0)).resolves.toMatchObject({ staffId: STAFF });
  });

  it("lets a reminder claim lapse when its run dies, and puts a send to retry back to pending", async () => {
    const id = randomUUID();
    const startsAt = Math.ceil((Date.now() + 10 * HOUR) / HOUR) * HOUR + 7 * MINUTE;
    await pool.query(
      `INSERT INTO bookings (id, service_id, staff_id, starts_at, ends_at, service_name, customer_name, customer_email,
        customer_phone, manage_nonce, created_at)
      VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000), to_timestamp($5::double precision / 1000),
        'Standard appointment', 'Rem', 'rem@example.com', '+44 20 7946 0000', $6, now() - interval '2 days')`,
      [id, SERVICE, STAFF, startsAt, startsAt + HOUR, newManageNonce()],
    );
    const claims = async (now: number) =>
      (await claimDueReminders(pool, 24, now, 50)).filter((booking) => booking.id === id).length;
    const now = Date.now();
    expect(await claims(now)).toBe(1);
    // Claimed: no other run takes it while the claim holds...
    expect(await claims(now + MINUTE)).toBe(0);
    // ...and once the claim lapses (the run that took it never recorded it), the next run does.
    expect(await claims(now + (REMINDER_CLAIM_MINUTES + 1) * MINUTE)).toBe(1);
    // A send the email module refused for now goes back to pending and is claimed again straight away.
    await recordReminder(pool, id, "not-sent", true);
    expect(await claims(now + (REMINDER_CLAIM_MINUTES + 2) * MINUTE)).toBe(1);
    // A sent reminder is never claimed again.
    await recordReminder(pool, id, "sent", false);
    expect(await claims(now + 5 * HOUR)).toBe(0);
  });

  it("counts throttle hits in a window, and starts again once it has passed", async () => {
    const key = `test ${randomUUID()}`;
    expect(await hit(pool, key, 3600)).toBe(1);
    expect(await hit(pool, key, 3600)).toBe(2);
    await pool.query(
      "UPDATE booking_throttle SET started_at = now() - interval '2 hours' WHERE key = $1",
      [key],
    );
    expect(await hit(pool, key, 3600)).toBe(1);
  });

  it("never lets two people stop taking bookings at once and leave nobody", async () => {
    await saveStaff(pool, {
      id: null,
      name: "Second",
      title: "",
      color: "clay",
      active: true,
      serviceIds: [],
    });
    const people = await listStaff(pool, { activeOnly: true });
    expect(people).toHaveLength(2);
    const results = await Promise.allSettled(
      people.map(({ id, name, title, color, serviceIds }) =>
        saveStaff(pool, { id, name, title, color, active: false, serviceIds }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.filter(
      (result) => result.status === "rejected" && result.reason instanceof LastStaffError,
    );
    expect(refused).toHaveLength(1);
    expect(await listStaff(pool, { activeOnly: true })).toHaveLength(1);
  });
});
