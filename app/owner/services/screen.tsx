"use client";
// What people can book: name, length, price (shown, never charged) and the buffer kept free before and after.
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatDuration, formatPrice } from "../../../lib/bookings/format";
import { messageOf } from "../../parts/fetch";
import { OpenDiary } from "../../parts/illustrations";
import { Alert, Badge, Button, Dialog, Field, Skeleton, Switch, Textarea } from "../../ui";
import { OwnerHeading, ownerCall, useOwner } from "../owner-shell";

type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  active: boolean;
  staffIds: string[];
};
type Draft = {
  id: string | null;
  name: string;
  description: string;
  durationMinutes: string;
  price: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  active: boolean;
};

const blank: Draft = {
  id: null,
  name: "",
  description: "",
  durationMinutes: "30",
  price: "",
  bufferBeforeMinutes: "0",
  bufferAfterMinutes: "0",
  active: true,
};

export default function OwnerServices() {
  const owner = useOwner();
  const [list, setList] = useState<Service[] | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Service | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await ownerCall<{ services: Service[]; currency: string }>(
        owner,
        "/api/owner/services",
      );
      setList(result.services);
      setCurrency(result.currency);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await ownerCall(owner, "/api/owner/services", { action: "save", service: draft });
      setNotice(`Saved ${draft.name.trim()}.`);
      setDraft(null);
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(service: Service) {
    setBusy(true);
    try {
      const { result } = await ownerCall<{ result: "deleted" | "hidden" }>(
        owner,
        "/api/owner/services",
        {
          action: "remove",
          id: service.id,
        },
      );
      setNotice(
        result === "deleted"
          ? `Removed ${service.name}.`
          : `${service.name} has bookings, so it is hidden from the booking page instead of removed.`,
      );
      setRemoving(null);
      await load();
    } catch (failure) {
      setNotice(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const edit = (service: Service) =>
    setDraft({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: String(service.durationMinutes),
      price:
        service.priceCents === null
          ? ""
          : (service.priceCents / 100).toFixed(service.priceCents % 100 ? 2 : 0),
      bufferBeforeMinutes: String(service.bufferBeforeMinutes),
      bufferAfterMinutes: String(service.bufferAfterMinutes),
      active: service.active,
    });
  const set = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => (current ? { ...current, [field]: event.target.value } : current));

  return (
    <>
      <OwnerHeading eyebrow="What people can book" title="Services">
        <Button
          variant="primary"
          onClick={() => {
            setError("");
            setDraft({ ...blank });
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add a service
          </span>
        </Button>
      </OwnerHeading>
      {notice && (
        <div className="mb-6">
          <Alert title={notice} tone="success" />
        </div>
      )}
      {!list ? (
        error ? (
          <Alert title={error} tone="error" />
        ) : (
          <Skeleton className="h-64" />
        )
      ) : list.length === 0 ? (
        <div className="card flex max-w-xl flex-col items-start gap-3 p-8">
          <OpenDiary />
          <h2 className="font-display text-2xl">Add the first thing people can book</h2>
          <p className="text-muted">
            A haircut, a consultation, a lesson: give it a name and a length, and it appears on your
            booking page.
          </p>
          <Button variant="primary" onClick={() => setDraft({ ...blank })}>
            Add a service
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3">
          {list.map((service) => (
            <li
              key={service.id}
              className={`card flex flex-wrap items-center gap-4 p-5! ${service.active ? "" : "opacity-70"}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-display text-xl">
                  {service.name}
                  {!service.active && <Badge>Hidden</Badge>}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                    {formatDuration(service.durationMinutes)}
                  </span>
                  <span>{formatPrice(service.priceCents, currency)}</span>
                  {(service.bufferBeforeMinutes > 0 || service.bufferAfterMinutes > 0) && (
                    <span>
                      Keeps{" "}
                      {[
                        service.bufferBeforeMinutes && `${service.bufferBeforeMinutes} min before`,
                        service.bufferAfterMinutes && `${service.bufferAfterMinutes} min after`,
                      ]
                        .filter(Boolean)
                        .join(" and ")}{" "}
                      free
                    </span>
                  )}
                  <span>
                    {service.staffIds.length === 0
                      ? "Nobody offers it yet (Staff page)"
                      : `Offered by ${service.staffIds.length} ${service.staffIds.length === 1 ? "person" : "people"}`}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  aria-label={`Edit ${service.name}`}
                  onClick={() => {
                    setError("");
                    edit(service);
                  }}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </Button>
                <Button aria-label={`Remove ${service.name}`} onClick={() => setRemoving(service)}>
                  <Trash2 aria-hidden="true" className="h-4 w-4 text-danger" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit service" : "Add a service"}
      >
        {draft && (
          <form className="grid gap-4" onSubmit={(event) => void save(event)}>
            <Field
              label="Name"
              id="service-name"
              required
              maxLength={80}
              value={draft.name}
              onChange={set("name")}
              disabled={busy}
            />
            <Textarea
              label="Description"
              id="service-description"
              hint="One line people read on the booking page (optional)."
              maxLength={400}
              value={draft.description}
              onChange={set("description")}
              disabled={busy}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Length in minutes"
                id="service-length"
                type="number"
                inputMode="numeric"
                min={5}
                max={720}
                step={5}
                required
                value={draft.durationMinutes}
                onChange={set("durationMinutes")}
                disabled={busy}
              />
              <Field
                label={`Price (${currency})`}
                id="service-price"
                inputMode="decimal"
                placeholder="Free"
                value={draft.price}
                onChange={set("price")}
                disabled={busy}
              />
              <Field
                label="Free time before, in minutes"
                id="service-before"
                type="number"
                inputMode="numeric"
                min={0}
                max={240}
                value={draft.bufferBeforeMinutes}
                onChange={set("bufferBeforeMinutes")}
                disabled={busy}
              />
              <Field
                label="Free time after, in minutes"
                id="service-after"
                type="number"
                inputMode="numeric"
                min={0}
                max={240}
                value={draft.bufferAfterMinutes}
                onChange={set("bufferAfterMinutes")}
                disabled={busy}
              />
            </div>
            <p className="text-xs text-muted">
              The price is shown only; nothing is charged. Free time before and after keeps room to
              set up or tidy, and nobody can book into it.
            </p>
            <Switch
              label="Show on the booking page"
              id="service-active"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.currentTarget.checked })}
              disabled={busy}
            />
            {error && <Alert title={error} tone="error" />}
            <div className="flex justify-end gap-3">
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save service"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this service?"
      >
        <p className="text-muted">
          {removing?.name} comes off the booking page. If anyone has booked it, it is hidden
          instead, so their bookings keep their details.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={() => setRemoving(null)}>Keep it</Button>
          <Button
            variant="primary"
            className="bg-danger!"
            disabled={busy}
            onClick={() => removing && void remove(removing)}
          >
            Remove service
          </Button>
        </div>
      </Dialog>
    </>
  );
}
