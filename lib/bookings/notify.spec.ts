import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modulesPresent, scheduleKey, sendEmail } from "../../src/lib/pramaan-modules";
import { composeEmail, composeOwnerNotice } from "./notify";
import type { Booking, Business } from "./store";

const business: Business = {
  name: "Willow Studio",
  tagline: "",
  address: "12 High Street",
  timeZone: "Europe/London",
  currency: "GBP",
  minNoticeMinutes: 120,
  maxDaysAhead: 60,
  slotStepMinutes: 15,
  reminderHoursBefore: 24,
  notifyOwner: true,
  remindersLastRunAt: null,
};
const booking: Booking = {
  id: "11111111-1111-4111-8111-111111111111",
  serviceId: "s",
  staffId: "t",
  staffName: "Ana",
  startsAt: "2026-11-03T10:00:00.000Z",
  endsAt: "2026-11-03T11:00:00.000Z",
  serviceName: "Colour <and> cut",
  priceCents: 6000,
  customerName: "Priya",
  customerEmail: "priya@example.com",
  customerPhone: "+91 98765 43210",
  customerTimeZone: "Asia/Kolkata",
  notes: "",
  customerId: null,
  status: "confirmed",
  cancelledBy: null,
  rescheduledFrom: null,
  replacedBy: null,
  manageNonce: "0".repeat(32),
  confirmationStatus: "pending",
  confirmationNote: "",
  reminderStatus: "pending",
  createdAt: "2026-11-01T10:00:00.000Z",
};

describe("booking emails", () => {
  it("shows the time in the visitor's own zone, with the business's beside it", () => {
    const email = composeEmail({
      kind: "confirmation",
      booking,
      business,
      name: "Willow Studio",
      manageUrl: "https://x.test/manage?token=t",
    });
    expect(email.to).toBe("priya@example.com");
    expect(email.subject).toContain("Booked: Colour <and> cut");
    // 10:00 UTC is 15:30 in Kolkata and 10:00 in London (GMT in November).
    expect(email.text).toMatch(/15:30/u);
    expect(email.text).toMatch(/10:00 at Willow Studio's end \(Europe\/London\)/u);
    expect(email.text).toContain("https://x.test/manage?token=t");
    expect(email.text).toContain("£60, paid on the day");
  });

  it("says who it's with only when more than one person takes bookings", () => {
    const team = composeEmail({
      kind: "reminder",
      booking,
      business,
      name: "Willow Studio",
      manageUrl: null,
    });
    expect(team.text).toContain("With: Ana");
    const solo = composeEmail({
      kind: "reminder",
      booking,
      business,
      name: "Willow Studio",
      manageUrl: null,
      showStaff: false,
    });
    expect(solo.text).not.toContain("With:");
  });

  it("escapes what people typed in the HTML version", () => {
    const email = composeEmail({
      kind: "confirmation",
      booking,
      business,
      name: "Willow <Studio>",
      manageUrl: null,
    });
    expect(email.html).toContain("Colour &lt;and&gt; cut");
    expect(email.html).toContain("Willow &lt;Studio&gt;");
    expect(email.html).not.toContain("<and>");
  });

  it("leaves the change link out once a booking is cancelled", () => {
    const email = composeEmail({
      kind: "cancelled",
      booking: { ...booking, status: "cancelled", cancelledBy: "owner" },
      business,
      name: "Willow Studio",
      manageUrl: "https://x.test/manage?token=t",
    });
    expect(email.subject).toMatch(/^Cancelled:/u);
    expect(email.text).toContain("Willow Studio has cancelled this booking");
    expect(email.text).not.toContain("manage?token");
  });

  it("tells the owner who booked, with a reply that goes to the customer", () => {
    const notice = composeOwnerNotice({
      kind: "new",
      booking,
      business,
      to: "owner@example.com",
      ownerUrl: "https://x.test/owner/bookings",
    });
    expect(notice).toMatchObject({ to: "owner@example.com", replyTo: "priya@example.com" });
    expect(notice.text).toContain("Priya · priya@example.com · +91 98765 43210");
  });
});

describe("the platform's module door, when it is not there", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.PRAMAAN_MODULES_DIR;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("sends nothing, throws nothing, and says why", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modules-"));
    dirs.push(dir);
    process.env.PRAMAAN_MODULES_DIR = path.join(dir, "absent");
    expect(modulesPresent()).toEqual({ door: false, schedules: false });
    expect(scheduleKey()).toBeNull();
    const outcome = await sendEmail({ to: "a@example.com", subject: "Hi", text: "Hi" });
    expect(outcome).toEqual({
      status: "not-sent",
      message: "Email isn't switched on for this app yet, so no email was sent.",
      retry: false,
    });
  });
});
