"use client";
// The business (name, time zone, currency), the booking rules (notice, window, start times), reminders, and the
// owner's own sign-in, which lib/accounts.ts's "owner" action saves.
import { type FormEvent, useEffect, useState } from "react";
import { timeZones } from "../../../lib/bookings/time";
import { browserZone, messageOf } from "../../parts/fetch";
import { Alert, Button, Field, Select, Skeleton, Switch } from "../../ui";
import { OwnerHeading, ownerCall, useOwner } from "../owner-shell";

type Business = {
  name: string;
  tagline: string;
  address: string;
  timeZone: string;
  currency: string;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  slotStepMinutes: number;
  reminderHoursBefore: number;
  notifyOwner: boolean;
};
type Loaded = {
  business: Business;
  siteName: string;
  owner: { email: string | null };
  modules: { door: boolean; schedules: boolean };
};

export default function OwnerSettings() {
  const owner = useOwner();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInNotice, setSignInNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(owner.email);
  const [zone, setZone] = useState("UTC");

  useEffect(() => {
    setZone(browserZone());
    ownerCall<Loaded>(owner, "/api/owner/settings").then(
      (result) => {
        setLoaded(result);
        const b = result.business;
        setForm({
          name: b.name,
          tagline: b.tagline,
          address: b.address,
          timeZone: b.timeZone,
          currency: b.currency,
          noticeHours: String(Math.round((b.minNoticeMinutes / 60) * 100) / 100),
          maxDaysAhead: String(b.maxDaysAhead),
          slotStepMinutes: String(b.slotStepMinutes),
          reminderHoursBefore: String(b.reminderHoursBefore),
          notifyOwner: b.notifyOwner,
        });
      },
      (failure) => setNotice({ tone: "error", text: messageOf(failure) }),
    );
  }, [owner]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await ownerCall(owner, "/api/owner/settings", {
        business: {
          ...form,
          minNoticeMinutes: Math.round(Number(form.noticeHours) * 60),
          slotStepMinutes: Number(form.slotStepMinutes),
        },
      });
      setNotice({ tone: "success", text: "Settings saved." });
    } catch (failure) {
      setNotice({ tone: "error", text: messageOf(failure) });
    } finally {
      setBusy(false);
    }
  }

  async function saveSignIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSignInNotice(null);
    try {
      const { user } = await ownerCall<{ user: { email: string } }>(owner, "/api/account/owner", {
        email,
        password,
      });
      setOwnerEmail(user.email);
      setPassword("");
      setSignInNotice({
        tone: "success",
        text: "Saved. You can now sign in with this email and password.",
      });
    } catch (failure) {
      setSignInNotice({ tone: "error", text: messageOf(failure) });
    } finally {
      setBusy(false);
    }
  }

  const text = (key: string) => ({
    value: String(form[key] ?? ""),
    onChange: (event: { target: { value: string } }) =>
      setForm((old) => ({ ...old, [key]: event.target.value })),
    disabled: busy,
  });

  if (!loaded)
    return notice ? <Alert title={notice.text} tone="error" /> : <Skeleton className="h-96" />;
  return (
    <>
      <OwnerHeading eyebrow="Your business" title="Settings" />
      <form className="space-y-8" onSubmit={(event) => void save(event)}>
        <section className="card grid gap-4" aria-labelledby="business-title">
          <h2 id="business-title" className="font-display text-2xl">
            The business
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Business name"
              id="business-name"
              maxLength={80}
              placeholder={loaded.siteName}
              {...text("name")}
            />
            <Field
              label="Address"
              id="business-address"
              maxLength={200}
              placeholder="12 High Street, or Online"
              {...text("address")}
            />
          </div>
          <Field label="Welcome line" id="business-tagline" maxLength={160} {...text("tagline")} />
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="grid gap-2">
              <Select label="Time zone" id="business-zone" {...text("timeZone")}>
                {timeZones().map((name) => (
                  <option key={name} value={name}>
                    {name.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
              {form.timeZone !== zone && (
                <button
                  type="button"
                  className="min-h-11 self-start text-sm font-semibold text-accent"
                  onClick={() => setForm((old) => ({ ...old, timeZone: zone }))}
                >
                  Use this browser's, {zone.replaceAll("_", " ")}
                </button>
              )}
            </div>
            <Field label="Currency" id="business-currency" maxLength={3} {...text("currency")} />
          </div>
          <p className="text-sm text-muted">
            Weekly hours are clock times in this zone, so 9:00 stays 9:00 when the clocks change.
            Visitors see times in their own zone.
          </p>
        </section>

        <section className="card grid gap-4" aria-labelledby="rules-title">
          <h2 id="rules-title" className="font-display text-2xl">
            Booking rules
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              label="Minimum notice, in hours"
              id="rule-notice"
              type="number"
              min={0}
              max={720}
              step={0.25}
              {...text("noticeHours")}
            />
            <Field
              label="Book up to, in days ahead"
              id="rule-window"
              type="number"
              min={1}
              max={365}
              {...text("maxDaysAhead")}
            />
            <Select label="Start times every" id="rule-step" {...text("slotStepMinutes")}>
              {[5, 10, 15, 20, 30, 60].map((step) => (
                <option key={step} value={String(step)}>
                  {step} minutes
                </option>
              ))}
            </Select>
          </div>
        </section>

        <section className="card grid gap-4" aria-labelledby="email-title">
          <h2 id="email-title" className="font-display text-2xl">
            Emails and reminders
          </h2>
          <div className="grid gap-4 md:grid-cols-2 md:items-end">
            <Field
              label="Send reminders, hours before"
              id="rule-reminder"
              type="number"
              min={1}
              max={168}
              {...text("reminderHoursBefore")}
            />
            <Switch
              label="Email me about new, moved and cancelled bookings"
              id="notify-owner"
              checked={form.notifyOwner === true}
              onChange={(event) =>
                setForm((old) => ({ ...old, notifyOwner: event.currentTarget.checked }))
              }
              disabled={busy}
            />
          </div>
          <ul className="space-y-1 text-sm text-muted">
            <li>
              Email:{" "}
              {loaded.modules.door
                ? "the platform's email door is open for this app."
                : "off on this platform, so nothing is emailed yet. Bookings still work."}
            </li>
            <li>
              Reminders:{" "}
              {loaded.modules.schedules
                ? "running every 15 minutes."
                : "start once the app is live with scheduled jobs switched on."}
            </li>
            <li>
              Your own notices go to your sign-in email
              {ownerEmail ? `, ${ownerEmail}` : ", once you choose one below"}.
            </li>
          </ul>
        </section>

        {notice && <Alert title={notice.text} tone={notice.tone} />}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </form>

      <section
        id="sign-in"
        className="card mt-10 max-w-xl space-y-4"
        aria-labelledby="sign-in-title"
      >
        <h2 id="sign-in-title" className="font-display text-2xl">
          Your sign-in
        </h2>
        <p className="text-sm text-muted">
          {ownerEmail
            ? `You sign in as ${ownerEmail}. Change it here.`
            : "Choose the email and password you will sign in with here, without Pramaan."}
        </p>
        <form className="grid gap-4" onSubmit={(event) => void saveSignIn(event)}>
          <Field
            label="Owner email"
            id="owner-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
          <Field
            label="Password"
            id="owner-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
          {signInNotice && <Alert title={signInNotice.text} tone={signInNotice.tone} />}
          <Button type="submit" variant="primary" disabled={busy} className="justify-self-start">
            {ownerEmail ? "Change sign-in" : "Save sign-in"}
          </Button>
        </form>
      </section>
    </>
  );
}
