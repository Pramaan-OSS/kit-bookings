import { notFound } from "next/navigation";
import Screen0 from "../bookings/screen";
import Screen5 from "../classes/screen";
import Screen7 from "../email/screen";
import Screen3 from "../hours/screen";
import Screen6 from "../roles/screen";
import Screen1 from "../services/screen";
import Screen4 from "../settings/screen";
import Screen2 from "../staff/screen";

const screens = {
  bookings: Screen0,
  services: Screen1,
  staff: Screen2,
  hours: Screen3,
  settings: Screen4,
  classes: Screen5,
  roles: Screen6,
  email: Screen7,
};
export const dynamic = "force-dynamic";
export default async function OwnerPage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  const name = section.join("/");
  if (!Object.hasOwn(screens, name)) notFound();
  const Screen = screens[name as keyof typeof screens];
  return <Screen />;
}
