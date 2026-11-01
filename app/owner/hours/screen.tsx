"use client";
// Weekly hours (each person's, as local clock times in the business's time zone; a day may have a break) and
// days off (one person's, or the whole business closed). The booking page offers only times inside these.
import { Plus, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { WEEKDAYS } from "../../../lib/bookings/format";
import { clock, localDateOf, minutesOf } from "../../../lib/bookings/time";
import { messageOf } from "../../parts/fetch";
import { EmptyWeek } from "../../parts/illustrations";
import { Alert, Button, Field, Select, Skeleton } from "../../ui";
import { OwnerHeading, ownerCall, useOwner } from "../owner-shell";

type Person = { id: string; name: string; color: string };
type HoursRow = { staffId: string; weekday: number; startMinute: number; endMinute: number };
type DayOff = { id: string; staffId: string | null; day: string; note: string };
type Data = { timeZone: string; staff: Person[]; hours: HoursRow[]; daysOff: DayOff[] };
type Stretch = { key: string; start: string; end: string };

let stretchCount = 0;
const stretch = (start: string, end: string): Stretch => ({
  key: `s${++stretchCount}`,
  start,
  end,
});

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const ink = (color: string) => ({ "--ink": `var(--staff-${color})` }) as CSSProperties;

export default function OwnerHours() {
  const owner = useOwner();
  const [data, setData] = useState<Data | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [week, setWeek] = useState<Record<number, Stretch[]>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState("");
  const [who, setWho] = useState("everyone");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await ownerCall<Data>(owner, "/api/owner/hours"));
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);

  const current = staffId ?? data?.staff[0]?.id ?? null;
  useEffect(() => {
    if (!data || !current) return;
    const next: Record<number, Stretch[]> = {};
    for (const row of data.hours.filter((entry) => entry.staffId === current)) {
      next[row.weekday] = [
        ...(next[row.weekday] ?? []),
        stretch(clock(row.startMinute), clock(row.endMinute)),
      ];
    }
    setWeek(next);
  }, [data, current]);

  const today = useMemo(() => (data ? localDateOf(Date.now(), data.timeZone) : ""), [data]);

  async function saveHours() {
    if (!current) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const hours = Object.entries(week).flatMap(([weekday, stretches]) =>
        stretches.map((stretch) => {
          const startMinute = minutesOf(stretch.start);
          const endMinute = minutesOf(stretch.end === "00:00" ? "24:00" : stretch.end);
          if (startMinute === null || endMinute === null)
            throw new Error(`Check the times on ${WEEKDAYS[Number(weekday)]}.`);
          return { weekday: Number(weekday), startMinute, endMinute };
        }),
      );
      await ownerCall(owner, "/api/owner/hours", { action: "hours", staffId: current, hours });
      setNotice("Hours saved. The booking page offers the new times straight away.");
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function addDayOff(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await ownerCall(owner, "/api/owner/hours", {
        action: "add-day-off",
        day,
        staffId: who === "everyone" ? null : who,
        note,
      });
      setDay("");
      setNote("");
      setNotice("Day off added. Nobody can book it.");
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function removeDayOff(entry: DayOff) {
    setBusy(true);
    try {
      await ownerCall(owner, "/api/owner/hours", { action: "remove-day-off", id: entry.id });
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const setStretch = (weekday: number, index: number, field: keyof Stretch, value: string) =>
    setWeek((old) => ({
      ...old,
      [weekday]: (old[weekday] ?? []).map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  const longDate = (date: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${date}T12:00:00Z`));

  if (!data) return error ? <Alert title={error} tone="error" /> : <Skeleton className="h-96" />;
  const person = data.staff.find((entry) => entry.id === current);
  return (
    <>
      <OwnerHeading
        eyebrow={`Times in ${data.timeZone.replaceAll("_", " ")}`}
        title="Hours and days off"
      />
      {notice && (
        <div className="mb-6">
          <Alert title={notice} tone="success" />
        </div>
      )}
      {error && (
        <div className="mb-6">
          <Alert title={error} tone="error" />
        </div>
      )}

      <section className="card space-y-6" aria-labelledby="week-title">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="week-title" className="font-display text-2xl">
            Weekly hours{person && data.staff.length > 1 ? `: ${person.name}` : ""}
          </h2>
          {data.staff.length > 1 && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Whose hours</legend>
              {data.staff.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={entry.id === current}
                  onClick={() => setStaffId(entry.id)}
                  style={ink(entry.color)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold aria-pressed:border-accent aria-pressed:bg-accent-soft"
                >
                  <span className="staff-dot h-2.5 w-2.5 rounded-full" aria-hidden="true" />
                  {entry.name}
                </button>
              ))}
            </fieldset>
          )}
        </div>
        <ul className="divide-y divide-line">
          {ORDER.map((weekday) => {
            const stretches = week[weekday] ?? [];
            const open = stretches.length > 0;
            const name = WEEKDAYS[weekday] ?? "";
            return (
              <li key={weekday} className="flex flex-wrap items-start gap-4 py-4">
                <label className="flex min-h-11 w-40 cursor-pointer items-center gap-3 font-semibold">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-accent"
                    checked={open}
                    onChange={(event) =>
                      setWeek((old) => ({
                        ...old,
                        [weekday]: event.target.checked ? [stretch("09:00", "17:00")] : [],
                      }))
                    }
                  />
                  {name}
                </label>
                <div className="flex flex-1 flex-col gap-2">
                  {!open && <p className="min-h-11 content-center text-sm text-muted">Closed</p>}
                  {stretches.map((entry, index) => (
                    <div key={entry.key} className="flex flex-wrap items-center gap-2">
                      <label
                        className="sr-only"
                        htmlFor={`from-${weekday}-${index}`}
                      >{`${name} from`}</label>
                      <input
                        id={`from-${weekday}-${index}`}
                        type="time"
                        step={300}
                        className="input min-h-11 w-32"
                        value={entry.start}
                        onChange={(event) =>
                          setStretch(weekday, index, "start", event.target.value)
                        }
                      />
                      <span className="text-muted">to</span>
                      <label
                        className="sr-only"
                        htmlFor={`until-${weekday}-${index}`}
                      >{`${name} until`}</label>
                      <input
                        id={`until-${weekday}-${index}`}
                        type="time"
                        step={300}
                        className="input min-h-11 w-32"
                        value={entry.end}
                        onChange={(event) => setStretch(weekday, index, "end", event.target.value)}
                      />
                      {stretches.length > 1 && (
                        <Button
                          aria-label={`Remove these ${name} hours`}
                          className="px-3!"
                          onClick={() =>
                            setWeek((old) => ({
                              ...old,
                              [weekday]: stretches.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          <X aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {open && stretches.length < 4 && (
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-accent"
                      onClick={() => {
                        const last = stretches.at(-1);
                        setWeek((old) => ({
                          ...old,
                          [weekday]: [...stretches, stretch(last?.end ?? "13:00", "17:00")],
                        }));
                      }}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      Add hours after a break
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={() => void saveHours()}>
            {busy ? "Saving…" : "Save hours"}
          </Button>
          <Button
            disabled={busy || !week[1]?.length}
            onClick={() =>
              setWeek((old) => ({
                ...old,
                2: [...(old[1] ?? [])],
                3: [...(old[1] ?? [])],
                4: [...(old[1] ?? [])],
                5: [...(old[1] ?? [])],
              }))
            }
          >
            Copy Monday to Tuesday–Friday
          </Button>
        </div>
      </section>

      <section className="card mt-8 space-y-6" aria-labelledby="days-off-title">
        <h2 id="days-off-title" className="font-display text-2xl">
          Days off
        </h2>
        <form
          className="grid gap-4 md:grid-cols-[12rem_14rem_minmax(0,1fr)_auto] md:items-end"
          onSubmit={(event) => void addDayOff(event)}
        >
          <Field
            label="Date"
            id="day-off-date"
            type="date"
            min={today}
            required
            value={day}
            onChange={(event) => setDay(event.target.value)}
            disabled={busy}
          />
          <Select
            label="Who"
            id="day-off-who"
            value={who}
            onChange={(event) => setWho(event.target.value)}
            disabled={busy}
          >
            <option value="everyone">Everyone (closed)</option>
            {data.staff.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
          <Field
            label="Note"
            id="day-off-note"
            maxLength={120}
            placeholder="Bank holiday"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Add day off
          </Button>
        </form>
        {data.daysOff.length === 0 ? (
          <div className="flex items-center gap-4 rounded-xl border border-dashed border-line p-5">
            <EmptyWeek className="h-14 w-20" />
            <div>
              <p className="font-semibold">No days off planned</p>
              <p className="text-sm text-muted">
                Add holidays and closures here, and they disappear from the booking page.
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.daysOff.map((entry) => {
              const whose = entry.staffId ? data.staff.find((p) => p.id === entry.staffId) : null;
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-4 py-3">
                  <span className="min-w-56 font-semibold">{longDate(entry.day)}</span>
                  <span className="text-sm text-muted">
                    {whose ? whose.name : "Everyone: closed"}
                  </span>
                  <span className="flex-1 text-sm">{entry.note}</span>
                  <Button
                    aria-label={`Remove day off on ${longDate(entry.day)}`}
                    className="px-3!"
                    disabled={busy}
                    onClick={() => void removeDayOff(entry)}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4 text-danger" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
