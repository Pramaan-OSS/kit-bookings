import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { HttpError } from "./http";
import { isLocalDate, toInstant } from "./time";

export async function classList(pool: Pool, userId: string | null) {
  const result = await pool.query(
    `SELECT s.id,s.name,s.starts_at,s.ends_at,s.capacity,
    (SELECT count(*)::int FROM class_places p WHERE p.session_id=s.id) AS taken,
    EXISTS(SELECT 1 FROM class_places p WHERE p.session_id=s.id AND p.user_id=$1) AS joined
    FROM class_sessions s WHERE s.starts_at>now() ORDER BY s.starts_at LIMIT 100`,
    [userId],
  );
  return result.rows;
}
export async function classPlace(pool: Pool, sessionId: string, userId: string, cancel = false) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await tx.query("SET LOCAL lock_timeout = '5s'");
    const found = await tx.query(
      "SELECT capacity,starts_at FROM class_sessions WHERE id=$1 FOR UPDATE",
      [sessionId],
    );
    const session = found.rows[0];
    if (!session || new Date(session.starts_at).getTime() <= Date.now())
      throw new HttpError(409, "This class can no longer be changed.");
    if (cancel)
      await tx.query("DELETE FROM class_places WHERE session_id=$1 AND user_id=$2", [
        sessionId,
        userId,
      ]);
    else {
      const count = await tx.query(
        "SELECT count(*)::int AS taken, bool_or(user_id=$2) AS joined FROM class_places WHERE session_id=$1",
        [sessionId, userId],
      );
      if (!count.rows[0].joined) {
        if (count.rows[0].taken >= session.capacity)
          throw new HttpError(409, "This class is full. Please choose another.");
        await tx.query("INSERT INTO class_places(session_id,user_id) VALUES($1,$2)", [
          sessionId,
          userId,
        ]);
      }
    }
    await tx.query("COMMIT");
    return { saved: true };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
export async function addClass(
  pool: Pool,
  data: { name: string; startsAt: number; endsAt: number; capacity: number },
) {
  if (
    data.startsAt <= Date.now() ||
    data.endsAt <= data.startsAt ||
    data.endsAt - data.startsAt > 12 * 3600_000 ||
    !Number.isSafeInteger(data.capacity) ||
    data.capacity < 1 ||
    data.capacity > 100
  )
    throw new HttpError(
      400,
      "Choose a future class, its finish time and between 1 and 100 places.",
    );
  await pool.query(
    "INSERT INTO class_sessions(id,name,starts_at,ends_at,capacity) VALUES($1,$2,to_timestamp($3::double precision/1000),to_timestamp($4::double precision/1000),$5)",
    [randomUUID(), data.name, data.startsAt, data.endsAt, data.capacity],
  );
  return { saved: true };
}

export function classTimes(startsLocal: unknown, endsLocal: unknown, timeZone: string) {
  const convert = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
      throw new HttpError(400, "Choose a class date and time.");
    const [day = "", clock = ""] = value.split("T");
    const [hour, minute] = clock.split(":").map(Number);
    if (!isLocalDate(day) || hour === undefined || minute === undefined || hour > 23 || minute > 59)
      throw new HttpError(400, "Choose a class date and time.");
    const instant = toInstant(day, hour * 60 + minute, timeZone, "later");
    if (instant === null) throw new HttpError(400, "Choose a class date and time.");
    return instant;
  };
  return { startsAt: convert(startsLocal), endsAt: convert(endsLocal) };
}
