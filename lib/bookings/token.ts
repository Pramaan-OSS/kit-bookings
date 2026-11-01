// The link a visitor manages a booking with: no account needed, and unguessable. The token is
// `<payload>.<signature>` (base64url): the payload is the booking's id (16 bytes) and its manage nonce (16 bytes),
// the signature HMAC-SHA256 under the app's SESSION_SECRET over "pramaan-booking-manage.v1." + payload. A genuine
// token still opens nothing unless the booking row holds that nonce, so a booking's links can be revoked by giving
// it a new nonce, and a token for one booking never opens another.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DOMAIN = "pramaan-booking-manage.v1.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const NONCE = /^[0-9a-f]{32}$/u;
const TOKEN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u;

/** A fresh manage nonce for a booking row (32 hex characters). */
export function newManageNonce() {
  return randomBytes(16).toString("hex");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`${DOMAIN}${payload}`).digest();
}

export function signManageToken(bookingId: string, nonce: string, secret: string) {
  if (!UUID.test(bookingId) || !NONCE.test(nonce))
    throw new Error("A booking id and nonce are needed");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be configured by the runtime");
  const payload = Buffer.concat([
    Buffer.from(bookingId.replaceAll("-", ""), "hex"),
    Buffer.from(nonce, "hex"),
  ]).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/** The booking id and nonce a genuine token names, or null for anything else. */
export function readManageToken(token: unknown, secret: string) {
  if (typeof token !== "string" || !TOKEN.test(token) || secret.length < 32) return null;
  const [payload = "", given = ""] = token.split(".");
  // Compared as text, not decoded bytes: base64url's last character has spare bits, and a token with them
  // changed must not open anything either.
  const expected = Buffer.from(signature(payload, secret).toString("base64url"));
  const presented = Buffer.from(given);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.length !== 32) return null;
  const hex = bytes.subarray(0, 16).toString("hex");
  const bookingId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { bookingId, nonce: bytes.subarray(16).toString("hex") };
}
