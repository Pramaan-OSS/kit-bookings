"use client";
// The owner's day: what's booked today, what's next, what is left to set up, and whether email and reminders
// can run on this platform.
import { BellRing, Check, Circle, Copy, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDay, formatTime, zonedParts } from "../../lib/bookings/time";
import { messageOf } from "../parts/fetch";
import { EmptyWeek } from "../parts/illustrations";
import { Alert, Skeleton } from "../ui";
import { OwnerHeading, ownerCall, useOwner } from "./owner-shell";

type Row = {
  id: string;
  startsAt: string;
  customerName: string;
  serviceName: string;
  staffName: string;
  status: string;
  createdAt: string;
};
type Overview = {
  business: { name: string; timeZone: string; remindersLastRunAt: string | null };
  today: Row[];
  nextSevenDays: number;
  latest: Row[];
  setup: {
    ownerEmail: string | null;
    named: boolean;
    timeZoneChosen: boolean;
    services: number;
    staffRenamed: boolean;
    hours: boolean;
  };
  modules: { door: boolean; schedules: boolean };
};

export default function OwnerToday() {
  const owner = useOwner();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    ownerCall<Overview>(owner, "/api/owner/overview").then(setData, (failure) =>
      setError(messageOf(failure)),
    );
  }, [owner]);

  if (error) return <Alert title={error} tone="error" />;
  if (!data)
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );

  const zone = data.business.timeZone;
  const hour = Math.floor(zonedParts(Date.now(), zone).minutes / 60);
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const steps = [
    {
      done: data.setup.ownerEmail !== null,
      label: "Choose the email and password you sign in with",
      href: "/owner/settings#sign-in",
    },
    {
      done: data.setup.named && data.setup.timeZoneChosen,
      label: "Name your business and set its time zone",
      href: "/owner/settings",
    },
    {
      done: data.setup.services > 0,
      label: "Add the services people can book",
      href: "/owner/services",
    },
    {
      done: data.setup.staffRenamed,
      label: "Rename “Our team” to your own name, or add your team",
      href: "/owner/staff",
    },
    { done: data.setup.hours, label: "Set your weekly hours and days off", href: "/owner/hours" },
  ];
  const left = steps.filter((step) => !step.done).length;
  const bookingPage = typeof window === "undefined" ? "/" : `${window.location.origin}/`;

  return (
    <>
      <OwnerHeading eyebrow={formatDay(Date.now(), zone)} title={greeting} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Today"
          value={data.today.length}
          note={data.today.length === 1 ? "appointment" : "appointments"}
        />
        <Stat label="Next 7 days" value={data.nextSevenDays} note="booked" />
        <div className="card flex flex-col justify-between gap-3">
          <p className="text-sm font-semibold text-muted">Your booking page</p>
          <p className="truncate font-mono text-sm">{bookingPage}</p>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-accent"
            onClick={() =>
              void navigator.clipboard?.writeText(bookingPage).then(() => setCopied(true))
            }
          >
            <Copy aria-hidden="true" className="h-4 w-4" />
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {left > 0 && (
        <section className="card mt-8 space-y-4" aria-labelledby="setup-title">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="setup-title" className="font-display text-2xl">
              Finish setting up
            </h2>
            <p className="text-sm text-muted">
              {steps.length - left} of {steps.length} done
            </p>
          </div>
          <ul className="divide-y divide-line">
            {steps.map((step) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="flex min-h-12 items-center gap-3 py-2 hover:text-accent"
                >
                  {step.done ? (
                    <Check aria-hidden="true" className="h-5 w-5 text-accent" />
                  ) : (
                    <Circle aria-hidden="true" className="h-5 w-5 text-clay" />
                  )}
                  <span className={step.done ? "text-muted line-through" : "font-semibold"}>
                    {step.label}
                  </span>
                  <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="today-title" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="today-title" className="font-display text-2xl">
              Today's appointments
            </h2>
            <Link href="/owner/bookings" className="text-sm font-semibold text-accent">
              All bookings
            </Link>
          </div>
          {data.today.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-6">
              <EmptyWeek />
              <p className="font-display text-xl">Nothing booked today</p>
              <p className="text-sm text-muted">
                Share your booking page so people can find a time.
              </p>
            </div>
          ) : (
            <ol className="card divide-y divide-line p-0!">
              {data.today.map((row) => (
                <li key={row.id} className="flex items-center gap-4 px-5 py-4">
                  <span className="w-20 shrink-0 font-display text-xl tabular-nums">
                    {formatTime(Date.parse(row.startsAt), zone)}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{row.customerName}</span>
                    <span className="block text-sm text-muted">
                      {row.serviceName} · {row.staffName}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card space-y-3" aria-labelledby="latest-title">
            <h2 id="latest-title" className="font-display text-xl">
              Latest bookings
            </h2>
            {data.latest.length === 0 ? (
              <p className="text-sm text-muted">New bookings appear here as they come in.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.latest.map((row) => (
                  <li key={row.id}>
                    <span className="font-semibold">{row.customerName}</span>
                    <span className="block text-muted">
                      {row.serviceName}, {formatDay(Date.parse(row.startsAt), zone)}{" "}
                      {formatTime(Date.parse(row.startsAt), zone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card space-y-4 text-sm" aria-labelledby="platform-title">
            <h2 id="platform-title" className="font-display text-xl">
              Email and reminders
            </h2>
            <p className="flex gap-3">
              <Mail aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>
                {data.modules.door
                  ? "Confirmations go out through the platform's email once a sender is set up. Each booking shows whether its email went."
                  : "Email is off on this platform, so confirmations aren't sent yet. Booking still works, and visitors are told to keep their link."}
              </span>
            </p>
            <p className="flex gap-3">
              <BellRing aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>
                {data.modules.schedules
                  ? `Reminders run every 15 minutes.${data.business.remindersLastRunAt ? ` Last run ${formatTime(Date.parse(data.business.remindersLastRunAt), zone)}.` : ""}`
                  : "Reminders start once the app is live with scheduled jobs switched on."}
              </span>
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="card">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-2 font-display text-5xl leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}
