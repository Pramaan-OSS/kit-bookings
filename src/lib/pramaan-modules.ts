// The platform's module door (docs: "Platform modules" in STACK.md when a module is on). Server only. The running
// draft and live app have a read-only mount at /pramaan-modules holding the door's socket and a token; `pramaan
// check`, the build and a local `next dev` don't, so every call here can fail, and callers say so plainly.
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";

// PRAMAAN_MODULES_DIR exists for tests only; the platform always mounts the door at /pramaan-modules.
const dir = () => process.env.PRAMAAN_MODULES_DIR ?? "/pramaan-modules";

export class ModulesUnavailableError extends Error {
  constructor() {
    super("Platform modules are not available here");
  }
}

/** Which parts of the door this app has: the socket (files, email) and, live with schedules on, its key. */
export function modulesPresent() {
  return {
    door: existsSync(path.join(dir(), "token")),
    schedules: existsSync(path.join(dir(), "schedule-key")),
  };
}

/** The key the platform signs scheduled calls with, or null when schedules are off here. */
export function scheduleKey() {
  try {
    return readFileSync(path.join(dir(), "schedule-key"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function moduleCall(
  method: string,
  route: string,
  body?: Buffer | string,
  type = "application/octet-stream",
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let token: string;
    try {
      token = readFileSync(path.join(dir(), "token"), "utf8").trim();
    } catch {
      reject(new ModulesUnavailableError());
      return;
    }
    const headers: Record<string, string | number> = { authorization: `Bearer ${token}` };
    if (body !== undefined)
      Object.assign(headers, { "content-type": type, "content-length": Buffer.byteLength(body) });
    const call = request(
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
    call.on("timeout", () => call.destroy(new Error("The platform's module door did not answer")));
    call.on("error", reject);
    call.end(body);
  });
}

export type EmailOutcome =
  | { status: "sent" }
  | { status: "not-sent"; message: string; retry: boolean }
  | { status: "unknown"; message: string };

/**
 * Sends one email through the platform's email module. Never throws: a booking is saved whether or not its email
 * goes, and the outcome says what to tell the person.
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<EmailOutcome> {
  try {
    const answer = await moduleCall(
      "POST",
      "/v1/email",
      JSON.stringify(message),
      "application/json",
    );
    if (answer.status === 202 || answer.status === 200) return { status: "sent" };
    let detail: { error?: string; message?: string } = {};
    try {
      detail = JSON.parse(answer.body.toString("utf8"));
    } catch {
      /* no detail */
    }
    const said = detail.message ?? "The email could not be sent.";
    if (detail.error === "EMAIL_OUTCOME_UNKNOWN") return { status: "unknown", message: said };
    return {
      status: "not-sent",
      message: said,
      retry: answer.status === 429 || detail.error === "EMAIL_SENDER_UNAVAILABLE",
    };
  } catch (error) {
    return {
      status: "not-sent",
      message:
        error instanceof ModulesUnavailableError
          ? "Email isn't switched on for this app yet, so no email was sent."
          : "The email service did not answer, so no email was sent.",
      retry: !(error instanceof ModulesUnavailableError),
    };
  }
}
