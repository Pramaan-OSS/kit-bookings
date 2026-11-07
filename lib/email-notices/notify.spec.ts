// Email notices: one email per event, an Idempotency-Key on every send, the "off" state, and no address anywhere it
// should not be. The claim and the owner's page run on Postgres, where DATABASE_URL names a database with the app's
// migrations applied (Pramaan's checks give the tests one); everything happens in one transaction that is rolled
// back, each test behind a savepoint of its own. Skipped without one, so `pnpm test` needs no database. The checks
// that need no database run everywhere.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccounts } from "../accounts";
import { createRoleGuard, type Database } from "../roles/guard";
import { createNoticesApi } from "./api";
import { type Door, emailDoor, type Outcome, type Outgoing } from "./door";
import { createNotifier, eventKey } from "./notify";
import { render } from "./templates";
import { OFF_NOTE, PENDING_NOTE } from "./words";

const url = process.env.DATABASE_URL;
const ORIGIN = process.env.APP_ORIGIN ?? "http://app.test";
const SECRET = randomBytes(32).toString("hex");
const PROJECT = "email-test";
const PASSWORD = "a long test password";
const ADDRESS = "ada.secret@example.test";
const GROUP = { name: "Ada", group: "Gardeners", by: "Sam" };

describe("the rules that need no database", () => {
  it("makes one key for one event, and another for any other", () => {
    const key = eventKey("added-to-group", "added:g1:a1");
    expect(key).toMatch(/^en1-[0-9a-f]{64}$/u);
    expect(eventKey("added-to-group", "added:g1:a1")).toBe(key);
    expect(eventKey("added-to-group", "added:g1:a2")).not.toBe(key);
    expect(eventKey("booking-confirmed", "added:g1:a1")).not.toBe(key);
  });

  it("renders plain text under a fixed subject, with a person's words short and in the body only", () => {
    expect(render("added-to-group", GROUP)).toEqual({
      subject: "You were added to a group",
      text: "Hello Ada,\n\nSam added you to Gardeners.\n\nSign in to see it.",
    });
    const phishing = render("booking-confirmed", {
      name: "Bo",
      what: `Your account is locked\r\nBcc: someone@example.test ${"x".repeat(200)}`,
      when: "Mon",
    });
    // Whatever a visitor typed, the subject is the template's own, and the body holds it short and on one line.
    expect(phishing.subject).toBe("Your booking is confirmed");
    expect(phishing.text).not.toContain("locked\r");
    for (const line of phishing.text.split("\n")) expect(line.length).toBeLessThan(120);
    expect(phishing.text).toContain(
      "You're booked in: Your account is locked Bcc: someone@example.test ",
    );
    expect(() => render("no-such-email")).toThrow("No email template named no-such-email");
  });
});

// A stand-in for the platform's door: what it was asked to send, and under which key.
function fakeDoor(answer: () => Outcome = () => ({ status: "sent" })) {
  const sent: { message: Outgoing; key: string }[] = [];
  const door: Door = {
    available: async () => true,
    send: async (message, key) => {
      sent.push({ message, key });
      return answer();
    },
  };
  return { door, sent };
}

describe.skipIf(!url)("email notices on Postgres", () => {
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
    vi.restoreAllMocks();
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
    return session(response);
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
  // The owner as the starter has them once they chose an email: the test email goes to this address, never another.
  const OWNER_EMAIL = "owner.notices@example.test";
  async function ownerWithEmail() {
    const cookie = await ownerSession();
    const chosen = await accounts().handle(
      new Request(`${ORIGIN}/api/account/owner`, {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
      }),
      "owner",
    );
    expect(chosen.status).toBe(200);
    return cookie;
  }
  const notifierWith = (door: Door, log = { error: vi.fn() }) => ({
    log,
    ...createNotifier({ db: () => db, door, log }),
  });
  const notice = (event = "added:g1:a1", to = ADDRESS) => ({
    template: "added-to-group",
    event,
    to,
    data: GROUP,
  });
  const apiWith = (door: Door) =>
    createNoticesApi({
      db: () => db,
      door,
      notifier: createNotifier({ db: () => db, door }),
      requireRole: createRoleGuard(db, (request) => accounts().requireUser(request)).requireRole,
    });
  const post = (cookie: string, input: object, origin = ORIGIN) =>
    new Request(`${ORIGIN}/api/email-notices`, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const asked = (cookie: string) =>
    new Request(`${ORIGIN}/api/email-notices`, { headers: { cookie } });

  it("idempotency: the same event sends once, under one key, however often it is asked", async () => {
    const { door, sent } = fakeDoor();
    const { notify } = notifierWith(door);
    expect(await notify(notice())).toEqual({ status: "sent", off: false, note: "" });
    expect(await notify(notice())).toMatchObject({
      status: "skipped",
      note: "This email was already sent.",
    });
    // Two requests at the same moment are still one email.
    const [first, second] = await Promise.all([
      notify(notice("added:g1:a2")),
      notify(notice("added:g1:a2")),
    ]);
    expect([first.status, second.status].sort()).toEqual(["sent", "skipped"]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.key).toBe(eventKey("added-to-group", "added:g1:a1"));
    expect(sent[1]?.key).toBe(eventKey("added-to-group", "added:g1:a2"));
    expect(sent[0]?.key).not.toBe(sent[1]?.key);
    for (const one of sent) expect(one.key).toMatch(/^en1-[0-9a-f]{64}$/u);
  });

  it("sends again only what did not go, and never what may have", async () => {
    let next: Outcome = {
      status: "not-sent",
      off: false,
      message: "This app may send 20 emails an hour.",
    };
    const { door, sent } = fakeDoor(() => next);
    const { notify } = notifierWith(door);
    expect((await notify(notice("e1"))).status).toBe("not-sent");
    next = { status: "sent" };
    expect((await notify(notice("e1"))).status).toBe("sent");
    expect((await notify(notice("e1"))).status).toBe("skipped");
    next = { status: "unknown", message: "It may have been sent." };
    expect((await notify(notice("e2"))).status).toBe("unknown");
    next = { status: "sent" };
    expect((await notify(notice("e2"))).status).toBe("skipped");
    // The same key each time an event is tried.
    expect(sent.map((one) => one.key)).toEqual([
      eventKey("added-to-group", "e1"),
      eventKey("added-to-group", "e1"),
      eventKey("added-to-group", "e2"),
    ]);
    const kept = await db.query(
      "SELECT event_key,status,attempts FROM app_email_notices ORDER BY event_key",
    );
    expect(kept.rows.map((row) => [row.status, row.attempts]).sort()).toEqual([
      ["sent", 2],
      ["unknown", 1],
    ]);
  });

  it("with email off, sends nothing, queues nothing, says so, and the app carries on", async () => {
    const off = { status: "not-sent", off: true, message: OFF_NOTE } as const;
    const { door } = fakeDoor(() => off);
    const { notify, log } = notifierWith({ ...door, available: async () => false });
    expect(await notify(notice())).toEqual({ status: "not-sent", off: true, note: OFF_NOTE });
    expect(log.error).not.toHaveBeenCalled();
    const api = apiWith({ ...door, available: async () => false });
    const owner = await ownerSession();
    const seen = await api.status(asked(owner));
    expect(await seen.json()).toMatchObject({ available: false, off: true, note: OFF_NOTE });
    const tasks = await accounts().handle(
      new Request(`${ORIGIN}/api/account/tasks`, { headers: { cookie: owner } }),
      "tasks",
    );
    expect(tasks.status).toBe(200);
  });

  it("says the platform has no sender yet, and keeps the test on offer until one is chosen", async () => {
    let next: Outcome = { status: "not-sent", off: true, message: OFF_NOTE };
    const { door } = fakeDoor(() => next);
    const api = apiWith(door);
    const owner = await ownerWithEmail();
    const test = await api.test(post(owner, { nonce: randomUUID() }));
    expect(await test.json()).toEqual({
      result: { status: "not-sent", off: true, note: OFF_NOTE },
    });
    // The module is on, so the page is not "off": the last outcome says why, and the test button stays.
    const seen = await (await api.status(asked(owner))).json();
    expect(seen).toMatchObject({ available: true, off: false });
    expect(seen.note).toBeUndefined();
    expect(seen.recent[0]).toMatchObject({ status: "not-sent", note: OFF_NOTE });
    // The platform chooses a sender: the next test goes, and the page shows it, with no other email needed.
    next = { status: "sent" };
    const again = await api.test(post(owner, { nonce: randomUUID() }));
    expect((await again.json()).result).toEqual({ status: "sent", off: false, note: "" });
    const after = await (await api.status(asked(owner))).json();
    expect(after).toMatchObject({ available: true, off: false });
    expect(after.recent[0]).toMatchObject({ status: "sent", note: "" });
  });

  it("answers within its wait when the platform is slow, and records the outcome when it lands", async () => {
    let land: (outcome: Outcome) => void = () => {};
    const slow: Door = {
      available: async () => true,
      send: () => new Promise<Outcome>((resolve) => (land = resolve)),
    };
    const { notify } = createNotifier({ db: () => db, door: slow, waitMs: 50 });
    const started = Date.now();
    expect(await notify(notice("slow:1"))).toEqual({
      status: "pending",
      off: false,
      note: PENDING_NOTE,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    const row = () =>
      db.query<{ status: string }>("SELECT status FROM app_email_notices WHERE event_key=$1", [
        eventKey("added-to-group", "slow:1"),
      ]);
    expect((await row()).rows[0]?.status).toBe("pending");
    // Asked again while it is on its way, it is not sent twice.
    expect((await notify(notice("slow:1"))).status).toBe("skipped");
    land({ status: "sent" });
    await vi.waitFor(async () => expect((await row()).rows[0]?.status).toBe("sent"));
  });

  it("leaves no address in a log, an answer or a table, whatever goes wrong", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(JSON.stringify(args));
      });
    const failing = [
      { status: "not-sent", off: false, message: "The platform said no." },
      { status: "unknown", message: "It may have been sent." },
    ] as const;
    for (const [at, outcome] of failing.entries()) {
      const { door } = fakeDoor(() => outcome);
      const { notify } = createNotifier({ db: () => db, door });
      const result = await notify(notice(`leak:${at}`));
      expect(JSON.stringify(result)).not.toContain("example.test");
    }
    // A notifier that cannot reach its table sends nothing and logs no address either.
    const sent: string[] = [];
    const broken = createNotifier({
      db: () =>
        ({
          query: () => Promise.reject(new Error(`no table for ${ADDRESS}`)),
        }) as unknown as Database,
      door: {
        available: async () => true,
        send: async (message) => (sent.push(message.to), { status: "sent" }),
      },
    });
    expect((await broken.notify(notice("leak:db"))).status).toBe("not-sent");
    expect(sent).toEqual([]);
    expect((await broken.notify(notice("leak:bad", "not an address"))).note).toBe(
      "That email address isn't valid.",
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("example.test");
    expect(lines.join("\n")).not.toContain("Gardeners");
    const tables = await db.query("SELECT t::text AS row FROM app_email_notices t");
    expect(tables.rows.map((row) => row.row).join("\n")).not.toContain("example.test");
  });

  it("is the owner's alone: no session, a member, or another origin is refused, and a test is one email", async () => {
    const { door, sent } = fakeDoor();
    const api = apiWith(door);
    const member = await signUp("kim.notices@example.test");
    const refused = { error: "You don't have access to this." };
    expect((await api.status(new Request(`${ORIGIN}/api/email-notices`))).status).toBe(401);
    const asMember = await api.status(asked(member));
    expect({ status: asMember.status, ...(await asMember.json()) }).toEqual({
      status: 403,
      ...refused,
    });
    const testAsMember = await api.test(post(member, { nonce: randomUUID() }));
    expect(testAsMember.status).toBe(403);
    const owner = await ownerWithEmail();
    const nonce = randomUUID();
    const foreign = await api.test(post(owner, { nonce }, "http://evil.test"));
    expect(foreign.status).toBe(403);
    expect((await api.test(post(owner, {}))).status).toBe(400);
    expect(sent).toEqual([]);
    // The same try sent twice is one email, to the owner's own address even if the request names another, and
    // the answer never repeats an address.
    const first = await api.test(post(owner, { to: ADDRESS, nonce }));
    const again = await api.test(post(owner, { to: ADDRESS, nonce }));
    expect((await first.json()).result.status).toBe("sent");
    const second = await again.text();
    expect(second).toContain("skipped");
    expect(second).not.toContain("example.test");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.to).toBe(OWNER_EMAIL);
    expect(sent[0]?.message.subject).toBe("A test email from your app");
  });

  it("asks an owner with no email of their own to choose one first, and sends nothing", async () => {
    const { door, sent } = fakeDoor();
    const owner = await ownerSession();
    const asked = await apiWith(door).test(post(owner, { nonce: randomUUID(), to: ADDRESS }));
    expect(asked.status).toBe(400);
    expect(await asked.json()).toEqual({ error: "Choose your own email in the owner area first." });
    expect(sent).toEqual([]);
  });

  it("tries a claim that never finished again while the platform holds its key, and gives it up after", async () => {
    const { door, sent } = fakeDoor();
    const { notify } = notifierWith(door);
    const claim = (event: string, age: string) =>
      db.query(
        `INSERT INTO app_email_notices(event_key,template,status,updated_at)
        VALUES($1,'added-to-group','pending',now()-$2::interval)`,
        [eventKey("added-to-group", event), age],
      );
    await claim("stuck", "1 hour");
    await claim("fresh", "1 minute");
    await claim("forgotten", "24 hours");
    // Stuck an hour: the key is still held, so it is tried again under it. A minute: still being sent.
    expect((await notify(notice("stuck"))).status).toBe("sent");
    expect((await notify(notice("fresh"))).status).toBe("skipped");
    // A day: the platform has forgotten the key, so this could send twice. It is marked unknown and left.
    expect((await notify(notice("forgotten"))).status).toBe("skipped");
    expect(sent.map((one) => one.key)).toEqual([eventKey("added-to-group", "stuck")]);
    const kept = await db.query("SELECT status FROM app_email_notices WHERE event_key=$1", [
      eventKey("added-to-group", "forgotten"),
    ]);
    expect(kept.rows[0]?.status).toBe("unknown");
  });
});

// The door client against a stand-in for the door's socket: the Idempotency-Key it sends, and what it makes of answers.
describe.skipIf(process.platform === "win32")("the email door client", () => {
  let dir: string;
  let server: Server;
  const seen: { method?: string; url?: string; auth?: string; key?: string; body?: string }[] = [];
  let answer: { status: number; body: unknown } = { status: 202, body: {} };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "email-door-"));
    writeFileSync(path.join(dir, "token"), "pmt1_test\n");
    process.env.PRAMAAN_MODULES_DIR = dir;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        seen.push({
          method: request.method,
          url: request.url,
          auth: request.headers.authorization,
          key: request.headers["idempotency-key"] as string | undefined,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        response.writeHead(answer.status, { "content-type": "application/json" });
        response.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(path.join(dir, "modules.sock"), resolve));
  });
  afterAll(async () => {
    Reflect.deleteProperty(process.env, "PRAMAAN_MODULES_DIR");
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const message = { to: ADDRESS, subject: "Hello", text: "Hello there" };
  it("sends with the app's token and the event's Idempotency-Key, and reads the door's answers", async () => {
    const key = eventKey("test", "test:1");
    answer = { status: 202, body: { sent: true } };
    expect(await emailDoor.send(message, key)).toEqual({ status: "sent" });
    expect(seen.at(-1)).toMatchObject({
      method: "POST",
      url: "/v1/email",
      auth: "Bearer pmt1_test",
      key,
    });
    expect(JSON.parse(seen.at(-1)?.body ?? "{}")).toEqual(message);
    for (const [status, error] of [
      [503, "EMAIL_SENDER_NOT_CONFIGURED"],
      [404, "MODULE_OFF"],
      [403, "EMAIL_DISABLED_FOR_APP"],
    ] as const) {
      answer = { status, body: { error, message: "Nope." } };
      expect(await emailDoor.send(message, key)).toEqual({
        status: "not-sent",
        off: true,
        message: OFF_NOTE,
      });
    }
    // A 403 for anything but an off error (a bad or rotated token) is an operator's fault, not "email is off".
    answer = {
      status: 403,
      body: { error: "TOKEN_REJECTED", message: "The token was not accepted." },
    };
    expect(await emailDoor.send(message, key)).toEqual({
      status: "not-sent",
      off: false,
      message: "The token was not accepted.",
    });
    answer = { status: 429, body: { error: "EMAIL_LIMIT_REACHED", message: "Twenty an hour." } };
    expect(await emailDoor.send(message, key)).toEqual({
      status: "not-sent",
      off: false,
      message: "Twenty an hour.",
    });
    // A 502 for a transport or a send that failed is a definite "not sent", and may be tried again.
    for (const error of ["EMAIL_TRANSPORT_FAILED", "EMAIL_SEND_FAILED"]) {
      answer = { status: 502, body: { error, message: "The relay said no." } };
      expect(await emailDoor.send(message, key)).toEqual({
        status: "not-sent",
        off: false,
        message: "The relay said no.",
      });
    }
    for (const [status, error] of [
      [502, "EMAIL_OUTCOME_UNKNOWN"],
      [504, "MODULE_OUTCOME_UNKNOWN"],
      [409, "IDEMPOTENCY_PENDING"],
    ] as const) {
      answer = { status, body: { error, message: "May have gone." } };
      expect(await emailDoor.send(message, key)).toEqual({
        status: "unknown",
        message: "May have gone.",
      });
    }
    answer = { status: 200, body: { scope: "live", modules: { email: true } } };
    expect(await emailDoor.available()).toBe(true);
  });

  it("is off when the app has no door", async () => {
    process.env.PRAMAAN_MODULES_DIR = path.join(dir, "missing");
    expect(await emailDoor.available()).toBe(false);
    expect(await emailDoor.send(message, eventKey("test", "x"))).toEqual({
      status: "not-sent",
      off: true,
      message: OFF_NOTE,
    });
    process.env.PRAMAAN_MODULES_DIR = dir;
  });
});
