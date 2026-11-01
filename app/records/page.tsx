import Link from "next/link";
import { ENTITIES } from "../../lib/admin-table/entities";
import { accessOf, rolesFor } from "../../lib/admin-table/records";
import { pageRole } from "../../lib/roles/runtime";
import { NoAccess } from "../parts/no-access";

export const dynamic = "force-dynamic";

/** Each kind of record the signed-in role reaches. The guard runs on the server. */
export default async function RecordsIndex() {
  const member = await pageRole(rolesFor(ENTITIES));
  const kinds = member ? ENTITIES.filter((entity) => accessOf(entity, member) !== null) : [];
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Records</h1>
      {!member ? (
        <NoAccess who="the people who run this app" />
      ) : (
        <ul className="space-y-2">
          {kinds.map((entity) => (
            <li key={entity.id}>
              <Link
                href={`/records/${entity.id}`}
                className="text-accent underline-offset-4 hover:underline"
              >
                {entity.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
