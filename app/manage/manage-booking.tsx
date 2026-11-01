"use client";
// A booking's own page: the confirmation right after booking, and where its link leads later to move or cancel.
import { CalendarPlus, Check, Copy, MapPin, Repeat, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatDuration, formatPrice } from "../../lib/bookings/format";
import { formatDay, formatTime, formatWhen, zonedParts, zoneLabel } from "../../lib/bookings/time";
import { api, browserZone, currentUser, messageOf, type SessionUser } from "../parts/fetch";
import { TicketStub } from "../parts/illustrations";
import { SiteFooter, SiteHeader } from "../parts/site-header";
import { SlotPicker } from "../parts/slot-picker";
import { Alert, Button, Dialog, Skeleton } from "../ui";

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
  customerTimeZone: string;
  status: "confirmed" | "cancelled" | "rescheduled";
  cancelledBy: "customer" | "owner" | null;
  confirmationStatus: string;
  confirmationNote: string;
  saved: boolean;
  canChange: boolean;
  showStaff: boolean;
  business: {
    name: string;
    address: string;
    timeZone: string;
    currency: string;
    maxDaysAhead: number;
  };
};
type Opened = { booking: Booking; movedTo: { startsAt: string; staffName: string } | null };

export function ManageBooking({
  token,
  fresh,
  moved,
}: {
  token: string;
  fresh: boolean;
  moved: boolean;
}) {
  const router = useRouter();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [missing, setMissing] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [zone, setZone] = useState("UTC");
  const [moving, setMoving] = useState(false);
  const [newStart, setNewStart] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setMissing("This page opens a booking from the link in its confirmation.");
      return null;
    }
    try {
      const result = await api<Opened>(`/api/booking/manage?token=${encodeURIComponent(token)}`);
      setOpened(result);
      return result;
    } catch (failure) {
      setMissing(messageOf(failure));
      return null;
    }
  }, [token]);

  useEffect(() => {
    setZone(browserZone());
    void currentUser().then(setUser);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await load();
      // The confirmation email is sent in the background of the booking: look again while it is on its way.
      if (result?.booking.confirmationStatus === "pending" && tries++ < 3)
        timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => clearTimeout(timer);
  }, [load]);

  async function change(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      return await api<{ token?: string; cancelled?: boolean; saved?: boolean }>(
        "/api/booking/manage",
        {
          body: { token, ...body },
          user: user?.id,
        },
      );
    } catch (failure) {
      setError(messageOf(failure));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const booking = opened?.booking;
  const start = booking ? Date.parse(booking.startsAt) : 0;
  const end = booking ? Date.parse(booking.endsAt) : 0;
  const past = booking ? start <= Date.now() : false;
  const heading = !booking
    ? ""
    : booking.status === "cancelled"
      ? "Booking cancelled"
      : booking.status === "rescheduled"
        ? "This booking has moved"
        : past
          ? "This appointment has passed"
          : moved
            ? "Booking moved"
            : fresh
              ? "You're booked"
              : "Your booking";

  return (
    <>
      <SiteHeader name={booking?.business.name} />
      <main className="mx-auto w-full max-w-3xl px-5 pt-10 sm:px-8 sm:pt-14">
        {missing ? (
          <section className="card flex flex-col items-start gap-4 p-8">
            <TicketStub />
            <h1 className="font-display text-3xl">We couldn't open this booking</h1>
            <p className="text-muted">{missing}</p>
            <p className="text-sm text-muted">
              Check you opened the whole link from your confirmation email. Signed-in customers find
              their bookings under My bookings.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className="button-primary inline-flex min-h-11 items-center">
                Book a time
              </Link>
              <Link href="/account" className="button-secondary inline-flex min-h-11 items-center">
                My bookings
              </Link>
            </div>
          </section>
        ) : !booking ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-80" />
          </div>
        ) : (
          <div className="space-y-8">
            <header className="space-y-3">
              <p className="eyebrow">{booking.business.name}</p>
              <h1 className="flex items-center gap-3 font-display text-4xl sm:text-5xl">
                {booking.status === "confirmed" && !past && (fresh || moved) && (
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                    <Check aria-hidden="true" className="h-6 w-6" />
                  </span>
                )}
                {heading}
              </h1>
              {booking.status === "confirmed" && !past && <EmailNote booking={booking} />}
              {booking.status === "cancelled" && (
                <p className="text-muted">
                  {booking.cancelledBy === "owner"
                    ? `${booking.business.name} cancelled this booking. We're sorry for the change of plan.`
                    : "Your time has been freed for someone else. Nothing more to do."}
                </p>
              )}
              {booking.status === "rescheduled" && opened?.movedTo && (
                <p className="text-muted">
                  It now takes place on {formatWhen(Date.parse(opened.movedTo.startsAt), zone)}. Use
                  the link from your newest confirmation to change it again.
                </p>
              )}
            </header>

            <article
              className={`ticket overflow-hidden ${booking.status === "confirmed" ? "" : "opacity-70"}`}
              aria-label="Booking details"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 p-6 sm:p-8">
                <div className="space-y-1">
                  <p
                    className={`font-display text-2xl ${booking.status === "confirmed" ? "" : "line-through"}`}
                  >
                    {booking.serviceName}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDuration(Math.round((end - start) / 60_000))}
                    {booking.showStaff ? ` with ${booking.staffName}` : ""}
                  </p>
                </div>
                <p className="rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">
                  {booking.priceCents === null
                    ? "Free"
                    : `${formatPrice(booking.priceCents, booking.business.currency)} on the day`}
                </p>
              </div>
              <div className="ticket-tear" />
              <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
                <div className="flex h-28 w-28 flex-col items-center justify-center rounded-2xl border border-line bg-bg">
                  <span className="text-xs font-bold tracking-[0.14em] text-clay uppercase">
                    {new Intl.DateTimeFormat(undefined, {
                      timeZone: zone,
                      weekday: "short",
                    }).format(start)}
                  </span>
                  <span className="font-display text-5xl leading-none">
                    {Number(zonedParts(start, zone).date.slice(8))}
                  </span>
                  <span className="text-sm text-muted">
                    {new Intl.DateTimeFormat(undefined, { timeZone: zone, month: "long" }).format(
                      start,
                    )}
                  </span>
                </div>
                <div className="space-y-2">
                  <p className="font-display text-3xl tabular-nums">
                    {formatTime(start, zone)} – {formatTime(end, zone)}
                  </p>
                  <p className="font-semibold">{formatDay(start, zone)}</p>
                  <p className="text-xs text-muted">
                    In your time zone, {zone.replaceAll("_", " ")} ({zoneLabel(start, zone)})
                    {booking.business.timeZone !== zone &&
                      `. ${formatTime(start, booking.business.timeZone)} at ${booking.business.name}.`}
                  </p>
                  {booking.business.address && (
                    <p className="flex items-center gap-2 text-sm">
                      <MapPin aria-hidden="true" className="h-4 w-4 text-clay" />
                      {booking.business.address}
                    </p>
                  )}
                </div>
              </div>
            </article>

            {error && <Alert title={error} tone="error" />}

            {booking.canChange && !moving && (
              <div className="flex flex-wrap gap-3">
                <a
                  href={`/api/booking/calendar?token=${encodeURIComponent(token)}`}
                  className="button-secondary inline-flex min-h-11 items-center gap-2"
                >
                  <CalendarPlus aria-hidden="true" className="h-4 w-4" />
                  Add to calendar
                </a>
                <Button onClick={() => setMoving(true)} disabled={busy}>
                  <span className="inline-flex items-center gap-2">
                    <Repeat aria-hidden="true" className="h-4 w-4" />
                    Move to another time
                  </span>
                </Button>
                <Button onClick={() => setCancelling(true)} disabled={busy}>
                  <span className="inline-flex items-center gap-2 text-danger">
                    <X aria-hidden="true" className="h-4 w-4" />
                    Cancel booking
                  </span>
                </Button>
              </div>
            )}

            {moving && booking.canChange && (
              <section className="card space-y-5 p-6 sm:p-8" aria-labelledby="move-title">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="move-title" className="font-display text-2xl">
                      Pick a new time
                    </h2>
                    <p className="text-sm text-muted">
                      Same service{booking.showStaff ? `, with ${booking.staffName}` : ""}. Your
                      current time stays yours until you move.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setMoving(false);
                      setNewStart(null);
                    }}
                  >
                    Keep my time
                  </Button>
                </div>
                <SlotPicker
                  serviceId={null}
                  staffChoice={booking.staffId}
                  token={token}
                  zone={zone}
                  onZoneChange={setZone}
                  maxDaysAhead={booking.business.maxDaysAhead}
                  selected={newStart}
                  onSelect={setNewStart}
                />
                {newStart && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft p-4">
                    <p className="font-semibold">
                      Move to {formatWhen(Date.parse(newStart), zone)}
                    </p>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void change({ action: "move", startsAt: newStart, timeZone: zone }).then(
                          (result) => {
                            if (result?.token)
                              router.replace(
                                `/manage?token=${encodeURIComponent(result.token)}&moved=1`,
                              );
                            else setNewStart(null);
                          },
                        )
                      }
                    >
                      {busy ? "Moving…" : "Move my booking"}
                    </Button>
                  </div>
                )}
              </section>
            )}

            <section className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6 text-sm">
              {booking.status === "confirmed" && (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(window.location.href.replace(/&(new|moved)=1/u, ""))
                      .then(() => setCopied(true));
                  }}
                >
                  <Copy aria-hidden="true" className="h-4 w-4" />
                  {copied ? "Link copied" : "Copy this page's link"}
                </button>
              )}
              {user && user.role !== "owner" ? (
                booking.saved ? (
                  <span className="text-muted">Saved to your account.</span>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void change({ action: "save" }).then((result) => {
                        if (result?.saved) void load();
                      })
                    }
                  >
                    Save to my account
                  </Button>
                )
              ) : !user ? (
                <span className="text-muted">
                  Keep your bookings in one place:{" "}
                  <Link
                    href="/account"
                    className="font-semibold text-accent underline-offset-4 hover:underline"
                  >
                    make an account
                  </Link>
                  , then open this link again.
                </span>
              ) : (
                <Link
                  href="/owner/bookings"
                  className="font-semibold text-accent underline-offset-4 hover:underline"
                >
                  Back to bookings
                </Link>
              )}
              <Link href="/" className="text-muted underline-offset-4 hover:underline">
                Book another time
              </Link>
            </section>
          </div>
        )}
      </main>
      <SiteFooter name={booking?.business.name} />
      <Dialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel this booking?">
        <p className="text-muted">
          {booking ? `${booking.serviceName}, ${formatWhen(start, zone)}.` : ""} The time will be
          offered to someone else.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button onClick={() => setCancelling(false)}>Keep it</Button>
          <Button
            variant="primary"
            className="bg-danger!"
            disabled={busy}
            onClick={() =>
              void change({ action: "cancel" }).then(async (result) => {
                setCancelling(false);
                if (result?.cancelled) await load();
              })
            }
          >
            {busy ? "Cancelling…" : "Yes, cancel it"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function EmailNote({ booking }: { booking: Booking }) {
  const to = booking.customerEmail;
  const text =
    booking.confirmationStatus === "sent"
      ? `A confirmation is on its way to ${to}, with this page's link.`
      : booking.confirmationStatus === "pending"
        ? `Sending your confirmation to ${to}…`
        : booking.confirmationStatus === "unknown"
          ? `Your confirmation may have reached ${to}. If it doesn't arrive, everything is on this page.`
          : `We couldn't email your confirmation: ${booking.confirmationNote || "email is not set up yet."} Keep this page's link: it's how you move or cancel.`;
  return (
    <p
      className={
        booking.confirmationStatus === "not-sent"
          ? "rounded-lg bg-clay-soft px-4 py-3 text-sm"
          : "text-muted"
      }
    >
      {text}
    </p>
  );
}
