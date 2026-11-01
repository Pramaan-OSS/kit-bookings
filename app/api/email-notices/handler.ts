import { noticesApi } from "../../../lib/email-notices/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner's alone: the roles guard runs before anything else is read, and refuses every other account.
export function GET(request: Request) {
  return noticesApi().status(request);
}

export function POST(request: Request) {
  return noticesApi().test(request);
}
