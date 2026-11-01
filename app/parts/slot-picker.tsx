"use client";
// Picks a free start time, a week at a time, shown in the visitor's own time zone. Used to book (app/page.tsx)
// and to move a booking (app/manage/manage-booking.tsx, which passes its manage token).
import { ChevronLeft, ChevronRight, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { groupByDay } from "../../lib/bookings/slots";
import {
  addDays,
  daysBetween,
  formatTime,
  type LocalDate,
  localDateOf,
  timeZones,
  toInstant,
  zonedParts,
  zoneLabel,
} from "../../lib/bookings/time";
import { Button } from "../ui";
import { api, messageOf } from "./fetch";
import { EmptyWeek } from "./illustrations";

type Slot = { start: string; staffIds: string[] };

export function SlotPicker({
  serviceId,
  staffChoice,
  token,
  zone,
  onZoneChange,
  maxDaysAhead,
  selected,
  onSelect,
}: {
  serviceId: string | null;
  staffChoice: string;
  token?: string;
  zone: string;
  onZoneChange: (zone: string) => void;
  maxDaysAhead: number;
  selected: string | null;
  onSelect: (start: string | null) => void;
}) {
  const today = useMemo(() => localDateOf(Date.now(), zone), [zone]);
  const [weekStart, setWeekStart] = useState<LocalDate>(today);
  const [day, setDay] = useState<LocalDate | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState("");
  const [finding, setFinding] = useState(false);
  const [notice, setNotice] = useState("");
  const lastStart = addDays(today, maxDaysAhead + 1);

  const query = useMemo(() => {
    const params = new URLSearchParams({ staff: staffChoice });
    if (serviceId) params.set("service", serviceId);
    if (token) params.set("token", token);
    return params;
  }, [serviceId, staffChoice, token]);

  useEffect(() => {
    if (daysBetween(weekStart, today) > 0) setWeekStart(today);
  }, [today, weekStart]);

  useEffect(() => {
    let live = true;
    setSlots(null);
    setError("");
    const from = toInstant(weekStart, 0, zone, "later") ?? Date.now();
    const to = toInstant(addDays(weekStart, 7), 0, zone, "later") ?? from + 7 * 86_400_000;
    const params = new URLSearchParams(query);
    params.set("from", new Date(from).toISOString());
    params.set("to", new Date(to).toISOString());
    api<{ slots: Slot[] }>(`/api/booking/slots?${params}`)
      .then((result) => {
        if (live) setSlots(result.slots);
      })
      .catch((failure) => {
        if (live) setError(messageOf(failure));
      });
    return () => {
      live = false;
    };
  }, [query, weekStart, zone]);

  const byDay = useMemo(
    () =>
      groupByDay(
        (slots ?? []).map((slot) => Date.parse(slot.start)),
        zone,
      ),
    [slots, zone],
  );
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  // Keep the chosen day when it has times; otherwise open the first day of the week that does.
  useEffect(() => {
    if (!slots) return;
    const selectedDay = selected ? localDateOf(Date.parse(selected), zone) : null;
    if (selectedDay && byDay.has(selectedDay)) {
      setDay(selectedDay);
      return;
    }
    // The week's slots come in order, so the map's first key is its first day with times.
    setDay((current) => (current && byDay.has(current) ? current : ([...byDay.keys()][0] ?? null)));
  }, [slots, byDay, selected, zone]);

  async function findFirst() {
    setFinding(true);
    setNotice("");
    try {
      const result = await api<{ first: Slot | null }>(`/api/booking/slots?${query}&first=1`);
      if (!result.first) {
        setNotice(
          "There are no free times in the booking window right now. Please check back soon.",
        );
        return;
      }
      const start = Date.parse(result.first.start);
      const date = localDateOf(start, zone);
      setWeekStart(date);
      setDay(date);
      onSelect(result.first.start);
    } catch (failure) {
      setNotice(messageOf(failure));
    } finally {
      setFinding(false);
    }
  }

  const times = day ? (byDay.get(day) ?? []) : [];
  const parts = [
    { label: "Morning", items: times.filter((t) => zonedParts(t, zone).minutes < 12 * 60) },
    {
      label: "Afternoon",
      items: times.filter((t) => {
        const minutes = zonedParts(t, zone).minutes;
        return minutes >= 12 * 60 && minutes < 17 * 60;
      }),
    },
    { label: "Evening", items: times.filter((t) => zonedParts(t, zone).minutes >= 17 * 60) },
  ].filter((part) => part.items.length > 0);
  const dayName = (date: LocalDate, style: "short" | "long") =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: style,
      ...(style === "long" ? { day: "numeric", month: "long" } : {}),
    }).format(new Date(`${date}T12:00:00Z`));
  const monthOf = (date: LocalDate) =>
    new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short" }).format(
      new Date(`${date}T12:00:00Z`),
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void findFirst()} disabled={finding}>
          <span className="inline-flex items-center gap-2">
            {finding ? (
              <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" className="h-4 w-4" />
            )}
            Next available time
          </span>
        </Button>
        <p className="text-sm text-muted">or choose a day below.</p>
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-clay-soft px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-lg">
          {dayName(weekStart, "short")} {Number(weekStart.slice(8))} {monthOf(weekStart)} –{" "}
          {Number(days[6]?.slice(8))} {monthOf(days[6] ?? weekStart)}
        </p>
        <div className="flex gap-2">
          <Button
            aria-label="Earlier week"
            className="px-3!"
            disabled={daysBetween(today, weekStart) <= 0}
            onClick={() => {
              const earlier = addDays(weekStart, -7);
              setWeekStart(daysBetween(today, earlier) < 0 ? today : earlier);
            }}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Later week"
            className="px-3!"
            disabled={daysBetween(addDays(weekStart, 7), lastStart) <= 0}
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <fieldset>
        <legend className="sr-only">Days</legend>
        <div className="grid grid-cols-7 gap-1">
          {days.map((date) => {
            const has = byDay.has(date);
            return (
              <button
                key={date}
                type="button"
                className="day-tab"
                aria-pressed={day === date}
                aria-label={`${dayName(date, "long")}${date === today ? ", today" : ""}${has ? "" : ", no free times"}`}
                data-today={date === today}
                disabled={slots !== null && !has}
                onClick={() => setDay(date)}
              >
                <span
                  className={`text-[0.6875rem] font-bold tracking-[0.12em] uppercase ${date === today ? "text-clay" : "text-muted"}`}
                >
                  {dayName(date, "short").slice(0, 3)}
                </span>
                <span className="day-number">{Number(date.slice(8))}</span>
                <span className={`day-dot ${has ? "" : "invisible"}`} />
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : slots === null ? (
        <div className="flex min-h-32 items-center gap-3 text-muted" role="status">
          <LoaderCircle aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin" />
          Finding free times…
        </div>
      ) : byDay.size === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-6">
          <EmptyWeek />
          <p className="font-display text-xl">Fully booked this week</p>
          <p className="text-sm text-muted">
            Try the week after, or let us find the next free time for you.
          </p>
          {daysBetween(addDays(weekStart, 7), lastStart) > 0 && (
            <Button onClick={() => setWeekStart(addDays(weekStart, 7))}>Show next week</Button>
          )}
        </div>
      ) : day ? (
        <div className="space-y-4">
          <p className="text-sm font-semibold">{dayName(day, "long")}</p>
          {parts.map((part) => (
            <fieldset key={part.label} className="space-y-2">
              <legend className="mb-2 text-xs font-bold tracking-[0.12em] text-muted uppercase">
                {part.label}
              </legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {part.items.map((time) => {
                  const iso = new Date(time).toISOString();
                  const chosen = selected === iso;
                  return (
                    <button
                      key={iso}
                      type="button"
                      aria-pressed={chosen}
                      className={chosen ? "chip-selected" : "chip"}
                      onClick={() => onSelect(chosen ? null : iso)}
                    >
                      {formatTime(time, zone)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      <details className="text-sm text-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center">
          Times are in {zone.replaceAll("_", " ")} ({zoneLabel(Date.now(), zone)}). Change time zone
        </summary>
        <label className="mt-2 grid max-w-sm gap-1.5" htmlFor="visitor-zone">
          <span className="font-medium text-fg">Show times in</span>
          <select
            id="visitor-zone"
            className="input min-h-11"
            value={zone}
            onChange={(event) => {
              onSelect(null);
              onZoneChange(event.target.value);
            }}
          >
            {timeZones().map((name) => (
              <option key={name} value={name}>
                {name.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </details>
    </div>
  );
}
