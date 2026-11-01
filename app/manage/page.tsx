import { ManageBooking } from "./manage-booking";

// The page a booking's signed link opens (/manage?token=…). The token is a credential: no referrer carries it
// to another site, and no account is needed to use it.
export const metadata = { title: "Your booking", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return (
    <ManageBooking
      token={one(params.token) ?? ""}
      fresh={one(params.new) === "1"}
      moved={one(params.moved) === "1"}
    />
  );
}
