"use client";
import { useEffect, useState } from "react";
import { Alert, Button, EmptyState, Table } from "../../ui";

type Recent = { template: string; status: string; note: string; at: string };
type Status = { available: boolean; off: boolean; note?: string; recent: Recent[]; error?: string };
type Result = { status: string; off: boolean; note: string };

async function call(ownerId: string, input?: object) {
  const response = await fetch("/api/email-notices", {
    method: input ? "POST" : "GET",
    cache: "no-store",
    headers: { "x-app-user": ownerId, ...(input ? { "content-type": "application/json" } : {}) },
    body: input ? JSON.stringify(input) : undefined,
  });
  const result = (await response.json()) as Status & { result?: Result };
  if (!response.ok) throw new Error(result.error ?? "Please try again.");
  return result;
}

const WORDS: Record<string, string> = {
  sent: "Sent",
  "not-sent": "Not sent",
  unknown: "May have been sent",
};

/**
 * Whether the app's emails are going out. When email is not switched on, one note says so and nothing else is asked
 * of the owner: the app runs as normal, and nothing is queued for later.
 */
export function EmailScreen({ ownerId }: { ownerId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  useEffect(() => {
    call(ownerId).then(setStatus, (error: Error) =>
      setStatus({ available: false, off: false, recent: [], error: error.message }),
    );
  }, [ownerId]);
  async function sendTest() {
    setBusy(true);
    setNotice(null);
    try {
      const { result } = await call(ownerId, { nonce });
      if (!result) throw new Error("Please try again.");
      setNonce(crypto.randomUUID());
      if (result.status === "sent") setNotice({ tone: "success", text: "Sent. Check that inbox." });
      else setNotice({ tone: "error", text: result.note || "It was not sent." });
      // The test stays on offer: a sender chosen later is found by the next try, never by reloading.
      setStatus(await call(ownerId));
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  if (status === null) return <p className="text-muted">One moment…</p>;
  if (status.error) return <Alert tone="error" title={status.error} />;
  if (!status.available)
    return (
      <Alert title={status.note ?? "Email isn't switched on for this app yet."}>
        Everything else in the app works as normal. Nothing is held back to send later.
      </Alert>
    );
  return (
    <>
      <p className="text-muted">
        Emails the app sends, such as confirmations, go out from the platform. Send yourself a test,
        to the email you chose in the owner area, to check they arrive.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendTest();
        }}
      >
        <Button type="submit" variant="primary" disabled={busy}>
          Send test email
        </Button>
      </form>
      {notice && <Alert title={notice.text} tone={notice.tone} />}
      {status.recent.length === 0 ? (
        <EmptyState
          title="No emails sent yet."
          hint="They are listed here as the app sends them."
        />
      ) : (
        <Table caption="The last emails the app sent">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">What happened</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {status.recent.map((row) => (
              <tr key={`${row.template}-${row.at}`}>
                <td>{row.template}</td>
                <td>
                  {WORDS[row.status] ?? row.status}
                  {row.note ? `: ${row.note}` : ""}
                </td>
                <td>{new Date(row.at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
