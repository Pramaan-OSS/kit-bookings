import { pageRole } from "../../../lib/roles/runtime";
import { ClassScreen } from "../../classes/class-screen";
export const dynamic = "force-dynamic";
export default async function OwnerClasses() {
  const owner = await pageRole(["owner"]);
  return (
    <main className="space-y-6 p-6">
      <h1 className="font-display text-3xl">Classes</h1>
      {owner ? <ClassScreen owner /> : <p>This page is for the owner.</p>}
    </main>
  );
}
