"use client";
import { useEffect, useState } from "react";
import { Alert, Button, EmptyState, Field, Select, Table } from "../../ui";

type Account = { id: string; email: string | null; role: string };
type Reply = {
  accounts?: Account[];
  total?: number;
  roles?: Record<string, string>;
  account?: Account;
  error?: string;
};

async function call(
  ownerId: string,
  { input, search = "" }: { input?: object; search?: string } = {},
) {
  const response = await fetch(`/api/roles${search ? `?${new URLSearchParams({ search })}` : ""}`, {
    method: input ? "POST" : "GET",
    cache: "no-store",
    headers: { "x-app-user": ownerId, ...(input ? { "content-type": "application/json" } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  });
  const result = (await response.json()) as Reply;
  if (!response.ok) throw new Error(result.error ?? "Please try again.");
  return result;
}

/**
 * The accounts that signed up, each with its role, which the owner changes in place. Everyone with a role is listed
 * first; a search by email finds anyone else.
 */
export function RolesScreen({ ownerId }: { ownerId: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  useEffect(() => {
    call(ownerId, { search }).then(
      (result) => {
        setAccounts(result.accounts ?? []);
        setTotal(result.total ?? 0);
        setRoles(result.roles ?? {});
      },
      (error: Error) => {
        setAccounts([]);
        setNotice({ tone: "error", text: error.message });
      },
    );
  }, [ownerId, search]);
  const nameOf = (role: string) => roles[role] ?? (role === "member" ? "Member" : role);
  async function assign(account: Account, role: string) {
    setBusy(true);
    setNotice(null);
    try {
      const { account: saved } = await call(ownerId, { input: { id: account.id, role } });
      if (!saved) throw new Error("Please try again.");
      setAccounts((current) => (current ?? []).map((row) => (row.id === saved.id ? saved : row)));
      setNotice({
        tone: "success",
        text: `${saved.email ?? "The account"} is now ${nameOf(saved.role)}.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  if (accounts === null) return <p className="text-muted">One moment…</p>;
  return (
    <>
      <p className="text-muted">Mark a member as staff. Staff see nothing extra yet.</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(typed.trim());
        }}
      >
        <Field
          label="Find by email"
          id="roles-search"
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button type="submit">Find</Button>
      </form>
      {accounts.length === 0 ? (
        <EmptyState
          title={search ? "No one matches." : "No one has signed up yet."}
          hint={
            search ? "Try part of their email." : "When someone signs up, give them a role here."
          }
        />
      ) : (
        <>
          <Table caption="Accounts and their roles">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.email ?? "No email yet"}</td>
                  <td>
                    <Select
                      label={`Role for ${account.email ?? account.id}`}
                      id={`role-${account.id}`}
                      value={account.role}
                      disabled={busy}
                      onChange={(event) => void assign(account, event.target.value)}
                    >
                      <option value="member">Member</option>
                      {Object.entries(roles).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {total > accounts.length && (
            <p className="text-sm text-muted">
              Showing {accounts.length} of {total}, everyone with a role first. Find anyone else by
              email.
            </p>
          )}
        </>
      )}
      {notice && <Alert title={notice.text} tone={notice.tone} />}
    </>
  );
}
