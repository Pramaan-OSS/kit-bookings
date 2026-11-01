"use client";
import { useCallback, useEffect, useState } from "react";
import { formatDay, formatTime } from "../../lib/bookings/time";
import { api, messageOf } from "../parts/fetch";
import { Button, Field } from "../ui";

type Session = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  taken: number;
  joined: boolean;
};
export function ClassScreen({ owner = false }: { owner?: boolean }) {
  const [timeZone, setTimeZone] = useState("UTC");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    return api<{ sessions: Session[]; timeZone: string }>("/api/classes").then((r) => {
      setSessions(r.sessions);
      setTimeZone(r.timeZone);
    });
  }, []);
  useEffect(() => {
    void load().catch((e) => setNotice(messageOf(e)));
  }, [load]);
  async function act(body: unknown) {
    setBusy(true);
    try {
      await api("/api/classes", { body });
      await load();
      setNotice("Saved.");
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {owner && (
        <form
          className="card grid gap-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void act({
              action: "add",
              name: data.get("name"),
              startsLocal: String(data.get("startsAt")),
              endsLocal: String(data.get("endsAt")),
              capacity: Number(data.get("capacity")),
            });
          }}
        >
          <h2 className="text-xl">Add a class</h2>
          <Field id="class-name" label="Class name" name="name" required maxLength={80} />
          <Field id="class-start" label="Starts" type="datetime-local" name="startsAt" required />
          <Field id="class-end" label="Finishes" type="datetime-local" name="endsAt" required />
          <Field
            id="class-capacity"
            label="Places"
            type="number"
            name="capacity"
            min={1}
            max={100}
            defaultValue={8}
            required
          />
          <p className="text-sm text-muted">Times use the business time zone: {timeZone}.</p>
          <Button type="submit" disabled={busy}>
            Save class
          </Button>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {!sessions.length && <p>No classes are open yet. Please check back soon.</p>}
      {sessions.map((s) => (
        <section className="card space-y-3 p-6" key={s.id}>
          <h2 className="font-display text-2xl">{s.name}</h2>
          <p>
            {formatDay(Date.parse(s.starts_at), timeZone)} ·{" "}
            {formatTime(Date.parse(s.starts_at), timeZone)} –{" "}
            {formatTime(Date.parse(s.ends_at), timeZone)} ({timeZone})
          </p>
          <p>
            {s.capacity - s.taken} {s.capacity - s.taken === 1 ? "place" : "places"} left
          </p>
          {!owner && (
            <Button
              disabled={busy || (!s.joined && s.taken >= s.capacity)}
              onClick={() => void act({ sessionId: s.id, action: s.joined ? "cancel" : "join" })}
            >
              {s.joined ? "Cancel my place" : "Book a place"}
            </Button>
          )}
        </section>
      ))}
      {!owner && (
        <p>
          Sign in to book a place.{" "}
          <a className="underline" href="/account">
            Your account
          </a>
        </p>
      )}
    </div>
  );
}
