import { pageRole } from "../../../lib/roles/runtime";
import { NoAccess } from "../../parts/no-access";
import { RolesScreen } from "./roles-screen";

export const dynamic = "force-dynamic";

/** The owner gives accounts their roles. The guard runs on the server: anyone else sees only how to get in. */
export default async function RolesPage() {
  const owner = await pageRole(["owner"]);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Roles</h1>
      {owner ? <RolesScreen ownerId={owner.id} /> : <NoAccess />}
    </main>
  );
}
