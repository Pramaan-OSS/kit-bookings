"use client";
// Every booking, a week at a time: a ruled week calendar (each person's bookings in their colour) or a list by
// day. Times are the business's own (Settings sets its time zone). Open a booking to call, email, move or cancel.
import { ChevronLeft, ChevronRight, Mail, Phone } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { formatDuration, formatPrice } from "../../../lib/bookings/format";
import {
  addDays,
  formatDay,
  formatTime,
  type LocalDate,
  localDateOf,
  toInstant,
  zonedParts,
} from "../../../lib/bookings/time";
import { messageOf } from "../../parts/fetch";
import { EmptyWeek } from "../../parts/illustrations";
import { Alert, Badge, Button, Dialog, Skeleton } from "../../ui";
import { OwnerHeading, ownerCall, useOwner } from "../owner-shell";

type Booking = {
  id: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  priceCents: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerTimeZone: string;
  notes: string;
  status: "confirmed" | "cancelled" | "rescheduled";
  cancelledBy: string | null;
  confirmationStatus: string;
  confirmationNote: string;
  manageUrl: string | null;
};
type Week = {
  monday: LocalDate;
  timeZone: string;
  currency: string;
  staff: { id: string; name: string; color: string; active: boolean }[];
  bookings: Booking[];
};

const HOUR_PX = 56;
const ink = (color: string | undefined) =>
  ({ "--ink": `var(--staff-${color ?? "evergreen"})` }) as CSSProperties;

export default function OwnerBookings() {
  const owner = useOwner();
  const [zone, setZone] = useState<string | null>(null);
  const [monday, setMonday] = useState<LocalDate | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"week" | "list">("week");
  const [open, setOpen] = useState<Booking | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(
    async (start: LocalDate | null) => {
      setError("");
      try {
        const result = await ownerCall<Week>(
          owner,
          `/api/owner/bookings?week=${start ?? "current"}`,
        );
        setZone(result.timeZone);
        setMonday(result.monday);
        setWeek(result);
      } catch (failure) {
        setError(messageOf(failure));
      }
    },
    [owner],
  );

  useEffect(() => {
    if (window.innerWidth < 768) setView("list");
    void load(null);
  }, [load]);

  const days = useMemo(
    () => (monday ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : []),
    [monday],
  );
  const staffById = useMemo(
    () => new Map((week?.staff ?? []).map((person) => [person.id, person])),
    [week],
  );
  const confirmed = (week?.bookings ?? []).filter((booking) => booking.status === "confirmed");

  async function cancel(booking: Booking) {
    setBusy(true);
    try {
      const result = await ownerCall<{ email: { status: string; note: string } }>(
        owner,
        "/api/owner/bookings",
        {
          action: "cancel",
          id: booking.id,
        },
      );
      setNotice(
        result.email.status === "sent"
          ? `Cancelled. ${booking.customerName} has been emailed.`
          : `Cancelled. ${booking.customerName} could not be emailed (${result.email.note}) Let them know yourself.`,
      );
      setOpen(null);
      setConfirmCancel(false);
      await load(monday);
    } catch (failure) {
      setNotice(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const range =
    monday && zone
      ? `${formatDay(toInstant(monday, 720, zone) ?? Date.now(), zone)} to ${formatDay(toInstant(addDays(monday, 6), 720, zone) ?? Date.now(), zone)}`
      : "";

  return (
    <>
      <OwnerHeading eyebrow={range || "This week"} title="Bookings">
        <fieldset className="flex rounded-full border border-line bg-surface p-1">
          <legend className="sr-only">View</legend>
          {(["week", "list"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className="min-h-10 rounded-full px-4 text-sm font-semibold text-muted aria-pressed:bg-accent aria-pressed:text-accent-fg"
            >
              {option === "week" ? "Week" : "List"}
            </button>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <Button
            aria-label="Previous week"
            className="px-3!"
            disabled={!monday}
            onClick={() => monday && void load(addDays(monday, -7))}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button disabled={!monday} onClick={() => void load(null)}>
            This week
          </Button>
          <Button
            aria-label="Next week"
            className="px-3!"
            disabled={!monday}
            onClick={() => monday && void load(addDays(monday, 7))}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      </OwnerHeading>

      {notice && (
        <div className="mb-6">
          <Alert title={notice} tone="success" />
        </div>
      )}
      {error ? (
        <Alert title={error} tone="error" />
      ) : !week || !zone ? (
        <Skeleton className="h-96" />
      ) : week.bookings.length === 0 ? (
        <div className="card flex max-w-xl flex-col items-start gap-3 p-8">
          <EmptyWeek />
          <h2 className="font-display text-2xl">No bookings this week</h2>
          <p className="text-muted">
            Bookings appear here the moment they're made. Share your booking page,{" "}
            {typeof window === "undefined" ? "" : window.location.origin}/, to fill the week.
          </p>
        </div>
      ) : view === "week" ? (
        <WeekGrid
          days={days}
          zone={zone}
          bookings={confirmed}
          staffById={staffById}
          onOpen={setOpen}
        />
      ) : (
        <ListView
          days={days}
          zone={zone}
          bookings={week.bookings}
          staffById={staffById}
          onOpen={setOpen}
        />
      )}

      {week && week.staff.length > 1 && (
        <ul className="mt-6 flex flex-wrap gap-4 text-sm text-muted" aria-label="Who is who">
          {week.staff
            .filter((person) => person.active)
            .map((person) => (
              <li key={person.id} className="flex items-center gap-2" style={ink(person.color)}>
                <span className="staff-dot h-2.5 w-2.5 rounded-full" aria-hidden="true" />
                {person.name}
              </li>
            ))}
        </ul>
      )}

      <Dialog
        open={open !== null}
        onClose={() => {
          setOpen(null);
          setConfirmCancel(false);
        }}
        title={open ? open.customerName : "Booking"}
      >
        {open && zone && (
          <div className="space-y-5">
            <div
              style={ink(staffById.get(open.staffId)?.color)}
              className="staff-block rounded-lg px-4 py-3"
            >
              <p className="font-semibold">{open.serviceName}</p>
              <p className="text-sm">
                {formatDay(Date.parse(open.startsAt), zone)},{" "}
                {formatTime(Date.parse(open.startsAt), zone)} to{" "}
                {formatTime(Date.parse(open.endsAt), zone)} · {open.staffName}
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Email</dt>
              <dd>
                <a
                  className="inline-flex items-center gap-1.5 text-accent"
                  href={`mailto:${open.customerEmail}`}
                >
                  <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                  {open.customerEmail}
                </a>
              </dd>
              <dt className="text-muted">Phone</dt>
              <dd>
                <a
                  className="inline-flex items-center gap-1.5 text-accent"
                  href={`tel:${open.customerPhone.replace(/[^\d+]/gu, "")}`}
                >
                  <Phone aria-hidden="true" className="h-3.5 w-3.5" />
                  {open.customerPhone}
                </a>
              </dd>
              <dt className="text-muted">Price</dt>
              <dd>{formatPrice(open.priceCents, week?.currency ?? "USD")}, paid on the day</dd>
              <dt className="text-muted">Their zone</dt>
              <dd>{open.customerTimeZone.replaceAll("_", " ")}</dd>
              <dt className="text-muted">Confirmation</dt>
              <dd>
                {open.confirmationStatus === "sent"
                  ? "Emailed"
                  : open.confirmationNote || "Not emailed"}
              </dd>
              {open.notes && (
                <>
                  <dt className="text-muted">Notes</dt>
                  <dd className="whitespace-pre-wrap">{open.notes}</dd>
                </>
              )}
            </dl>
            {open.status !== "confirmed" ? (
              <Badge>
                {open.status === "cancelled"
                  ? `Cancelled by the ${open.cancelledBy ?? "customer"}`
                  : "Moved to a new time"}
              </Badge>
            ) : open.manageUrl ? (
              confirmCancel ? (
                <div className="space-y-3 rounded-lg bg-clay-soft p-4">
                  <p className="text-sm">
                    Cancel this booking? {open.customerName} will be emailed if email is set up.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => setConfirmCancel(false)}>Keep it</Button>
                    <Button
                      variant="primary"
                      className="bg-danger!"
                      disabled={busy}
                      onClick={() => void cancel(open)}
                    >
                      {busy ? "Cancelling…" : "Yes, cancel it"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <a
                    href={open.manageUrl}
                    className="button-secondary inline-flex min-h-11 items-center"
                  >
                    Move to another time
                  </a>
                  <Button onClick={() => setConfirmCancel(true)}>
                    <span className="text-danger">Cancel booking</span>
                  </Button>
                </div>
              )
            ) : (
              <p className="text-sm text-muted">
                This appointment has started, so it can no longer change.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

type GridProps = {
  days: LocalDate[];
  zone: string;
  bookings: Booking[];
  staffById: Map<string, { color: string }>;
  onOpen: (booking: Booking) => void;
};

function WeekGrid({ days, zone, bookings, staffById, onOpen }: GridProps) {
  const today = localDateOf(Date.now(), zone);
  const placed = bookings.map((booking) => {
    const start = zonedParts(Date.parse(booking.startsAt), zone);
    const minutes = Math.max(
      15,
      Math.round((Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000),
    );
    return {
      booking,
      day: start.date,
      from: start.minutes,
      to: Math.min(24 * 60, start.minutes + minutes),
    };
  });
  const first = Math.min(8, ...placed.map((entry) => Math.floor(entry.from / 60)));
  const last = Math.max(18, ...placed.map((entry) => Math.ceil(entry.to / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  // Bookings that overlap on a day share its column side by side: each cluster of overlaps gets lanes.
  const lanes = new Map<string, { lane: number; of: number }>();
  for (const day of days) {
    const list = placed.filter((entry) => entry.day === day).sort((a, b) => a.from - b.from);
    let cluster: typeof list = [];
    let clusterEnd = -1;
    let laneEnds: number[] = [];
    const close = () => {
      for (const entry of cluster) {
        const placedLane = lanes.get(entry.booking.id);
        if (placedLane) placedLane.of = laneEnds.length;
      }
      cluster = [];
      laneEnds = [];
      clusterEnd = -1;
    };
    for (const entry of list) {
      if (cluster.length > 0 && entry.from >= clusterEnd) close();
      let lane = laneEnds.findIndex((end) => end <= entry.from);
      if (lane === -1) lane = laneEnds.push(entry.to) - 1;
      else laneEnds[lane] = entry.to;
      lanes.set(entry.booking.id, { lane, of: 1 });
      cluster.push(entry);
      clusterEnd = Math.max(clusterEnd, entry.to);
    }
    close();
  }
  const label = (date: LocalDate) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
    }).format(new Date(`${date}T12:00:00Z`));
  return (
    <div className="card overflow-x-auto p-0!">
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line">
          <span />
          {days.map((day) => (
            <p
              key={day}
              className={`px-2 py-3 text-center text-sm font-semibold ${day === today ? "text-clay" : "text-muted"}`}
            >
              {label(day)}
            </p>
          ))}
        </div>
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div>
            {hours.map((hour) => (
              <p
                key={hour}
                className="pr-2 text-right text-xs text-muted tabular-nums"
                style={{ height: HOUR_PX }}
              >
                {String(hour).padStart(2, "0")}:00
              </p>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day}
              className={`ruled relative border-l border-line ${day === today ? "bg-accent-soft/40" : ""}`}
              style={{ height: hours.length * HOUR_PX, "--hour": `${HOUR_PX}px` } as CSSProperties}
            >
              {placed
                .filter((entry) => entry.day === day)
                .map(({ booking, from, to }) => {
                  const lane = lanes.get(booking.id) ?? { lane: 0, of: 1 };
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={() => onOpen(booking)}
                      className="staff-block absolute overflow-hidden rounded-md px-2 py-1 text-left text-xs leading-tight hover:brightness-95"
                      style={{
                        ...ink(staffById.get(booking.staffId)?.color),
                        top: ((from - first * 60) / 60) * HOUR_PX,
                        height: Math.max(22, ((to - from) / 60) * HOUR_PX - 2),
                        left: `calc(${(lane.lane / lane.of) * 100}% + 2px)`,
                        width: `calc(${100 / lane.of}% - 4px)`,
                      }}
                    >
                      {to - from < 45 ? (
                        // A short booking: its time and who, on one line.
                        <span className="block truncate">
                          <span className="font-semibold tabular-nums">
                            {formatTime(Date.parse(booking.startsAt), zone)}
                          </span>{" "}
                          {booking.customerName}
                        </span>
                      ) : (
                        <>
                          <span className="block font-semibold tabular-nums">
                            {formatTime(Date.parse(booking.startsAt), zone)}
                          </span>
                          <span className="block truncate">{booking.customerName}</span>
                          <span className="block truncate text-muted">{booking.serviceName}</span>
                        </>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListView({ days, zone, bookings, staffById, onOpen }: GridProps) {
  const byDay = days
    .map((day) => ({
      day,
      list: bookings.filter((booking) => localDateOf(Date.parse(booking.startsAt), zone) === day),
    }))
    .filter((entry) => entry.list.length > 0);
  return (
    <div className="space-y-6">
      {byDay.map(({ day, list }) => (
        <section key={day} className="space-y-2">
          <h2 className="font-display text-xl">
            {formatDay(toInstant(day, 720, zone) ?? Date.now(), zone)}
          </h2>
          <ul className="card divide-y divide-line p-0!">
            {list.map((booking) => (
              <li key={booking.id}>
                <button
                  type="button"
                  onClick={() => onOpen(booking)}
                  className="flex min-h-14 w-full flex-wrap items-center gap-4 px-5 py-3 text-left hover:bg-accent-soft/50"
                  style={ink(staffById.get(booking.staffId)?.color)}
                >
                  <span className="w-20 shrink-0 font-display text-lg tabular-nums">
                    {formatTime(Date.parse(booking.startsAt), zone)}
                  </span>
                  <span className="staff-dot h-2.5 w-2.5 rounded-full" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block font-semibold ${booking.status === "confirmed" ? "" : "line-through"}`}
                    >
                      {booking.customerName}
                    </span>
                    <span className="block text-sm text-muted">
                      {booking.serviceName} ·{" "}
                      {formatDuration(
                        Math.round(
                          (Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000,
                        ),
                      )}{" "}
                      · {booking.staffName}
                    </span>
                  </span>
                  {booking.status !== "confirmed" && (
                    <Badge>{booking.status === "cancelled" ? "Cancelled" : "Moved"}</Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
