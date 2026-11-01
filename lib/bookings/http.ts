// What every bookings route handler shares: reading a JSON body as lib/accounts.ts reads one (same origin,
// JSON only, bounded), answering JSON that is never cached, and turning errors into a message a person can read.
import { AccountError } from "../accounts";
import { BookingGoneError, SlotTakenError } from "./reserve";
import { LastStaffError } from "./store";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY_BYTES = 16_384;

export function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

/** A JSON object from a same-origin POST, or an HttpError a person can act on. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const origin = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    throw new HttpError(403, "Refresh this page and try again.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "Send JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A request body is required.");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "This request is too large.");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* answered below */
  }
  throw new HttpError(400, "Check the submitted information.");
}

/** Runs a route's work and answers its result, or the error as `{ error }` with its status. */
export async function handle(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError || error instanceof AccountError)
      return reply({ error: error.message }, error.status);
    if (error instanceof SlotTakenError) return reply({ error: error.message }, 409);
    if (error instanceof BookingGoneError) return reply({ error: error.message }, 409);
    if (error instanceof LastStaffError) return reply({ error: error.message }, 409);
    console.error("bookings: request failed", error instanceof Error ? error.message : error);
    return reply({ error: "Something went wrong. Please try again." }, 503);
  }
}

// ---- Input --------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function uuid(value: unknown, what: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, `Choose a ${what}.`);
  return value;
}

export function text(value: unknown, label: string, { min = 0, max = 200 } = {}) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < min || trimmed.length > max)
    throw new HttpError(
      400,
      min > 0 ? `Enter ${label} (up to ${max} characters).` : `Keep ${label} to ${max} characters.`,
    );
  return trimmed;
}

/** One line a person typed (a name, a title): no control characters, so it is safe in an email's headers. */
export function line(value: unknown, label: string, options: { min?: number; max?: number } = {}) {
  const typed = text(value, label, options);
  if (/\p{Cc}/u.test(typed)) throw new HttpError(400, `Write ${label} on one line.`);
  return typed;
}

export function whole(value: unknown, label: string, min: number, max: number) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max)
    throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  return number;
}

export function email(value: unknown) {
  const address = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address) || address.length > 254)
    throw new HttpError(400, "Enter a valid email address.");
  return address;
}

/** A phone number as people write one: digits with spaces, dashes, dots, brackets and a leading +. */
export function phone(value: unknown) {
  const number = typeof value === "string" ? value.trim() : "";
  const digits = number.replace(/\D/gu, "");
  if (!/^\+?[\d\s().-]{6,32}$/u.test(number) || digits.length < 6 || digits.length > 20)
    throw new HttpError(400, "Enter a phone number we can reach you on.");
  return number;
}

/** A price typed as "60" or "24.50", in cents; empty is no price shown. */
export function price(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === ""))
    return null;
  const shown = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/u.test(shown))
    throw new HttpError(400, "Enter a price like 60 or 24.50.");
  return Math.round(Number(shown) * 100);
}

export function instant(value: unknown, what = "time") {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw new HttpError(400, `Choose a ${what}.`);
  return time;
}
