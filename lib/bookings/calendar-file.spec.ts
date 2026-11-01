import { describe, expect, it, vi } from "vitest";

vi.mock("../runtime", () => ({
  database: () => ({}),
  sessionSecret: () => "test-only-calendar-signing-secret-123456",
  accountRuntime: () => ({}),
}));
vi.mock("./store", async (original) => ({
  ...(await original<typeof import("./store")>()),
  getBooking: async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    manageNonce: "0123456789abcdef0123456789abcdef",
    status: "confirmed",
    serviceName: "Summer consultation 🌿".repeat(10),
    staffName: "Our team",
    startsAt: "2099-07-10T10:00:00.000Z",
    endsAt: "2099-07-10T11:00:00.000Z",
  }),
  getBusiness: async () => ({ name: "Studio", address: "A long address ".repeat(20) }),
}));

import { calendarFile } from "./public";
import { signManageToken } from "./token";

describe("downloaded calendars", () => {
  it("folds the actual calendar including its long signed manage link", async () => {
    const token = signManageToken(
      "00000000-0000-4000-8000-000000000001",
      "0123456789abcdef0123456789abcdef",
      "test-only-calendar-signing-secret-123456",
    );
    const calendar = await calendarFile(
      new Request(`http://app.test/api/booking/calendar?token=${token}`),
    );
    expect(calendar).not.toBeNull();
    for (const line of (calendar ?? "").split("\r\n"))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(calendar?.replaceAll("\r\n ", "")).toContain(`manage?token=${token}`);
  });
});
