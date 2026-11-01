import { releaseHold } from "../../../../lib/bookings/holds";
import { handle, readBody, reply } from "../../../../lib/bookings/http";
import { book } from "../../../../lib/bookings/public";
import { database } from "../../../../lib/runtime";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handle(async () => reply(await book(request, true), 201));
}

export function DELETE(request: Request) {
  return handle(async () =>
    reply(await releaseHold(database(), (await readBody(request)).holdToken)),
  );
}
