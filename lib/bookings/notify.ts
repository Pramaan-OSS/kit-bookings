// The emails a booking sends, through the platform's email module (src/lib/pramaan-modules.ts). With the module
// off, or before the owner picks a sender, nothing is sent and the booking is kept all the same: the outcome is
// recorded on the booking and shown to the visitor and the owner, never hidden.
import { type EmailOutcome, sendEmail } from "../../src/lib/pramaan-modules";
import { formatDuration, formatPrice } from "./format";
import type { Booking, Business } from "./store";
import { formatWhen, zoneLabel } from "./time";

export type EmailKind = "confirmation" | "moved" | "cancelled" | "reminder";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (mark) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[mark] ?? mark,
  );

/** The business's display name: the owner's choice, else the app's name. */
export function businessName(business: Business, fallback: string) {
  return business.name.trim() || fallback;
}

/** One email for a booking, in the visitor's own time zone, with the business's too when it differs. */
export function composeEmail(input: {
  kind: EmailKind;
  booking: Booking;
  business: Business;
  name: string;
  manageUrl: string | null;
  /** Whether to say who it's with: not when one person takes every booking. */
  showStaff?: boolean;
}) {
  const { kind, booking, business, name, manageUrl, showStaff = true } = input;
  const start = Date.parse(booking.startsAt);
  const minutes = Math.round((Date.parse(booking.endsAt) - start) / 60_000);
  const when = formatWhen(start, booking.customerTimeZone, "en-GB");
  const theirs = `${when} (${zoneLabel(start, booking.customerTimeZone, "en-GB")})`;
  const local =
    booking.customerTimeZone === business.timeZone
      ? null
      : `${formatWhen(start, business.timeZone, "en-GB")} at ${name}'s end (${business.timeZone})`;
  const subject = {
    confirmation: `Booked: ${booking.serviceName}, ${when}`,
    moved: `Moved: ${booking.serviceName}, now ${when}`,
    cancelled: `Cancelled: ${booking.serviceName}, ${when}`,
    reminder: `Reminder: ${booking.serviceName}, ${when}`,
  }[kind].replace(/\s+/gu, " ");
  const opening = {
    confirmation: `You're booked in with ${name}.`,
    moved: `Your booking with ${name} has moved to a new time.`,
    cancelled:
      booking.cancelledBy === "owner"
        ? `${name} has cancelled this booking. We're sorry for the change of plan.`
        : `Your booking with ${name} is cancelled. Nothing more to do.`,
    reminder: `A reminder of your booking with ${name}.`,
  }[kind];
  const details = [
    ["What", `${booking.serviceName} (${formatDuration(minutes)})`],
    ["When", theirs],
    ...(local ? [["Their time", local]] : []),
    ...(showStaff && booking.staffName && kind !== "cancelled"
      ? [["With", booking.staffName]]
      : []),
    ...(business.address && kind !== "cancelled" ? [["Where", business.address]] : []),
    ...(booking.priceCents !== null && kind !== "cancelled"
      ? [
          [
            "Price",
            `${formatPrice(booking.priceCents, business.currency, "en-GB")}, paid on the day`,
          ],
        ]
      : []),
  ];
  const change =
    manageUrl && kind !== "cancelled"
      ? `Need to change plans? Cancel or move your booking here: ${manageUrl}`
      : "";
  const text = [
    `Hello ${booking.customerName},`,
    "",
    opening,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    change,
    "",
    `${name}`,
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f0e6;padding:24px;font-family:Georgia,serif;color:#1d2b25">
<div style="max-width:520px;margin:0 auto;background:#fffcf6;border:1px solid #e2d8c6;border-radius:16px;padding:28px">
<p style="margin:0 0 4px;font:600 12px/1.4 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#1d5a46">${escapeHtml(name)}</p>
<h1 style="margin:0 0 16px;font-size:24px;font-weight:500">${escapeHtml(opening)}</h1>
<table style="width:100%;border-collapse:collapse;font:15px/1.5 Arial,sans-serif">${details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#58625c;vertical-align:top;white-space:nowrap">${escapeHtml(label ?? "")}</td><td style="padding:6px 0">${escapeHtml(value ?? "")}</td></tr>`,
    )
    .join("")}</table>
${change && manageUrl ? `<p style="margin:24px 0 0;font:15px/1.5 Arial,sans-serif"><a href="${escapeHtml(manageUrl)}" style="display:inline-block;background:#1d5a46;color:#fbf8f1;text-decoration:none;padding:12px 18px;border-radius:999px">Cancel or move this booking</a></p>` : ""}
</div></body></html>`;
  return { to: booking.customerEmail, subject, text, html };
}

/** The owner's notice of a new, moved or cancelled booking. */
export function composeOwnerNotice(input: {
  kind: "new" | "moved" | "cancelled";
  booking: Booking;
  business: Business;
  to: string;
  ownerUrl: string;
}) {
  const { kind, booking, business, to, ownerUrl } = input;
  const when = formatWhen(Date.parse(booking.startsAt), business.timeZone, "en-GB");
  const subject = {
    new: `New booking: ${booking.customerName}, ${when}`,
    moved: `Booking moved: ${booking.customerName}, now ${when}`,
    cancelled: `Booking cancelled: ${booking.customerName}, ${when}`,
  }[kind].replace(/\s+/gu, " ");
  const text = [
    subject,
    "",
    `${booking.serviceName} with ${booking.staffName}`,
    `${booking.customerName} · ${booking.customerEmail} · ${booking.customerPhone}`,
    ...(booking.notes ? ["", `Notes: ${booking.notes}`] : []),
    "",
    `See your bookings: ${ownerUrl}`,
  ].join("\n");
  return { to, subject, text, replyTo: booking.customerEmail };
}

export type EmailRecord = { status: "sent" | "not-sent" | "unknown"; note: string; retry: boolean };

export async function deliver(message: Parameters<typeof sendEmail>[0]): Promise<EmailRecord> {
  const outcome: EmailOutcome = await sendEmail(message);
  if (outcome.status === "sent") return { status: "sent", note: "", retry: false };
  if (outcome.status === "unknown")
    return { status: "unknown", note: outcome.message, retry: false };
  return { status: "not-sent", note: outcome.message, retry: outcome.retry };
}

/** How long a request waits for an email before it answers; the send carries on, and is recorded where it is kept. */
export const EMAIL_WAIT_MS = 8_000;

/** `deliver`, but a request that must answer soon waits `waitMs` at most, and then says the email may still arrive. */
export function deliverWithin(
  message: Parameters<typeof sendEmail>[0],
  waitMs = EMAIL_WAIT_MS,
): Promise<EmailRecord> {
  return Promise.race([
    deliver(message),
    new Promise<EmailRecord>((resolve) => {
      setTimeout(
        () =>
          resolve({
            status: "unknown",
            note: "The email service is slow, so it may still arrive.",
            retry: false,
          }),
        waitMs,
      ).unref?.();
    }),
  ]);
}
