// The only way this block sends email: the platform's module door (docs/contracts/app-modules.md "Email"). Server
// only. The running draft and live app have a read-only mount at /pramaan-modules; `pramaan check`, the build and a
// local `next dev` don't, so every call can fail, and says why in words the owner can read. Nothing here opens a
// network connection of its own, and no answer, error or log line carries an address.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { OFF_NOTE } from "./words";

// PRAMAAN_MODULES_DIR exists for tests only; the platform always mounts the door at /pramaan-modules.
const dir = () => process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";

export type Outgoing = { to: string; subject: string; text: string };
/** How a send went. `off`: email is not switched on, so nothing was sent and nothing will be until it is. */
export type Outcome =
  | { status: "sent" }
  | { status: "not-sent"; off: boolean; message: string }
  | { status: "unknown"; message: string };
export type Door = {
  /** Whether the platform's email module is on for this app (a sender may still be missing: a send says so). */
  available(): Promise<boolean>;
  /** Sends one message under `key`, the Idempotency-Key: the same key never sends twice. Never throws. */
  send(message: Outgoing, key: string): Promise<Outcome>;
};

class NoDoorError extends Error {}

function call(
  method: string,
  route: string,
  body?: string,
  key?: string,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let token: string;
    try {
      token = readFileSync(path.join(dir(), "token"), "utf8").trim();
    } catch {
      reject(new NoDoorError());
      return;
    }
    const headers: Record<string, string | number> = { authorization: `Bearer ${token}` };
    if (body !== undefined)
      Object.assign(headers, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
    if (key !== undefined) headers["idempotency-key"] = key;
    const sent = request(
      {
        socketPath: path.join(dir(), "modules.sock"),
        method,
        path: route,
        headers,
        timeout: 70_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on("error", reject);
      },
    );
    sent.on("timeout", () => sent.destroy(new Error("The platform's module door did not answer")));
    sent.on("error", reject);
    sent.end(body);
  });
}

/** Errors the door answers when email is off for this app: no module, no sender chosen yet, or switched off for it. */
const OFF_ERRORS = ["MODULE_OFF", "EMAIL_SENDER_NOT_CONFIGURED", "EMAIL_DISABLED_FOR_APP"];
/**
 * Answers that may mean the message went: it is never sent again under that key. Only these: a 502 for a failed
 * transport or send (EMAIL_TRANSPORT_FAILED, EMAIL_SEND_FAILED) is a definite "not sent", and may be tried again.
 */
const UNKNOWN_ERRORS = [
  "EMAIL_OUTCOME_UNKNOWN",
  "MODULE_OUTCOME_UNKNOWN",
  "IDEMPOTENCY_PENDING",
  "IDEMPOTENCY_KEY_REUSED",
];

export const emailDoor: Door = {
  async available() {
    try {
      const answer = await call("GET", "/v1");
      if (answer.status !== 200) return false;
      const said = JSON.parse(answer.body.toString("utf8")) as { modules?: { email?: unknown } };
      return said.modules?.email === true;
    } catch {
      return false;
    }
  },
  async send(message, key) {
    try {
      const answer = await call("POST", "/v1/email", JSON.stringify(message), key);
      if (answer.status === 200 || answer.status === 202) return { status: "sent" };
      let detail: { error?: unknown; message?: unknown } = {};
      try {
        detail = JSON.parse(answer.body.toString("utf8"));
      } catch {
        /* no detail */
      }
      const error = typeof detail.error === "string" ? detail.error : "";
      if (OFF_ERRORS.includes(error)) return { status: "not-sent", off: true, message: OFF_NOTE };
      const said = typeof detail.message === "string" ? detail.message.slice(0, 300) : "";
      if (UNKNOWN_ERRORS.includes(error) || answer.status === 504)
        return {
          status: "unknown",
          message: said || "It may have been sent, so it will not be sent again.",
        };
      return { status: "not-sent", off: false, message: said || "The email could not be sent." };
    } catch (error) {
      if (error instanceof NoDoorError) return { status: "not-sent", off: true, message: OFF_NOTE };
      // The socket was never reached: nothing went, and a retry may try again.
      const code = (error as { code?: unknown })?.code;
      if (code === "ENOENT" || code === "ECONNREFUSED")
        return {
          status: "not-sent",
          off: false,
          message: "The email service did not answer, so no email was sent.",
        };
      // The request went out and no answer came back: it may have gone, so it is not sent again.
      return {
        status: "unknown",
        message: "The email service did not answer, so the email may or may not have been sent.",
      };
    }
  },
};
