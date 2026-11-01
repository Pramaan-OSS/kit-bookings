import { notFound } from "next/navigation";
import { ENTITIES } from "../../../lib/admin-table/entities";
import { accessOf, fieldsOf, rolesFor } from "../../../lib/admin-table/records";
import { pageRole } from "../../../lib/roles/runtime";
import { NoAccess } from "../../parts/no-access";
import { RecordsTable } from "./records-table";

export const dynamic = "force-dynamic";

/**
 * One kind of record as a table. The guard runs on the server first, so no one it refuses learns even the kind's
 * name; the table's API checks again on every call.
 */
export default async function RecordsPage({ params }: { params: Promise<{ entity: string }> }) {
  const member = await pageRole(rolesFor(ENTITIES));
  const { entity: id } = await params;
  const entity = member ? ENTITIES.find((item) => item.id === id) : undefined;
  if (member && !entity) notFound();
  const reached = member && entity && accessOf(entity, member) !== null ? entity : null;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        {reached ? reached.label : "Records"}
      </h1>
      {member && reached ? (
        <RecordsTable
          entity={{
            id: reached.id,
            label: reached.label,
            fields: fieldsOf(reached),
            account: member.role === "owner" && reached.ownerColumn !== null,
          }}
          memberId={member.id}
        />
      ) : (
        <NoAccess who="the people who run this app" />
      )}
    </main>
  );
}
