import type { ReactNode } from "react";
import { OwnerShell } from "./owner-shell";

export const metadata = { title: "Owner area" };

// Every page under /owner: the shell checks the session is the owner's before showing anything, and every
// /api/owner/* route checks the role again on the server (lib/bookings/owner.ts).
export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}
