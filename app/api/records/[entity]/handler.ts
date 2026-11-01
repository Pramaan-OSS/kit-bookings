import { ENTITIES } from "../../../../lib/admin-table/entities";
import { createRecordsApi } from "../../../../lib/admin-table/records";
import { database } from "../../../../lib/roles/database";
import { requireRole } from "../../../../lib/roles/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const api = createRecordsApi({ db: database, entities: ENTITIES, requireRole });
type Context = { params: Promise<{ entity: string }> };

// Every call: the roles guard first, then what the entity grants that role (lib/admin-table/records.ts).
export async function GET(request: Request, context: Context) {
  return api.list(request, (await context.params).entity);
}

export async function POST(request: Request, context: Context) {
  return api.save(request, (await context.params).entity);
}
