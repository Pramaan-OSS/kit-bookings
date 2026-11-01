// Display helpers shared by the pages and the emails.

export function formatPrice(cents: number | null, currency: string, locale?: string) {
  if (cents === null) return "Free";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "30 min", "1 hr", "1 hr 15 min". */
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** The colours a person's bookings are drawn in on the owner's calendar (DESIGN.md "Staff colours"). */
export const STAFF_COLORS = ["evergreen", "clay", "indigo", "plum", "ochre", "teal"] as const;
export type StaffColor = (typeof STAFF_COLORS)[number];
export const isStaffColor = (value: unknown): value is StaffColor =>
  typeof value === "string" && (STAFF_COLORS as readonly string[]).includes(value);

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
