import { pageRole } from "../../../lib/roles/runtime";
import { NoAccess } from "../../parts/no-access";
import { EmailScreen } from "./email-screen";

export const dynamic = "force-dynamic";

/** The owner sees whether the app's emails are going out. The guard runs on the server: anyone else sees only how to get in. */
export default async function EmailPage() {
  const owner = await pageRole(["owner"]);
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Email notices</h1>
      {owner ? <EmailScreen ownerId={owner.id} /> : <NoAccess />}
    </main>
  );
}
