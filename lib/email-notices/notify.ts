import { createHash } from "node:crypto";
import type { Database } from "../roles/guard";
import type { Door } from "./door";
import { type Data, render } from "./templates";

export type Notice = {
  /** A name in TEMPLATES (lib/email-notices/templates.ts). */
  template: string;
  /** Names this one event, once: `booking:<booking id>`, `added:<group id>:<account id>`. The same event never sends twice. */
  event: string;
  /** The one address it goes to. Used to send, then forgotten: never logged, never stored. */
  to: string;
  data?: Data;
};
/** `skipped`: this event was already sent, or is being sent, and nothing was done. `off`: email is not switched on. */
export type Result = {
  status: "sent" | "not-sent" | "unknown" | "skipped";
  off: boolean;
  note: string;
};
type Log = Pick<Console, "error">;

const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
/**
 * A claim that never finished (the app stopped mid-send) is tried again after this, while the platform still holds
 * the event's key. The platform forgets a key after 24 hours, so after STALE_HOURS the claim is not tried again: it
 * is marked `unknown`, because the email may have gone and nothing can say.
 */
const STALE_MINUTES = 10;
const STALE_HOURS = 23;

/**
 * The Idempotency-Key of an event: the same template and event always make the same key, so a retry, a restart and
 * a second request all reach the platform under one key, and it sends once. Another event makes another key.
 */
export function eventKey(template: string, event: string) {
  return `en1-${createHash("sha256").update(`${template}\n${event}`).digest("hex")}`;
}

/**
 * Sends transactional emails through the platform's email module (lib/email-notices/door.ts), once per event.
 *
 * 1. The event is claimed in `app_email_notices` first: a sent, unknown or in-flight event is skipped, so two
 *    requests for one event send once even if the platform has forgotten the key.
 * 2. The send carries the event's Idempotency-Key, so a retry the claim could not see still sends once.
 * 3. The outcome is recorded: which template, how it went. Never the address, subject or text.
 *
 * `notify` never throws for an outcome: a booking is saved whether or not its email goes, and the result says what
 * happened. With email off nothing is sent, nothing is queued, and the result says so (`off`).
 */
export function createNotifier({
  db,
  door,
  log = console,
}: {
  db: () => Database;
  door: Door;
  log?: Log;
}) {
  async function notify(notice: Notice): Promise<Result> {
    const { template, event, to } = notice;
    // A mistake in code, found the first time it runs: never a thing a visitor can cause.
    const message = render(template, notice.data);
    if (typeof event !== "string" || event.trim() === "" || event.length > 300)
      throw new TypeError("An email event is a name of 1 to 300 characters");
    if (typeof to !== "string" || to.length > 254 || !ADDRESS.test(to))
      return { status: "not-sent", off: false, note: "That email address isn't valid." };
    const key = eventKey(template, event);
    try {
      await db().query(
        `UPDATE app_email_notices SET status='unknown',note='It may have been sent, so it will not be sent again.',
        updated_at=now() WHERE event_key=$1 AND status='pending'
        AND updated_at<now()-${STALE_HOURS}*interval '1 hour'`,
        [key],
      );
      const claimed = await db().query(
        `INSERT INTO app_email_notices(event_key,template,status) VALUES($1,$2,'pending')
        ON CONFLICT (event_key) DO UPDATE
        SET status='pending',attempts=app_email_notices.attempts+1,updated_at=now()
        WHERE app_email_notices.status='not-sent'
        OR (app_email_notices.status='pending'
          AND app_email_notices.updated_at<now()-${STALE_MINUTES}*interval '1 minute')
        RETURNING event_key`,
        [key, template],
      );
      if (claimed.rows.length === 0) {
        const held = await db().query<{ status: string }>(
          "SELECT status FROM app_email_notices WHERE event_key=$1",
          [key],
        );
        return {
          status: "skipped",
          off: false,
          note:
            held.rows[0]?.status === "sent"
              ? "This email was already sent."
              : "This email is already being handled.",
        };
      }
    } catch {
      // Without the record there is no way to promise "once": nothing is sent.
      log.error("email notice not recorded", { template });
      return {
        status: "not-sent",
        off: false,
        note: "The email could not be recorded, so it was not sent.",
      };
    }
    const outcome = await door.send({ to, subject: message.subject, text: message.text }, key);
    const status = outcome.status;
    const off = outcome.status === "not-sent" && outcome.off;
    const note = outcome.status === "sent" ? "" : outcome.message;
    try {
      await db().query(
        "UPDATE app_email_notices SET status=$2,off=$3,note=$4,updated_at=now() WHERE event_key=$1",
        [key, status, off, note],
      );
    } catch {
      log.error("email notice outcome not recorded", { template, status });
    }
    // The platform's refusals are not the app's to hide; the template and status say enough, and never who it was for.
    if (status !== "sent" && !off) log.error("email notice not sent", { template, status });
    return { status, off, note };
  }
  return { notify };
}

/** What the owner's page shows: whether email is on, and the last emails' outcomes (never who they went to). */
export async function noticeStatus(db: Database, door: Door) {
  const available = await door.available();
  const recent = await db.query<{
    template: string;
    status: string;
    off: boolean;
    note: string;
    updated_at: Date;
  }>(
    `SELECT template,status,off,note,updated_at FROM app_email_notices
    WHERE status<>'pending' ORDER BY updated_at DESC LIMIT 20`,
  );
  // A sender may be missing even when the module is on: the last send says so, and that is "off" too.
  const off = !available || recent.rows[0]?.off === true;
  return {
    available,
    off,
    recent: recent.rows.map((row) => ({
      template: row.template,
      status: row.status,
      note: row.note,
      at: new Date(row.updated_at).toISOString(),
    })),
  };
}
