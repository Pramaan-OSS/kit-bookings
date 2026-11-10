import * as handler9 from "../booking/book/handler";
import * as handler7 from "../booking/calendar/handler";
import * as handler8 from "../booking/catalog/handler";
import * as handler12 from "../booking/hold/handler";
import * as handler10 from "../booking/manage/handler";
import * as handler11 from "../booking/slots/handler";
import * as handler1 from "../classes/handler";
import * as handler0 from "../email-notices/handler";
import * as handler3 from "../jobs/reminders/handler";
import * as handler4 from "../me/bookings/handler";
import * as handler14 from "../owner/bookings/handler";
import * as handler15 from "../owner/hours/handler";
import * as handler17 from "../owner/overview/handler";
import * as handler18 from "../owner/services/handler";
import * as handler13 from "../owner/settings/handler";
import * as handler16 from "../owner/staff/handler";
import * as handler20 from "../records/[entity]/export/handler";
import * as handler19 from "../records/[entity]/handler";
import * as handler2 from "../roles/handler";
import * as handler21 from "../staff/day/handler";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const routes: Record<string, unknown> = {
  "email-notices": handler0,
  classes: handler1,
  roles: handler2,
  "jobs/reminders": handler3,
  "me/bookings": handler4,
  "booking/calendar": handler7,
  "booking/catalog": handler8,
  "booking/book": handler9,
  "booking/manage": handler10,
  "booking/slots": handler11,
  "booking/hold": handler12,
  "owner/settings": handler13,
  "owner/bookings": handler14,
  "owner/hours": handler15,
  "owner/staff": handler16,
  "owner/overview": handler17,
  "owner/services": handler18,
  "staff/day": handler21,
};
type Handler = (
  request: Request,
  context: { params: Promise<{ entity: string }> },
) => Response | Promise<Response>;
async function dispatch(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  let group = routes[path.join("/")] as Record<string, Handler> | undefined;
  if (path[0] === "records" && path.length === 2)
    group = handler19 as unknown as Record<string, Handler>;
  if (path[0] === "records" && path.length === 3 && path[2] === "export")
    group = handler20 as unknown as Record<string, Handler>;
  if (!group) return Response.json({ error: "This page wasn't found." }, { status: 404 });
  const handler = group[request.method];
  if (!handler)
    return Response.json({ error: "Choose one of the available actions." }, { status: 405 });
  return handler(request, { params: Promise.resolve({ entity: path[1] ?? "" }) });
}
export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
