import { ENTITIES } from "../../../../../lib/admin-table/entities";
import { createRecordsApi } from "../../../../../lib/admin-table/records";
import { database } from "../../../../../lib/roles/database";
import { requireRole } from "../../../../../lib/roles/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const api = createRecordsApi({ db: database, entities: ENTITIES, requireRole });

// The records the table shows, as CSV: the same guard and the same reach as the table's own API.
export async function GET(request: Request, context: { params: Promise<{ entity: string }> }) {
  return api.exportCsv(request, (await context.params).entity);
}
