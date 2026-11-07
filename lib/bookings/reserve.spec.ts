// The no-double-booking protocol under concurrency. The store here models what Postgres does for
// lib/bookings/store.ts: a row lock held until the transaction ends (SELECT … FOR UPDATE), reads that see only
// committed rows, and the unique index on (staff_id, starts_at) for confirmed bookings. Every call yields to the
// event loop, so concurrent bookings interleave the way requests on a pool do. Two switches turn the lock and the
// index off, to show the test catches what each one prevents. store.pg.spec.ts runs the same race on Postgres.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BookingGoneError,
  type NewBooking,
  type ReserveInput,
  type ReserveTx,
  reserve,
  type ServiceTerms,
  SLOT_CLOSED,
  SLOT_OFF_HOURS,
  SLOT_PASSED,
  SLOT_TAKEN,
  SLOT_TOO_FAR,
  SLOT_TOO_SOON,
  SlotTakenError,
  type Transact,
} from "./reserve";
import { busyOf, type WeeklyHours } from "./slots";

const at = (iso: string) => Date.parse(iso);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = this.tail;
    this.tail = before.then(() => held);
    return before.then(() => release);
  }
}

type Row = NewBooking & { status: "confirmed" | "cancelled" | "rescheduled" };

function memoryStore({
  lock = true,
  uniqueIndex = true,
  daysOff = {} as Record<string, string[]>,
} = {}) {
  const rows: Row[] = [];
  const locks = new Map<string, Mutex>();
  const inFlight = new Set<NewBooking>();
  const hours: WeeklyHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 540,
    endMinute: 1020,
  }));
  const staff = new Set(["ana", "ben"]);
  let commits = 0;
  const confirmedAt = (staffId: string, startsAt: number) =>
    rows.some(
      (row) => row.staffId === staffId && row.startsAt === startsAt && row.status === "confirmed",
    );

  const transact: Transact = async (work) => {
    const held: Array<() => void> = [];
    const inserted: NewBooking[] = [];
    const moved: string[] = [];
    const take = async (key: string) => {
      const mutex = locks.get(key) ?? new Mutex();
      locks.set(key, mutex);
      held.push(await mutex.acquire());
    };
    const tx: ReserveTx = {
      async lockStaff(staffId) {
        if (lock) await take(`staff ${staffId}`);
        await tick();
        return staff.has(staffId);
      },
      async schedule(staffId, _from, _to, exclude) {
        await tick();
        const busy = rows
          .filter(
            (row) => row.staffId === staffId && row.status === "confirmed" && row.id !== exclude,
          )
          .map(busyOf);
        return { hours, daysOff: daysOff[staffId] ?? [], busy };
      },
      async insert(booking) {
        await tick();
        if (uniqueIndex) {
          // Postgres makes a second insert of the same key wait for the first transaction, then skips it.
          const racing = [...inFlight].some(
            (other) => other.staffId === booking.staffId && other.startsAt === booking.startsAt,
          );
          const freedHere = moved.some(
            (id) => rows.find((row) => row.id === id)?.startsAt === booking.startsAt,
          );
          if (racing || (confirmedAt(booking.staffId, booking.startsAt) && !freedHere))
            return false;
        }
        inFlight.add(booking);
        inserted.push(booking);
        return true;
      },
      async lockReplaced(bookingId, now) {
        await take(`booking ${bookingId}`);
        await tick();
        const row = rows.find((entry) => entry.id === bookingId);
        return row?.status === "confirmed" && row.startsAt > now;
      },
      async markRescheduled(bookingId) {
        await tick();
        moved.push(bookingId);
      },
    };
    try {
      const result = await work(tx);
      for (const id of moved) {
        const row = rows.find((entry) => entry.id === id);
        if (row) row.status = "rescheduled";
      }
      for (const booking of inserted) rows.push({ ...booking, status: "confirmed" });
      commits++;
      return result;
    } finally {
      for (const booking of inserted) inFlight.delete(booking);
      for (const release of held.reverse()) release();
    }
  };
  return { rows, transact, commits: () => commits };
}

const consultation: ServiceTerms = {
  id: "consultation",
  name: "Consultation",
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  priceCents: null,
};
const NOW = at("2026-11-02T08:00:00Z"); // Monday

function attempt(
  startsAt: string,
  staffIds: string[] = ["ana"],
  replaces: string | null = null,
): ReserveInput {
  return {
    service: consultation,
    staffIds,
    startsAt: at(startsAt),
    rules: { timeZone: "UTC", stepMinutes: 15, minNoticeMinutes: 0, maxDaysAhead: 60 },
    now: NOW,
    replaces,
    booking: {
      id: randomUUID(),
      customerName: "Visitor",
      customerEmail: "visitor@example.com",
      customerPhone: "+44 20 7946 0000",
      customerTimeZone: "UTC",
      notes: "",
      customerId: null,
      manageNonce: "0".repeat(32),
    },
  };
}

async function race(store: ReturnType<typeof memoryStore>, inputs: ReserveInput[]) {
  const results = await Promise.allSettled(inputs.map((input) => reserve(store.transact, input)));
  return {
    booked: results.filter((result) => result.status === "fulfilled"),
    refused: results.filter(
      (result) => result.status === "rejected" && result.reason instanceof SlotTakenError,
    ),
    failed: results.filter(
      (result) => result.status === "rejected" && !(result.reason instanceof SlotTakenError),
    ),
  };
}

const overlapping = (rows: Row[]) =>
  rows
    .filter((row) => row.status === "confirmed")
    .some((a, i, list) =>
      list.some(
        (b, j) =>
          j !== i &&
          a.staffId === b.staffId &&
          busyOf(a).start < busyOf(b).end &&
          busyOf(b).start < busyOf(a).end,
      ),
    );

describe("no double booking", () => {
  it("lets exactly one of 25 visitors take the same slot at once", async () => {
    const store = memoryStore();
    const { booked, refused, failed } = await race(
      store,
      Array.from({ length: 25 }, () => attempt("2026-11-03T10:00:00Z")),
    );
    expect(failed).toEqual([]);
    expect(booked).toHaveLength(1);
    expect(refused).toHaveLength(24);
    expect(store.rows.filter((row) => row.status === "confirmed")).toHaveLength(1);
  });

  it("never confirms two overlapping times for one person, with their buffers", async () => {
    const store = memoryStore();
    // 10:00, 10:15 … 11:00 all overlap a 60-minute booking with 15 minutes after; 11:15 does not overlap 10:00.
    const starts = ["10:00", "10:15", "10:30", "10:45", "11:00", "10:30", "10:00", "10:45"];
    const { booked, failed } = await race(
      store,
      starts.map((time) => attempt(`2026-11-03T${time}:00Z`)),
    );
    expect(failed).toEqual([]);
    expect(booked).toHaveLength(1);
    expect(overlapping(store.rows)).toBe(false);
  });

  it("books different people at the same time independently", async () => {
    const store = memoryStore();
    const { booked } = await race(store, [
      attempt("2026-11-03T10:00:00Z", ["ana"]),
      attempt("2026-11-03T10:00:00Z", ["ben"]),
    ]);
    expect(booked).toHaveLength(2);
  });

  it("gives 'anyone available' the next free person, and only as many bookings as people", async () => {
    const store = memoryStore();
    const { booked, refused } = await race(
      store,
      Array.from({ length: 6 }, () => attempt("2026-11-03T10:00:00Z", ["ana", "ben"])),
    );
    expect(booked).toHaveLength(2);
    expect(refused).toHaveLength(4);
    expect(new Set(store.rows.map((row) => row.staffId))).toEqual(new Set(["ana", "ben"]));
  });

  it("says why a start is refused: its own words for each rule, 'taken' only for a real overlap", async () => {
    const store = memoryStore({ daysOff: { ana: ["2026-11-04"] } });
    const refusal = (start: string, staffIds = ["ana"]) => {
      const input = attempt(start, staffIds);
      return reserve(store.transact, {
        ...input,
        rules: { ...input.rules, minNoticeMinutes: 120 },
      }).then(
        () => "booked",
        (error: Error) => {
          expect(error).toBeInstanceOf(SlotTakenError);
          return error.message;
        },
      );
    };
    expect(await refusal("2026-11-02T07:00:00Z")).toBe(SLOT_PASSED);
    expect(await refusal("2026-11-02T09:00:00Z")).toBe(SLOT_TOO_SOON);
    expect(await refusal("2027-02-01T10:00:00Z")).toBe(SLOT_TOO_FAR);
    expect(await refusal("2026-11-03T03:00:00Z")).toBe(SLOT_OFF_HOURS);
    expect(await refusal("2026-11-03T10:07:00Z")).toBe(SLOT_OFF_HOURS);
    expect(await refusal("2026-11-04T10:00:00Z")).toBe(SLOT_CLOSED);
    expect(await refusal("2026-11-03T10:00:00Z")).toBe("booked");
    expect(await refusal("2026-11-03T10:00:00Z")).toBe(SLOT_TAKEN);
    // Anyone available: Ana's day off is no answer when Ben works that day and is booked.
    expect(await refusal("2026-11-04T10:00:00Z", ["ben"])).toBe("booked");
    expect(await refusal("2026-11-04T10:00:00Z", ["ana", "ben"])).toBe(SLOT_TAKEN);
  });

  it("refuses a time outside working hours or already past, even when the page offered it", async () => {
    const store = memoryStore();
    await expect(reserve(store.transact, attempt("2026-11-03T17:30:00Z"))).rejects.toBeInstanceOf(
      SlotTakenError,
    );
    await expect(reserve(store.transact, attempt("2026-11-01T10:00:00Z"))).rejects.toBeInstanceOf(
      SlotTakenError,
    );
    await expect(reserve(store.transact, attempt("2026-11-03T10:07:00Z"))).rejects.toBeInstanceOf(
      SlotTakenError,
    );
    expect(store.rows).toEqual([]);
  });

  it("moves a booking atomically: one reschedule wins, and the old time is freed", async () => {
    const store = memoryStore();
    const first = await reserve(store.transact, attempt("2026-11-03T10:00:00Z"));
    // Two tabs move the same booking to different times at once; a third visitor wants 14:00.
    const { booked, failed } = await race(store, [
      attempt("2026-11-03T14:00:00Z", ["ana"], first.bookingId),
      attempt("2026-11-03T15:00:00Z", ["ana"], first.bookingId),
    ]);
    expect(booked).toHaveLength(1);
    expect(failed.map((result) => (result as PromiseRejectedResult).reason)).toEqual([
      expect.any(BookingGoneError),
    ]);
    const confirmed = store.rows.filter((row) => row.status === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(store.rows.find((row) => row.id === first.bookingId)?.status).toBe("rescheduled");
    // 10:00 is free again for someone else.
    await expect(reserve(store.transact, attempt("2026-11-03T10:00:00Z"))).resolves.toMatchObject({
      staffId: "ana",
    });
  });

  it("lets a booking move to a time overlapping its own", async () => {
    const store = memoryStore();
    const first = await reserve(store.transact, attempt("2026-11-03T10:00:00Z"));
    await expect(
      reserve(store.transact, attempt("2026-11-03T10:30:00Z", ["ana"], first.bookingId)),
    ).resolves.toBeTruthy();
    expect(
      store.rows
        .filter((row) => row.status === "confirmed")
        .map((row) => new Date(row.startsAt).toISOString()),
    ).toEqual(["2026-11-03T10:30:00.000Z"]);
  });

  describe("what each safeguard prevents (the test can fail)", () => {
    it("without the lock, overlapping times are double booked", async () => {
      const store = memoryStore({ lock: false });
      const starts = ["10:00", "10:15", "10:30", "10:45"];
      const { booked } = await race(
        store,
        starts.map((time) => attempt(`2026-11-03T${time}:00Z`)),
      );
      expect(booked.length).toBeGreaterThan(1);
      expect(overlapping(store.rows)).toBe(true);
    });

    it("without the lock, the unique index still stops two bookings of the exact same start", async () => {
      const store = memoryStore({ lock: false });
      const { booked } = await race(
        store,
        Array.from({ length: 10 }, () => attempt("2026-11-03T10:00:00Z")),
      );
      expect(booked).toHaveLength(1);
    });

    it("without either, the same start is double booked", async () => {
      const store = memoryStore({ lock: false, uniqueIndex: false });
      const { booked } = await race(
        store,
        Array.from({ length: 10 }, () => attempt("2026-11-03T10:00:00Z")),
      );
      expect(booked.length).toBeGreaterThan(1);
    });
  });
});
