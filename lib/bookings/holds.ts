import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { type ReserveInput, reserve } from "./reserve";
import { reserveTx } from "./store";

export const holdHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function holdSlot(pool: Pool, input: ReserveInput, previousToken?: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 5 * 60_000;
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '5s'");
    if (previousToken && /^[a-f0-9]{64}$/.test(previousToken)) {
      const previousHash = holdHash(previousToken);
      const prior = await client.query<{ staff_id: string }>(
        "SELECT staff_id FROM booking_holds WHERE token_hash=$1",
        [previousHash],
      );
      const ids = [
        ...new Set([...input.staffIds, ...prior.rows.map((row) => row.staff_id)]),
      ].sort();
      await client.query("SELECT id FROM staff WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [
        ids,
      ]);
      await client.query("DELETE FROM booking_holds WHERE token_hash=$1", [previousHash]);
    }
    await client.query("DELETE FROM booking_holds WHERE expires_at<=now()");
    const base = reserveTx(client);
    // Reuse the exact booking protocol, replacing only its final write with a hold.
    const tx = {
      ...base,
      async insert(booking: Parameters<typeof base.insert>[0]) {
        await client.query(
          `INSERT INTO booking_holds(token_hash,service_id,staff_id,starts_at,ends_at,buffer_before_minutes,buffer_after_minutes,expires_at)
        VALUES($1,$2,$3,to_timestamp($4::double precision/1000),to_timestamp($5::double precision/1000),$6,$7,to_timestamp($8::double precision/1000))`,
          [
            holdHash(token),
            booking.serviceId,
            booking.staffId,
            booking.startsAt,
            booking.endsAt,
            booking.bufferBeforeMinutes,
            booking.bufferAfterMinutes,
            expiresAt,
          ],
        );
        return true;
      },
    };
    const result = await reserve(async (work) => {
      return work(tx);
    }, input);
    await client.query("COMMIT");
    return {
      holdToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      staffId: result.staffId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseHold(pool: Pool, token: unknown) {
  if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token))
    await pool.query("DELETE FROM booking_holds WHERE token_hash=$1", [holdHash(token)]);
  return { released: true };
}
