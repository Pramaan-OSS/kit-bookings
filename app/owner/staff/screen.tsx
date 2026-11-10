"use client";
// Who people book with. There is always at least one; a solo business keeps one and gives it its own name.
// With two or more, the booking page asks visitors who they'd like, or "anyone available".
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from "react";
import { STAFF_COLORS } from "../../../lib/bookings/format";
import { messageOf } from "../../parts/fetch";
import { Alert, Badge, Button, Dialog, Field, Select, Skeleton, Switch } from "../../ui";
import { OwnerHeading, ownerCall, useOwner } from "../owner-shell";

type Person = {
  id: string;
  name: string;
  title: string;
  color: string;
  active: boolean;
  serviceIds: string[];
  signIn: { email: string; staff: boolean } | null;
};
type StaffAccount = { id: string; email: string };
type ServiceOption = { id: string; name: string; length: string; active: boolean };
type Draft = Omit<Person, "id" | "signIn"> & { id: string | null };

const ink = (color: string) => ({ "--ink": `var(--staff-${color})` }) as CSSProperties;

export default function OwnerStaff() {
  const owner = useOwner();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [linking, setLinking] = useState<Person | null>(null);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await ownerCall<{
        staff: Person[];
        services: ServiceOption[];
        accounts: StaffAccount[];
      }>(owner, "/api/owner/staff");
      setPeople(result.staff);
      setServices(result.services);
      setAccounts(result.accounts);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await ownerCall(owner, "/api/owner/staff", { action: "save", person: draft });
      setNotice(`Saved ${draft.name.trim()}.`);
      setDraft(null);
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  function openLink(person: Person) {
    setError("");
    setChosen(
      accounts.find((account) => account.email === person.signIn?.email)?.id ??
        accounts[0]?.id ??
        "",
    );
    setLinking(person);
  }

  async function link(person: Person, userId: string | null) {
    setBusy(true);
    setError("");
    try {
      await ownerCall(owner, "/api/owner/staff", { action: "link", id: person.id, userId });
      setNotice(
        userId
          ? `${person.name} can now sign in and see their own day.`
          : `${person.name} no longer signs in.`,
      );
      setLinking(null);
      await load();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(person: Person) {
    setBusy(true);
    try {
      const { result } = await ownerCall<{ result: string }>(owner, "/api/owner/staff", {
        action: "remove",
        id: person.id,
      });
      setNotice(
        result === "deleted"
          ? `Removed ${person.name}.`
          : `${person.name} has bookings, so they stop taking new ones instead.`,
      );
      setRemoving(null);
      await load();
    } catch (failure) {
      setNotice(messageOf(failure));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  const unused =
    STAFF_COLORS.find((color) => !(people ?? []).some((person) => person.color === color)) ??
    "evergreen";
  const newPerson = (): Draft => ({
    id: null,
    name: "",
    title: "",
    color: unused,
    active: true,
    serviceIds: services.filter((service) => service.active).map((service) => service.id),
  });

  return (
    <>
      <OwnerHeading eyebrow="Who people book with" title="Staff">
        <Button
          variant="primary"
          onClick={() => {
            setError("");
            setDraft(newPerson());
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add a person
          </span>
        </Button>
      </OwnerHeading>
      <p className="-mt-4 mb-6 max-w-2xl text-muted">
        Working alone? Keep one person and give it your own name. With two or more, visitors choose
        who they'd like, or anyone available. A new person starts with the same weekly hours as the
        first; change them under Hours.
      </p>
      {notice && (
        <div className="mb-6">
          <Alert title={notice} tone="success" />
        </div>
      )}
      {!people ? (
        error ? (
          <Alert title={error} tone="error" />
        ) : (
          <Skeleton className="h-48" />
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {people.map((person) => (
            <li
              key={person.id}
              className={`card flex items-start gap-4 p-5! ${person.active ? "" : "opacity-70"}`}
              style={ink(person.color)}
            >
              <span
                className="staff-dot mt-2 h-3.5 w-3.5 shrink-0 rounded-full"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-display text-xl">
                  {person.name}
                  {!person.active && <Badge>Not taking bookings</Badge>}
                </p>
                {person.title && <p className="text-sm text-muted">{person.title}</p>}
                <p className="mt-2 text-sm text-muted">
                  {person.serviceIds.length === 0
                    ? "Offers no services yet"
                    : services
                        .filter((service) => person.serviceIds.includes(service.id))
                        .map((service) => service.name)
                        .join(", ")}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {!person.signIn
                    ? "Does not sign in"
                    : person.signIn.staff
                      ? `Signs in as ${person.signIn.email}`
                      : `Linked to ${person.signIn.email}, who is no longer marked as Staff, so they see nothing`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button aria-label={`Sign-in for ${person.name}`} onClick={() => openLink(person)}>
                  <KeyRound aria-hidden="true" className="h-4 w-4" />
                </Button>
                <Button
                  aria-label={`Edit ${person.name}`}
                  onClick={() => {
                    setError("");
                    setDraft({ ...person });
                  }}
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </Button>
                <Button
                  aria-label={`Remove ${person.name}`}
                  disabled={people.filter((p) => p.active).length <= 1 && person.active}
                  onClick={() => setRemoving(person)}
                >
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
        title={draft?.id ? "Edit person" : "Add a person"}
      >
        {draft && (
          <form className="grid gap-5" onSubmit={(event) => void save(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Name"
                id="staff-name"
                required
                maxLength={80}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                disabled={busy}
              />
              <Field
                label="Title (optional)"
                id="staff-title"
                maxLength={80}
                placeholder="Senior stylist"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                disabled={busy}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Calendar colour</legend>
              <div className="flex flex-wrap gap-2">
                {STAFF_COLORS.map((color) => (
                  <label
                    key={color}
                    className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                    style={ink(color)}
                  >
                    <input
                      type="radio"
                      name="staff-color"
                      value={color}
                      checked={draft.color === color}
                      onChange={() => setDraft({ ...draft, color })}
                      className="sr-only"
                    />
                    <span className="staff-dot h-3.5 w-3.5 rounded-full" aria-hidden="true" />
                    <span className="text-sm capitalize">{color}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Services they offer</legend>
              {services.length === 0 ? (
                <p className="text-sm text-muted">Add services first, on the Services page.</p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {services.map((service) => (
                    <label
                      key={service.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3"
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-accent"
                        checked={draft.serviceIds.includes(service.id)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            serviceIds: event.target.checked
                              ? [...draft.serviceIds, service.id]
                              : draft.serviceIds.filter((id) => id !== service.id),
                          })
                        }
                      />
                      <span>
                        {service.name}{" "}
                        <span className="text-sm text-muted">· {service.length}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <Switch
              label="Taking bookings"
              id="staff-active"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.currentTarget.checked })}
              disabled={busy}
            />
            {error && <Alert title={error} tone="error" />}
            <div className="flex justify-end gap-3">
              <Button onClick={() => setDraft(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save person"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={linking !== null}
        onClose={() => setLinking(null)}
        title={`Sign-in for ${linking?.name ?? "this person"}`}
      >
        {linking && (
          <div className="grid gap-5">
            <p className="text-muted">
              They sign in with this account and see their own bookings, a day at a time: the time,
              the service and the customer's name. Nothing else in the owner area opens for them.
            </p>
            {accounts.length === 0 ? (
              <p className="text-muted">
                No account is marked as Staff yet. Ask them to create an account on the app, then
                mark it as Staff under Roles.
              </p>
            ) : (
              <Select
                label="Account"
                id="staff-account"
                value={chosen}
                disabled={busy}
                onChange={(event) => setChosen(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email}
                  </option>
                ))}
              </Select>
            )}
            {error && <Alert title={error} tone="error" />}
            <div className="flex flex-wrap justify-end gap-3">
              {linking.signIn && (
                <Button disabled={busy} onClick={() => void link(linking, null)}>
                  Stop their sign-in
                </Button>
              )}
              <Button onClick={() => setLinking(null)}>Cancel</Button>
              {accounts.length > 0 && (
                <Button
                  variant="primary"
                  disabled={busy || chosen === ""}
                  onClick={() => void link(linking, chosen)}
                >
                  {busy ? "Saving…" : "Link account"}
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this person?"
      >
        <p className="text-muted">
          {removing?.name} stops appearing on the booking page. If anyone has booked with them, they
          are kept and stop taking new bookings instead.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={() => setRemoving(null)}>Keep them</Button>
          <Button
            variant="primary"
            className="bg-danger!"
            disabled={busy}
            onClick={() => removing && void remove(removing)}
          >
            Remove person
          </Button>
        </div>
      </Dialog>
    </>
  );
}
