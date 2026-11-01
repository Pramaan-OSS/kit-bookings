"use client";
// A customer's account (optional): sign up or sign in with lib/accounts.ts, then see the bookings made while signed
// in or saved from a manage link. The owner signs in here with their own email too, and is sent to /owner.
import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatDuration } from "../../lib/bookings/format";
import { formatDay, formatTime } from "../../lib/bookings/time";
import { api, browserZone, currentUser, messageOf, type SessionUser } from "../parts/fetch";
import { OpenDiary } from "../parts/illustrations";
import { SiteFooter, SiteHeader } from "../parts/site-header";
import { Alert, Badge, Button, Field, Skeleton } from "../ui";

type Saved = {
  id: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled" | "rescheduled";
  manageUrl: string;
};
type Mine = { user: SessionUser; business: { name: string }; bookings: Saved[] };

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [mine, setMine] = useState<Mine | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zone, setZone] = useState("UTC");

  const refresh = useCallback(async () => {
    const signedIn = await currentUser();
    setUser(signedIn);
    if (signedIn && signedIn.role !== "owner") {
      try {
        setMine(await api<Mine>("/api/me/bookings", { user: signedIn.id }));
      } catch (failure) {
        setError(messageOf(failure));
      }
    }
  }, []);

  useEffect(() => {
    setZone(browserZone());
    void refresh();
  }, [refresh]);

  async function authenticate() {
    setBusy(true);
    setError("");
    try {
      const { user: signedIn } = await api<{ user: SessionUser }>(`/api/account/${mode}`, {
        body: { email, password },
      });
      setPassword("");
      if (signedIn.role === "owner") {
        router.push("/owner");
        return;
      }
      await refresh();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await api("/api/account/signout", { body: {}, user: user?.id });
    } finally {
      setMine(null);
      setUser(null);
      setBusy(false);
    }
  }

  const now = Date.now();
  const upcoming = (mine?.bookings ?? [])
    .filter((booking) => booking.status === "confirmed" && Date.parse(booking.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const earlier = (mine?.bookings ?? []).filter((booking) => !upcoming.includes(booking));

  return (
    <>
      <SiteHeader name={mine?.business.name} />
      <main className="mx-auto w-full max-w-5xl px-5 pt-10 sm:px-8 sm:pt-14">
        {user === undefined ? (
          <Skeleton className="h-64" />
        ) : !user ? (
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <section className="space-y-5">
              <p className="eyebrow">Your bookings, together</p>
              <h1 className="font-display text-4xl leading-tight sm:text-5xl">
                Keep every appointment in one place.
              </h1>
              <p className="max-w-md text-lg text-muted">
                You never need an account to book. Make one to see your bookings here, and move or
                cancel them in a tap.
              </p>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-accent"
              >
                Book without an account <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </section>
            <section className="card space-y-6 p-8">
              <div>
                <h2 className="font-display text-2xl">
                  {mode === "signup" ? "Create your account" : "Welcome back"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {mode === "signup"
                    ? "Use the email you book with."
                    : "Sign in to see your bookings."}
                </p>
              </div>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void authenticate();
                }}
              >
                <Field
                  label="Email"
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
                <Field
                  label="Password"
                  id="account-password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "signup" ? 12 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
                {mode === "signup" && <p className="text-xs text-muted">At least 12 characters.</p>}
                {error && <Alert title={error} tone="error" />}
                <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                  {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
                </Button>
              </form>
              <p className="text-center text-sm text-muted">
                {mode === "signup" ? "Already have an account? " : "New here? "}
                <button
                  type="button"
                  className="min-h-11 font-semibold text-accent underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode(mode === "signup" ? "signin" : "signup");
                    setError("");
                  }}
                >
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </p>
            </section>
          </div>
        ) : user.role === "owner" ? (
          <section className="card max-w-xl space-y-4 p-8">
            <h1 className="font-display text-3xl">You're signed in as the owner</h1>
            <p className="text-muted">Your bookings, services and hours are in the owner area.</p>
            <Link href="/owner" className="button-primary inline-flex min-h-11 items-center">
              Open the owner area
            </Link>
          </section>
        ) : (
          <section className="space-y-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-2">
                <p className="eyebrow">{user.email}</p>
                <h1 className="font-display text-4xl sm:text-5xl">Your bookings</h1>
              </div>
              <div className="flex gap-3">
                <Link href="/" className="button-primary inline-flex min-h-11 items-center">
                  Book a time
                </Link>
                <Button onClick={() => void signOut()} disabled={busy}>
                  Sign out
                </Button>
              </div>
            </div>
            {error && <Alert title={error} tone="error" />}
            {!mine ? (
              <Skeleton className="h-40" />
            ) : mine.bookings.length === 0 ? (
              <div className="card flex max-w-xl flex-col items-start gap-3 p-8">
                <OpenDiary />
                <h2 className="font-display text-2xl">No bookings saved yet</h2>
                <p className="text-muted">
                  Bookings you make while signed in appear here. Booked before you had an account?
                  Open the link in your confirmation and choose Save to my account.
                </p>
              </div>
            ) : (
              <>
                <BookingList
                  title="Coming up"
                  bookings={upcoming}
                  zone={zone}
                  empty="Nothing coming up."
                />
                {earlier.length > 0 && (
                  <BookingList title="Earlier and cancelled" bookings={earlier} zone={zone} muted />
                )}
              </>
            )}
          </section>
        )}
      </main>
      <SiteFooter name={mine?.business.name} />
    </>
  );
}

function BookingList({
  title,
  bookings,
  zone,
  empty,
  muted = false,
}: {
  title: string;
  bookings: Saved[];
  zone: string;
  empty?: string;
  muted?: boolean;
}) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl">{title}</h2>
      {bookings.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-3">
          {bookings.map((booking) => {
            const start = Date.parse(booking.startsAt);
            return (
              <li
                key={booking.id}
                className={`card flex flex-wrap items-center gap-5 p-5! ${muted ? "opacity-75" : ""}`}
              >
                <CalendarDays aria-hidden="true" className="h-6 w-6 text-clay" />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl">{booking.serviceName}</p>
                  <p className="text-sm text-muted">
                    {formatDay(start, zone)}, {formatTime(start, zone)} ·{" "}
                    {formatDuration(Math.round((Date.parse(booking.endsAt) - start) / 60_000))} with{" "}
                    {booking.staffName}
                  </p>
                </div>
                {booking.status !== "confirmed" && (
                  <Badge>{booking.status === "cancelled" ? "Cancelled" : "Moved"}</Badge>
                )}
                <Link
                  href={booking.manageUrl}
                  className="button-secondary inline-flex min-h-11 items-center"
                >
                  {booking.status === "confirmed" && start > Date.now() ? "Manage" : "View"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
