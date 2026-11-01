import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  user: { id: "customer", email: "a@example.test", role: "member" },
  add: vi.fn(),
  place: vi.fn(),
  business: { timeZone: "Europe/London" },
}));
vi.mock("../../../lib/runtime", () => ({
  database: () => ({}),
  accountRuntime: () => ({ requireUser: async () => f.user }),
}));
vi.mock("../../../lib/roles/runtime", () => ({ requireRole: async () => f.user }));
vi.mock("../../../lib/bookings/store", () => ({ getBusiness: async () => f.business }));
vi.mock("../../../lib/bookings/classes", async (original) => ({
  ...(await original<typeof import("../../../lib/bookings/classes")>()),
  classPlace: f.place,
  addClass: f.add,
}));

import { POST } from "./handler";

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "http://app.test");
  vi.clearAllMocks();
  f.user.role = "member";
});
afterEach(() => vi.unstubAllEnvs());
const post = (body: unknown) =>
  POST(
    new Request("http://app.test/api/classes", {
      method: "POST",
      headers: { origin: "http://app.test", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
describe("class route boundaries", () => {
  it("refuses an owner taking a customer's place", async () => {
    f.user.role = "owner";
    const response = await post({
      sessionId: "00000000-0000-4000-8000-000000000001",
      action: "join",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Sign in with your customer account to book a place.",
    });
    expect(f.place).not.toHaveBeenCalled();
  });
  it("passes raw local times through the business-zone conversion before saving", async () => {
    f.user.role = "owner";
    f.add.mockResolvedValue({ saved: true });
    expect(
      (
        await post({
          action: "add",
          name: "Evening class",
          startsLocal: "2099-07-10T18:00",
          endsLocal: "2099-07-10T19:00",
          capacity: 3,
        })
      ).status,
    ).toBe(200);
    expect(f.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startsAt: Date.parse("2099-07-10T17:00Z"),
        endsAt: Date.parse("2099-07-10T18:00Z"),
      }),
    );
  });
});
