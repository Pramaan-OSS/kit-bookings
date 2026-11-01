"use client";
// The booking page: choose a service, then who (when more than one person offers it), then a free time in the
// visitor's own time zone, then name, email and phone. The server checks the slot again inside a lock when the
// booking is made (lib/bookings/reserve.ts), so two people can never take one time.
import { Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { formatDuration, formatPrice } from "../lib/bookings/format";
import { formatDay, formatTime, zoneLabel } from "../lib/bookings/time";
import { api, browserZone, currentUser, messageOf, type SessionUser } from "./parts/fetch";
import { OpenDiary } from "./parts/illustrations";
import { SiteFooter, SiteHeader } from "./parts/site-header";
import { SlotPicker } from "./parts/slot-picker";
import { Alert, Button, Field, Skeleton, Textarea } from "./ui";

type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number | null;
  staffIds: string[];
};
type Person = { id: string; name: string; title: string; color: string };
type Catalog = {
  business: {
    name: string;
    tagline: string;
    address: string;
    timeZone: string;
    currency: string;
    maxDaysAhead: number;
  };
  services: Service[];
  staff: Person[];
};

export default function BookingPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [zone, setZone] = useState("UTC");
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffChoice, setStaffChoice] = useState<string | null>(null);
  const [holdToken, setHoldToken] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setZone(browserZone());
    api<Catalog>("/api/booking/catalog").then(setCatalog, (failure) =>
      setLoadError(messageOf(failure)),
    );
    void currentUser().then((signedIn) => {
      setUser(signedIn);
      if (signedIn?.email && signedIn.role !== "owner")
        setEmail((typed) => typed || (signedIn.email ?? ""));
    });
  }, []);

  const service = catalog?.services.find((entry) => entry.id === serviceId) ?? null;
  const offering = service
    ? (catalog?.staff ?? []).filter((person) => service.staffIds.includes(person.id))
    : [];
  const chooseWho = offering.length > 1;
  const person = offering.find((entry) => entry.id === staffChoice) ?? null;
  const step = !service ? 1 : !staffChoice ? 2 : !start ? 3 : 4;

  function releaseCurrentHold() {
    if (holdToken)
      void api("/api/booking/hold", { method: "DELETE", body: { holdToken } }).catch(() => {});
    setHoldToken(null);
  }
  function pickService(next: Service) {
    releaseCurrentHold();
    setServiceId(next.id);
    setStart(null);
    const people = (catalog?.staff ?? []).filter((entry) => next.staffIds.includes(entry.id));
    setStaffChoice(people.length === 1 ? (people[0]?.id ?? null) : null);
  }

  async function confirm() {
    if (!service || !staffChoice || !start) return;
    setBusy(true);
    setError("");
    try {
      const { token } = await api<{ token: string }>("/api/booking/book", {
        body: {
          serviceId: service.id,
          staffId: staffChoice,
          startsAt: start,
          name,
          email,
          phone,
          notes,
          timeZone: zone,
          holdToken,
        },
        user: user?.id,
      });
      router.push(`/manage?token=${encodeURIComponent(token)}&new=1`);
    } catch (failure) {
      setError(messageOf(failure));
      // The time was taken while they typed: send them back to pick another.
      if ((failure as { status?: number }).status === 409) setStart(null);
      setBusy(false);
    }
  }

  const business = catalog?.business;
  return (
    <>
      <SiteHeader name={business?.name} />
      <main className="mx-auto w-full max-w-6xl px-5 pt-10 pb-6 sm:px-8 sm:pt-14">
        <section className="mb-10 max-w-2xl space-y-4">
          <p className="eyebrow">Book an appointment</p>
          {business ? (
            <h1 className="font-display text-4xl leading-[1.08] sm:text-6xl">{business.name}</h1>
          ) : (
            <Skeleton label="Loading" className="h-14 w-72" />
          )}
          {business?.tagline && <p className="text-lg text-muted">{business.tagline}</p>}
          {business?.address && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <MapPin aria-hidden="true" className="h-4 w-4 text-clay" />
              {business.address}
            </p>
          )}
        </section>

        {loadError ? (
          <Alert title="The diary couldn't be opened just now." tone="error">
            {loadError}
          </Alert>
        ) : !catalog ? (
          <div className="grid gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : catalog.services.length === 0 ? (
          <section className="card flex max-w-xl flex-col items-start gap-4 p-8">
            <OpenDiary />
            <h2 className="font-display text-2xl">Bookings open soon</h2>
            <p className="text-muted">
              We're getting the diary ready. Please check back shortly, or get in touch with us
              directly.
            </p>
            {user?.role === "owner" && (
              <Link
                href="/owner/services"
                className="button-primary inline-flex min-h-11 items-center"
              >
                Add your first service
              </Link>
            )}
          </section>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <ol className="step-rail space-y-10">
              <li>
                <span className="step-number" data-state={step === 1 ? "current" : "done"}>
                  1
                </span>
                <StepTitle title="Choose a service" />
                {service ? (
                  <Chosen
                    label="Change service"
                    onChange={() => {
                      setServiceId(null);
                      setStaffChoice(null);
                      setStart(null);
                    }}
                  >
                    {service.name} · {formatDuration(service.durationMinutes)} ·{" "}
                    {formatPrice(service.priceCents, catalog.business.currency)}
                  </Chosen>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {catalog.services.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        aria-labelledby={`service-${entry.id}`}
                        aria-describedby={`service-${entry.id}-about`}
                        disabled={busy}
                        onClick={() => pickService(entry)}
                        className="card group flex items-start justify-between gap-4 p-5! text-left transition-colors hover:border-accent"
                      >
                        <span className="space-y-1">
                          <span id={`service-${entry.id}`} className="block font-display text-xl">
                            {entry.name}
                          </span>
                          <span
                            id={`service-${entry.id}-about`}
                            className="block text-sm text-muted"
                          >
                            {entry.description && (
                              <span className="block">{entry.description}</span>
                            )}
                            <span className="mt-1 inline-flex items-center gap-1.5">
                              <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                              {formatDuration(entry.durationMinutes)}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">
                          {formatPrice(entry.priceCents, catalog.business.currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </li>

              {service && chooseWho && (
                <li>
                  <span className="step-number" data-state={step === 2 ? "current" : "done"}>
                    2
                  </span>
                  <StepTitle title="Choose who" />
                  {staffChoice ? (
                    <Chosen
                      label="Change who"
                      onChange={() => {
                        setStaffChoice(null);
                        setStart(null);
                      }}
                    >
                      {person ? person.name : "Anyone available"}
                    </Chosen>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setStaffChoice("any")}
                        className="card flex min-h-20 flex-col items-start justify-center p-5! text-left hover:border-accent"
                      >
                        <span className="font-semibold">Anyone available</span>
                        <span className="text-sm text-muted">The most free times</span>
                      </button>
                      {offering.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          aria-label={entry.name}
                          onClick={() => setStaffChoice(entry.id)}
                          className="card flex min-h-20 items-center gap-3 p-5! text-left hover:border-accent"
                          style={{ "--ink": `var(--staff-${entry.color})` } as CSSProperties}
                        >
                          <span
                            className="staff-dot h-3 w-3 shrink-0 rounded-full"
                            aria-hidden="true"
                          />
                          <span>
                            <span className="block font-semibold">{entry.name}</span>
                            {entry.title && (
                              <span className="block text-sm text-muted">{entry.title}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )}

              {service && staffChoice && (
                <li>
                  <span className="step-number" data-state={step === 3 ? "current" : "done"}>
                    {chooseWho ? 3 : 2}
                  </span>
                  <StepTitle title="Choose a time" />
                  {start ? (
                    <Chosen label="Change time" onChange={() => setStart(null)}>
                      {formatDay(Date.parse(start), zone)}, {formatTime(Date.parse(start), zone)}
                    </Chosen>
                  ) : (
                    <fieldset className="mt-4" disabled={busy}>
                      <SlotPicker
                        serviceId={service.id}
                        staffChoice={staffChoice}
                        zone={zone}
                        onZoneChange={setZone}
                        maxDaysAhead={catalog.business.maxDaysAhead}
                        selected={start}
                        onSelect={(next) => {
                          if (!next) {
                            setStart(null);
                            releaseCurrentHold();
                            return;
                          }
                          setBusy(true);
                          setError("");
                          api<{ holdToken: string; staffId: string }>("/api/booking/hold", {
                            body: {
                              serviceId: service.id,
                              staffId: staffChoice,
                              startsAt: next,
                              timeZone: zone,
                              holdToken,
                            },
                          })
                            .then(
                              (held) => {
                                setHoldToken(held.holdToken);
                                setStaffChoice(held.staffId);
                                setStart(next);
                              },
                              (failure) => setError(messageOf(failure)),
                            )
                            .finally(() => setBusy(false));
                        }}
                      />
                    </fieldset>
                  )}
                </li>
              )}

              {service && staffChoice && start && (
                <li>
                  <span className="step-number" data-state="current">
                    {chooseWho ? 4 : 3}
                  </span>
                  <StepTitle title="Your details" />
                  <p className="mt-3 text-sm text-muted">
                    This time is held for five minutes while you fill in your details.
                  </p>
                  <form
                    className="mt-4 grid max-w-xl gap-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void confirm();
                    }}
                  >
                    <Field
                      label="Your name"
                      id="booking-name"
                      autoComplete="name"
                      required
                      maxLength={120}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={busy}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Email"
                        id="booking-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        disabled={busy}
                      />
                      <Field
                        label="Phone"
                        id="booking-phone"
                        type="tel"
                        autoComplete="tel"
                        required
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        disabled={busy}
                      />
                    </div>
                    <Textarea
                      label="Anything we should know? (optional)"
                      id="booking-notes"
                      maxLength={1000}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      disabled={busy}
                    />
                    {error && <Alert title={error} tone="error" />}
                    <div className="flex flex-wrap items-center gap-4">
                      <Button type="submit" variant="primary" disabled={busy}>
                        {busy ? "Booking…" : "Confirm booking"}
                      </Button>
                      <p className="text-sm text-muted">
                        You'll get a link to change or cancel. No payment is taken.
                      </p>
                    </div>
                  </form>
                </li>
              )}
            </ol>

            <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Your appointment">
              <div className="ticket overflow-hidden">
                <div className="space-y-1 p-6">
                  <p className="eyebrow">Your appointment</p>
                  <p className="font-display text-2xl">
                    {service ? service.name : "Nothing chosen yet"}
                  </p>
                  {service && (
                    <p className="text-sm text-muted">
                      {formatDuration(service.durationMinutes)} ·{" "}
                      {formatPrice(service.priceCents, catalog.business.currency)}
                      {chooseWho && staffChoice
                        ? ` · ${person ? person.name : "Anyone available"}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="ticket-tear" />
                <div className="p-6">
                  {start ? (
                    <>
                      <p className="font-display text-4xl tabular-nums">
                        {formatTime(Date.parse(start), zone)}
                      </p>
                      <p className="mt-1 font-semibold">{formatDay(Date.parse(start), zone)}</p>
                      <p className="mt-3 text-xs text-muted">
                        Your time, {zone.replaceAll("_", " ")} ({zoneLabel(Date.parse(start), zone)}
                        )
                        {catalog.business.timeZone !== zone &&
                          `. That's ${formatTime(Date.parse(start), catalog.business.timeZone)} at our end.`}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted">
                      Pick a time and it will appear here, in your own time zone.
                    </p>
                  )}
                </div>
              </div>
              {user && user.role !== "owner" && (
                <p className="mt-4 text-sm text-muted">
                  Signed in as {user.email}. This booking will be saved to{" "}
                  <Link href="/account" className="text-accent underline-offset-4 hover:underline">
                    your bookings
                  </Link>
                  .
                </p>
              )}
            </aside>
          </div>
        )}
      </main>
      <SiteFooter name={business?.name} />
    </>
  );
}

function StepTitle({ title }: { title: string }) {
  return <h2 className="font-display text-2xl leading-9">{title}</h2>;
}

function Chosen({
  children,
  label,
  onChange,
}: {
  children: ReactNode;
  label: string;
  onChange: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/70 px-4 py-3">
      <p className="font-semibold">{children}</p>
      <Button aria-label={label} onClick={onChange} className="min-h-11 px-4! py-1.5!">
        Change
      </Button>
    </div>
  );
}
