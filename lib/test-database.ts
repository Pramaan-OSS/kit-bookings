import type { Pool } from "pg";

export function testDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  return env.TEST_DATABASE_URL ?? env.KIT_CI_DATABASE_URL ?? env.DATABASE_URL;
}

/**
 * Opens `size` connections at once and hands them back, so a race test's transactions really overlap. On a cold pool
 * each new connection waits on its password handshake, and the first attempts finish before the next connect: the
 * race then runs one at a time and passes even with the row lock removed.
 */
export async function warmPool(pool: Pool, size: number) {
  const clients = await Promise.all(Array.from({ length: size }, () => pool.connect()));
  for (const client of clients) client.release();
}
