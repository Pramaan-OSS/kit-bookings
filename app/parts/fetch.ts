// The browser's one way to call this app's API: JSON in and out, never cached, a timeout, and the server's own
// error message thrown as an Error carrying the HTTP status.

export type ApiError = Error & { status?: number };

export async function api<T>(
  path: string,
  options: { body?: unknown; user?: string | null; method?: "GET" | "POST" | "DELETE" } = {},
): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      // lib/accounts.ts refuses a request whose session changed to another account since the page loaded.
      ...(options.user ? { "x-app-user": options.user } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20_000),
  });
  let result: unknown = null;
  try {
    result = await response.json();
  } catch {
    /* an empty or non-JSON answer */
  }
  if (!response.ok) {
    const message =
      (result as { error?: string } | null)?.error ?? "Something went wrong. Please try again.";
    throw Object.assign(new Error(message), { status: response.status }) as ApiError;
  }
  return result as T;
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Please try again.";

export type SessionUser = { id: string; email: string | null; role: string };

/** The signed-in account, or null (signed out, or storage not ready). */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    return (await api<{ user: SessionUser }>("/api/account/session")).user;
  } catch {
    return null;
  }
}

/** The browser's own time zone, as the booking page shows times in it. */
export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
