// Reminder emails, run by the platform's scheduled jobs module: pramaan.schedules.json declares
// "booking-reminders" every 15 minutes at /api/jobs/reminders. Only the live app is called, and only with
// schedules on. The call is signed with the app's schedule key; anything unsigned, stale or for another
// schedule is refused, since anyone can reach the route's address.
import { createHmac, timingSafeEqual } from "node:crypto";
import { siteName } from "../../app/site";
import { scheduleKey } from "../../src/lib/pramaan-modules";
import { database, sessionSecret } from "../runtime";
import { businessName, composeEmail, deliver } from "./notify";
import { manageUrl, originOf } from "./public";
import { claimDueReminders, firstRun, getBusiness, recordReminder, teamSize } from "./store";
import { signManageToken } from "./token";

export const REMINDER_SCHEDULE = "booking-reminders";
/** Reminders sent in one run: the email module allows 20 an hour, and confirmations need room too. */
const PER_RUN = 4;
/** No new send starts after this: the platform gives a scheduled call 30 s. What isn't tried is released. */
export const RUN_DEADLINE_MS = 20_000;
const FRESH_SECONDS = 300;

/** Whether a scheduled call is genuine: `v1=` HMAC-SHA256(key, "<timestamp>.<body>"), at most five minutes old. */
export function verifySchedule(
  key: string | null,
  timestamp: string,
  signature: string,
  body: string,
  now = Date.now(),
) {
  if (!key || !/^\d{1,12}$/u.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > FRESH_SECONDS) return false;
  const expected = Buffer.from(
    `v1=${createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex")}`,
  );
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** POST /api/jobs/reminders */
export async function runReminders(request: Request) {
  const body = await request.text();
  const genuine = verifySchedule(
    scheduleKey(),
    request.headers.get("x-pramaan-timestamp") ?? "",
    request.headers.get("x-pramaan-signature") ?? "",
    body,
  );
  if (!genuine) return { status: 403, value: { error: "Forbidden" } };
  let job: { schedule?: unknown; runId?: unknown };
  try {
    job = JSON.parse(body);
  } catch {
    return { status: 400, value: { error: "Bad request" } };
  }
  if (job.schedule !== REMINDER_SCHEDULE || typeof job.runId !== "string" || job.runId.length > 200)
    return { status: 403, value: { error: "Forbidden" } };
  const db = database();
  if (!(await firstRun(db, job.runId, REMINDER_SCHEDULE)))
    return { status: 200, value: { repeat: true } };
  const business = await getBusiness(db);
  const name = businessName(business, siteName);
  const origin = originOf(request);
  const started = Date.now();
  const due = await claimDueReminders(db, business.reminderHoursBefore, started, PER_RUN);
  const showStaff = due.length > 0 && (await teamSize(db)) > 1;
  const results: string[] = [];
  for (const booking of due) {
    if (Date.now() - started > RUN_DEADLINE_MS) {
      // Out of time: give the claim back now rather than leave it to lapse.
      await recordReminder(db, booking.id, "pending", true);
      continue;
    }
    const token = signManageToken(booking.id, booking.manageNonce, sessionSecret());
    const outcome = await deliver(
      composeEmail({
        kind: "reminder",
        booking,
        business,
        name,
        manageUrl: manageUrl(origin, token),
        showStaff,
      }),
    );
    // A send refused for a while (the hourly limit, a paused relay) is released for the next run to try again.
    await recordReminder(db, booking.id, outcome.status, outcome.retry);
    results.push(outcome.status);
  }
  return {
    status: 200,
    value: {
      reminded: results.filter((status) => status === "sent").length,
      tried: results.length,
    },
  };
}
