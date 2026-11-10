// A staff member's own day on Postgres, through the API as the route serves it: real accounts signed up and in through
// lib/accounts.ts, the roles guard, then lib/bookings/staff.ts. Runs where DATABASE_URL names a database with the app's
// migrations applied (as lib/admin-table/records.spec.ts does); everything happens in one transaction that is rolled
// back, each test behind a savepoint of its own. Skipped without one.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAccounts } from "../accounts";
import { ENTITIES } from "../admin-table/entities";
import { createRecordsApi } from "../admin-table/records";
import { createRoleGuard, type Database } from "../roles/guard";
import { assignRole } from "../roles/members";
import { handle, reply } from "./http";
import { createStaffApi } from "./staff";
import { linkStaff, staffSignIns } from "./store";
import { newManageNonce } from "./token";

const url = process.env.DATABASE_URL;
const ORIGIN = process.env.APP_ORIGIN ?? "http://app.test";
const SECRET = randomBytes(32).toString("hex");
const PROJECT = "staff-test";
const PASSWORD = "a long test password";
const SERVICE = "2b7e9c10-4f3a-4d8e-a6b2-1c5d7e9f0a12"; // the starting diary's Standard appointment
const FIRST = "6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01"; // the starting diary's one person
// A fixed day far ahead, in the starting diary's zone (UTC), so the test never meets a real booking.
const DAY = "2091-03-14";

describe.skipIf(!url)("a staff member's own day on Postgres", () => {
  let pool: Pool;
  let client: PoolClient;
  let db: Database;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 1 });
    client = await pool.connect();
    db = client as unknown as Database;
    await client.query("BEGIN");
  });
  beforeEach(async () => {
    await client.query("SAVEPOINT each_test");
  });
  afterEach(async () => {
    await client.query("ROLLBACK TO SAVEPOINT each_test");
  });
  afterAll(async () => {
    await client?.query("ROLLBACK").catch(() => {});
    client?.release();
    await pool?.end();
  });

  const accounts = () =>
    createAccounts(db, {
      secret: SECRET,
      secureCookies: false,
      origin: ORIGIN,
      projectId: PROJECT,
      sessionSeconds: 3600,
      passwordMinLength: 12,
      maxBodyBytes: 16384,
      taskTitleLength: 240,
      authAttempts: 10,
      authClientAttempts: 30,
      authWindowSeconds: 60,
    });
  const guard = () => createRoleGuard(db, (request) => accounts().requireUser(request));
  const staff = () => createStaffApi({ db: () => db, requireRole: guard().requireRole });
  const session = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";
  async function signUp(email: string) {
    const response = await accounts().handle(
      new Request(`${ORIGIN}/api/account/signup`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
      "signup",
    );
    expect(response.status).toBe(200);
    const { user } = (await response.json()) as { user: { id: string } };
    return { cookie: session(response), id: user.id, email };
  }
  async function ownerSession() {
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(
      JSON.stringify({
        v: 1,
        project: PROJECT,
        role: "owner",
        iat: now,
        exp: now + 30,
        nonce: randomBytes(16).toString("hex"),
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", SECRET)
      .update(`pramaan-owner-pass.v1.${body}`)
      .digest("base64url");
    const response = await accounts().handle(
      new Request(`${ORIGIN}/api/account/owner-pass?token=${body}.${signature}`),
      "owner-pass",
    );
    expect(response.status).toBe(303);
    return session(response);
  }
  async function person(name: string) {
    const id = randomUUID();
    await db.query("INSERT INTO staff (id, name, position) VALUES ($1, $2, 9)", [id, name]);
    return id;
  }
  async function book(staffId: string, hour: number, customer: string) {
    await db.query(
      `INSERT INTO bookings (id, service_id, staff_id, starts_at, ends_at, service_name, customer_name, customer_email,
        customer_phone, notes, manage_nonce)
      VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '1 hour', 'Standard appointment', $5, $6, $7,
        'Prefers the window seat', $8)`,
      [
        randomUUID(),
        SERVICE,
        staffId,
        `${DAY}T${String(hour).padStart(2, "0")}:00:00Z`,
        customer,
        `${customer.toLowerCase().replaceAll(" ", ".")}@customer.test`,
        `+44 20 7946 0${hour}${hour}`,
        newManageNonce(),
      ],
    );
  }
  // The route's own answer: status and body as the browser receives them.
  async function dayOf(cookie: string, day = DAY) {
    const response = await handle(async () =>
      reply(
        await staff().day(
          new Request(`${ORIGIN}/api/staff/day?day=${day}`, { headers: cookie ? { cookie } : {} }),
        ),
      ),
    );
    return { status: response.status, text: await response.text() };
  }
  // A linked staff member: an account marked as Staff and linked to a person, with bookings for both people.
  async function linkedStylist() {
    const stylist = await signUp(`stylist.${randomUUID()}@example.test`);
    const ada = await person("Ada");
    await assignRole(db, stylist.id, "staff");
    expect(await linkStaff(db, ada, stylist.id)).toBe("saved");
    await book(ada, 9, "Grace Hopper");
    await book(ada, 11, "Alan Turing");
    await book(FIRST, 10, "Edsger Dijkstra");
    // A cancelled booking of Ada's is not on her day.
    await book(ada, 14, "Cancelled Customer");
    await db.query(
      "UPDATE bookings SET status = 'cancelled' WHERE customer_name = 'Cancelled Customer'",
    );
    return { stylist, ada };
  }

  it("shows a linked person their own day: time, service and customer name, nothing else", async () => {
    const { stylist } = await linkedStylist();
    const answer = await dayOf(stylist.cookie);
    expect(answer.status).toBe(200);
    const body = JSON.parse(answer.text);
    expect(body).toMatchObject({
      name: "Ada",
      day: DAY,
      previous: "2091-03-13",
      next: "2091-03-15",
    });
    expect(body.bookings).toEqual([
      {
        startsAt: `${DAY}T09:00:00.000Z`,
        endsAt: `${DAY}T10:00:00.000Z`,
        serviceName: "Standard appointment",
        customerName: "Grace Hopper",
      },
      {
        startsAt: `${DAY}T11:00:00.000Z`,
        endsAt: `${DAY}T12:00:00.000Z`,
        serviceName: "Standard appointment",
        customerName: "Alan Turing",
      },
    ]);
    // Nothing about another person's bookings, and no customer's email, phone or notes, anywhere in the body.
    for (const hidden of [
      "Edsger",
      "Cancelled Customer",
      "@customer.test",
      "+44",
      "7946",
      "window seat",
    ])
      expect(answer.text).not.toContain(hidden);
    // Another day of theirs is theirs too, and holds nobody else's.
    const before = await dayOf(stylist.cookie, "2091-03-13");
    expect(JSON.parse(before.text).bookings).toEqual([]);
  });

  it("refuses an unlinked Staff member, a linked account that is not Staff, and the signed-out", async () => {
    const unlinked = await signUp(`unlinked.${randomUUID()}@example.test`);
    await assignRole(db, unlinked.id, "staff");
    expect((await dayOf(unlinked.cookie)).status).toBe(403);
    // A plain member can't be linked at all...
    const member = await signUp(`member.${randomUUID()}@example.test`);
    expect(await linkStaff(db, await person("Member"), member.id)).toBe("not-staff");
    expect((await dayOf(member.cookie)).status).toBe(403);
    // ...and the owner has the diary itself, not a staff day.
    expect((await dayOf(await ownerSession())).status).toBe(403);
    expect((await dayOf("")).status).toBe(401);
  });

  it("ends access when the person is unlinked or the Staff role is taken away", async () => {
    const { stylist, ada } = await linkedStylist();
    expect((await dayOf(stylist.cookie)).status).toBe(200);
    expect(await linkStaff(db, ada, null)).toBe("saved");
    const unlinked = await dayOf(stylist.cookie);
    expect(unlinked.status).toBe(403);
    expect(unlinked.text).not.toContain("Grace");
    expect(await linkStaff(db, ada, stylist.id)).toBe("saved");
    expect((await dayOf(stylist.cookie)).status).toBe(200);
    expect((await staffSignIns(db)).get(ada)).toEqual({ email: stylist.email, staff: true });
    await assignRole(db, stylist.id, "member");
    expect((await dayOf(stylist.cookie)).status).toBe(403);
    // The owner's staff screen says the link no longer gives access.
    expect((await staffSignIns(db)).get(ada)).toEqual({ email: stylist.email, staff: false });
  });

  it("keeps the person and their bookings when the account is released, and ends its access", async () => {
    const { stylist, ada } = await linkedStylist();
    await db.query("DELETE FROM app_users WHERE id = $1", [stylist.id]);
    const { rows } = await db.query(
      "SELECT st.user_id, count(b.id)::int AS bookings FROM staff st JOIN bookings b ON b.staff_id = st.id WHERE st.id = $1 GROUP BY st.user_id",
      [ada],
    );
    expect(rows).toEqual([{ user_id: null, bookings: 3 }]);
    expect((await dayOf(stylist.cookie)).status).toBe(401);
    // Someone signing up later with the same address is a new account, linked to no one.
    const again = await signUp(stylist.email);
    await assignRole(db, again.id, "staff");
    expect((await dayOf(again.cookie)).status).toBe(403);
  });

  it("refuses a linked staff member everywhere the owner works", async () => {
    const { stylist } = await linkedStylist();
    const as = (path: string) =>
      new Request(`${ORIGIN}${path}`, { headers: { cookie: stylist.cookie } });
    // lib/bookings/owner.ts: every owner diary route checks the starter's own owner role.
    await expect(
      accounts().requireRole(as("/api/owner/bookings"), ["owner"]),
    ).rejects.toMatchObject({
      status: 403,
    });
    // Roles, email notices and the owner pages check the roles guard for the owner.
    await expect(guard().requireRole(as("/api/roles"), ["owner"])).rejects.toMatchObject({
      status: 403,
    });
    // Records: preparation notes are the owner's.
    const records = createRecordsApi({
      db: () => db,
      entities: ENTITIES,
      requireRole: guard().requireRole,
    });
    const listed = await records.list(as("/api/records/note"), "note");
    expect(listed.status).toBe(403);
    expect(await listed.text()).not.toContain("title");
  });

  it("links one account to one person only", async () => {
    const { stylist } = await linkedStylist();
    expect(await linkStaff(db, await person("Bea"), stylist.id)).toBe("taken");
  });
});
