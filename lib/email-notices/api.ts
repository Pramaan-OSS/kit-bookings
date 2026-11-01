import { AccountError } from "../accounts";
import type { Database, Member } from "../roles/guard";
import { handle, readBody, reply } from "../roles/http";
import type { Door } from "./door";
import { type createNotifier, noticeStatus } from "./notify";
import { OFF_NOTE } from "./words";

type RequireRole = (request: Request, roles: readonly string[]) => Promise<Member>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The owner's page API. The guard runs first on both calls, and refuses every account but the owner's. */
export function createNoticesApi({
  db,
  door,
  notifier,
  requireRole,
}: {
  db: () => Database;
  door: Door;
  notifier: ReturnType<typeof createNotifier>;
  requireRole: RequireRole;
}) {
  return {
    status: (request: Request) =>
      handle(async () => {
        await requireRole(request, ["owner"]);
        const status = await noticeStatus(db(), door);
        return reply({ ...status, ...(status.off ? { note: OFF_NOTE } : {}) });
      }),
    /**
     * A test email to the owner's own address, the one they chose in the owner area: never one a request names. The
     * page sends a `nonce` with each try, so a request sent twice is one event and one email. The answer never
     * repeats the address.
     */
    test: (request: Request) =>
      handle(async () => {
        const owner = await requireRole(request, ["owner"]);
        const input = await readBody(request);
        const nonce = input.nonce;
        if (typeof nonce !== "string" || !UUID.test(nonce))
          throw new AccountError(400, "Refresh this page and try again.");
        if (!owner.email)
          throw new AccountError(400, "Choose your own email in the owner area first.");
        const result = await notifier.notify({
          template: "test",
          event: `test:${nonce}`,
          to: owner.email,
        });
        return reply({ result: { ...result, ...(result.off ? { note: OFF_NOTE } : {}) } });
      }),
  };
}
