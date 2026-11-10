"use client";
// A staff member's own day: the time, the service and the customer's name of each booking, in the business's time
// zone. The server sends nothing more (lib/bookings/staff.ts).
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDay, formatTime } from "../../lib/bookings/time";
import { api, messageOf } from "../parts/fetch";
import { SiteFooter, SiteHeader } from "../parts/site-header";
import { Alert, Button, Skeleton } from "../ui";

type Entry = { startsAt: string; endsAt: string; serviceName: string; customerName: string };
type Day = {
  name: string;
  day: string;
  previous: string;
  next: string;
  timeZone: string;
  bookings: Entry[];
};

export function StaffDay({ memberId }: { memberId: string }) {
  const [asked, setAsked] = useState<string | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    const query = asked ? `?${new URLSearchParams({ day: asked })}` : "";
    api<Day>(`/api/staff/day${query}`, { user: memberId }).then(setDay, (failure) =>
      setError(messageOf(failure)),
    );
  }, [asked, memberId]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl space-y-8 px-5 pt-10 sm:px-8 sm:pt-14">
        <div className="space-y-2">
          {day && <p className="eyebrow">{day.name}</p>}
          <h1 className="font-display text-4xl sm:text-5xl">Your day</h1>
        </div>
        {error ? (
          <Alert title={error} tone="error" />
        ) : !day ? (
          <Skeleton className="h-40" />
        ) : (
          <section className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl">
                {formatDay(Date.parse(`${day.day}T12:00:00Z`), "UTC")}
              </h2>
              <div className="flex gap-2">
                <Button onClick={() => setAsked(day.previous)}>Previous day</Button>
                <Button onClick={() => setAsked(null)}>Today</Button>
                <Button onClick={() => setAsked(day.next)}>Next day</Button>
              </div>
            </div>
            {day.bookings.length === 0 ? (
              <p className="text-muted">No bookings with you on this day.</p>
            ) : (
              <ul className="grid gap-3">
                {day.bookings.map((booking) => (
                  <li key={booking.startsAt} className="card flex items-center gap-5 p-5!">
                    <CalendarDays aria-hidden="true" className="h-6 w-6 text-clay" />
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-xl">
                        {formatTime(Date.parse(booking.startsAt), day.timeZone)} to{" "}
                        {formatTime(Date.parse(booking.endsAt), day.timeZone)}
                      </p>
                      <p className="text-sm text-muted">
                        {booking.serviceName} with {booking.customerName}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted">Times are in the business's time zone.</p>
          </section>
        )}
        <Link
          href="/account"
          className="inline-flex min-h-11 items-center font-semibold text-accent"
        >
          Back to your account
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
