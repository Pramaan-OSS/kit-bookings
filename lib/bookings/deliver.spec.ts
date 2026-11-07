import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmailOutcome, sendEmail } from "../../src/lib/pramaan-modules";
import { deliverWithin, EMAIL_WAIT_MS } from "./notify";
import { changeBooking } from "./owner";
import { sendAndRecord } from "./public";
import { type Booking, type Business, cancelBooking, recordConfirmation } from "./store";

const business = {
  name: "Willow Studio",
  address: "",
  timeZone: "UTC",
  currency: "GBP",
  notifyOwner: false,
} as Business;
const booking = {
  id: "11111111-1111-4111-8111-111111111111",
  staffName: "Ana",
  startsAt: "2026-11-03T10:00:00.000Z",
  endsAt: "2026-11-03T11:00:00.000Z",
  serviceName: "Colour",
  priceCents: null,
  customerName: "Priya",
  customerEmail: "priya@example.com",
  customerPhone: "+91 98765 43210",
  customerTimeZone: "UTC",
  notes: "",
} as Booking;

vi.mock("../../src/lib/pramaan-modules", async (original) => ({
  ...(await original<typeof import("../../src/lib/pramaan-modules")>()),
  sendEmail: vi.fn(),
}));
vi.mock("../runtime", () => ({
  database: () => ({}),
  sessionSecret: () => "a".repeat(40),
  accountRuntime: () => ({ requireRole: async () => ({}) }),
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  cancelBooking: vi.fn(),
  getBusiness: async () => business,
  ownerEmail: async () => null,
  recordConfirmation: vi.fn(),
  teamSize: async () => 1,
}));

const message = {
  to: "priya@example.com",
  subject: "Cancelled",
  text: "Your booking is cancelled.",
};

describe("waiting for an email", () => {
  let land: (outcome: EmailOutcome) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(recordConfirmation).mockReset();
    // A door that does not answer until the test says so: the platform's module socket hanging.
    vi.mocked(sendEmail).mockImplementation(
      () =>
        new Promise((resolve) => {
          land = resolve;
        }),
    );
  });
  afterEach(() => vi.useRealTimers());

  it("answers after the wait when the door hangs, and says the email may still arrive", async () => {
    const answer = deliverWithin(message, 8000);
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toMatchObject({ status: "unknown", retry: false });
  });

  it("answers with the outcome as soon as the door does", async () => {
    const answer = deliverWithin(message);
    land({ status: "sent" });
    expect(await answer).toEqual({ status: "sent", note: "", retry: false });
  });

  it("answers a booking within the wait, and records the confirmation once when it lands", async () => {
    const answer = sendAndRecord("confirmation", booking, "https://x.test", "token");
    await vi.advanceTimersByTimeAsync(EMAIL_WAIT_MS);
    expect(await answer).toBeNull();
    expect(recordConfirmation).not.toHaveBeenCalled();
    land({ status: "sent" });
    await vi.advanceTimersByTimeAsync(0);
    expect(recordConfirmation).toHaveBeenCalledTimes(1);
    expect(recordConfirmation).toHaveBeenCalledWith(expect.anything(), booking.id, "sent", "");
  });

  it("keeps the booking's answer when the outcome can't be recorded, and logs that, never the address", async () => {
    vi.mocked(recordConfirmation).mockRejectedValue(new Error("database gone"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = sendAndRecord("confirmation", booking, "https://x.test", "token");
    await vi.advanceTimersByTimeAsync(EMAIL_WAIT_MS);
    land({ status: "sent" });
    await vi.advanceTimersByTimeAsync(0);
    expect(await answer).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(booking.customerEmail);
    log.mockRestore();
  });

  it("answers the owner's cancel within the wait when the door hangs", async () => {
    vi.mocked(cancelBooking).mockResolvedValue(booking);
    const origin = process.env.APP_ORIGIN ?? "http://app.test";
    const answer = changeBooking(
      new Request(`${origin}/api/owner/bookings`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", id: booking.id }),
      }),
    );
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(EMAIL_WAIT_MS);
    expect(settled).toBe(true);
    expect(await answer).toMatchObject({ cancelled: true, email: { status: "unknown" } });
  });
});
