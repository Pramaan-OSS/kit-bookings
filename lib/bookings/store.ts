// Every SQL statement the bookings kit runs, parameterised, against the tables in src/db/migrations/0100-*.sql.
// Server only. Route handlers never write SQL themselves: they call lib/bookings/public.ts, owner.ts or
// customer.ts, which call these.

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { NewBooking, ReserveTx, Transact } from "./reserve";
import type { Busy, WeeklyHours } from "./slots";

export type Db = Pick<Pool, "query">;
const MINUTE = 60_000;

// ---- The business ---------------------------------------------------------------------------------------------

export type Business = {
  name: string;
  tagline: string;
  address: string;
  timeZone: string;
  currency: string;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotStepMinutes: number;
  reminderHoursBefore: number;
  notifyOwner: boolean;
  remindersLastRunAt: string | null;
};

export async function getBusiness(db: Db): Promise<Business> {
  const { rows } = await db.query(
    `SELECT name, tagline, address, time_zone, currency, min_notice_minutes, max_days_ahead,
      slot_step_minutes, reminder_hours_before, notify_owner, reminders_last_run_at
    FROM business WHERE id = 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("The business row is missing: apply src/db/migrations in order");
  return {
    name: row.name,
    tagline: row.tagline,
    address: row.address,
    timeZone: row.time_zone,
    currency: row.currency,
    minNoticeMinutes: row.min_notice_minutes,
    maxDaysAhead: row.max_days_ahead,
    slotStepMinutes: row.slot_step_minutes,
    reminderHoursBefore: row.reminder_hours_before,
    notifyOwner: row.notify_owner,
    remindersLastRunAt: row.reminders_last_run_at
      ? new Date(row.reminders_last_run_at).toISOString()
      : null,
  };
}

export async function saveBusiness(db: Db, business: Omit<Business, "remindersLastRunAt">) {
  await db.query(
    `UPDATE business SET name=$1, tagline=$2, address=$3, time_zone=$4, currency=$5, min_notice_minutes=$6,
      max_days_ahead=$7, slot_step_minutes=$8, reminder_hours_before=$9, notify_owner=$10, updated_at=now()
    WHERE id = 1`,
    [
      business.name,
      business.tagline,
      business.address,
      business.timeZone,
      business.currency,
      business.minNoticeMinutes,
      business.maxDaysAhead,
      business.slotStepMinutes,
      business.reminderHoursBefore,
      business.notifyOwner,
    ],
  );
}

// ---- Services ---------------------------------------------------------------------------------------------------

export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  active: boolean;
  position: number;
  staffIds: string[];
};

const serviceOf = (row: Record<string, unknown>): Service => ({
  id: row.id as string,
  name: row.name as string,
  description: row.description as string,
  durationMinutes: row.duration_minutes as number,
  priceCents: (row.price_cents as number | null) ?? null,
  bufferBeforeMinutes: row.buffer_before_minutes as number,
  bufferAfterMinutes: row.buffer_after_minutes as number,
  active: row.active as boolean,
  position: row.position as number,
  staffIds: (row.staff_ids as string[] | null) ?? [],
});

export async function listServices(db: Db, { activeOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT s.*, COALESCE(array_agg(ss.staff_id) FILTER (WHERE ss.staff_id IS NOT NULL), '{}') AS staff_ids
    FROM services s LEFT JOIN staff_services ss ON ss.service_id = s.id
    WHERE ($1::boolean IS FALSE OR s.active)
    GROUP BY s.id ORDER BY s.position, s.created_at, s.id`,
    [activeOnly],
  );
  return rows.map(serviceOf);
}

export async function getService(db: Db, id: string) {
  const { rows } = await db.query("SELECT * FROM services WHERE id = $1", [id]);
  return rows[0] ? serviceOf(rows[0]) : null;
}

export type ServiceInput = Omit<Service, "id" | "position" | "staffIds"> & { id: string | null };

/** Inserts or updates; a new service is offered by every active person, which the staff page can change. */
export async function saveService(db: Db, input: ServiceInput) {
  const values = [
    input.name,
    input.description,
    input.durationMinutes,
    input.priceCents,
    input.bufferBeforeMinutes,
    input.bufferAfterMinutes,
    input.active,
  ];
  if (input.id) {
    const { rows } = await db.query(
      `UPDATE services SET name=$2, description=$3, duration_minutes=$4, price_cents=$5,
        buffer_before_minutes=$6, buffer_after_minutes=$7, active=$8 WHERE id=$1 RETURNING id`,
      [input.id, ...values],
    );
    return rows[0] ? input.id : null;
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO services (id, name, description, duration_minutes, price_cents, buffer_before_minutes,
      buffer_after_minutes, active, position)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8, (SELECT COALESCE(max(position), -1) + 1 FROM services))`,
    [id, ...values],
  );
  await db.query(
    "INSERT INTO staff_services (staff_id, service_id) SELECT id, $1 FROM staff WHERE active",
    [id],
  );
  return id;
}

/** Deletes a service nobody has booked; one with bookings is hidden instead, so its history stays. */
export async function removeService(db: Db, id: string): Promise<"deleted" | "hidden" | null> {
  const used = await db.query("SELECT 1 FROM bookings WHERE service_id = $1 LIMIT 1", [id]);
  if (used.rows[0]) {
    const hidden = await db.query("UPDATE services SET active = false WHERE id = $1 RETURNING id", [
      id,
    ]);
    return hidden.rows[0] ? "hidden" : null;
  }
  const deleted = await db.query("DELETE FROM services WHERE id = $1 RETURNING id", [id]);
  return deleted.rows[0] ? "deleted" : null;
}

// ---- Staff ------------------------------------------------------------------------------------------------------

export type Staff = {
  id: string;
  name: string;
  title: string;
  color: string;
  active: boolean;
  position: number;
  serviceIds: string[];
};

const staffOf = (row: Record<string, unknown>): Staff => ({
  id: row.id as string,
  name: row.name as string,
  title: row.title as string,
  color: row.color as string,
  active: row.active as boolean,
  position: row.position as number,
  serviceIds: (row.service_ids as string[] | null) ?? [],
});

export async function listStaff(db: Db, { activeOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT st.*, COALESCE(array_agg(ss.service_id) FILTER (WHERE ss.service_id IS NOT NULL), '{}') AS service_ids
    FROM staff st LEFT JOIN staff_services ss ON ss.staff_id = st.id
    WHERE ($1::boolean IS FALSE OR st.active)
    GROUP BY st.id ORDER BY st.position, st.created_at, st.id`,
    [activeOnly],
  );
  return rows.map(staffOf);
}

export type StaffInput = Omit<Staff, "id" | "position"> & { id: string | null };

/** Inserts or updates a person and which services they offer, in one transaction. */
export async function saveStaff(pool: Pool, input: StaffInput) {
  return withClient(pool, async (client) => {
    const id = input.id ?? randomUUID();
    if (input.id) {
      if (!input.active) await lockActiveStaff(client);
      const { rows } = await client.query(
        "UPDATE staff SET name=$2, title=$3, color=$4, active=$5 WHERE id=$1 RETURNING id",
        [id, input.name, input.title, input.color, input.active],
      );
      if (!rows[0]) return null;
      if (!input.active) await refuseNoActiveStaff(client);
    } else {
      await client.query(
        `INSERT INTO staff (id, name, title, color, active, position)
        VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(max(position), -1) + 1 FROM staff))`,
        [id, input.name, input.title, input.color, input.active],
      );
      // A new person starts with the first person's weekly hours, which the hours page can change.
      await client.query(
        `INSERT INTO weekly_hours (id, staff_id, weekday, start_minute, end_minute)
        SELECT gen_random_uuid(), $1, weekday, start_minute, end_minute FROM weekly_hours
        WHERE staff_id = (SELECT id FROM staff WHERE id <> $1 ORDER BY active DESC, position, created_at LIMIT 1)`,
        [id],
      );
    }
    await client.query("DELETE FROM staff_services WHERE staff_id = $1", [id]);
    if (input.serviceIds.length > 0)
      await client.query(
        `INSERT INTO staff_services (staff_id, service_id)
        SELECT $1, id FROM services WHERE id = ANY($2::uuid[])`,
        [id, input.serviceIds],
      );
    return id;
  });
}

export class LastStaffError extends Error {
  constructor() {
    super("Keep at least one person taking bookings.");
  }
}

/**
 * Locks every active person's row, so two changes that each stop someone taking bookings run one after the other
 * and the second sees the first: never zero people left (READ COMMITTED alone lets both pass the count).
 */
async function lockActiveStaff(client: PoolClient) {
  await client.query("SELECT id FROM staff WHERE active FOR UPDATE");
}

async function refuseNoActiveStaff(client: PoolClient) {
  const { rows } = await client.query("SELECT 1 FROM staff WHERE active LIMIT 1");
  if (!rows[0]) throw new LastStaffError();
}

/** Deletes a person nobody has booked; one with bookings stops taking bookings instead. Never the last one. */
export async function removeStaff(pool: Pool, id: string): Promise<"deleted" | "hidden" | null> {
  return withClient(pool, async (client) => {
    await lockActiveStaff(client);
    const used = await client.query("SELECT 1 FROM bookings WHERE staff_id = $1 LIMIT 1", [id]);
    const result = used.rows[0]
      ? await client.query("UPDATE staff SET active = false WHERE id = $1 RETURNING id", [id])
      : await client.query("DELETE FROM staff WHERE id = $1 RETURNING id", [id]);
    if (!result.rows[0]) return null;
    await refuseNoActiveStaff(client);
    return used.rows[0] ? "hidden" : "deleted";
  });
}

// ---- Weekly hours and days off ----------------------------------------------------------------------------------

export type HoursRow = WeeklyHours & { staffId: string };

export async function listHours(db: Db) {
  const { rows } = await db.query(
    "SELECT staff_id, weekday, start_minute, end_minute FROM weekly_hours ORDER BY staff_id, weekday, start_minute",
  );
  return rows.map(
    (row): HoursRow => ({
      staffId: row.staff_id,
      weekday: row.weekday,
      startMinute: row.start_minute,
      endMinute: row.end_minute,
    }),
  );
}

/** Replaces one person's week in a transaction. */
export async function replaceHours(pool: Pool, staffId: string, hours: readonly WeeklyHours[]) {
  return withClient(pool, async (client) => {
    const { rows } = await client.query("SELECT id FROM staff WHERE id = $1 FOR UPDATE", [staffId]);
    if (!rows[0]) return false;
    await client.query("DELETE FROM weekly_hours WHERE staff_id = $1", [staffId]);
    for (const stretch of hours)
      await client.query(
        "INSERT INTO weekly_hours (id, staff_id, weekday, start_minute, end_minute) VALUES ($1,$2,$3,$4,$5)",
        [randomUUID(), staffId, stretch.weekday, stretch.startMinute, stretch.endMinute],
      );
    return true;
  });
}

export type DayOff = { id: string; staffId: string | null; day: string; note: string };

export async function listDaysOff(db: Db, fromDate: string) {
  const { rows } = await db.query(
    `SELECT id, staff_id, to_char(day, 'YYYY-MM-DD') AS day, note FROM days_off
    WHERE day >= $1::date ORDER BY day, staff_id NULLS FIRST`,
    [fromDate],
  );
  return rows.map(
    (row): DayOff => ({ id: row.id, staffId: row.staff_id, day: row.day, note: row.note }),
  );
}

export async function addDayOff(db: Db, input: Omit<DayOff, "id">) {
  const { rows } = await db.query(
    `INSERT INTO days_off (id, staff_id, day, note) VALUES ($1,$2,$3::date,$4)
    ON CONFLICT DO NOTHING RETURNING id`,
    [randomUUID(), input.staffId, input.day, input.note],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

export async function removeDayOff(db: Db, id: string) {
  const { rows } = await db.query("DELETE FROM days_off WHERE id = $1 RETURNING id", [id]);
  return rows.length > 0;
}

// ---- What is busy -------------------------------------------------------------------------------------------------

/** Hours, days off (theirs and the business's) and busy stretches for some people, around [from, to). */
export async function schedules(
  db: Db,
  staffIds: readonly string[],
  from: number,
  to: number,
  excludeBookingId: string | null = null,
  holdHash: string | null = null,
) {
  const result = new Map<string, { hours: WeeklyHours[]; daysOff: string[]; busy: Busy[] }>();
  for (const id of staffIds) result.set(id, { hours: [], daysOff: [], busy: [] });
  if (staffIds.length === 0) return result;
  const ids = [...staffIds];
  // One after another: inside the booking transaction these share one connection.
  const hours = await db.query(
    "SELECT staff_id, weekday, start_minute, end_minute FROM weekly_hours WHERE staff_id = ANY($1::uuid[])",
    [ids],
  );
  // ±2 days around the window covers every zone's offset from UTC.
  const daysOff = await db.query(
    `SELECT staff_id, to_char(day, 'YYYY-MM-DD') AS day FROM days_off
    WHERE (staff_id IS NULL OR staff_id = ANY($1::uuid[]))
      AND day BETWEEN (to_timestamp($2::double precision / 1000) AT TIME ZONE 'UTC')::date - 2
        AND (to_timestamp($3::double precision / 1000) AT TIME ZONE 'UTC')::date + 2`,
    [ids, from, to],
  );
  const busy = await db.query(
    `SELECT staff_id, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes FROM bookings
    WHERE staff_id = ANY($1::uuid[]) AND status = 'confirmed'
      AND starts_at - buffer_before_minutes * interval '1 minute' < to_timestamp($3::double precision / 1000)
      AND ends_at + buffer_after_minutes * interval '1 minute' > to_timestamp($2::double precision / 1000)
      AND ($4::uuid IS NULL OR id <> $4::uuid)
    UNION ALL SELECT staff_id, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes
    FROM booking_holds WHERE staff_id = ANY($1::uuid[]) AND expires_at > now()
      AND ($5::text IS NULL OR token_hash <> $5)
      AND starts_at - buffer_before_minutes * interval '1 minute' < to_timestamp($3::double precision / 1000)
      AND ends_at + buffer_after_minutes * interval '1 minute' > to_timestamp($2::double precision / 1000)`,
    [ids, from, to, excludeBookingId, holdHash],
  );
  for (const row of hours.rows)
    result.get(row.staff_id)?.hours.push({
      weekday: row.weekday,
      startMinute: row.start_minute,
      endMinute: row.end_minute,
    });
  for (const row of daysOff.rows) {
    const targets = row.staff_id ? [result.get(row.staff_id)] : [...result.values()];
    for (const target of targets) target?.daysOff.push(row.day);
  }
  for (const row of busy.rows)
    result.get(row.staff_id)?.busy.push({
      start: new Date(row.starts_at).getTime() - row.buffer_before_minutes * MINUTE,
      end: new Date(row.ends_at).getTime() + row.buffer_after_minutes * MINUTE,
    });
  return result;
}

// ---- The booking transaction (lib/bookings/reserve.ts) --------------------------------------------------------

export function reserveTx(client: PoolClient, holdHash: string | null = null): ReserveTx {
  return {
    async lockStaff(staffId, serviceId) {
      const { rows } = await client.query(
        `SELECT st.id FROM staff st
        JOIN staff_services ss ON ss.staff_id = st.id AND ss.service_id = $2
        WHERE st.id = $1 AND st.active FOR UPDATE OF st`,
        [staffId, serviceId],
      );
      return rows.length > 0;
    },
    async schedule(staffId, from, to, excludeBookingId) {
      const found = (await schedules(client, [staffId], from, to, excludeBookingId, holdHash)).get(
        staffId,
      );
      return found ?? { hours: [], daysOff: [], busy: [] };
    },
    async insert(booking: NewBooking) {
      if (holdHash) {
        await client.query(
          `DELETE FROM booking_holds WHERE token_hash=$1 AND staff_id=$2 AND service_id=$3 AND starts_at=to_timestamp($4::double precision/1000) AND expires_at>now() RETURNING token_hash`,
          [holdHash, booking.staffId, booking.serviceId, booking.startsAt],
        );
      }
      const { rows } = await client.query(
        `INSERT INTO bookings (id, service_id, staff_id, starts_at, ends_at, buffer_before_minutes,
          buffer_after_minutes, service_name, price_cents, customer_name, customer_email, customer_phone,
          customer_time_zone, notes, customer_id, manage_nonce, rescheduled_from)
        VALUES ($1,$2,$3,to_timestamp($4::double precision / 1000),to_timestamp($5::double precision / 1000),
          $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (staff_id, starts_at) WHERE status = 'confirmed' DO NOTHING
        RETURNING id`,
        [
          booking.id,
          booking.serviceId,
          booking.staffId,
          booking.startsAt,
          booking.endsAt,
          booking.bufferBeforeMinutes,
          booking.bufferAfterMinutes,
          booking.serviceName,
          booking.priceCents,
          booking.customerName,
          booking.customerEmail,
          booking.customerPhone,
          booking.customerTimeZone,
          booking.notes,
          booking.customerId,
          booking.manageNonce,
          booking.rescheduledFrom,
        ],
      );
      return rows.length > 0;
    },
    async lockReplaced(bookingId, now) {
      const { rows } = await client.query(
        `SELECT id FROM bookings WHERE id = $1 AND status = 'confirmed'
          AND starts_at > to_timestamp($2::double precision / 1000) FOR UPDATE`,
        [bookingId, now],
      );
      return rows.length > 0;
    },
    async markRescheduled(bookingId) {
      await client.query("UPDATE bookings SET status = 'rescheduled' WHERE id = $1", [bookingId]);
    },
  };
}

async function withClient<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/** The booking transaction runner over a pool (reserve.ts's Transact). */
export function transactor(pool: Pool, holdHash: string | null = null): Transact {
  return (work) => withClient(pool, (client) => work(reserveTx(client, holdHash)));
}

// ---- Bookings ---------------------------------------------------------------------------------------------------

export type Booking = {
  id: string;
  serviceId: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  priceCents: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerTimeZone: string;
  notes: string;
  customerId: string | null;
  status: "confirmed" | "cancelled" | "rescheduled";
  cancelledBy: "customer" | "owner" | null;
  rescheduledFrom: string | null;
  replacedBy: string | null;
  manageNonce: string;
  confirmationStatus: string;
  confirmationNote: string;
  reminderStatus: string;
  createdAt: string;
};

const BOOKING_COLUMNS = `b.*, st.name AS staff_name,
  (SELECT r.id FROM bookings r WHERE r.rescheduled_from = b.id ORDER BY r.created_at DESC LIMIT 1) AS replaced_by`;

const bookingOf = (row: Record<string, unknown>): Booking => ({
  id: row.id as string,
  serviceId: row.service_id as string,
  staffId: row.staff_id as string,
  staffName: row.staff_name as string,
  startsAt: new Date(row.starts_at as string).toISOString(),
  endsAt: new Date(row.ends_at as string).toISOString(),
  serviceName: row.service_name as string,
  priceCents: (row.price_cents as number | null) ?? null,
  customerName: row.customer_name as string,
  customerEmail: row.customer_email as string,
  customerPhone: row.customer_phone as string,
  customerTimeZone: row.customer_time_zone as string,
  notes: row.notes as string,
  customerId: (row.customer_id as string | null) ?? null,
  status: row.status as Booking["status"],
  cancelledBy: (row.cancelled_by as Booking["cancelledBy"]) ?? null,
  rescheduledFrom: (row.rescheduled_from as string | null) ?? null,
  replacedBy: (row.replaced_by as string | null) ?? null,
  manageNonce: row.manage_nonce as string,
  confirmationStatus: row.confirmation_status as string,
  confirmationNote: row.confirmation_note as string,
  reminderStatus: row.reminder_status as string,
  createdAt: new Date(row.created_at as string).toISOString(),
});

export async function getBooking(db: Db, id: string) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN staff st ON st.id = b.staff_id WHERE b.id = $1`,
    [id],
  );
  return rows[0] ? bookingOf(rows[0]) : null;
}

/** The owner's view: bookings starting in [from, to), any status, earliest first. */
export async function bookingsBetween(db: Db, from: number, to: number, limit = 500) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN staff st ON st.id = b.staff_id
    WHERE b.starts_at >= to_timestamp($1::double precision / 1000)
      AND b.starts_at < to_timestamp($2::double precision / 1000)
    ORDER BY b.starts_at, b.created_at LIMIT $3`,
    [from, to, limit],
  );
  return rows.map(bookingOf);
}

/** The most recent bookings made, for the owner's dashboard. */
export async function latestBookings(db: Db, limit = 5) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN staff st ON st.id = b.staff_id
    WHERE b.status = 'confirmed' ORDER BY b.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(bookingOf);
}

/** A signed-in customer's own bookings, scoped to their account id. */
export async function bookingsOfCustomer(db: Db, customerId: string) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN staff st ON st.id = b.staff_id
    WHERE b.customer_id = $1 AND b.status <> 'rescheduled'
    ORDER BY b.starts_at DESC LIMIT 200`,
    [customerId],
  );
  return rows.map(bookingOf);
}

/** Cancels a confirmed booking that has not started. The cancelled row, or null when it could not be. */
export async function cancelBooking(db: Db, id: string, by: "customer" | "owner", now: number) {
  const { rows } = await db.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancelled_at = now()
    WHERE id = $1 AND status = 'confirmed' AND starts_at > to_timestamp($3::double precision / 1000)
    RETURNING id`,
    [id, by, now],
  );
  return rows[0] ? getBooking(db, id) : null;
}

export async function recordConfirmation(db: Db, id: string, status: string, note: string) {
  await db.query(
    "UPDATE bookings SET confirmation_status = $2, confirmation_note = $3 WHERE id = $1",
    [id, status, note.slice(0, 300)],
  );
}

/** Saves a booking to a customer's account (they proved they hold its link). */
export async function claimBooking(db: Db, id: string, customerId: string) {
  const { rows } = await db.query(
    "UPDATE bookings SET customer_id = $2 WHERE id = $1 AND (customer_id IS NULL OR customer_id = $2) RETURNING id",
    [id, customerId],
  );
  return rows.length > 0;
}

// ---- Reminders ---------------------------------------------------------------------------------------------------

/** How long a reminder claim holds: a run that died mid-send (a restart, the call's deadline) leaves its claims
 * to lapse, and a later run sends them. A run takes at most a few minutes (jobs.ts RUN_DEADLINE_MS). */
export const REMINDER_CLAIM_MINUTES = 15;

/**
 * Claims up to `limit` confirmed bookings starting within the reminder window whose reminder is still pending, made
 * more than an hour before they start (someone who books for this afternoon needs no reminder). A claimed row is not
 * claimed again, by this run or a parallel one, until it is recorded or its claim lapses.
 */
export async function claimDueReminders(db: Db, hoursBefore: number, now: number, limit: number) {
  const { rows } = await db.query(
    `UPDATE bookings SET reminder_claimed_at = to_timestamp($2::double precision / 1000)
    WHERE id IN (
      SELECT id FROM bookings
      WHERE status = 'confirmed' AND reminder_status = 'pending'
        AND (reminder_claimed_at IS NULL
          OR reminder_claimed_at < to_timestamp($2::double precision / 1000) - $4 * interval '1 minute')
        AND starts_at > to_timestamp($2::double precision / 1000)
        AND starts_at <= to_timestamp($2::double precision / 1000) + $1 * interval '1 hour'
        AND created_at < starts_at - interval '1 hour'
      ORDER BY starts_at LIMIT $3 FOR UPDATE SKIP LOCKED
    ) RETURNING id`,
    [hoursBefore, now, limit, REMINDER_CLAIM_MINUTES],
  );
  const claimed: Booking[] = [];
  for (const row of rows) {
    const booking = await getBooking(db, row.id);
    if (booking) claimed.push(booking);
  }
  return claimed;
}

/** Records a reminder's outcome; one to try again later (or never tried) goes back to pending, unclaimed. */
export async function recordReminder(db: Db, id: string, status: string, retry: boolean) {
  await db.query(
    `UPDATE bookings SET reminder_status = CASE WHEN $3::boolean THEN 'pending' ELSE $2 END,
      reminder_claimed_at = CASE WHEN $3::boolean THEN NULL ELSE reminder_claimed_at END
    WHERE id = $1`,
    [id, status, retry],
  );
}

/** Records a scheduled run once; false when this runId was already handled. */
export async function firstRun(db: Db, runId: string, schedule: string) {
  await db.query("DELETE FROM job_runs WHERE ran_at < now() - interval '7 days'");
  const { rows } = await db.query(
    "INSERT INTO job_runs (run_id, schedule) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING run_id",
    [runId, schedule],
  );
  if (rows[0]) await db.query("UPDATE business SET reminders_last_run_at = now() WHERE id = 1");
  return rows.length > 0;
}

// ---- Throttle ----------------------------------------------------------------------------------------------------

/** Counts one hit against a key in a window of `seconds`; how many it has seen in this window. */
export async function hit(db: Db, key: string, seconds: number) {
  await db.query(
    `DELETE FROM booking_throttle WHERE key IN (
      SELECT key FROM booking_throttle WHERE started_at < now() - interval '2 days' ORDER BY started_at LIMIT 100)`,
  );
  const { rows } = await db.query(
    `INSERT INTO booking_throttle (key, hits, started_at) VALUES ($1, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN booking_throttle.started_at < now() - $2 * interval '1 second' THEN 1
        ELSE booking_throttle.hits + 1 END,
      started_at = CASE WHEN booking_throttle.started_at < now() - $2 * interval '1 second' THEN now()
        ELSE booking_throttle.started_at END
    RETURNING hits`,
    [key, seconds],
  );
  return (rows[0]?.hits as number | undefined) ?? Number.POSITIVE_INFINITY;
}

/** How many people take bookings: with one, pages and emails don't say who an appointment is with. */
export async function teamSize(db: Db) {
  const { rows } = await db.query("SELECT count(*)::int AS people FROM staff WHERE active");
  return (rows[0]?.people as number | undefined) ?? 0;
}

/** The owner's sign-in email, if they chose one, for new-booking notices. */
export async function ownerEmail(db: Db) {
  const { rows } = await db.query(
    "SELECT email FROM app_users WHERE role = 'owner' AND email IS NOT NULL",
  );
  return (rows[0]?.email as string | undefined) ?? null;
}
