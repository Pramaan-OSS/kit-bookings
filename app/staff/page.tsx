import { pageRole } from "../../lib/roles/runtime";
import { NoAccess } from "../parts/no-access";
import { StaffDay } from "./staff-day";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your day" };

/** A staff member's own bookings, a day at a time. The guard runs on the server, and /api/staff/day checks again. */
export default async function StaffPage() {
  const member = await pageRole(["staff"]);
  if (member) return <StaffDay memberId={member.id} />;
  return (
    <main className="mx-auto max-w-xl px-5 py-20">
      <h1 className="mb-4 font-display text-3xl">Your day</h1>
      <NoAccess who="the business's staff" />
    </main>
  );
}
