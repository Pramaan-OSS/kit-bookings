// The records API's isolation, on Postgres, through the API as the routes serve it: real accounts signed up and in
// through lib/accounts.ts, the roles guard, then each entity's reach. Runs where DATABASE_URL names a database with the
// app's migrations applied (Pramaan's checks give the tests one); everything happens in one transaction that is rolled
// back, each test behind a savepoint of its own, so it leaves any database as it found it. Skipped without one, so
// `pnpm test` needs no database. The checks that need no database run everywhere.
import { createHmac, randomBytes } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAccounts } from "../accounts";
import { createRoleGuard, type Database } from "../roles/guard";
import { ENTITIES, type Entity } from "./entities";
import { ACCOUNT_TABLES, createRecordsApi, csvCell, fieldsOf } from "./records";

const url = process.env.DATABASE_URL;
// The origin the app is served on: a same-origin POST names it (lib/roles/http.ts readBody).
const ORIGIN = process.env.APP_ORIGIN ?? "http://app.test";
const SECRET = randomBytes(32).toString("hex");
const PROJECT = "records-test";
const PASSWORD = "a long test password";
// A title a member can type into the starter's own task list, which a spreadsheet splitting on ";" would run.
const FORMULA = "x;=cmd|'/C calc'!A0;y";
const TASKS: Entity = {
  id: "task",
  label: "Tasks",
  table: "app_tasks",
  ownerColumn: "user_id",
  fields: [
    { column: "title", label: "Title", type: "text", required: true, max: 240, search: true },
    { column: "completed", label: "Done", type: "boolean" },
    { column: "created_at", label: "Added", type: "timestamp", readOnly: true },
  ],
  access: {},
};
// The starter's tasks, opened to members, each to their own: the grant whose isolation this proves.
const OWN_TASKS: readonly Entity[] = [{ ...TASKS, access: { member: "own" } }];
const refuse = () => {
  throw new Error("no database here");
};

describe("the records area's own rules", () => {
  it("refuses the starter's account tables as a kind of record, as the API is made", () => {
    for (const table of ACCOUNT_TABLES)
      expect(() =>
        createRecordsApi({
          db: refuse,
          entities: [{ ...TASKS, id: "accounts", table }],
          requireRole: refuse,
        }),
      ).toThrow(`accounts: ${table} holds accounts`);
    expect(() =>
      createRecordsApi({ db: refuse, entities: [TASKS, TASKS], requireRole: refuse }),
    ).toThrow("task: listed twice");
  });

  it("never edits a record's id or the account it belongs to, whatever the fields say", () => {
    const listed: Entity = {
      ...TASKS,
      fields: [
        ...TASKS.fields,
        { column: "id", label: "ID", type: "text" },
        { column: "user_id", label: "Whose", type: "text" },
      ],
    };
    const locked = fieldsOf(listed).filter((field) => field.readOnly);
    expect(locked.map((field) => field.column)).toEqual(["created_at", "id", "user_id"]);
  });

  it("quotes every CSV cell, and writes a formula as text", () => {
    expect(csvCell(FORMULA)).toBe(`"${FORMULA}"`);
    for (const formula of ["=SUM(A1)", "+1+1", "-1+1", "-A1", "@cmd", "\tx", "\rx"])
      expect(csvCell(formula)).toBe(`"'${formula}"`);
    // A plain number stays a number, negative or signed.
    for (const number of ["-1", "+1", "-12.50", -3]) expect(csvCell(number)).toBe(`"${number}"`);
    expect(csvCell('say "hi", then go')).toBe('"say ""hi"", then go"');
    expect(csvCell(null)).toBe('""');
  });
});

describe.skipIf(!url)("the records API on Postgres", () => {
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
  const api = (entities: readonly Entity[]) =>
    createRecordsApi({
      db: () => db,
      entities,
      requireRole: createRoleGuard(db, (request) => accounts().requireUser(request)).requireRole,
    });
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
    return { cookie: session(response), id: user.id };
  }
  // The owner, as Pramaan's owner pass signs them in (lib/accounts.ts readOwnerPass).
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
  const get = (cookie: string, path = "/api/records/task") =>
    new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
  const post = (cookie: string, input: object) =>
    new Request(`${ORIGIN}/api/records/task`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const read = async (response: Response) => ({
    status: response.status,
    body: await response.json(),
  });
  const titles = (body: { records: { title: string }[] }) => body.records.map((row) => row.title);

  it("a member reads, changes and exports only their own records; another's are simply not there", async () => {
    const records = api(OWN_TASKS);
    const ada = await signUp("ada.records@example.test");
    const bob = await signUp("bob.records@example.test");
    const made = await read(
      await records.save(post(ada.cookie, { title: "Ada's private plan" }), "task"),
    );
    expect(made.status).toBe(201);
    const adas = made.body.record.id as string;
    await records.save(post(bob.cookie, { title: "Bob's own list" }), "task");

    // Bob's table, search and export hold his record alone, and never whose account any record is.
    const listed = await read(await records.list(get(bob.cookie), "task"));
    expect(titles(listed.body)).toEqual(["Bob's own list"]);
    expect(listed.body.total).toBe(1);
    expect(listed.body.records[0]).not.toHaveProperty("account");
    const searched = await read(
      await records.list(get(bob.cookie, "/api/records/task?search=private"), "task"),
    );
    expect(searched.body).toMatchObject({ records: [], total: 0 });
    const csv = await (
      await records.exportCsv(get(bob.cookie, "/api/records/task/export"), "task")
    ).text();
    expect(csv).toContain('"Bob\'s own list"');
    expect(csv).not.toContain("Ada's private plan");
    expect(csv).not.toContain("Account");

    // Bob cannot change Ada's record: it is not there for him, and it is as she left it.
    const changed = await read(
      await records.save(
        post(bob.cookie, { id: adas, title: "Bob was here", completed: true }),
        "task",
      ),
    );
    expect(changed).toEqual({ status: 404, body: { error: "That record is not here." } });
    const adaSees = await read(await records.list(get(ada.cookie), "task"));
    expect(adaSees.body.records).toMatchObject([
      { id: adas, title: "Ada's private plan", completed: false },
    ]);

    // The owner reaches every record, each with whose it is.
    const owner = await ownerSession();
    for (const [words, title, account] of [
      ["private plan", "Ada's private plan", "ada.records@example.test"],
      ["own list", "Bob's own list", "bob.records@example.test"],
    ]) {
      const found = await read(
        await records.list(
          get(owner, `/api/records/task?search=${encodeURIComponent(words ?? "")}`),
          "task",
        ),
      );
      expect(found.body.records).toMatchObject([{ title, account }]);
    }
  });

  it("a save answers with the record it saved, and saving it again changes it, never adds another", async () => {
    const records = api([TASKS]);
    const owner = await ownerSession();
    const made = await read(await records.save(post(owner, { title: "Plan the week" }), "task"));
    expect(made).toMatchObject({ status: 201, body: { record: { title: "Plan the week" } } });
    const again = await read(
      await records.save(
        post(owner, { id: made.body.record.id, title: "Plan the month", completed: true }),
        "task",
      ),
    );
    expect(again).toMatchObject({
      status: 200,
      body: { record: { id: made.body.record.id, title: "Plan the month", completed: true } },
    });
    const found = await read(
      await records.list(get(owner, "/api/records/task?search=Plan the"), "task"),
    );
    expect(found.body).toMatchObject({ total: 1, records: [{ title: "Plan the month" }] });
  });

  it("never moves a record to another account, even when the fields list the owner column", async () => {
    const listed: Entity = {
      ...OWN_TASKS[0],
      fields: [...TASKS.fields, { column: "user_id", label: "Whose", type: "text" }],
    } as Entity;
    const records = api([listed]);
    const eve = await signUp("eve.records@example.test");
    const mal = await signUp("mal.records@example.test");
    const made = await read(
      await records.save(post(mal.cookie, { title: "Mal's note", user_id: eve.id }), "task"),
    );
    expect(made.body.record.user_id).toBe(mal.id);
    await records.save(
      post(mal.cookie, { id: made.body.record.id, title: "Mal's note", user_id: eve.id }),
      "task",
    );
    expect((await read(await records.list(get(eve.cookie), "task"))).body.total).toBe(0);
    const mine = await read(await records.list(get(mal.cookie), "task"));
    expect(mine.body.records).toMatchObject([{ title: "Mal's note", user_id: mal.id }]);
  });

  it("exports a member's formula as one quoted cell of text", async () => {
    const records = api(OWN_TASKS);
    const joe = await signUp("joe.records@example.test");
    await records.save(post(joe.cookie, { title: FORMULA }), "task");
    await records.save(post(joe.cookie, { title: "=HYPERLINK(1)" }), "task");
    const owner = await ownerSession();
    const all = await (
      await records.exportCsv(get(owner, "/api/records/task/export"), "task")
    ).text();
    expect(all.split("\r\n")[0]).toBe('"Title","Done","Added","Account"');
    expect(all).toContain(`"${FORMULA}",`);
    expect(all).toContain(`"'=HYPERLINK(1)",`);
    for (const line of all.split("\r\n").filter(Boolean))
      expect(line).toMatch(/^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/u);
  });

  it("denies by default: a role the entity does not grant, or no session, reaches nothing", async () => {
    const records = api([TASKS]);
    const cy = await signUp("cy.records@example.test");
    const denied = { error: "You don't have access to this." };
    expect(await read(await records.list(get(cy.cookie), "task"))).toEqual({
      status: 403,
      body: denied,
    });
    expect(await read(await records.save(post(cy.cookie, { title: "Sneaky" }), "task"))).toEqual({
      status: 403,
      body: denied,
    });
    expect((await records.exportCsv(get(cy.cookie), "task")).status).toBe(403);
    expect((await records.list(get(""), "task")).status).toBe(401);
  });

  it("checks every value against its field, on the server", async () => {
    const records = api([TASKS]);
    const owner = await ownerSession();
    expect(await read(await records.save(post(owner, { title: "  " }), "task"))).toEqual({
      status: 400,
      body: { error: "Enter Title." },
    });
    expect((await records.save(post(owner, { title: "x".repeat(241) }), "task")).status).toBe(400);
    expect(
      (await records.save(post(owner, { id: "not-an-id", title: "Fine" }), "task")).status,
    ).toBe(400);
    expect((await records.list(get(owner, "/api/records/nothing"), "nothing")).status).toBe(404);
  });
});
